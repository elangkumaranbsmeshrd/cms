#!/usr/bin/env bash
# Phase 7 Hardening (BUILD-PROMPT.md §12/§13): "Encrypted, off-box, automated
# backups of both the database and the file tree, with a restore drill."
#
# Targets the real droplet layout (MySQL co-located, app + storage/ on the
# same box) but degrades gracefully in local dev, where MySQL runs in the
# docker-compose container instead of natively — this script tries a local
# `mysqldump` first and falls back to `docker exec` against the compose
# service name, so the SAME script works in both places without a flag.
#
# Encryption: openssl AES-256-CBC with a passphrase from BACKUP_ENCRYPTION_KEY
# (never committed — same convention as CREDENTIAL_ENCRYPTION_KEY/SECRET_KEY
# in .env.example). openssl is chosen over gpg because it's present on every
# base Ubuntu droplet image with zero extra packages; gpg would need a
# recipient key generated and distributed first.
#
# Off-box upload is NOT implemented here — it needs a real destination
# (DigitalOcean Spaces / S3-compatible bucket + credentials) that doesn't
# exist until the droplet itself does. The LAST line of this script is a
# clearly-marked placeholder for that step — wire in `s3cmd`/`rclone`/`doctl`
# once a real bucket exists; everything before it (dump, tar, encrypt) is
# real and runs today.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$BACKEND_DIR/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$BACKUP_ROOT/$TIMESTAMP"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-meshrd_cms}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-root_dev_password}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-meshrd_mysql}"
STORAGE_DIR="${STORAGE_DIR:-$BACKEND_DIR/storage}"
ENC_KEY="${BACKUP_ENCRYPTION_KEY:-}"

mkdir -p "$WORKDIR"

echo "==> Dumping database '$DB_NAME'..."
DB_DUMP="$WORKDIR/db.sql"
if command -v mysqldump >/dev/null 2>&1; then
    mysqldump --single-transaction --routines --triggers \
        -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > "$DB_DUMP"
elif docker ps --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER"; then
    echo "    (no local mysqldump — using docker exec against '$DOCKER_CONTAINER')"
    docker exec "$DOCKER_CONTAINER" mysqldump --single-transaction --routines --triggers \
        -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > "$DB_DUMP"
else
    echo "FATAL: no local mysqldump and no running '$DOCKER_CONTAINER' container." >&2
    exit 1
fi
DB_DUMP_SIZE=$(wc -c < "$DB_DUMP")
echo "    db.sql: $DB_DUMP_SIZE bytes"

echo "==> Archiving file tree '$STORAGE_DIR'..."
FILES_TAR="$WORKDIR/files.tar.gz"
if [ -d "$STORAGE_DIR" ]; then
    tar -czf "$FILES_TAR" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
else
    echo "    (no storage/ directory yet — writing an empty archive marker)"
    tar -czf "$FILES_TAR" --files-from /dev/null
fi
echo "    files.tar.gz: $(wc -c < "$FILES_TAR") bytes"

if [ -n "$ENC_KEY" ]; then
    echo "==> Encrypting (AES-256-CBC)..."
    openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$ENC_KEY" -in "$DB_DUMP" -out "$DB_DUMP.enc"
    openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$ENC_KEY" -in "$FILES_TAR" -out "$FILES_TAR.enc"
    rm -f "$DB_DUMP" "$FILES_TAR"
    echo "    -> $WORKDIR/db.sql.enc, $WORKDIR/files.tar.gz.enc"
else
    echo "==> BACKUP_ENCRYPTION_KEY not set — backup written UNENCRYPTED. Set it before any real deployment." >&2
fi

echo "==> TODO (needs real infra, not runnable here): upload $WORKDIR to off-box storage, e.g.:"
echo "      rclone copy \"$WORKDIR\" remote:meshrd-backups/$TIMESTAMP"

echo "==> Backup complete: $WORKDIR"
