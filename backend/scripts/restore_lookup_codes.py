"""Restore the `code` values on the nine lookup tables migration 0011 added.

WHAT HAPPENED
Migration 0011 adds a `code` column to nine Masters lookup tables. Its
downgrade() DROPS that column — which is correct for a downgrade, and
irreversible for the data in it. Something ran alembic down and back up on the
dev database; the schema came back intact at 0017/138 tables, and every one of
those nine columns came back empty.

The result is visible on nine Masters screens at once: the Code column renders
as em dashes, and search-by-code matches nothing, because there is nothing to
match. Nothing is structurally broken, so no test caught it.

WHY A TARGETED RESTORE RATHER THAN A FULL ONE
backend/backups/pre_login_purge_*.sql is a complete 0017 dump taken minutes
before the cycle, so it holds every lost value. Restoring the whole dump would
also undo everything done since — including the deliberate residue purge that
removed ~40 generated employee rows and disabled their logins. Putting those
back to recover a handful of short codes would trade one real fix for another.

So this reads ONLY the (id, code) pairs out of the dump and writes ONLY the
code column, matched by primary key. A row whose id is no longer present is
skipped rather than re-created: if it was deliberately deleted, it stays
deleted. A row that already has a code is left alone, so this is safe to re-run
and cannot overwrite a value someone has since set by hand.

USAGE (from backend/):
    .venv\\Scripts\\python.exe scripts\\restore_lookup_codes.py                 # report
    .venv\\Scripts\\python.exe scripts\\restore_lookup_codes.py --apply         # write
    .venv\\Scripts\\python.exe scripts\\restore_lookup_codes.py --dump <path>   # another dump
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.db import engine  # noqa: E402

# The nine tables migration 0011 touches. departments is deliberately absent —
# its code column predates 0011 and survived.
TABLES = [
    "payment_modes",
    "designations",
    "employment_types",
    "service_categories",
    "units_of_measure",
    "ticket_categories",
    "customer_statuses",
    "customer_sources",
    "asset_categories",
]

DEFAULT_DUMP = Path(__file__).resolve().parent.parent / "backups" / "pre_login_purge_20260908T223131Z.sql"


def split_values(blob: str) -> list[list[str]]:
    """Split a mysqldump VALUES blob into rows of raw column tokens.

    Hand-written rather than regex-per-row because a value can legitimately
    contain a comma or a bracket inside quotes — a naive split corrupts exactly
    the rows with the most interesting data in them.
    """
    rows: list[list[str]] = []
    current: list[str] = []
    token = ""
    in_string = False
    escaped = False
    depth = 0

    for ch in blob:
        if in_string:
            token += ch
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == "'":
                in_string = False
            continue
        if ch == "'":
            in_string = True
            token += ch
        elif ch == "(":
            depth += 1
            if depth == 1:
                current, token = [], ""
            else:
                token += ch
        elif ch == ")":
            depth -= 1
            if depth == 0:
                current.append(token.strip())
                rows.append(current)
                token = ""
            else:
                token += ch
        elif ch == "," and depth == 1:
            current.append(token.strip())
            token = ""
        elif depth >= 1:
            token += ch
    return rows


def unquote(tok: str) -> str | None:
    tok = tok.strip()
    if tok == "NULL":
        return None
    if tok.startswith("'") and tok.endswith("'"):
        return tok[1:-1].replace("\\'", "'").replace("\\\\", "\\")
    return tok


def codes_from_dump(sql: str, table: str) -> dict[str, str]:
    """(id -> code) for one table, using the dump's own CREATE TABLE to find
    which position the code column sits at. mysqldump writes positional INSERTs,
    so the column order must be read, never assumed."""
    create = re.search(r"CREATE TABLE `%s`\s*\((.*?)\n\) ENGINE=" % re.escape(table), sql, re.S)
    if not create:
        return {}
    columns = [m.group(1) for m in re.finditer(r"^\s*`([A-Za-z0-9_]+)`\s", create.group(1), re.M)]
    if "id" not in columns or "code" not in columns:
        return {}
    id_at, code_at = columns.index("id"), columns.index("code")

    out: dict[str, str] = {}
    for insert in re.finditer(r"INSERT INTO `%s` VALUES (.*?);\n" % re.escape(table), sql, re.S):
        for row in split_values(insert.group(1)):
            if len(row) <= max(id_at, code_at):
                continue
            row_id, code = unquote(row[id_at]), unquote(row[code_at])
            if row_id and code:
                out[row_id] = code
    return out


async def main() -> None:
    apply = "--apply" in sys.argv
    dump_path = Path(sys.argv[sys.argv.index("--dump") + 1]) if "--dump" in sys.argv else DEFAULT_DUMP

    if not dump_path.exists():
        print("dump not found: %s" % dump_path)
        sys.exit(1)
    print("reading %s" % dump_path.name)
    sql = dump_path.read_text(encoding="utf-8", errors="ignore")

    total_missing = total_restorable = 0

    for table in TABLES:
        wanted = codes_from_dump(sql, table)
        async with engine.connect() as conn:
            live = {
                r[0]: r[1]
                for r in (await conn.execute(text("SELECT id, code FROM `%s`" % table))).all()
            }

        blank = {rid for rid, code in live.items() if not code}
        restorable = {rid: wanted[rid] for rid in blank if rid in wanted}
        unknown = blank - set(restorable)

        total_missing += len(blank)
        total_restorable += len(restorable)
        note = "" if not unknown else "   (%d row(s) not in the dump — left as-is)" % len(unknown)
        print(
            "  %-22s %2d rows, %2d blank, %2d restorable%s"
            % (table, len(live), len(blank), len(restorable), note)
        )

        if apply and restorable:
            async with engine.begin() as conn:
                for row_id, code in restorable.items():
                    # `code IS NULL` in the WHERE so a concurrently-set value is
                    # never clobbered — this stays safe to re-run.
                    await conn.execute(
                        text("UPDATE `%s` SET code = :c WHERE id = :i AND code IS NULL" % table),
                        {"c": code, "i": row_id},
                    )

    print()
    if apply:
        print("restored %d of %d blank codes." % (total_restorable, total_missing))
    else:
        print("%d blank codes, %d recoverable from this dump." % (total_missing, total_restorable))
        print("DRY RUN — pass --apply to write. Nothing was changed.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
