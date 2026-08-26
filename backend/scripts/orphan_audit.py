"""Audit every foreign key in the schema for orphans, and optionally repair them.

WHY THIS EXISTS
scripts/wipe_and_reseed_masters.py disables FOREIGN_KEY_CHECKS to wipe the 33
Masters tables (see its wipe(), "SET FOREIGN_KEY_CHECKS=0"). That is the only
way to delete a parent table whose children still reference it — but nothing
repaired the children afterwards, so every row that pointed at a wiped Masters
row was left pointing at an id that no longer exists.

MySQL will not let you CREATE such a row, so the damage is invisible to the
application: inserts keep working, constraints look healthy in the schema, and
the only symptom is at read time. The frontend surfaced it as a raw UUID in the
Department column of the Employee Directory, because ref-data.service.ts used to
fall back to printing the id it could not resolve.

An audit found ~30 foreign keys across the schema in this state on the dev
database, including all 111 employees that existed at the time.

WHAT AN ORPHAN IS HERE
A row whose FK column is NOT NULL but whose referenced parent row is gone.

USAGE (from backend/):
    .venv\\Scripts\\python.exe scripts\\orphan_audit.py              # report
    .venv\\Scripts\\python.exe scripts\\orphan_audit.py --repair     # null out what it can

--repair only ever sets NULLABLE orphaned columns to NULL, which is the honest
representation of "this reference is gone". It will not touch a NOT NULL column,
because there is no correct value to invent — those need a decision about the
row itself, and the report says so explicitly.

Exit code is 1 when orphans remain, so this can gate a script or a pipeline.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import engine  # noqa: E402

FK_QUERY = """
    SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, COLUMN_NAME
"""

NULLABILITY_QUERY = """
    SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
"""


async def audit(repair: bool = False) -> int:
    async with engine.connect() as conn:
        fks = [tuple(r) for r in await conn.execute(text(FK_QUERY))]
        nullable = {
            (t, c): (yn == "YES") for t, c, yn in (tuple(r) for r in await conn.execute(text(NULLABILITY_QUERY)))
        }

        print("declared foreign keys: %d" % len(fks))

        findings = []
        for child_t, child_c, parent_t, parent_c in fks:
            count = (
                await conn.execute(
                    text(
                        "SELECT COUNT(*) FROM `%s` c LEFT JOIN `%s` p ON c.`%s` = p.`%s` "
                        "WHERE c.`%s` IS NOT NULL AND p.`%s` IS NULL"
                        % (child_t, parent_t, child_c, parent_c, child_c, parent_c)
                    )
                )
            ).scalar()
            if count:
                findings.append((child_t, child_c, parent_t, parent_c, count, nullable.get((child_t, child_c), False)))

    if not findings:
        print("\nNo orphans. Every foreign key resolves to a live row.")
        return 0

    repairable = [f for f in findings if f[5]]
    blocked = [f for f in findings if not f[5]]

    print("\nORPHANS FOUND — %d foreign keys affected, %d rows total:" % (len(findings), sum(f[4] for f in findings)))
    for child_t, child_c, parent_t, _, count, is_nullable in findings:
        print(
            "  %-34s %-32s -> %-24s %6d rows   %s"
            % (child_t, child_c, parent_t, count, "nullable" if is_nullable else "NOT NULL")
        )

    if repair and repairable:
        print("\nRepairing nullable columns...")
        for child_t, child_c, parent_t, parent_c, count, _ in repairable:
            async with engine.begin() as conn:
                result = await conn.execute(
                    text(
                        "UPDATE `%s` c LEFT JOIN `%s` p ON c.`%s` = p.`%s` SET c.`%s` = NULL "
                        "WHERE c.`%s` IS NOT NULL AND p.`%s` IS NULL"
                        % (child_t, parent_t, child_c, parent_c, child_c, child_c, parent_c)
                    )
                )
                print("  %-34s %-32s -> nulled %d rows" % (child_t, child_c, result.rowcount))

    if blocked:
        print(
            "\n%d foreign key(s) are NOT NULL and cannot be repaired automatically — there is no correct\n"
            "value to invent. Each needs a decision about the rows themselves: delete them, or recreate\n"
            "the parent rows they point at." % len(blocked)
        )
        for child_t, child_c, parent_t, _, count, _ in blocked:
            print("  %-34s %-32s -> %-24s %6d rows" % (child_t, child_c, parent_t, count))

    return 1


async def main() -> None:
    code = await audit(repair="--repair" in sys.argv)
    await engine.dispose()
    sys.exit(code)


if __name__ == "__main__":
    asyncio.run(main())
