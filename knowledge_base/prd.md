# PRD: Figr Viewer

Single source of truth for what we build. Nothing is built that is not in this file.
If something is unclear or missing, stop and ask; do not invent. Changes to this file are made deliberately, then logged in `progress.md`.

Upstream: this PRD is the Figr "Frontend Engineer Assignment" brief plus our decisions. If this file ever contradicts the brief's wording, the brief wins and this file gets fixed.

## 1. What we are building

The viewer for a design tool. A board shows live previews of web pages. Each preview is an `<iframe>` of a page served from a **different origin** than our app. Users point at elements inside any preview. Our app (the **host**) draws outlines and labels on top of each preview, and shows a **layers panel** and an **inspector** for the selection.

Because the pages are cross-origin, the host cannot read their DOM. All inspection happens in an **agent**: one script we add to each page, talking to the host over `postMessage`/`MessageChannel`.

Graded mainly on system design, correctness and failure handling, explained in a README and a 15-minute video. UI polish is not graded. Reliability beats elegance.

## 2. Fixed inputs (do not change)

- `backend/server.js`: API on `:4000`, pages on `:4001`. No dependencies, Node 18+. Not modified (env vars `API_PORT`, `PAGES_PORT`, `PAGES_ORIGIN` already exist).
- `backend/pages/*.html`: we may add **exactly one `<script>` tag per page and change nothing else**. Page 6-next is included.
- `frontend/report.js`: `report(error, { region, screenId, elementKey? })`. Keep the signature; port to TS if needed. `region` is one of `board | preview | layers | layers-row | details | inspector`. `screenId` is `null` for the board. `elementKey` is the element's `data-key`.
- API (every route accepts `?latency=<ms>&fail=<0..1>`; a failure is a 5xx, or a 200 with a truncated/malformed body):
  - `GET /screens` → `[{ id, name, url }]`, 24 screens reusing 6 pages. **Never identify a preview by URL; use `screenId`.**
  - `GET /elements/:key` → `{ component, description, status, owner }`; `404` if no details for that key.

| Page                 | Used by           | What it exercises                                                                                                                                    |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| page-1 Landing       | scr-01 +B/C/D     | nav hash links, `button.primary`, `#crash` button whose click throws a TypeError (Page error), `data-name`s                                          |
| page-2 Sign up       | scr-02…           | inputs, checkbox, **disabled submit button**, form (`action=page-2.html`, GET), "Log in" link to page-1 (navigation)                                 |
| page-3 Dashboard     | scr-03…           | **sticky header** over scrolling content, inline SVG icons (`fill:none`), **nested scroll area** with sticky `th`, long page                         |
| page-4 Activity feed | scr-04…           | `ul#feed` **rebuilt via innerHTML every 2s**: new item at top, max 25, `data-key="activity-N"` only on odd ids, relative-time text changes each tick |
| page-5 Settings tree | scr-05…           | 30 nested `.level` divs, each with a row of 47 leaf spans (~1,500 elements); keys `setting-1-1`, `setting-15-7`, `setting-30-1..3`                   |
| page-6 Docs          | scr-06…           | links to page-6-next, hash links (`#intro`, `#install`), an unhandled promise rejection at 4s                                                        |
| page-6-next          | (navigation only) | table, back link to page-6                                                                                                                           |

Several `data-key`s have no entry in `elements.json` (e.g. `icon-bell`, `stat-users`, `cta-crash`, `setting-15-7`, `setting-30-3`), so the 404 path occurs naturally.

## 3. Fixed technical decisions

Not up for re-litigation while building. A change needs a logged reason in `progress.md`.

