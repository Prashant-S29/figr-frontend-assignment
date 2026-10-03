// Owns bootstrap, private-port dispatch and page-error forwarding; overlay input is delegated and all product state stays in the host.
import { isConnect, isHostMessage, type AgentMessage } from "../../shared/protocol";
import { native } from "./native";
import { createOverlay } from "./overlay";

/** Starts only inside a preview, before page scripts can replace the browser operations we captured. */
function start(): void {
  if (window.parent === window) return;
  const instanceId = native.randomUUID();
  let port: MessagePort | null = null;
  const pendingErrors: AgentMessage[] = [];

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

  let overlay: ReturnType<typeof createOverlay>;
  try { overlay = createOverlay(instanceId, send, protect); } catch (error) { failure(error); }

  /** Rejects invalid commands before applying mode or answering a correlated liveness request. */
  function command(event: Event): void {
    const message = (event as MessageEvent<unknown>).data;
    if (!isHostMessage(message)) throw new Error("Invalid host message");
    if (message.type === "mode") overlay?.setMode(message.mode);
    else if (message.type === "clear-hover") overlay?.clearHover();
    else send({ type: "pong", requestId: message.requestId });
  }

  /** Accepts only this document's bootstrap from its actual parent, then replaces the private connection. */
  function connect(event: Event): void {
    const input = event as MessageEvent<unknown>;
    if (input.source !== window.parent) return;
    if (!isConnect(input.data) || input.data.instanceId !== instanceId || input.ports.length !== 1) throw new Error("Invalid agent bootstrap");
    if (port) native.portClose.call(port);
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
