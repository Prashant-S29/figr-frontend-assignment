// Coordinates private commands, reconciliation, live tree/search, tracked geometry and page errors; DOM inspection stays in the agent and selection stays in the host.
import { isConnect, isHostMessage, type AgentMessage } from "../../shared/protocol";
import { native } from "./native";
import { createOverlay } from "./overlay";
import { createIdentity } from "./identity";
import { createGeometry } from "./geometry";

/** Starts only inside a preview, before page scripts can replace the browser operations we captured. */
function start(): void {
  if (window.parent === window) return;
  const instanceId = native.randomUUID();
  let port: MessagePort | null = null;
  const pendingErrors: AgentMessage[] = [];
  let watchedParents = new Map<string | null, string>();
  let search: { requestId: number; query: string; serialized: string } | null = null;

  /** Serializes an agent failure without throwing into the page, even if its connection is already gone. */
  function failure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (!port) {
      pendingErrors.push({ type: "agent-error", message });
      return;
    }
    try {
      native.portPost.call(port, { type: "agent-error", message } satisfies AgentMessage);
    } catch {
      // A dead port cannot receive failures; the host's liveness deadline owns disconnection detection.
    }
  }

  /** Catches every agent event entry point so agent exceptions cannot break the inspected page. */
  function protect(handler: EventListener): EventListener {
    /** Routes callback exceptions into a serialized preview failure. */
    return function guarded(event: Event): void {
      try { handler(event); } catch (error) { failure(error); }
    };
  }

  /** Sends private-port intents only; disconnected hover/click activity never leaks onto window messaging. */
  function send(message: AgentMessage): void {
    if (port) native.portPost.call(port, message);
  }

  const identity = createIdentity(instanceId);
  const geometry = createGeometry(identity, send, failure);
  let overlay: ReturnType<typeof createOverlay>;
  try { overlay = createOverlay(identity, send, protect); } catch (error) { failure(error); }

  /** Publishes only uniquely rebound or proven-gone exposed identities from one mutation batch. */
  function reconciled(result: Parameters<Parameters<typeof identity.observe>[0]>[0]): void {
    send({ type: "reconcile", targets: [...result.targets], goneElementIds: [...result.goneElementIds] });
  }

  /** Publishes changed loaded child levels after reconciliation; no unloaded branches are scanned by subscriptions. */
  function updateTree(): void {
    const levels = [];
    for (const [parentElementId, previous] of watchedParents) {
      const children = identity.treeChildren(parentElementId);
      const serialized = JSON.stringify(children);
      if (serialized === previous) continue;
      watchedParents.set(parentElementId, serialized);
      levels.push({ parentElementId, children });
    }
    if (levels.length) send({ type: "tree-update", levels });
    updateSearch();
  }

  /** Keeps the current correlated search derived from live mutations, stopping full-tree reads as soon as it clears. */
  function updateSearch(): void {
    if (!search) return;
    const paths = identity.treeSearch(search.query);
    const serialized = JSON.stringify(paths);
    if (serialized === search.serialized) return;
    search.serialized = serialized;
    send({ type: "tree-search-result", requestId: search.requestId, paths });
  }

  /** Updates subscribed tree/search views and stationary hover only after identity reconciliation has completed. */
  function mutationHover(): void { updateTree(); overlay?.refreshHover(); }

  identity.observe(reconciled, mutationHover, failure);

  /** Validates commands and current-document identities before mode, measurements, traversal or liveness responses. */
  function command(event: Event): void {
    const message = (event as MessageEvent<unknown>).data;
    if (!isHostMessage(message)) throw new Error("Invalid host message");
    if (message.type === "mode") overlay?.setMode(message.mode);
    else if (message.type === "clear-hover") overlay?.clearHover();
    else if (message.type === "ping") send({ type: "pong", requestId: message.requestId });
    else if (message.type === "track") {
      if (message.elementIds.some(id => !id.startsWith(`${instanceId}:`))) throw new Error("Tracked instance mismatch");
      geometry.track(message.revision, message.elementIds);
    } else if (message.type === "navigate") {
      if (!message.elementId.startsWith(`${instanceId}:`)) throw new Error("Navigation instance mismatch");
      send({ type: "navigate-result", requestId: message.requestId, target: identity.navigate(message.elementId, message.direction) });
    } else if (message.type === "tree-children") {
      if (message.parentElementId !== null && !message.parentElementId.startsWith(`${instanceId}:`)) throw new Error("Tree parent instance mismatch");
      send({ type: "tree-children-result", requestId: message.requestId, parentElementId: message.parentElementId, children: identity.treeChildren(message.parentElementId) });
    } else if (message.type === "tree-ancestors") {
      if (!message.elementId.startsWith(`${instanceId}:`)) throw new Error("Tree target instance mismatch");
      send({ type: "tree-ancestors-result", requestId: message.requestId, path: identity.treeAncestors(message.elementId) });
    } else if (message.type === "tree-watch") {
      if (message.parentElementIds.some(id => id !== null && !id.startsWith(`${instanceId}:`))) throw new Error("Tree watch instance mismatch");
      watchedParents = new Map(message.parentElementIds.map(id => [id, watchedParents.get(id) ?? ""]));
      updateTree();
    } else if (message.type === "tree-search") {
      search = message.query ? { requestId: message.requestId, query: message.query, serialized: "" } : null;
      if (search) updateSearch();
      else send({ type: "tree-search-result", requestId: message.requestId, paths: [] });
    } else {
      if (!message.elementId.startsWith(`${instanceId}:`)) throw new Error("Scroll target instance mismatch");
      identity.scrollElement(message.elementId);
    }
  }

  /** Accepts only this document's bootstrap from its actual parent, then replaces the private connection. */
  function connect(event: Event): void {
    const input = event as MessageEvent<unknown>;
    if (input.source !== window.parent) return;
    if (!isConnect(input.data) || input.data.instanceId !== instanceId || input.ports.length !== 1) throw new Error("Invalid agent bootstrap");
    if (port) native.portClose.call(port);
    geometry.reset();
    watchedParents.clear();
    search = null;
    port = input.ports[0];
    const connection = port;
    /** Ignores queued commands from a replaced connection rather than changing the current document mode. */
    function privateMessage(event: Event): void {
      if (port === connection) command(event);
    }
    /** Ignores errors from a replaced connection before routing current-port deserialization failures. */
    function privateError(): void {
      if (port === connection) portError();
    }
    native.addListener.call(port, "message", protect(privateMessage));
    native.addListener.call(port, "messageerror", protect(privateError));
    native.portStart.call(port);
    overlay?.setMode(input.data.mode);
    send({ type: "ready", instanceId });
    for (const message of pendingErrors.splice(0)) send(message);
  }

  /** Makes a deserialization failure visible to the host instead of crashing a page callback. */
  function portError(): void {
    throw new Error("Could not deserialize host message");
  }

  /** Forwards each native page exception/rejection without cancelling its ordinary browser delivery. */
  function pageError(event: Event): void {
    const reason: unknown = event.type === "error" ? (event as ErrorEvent).message : (event as PromiseRejectionEvent).reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "Unknown page error");
    const intent: AgentMessage = { type: "page-error", message };
    if (port) send(intent);
    else pendingErrors.push(intent);
  }

  native.addListener.call(window, "error", protect(pageError));
  native.addListener.call(window, "unhandledrejection", protect(pageError));
  native.addListener.call(window, "message", protect(connect));
  // Referrer becomes the previous preview on navigation; only the parent can authenticate discovery.
  native.postParent({ type: "hello", instanceId }, "*");
}

start();
