# Progress

Update at the start and end of every milestone, and whenever a decision, gate or limitation appears. Keep entries short and factual.

## Now
- **Current milestone:** M1 (not started); M0 is done
- **Next action:** build the throwaway host harness and agent, then run the D4 overlay gate in Chrome and Firefox before any product UI

## Milestones
| ID | Name | Status | Verified (what, when) |
|---|---|---|---|
| M0 | Scaffold and baseline | done | 2026-10-03: fresh clone + `npm ci` + `npm start`; Chrome rendered the production shell, API returned 24 screens, all 7 pages and agent asset returned 200. Typecheck/build passed; empty unit run exited 0. Protected backend diff empty; only generated `agent.js` added under pages. |
| M1 | Agent core and D4 gate | not started | |
| M2 | Failure core | not started | |
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
- **D4 overlay gate (M1):** pending. Chrome: ___. Firefox: ___. If it fails, record the fallback here and amend PRD D4 before continuing.

## Decision log
Append only. Anything that changes a PRD `D*` item, the protocol, or adds a dependency goes here before it is built.

| # | Date | Decision | Why | Rejected | Milestone |
|---|---|---|---|---|---|
| 1 | 2026-10-03 | Unit tests run on the Playwright test runner (no browser) | PRD D11 has no unit test runner; avoids a new dependency | vitest | M2 |
| 2 | 2026-10-03 | Page errors are reported once each with `region: "preview"` | Brief is silent; badge is a failure display | badge only | M3 |
| 3 | 2026-10-03 | Owner approved `@types/react` and `@types/react-dom` as dev dependencies (D11) | React does not ship the definitions needed for strict TS | Hand-authored/incomplete React definitions | M0 |
| 4 | 2026-10-03 | Owner approved M0's pages gate allowing only generated `agent.js`; HTML stays untouched | Resolves the empty-pages-diff gate versus D2's committed bundle requirement | Deferring the committed bundle until M1 | M0 |

## Known limitations
Feeds the README "where this breaks". Add as discovered: what breaks, when, and why.

_None recorded yet._

## Open questions for the owner
_None yet._

## Session log
One line per working session: what changed, what is next.

- 2026-10-03: docs written (PRD, milestones, rules, context, progress). No code yet.
- 2026-10-03: M0 started. Imported the supplied backend, reporter and original brief unchanged; created the `baseline` tag. Owner approved React type packages and the generated-agent-only M0 pages exception.
- 2026-10-03: M0 finished. Added the strict React/Vite scaffold, TS reporter port, deterministic esbuild agent bundle, production/development commands and separate Playwright configs. Next: M1 only.

## M0 verification evidence

- Baseline: `c745ebd` imports the untouched kit from `/home/prashantsingh/prashant_workspace/gigs/figr`; original README preserved as `knowledge_base/reference/assignment-brief.md`. Scaffold commit: `268ebdf`.
- Environment: Node `v22.21.1`, npm `10.9.4`, Google Chrome `153.0.8010.47`, using `npx agent-browser` as external verification tooling (not a project dependency).
- Clean clone: `/tmp/figr-m0-clean-clone`, created with `git clone --no-hardlinks`. `npm ci` succeeded; `npm start` built the agent and production host, then served host `:5173`, API `:4000`, pages `:4001`.
- Real Chrome: `http://localhost:5173` rendered the `Figr Viewer` heading in `[data-testid="app"]`; host HTML referenced `/assets/`, not `/@vite/client`. No browser errors observed. Screenshot: `/tmp/figr-m0-production.png` (local verification artifact).
- Browser fetches: `/screens` returned 24 valid entries with 24 unique ids and 6 unique page URLs. All 7 HTML pages and `/agent.js` returned 200 from `:4001`. No HTML included the agent tag. Direct navigation to page 2 showed the original disabled submit button. This verifies delivery, not the M1 overlay gate.
- Development smoke: `npm run dev` served the shell with `/@vite/client` and the API with 24 screens. In the disposable clone only, an agent content change was reflected in the served bundle by the watcher; restoring the entry restored the identical committed bundle. A timestamp-only probe was inconclusive because unchanged generated content is not rewritten; the content-change probe verified the watcher. Both clone and working repository were clean afterwards; verification processes were stopped.
- `npm run typecheck`, `npm run build`, and `npm run build:agent` succeeded. `npm test` exited 0 with **zero tests**; unit cases start in M2 and the five product checks in M10. No feature behaviour is claimed by this run.
- `git diff baseline -- backend/server.js backend/data 'backend/pages/*.html'` was empty. `git diff --name-status baseline -- backend/pages` showed only `A backend/pages/agent.js`. Regenerating the agent left git clean.
- Scope: the host is intentionally an empty shell and the agent is an empty IIFE. No protocol, script injection, overlay, board, layers, inspector, or failure core has been implemented yet.
