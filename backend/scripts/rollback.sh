#!/usr/bin/env bash
# Roll back to the previous release. Companion to deploy.sh.
#
# Cheap by design: deploy.sh keeps the last 5 release directories, each holding
# the compose file it ran with, and the images stay in the local docker cache.
# So a rollback is a symlink move plus a compose up -- no registry round-trip,
# nothing to rebuild, and it works even if the registry is unreachable, which
# is exactly when you are most likely to need it.
#
# NOT rolled back: the database. Alembic downgrades are not safe to run blind
# (0016's own downgrade documents why it can legitimately fail), and a
# migration that dropped data cannot be undone by moving a symlink. If a
# release shipped a destructive migration, restore from backup instead --
# see scripts/restore.sh. This script deliberately refuses to pretend
# otherwise.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to the target server address}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

APP_ROOT="/opt/meshrd-cms"

echo "==> Rolling back on $DEPLOY_USER@$DEPLOY_HOST"

ssh "$DEPLOY_USER@$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail

APP_ROOT="$APP_ROOT"
RELEASES_DIR="\$APP_ROOT/releases"
CURRENT_LINK="\$APP_ROOT/current"
SHARED_DIR="\$APP_ROOT/shared"

CURRENT_TARGET="\$(readlink -f "\$CURRENT_LINK" 2>/dev/null || true)"
[ -n "\$CURRENT_TARGET" ] || { echo "FATAL: no current release to roll back from" >&2; exit 1; }

# Newest-first, so the first entry that is not the current one is the previous.
PREVIOUS=""
while read -r dir; do
    dir="\${dir%/}"
    if [ "\$(readlink -f "\$dir")" != "\$CURRENT_TARGET" ]; then PREVIOUS="\$dir"; break; fi
done < <(ls -1dt "\$RELEASES_DIR"/*/ 2>/dev/null)

[ -n "\$PREVIOUS" ] || { echo "FATAL: no previous release kept -- nothing to roll back to" >&2; exit 1; }

echo "==> Current:  \$CURRENT_TARGET"
echo "==> Rolling back to: \$PREVIOUS"

COMPOSE="docker compose --project-name meshrd-cms --project-directory \$PREVIOUS -f \$PREVIOUS/docker-compose.yml --env-file \$SHARED_DIR/.env"

\$COMPOSE up -d --remove-orphans

for i in \$(seq 1 60); do
    if \$COMPOSE exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')" >/dev/null 2>&1; then
        echo "    previous release healthy after \${i}s"; break
    fi
    if [ "\$i" -eq 60 ]; then
        echo "FATAL: previous release did not become healthy either. Not moving the symlink." >&2
        echo "       This usually means the problem is data/config, not the image -- check \$SHARED_DIR/.env and the DB." >&2
        exit 1
    fi
    sleep 1
done

ln -sfn "\$PREVIOUS" "\${CURRENT_LINK}.tmp"
mv -T "\${CURRENT_LINK}.tmp" "\$CURRENT_LINK"

echo "==> Rolled back. Current is now \$PREVIOUS"
echo "    Reminder: the database was NOT rolled back. If the bad release ran a"
echo "    destructive migration, restore from backup (scripts/restore.sh)."
REMOTE