- **D1 Stack:** Vite + React + TypeScript SPA. State lives in plain TS stores outside React (read via `useSyncExternalStore`). No SSR, no router, no data-fetching library, no UI kit, no CSS framework, plain CSS.
- **D2 Agent:** TypeScript bundled with esbuild into one IIFE, `backend/pages/agent.js` (committed). Each page gets `<script src="/agent.js"></script>` as the first script in `<head>`, so it runs before page scripts. The agent captures native functions it depends on (`postMessage`, `requestAnimationFrame`, `getBoundingClientRect`, etc.) at startup.
- **D3 Transport:** the agent posts `hello` to the parent; the host verifies `event.source === iframe.contentWindow` and replies with a `MessagePort` (target origin = the page origin). All later traffic uses that private port. A new `hello` replaces the port and means "page was replaced or navigated". A ping with a 10s deadline detects a hung or gone agent.
- **D4 Select mode = in-page overlay.** The agent adds a transparent fixed overlay (closed shadow root on `<html>`) that receives all pointer events, so the page receives none (no focus, link navigation, form submit, or `:hover` effects). Interact mode hides it. Targets come from `elementsFromPoint`, first non-agent element, skipping `<html>`/`<body>`. Wheel over the overlay is emulated: scroll the nearest scrollable ancestor under the pointer, chaining outward. Ctrl/Cmd+wheel is forwarded to the host and `preventDefault`ed. **Gate:** verify in Chrome and Firefox against page 2's disabled button and page 3's nested scroll area before building any host UI on top.
- **D5 Identity:** the agent mints ids (`<instanceId>:<n>`) and owns the id↔node binding. After mutations it reconciles per parent, top-down, preferring: surviving node reference, `data-key`, `id`, strict signature (tag, attributes, stable text), relaxed signature (digits stripped). Never match by index. A match must be unique; **ambiguity means "gone", never a guess.** Host, layers, selection and hover all use these ids.
- **D6 Geometry:** the agent reports iframe-local rects (clipped by overflow ancestors and the preview) for tracked elements only (hover + selection), polled each animation frame. The host applies pan/zoom itself and draws in a screen-space layer, so thickness and label size are constant at any zoom. Pan/zoom updates are rAF-batched in a store, not per-wheel React state.
- **D7 Failures:** one `fail(region, error, ctx)` is the only path to `report()`, deduped per error object. Every async operation runs under a scope with an abort signal and an alive flag; cancelled or stale means silent. Every entry point (message handler, timer, click/key, rAF, response) is wrapped so its region is known. Error boundaries and global `error`/`unhandledrejection` handlers feed the same `fail()`.
- **D8 Tree state:** each row is exactly one of `Loading | Loaded(children) | Error`, replaced whole, never appended. One in-flight request per row (re-expanding reuses it). Search is a derived view; it never mutates expanded state. Fixed row height, no virtualization.
- **D9 Iframes:** `sandbox="allow-scripts allow-same-origin allow-forms"`, no top-navigation, no modals.
- **D10 Run mode:** `npm start` serves a **production build** plus the backend. `npm run dev` is for development only.
- **D11 Dependencies:** `react`, `react-dom`, `vite`, `esbuild`, `typescript`, `concurrently`, `@playwright/test` (dev). Anything else needs a logged reason.

## 4. Requirements

Terms. **Preview**: one iframe on the board. **Element**: any element in a preview's page except `<html>` and `<body>`. **Active preview**: the preview last clicked in Select mode (layers + inspector show it). **Name**: `data-name` if present, else tag + first class (`button.primary`), else tag + id (`div#hero`), else tag alone (lowercase tag).

### R1 Board

- 1.1 Fetch `GET /screens`; show every screen as a 1280×800 preview in a grid, screen name above.
- 1.2 Dragging empty board space pans. Wheel over empty board space pans.
- 1.3 Ctrl/Cmd+wheel zooms 25%–400%, centred on the pointer, **anywhere, including over a preview**.
- 1.4 Wheel over a preview scrolls that page, in both modes.
- 1.5 Mode toggle in the toolbar plus keys **V** (Select, default) and **I** (Interact).
  - Select: clicks select elements and never reach the page (links don't navigate, buttons don't act, inputs don't focus, forms don't submit).
  - Interact: page behaves normally, no outlines drawn. Selection is kept but hidden and reappears on return to Select if the elements still exist. The layers panel keeps updating as the page changes.

### R2 Hover (Select mode)

