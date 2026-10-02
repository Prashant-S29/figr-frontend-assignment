# AGENTS

Project: Figr Viewer. A board of cross-origin iframe previews with hover/select outlines, a layers panel and an inspector. We build it from scratch against a fixed backend.

## Read in this order

1. `knowledge_base/context.md`: what this is, how the pieces fit, where things live.
2. `knowledge_base/rules.md`: non-negotiable rules and how to make decisions.
3. `knowledge_base/prd.md`: the only source of truth for what to build.
4. `knowledge_base/milestones.md`: the order of work.
5. `knowledge_base/progress.md`: where we are right now.

## Non-negotiable

- Build only what `knowledge_base/prd.md` says. If it isn't there, don't build it. If it is unclear, ask.
- Work on one milestone at a time, in order.
- Never edit `backend/server.js`, `backend/data/`, or anything in `backend/pages/*.html` except the single `<script src="/agent.js">` tag.
- Every failure goes through `fail()`; nothing else calls `report()`.
- Never claim something works until you have run it. Evidence goes in `knowledge_base/progress.md`.

## Working loop

1. Read `knowledge_base/progress.md`, find the current milestone in `knowledge_base/milestones.md`.
2. Re-read the PRD sections it cites.
3. Build the smallest thing that satisfies "Done when".
4. Verify in a real browser. Update `knowledge_base/progress.md`. Commit.

## Stop and ask the owner when

- The PRD is silent, ambiguous or contradicts itself.
- A change would alter a PRD `D*` decision, the protocol shape, or add a dependency.
- A milestone gate fails (especially the M1 overlay gate).
- You are about to do something not listed in the PRD "because it would be nice".

## Installed skills

- `agent-browser`: use it to check behaviour in a real browser.
- `vercel-react-best-practices`: apply to React code only. It is written with Next.js in mind, so ignore anything about SSR, server components, or data-fetching libraries. `knowledge_base/prd.md` and `knowledge_base/rules.md` always win over any skill.
