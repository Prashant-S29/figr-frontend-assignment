// Drives the disposable M1 overlay gate; this is not product UI and failure/report routing is introduced in M2.
import { isAgentMessage, isHello, type AgentMessage, type HostMessage, type Mode } from "../../../shared/protocol";
import "./style.css";

/** Mounts a single sandboxed preview and text-only protocol probes before the iframe starts loading. */
export function startHarness(): void {
  const root = document.getElementById("root")!;
  root.innerHTML = `<main data-testid="m1-harness">
    <h1>M1 overlay gate — disposable harness</h1>
    <div class="controls">
      <label>Page <select data-testid="page">
        <option value="page-2.html">2 — Sign up</option><option value="page-3.html">3 — Dashboard</option>
        <option value="page-1.html">1 — Landing</option><option value="page-4.html">4 — Feed</option>
        <option value="page-5.html">5 — Settings</option><option value="page-6.html">6 — Docs</option>
        <option value="page-6-next.html">6-next</option>
      </select></label>
      <button data-testid="select-mode">Select</button><button data-testid="interact-mode">Interact</button>
      <button data-testid="ping">Ping</button><button data-testid="reload">Reload</button>
      <span data-testid="mode">select</span><span data-testid="connection">connecting</span>
    </div>
    <div class="probes">
      <span>Hover: <output data-testid="hover">null</output></span>
      <span>Click: <output data-testid="selection">null</output></span>
      <span>Key: <output data-testid="key">null</output></span>
      <span>Zoom: <output data-testid="zoom">null</output></span>
      <span>Ping: <output data-testid="pong">null</output></span>
      <span>Error: <output data-testid="error">none</output></span>
    </div>
  </main>`;
  const iframe = document.createElement("iframe");
  iframe.dataset.testid = "preview";
  iframe.title = "M1 cross-origin preview";
  iframe.width = "1280";
  iframe.height = "800";
  iframe.sandbox.add("allow-scripts", "allow-same-origin", "allow-forms");
  const page = root.querySelector<HTMLSelectElement>('[data-testid="page"]')!;
  const screenId = "m1-preview";
  const origin = "http://localhost:4001";
  let port: MessagePort | null = null;
  let instanceId: string | null = null;
  let mode: Mode = "select";
  let ready = false;
  let requestId = 0;
  let pendingPing: number | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  /** Writes probe values as text; no page-originated value ever enters the static harness markup. */
  function output(testId: string, value: unknown): void {
    root.querySelector(`[data-testid="${testId}"]`)!.textContent = typeof value === "string" ? value : JSON.stringify(value);
  }

  /** Displays a harness failure without calling report() before the M2 failure core exists. */
  function failure(error: unknown): void {
    output("error", `${screenId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** Keeps thrown harness callbacks visible instead of losing them in browser event dispatch. */
  function protect(handler: EventListener): EventListener {
    /** Displays synchronous errors from this temporary harness entry point. */
    return function guarded(event: Event): void {
      try { handler(event); } catch (error) { failure(error); }
    };
  }

  /** Clears the single connection/liveness deadline when its attempt is replaced or completes. */
  function clearDeadline(): void {
    clearTimeout(deadline);
    deadline = undefined;
  }

  /** Marks only this probe as disconnected after the PRD's ten-second deadline. */
  function expired(): void {
    ready = false;
    pendingPing = null;
    output("connection", "Couldn't connect to this preview");
    failure(new Error("Agent deadline exceeded"));
  }

  /** Starts one deadline for either a handshake or a pending ping. */
  function armDeadline(): void {
    clearDeadline();
    deadline = setTimeout(timedExpiry, 10_000);
  }

  /** Contains failures at the timer entry point; the permanent scope helper arrives in M2. */
  function timedExpiry(): void {
    try { expired(); } catch (error) { failure(error); }
  }

  /** Sends host commands exclusively through the current private connection. */
  function send(message: HostMessage): void {
    port?.postMessage(message);
  }

  /** Changes overlay mode without inventing host hover or selection state. */
  function setMode(next: Mode): void {
    mode = next;
    output("mode", mode);
    send({ type: "mode", mode });
  }

  /** Applies validated agent intents to text probes only. */
  function receive(message: AgentMessage): void {
    switch (message.type) {
      case "ready":
        if (message.instanceId !== instanceId) throw new Error("Ready instance mismatch");
        ready = true;
        clearDeadline();
        output("connection", `ready ${message.instanceId}`);
        break;
      case "pong":
        if (message.requestId !== pendingPing) return;
        clearDeadline();
        pendingPing = null;
        output("pong", message.requestId);
        break;
      case "hover": output("hover", message.target); break;
      case "select": output("selection", message); break;
      case "zoom": output("zoom", message); break;
      case "agent-error": failure(new Error(message.message)); break;
      case "key":
        output("key", message);
        if (!message.editable && !message.ctrlKey && !message.metaKey && !message.altKey) {
          if (message.key.toLowerCase() === "v") setMode("select");
          if (message.key.toLowerCase() === "i") setMode("interact");
        }
        break;
    }
  }

  /** Authenticates hello by the actual iframe window and configured page origin, then transfers one port. */
  function hello(event: Event): void {
    const input = event as MessageEvent<unknown>;
    if (input.source !== iframe.contentWindow || input.origin !== origin) return;
    if (!isHello(input.data)) throw new Error("Invalid preview hello");
    if (instanceId === input.data.instanceId) return;
    port?.close();
    const channel = new MessageChannel();
    const connection = channel.port1;
    port = connection;
    instanceId = input.data.instanceId;
    ready = false;
    pendingPing = null;
    output("hover", null);
    output("selection", null);
    output("error", "none");
    armDeadline();
    /** Ignores a replaced port and rejects malformed current-instance intents before using them. */
    function privateMessage(event: Event): void {
      if (port !== connection) return;
      const data = (event as MessageEvent<unknown>).data;
      if (!isAgentMessage(data)) throw new Error("Invalid agent message");
      if ((data.type === "hover" || data.type === "select") && data.target && !data.target.elementId.startsWith(`${instanceId}:`)) throw new Error("Target instance mismatch");
      receive(data);
    }
    connection.addEventListener("message", protect(privateMessage));
    connection.addEventListener("messageerror", protect(deserializationError));
    connection.start();
    iframe.contentWindow!.postMessage({ type: "connect", instanceId, mode }, origin, [channel.port2]);
  }

  /** Converts port deserialization errors into a visible harness probe failure. */
  function deserializationError(): void {
    throw new Error("Could not deserialize agent message");
  }

  /** Starts at most one liveness probe; repeated button/interval probes reuse the pending attempt. */
  function ping(): void {
    if (!ready || pendingPing !== null) return;
    pendingPing = ++requestId;
    send({ type: "ping", requestId: pendingPing });
    armDeadline();
  }

  /** Contains interval callback exceptions within the harness probe. */
  function heartbeat(): void {
    try { ping(); } catch (error) { failure(error); }
  }

  /** Loads a requested kit page without using its URL as preview identity. */
  function navigate(): void {
    port?.close();
    port = null;
    instanceId = null;
    ready = false;
    pendingPing = null;
    output("connection", "connecting");
    armDeadline();
    iframe.src = `${origin}/${page.value}`;
  }

  /** Drives Select mode from the harness toolbar. */
  function selectMode(): void { setMode("select"); }
  /** Drives native page interaction from the harness toolbar. */
  function interactMode(): void { setMode("interact"); }

  /** Supports V/I when the host rather than the iframe has keyboard focus. */
  function key(event: Event): void {
    const input = event as KeyboardEvent;
    if ((input.target as Element | null)?.matches("input,textarea,select,[contenteditable]") || input.ctrlKey || input.metaKey || input.altKey) return;
    if (input.key.toLowerCase() === "v") setMode("select");
    if (input.key.toLowerCase() === "i") setMode("interact");
  }

  window.addEventListener("message", protect(hello));
  window.addEventListener("keydown", protect(key));
  page.addEventListener("change", protect(navigate));
  root.querySelector('[data-testid="select-mode"]')!.addEventListener("click", protect(selectMode));
  root.querySelector('[data-testid="interact-mode"]')!.addEventListener("click", protect(interactMode));
  root.querySelector('[data-testid="ping"]')!.addEventListener("click", protect(ping));
  root.querySelector('[data-testid="reload"]')!.addEventListener("click", protect(navigate));
  setInterval(heartbeat, 5_000);
  root.appendChild(iframe);
  navigate();
}
