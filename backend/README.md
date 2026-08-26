# Meshrd CMS — Backend (Phase 0 + Phase 1)

FastAPI + SQLAlchemy 2.x (async) + MySQL 8. See `../build-docs/BUILD-PROMPT.md` for
the full directive this is built against.

## What Phase 1 adds (Masters — all 21 sub-masters)

36 tables (migration `0002_masters`), live-verified against the same MySQL
8.4 container as Phase 0 — every non-obvious DB invariant (singletons,
arithmetic locks, one-Saturday-is-a-Saturday, append-only logs) was proven
with a real INSERT/UPDATE/DELETE that was expected to fail, and did.

- **The isolated tax engine** (`app/services/tax_engine.py`) — GST/percentage/
  fixed/slab (progressive + flat-by-band)/declaration-cap, split components,
  relief rules, effective dating, and historical reproduction from a frozen
  snapshot. 28 unit tests, including boundary values (exact band edges, a
  relief that would overdraw into a refund, effective-dating's inclusive
  bounds). No named tax anywhere in it.
- **15 simple lookup sub-masters** via one generic router factory
  (`app/api/v1/masters_lookup.py`) — Expense Types, Leave Types, Holidays
  (+ CSV-style bulk import), Payment Mode, Department, Designation, HSN/SAC
  Code, Service Category, Unit of Measure, Ticket Categories, Customer
  Status, Customer Source, Asset Categories, Employment Type, Insurance
  Plans.
- **5 bespoke sub-masters**: Taxes (the engine's admin surface + a live
  Calculate endpoint), Company Profile (singleton + Addresses + Number
  Prefix Rules), Bank Account (one-default guard, A009's Confirm Account
  Number), Work Week & Hours (+ Pay Cycle + Saturday Overrides), Email
  Configuration (Server Settings singleton + Templates, never deleted, only
  disabled + Recent Sends).
- **RBAC**: all 21 Masters screens seeded exactly per Masters §3.0's access
  table (verified against the live database, not just the seed script).
- **Audited and fixed**: a 6-agent Workflow independently checked the entire
  Phase 1 implementation against `01-masters-module.md`, Appendix A/B and
  ARCH-1, with every finding adversarially re-verified before being trusted.
  29 confirmed findings, all fixed: the tax-head arithmetic lock originally
  blocked every field instead of just the arithmetic ones (and made the
  spec's own mandatory rate-change sequence impossible); slab-band gap/
  overlap validation, Withholding Direction requiredness, and Tax Head
  deactivate were all missing entirely; Duplicate silently dropped relief
  rules and withholding directions; Number Prefix Rules had no seed data and
  no create endpoint; Bank Account had no edit endpoint and Manager was
  wrongly locked out entirely instead of getting the spec's read-only access;
  Email Templates had no seed data and no create endpoint, and editing
  Server Settings silently wiped the stored credential on any unrelated
  change; Holidays' locked-FY freeze and Saturday Overrides' FY-range check
  were both unenforced; Designation and HSN/SAC Code uniqueness were scoped
  narrower than the spec; GSTIN had no format check. See git history for the
  full list and the fix commits.
- **Known Phase 1 gaps, deliberate**: Company Profile's Documents tab has no
  API yet (depends on the cross-cutting file-upload endpoint, BUILD-PROMPT
  §10); Email Configuration's Send Test writes a real log row but calls no
  real SMTP/Mailgun transport (§9 wiring is Phase 6); the "Allow Accountant
  to Manage Taxes" feature-toggle upgrade path isn't wired into the resolver
  yet (Accountant is seeded at the correct default: View only); the Filters &
  Export Convention's Used/Unused filter and PDF/Excel export are deferred to
  the shared list-layer work BUILD-PROMPT §7 already scopes as its own
  concern (Search and the Status filter ARE implemented, on every one of the
  15 generic lookups); a Tax Head has no defined link to Financial Year
  locking — the spec asserts the rule but never says what "scoped to it"
  means for a head versioned by date range rather than a FY field, surfaced
  rather than silently resolved (see `0002_masters.py`'s note next to
  `tax_heads`); `work_week_policy_employees.employee_id` has no FK until
  Phase 2's migration adds it once `employees` exists.

## What Phase 0 proves

A real, running vertical slice — not scaffolding claimed to work. Every one of
these was executed and verified, not just written:

- **Migration `0001_platform_core`** runs clean against a live MySQL 8.4
  container: 16 tables, the generated-column "only one current FY" trick, the
  no-unlock trigger (A002), and the immutable `permission_change_log` triggers.
- **The four-layer RBAC engine** (`app/rbac/`) resolves a real `PermissionSet`
  from database rows, transcribed from the prototype's validated
  `app-rbac.js` policy for Masters → Financial Year.
- **The self-test rule** (BUILD-PROMPT §15: "a checker that never reports a
  problem proves nothing") — `tests/rbac/test_self_test.py` injects a
  deliberately broken permission and proves the matrix checker catches it,
  *before* trusting the same checker's clean result in `test_matrix.py`.
- **A live HTTP proof** — login, list, create (with derived Label/End Date
  per Masters §3.1), lock, re-lock rejected with the A002 message, and no
  unlock route exists at all. Employee gets a 404 (not 403) on the whole
  screen, matching Layer 1's "invisible, not greyed out" rule.

Two real bugs were found and fixed by actually running this, not by
review — see the migration file's inline comments and `ARCH-1` D0.1 for the
generated-column guard-value bug, and `app/auth/security.py` for the
passlib/bcrypt incompatibility.

## Quick start

```bash
docker compose up -d mysql
cp .env.example .env   # already done in this checkout
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

Then open `http://127.0.0.1:8000/docs` for the interactive API, or:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@meshrd.in","password":"Passw0rd!"}'
```

Seeded users (password `Passw0rd!` for both): `superadmin@meshrd.in`,
`employee@meshrd.in`.

## Tests

```bash
pytest tests/ -v
```

Runs against SQLite in-memory (fast — tests the Python resolution logic).
MySQL-specific DDL correctness (generated columns, triggers) is proven by
actually running the Alembic migration against the Docker container, not by
a test file — see the Phase 0 verification log in the parent conversation
for the exact commands and their real output.

## What's NOT done yet

Phase 0 + Phase 1 (foundation + Masters) are done. Next per
`../build-docs/BUILD-PROMPT.md` §13: **Phase 2 — Employee + Leave** (Employee
master, salary structure, attendance, documents, onboarding/offboarding,
leave + compensatory hours). Its migration must also ALTER TABLE to add the
`employees` foreign key onto `work_week_policy_employees.employee_id`,
deferred from Phase 1 — see that table's note in
`alembic/versions/0002_masters.py`.
