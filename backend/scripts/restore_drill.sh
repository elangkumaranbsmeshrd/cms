#!/usr/bin/env bash
# THE Phase 7 acceptance gate (BUILD-PROMPT.md §13): "Restore from backup
# verified." Runs backup.sh, restores into a throwaway database + directory
# (never touching the live DB), then proves the restore is faithful by
# comparing table list + per-table row counts between source and restored —
# not just "the restore command exited 0," which proves nothing about
# whether the data actually came back.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-root_dev_password}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-meshrd_mysql}"
SOURCE_DB="${DB_NAME:-meshrd_cms}"
TARGET_DB="meshrd_cms_restore_drill"

run_sql() {
    if command -v mysql >/dev/null 2>&1; then
        mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -N "$@"
    else
        docker exec -i "$DOCKER_CONTAINER" mysql -u "$DB_USER" -p"$DB_PASSWORD" -N "$@"
    fi
}

table_row_counts() {
    local db="$1"
    local tables
    tables=$(run_sql -e "SHOW TABLES FROM \`$db\`;")
    for t in $tables; do
        local count
        count=$(run_sql -e "SELECT COUNT(*) FROM \`$db\`.\`$t\`;")
        echo "$t $count"
    done | sort
}

echo "### Step 1/3 — backup"
"$SCRIPT_DIR/backup.sh"
LATEST_BACKUP="$(ls -1d "$SCRIPT_DIR/../backups"/*/ | sort | tail -1)"
echo "    using backup: $LATEST_BACKUP"

echo "### Step 2/3 — restore into scratch database '$TARGET_DB'"
"$SCRIPT_DIR/restore.sh" "$LATEST_BACKUP" "$TARGET_DB" "/tmp/meshrd_restore_drill_storage"

echo "### Step 3/3 — comparing source vs restored"
SOURCE_COUNTS="$(table_row_counts "$SOURCE_DB")"
RESTORED_COUNTS="$(table_row_counts "$TARGET_DB")"

if [ "$SOURCE_COUNTS" = "$RESTORED_COUNTS" ]; then
    echo "PASS: all tables and row counts match between '$SOURCE_DB' and '$TARGET_DB'."
    TABLE_COUNT=$(echo "$SOURCE_COUNTS" | wc -l)
    echo "      $TABLE_COUNT tables verified."
    RESULT=0
else
    echo "FAIL: mismatch between source and restored database." >&2
    diff <(echo "$SOURCE_COUNTS") <(echo "$RESTORED_COUNTS") || true
    RESULT=1
fi

echo "### Cleanup"
run_sql -e "DROP DATABASE IF EXISTS \`$TARGET_DB\`;"
rm -rf /tmp/meshrd_restore_drill_storage

exit $RESULT