- 2.1 Pointer over an element draws a **1px outline** exactly on its box, with a label showing its name.
- 2.2 Only one element on the whole board is hovered at a time.
- 2.3 Hover clears when the pointer leaves the preview or window, or when the board starts panning/zooming.
- 2.4 **Every** element can be hovered and selected: disabled buttons/inputs, images, SVG, elements under a sticky header.
- 2.5 `<html>`/`<body>` is never hovered; pointing at background shows nothing.

### R3 Selection

- 3.1 Click selects the element under the pointer: **2px outline**, different colour from hover, plus a label.
- 3.2 Shift+click adds/removes an element in the same preview. Shift+click in a different preview **replaces** the selection with that element.
- 3.3 **Escape**, clicking page background, or clicking empty board space clears the selection.
- 3.4 Outlines and labels: stay glued to their element through pan, zoom, scrolling inside the page (including inner scroll areas), window resize, and the element changing size or moving; stay 1px/2px with constant label size at every zoom; are clipped to the preview's edges (an element scrolled fully out of view has no outline but stays selected); put the label **below** the element when there is no room above inside the preview.
- 3.5 Keyboard, acting on the **most recently selected** element and replacing the selection with the result: **Enter** selects the first child; **Shift+Enter** selects the parent (nothing at top level, i.e. children of `<body>`); **Tab / Shift+Tab** select next/previous sibling, wrapping.
- 3.6 **All shortcuts** (V, I, Escape, Enter, Tab, …) work even right after the user clicked inside a preview.
- 3.7 When the page re-renders itself: a selected element that still exists stays selected (even if nodes were rebuilt or siblings inserted before it); one that no longer exists is removed from the selection; if nothing remains, the inspector says **"This element no longer exists"** until the next selection. **The selection must never jump to a different element.**
- 3.8 When a page navigates (link followed in Interact mode): that preview's selection clears, Select mode works on the new page with no board reload, the layers panel shows the new page. Hash-only changes are not navigation.

### R4 Layers panel

- 4.1 Shows the element tree of the active preview. With no active preview: **"Click something in a preview"**.
- 4.2 Row = indentation + name + chevron if it has children. Top-level rows are the children of `<body>`.
- 4.3 Children load on first expand. While loading the row shows a loading state. No answer in **3s** → row shows **"Couldn't load"** with a retry on that row only. Collapse/re-expand (including mid-load) never produces duplicate or missing children.
- 4.4 Hover sync both ways. Hovering a row draws the hover outline on that element. Hovering an element highlights its row; if the row is inside a collapsed parent, highlight the nearest visible ancestor row. Hover never expands anything.
- 4.5 Selection sync both ways. Clicking a row selects it. Selecting an element in the preview expands every ancestor of its row (loading as needed, many levels deep), highlights the row, and scrolls the panel to it.
- 4.6 Clicking a row whose element is out of view scrolls **only that page** to show it. The board and host page do not move.
- 4.7 Shift+click on a row adds/removes it; all selected rows are highlighted.
- 4.8 Panel focused: **↑/↓** previous/next visible row; **→** expands, or moves to first child if already expanded; **←** collapses, or moves to parent if already collapsed.
- 4.9 Expanded rows and panel scroll position are remembered **per preview**. Switching A→B→A restores A exactly, until A's page navigates or the board reloads.
- 4.10 When the page changes its own DOM, the tree updates: surviving rows keep expanded state and selection; removed rows disappear (a removed hovered row clears hover); rows the user is looking at don't jump (scroll position holds).
- 4.11 Search box: shows only rows whose name contains the text, plus their ancestors. Searches the **whole tree**, including never-loaded rows. Clearing restores exactly the expanded state from before the search. Selecting a result selects the element and keeps the search open.

### R5 Inspector

- 5.1 One element selected → two sections.
  - **Live** (from the page, updates as the element changes): name, tag, id, classes, width × height (px, rounded), position within the page, first 120 chars of text, text colour, background colour, font family, size, weight.
  - **Details** (`GET /elements/:key`): component, description, status, owner. No `data-key` → **"No details"**. A `404` → **"No details for this element"** (not an error).
- 5.2 Several selected → **"N elements"**; each Live field shows the shared value or **"Mixed"**; no Details section.
- 5.3 If the selection changes while Details load, only the latest selection's details are ever shown.

### R6 Failures

