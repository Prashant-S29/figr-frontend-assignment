# Progress

Update at the start and end of every milestone, and whenever a decision, gate or limitation appears. Keep entries short and factual.

## Now
- **Current milestone:** M3 (not started); M0–M2 are done
- **Next action:** replace the disposable harness with the product board/previews, validated screens fetching, rAF-batched pan/zoom, scoped connections and page-error badges

## Milestones
| ID | Name | Status | Verified (what, when) |
|---|---|---|---|
| M0 | Scaffold and baseline | done | 2026-10-03: fresh clone + `npm ci` + `npm start`; Chrome rendered the production shell, API returned 24 screens, all 7 pages and agent asset returned 200. Typecheck/build passed; empty unit run exited 0. Protected backend diff empty; only generated `agent.js` added under pages. |
| M1 | Agent core and D4 gate | done | 2026-10-03: full gate + keyboard/native-capture/transport probes passed Chrome and Firefox (`2 passed`, 2.3m); typecheck/build and empty unit run passed. Bundle regeneration left git clean after commit `64213d4`. |
| M2 | Failure core | done | 2026-10-03: 20 unit tests; typecheck/build pass; Chrome/Firefox core probes (2 passed, 56.1s) and M1 regression (2 passed, 2.9m). Vite dev visibility/Retry verified in Chrome. Commit `513632d`; agent regeneration leaves git clean. |
| M3 | Board and previews | not started | |
| M4 | Hover and selection | not started | |
| M5 | Identity and re-render survival | not started | |
| M6 | Inspector | not started | |
| M7 | Layers: tree and sync | not started | |
| M8 | Layers: persistence, live updates, search | not started | |
| M9 | Failure matrix | not started | |
| M10 | Verification and hardening | not started | |
| M11 | Deliverables | not started | |

Status values: `not started`, `in progress`, `blocked`, `done`.

## Gates
- **D4 overlay gate (M1):** **PASS**, 2026-10-03. Chrome 153 and Firefox 155: disabled-button hover/click; Select blocks input focus, checkbox changes, links and the crash button; Interact restores native actions; nested scrolling/chaining and sticky header/th hit-testing; Ctrl/Cmd-wheel forwarding. Overlay-only focus fixes V/I/Enter/Tab after iframe clicks. No overlay fallback needed; D4's focus clarification was owner-approved.

## Decision log
Append only. Anything that changes a PRD `D*` item, the protocol, or adds a dependency goes here before it is built.

| # | Date | Decision | Why | Rejected | Milestone |
|---|---|---|---|---|---|
| 1 | 2026-10-03 | Unit tests run on the Playwright test runner (no browser) | PRD D11 has no unit test runner; avoids a new dependency | vitest | M2 |
| 2 | 2026-10-03 | Page errors are reported once each with `region: "preview"` | Brief is silent; badge is a failure display | badge only | M3 |
| 3 | 2026-10-03 | Owner approved `@types/react` and `@types/react-dom` as dev dependencies (D11) | React does not ship the definitions needed for strict TS | Hand-authored/incomplete React definitions | M0 |
| 4 | 2026-10-03 | Owner approved M0's pages gate allowing only generated `agent.js`; HTML stays untouched | Resolves the empty-pages-diff gate versus D2's committed bundle requirement | Deferring the committed bundle until M1 | M0 |
| 5 | 2026-10-03 | Owner approved initial M1 protocol: window hello/connect with instanceId and one transferred port; private ready, mode, ping/pong, hover/select intents (minted id + name), key, zoom wheel, agent-error | D3 specifies transport but not a wire schema; shared validators establish the boundary | Ad-hoc harness messages or sending DOM references | M1 |
| 6 | 2026-10-03 | Owner approved fixing navigation discovery: hello targets parent with `*`; bootstrap requires the actual parent source; host validates iframe source/page origin before transferring the port | Referrer after iframe navigation is the previous page, not the host; hello carries no DOM data and all later traffic is private | Referrer-derived parent origin | M1 |
| 7 | 2026-10-03 | Owner approved D4 clarification: Select pointer-down focuses only the neutral agent surface in its closed shadow root with `preventScroll`, not page controls | Pointer-default cancellation otherwise leaves host toolbar focus and loses iframe shortcuts | Leaving focus in host controls or focusing page inputs | M1 |
| 8 | 2026-10-03 | Proposed, pending owner: dedupe Error identity within a region retry generation; an explicitly entered live retry may report a reused Error as a new occurrence | D7's per-object dedupe and R6.4's fresh retry failure conflict when code rethrows the same object; global catches of cancelled work must stay silent | Requiring callers to allocate fresh Error objects on every retry | M2 |
| 9 | 2026-10-03 | Owner approved D7 clarification: Error identity dedupe is per region retry generation; explicit live Retry may reuse the Error as a fresh occurrence, while stale/global catches remain silent | Satisfies both exact-once catches and R6.4's new-failure-on-retry rule | Lifetime per-object dedupe requiring fresh errors from callers | M2 |

