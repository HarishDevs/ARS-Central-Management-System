# Build execution policy: fast delivery (owner, 25 Nov 2026)

**Objective:** deliver every change as quickly as possible without compromising functionality, security, stability or code quality. Speed comes from eliminating waste, never from eliminating quality.

## 1. Analyse once
- Understand the complete requirement before implementation; identify affected files, modules, APIs, tables and dependencies.
- Check the docs and previous decisions (DEVELOPMENT-MEMORY, FLOWS, docs/qa).
- Don't repeat an audit when valid results already exist (docs/qa, NAVIGATION-AUDIT, UI QA sweep data).
- Record acceptance criteria and decisions (D-numbers) before building.

## 2. Plan for parallel execution
- Split work into independent tasks, each with explicit file ownership (one worker per file set; separate worktree, test DB and ports).
- Run independent frontend, backend, QA and documentation work concurrently; never two workers on a shared file.
- Integrate completed tasks continuously (merge into the release branch as each finishes).

## 3. Optimise development
- Reuse existing components, utilities and services (GLOBAL_COMPONENT_INVENTORY §0). No unnecessary architectural change.
- Fix root causes, no temporary workarounds. Small, independently verifiable batches.
- Reuse test environments where safe. Never modify production data.

## 4. Intelligent testing
- During implementation: only the affected tests (unit + the specs for the touched pages/features).
- After the feature: the dependent integration tests.
- Before release: full regression ONCE (unit, integration, the e2e for affected areas; the full e2e suite, every-page UIQA sweep, Firefox and WebKit only when the change is layout-wide or cross-cutting).
- Map dependencies to pick affected pages and features. Cache reliable build/test results.
- Never re-run a passed test without a code, dependency or environment change.
- Keep the known-failure registry `docs/qa/KNOWN-FAILURES.md` (test, symptom, first seen, classification, evidence); check a new failure against it before re-investigating.
- Never weaken, delete or bypass a test to get a pass.

## 5. Concurrent activities
In parallel where dependencies allow: documentation, unit tests, static analysis (typecheck, `npm run lint`), security scan, API/permission tests, frontend validation, build preparation.

## 6. Automated QA
Browser tests, screenshot comparison (`VISUAL=1`), responsive layout and accessibility checks (UIQA sweep), API and permission tests, production build verification; reuse browser sessions and fixtures.

## 7. GitHub release
- Isolated branches or worktrees; logically grouped commits.
- Verify migrations (every trigger block `-- @optional`) and the start script.
- Final regression and security checks; verify version and tag (tag = HEAD); verify origin/main hasn't moved unexpectedly (fast-forward only).
- Push only after every gate passes (chained commands).

## 8. Documentation (alongside the work)
User Guide, in-app Help, release notes, DEVELOPMENT-MEMORY, PLAN-CHECKLIST, FLOWS, Privacy and Terms when required (STRICT general-pages rule in CLAUDE.md still applies).

## 9. Build monitoring
Keep a live execution report per build in `docs/ops/build-status/<build-id>.md`, updated at each stage change: build ID, current stage, completed, pending, running tests, failed tests, known existing failures, blockers, time spent, estimated remaining time. Status answers to the owner come from it.

## 10. Non-negotiable
- Never claim a test passed unless it actually ran and passed.
- Never call the app production-ready on a successful compile alone.
- Never overwrite another build's changes. Never expose secrets.
- Never deploy to production without explicit authorisation (the owner publishes on GoDaddy).
- Preserve existing functionality.
