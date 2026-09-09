"""Remove automated-test residue from the Masters lookup tables.

WHY THIS IS SEPARATE FROM purge_test_residue.py
That script owns the employee tables and the logins attached to them, which is
its own careful problem (a deleted employee must not strand an enabled login).
Masters residue is a different shape: no logins, no cascade of business records,
but a much wider spread of small tables — and it is the residue a reviewer
actually SEES, because Masters screens are lists of exactly these rows.

The Taxes screen is the clearest case. Eleven of its thirteen tax heads are
rows like "E2E-Persist-Tax-1787773101063-6773-EDITED", left by persistence E2E
runs. The screen itself is correct — tabs, filters, exports, usage counts all
behave — and it still reads as broken, because every row on it is garbage.

HOW, and what it deliberately will not do
FOREIGN KEY CHECKS STAY ON. A row that something real still references simply
refuses to delete, and that refusal is the correct answer: a tax head used in a
calculation, or a department an employee sits in, is load-bearing regardless of
how it was named. Deleting it would trade visible junk for a silent orphan,
which is the exact damage scripts/orphan_audit.py exists to find.

Some rows cannot be removed at all by design — email_templates carries an
append-only DB trigger (§3.21: "An Email Template row is never deleted once a
trigger exists"). Those are reported, never forced.

Matching is conservative. A pattern here is a fingerprint the harnesses really
emit, confirmed against real rows — not a guess. "Test" alone is deliberately
NOT a pattern: "Testing Services" is a plausible real service category, and a
purge that eats real data to tidy a list is worse than the list.

DRY RUN by default. Pass --apply to delete.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import engine  # noqa: E402

# (table, the column holding the human name)
TABLES = [
    ("tax_heads", "tax_name"),
    ("departments", "name"),
    ("designations", "name"),
    ("expense_types", "name"),
    ("leave_types", "name"),
    ("asset_categories", "name"),
    ("ticket_categories", "name"),
    ("customer_sources", "name"),
    ("customer_statuses", "name"),
    ("service_categories", "name"),
    ("units_of_measure", "name"),
    ("payment_modes", "name"),
    ("insurance_plans", "plan_name"),
    ("holidays", "name"),
]

# Fingerprints the harnesses actually emit. Every one was confirmed against real
# rows before being added. Note what is NOT here: a bare "Test", which would
# match legitimate names like "Testing Services".
RESIDUE = re.compile(
    r"""
    ^E2E[-_ ]           # E2E-Persist-Tax-..., E2E_Probe
  | \bE2E-Persist\b
  | -\d{10,}            # a run-id timestamp suffix
  | \bProbe\b           # "ECTZ Probe WHT 1417", "Exit Probe342701"
  | ^QA\s               # "QA Masters Probe"
  | \[MANUAL-TEST\]
  | -EDITED$
  | ^ZZ                 # the sort-to-bottom convention every probe here used:
                        # "ZZ Live Test Sales Tax 18", "ZZTest TDS 10". Two Z's,
                        # not three — an earlier pattern looked for ^ZZZ and
                        # matched none of the ten rows actually present.
  | ^AGT\d              # agent-numbered scratch rows: "AGT2 OptOut Deduction"
  | ^ECTZ\b
  | \bLive\s+Test\b
    """,
    re.I | re.X,
)


async def main() -> None:
    apply = "--apply" in sys.argv
    grand_found = grand_deleted = 0
    refused: list[tuple[str, str, str]] = []

    for table, name_col in TABLES:
        async with engine.connect() as conn:
            try:
                rows = [
                    (r[0], r[1] or "")
                    for r in (
                        await conn.execute(text("SELECT id, `%s` FROM `%s`" % (name_col, table)))
                    ).all()
                ]
            except Exception as exc:
                print("  %-22s SKIPPED (%s)" % (table, str(exc)[:50]))
                continue

        candidates = [(rid, name) for rid, name in rows if RESIDUE.search(name)]
        if not candidates:
            print("  %-22s %3d rows, clean" % (table, len(rows)))
            continue

        grand_found += len(candidates)
        print("  %-22s %3d rows, %2d look like residue" % (table, len(rows), len(candidates)))
        for _, name in candidates[:4]:
            print("        %s" % name[:66])
        if len(candidates) > 4:
            print("        ... and %d more" % (len(candidates) - 4))

        if not apply:
            continue

        for rid, name in candidates:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text("DELETE FROM `%s` WHERE id = :i" % table), {"i": rid})
                grand_deleted += 1
            except Exception as exc:
                # Referenced by something real, or protected by a trigger. Both
                # are correct outcomes — record why, do not force it.
                reason = "referenced by a live record"
                if "trigger" in str(exc).lower() or "append" in str(exc).lower():
                    reason = "append-only by design"
                refused.append((table, name, reason))

    print()
    if not apply:
        print("%d row(s) look like residue. DRY RUN — pass --apply to delete." % grand_found)
        await engine.dispose()
        return

    print("deleted %d of %d." % (grand_deleted, grand_found))
    if refused:
        print("\n%d refused, which is the correct outcome for each:" % len(refused))
        for table, name, reason in refused:
            print("  %-20s %-44s %s" % (table, name[:44], reason))

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
