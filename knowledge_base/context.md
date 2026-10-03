# Context

Read this first. It tells you what this is, how it fits together, and where to look.

## What this is

A take-home for Figr: the viewer for a design tool. 24 live iframe previews on a pan/zoom board. Users hover and select elements inside the previews; our app draws outlines, and shows a layers tree and an inspector. It is graded mainly on system design, correctness and failure handling, explained in a README and a video. The full spec is `knowledge_base/prd.md`. The original brief is `knowledge_base/reference/assignment-brief.md` (read-only; wins over the PRD if they conflict).

## The one fact that shapes everything

The previews are served from a **different origin** than our app. The host cannot read or touch their DOM. The only way in is a script we add to each page: the **agent**. It talks to the host over `postMessage`/`MessagePort`. Almost every requirement is a consequence of this.

## The three parts

```
Browser tab
├─ Host app (frontend/)          draws outlines, layers, inspector; owns all UI state
│    ▲ private MessagePort per page instance (after a `hello` handshake)
├─ <iframe> page + agent.js      the only code that can touch that page's DOM
│    (backend/pages, :4001)      hit-tests, measures, tracks changes, mints element ids
└─ API :4000                     GET /screens, GET /elements/:key (fetched by the host)
```

- The **agent** owns the real DOM nodes and the element ids. DOM nodes never leave it.
- The **host** owns everything the user sees and every piece of shared UI state.
- The **backend** is fixed. We do not change it.

## Glossary

- **Host**: our app. **Agent**: the injected in-page script. **Preview**: one iframe on the board.
- **Screen**: an entry from `/screens`. 24 screens reuse 6 pages, so identify previews by `screenId`, never by URL.
- **Region**: an isolated failure area (board, preview, layers, layers-row, details, inspector).
- **Element id**: `<instanceId>:<n>`, minted by the agent, stable across re-renders when reconciliation proves it is the same element.
- **Select / Interact mode**: the agent's overlay is on / off. See PRD D4.

## Intended repository layout

M0 establishes the build/run scaffold. Feature directories below are added as their milestones need them. If reality diverges, fix this section in the same commit.

```
AGENTS.md
knowledge_base/        context, rules, prd, milestones, progress; reference/ is read-only
backend/               FIXED. server.js, data/, pages/*.html; pages/agent.js is a committed build output
agent/src/             in-page agent (TS); bundled by esbuild into backend/pages/agent.js
shared/                protocol message types and validators, imported by both agent and host
frontend/src/
  core/                fail(), scope/guard, report.ts (port of the kit's report.js), dev log
  stores/              board, selection, layers, inspector (plain TS; React only reads)
  api/                 fetch + validation for /screens and /elements/:key
  ui/                  React components, hooks, CSS
  harness/             disposable M1 host/protocol probes; replaced in M3
frontend/e2e/          the five Playwright tests
scripts/               build and start scripts
```

## Where to look

| Question                       | Look at                                   |
| ------------------------------ | ----------------------------------------- |
| What should this do?           | `knowledge_base/prd.md` §4 (R1–R6)                  |
| What are we allowed to decide? | `knowledge_base/rules.md`, PRD §3 (fixed decisions) |
| What is the current task?      | `knowledge_base/progress.md` → `knowledge_base/milestones.md` |
| How do host and page talk?     | `shared/`, PRD D3                         |
| How are failures handled?      | `frontend/src/core/`, PRD D7              |
| Why does a page behave oddly?  | the page table in PRD §2                  |

## Commands

Names are fixed; M0 creates them.
`npm start` (production build + backend, what graders run), `npm run dev`, `npm run build`, `npm run build:agent`, `npm run typecheck`, `npm test` (unit), `npm run test:e2e`.
Install with `npm ci` (Node 18+). Both production and development hosts use **http://localhost:5173**; API is **http://localhost:4000**, and preview pages are **http://localhost:4001**. These are distinct origins. Vite 6 preserves Node 18 compatibility. Host startup fails rather than silently choosing a different port.

The app currently boots the disposable M1 harness (one 1280×800 sandboxed preview, page/mode controls and text-only protocol probes), with M2 region-owned failure fallbacks and React error boundaries. It is not the product board and is replaced in M3. `?dev` (or Vite dev mode) shows the trigger registry, total report count and latest 100 failure/report log entries. Failure state lives in `frontend/src/stores/failure-region.ts`; scopes and entry points are supplied by `frontend/src/core/`. Dedupe is by Error identity within a region retry generation; cancelled work is silent, and a live Retry is a new occurrence even if it reuses the Error. The overlay focuses only its own neutral closed-shadow surface on Select clicks so shortcuts stay inside the iframe; it never focuses page controls. Initial discovery hello targets parent with `*` because iframe navigation changes the referrer; the host authenticates the actual iframe source and page origin before transferring the private port.

`npm start` builds and serves `frontend/dist/` with Vite preview alongside the fixed backend. `npm run dev` runs Vite's development server, the backend, and the agent build watcher. `npm run build` typechecks and builds both host and agent. The 20 browser-free failure-core unit checks live in `frontend/tests/` and run via `npm test` on the Playwright runner. The five product end-to-end checks belong to `frontend/e2e/` (introduced in M10); they are not implemented yet.

## Traps specific to this project

- Four screens show the same page. Four screens on page 6 means four independent previews, four badges, four reports.
- Page 4 rebuilds its whole list every 2s. Never hold DOM nodes or indexes across a tick.
- Hash links (`#intro`) are not navigation.
- After changing `agent/` or `shared/`, run `npm run build:agent` and commit the regenerated `backend/pages/agent.js`.
- A failed API call can be a 200 with a truncated body. Validate every response.
