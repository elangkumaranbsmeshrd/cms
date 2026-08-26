# Pending modules — saved state (paused 2026-08-08)

Session was paused mid-pipeline to stay under usage limits. This folder holds everything needed to resume WITHOUT re-running the expensive research agents (each took ~250-300k tokens / 15-20 min).

## How to resume

For each module below: open its file in this folder, and hand its **"BUILD PROMPT"** section verbatim to a new background Agent call (`Agent` tool, `subagent_type: general-purpose`, `run_in_background: true`) — it's already written to be self-contained for an agent with zero prior context. After each one finishes, review its report and wire its routes into `frontend/src/app/app.routes.ts` and `frontend/src/app/layout/nav-registry.ts` (do this yourself, not via the agent — every brief tells the agent NOT to touch those two shared files, to avoid concurrent-edit collisions between modules).

**Recommended order**: Purchase Bill needs Invoice's `document-screen.component.ts` shared-infra extension to land FIRST (both modules extend the same shared component — building them concurrently risks a collision). Build Invoice, merge it, verify the `document` shape extension works, THEN build Purchase Bill on top of it. Everything else (Expense, Opportunity, Payroll, Tax & Compliance, Project) has no shared-infra dependency on another pending module and can run in parallel with each other.

## Status as of pause

| Module | Research | Build brief written | Files on disk | Wired into routing |
|---|---|---|---|---|
| Leave | done | — | done | **done, verified live** |
| Ticket | done | — | done | **done, `ng build` clean** |
| Asset Management | done | done | **9 files written, NOT wired** (`frontend/src/app/features/asset/`) — see `asset.md` | no |
| Invoice | done | done (`invoice.md`) | none | no |
| Expense | done | done (`expense.md`) | none | no |
| Opportunity | done | done (`opportunity.md`) | none | no |
| Payroll | done | done (`payroll.md`) | none | no |
| Tax & Compliance (Module 15) | done | done (`tax-compliance.md`) | none | no |
| Project | done | done (`project.md`) | none | no |
| Purchase Bill | done (`purchase-bill-research.md`) | not yet — hold until Invoice lands | none | no |

## Important cross-module facts to keep in mind when resuming

- **`numberrange` FilterKind** landed in `screen.types.ts` during Asset's build (before it was stopped) — check whether Asset's partial files actually include this shared-infra change (read `asset.md`'s original brief; it asked the agent to add it). If Asset's work is restarted from scratch, this still needs building — several other modules' briefs (Expense, Payroll, Project) reference it as already-available.
- **`document-screen.component.ts`** (shared) needs real extension for create-mode support, a `'file'` field type, live totals, and `ArrayColumnConfig.ref` support — both Invoice and Purchase Bill need this; see `invoice.md` §4.2 for the exact gaps. Build Invoice first, since its brief already carries the extension instructions.
- Every brief below already embeds the exact RBAC action strings, query params, and schema field names verified against the real backend source earlier this session — no need to re-research, just verify nothing has changed if significant time has passed before resuming (a quick `grep` against the cited backend files is enough, not a full re-research pass).
