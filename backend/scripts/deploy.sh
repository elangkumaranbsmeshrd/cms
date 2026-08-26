#!/usr/bin/env bash
# Phase 7 hardening (BUILD-PROMPT.md §12): "deploy script must be idempotent,
# atomic, and self-rolling-back." This is a SKELETON — it documents and
# structures the required shape, but the actual remote-host mechanics
# (SSH target, systemd unit names, nginx reload) can't be filled in or
# verified without a real droplet, which doesn't exist yet. Every step below
# is written to be genuinely safe to re-run (idempotent) and to leave the
# previous release in place until the new one is proven healthy (atomic +
# self-rolling-back via the symlink swap), matching what actually runs
# without needing to change once the droplet exists — only DEPLOY_HOST/
# DEPLOY_USER need to point somewhere real.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to the droplet's address}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
RELEASES_DIR="/opt/meshrd-cms/releases"
CURRENT_LINK="/opt/meshrd-cms/current"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
KEEP_RELEASES=5

echo "==> Deploying release $RELEASE_ID to $DEPLOY_USER@$DEPLOY_HOST"

ssh "$DEPLOY_USER@$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail

echo "==> [1/6] Preparing release directory (idempotent: safe if it already exists)"
mkdir -p "$RELEASE_DIR"

echo "==> [2/6] Pulling the built image / artifact into the release directory"
# TODO once real infra exists: docker pull / rsync the built artifact here.
# Left as a TODO rather than guessed at — the actual registry/transfer
# mechanism depends on decisions (container registry vs. rsync a wheel)
# not yet made, and guessing here would be worse than a visible gap.

echo "==> [3/6] Running database migrations (idempotent: alembic no-ops if already at head)"
# TODO: docker run --rm --env-file /opt/meshrd-cms/shared/.env <image> alembic upgrade head

echo "==> [4/6] Starting the new release alongside the old one (no downtime yet)"
# TODO: docker compose -f "$RELEASE_DIR/docker-compose.yml" up -d
# Health-check loop BEFORE the symlink swap below — this is the actual
# "self-rolling-back" mechanism: if the new release never becomes healthy,
# the symlink is never moved and the old release keeps serving traffic
# untouched. Deliberately not a fixed sleep.
for i in \$(seq 1 30); do
    if curl -sf http://127.0.0.1:8000/health > /dev/null; then
        echo "    new release healthy after \${i}s"
        break
    fi
    if [ "\$i" -eq 30 ]; then
        echo "FATAL: new release never became healthy — aborting, old release untouched" >&2
        exit 1
    fi
    sleep 1
done

echo "==> [5/6] Atomically swapping the 'current' symlink (this IS the cutover)"
ln -sfn "$RELEASE_DIR" "${CURRENT_LINK}.tmp"
mv -T "${CURRENT_LINK}.tmp" "$CURRENT_LINK"
# nginx already proxies to \$CURRENT_LINK, not a fixed path, so no reload is
# needed for the cutover itself — only for a change to nginx's own config.
# preload_app must stay False in the gunicorn unit (BUILD-PROMPT §12) or
# this reload silently no-ops instead of picking up the new release.
systemctl reload meshrd-cms || true

echo "==> [6/6] Pruning old releases, keeping the last $KEEP_RELEASES (idempotent)"
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +\$(($KEEP_RELEASES + 1)) | xargs -r rm -rf

echo "==> Deploy complete: $RELEASE_ID is now current"
REMOTE
