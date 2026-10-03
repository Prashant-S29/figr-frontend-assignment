# Milestones

Order is deliberate: the risky unknown first (M1), the failure core before features (M2), identity before anything that survives re-renders (M5).

How to use this file:

- Work one milestone at a time, in order. Do not start M(n+1) until M(n)'s "Done when" is fully true.
- Scope comes from `prd.md` only. If a milestone seems to need something the PRD doesn't say, stop and ask.
- Update `progress.md` when a milestone starts, when a decision changes, and when it is done.
- Every feature milestone also registers its failure triggers in the dev menu (built in M2), so M9 only verifies.

---

## M0 Scaffold and baseline

**Goal:** an empty app and the build/run pipeline work end to end.
**PRD:** §2, D1, D2 (build only), D10, D11.
**Build:**

- Vite + React + TS app in `frontend/`. `report.js` ported to TS, signature unchanged.
- esbuild script that bundles the agent into `backend/pages/agent.js`.
- Root scripts: `npm start` (production build + backend), `npm run dev`, `npm run build:agent`.
- `baseline` git tag on the untouched kit.
  **Done when:**
- `npm start` on a clean clone serves the app and both backend ports.
- `git diff baseline -- backend/server.js backend/data` is empty.
- `git diff baseline -- backend/pages` contains only the generated `agent.js` addition; all page HTML is unchanged (script tags come in M1). Owner-approved M0 clarification.

## M1 Agent core and the D4 gate

**Goal:** prove the overlay approach works in real browsers before anything is built on it.
**PRD:** D2, D3, D4, R1.4, R2.4, R2.5, 1.5 (Select/Interact semantics).
**Build:**

- Agent: handshake over `MessagePort`, overlay in a closed shadow root, `elementsFromPoint` hover and click, emulated wheel scrolling, Ctrl/Cmd+wheel and key forwarding, mode switch, ping.
- One `<script src="/agent.js">` as the first script in `<head>` of all 7 pages.
- A throwaway host harness to drive it. It is deleted or replaced in M3 and is not part of the product.
  **Done when (Chrome and Firefox):**
- Page 2's disabled submit button can be hovered and clicked, and nothing happens to the page.
- Page 3's nested scroll area and sticky header: hit-testing is correct, and wheel scrolls the right container and chains outward.
- Links, buttons and inputs do nothing in Select mode, and work normally in Interact mode.
- Ctrl+wheel reaches the host from over the page.
- Gate result is recorded in `progress.md`. If it fails, record the fallback decision and amend PRD D4 before continuing.

## M2 Failure core

**Goal:** one place where failures are caught, deduped, reported and shown.
**PRD:** D7, R6.1, R6.4–6.6, R6.7 (skeleton).
**Build:**

- `fail(region, error, ctx)` is the only path to `report()`, deduped per error object within a region retry generation (owner-approved D7 clarification).
- Scope/attempt helper with abort signal and alive flag. Cancelled or stale means silent.
- `guard` wrapper for handlers, timers and rAF. React error boundary per region. Global `error`/`unhandledrejection` handlers route into `fail()`.
- Region error component with Retry.
- Dev menu shell (`?dev` or dev mode) with a registry that later milestones add triggers to.
- Small in-memory ring-buffer log of failures and `report()` calls, shown in the dev menu.
  **Done when:**
- Unit tests prove: one error caught by guard, boundary and global handler reports exactly once; a cancelled attempt reports nothing; a late result after its scope is dead is ignored.

## M3 Board and previews

**Goal:** all 24 previews load, pan and zoom, with correct connection handling.
**PRD:** R1, R6.2 (board, preview), R6.3.
**Build:**

- `GET /screens` with validation. Failure shows the board error with Retry.
- Grid of 24 previews at 1280×800 with names. Sandboxed iframes (D9).
- Pan by drag and wheel on empty space. Ctrl/Cmd+wheel zoom 25–400% centred on the pointer, rAF-batched store.
- Preview lifecycle from the agent handshake: connecting, ready, "Couldn't connect to this preview" after 10s or on ping loss, Retry.
- Replaced or navigated pages detected by a new `hello`. Hash-only changes ignored.
- "Page error" badge with the message on hover. Each page error is reported once.
- Toolbar Select/Interact toggle plus V/I keys, working even after a click inside a preview.
  **Done when:**
- All 24 previews connect. Pan and zoom are smooth. Ctrl+wheel works over a preview. Wheel over a preview scrolls only that page.
- Page 1's `#crash` in Interact mode and page 6's 4s rejection each show the badge.
- A preview that never connects shows the error on that preview only.
- Hover clears on pan or zoom start.

## M4 Hover and selection

**Goal:** correct outlines and selection behaviour.
**PRD:** R2, R3.1–3.6.
**Build:**

