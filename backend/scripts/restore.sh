#!/usr/bin/env bash
# Restores one backup produced by backup.sh. Restores the DATABASE into a
# TARGET database name (default: a *_restore_test suffix, never the live DB
# by accident) and the file tree into a target directory — this is what
# restore_drill.sh uses to prove the mechanism without touching live data;
# a real disaster-recovery run would instead pass the real target names via
# TARGET_DB_NAME / TARGET_STORAGE_DIR.
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup-dir> [target-db-name] [target-storage-dir]" >&2
    exit 1
fi

BACKUP_DIR="$1"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-root_dev_password}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-meshrd_mysql}"
TARGET_DB_NAME="${2:-${TARGET_DB_NAME:-meshrd_cms_restore_test}}"
TARGET_STORAGE_DIR="${3:-${TARGET_STORAGE_DIR:-/tmp/meshrd_restore_test_storage}}"
ENC_KEY="${BACKUP_ENCRYPTION_KEY:-}"

if [ ! -d "$BACKUP_DIR" ]; then
    echo "FATAL: backup dir '$BACKUP_DIR' not found" >&2
    exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DB_DUMP="$BACKUP_DIR/db.sql"
FILES_TAR="$BACKUP_DIR/files.tar.gz"
if [ -f "$BACKUP_DIR/db.sql.enc" ]; then
    if [ -z "$ENC_KEY" ]; then
        echo "FATAL: backup is encrypted but BACKUP_ENCRYPTION_KEY is not set" >&2
        exit 1
    fi
    echo "==> Decrypting..."
    openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$ENC_KEY" -in "$BACKUP_DIR/db.sql.enc" -out "$WORK/db.sql"
    openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$ENC_KEY" -in "$BACKUP_DIR/files.tar.gz.enc" -out "$WORK/files.tar.gz"
    DB_DUMP="$WORK/db.sql"
    FILES_TAR="$WORK/files.tar.gz"
fi

run_sql() {
    if command -v mysql >/dev/null 2>&1; then
        mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$@"
    else
        docker exec -i "$DOCKER_CONTAINER" mysql -u "$DB_USER" -p"$DB_PASSWORD" "$@"
    fi
}

echo "==> Creating target database '$TARGET_DB_NAME' (dropped first if it already exists)..."
run_sql -e "DROP DATABASE IF EXISTS \`$TARGET_DB_NAME\`; CREATE DATABASE \`$TARGET_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

echo "==> Restoring DB dump into '$TARGET_DB_NAME'..."
if command -v mysql >/dev/null 2>&1; then
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$TARGET_DB_NAME" < "$DB_DUMP"
else
    docker exec -i "$DOCKER_CONTAINER" mysql -u "$DB_USER" -p"$DB_PASSWORD" "$TARGET_DB_NAME" < "$DB_DUMP"
fi

echo "==> Restoring file tree into '$TARGET_STORAGE_DIR'..."
rm -rf "$TARGET_STORAGE_DIR"
mkdir -p "$TARGET_STORAGE_DIR"
tar -xzf "$FILES_TAR" -C "$TARGET_STORAGE_DIR" --strip-components=1 2>/dev/null || true

echo "==> Restore complete: DB='$TARGET_DB_NAME', files='$TARGET_STORAGE_DIR'"