## Known limitations
Feeds the README "where this breaks". Add as discovered: what breaks, when, and why.

_No unresolved M1 gate or M2 core defects found in the completed checks. Product failure-matrix verification remains M9._

- Native Interact scrolling follows the browser's gesture rules: Firefox can latch a wheel transaction to the nested container for 1500ms, so outward chaining at its boundary requires a new gesture. Select-mode emulation consumes the remainder immediately. This is native browser behavior, not an overlay fallback.

## Open questions for the owner
_None._

## Session log
One line per working session: what changed, what is next.

- 2026-10-03: docs written (PRD, milestones, rules, context, progress). No code yet.
- 2026-10-03: M0 started. Imported the supplied backend, reporter and original brief unchanged; created the `baseline` tag. Owner approved React type packages and the generated-agent-only M0 pages exception.
- 2026-10-03: M0 finished. Added the strict React/Vite scaffold, TS reporter port, deterministic esbuild agent bundle, production/development commands and separate Playwright configs. Next: M1 only.
- 2026-10-03: M1 started; owner approved the initial transport schema. Building only the agent/overlay and disposable host; shared failure/report routing remains M2 and product UI remains M3 onward.
- 2026-10-03: M1 gate paused per project rules after Chrome and Firefox both navigated page 2 → page 1 but did not reconnect. Root cause is incorrect referrer-based parent-origin discovery after navigation. Owner approved the fix; navigation and the D4 pointer/wheel gate then passed both browsers.
- 2026-10-03: Additional keyboard checks paused M1 again: Enter/Tab after Select clicks did not reach the iframe when host controls retained focus. Owner approved overlay-only focus; the complete gate and transport probes then passed both browsers. Temporary verification lives at `/tmp/figr-m1-gate/` (not in the five product E2E suite). Chrome uses agent-browser input/inspection, with coordinate-accurate native wheel events supplied over CDP because agent-browser 0.27 wheel targets host 0,0; Firefox uses the Playwright runner and a new native wheel gesture after its 1500ms target latch.
- 2026-10-03: M1 completed and committed as `64213d4`; deterministic agent regeneration left git clean. D4 gate is passed, both approved fixes are logged, and the harness remains disposable. Next: M2 only.
- 2026-10-03: M2 started. Building shared failure infrastructure and browser-free tests, with temporary M1 harness integration for browser verification. No protocol/dependency change or M3 feature work planned.
- 2026-10-03: M2 core and 17 tests passed; Chrome exercised regional Retry, render/timer/rAF/global failures, duplicate global deliveries, cancellation and safe text rendering. Paused for D7/R6.4 clarification about explicitly reusing an Error object on Retry before finalizing the core. Owner approved generation-scoped dedupe; the final 20 unit tests and Chrome/Firefox browser checks passed.
- 2026-10-03: M2 completed in `513632d`; final typecheck/build, 20 unit checks and deterministic agent regeneration passed. M1 browser gate still passes. No backend/protocol/dependency changes; M3 has not started.

## M0 verification evidence

- Baseline: `c745ebd` imports the untouched kit from `/home/prashantsingh/prashant_workspace/gigs/figr`; original README preserved as `knowledge_base/reference/assignment-brief.md`. Scaffold commit: `268ebdf`.
- Environment: Node `v22.21.1`, npm `10.9.4`, Google Chrome `153.0.8010.47`, using `npx agent-browser` as external verification tooling (not a project dependency).
- Clean clone: `/tmp/figr-m0-clean-clone`, created with `git clone --no-hardlinks`. `npm ci` succeeded; `npm start` built the agent and production host, then served host `:5173`, API `:4000`, pages `:4001`.
- Real Chrome: `http://localhost:5173` rendered the `Figr Viewer` heading in `[data-testid="app"]`; host HTML referenced `/assets/`, not `/@vite/client`. No browser errors observed. Screenshot: `/tmp/figr-m0-production.png` (local verification artifact).
- Browser fetches: `/screens` returned 24 valid entries with 24 unique ids and 6 unique page URLs. All 7 HTML pages and `/agent.js` returned 200 from `:4001`. No HTML included the agent tag. Direct navigation to page 2 showed the original disabled submit button. This verifies delivery, not the M1 overlay gate.
- Development smoke: `npm run dev` served the shell with `/@vite/client` and the API with 24 screens. In the disposable clone only, an agent content change was reflected in the served bundle by the watcher; restoring the entry restored the identical committed bundle. A timestamp-only probe was inconclusive because unchanged generated content is not rewritten; the content-change probe verified the watcher. Both clone and working repository were clean afterwards; verification processes were stopped.
- `npm run typecheck`, `npm run build`, and `npm run build:agent` succeeded. `npm test` exited 0 with **zero tests**; unit cases start in M2 and the five product checks in M10. No feature behaviour is claimed by this run.
- `git diff baseline -- backend/server.js backend/data 'backend/pages/*.html'` was empty. `git diff --name-status baseline -- backend/pages` showed only `A backend/pages/agent.js`. Regenerating the agent left git clean.
- M0 scope at completion: the host was intentionally an empty shell and the agent an empty IIFE. No protocol, script injection, overlay, board, layers, inspector, or failure core had been implemented yet.