- Global single hover. Hover and selection state in a host store, with the agent sending intents only.
- Rect polling in the agent, clipping and screen-space outline layer in the host, 1px/2px, labels, label-below rule.
- Click, shift+click (same and different preview), Escape, background click, empty-board click.
- Enter / Shift+Enter / Tab / Shift+Tab on the most recently selected element.
- Selection hidden in Interact mode and restored in Select mode.
  **Done when:**
- Outlines stay glued through pan, zoom, page scroll, inner scroll area scroll, window resize and element size changes.
- Thickness and label size are constant at 25% and 400%.
- An element scrolled out of its scroll area has no outline but stays selected.
- Every R2.4 case works: disabled controls, SVG, images, elements under the sticky header.

## M5 Identity and re-render survival

**Goal:** the selection never jumps, across rebuilds, inserts and navigation.
**PRD:** D5, R3.7, R3.8, ambiguities 3 and 8.
**Build:**

- Agent reconciliation per parent, top-down: node reference, `data-key`, `id`, strict signature, relaxed signature. Unique match only, ambiguity means gone.
- `gone` and surviving-id events to the host. Selection pruning. "This element no longer exists" state.
- Hover re-resolution after mutations under a stationary pointer.
- Navigation clears that preview's selection and layer state.
  **Done when:**
- Page 4: a keyed and an un-keyed selection both survive at least 5 ticks as the same element, or end up gone. They never become a different element, including near the 25-item cap.
- Page 2 → page 1 (Interact mode) clears selection, and Select mode works on the new page with no board reload.

## M6 Inspector

**Goal:** Live and Details sections, with correct failure and staleness handling.
**PRD:** R5, R6.2 (details, inspector).
**Build:**

- Live fields read from the page and updated on change. Single and multi ("N elements", "Mixed").
- Details fetch with response validation, 404 as "No details for this element", no `data-key` as "No details", a failure shown in Details only with Retry.
- Latest-selection-wins, with superseded requests aborted silently.
- Inspector error boundary.
  **Done when:**
- Rapid reselection under `?latency=` never shows stale details.
- `?fail=1` breaks Details only, and Live values still show.
- "This element no longer exists" is shown correctly.

## M7 Layers: tree and sync

**Goal:** a working lazy tree, synced with the preview.
**PRD:** R4.1–4.8, R6.2 (layers, layers-row).
**Build:**

- Rows with indentation, name, chevron. Lazy children with the loading state, the 3s timeout, and a per-row "Couldn't load" with retry.
- Single in-flight request per row. Collapse and re-expand never duplicates or drops children.
- Hover sync both ways, with the nearest visible ancestor rule and no expansion.
- Selection sync both ways. A batched reveal expands all ancestors, highlights the row and scrolls the panel.
- Click scrolls only that page. Shift+click multi-select. Arrow-key navigation.
  **Done when:**
- Page 5: selecting `Setting 30.1` in the preview expands about 30 levels, highlights the row and scrolls to it.
- Collapsing and re-expanding mid-load is clean.
- One row failing leaves the others untouched.

## M8 Layers: persistence, live updates, search

**Goal:** the tree stays correct as pages change and as the user moves around.
**PRD:** R4.9–4.11, ambiguity 1.
**Build:**

- Per-preview expanded set and scroll position, restored on switch back, reset on navigation or board reload.
- Live tree updates from mutations: surviving rows keep state, removed rows disappear, a removed hovered row clears hover, scroll holds still.
- Search over the whole tree (agent-side), derived view, literal restore on clear, and selecting a result keeps search open.
  **Done when:**
- A→B→A restores A exactly.
- Page 4 updates every 2s with no scroll jump.
- Search finds `Setting 30.10` without it having been loaded, and clearing restores the exact previous state.

## M9 Failure matrix

**Goal:** every failure in R6 can be triggered on demand and is reported exactly once.
**PRD:** R6 in full.
**Build:**

- Complete dev menu: screens fail, preview no-connect, details fail and bad body, row load timeout and failure, inspector render error, error thrown in a draw, click, key, message handler, timer and response.
- Late-response and gone-region cases.
  **Done when:**
- For each trigger: error appears in its region only, retry works, `report()` is called exactly once (verified in the log), a retry that fails again adds one more, and a cancelled or replaced request reports nothing.

## M10 Verification and hardening

**Goal:** prove it works, and find what doesn't.
**PRD:** §8.
**Build:**

- The five Playwright checks from the PRD.
- Chrome and Firefox pass. Manual pass of every R-item.
- Performance check with 24 previews: pan, zoom and idle CPU.
- Fix defects. Record every known remaining limitation.
  **Done when:**
- Five tests pass on a clean clone via `npm start`.
- The "known limitations" list is complete and honest.

## M11 Deliverables

**Goal:** submission-ready.
**PRD:** §7.
**Build:**

- README with ambiguities, state organisation, protocol, and "where this breaks".
- Optional deployment: app plus API and pages as separate HTTPS origins, with a cold-start check against the 10s timeout.
- Video outline.
  **Done when:**
- A fresh clone follows the README to a running app.
- README claims match the code.