- 6.1 Regions, each isolated: the board, each preview, the layers panel, each row's child loading, the inspector's Details section (and the inspector as a whole for render errors).
- 6.2 A failure shows an error with a **Retry** button **in that region only**; everything else keeps working.
  - `GET /screens` fails → board shows the error.
  - A preview's page doesn't load, or its agent doesn't answer within **10s** → **"Couldn't connect to this preview"** on that preview only.
  - `GET /elements/:key` fails or returns bad data (non-JSON, wrong shape) → error in Details only; Live values still show.
  - Render error in the inspector → the inspector shows the error; board and layers keep working.
- 6.3 Errors inside a page show as a small **"Page error"** badge on that preview; hovering shows the message.
- 6.4 Reporting: every failure reaches `report()` **exactly once** with `{ region, screenId, elementKey? }`. A retry that fails again is a new failure. A request cancelled or replaced because the user moved on is **not** a failure: no error shown, nothing reported.
- 6.5 Where the error happens doesn't matter: drawing, click/key handlers, message handlers, timers, response arrival all yield the same region error and the same single report.
- 6.6 A response or error arriving after its region is gone changes nothing and reports nothing.
- 6.7 A **dev-only menu** triggers each failure above on demand (for the video). Visible only with `?dev` or in dev mode.

## 5. Resolved ambiguities

Also written into the README ("ambiguities" section).

1. **Search vs. ancestor expansion** (4.5 vs 4.11): selecting a result may expand ancestors while searching; clearing the search restores the literal pre-search snapshot.
2. **Page errors** (6.3): the brief doesn't say whether they reach `report()`. We report each occurrence once, `region: "preview"`, with that screen's id. Four screens on page 6 means four badges and four reports.
3. **Identical un-keyed siblings:** if an element can't be told apart from a sibling after a re-render, we treat it as gone rather than risk a jump (prefers "never jump" over "stays selected").
4. **"Out of view"** (3.4, 4.6): clipped by any scroll container or the preview, not just the viewport.
5. **V/I and other letter shortcuts** don't fire while focus is in an editable element (page input or the layers search box). Escape, Enter, Tab and the arrow keys follow R3.5/R4.8.
6. **"Position within the page"** (5.1): the element's top-left in document coordinates (rect plus page scroll), not viewport-relative.
7. **Search matching:** case-insensitive substring on the Name.
8. **Elements covered by another** (e.g. under the sticky header): hit-testing picks the topmost element at the pointer, so a fully covered element is reached via the layers panel or keyboard navigation.
9. **A failed/never-answering preview** can't be detected by iframe `load` cross-origin; the 10s agent handshake is the definition of "page doesn't load".

## 6. Non-goals

Editing pages, persistence across reload (not even viewport), auth, mobile, multi-user, SSR, theming, animations, list virtualization, internationalization, accessibility work beyond the required keyboard behaviour, any change to `server.js` or page content beyond the one script tag.

## 7. Deliverables

1. Public GitHub repo; **one command** (`npm start`) runs backend and app.
2. README: ambiguities and decisions; how state is organised (what lives where, who may change it); host↔page protocol (messages; what happens when a side is slow, gone, or replaced); **"where this breaks"** (known failures, honestly).
3. 15-minute video (2 min what/why, 8 min code walkthrough of R1–R6 running, 3 min where it breaks and next steps, 2 min AI use and where it was wrong).
4. Bonus: deployed link (app on Vercel or similar; API and pages as two services with their own HTTPS origins, `PAGES_ORIGIN` set). Never the only way to run it. Vercel + Render

## 8. Verification

Five Playwright checks, no more, and a manual pass through every R-item before the video:

1. Disabled button (page 2) can be hovered and selected; click does nothing to the page.
2. Page 4: a selection survives ≥5 re-render ticks as the same element, or becomes "no longer exists", never a different element.
3. Page 5: selecting a deep leaf expands all ancestors and highlights the row.
4. Navigation (page 2 → page 1, or page 6 → 6-next in Interact mode) clears that preview's selection and layers, with no board reload.
5. A failure injected in each region reports exactly once; a cancelled request reports nothing.
