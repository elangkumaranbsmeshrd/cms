"""Remove accumulated automated-test residue from the employee tables.

WHY
Months of E2E and probe runs seeded employees straight into the dev database and
never cleaned up. An audit found 117 of 129 employee rows were generated: the
same handful of base names repeated with a random numeric suffix
(kavya.nair.137888@, suresh.iyer.122845@, ...), plus offboarding fixtures
("Reclaim ExitTest280753"), probe accounts, and load-test rows. Two of them had
even captured the manager@ and employee@ demo logins, so "My Profile" for those
roles showed a stranger's name.

They are visible in the product: Employee Directory, every employee picker,
every reporting-manager dropdown.

HOW — and what this script deliberately will NOT do
Deletes iteratively, attempting every candidate each pass and letting MySQL
reject anything still referenced, until a pass makes no progress. FOREIGN KEY
CHECKS STAY ON THROUGHOUT. That is the whole design: if a row cannot be deleted,
something is still pointing at it, and that is real information — not an
obstacle to switch off.

This matters here specifically, because switching them off is exactly how this
database was damaged in the first place (see scripts/orphan_audit.py). A test
employee that has accrued real payslips or approved leave will simply refuse to
delete, and refusing is the correct outcome: it keeps the dependent business
records intact and truthful rather than trading visible junk for silent orphans.

The five seeded demo employees are never candidates — they are the product's own
walkthrough accounts, created by app/seed.py.

DRY RUN by default. Pass --apply to actually delete.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import engine  # noqa: E402

# Fingerprints of generated rows. Anchored on the shapes the harnesses actually
# emit, not on guesses — every pattern below was confirmed against real rows.
RESIDUE_EMAIL = re.compile(
    r"""
    \.\d{5,}@              # kavya.nair.137888@  — a run-id suffix
  | ^reclaim\.             # offboarding "reclaim login" fixtures
  | probe                  # welcome.probe.*, leaveqa.probe*
  | ^loadtest\.            # load-test fleet
  | @loadtest\.invalid$
  | ^exporttest\.
  | ^livetest\.
  | ^agt\d
  | ^e2e[-.]
  | ^forcedchange\.
    """,
    re.I | re.X,
)

RESIDUE_NAME = re.compile(r"\bexittest|\bprobe\d|\[manual-test\]|^e2e-|out\d+$|lead\d+$", re.I)

# Never candidates, whatever they look like: app/seed.py's own demo logins.
PROTECTED_EMAILS = {
    "superadmin@meshrd.in",
    "manager@meshrd.in",
    "accountant@meshrd.in",
    "hr@meshrd.in",
    "employee@meshrd.in",
}


async def candidates(conn) -> list[tuple[str, str, str]]:
    rows = await conn.execute(text("SELECT id, email, CONCAT(first_name, ' ', COALESCE(last_name, '')) FROM employees"))
    out = []
    for emp_id, email, name in (tuple(r) for r in rows):
        if (email or "").lower() in PROTECTED_EMAILS:
            continue
        if RESIDUE_EMAIL.search(email or "") or RESIDUE_NAME.search(name or ""):
            out.append((emp_id, email, (name or "").strip()))
    return out


async def main() -> None:
    apply = "--apply" in sys.argv

    async with engine.connect() as conn:
        found = await candidates(conn)
        total = (await conn.execute(text("SELECT COUNT(*) FROM employees"))).scalar()

    print("employees: %d total, %d look like test residue" % (total, len(found)))
    for _, email, name in found[:15]:
        print("   %-46s %s" % (email, name))
    if len(found) > 15:
        print("   ... and %d more" % (len(found) - 15))

    if not apply:
        print("\nDRY RUN — pass --apply to delete. Nothing was changed.")
        await engine.dispose()
        return

    remaining = {e[0]: e for e in found}
    deleted = 0

    # Iterate: each pass tries every survivor. A row whose dependents were
    # removed by an earlier pass becomes deletable on a later one, so this
    # converges without anyone hand-writing a dependency order.
    while True:
        progressed = False
        for emp_id in list(remaining):
            try:
                async with engine.begin() as conn:
                    # These two are created automatically with every employee and
                    # carry no business meaning on their own, so they go with the
                    # row rather than blocking it.
                    await conn.execute(text("DELETE FROM leave_balances WHERE employee_id = :i"), {"i": emp_id})
                    await conn.execute(
                        text("DELETE FROM onboarding_checklist_items WHERE employee_id = :i"), {"i": emp_id}
                    )
                    await conn.execute(text("UPDATE employees SET reporting_manager_id = NULL WHERE id = :i"), {"i": emp_id})
                    await conn.execute(text("DELETE FROM employees WHERE id = :i"), {"i": emp_id})
                del remaining[emp_id]
                deleted += 1
                progressed = True
            except Exception:
                # Still referenced by something real. Correct outcome — leave it.
                continue
        if not progressed:
            break

    print("\ndeleted %d; %d refused (still referenced by real records)" % (deleted, len(remaining)))
    for emp_id, email, name in remaining.values():
        print("   kept: %-46s %s" % (email, name))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
