# Rules

Non-negotiable. They apply every time, to every change. If a rule blocks you, stop and ask; do not work around it.

## 1. Authority

1. `knowledge_base/prd.md` decides what gets built. This file decides how. Skills, library docs and habits never override either.
2. If the PRD is silent, ambiguous or self-contradictory, stop and ask. Do not fill the gap yourself.
3. Changing the PRD is a deliberate act that the owner approves. Log it in `progress.md`.

## 2. Decision rules

When a choice exists (design, library, structure, behaviour), decide like this.

**Criteria, in precedence order** (a higher one wins a conflict; all should still be satisfied where possible):

1. Product-goal alignment: is it in the PRD? If not, don't build it.
2. Correctness
3. Security
4. Reliability
5. Performance
6. UX
7. DX
8. Observability
9. Maintainability and future compatibility

**Procedure:**

1. Check the PRD. Not required there → don't do it.
2. Consider at most two or three options. Pick the simplest one that satisfies every criterion; between equals, fewer moving parts and fewer dependencies.
3. Prefer reliable over elegant. Boring, explicit and testable beats clever.
4. If the choice changes a PRD `D*` decision, the protocol shape, or adds a dependency: stop, write it in the `progress.md` decision log (what, why, what was rejected), and ask.
5. When unsure whether something is correct, don't guess. Make it fail visibly or ask.

**Over-engineering is a defect:**

- No code without a PRD line behind it.
- No abstraction before its second real use. Exception: the core modules the PRD names (transport, identity, failure core, tree state).
- No flags, options, config or extension points nobody asked for.
- Validate every untrusted boundary (agent messages, API bodies, page-provided strings). Do not add defensive code for states that cannot occur.

## 3. Architecture invariants

1. After the handshake, all host↔agent traffic goes over the private port. The host checks `event.source` and the page origin on `hello`. Every message is validated by shape at the boundary; invalid messages are failures, not crashes.
2. DOM nodes never cross the boundary. Only agent-minted element ids do.
3. Never identify or match elements by index. A match must be unique; ambiguity means gone.
4. A preview is identified by `screenId`, never by URL.
5. `report()` is called only from `fail()`. Every entry point (handler, timer, rAF, response, render) is wrapped so its region is known. Cancelled or stale work is silent.
6. Each piece of shared state has one owner (a store). React components read; only a store's own actions mutate. The agent sends intents, never state.
7. Page-provided strings (names, text, error messages) are rendered as text only. No `dangerouslySetInnerHTML`, no `innerHTML` with page data.
8. The agent must never break the page: it catches its own exceptions and sends them to the host as a preview-region failure, does not touch the page DOM beyond its overlay, and does not overwrite page globals.
9. Do not modify `backend/server.js`, `backend/data/`, or page HTML beyond the one script tag. Check with `git diff baseline -- backend/server.js backend/data backend/pages`.
10. Every region and key control has a stable `data-testid`.

## 4. Code rules

- TypeScript `strict`. No `any` or `@ts-ignore` without a one-line reason in the file header or an owner-approved log entry.
- Dependencies are exactly the PRD D11 list. Nothing else without a logged reason.
- No `console.log` in committed code except through the dev log. No commented-out code. No secrets (there should be none).
- Pan/zoom and rect updates never go through per-event React state; they go through rAF-batched stores.
- The agent polls only tracked elements (hover + selection). No full-DOM scans on a timer.

## 5. Comment rules

Applies to every new or materially changed hand-authored file. No repo-wide comment churn.

**Excluded:** generated output (`backend/pages/agent.js`, `dist/`), lockfiles, JSON, `knowledge_base/reference/`, the fixed page HTML.

**All covered files:** a concise header comment at the top (before imports) saying what the file owns, coordinates, validates or exposes, and what it deliberately does not own. Keep it current. Do not restate the filename or list every symbol.

**Core code** (`agent/`, `shared/`, `frontend/src/core`, `frontend/src/stores`, `frontend/src/api`, `scripts/`, tests): a concise doc comment above every function, method, callback, test and hook.

- Explain purpose in domain terms. Mention inputs, outputs, side effects, invariants or failure behaviour only when meaningful. Don't restate the name or the type signature.
- Exempt: one-expression inline callbacks passed to array or promise methods.
- If a non-trivial anonymous callback can't be documented clearly, extract a named helper.
- Inline comments only for non-obvious intent, ordering, invariants, security constraints, concurrency, compatibility workarounds, or why a simpler approach is unsafe. Put them at phase boundaries, not on every statement. Fix unclear code instead of explaining it.
- Remove stale, redundant or implementation-narrating comments. No TODO without an owner.

**UI code** (`frontend/src/ui/`, React components, hooks, CSS): header comment only. No function-level or inline comments. Carry rationale in names, small components, types and tests.

A comment must add what the code can't say on its own, stay accurate, and contain no secrets or sensitive payloads. Reject comments that repeat syntax, drift from behaviour, or add noise.

## 6. Verification

1. "Done" means the milestone's "Done when" is true, observed in a real browser (use `agent-browser` for Chrome; the Playwright runner for Firefox). Reading the code is not verification.
2. Before marking a milestone done: `npm run typecheck`, `npm run build` and the unit tests pass, and `git status` is clean after `npm run build:agent`.
3. Unit tests cover pure core logic only (failure core, reconciliation, tree state) and run on the Playwright test runner without a browser. No extra test dependency. End-to-end tests are exactly the five in PRD §8.
4. Never weaken, skip or delete a test to make it pass.
5. Record what you checked and what you saw in `progress.md`.

## 7. Process

1. One milestone at a time, in order. Update `progress.md` when you start and when you finish.
2. Small commits, prefixed with the milestone: `M4: clip outlines to preview bounds`.
3. Do not commit unrelated cleanup alongside feature work.
4. When you find a limitation, a bug you can't fix, or a behaviour you chose, add it to `progress.md` right away. The README's "where this breaks" is built from that list, and it must be honest.
