<!-- Summarizes verified behavior, ownership and run instructions; the PRD and detailed evidence remain in knowledge_base/. -->
# Figr Viewer

A cross-origin page viewer built with React, TypeScript, Vite and plain CSS.

## What we built

- 24 sandboxed 1280×800 previews. Six fixture pages repeat intentionally.
- Pan/zoom board with Select and native Interact modes.
- Clipped hover/selection outlines, multi-select and keyboard traversal.
- Mutation-safe identity: selection never jumps to a different element.
- Lazy Layers tree, whole-tree search and per-preview expansion/scroll memory.
- Inspector: live page values and latest-selection-only API Details.
- Isolated errors, local Retry, exact-once reporting and `?dev` failure controls.
- Light/Dark dashboard theme; iframe styling stays unchanged.

## Run locally

Node 18+ and npm; verified with Node 22.

```bash
git clone https://github.com/Prashant-S29/figr-frontend-assignment.git
cd figr-frontend-assignment
npm ci
npm start
```

Open **http://localhost:5173**. API: `:4000`; pages: `:4001`. Keep these ports free.
`npm start` builds production assets and runs everything. `npm run dev` enables development mode.

Four Docs previews deliberately raise an analytics error after four seconds. Four Page error badges/reports are expected—not broken connections.

## Controls

| Input | Action |
|---|---|
| Drag/wheel on empty board | Pan |
| Ctrl/Cmd + wheel anywhere | Pointer-centred zoom, 25–400% |
| Wheel over preview | Scroll that page |
| V / I | Select / Interact; ignored while typing |
| Click / Shift + click | Select / toggle within one preview; another preview replaces selection |
| Escape / background click | Clear selection |
| Enter / Shift + Enter | First child / parent in Select |
| Tab / Shift + Tab | Next / previous sibling in Select, wrapping |
| Layers ↑/↓; →/← | Select row; expand/collapse or move focus |

## State and ownership

Plain TS stores in `frontend/src/stores/` own shared state. React reads through `useSyncExternalStore`; only store actions mutate it.

| Owner | State |
|---|---|
| `board`, `viewport` | Screens/mode; rAF-batched pan/zoom |
| `preview` | Per-screenId connection, instance, deadline, badge |
| `selection` | Hover, active preview, ordered selection, geometry |
| `layers` | Lazy rows/requests, search, per-preview expansion/scroll |
| `inspector` | Live projection, cancellable Details |
| `failure-region`, `core/` | Retry generations, scopes, dedupe, `fail()` → `report()` |
| `theme` | Host palette; no reload persistence |
| `agent/src/` | Page DOM, identities, hit-testing, measurements |

The host never reads iframe DOM. Backend/data are unchanged; each page adds only the agent script tag. Its generated bundle is committed.

## Host ↔ page protocol

- Public `hello`/`connect`: authenticate iframe source/page origin and transfer a private port.
- All later traffic uses that port. Only ids, metadata, rects and intents cross it—never DOM nodes.
- Input: `mode`, `clear-hover`, `hover`, `select`, `key`, `zoom`.
- Tracking: `track`/`geometry` with revisions; `navigate`/result; `reconcile` with surviving/gone ids.
- Tree: correlated children/ancestor/search requests and results; watch/update subscriptions; `scroll-element`.
- Health: `ready`, `ping`/`pong`; nonfatal `page-error` or fatal `agent-error`.
- Instance/revision/request ids reject stale replies. Navigation replaces one preview; hashes retain it.
- Missing agent: 10s deadline. Tree request: 3s. Retry starts a fresh region generation; cancelled/obsolete work is silent.
- Ignore unrelated public-window traffic; malformed actual protocol messages fail their owner.

Exact payloads: [shared/protocol.ts](shared/protocol.ts).

## Ambiguities and decisions

- Match uniquely: node reference, key, id, then strict/digit-relaxed signatures. Never use indexes; ambiguity means gone.
- Search matches names case-insensitively, including unloaded branches. Clear restores literal pre-search expansion.
- Names prefer `data-name`, then tag + first class/id, then tag.
- Page errors report per preview; Details 404 is normal absence.
- Clipping includes overflow ancestors. Live position uses document coordinates.
- Topmost hit wins; covered elements remain reachable through Layers/keyboard.
- Interact retains native Enter/Tab and hidden selection. Escape clears viewer/host ranges, not iframe text ranges.
- Iframe `load` cannot prove agent health; the handshake/deadline does.

## Verification

```bash
npm run typecheck
npm run build
npm test
npx playwright install chrome firefox
npm run test:e2e
```

34 browser-free unit checks; exactly five E2Es, each run in Chrome and Firefox:

1. Disabled controls inspect without acting.
2. Feed selection never jumps through at least five rebuilds.
3. Deep selection reveals/highlights its Layers ancestry.
4. Navigation clears only its preview, without board reload.
5. Regional failures report once; cancelled work reports nothing.

These pass locally; manual checks also cover geometry, lifecycle, theme and keyboard behavior. [Evidence](knowledge_base/progress.md).
Stop existing local servers before E2Es; the runner starts its own `npm start`.

## Where this breaks

- Identical un-keyed rebuilt siblings can lose selection. We refuse to guess.
- 24-preview motion can briefly jank; 60fps is not guaranteed.
- Firefox native scrolling can latch a nested container until another gesture.
- Chrome rounds iframe-local coordinates; fractional zoom anchors can differ by one local pixel.
- Full reload resets state. Theme does not recolour iframe pages.
- Render Free cold starts can exceed the 10s agent deadline; warming and Retry may be needed.
