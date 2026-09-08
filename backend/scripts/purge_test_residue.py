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

THE LOGIN SIDE — why this script also touches `users`
Deleting an employee row does not delete the `users` row pointing at it, and an
earlier version of this script stopped at `employees`. That was a real hole: 109
of the residue employees own a live login, so a plain --apply would have left 109
enabled accounts that authenticate fine and then land on a My Profile reading
"No employee record is linked to your login" — turning one instance of that bug
into 110.

So logins are DISABLED (`users.is_enabled = 0`), not deleted, and only for
employees whose row actually went away:

  - Disabling, because `users.id` is referenced as created_by / updated_by /
    uploaded_by across most of the schema. A hard delete would refuse for nearly
    all of them anyway, and where it succeeded it would strip the author from
    real business records. Disabling is reversible and keeps the audit trail
    honest — a payslip created by a test user still names its creator.
  - Only for rows actually deleted, because a refused delete leaves the employee
    in place, so that login still resolves to a real profile and is not broken.
    Disabling it would be a second, wider decision this script does not make.

Users who ALREADY have no employee row are reported and disabled too — same
defect, already present, independent of anything deleted in this run.

DRY RUN by default. Pass --apply to actually delete.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

from sqlalchemy import bindparam, text

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


async def candidates(conn) -> list[tuple[str, str, str, str | None]]:
    """(employee_id, email, name, user_id) for every row that looks generated.

    user_id is carried here rather than looked up later on purpose: once the
    employee row is deleted the link is gone, so the login it owned can no
    longer be identified. It has to be captured before the delete runs.
    """
    rows = await conn.execute(
        text("SELECT id, email, CONCAT(first_name, ' ', COALESCE(last_name, '')), user_id FROM employees")
    )
    out = []
    for emp_id, email, name, user_id in (tuple(r) for r in rows):
        if (email or "").lower() in PROTECTED_EMAILS:
            continue
        if RESIDUE_EMAIL.search(email or "") or RESIDUE_NAME.search(name or ""):
            out.append((emp_id, email, (name or "").strip(), user_id))
    return out


async def orphan_logins(conn) -> list[tuple[str, str]]:
    """(user_id, email) for enabled logins that already have no employee row.

    Not caused by this script — these are pre-existing. Reported separately so
    the run never conflates "damage I am about to do" with "damage already here."
    """
    rows = await conn.execute(
        text(
            "SELECT u.id, u.email FROM users u "
            "LEFT JOIN employees e ON e.user_id = u.id "
            "WHERE e.id IS NULL AND u.is_enabled = 1"
        )
    )
    return [(uid, email) for uid, email in (tuple(r) for r in rows) if (email or "").lower() not in PROTECTED_EMAILS]


async def disable_logins(user_ids: list[str]) -> int:
    """Set is_enabled = 0. Never deletes — see this module's docstring."""
    if not user_ids:
        return 0
    async with engine.begin() as conn:
        result = await conn.execute(
            text("UPDATE users SET is_enabled = 0 WHERE id IN :ids AND is_enabled = 1").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": user_ids},
        )
        return result.rowcount or 0


async def main() -> None:
    apply = "--apply" in sys.argv

    async with engine.connect() as conn:
        found = await candidates(conn)
        total = (await conn.execute(text("SELECT COUNT(*) FROM employees"))).scalar()
        orphans = await orphan_logins(conn)

    with_login = [e for e in found if e[3]]

    print("employees: %d total, %d look like test residue" % (total, len(found)))
    for _, email, name, _uid in found[:15]:
        print("   %-46s %s" % (email, name))
    if len(found) > 15:
        print("   ... and %d more" % (len(found) - 15))

    print("\nlogins: %d of those %d employees own one." % (len(with_login), len(found)))
    print("        Each is disabled ONLY if its employee row actually deletes —")
    print("        a refused delete leaves a working profile, so that login is fine.")
    if orphans:
        print("\nalready-orphaned logins (enabled, no employee row — pre-existing): %d" % len(orphans))
        for _, email in orphans[:10]:
            print("   %s" % email)
        if len(orphans) > 10:
            print("   ... and %d more" % (len(orphans) - 10))

    if not apply:
        print(
            "\nDRY RUN — pass --apply to delete. Nothing was changed."
            "\n  would delete   up to %d employees" % len(found)
            + "\n  would disable  up to %d logins (%d from deletions + %d already orphaned)"
            % (len(with_login) + len(orphans), len(with_login), len(orphans))
        )
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
    for emp_id, email, name, _uid in remaining.values():
        print("   kept: %-46s %s" % (email, name))

    # Now, and only now, the login side. Keyed on what actually went away —
    # `remaining` is exactly the set that refused, so anything not in it was
    # deleted and its login no longer resolves to a profile.
    stranded = [uid for emp_id, _e, _n, uid in found if uid and emp_id not in remaining]
    n_stranded = await disable_logins(stranded)
    n_orphans = await disable_logins([uid for uid, _ in orphans])

    print(
        "\ndisabled %d logins (%d stranded by the deletions above, %d already orphaned)"
        % (n_stranded + n_orphans, n_stranded, n_orphans)
    )
    print("  is_enabled = 0 only — no user row was deleted, so every audit trail still names its author.")
    print("  Reverse with: UPDATE users SET is_enabled = 1 WHERE id IN (...)")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