## M1 verification evidence

- Implementation: `shared/protocol.ts` validates the approved hello/connect and private commands/intents. `agent/src/native.ts` captures depended-on browser operations at startup. The closed-shadow overlay sits outside the page body, hit-tests beneath itself, isolates Select pointer input, focuses only its own neutral surface, emulates nearest-container wheel scrolling with outward remainder chaining, and forwards shortcut/zoom intents. Ids are currently stable by node reference only; M5 adds reconciliation.
- Host: disposable `frontend/src/harness/`, with one 1280×800 sandboxed preview, fixed `screenId: m1-preview`, text-only probes, source/origin-authenticated bootstrap, port replacement, heartbeat and a 10s response deadline. The React product shell is reserved for M3. This harness displays probe errors but does not implement M2's fail/report core or the product failure UI; nothing calls `report()`.
- Full gate: `npx playwright test --config /tmp/figr-m1-gate/playwright.config.ts` reported **2 passed (2.3m)** using Google Chrome `153.0.8010.47` (agent-browser session `figr-m1`, browser-tooling iframe observations and coordinate-accurate native CDP wheel input) and Playwright Firefox `155.0` (build `1543`). These are temporary milestone probes outside `frontend/e2e/`, not extra product tests. Firefox installation succeeded on the fallback download mirror after the first mirror timed out.
- Page 2, both browsers: disabled submit hovered/clicked with the same minted id and remained disabled; Select clicks did not focus page controls, toggle checkbox, navigate links or submit. Background hover was null. In Interact the input accepted text, editable `i` did not switch modes, checkbox toggled and Log in navigated to page 1 with a new ready instance.
- Page 1, both browsers: hash link retained the instance. Crash button generated no page exception in Select and exactly one expected TypeError in Interact. V/I worked after preview clicks. After the focus fix, Enter/Tab after Select clicks were forwarded to the host.
- Page 3, both browsers: first 100px Select wheel scrolled the inner orders area to 100 while page scroll stayed 0; an 800px wheel reached its exact scroll limit and consumed the remainder in the page. Sticky page header and nested sticky `th` remained topmost hit/click targets. Interact used native inner/page scrolling; Firefox needed a new wheel transaction for native chaining. Ctrl-wheel in Select and Cmd-wheel in Interact reached the host without scrolling; Select zoom cleared hover.
- Native captures: replacing the page's `document.elementsFromPoint`, `window.getComputedStyle`, and `Element.prototype.scrollBy` with throwing functions did not break the agent's hit-testing/scrolling or add a page exception.
- Transport: shape-valid hello from the wrong window source was ignored; bootstrap from the real parent replaced the agent port; malformed mode on that private connection produced `agent-error: Invalid host message` without throwing into the page. The displaced harness port received no pong and reached its 10s deadline; Reload established a fresh working instance and ping/pong recovered.
- Verification-tool corrections (not product fixes): agent-browser's decimal mouse coordinates were rounded; its wheel input was observed landing on the host at `(0,0)` and replaced with coordinate-accurate native CDP input. The temporary gate runner was moved out of `test-results/` because the unit runner clears that output directory. No assertions were skipped, no dependency was added, and no product E2E case was changed.
- `npm run typecheck`, `npm run build`, `npm test` and the agent build passed. Unit command still contains zero cases (M2); the five product checks still belong to M10. Screenshots: `/tmp/figr-m1-chrome-agent-browser.png`, `/tmp/figr-m1-firefox.png` (local artifacts).
- Protected inputs: server/data diff from `baseline` is empty. For each of seven HTML files, removing the single first-head `<script src="/agent.js"></script>` restored byte-for-byte baseline content. Only that tag and generated `agent.js` changed under the pages directory.
- Committed build: `64213d4` includes the regenerated `backend/pages/agent.js`; `npm run build:agent` afterwards produced no git changes.
- M1 scope at completion: product board/outlines/selection, render reconciliation, layers/inspector, page-error badges and shared failure/report handling were deferred. No M2 or later feature work had started.

