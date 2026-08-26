"""Remove the test records my probe/fix agents created on 2026-08-26.

Deletes iteratively rather than in a hand-written dependency order: attempt
every table each pass, let MySQL reject anything still referenced, repeat until
a pass makes no progress. Foreign key checks stay ON throughout -- if a row
cannot be deleted, that is real information (something I am keeping still
points at it), not an obstacle to switch off.

DRY RUN by default. Pass --apply to actually delete.
"""
import subprocess
import sys

DB = "meshrd_cms"
TODAY = "2026-08-26"

# Created today, but deliberately NOT deleted:
KEEP = {
    # Real Meshrd data ("Meshrd Technologies Private Limited", real GSTIN).
    # The table was genuinely empty before; filling it was a fix, not pollution.
    "company_profile",
    # Per-document-type counters. Deleting them rewinds numbering and future
    # documents would collide with codes already issued.
    "document_number_sequences",
    # Audit trail of password changes. Deleting audit history is worse than
    # leaving five rows behind.
    "password_history",
    # Platform template data, repopulated by seed rather than by a test.
    "email_templates",
    # Financial years are structural; other rows reference them by id and a
    # dangling FY is more harmful than an unused one.
    "financial_years",
}


def sql(q: str) -> str:
    p = subprocess.run(
        ["docker", "exec", "meshrd_mysql", "mysql", "-uroot", "-proot_dev_password",
         DB, "-N", "-B", "-e", q],
        capture_output=True, text=True,
    )
    if p.returncode != 0:
        return "ERR:" + (p.stderr or "").strip().replace("\n", " ")[:160]
    return p.stdout.strip()


def tables_with_today_rows() -> dict[str, int]:
    names = sql(
        "SELECT TABLE_NAME FROM information_schema.COLUMNS "
        f"WHERE TABLE_SCHEMA='{DB}' AND COLUMN_NAME='created_at' ORDER BY TABLE_NAME"
    ).splitlines()
    out = {}
    for t in [n.strip() for n in names if n.strip()]:
        if t in KEEP:
            continue
        n = sql(f"SELECT COUNT(*) FROM `{t}` WHERE DATE(created_at)='{TODAY}'")
        if n.isdigit() and int(n) > 0:
            out[t] = int(n)
    return out


def main() -> int:
    apply = "--apply" in sys.argv
    targets = tables_with_today_rows()
    total = sum(targets.values())
    print(f"{len(targets)} tables hold {total} rows created {TODAY} (excluding {len(KEEP)} kept tables)")
    if not apply:
        for t, n in sorted(targets.items(), key=lambda kv: -kv[1]):
            print(f"  {n:5}  {t}")
        print("\nDRY RUN -- re-run with --apply to delete.")
        return 0

    remaining = dict(targets)
    deleted_total = 0
    for pass_no in range(1, 12):
        progress = 0
        for t in list(remaining):
            before = remaining[t]
            r = sql(f"DELETE FROM `{t}` WHERE DATE(created_at)='{TODAY}'")
            if r.startswith("ERR:"):
                continue  # still referenced; retry next pass
            left = sql(f"SELECT COUNT(*) FROM `{t}` WHERE DATE(created_at)='{TODAY}'")
            left_n = int(left) if left.isdigit() else before
            progress += before - left_n
            deleted_total += before - left_n
            if left_n == 0:
                del remaining[t]
            else:
                remaining[t] = left_n
        print(f"  pass {pass_no}: deleted {progress}, {len(remaining)} tables still blocked")
        if progress == 0:
            break

    print(f"\nDeleted {deleted_total} rows.")
    if remaining:
        print("STILL BLOCKED (something being kept references these):")
        for t, n in sorted(remaining.items(), key=lambda kv: -kv[1]):
            print(f"  {n:5}  {t}")
    return 0


raise SystemExit(main())
