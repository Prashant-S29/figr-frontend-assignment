// Owns one screenId's authenticated connection, heartbeat and page-error badge; shared selection/geometry and React DOM are owned elsewhere.
import { isHello, isAgentMessage, type AgentMessage, type HostMessage, type Mode } from "../../../shared/protocol";
import type { Screen } from "../api/screens";
import { fail, type Failure, type FailureTarget } from "../core/fail";
import { guard } from "../core/guard";
import { scopedTimeout } from "../core/schedule";
import { createScope, type Scope } from "../core/scope";
import { createFailureRegion } from "./failure-region";

export interface PreviewSnapshot { readonly phase: "connecting" | "ready" | "failed"; readonly instanceId: string | null; readonly pageError: string | null }
export interface PreviewIntents {
  mode(): Mode;
  receive(screenId: string, message: AgentMessage): void;
  replaced(screenId: string): void;
}

/** Creates an isolated preview owner whose old private-port callbacks die before a page or retry replaces them. */
export function createPreview(screen: Screen, parent: Scope, intents: PreviewIntents) {
  const region = createFailureRegion("preview", { screenId: screen.id }, parent);
  const origin = new URL(screen.url).origin;
  let frame: HTMLIFrameElement | null = null;
  let port: MessagePort | null = null;
  let connection: Scope | undefined;
  let cancelDeadline: (() => void) | undefined;
  let cancelHeartbeat: (() => void) | undefined;
  let pendingPing: number | null = null;
  let sequence = 0;
  let generation = region.getSnapshot().generation;
  let blockNext = false;
  let blocked = false;
  let snapshot: PreviewSnapshot = { phase: "connecting", instanceId: null, pageError: null };
  const listeners = new Set<() => void>();

  /** Replaces a whole preview snapshot without leaking mutable connection internals to React. */
  function update(next: PreviewSnapshot): void { snapshot = next; for (const listener of listeners) listener(); }
  /** Reads the current private connection scope for errors, timers and response arrival. */
  function target(): FailureTarget {
    const current = region.target;
    return connection ? { ...current, ctx: { ...current.ctx, scope: connection } } : current;
  }
  /** Cancels liveness work and closes a displaced port before it can publish another intent. */
  function disconnect(): void {
    cancelDeadline?.();
    cancelHeartbeat?.();
    cancelDeadline = cancelHeartbeat = undefined;
    connection?.dispose();
    connection = undefined;
    port?.close();
    port = null;
    pendingPing = null;
  }
  /** Converts both handshake and ping expiry into the same preview-only fallback. */
  function expired(): void { throw new Error("Couldn't connect to this preview"); }
  /** Starts exactly one ten-second liveness deadline for the current connection. */
  function deadline(): void {
    cancelDeadline?.();
    cancelDeadline = scopedTimeout(target(), expired, 10_000);
  }
  /** Uses only the private port after bootstrap; failed or gone previews cannot send. */
  function send(message: HostMessage): void {
    if (snapshot.phase !== "failed") port?.postMessage(message);
  }
  /** Starts the next heartbeat only when the previous ready/pong has completed. */
  function heartbeat(): void { cancelHeartbeat = scopedTimeout(target(), ping, 5_000); }
  /** Keeps at most one ping in flight and gives its agent ten seconds to answer. */
  function ping(): void {
    if (snapshot.phase !== "ready" || pendingPing !== null) return;
    pendingPing = ++sequence;
    send({ type: "ping", requestId: pendingPing });
    deadline();
  }
  /** Publishes a page occurrence as a nonfatal badge, not the preview's fatal region fallback. */
  function publishPageError(failure: Failure): void { update({ ...snapshot, pageError: failure.message }); }
  /** Applies validated current-document traffic while leaving product intents to the board owner. */
  function receive(message: AgentMessage): void {
    if (message.type === "ready") {
      if (message.instanceId !== snapshot.instanceId) throw new Error("Ready instance mismatch");
      if (snapshot.phase === "ready") return;
      cancelDeadline?.();
      update({ ...snapshot, phase: "ready" });
      heartbeat();
    } else if (message.type === "pong") {
      if (message.requestId !== pendingPing) return;
      cancelDeadline?.();
      pendingPing = null;
      heartbeat();
    } else if (message.type === "agent-error") {
      const owner = target();
      fail(owner.region, new Error(message.message), owner.ctx);
    } else if (message.type === "page-error") {
      const owner = target();
      fail(owner.region, new Error(message.message), { ...owner.ctx, publish: publishPageError });
    } else {
      if ((message.type === "hover" || message.type === "select" || message.type === "navigate-result") && message.target && !message.target.elementId.startsWith(`${snapshot.instanceId}:`)) throw new Error("Target instance mismatch");
      if (message.type === "geometry" && message.targets.some(item => !item.elementId.startsWith(`${snapshot.instanceId}:`))) throw new Error("Geometry instance mismatch");
      if (message.type === "reconcile" && [...message.targets.map(item => item.elementId), ...message.goneElementIds].some(id => !id.startsWith(`${snapshot.instanceId}:`))) throw new Error("Reconciliation instance mismatch");
      intents.receive(screen.id, message);
    }
  }
  /** Turns a current-port structured-clone failure into a preview failure. */
  function deserializeError(): void { throw new Error("Could not deserialize agent message"); }
  /** Accepts discovery only from this iframe and its allowed origin, never from a URL-sharing sibling. */
  function hello(input: MessageEvent<unknown>): void {
    if (!frame || input.source !== frame.contentWindow || input.origin !== origin || blocked || region.getSnapshot().failure) return;
    if (!isHello(input.data)) throw new Error("Invalid preview hello");
    if (input.data.instanceId === snapshot.instanceId) return;
    disconnect();
    intents.replaced(screen.id);
    connection = createScope(region.target.ctx.scope);
    const channel = new MessageChannel();
    const current = channel.port1;
    port = current;
    update({ phase: "connecting", instanceId: input.data.instanceId, pageError: null });
    /** Rejects malformed data at the boundary and ignores any queue from the replaced private port. */
    function privateMessage(event: MessageEvent<unknown>): void {
      if (port !== current) return;
      if (!isAgentMessage(event.data)) throw new Error("Invalid agent message");
      receive(event.data);
    }
    current.addEventListener("message", guard(target(), privateMessage), { signal: connection.signal });
    current.addEventListener("messageerror", guard(target(), deserializeError), { signal: connection.signal });
    current.start();
    deadline();
    frame.contentWindow!.postMessage({ type: "connect", instanceId: snapshot.instanceId, mode: intents.mode() }, origin, [channel.port2]);
  }
  /** Routes authenticated discovery failures through this preview rather than the shared board listener. */
  function discover(event: MessageEvent<unknown>): void { guard(region.target, hello)(event); }
  /** Registers a React-owned iframe only after the board's single discovery listener is installed. */
  function attach(element: HTMLIFrameElement): () => void {
    frame = element;
    connection = createScope(region.target.ctx.scope);
    deadline();
    element.src = screen.url;
    /** Releases only the iframe that this effect attached, not a newer retry's frame. */
    return function detach(): void {
      if (frame !== element) return;
      frame = null;
      disconnect();
    };
  }
  /** Cancels fatal-preview work and resets badge/identity only on an explicit fresh retry generation. */
  function regionChanged(): void {
    const state = region.getSnapshot();
    if (state.failure) {
      disconnect();
      intents.replaced(screen.id);
      update({ ...snapshot, phase: "failed" });
    } else if (generation !== state.generation) {
      generation = state.generation;
      disconnect();
      blocked = blockNext;
      blockNext = false;
      intents.replaced(screen.id);
      update({ phase: "connecting", instanceId: null, pageError: null });
    }
  }
  const unsubscribeRegion = region.subscribe(regionChanged);
  /** Injects an actual never-answering handshake for the dev menu, retaining the normal ten-second deadline. */
  function noConnect(): void { blockNext = true; region.retry(); }
  /** Exercises the same nonfatal page-event path from the dev menu without touching cross-origin page DOM. */
  function injectPageError(): void {
    if (snapshot.phase === "ready") guard(target(), receive)({ type: "page-error", message: "Injected page error" });
  }
  /** Returns the stable connection/badge snapshot. */
  function getSnapshot(): PreviewSnapshot { return snapshot; }
  /** Subscribes one view to this screen's lifecycle only. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes a preview view without affecting another screen. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }
  /** Releases the preview's region, connection and readers when its board generation goes away. */
  function dispose(): void { disconnect(); frame = null; unsubscribeRegion(); region.dispose(); listeners.clear(); }
  /** Exposes host geometry for coordinate conversion without ever reading the iframe's cross-origin DOM. */
  function getFrame(): HTMLIFrameElement | null { return frame; }
  return { screen, region, getSnapshot, subscribe, attach, discover, send, noConnect, injectPageError, dispose, getFrame, getTarget: target };
}
export type PreviewStore = ReturnType<typeof createPreview>;