## M2 verification evidence

- Core: `fail(region, error, ctx)` is the sole caller of `report()`. Weakly held occurrence attribution dedupes guards, React boundaries/root callbacks and global handlers within a region retry generation. Explicit live Retry can reuse an Error as a fresh occurrence; child attempts keep their publisher/generation identity, and cancelled global deliveries keep their original dead scope. Unowned host-global errors fall back to the board; known owners keep their region/screen/key.
- Lifetimes: parent/child scopes expose an abort signal and alive flag. `runAttempt` applies only live results and contains loading/application errors. `guard` contains sync errors and returned promise rejections. Scoped timeout/rAF helpers cancel native work on disposal. Region stores replace error snapshots whole, invalidate old work on Retry and cannot resurrect a disposed owner.
- UI/integration: generic React region boundaries and text-only Error/Retry UI; React 19 caught/uncaught root callbacks feed the same core. The existing M1 DOM island uses scoped preview handlers, private-port scopes, timers and cleanup. Explicit Reload/page-choice/Retry starts a fresh preview generation. Temporary board/preview fallback surfaces are verification infrastructure, not the product board. The dev registry has only M2 core probes; feature-specific failure triggers remain their milestones.
- Unit command: `npm test` reported **20 passed**, no browser fixture. Covers guard + actual boundary method + React caught-root callback + global dedupe; cancelled/late/gone work; response-apply errors; fresh and reused-error Retry; child-scope completion; async guards; primitive occurrences; parent cancellation; timers; un-keyed sibling-row isolation; 100-entry ordered ring; registry ownership. Removed M0's `--pass-with-no-tests` flag now that cases exist.
- Production browser probes: `npx playwright test --config /tmp/figr-m2-check/playwright.config.ts` reported **2 passed (56.1s)** on Chrome 153 via agent-browser (CDP tooling for observations) and Playwright Firefox 155. These temporary probes are outside the five future product E2E cases.
- Browser observations, both: preview handler fault showed preview-only Retry and kept toolbar mode changes working; preview Retry replaced the connection and preserved Interact mode. Handler, actual React render, timer, rAF and native unhandled rejection each added exactly one report, with one failure + one report log entry, and Retry recovered without adding reports. Cancellation's deliberately late response left zero error regions and report count unchanged.
- Global/text checks, both: delivering one Error through two error events and a rejection event added just one report. HTML-looking error text rendered literally without creating an image or executing its onerror. A genuinely uncaught native host timer error used the board fallback. A fresh failed Retry added one report. Normal production without `?dev` had no dev menu; the sandboxed preview remained connected.
- Vite development smoke, Chrome: `npm run dev` at `/` without `?dev` exposed the menu and served `/@vite/client`; actual render injection produced one report, then Retry recovered. Production `?dev` visibility was separately verified above.
- M1 regression: `npx playwright test --config /tmp/figr-m1-gate/playwright.config.ts` reported **2 passed (2.9m)** after scoped harness integration: disabled controls, Select/Interact, keyboard focus, nested scrolling/sticky targets, zoom, native captures, port replacement/invalid-message isolation, lost-pong deadline and Reload recovery still pass in Chrome and Firefox.
- Local artifacts: `/tmp/figr-m2-chrome-agent-browser.json`, `/tmp/figr-m2-firefox.json`, matching screenshots, and `/tmp/figr-m2-render-error.png`. Browser-tooling correction: the Chrome CDP observer selected an internal new-tab target on its first attempt; selecting the actual host URL fixed the probe without changing any product assertion.
- `npm run typecheck`, `npm run build`, and agent regeneration succeeded. `git diff f392e11 -- backend agent shared package-lock.json` was empty: no backend/HTML/agent/protocol/dependency change. The only fixed-decision clarification is owner-approved D7 retry-generation dedupe.
- Committed build: `513632d`; `npm run build:agent` after commit produced no git changes. Browser/dev-server verification processes were stopped after the checks.
- Scope: M2 failure infrastructure is complete; no screens API/grid/pan/zoom product work, inspector/layers, page-error badges or full failure matrix was built. Those remain M3 onward.
