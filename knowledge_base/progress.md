# Progress

Update at the start and end of every milestone, and whenever a decision, gate or limitation appears. Keep entries short and factual.

## Now
- **Current milestone:** M0 (in progress)
- **Next action:** scaffold and verify the production build/run pipeline against the imported kit

## Milestones
| ID | Name | Status | Verified (what, when) |
|---|---|---|---|
| M0 | Scaffold and baseline | in progress | Untouched kit imported from `/home/prashantsingh/prashant_workspace/gigs/figr`; `baseline` tags commit `c745ebd`. |
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
