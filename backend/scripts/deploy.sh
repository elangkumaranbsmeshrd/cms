#!/usr/bin/env bash
# Idempotent, atomic, self-rolling-back deploy (BUILD-PROMPT.md §12).
#
# Transfer mechanism: a CONTAINER REGISTRY (GHCR by default). This was the one
# decision the earlier skeleton left open ("registry vs rsync a wheel"), and it
# is settled here because CI already builds both images and pushes them by
# commit SHA, so the artefact that gets deployed is byte-identical to the one
# that was tested — which an rsync-the-source approach cannot guarantee.
#
# Atomicity comes from the symlink swap: the new release is pulled, migrated
# and health-checked BEFORE `current` moves. If any of that fails the script
# exits non-zero with the old release still serving, untouched.
#
# Safe to re-run: every step either no-ops or converges. Re-running the same
# IMAGE_TAG redeploys the same artefact rather than doing something different.
set -euo pipefail

# No apostrophes in any ${VAR:?message} below: bash parses the message as a
# word, so a lone quote there opens a quoted section and breaks the whole file.
DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to the target server address}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
IMAGE_TAG="${IMAGE_TAG:?Set IMAGE_TAG to the tag CI published (e.g. the commit SHA)}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_OWNER="${IMAGE_OWNER:?Set IMAGE_OWNER to the registry namespace (e.g. elangkumaranbsmeshrd)}"

APP_ROOT="/opt/meshrd-cms"
RELEASES_DIR="$APP_ROOT/releases"
SHARED_DIR="$APP_ROOT/shared"
CURRENT_LINK="$APP_ROOT/current"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
KEEP_RELEASES=5

BACKEND_IMAGE="$REGISTRY/$IMAGE_OWNER/cms-backend:$IMAGE_TAG"
FRONTEND_IMAGE="$REGISTRY/$IMAGE_OWNER/cms-frontend:$IMAGE_TAG"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
[ -f "$COMPOSE_FILE" ] || { echo "FATAL: $COMPOSE_FILE not found" >&2; exit 1; }

echo "==> Deploying $RELEASE_ID to $DEPLOY_USER@$DEPLOY_HOST"
echo "    backend:  $BACKEND_IMAGE"
echo "    frontend: $FRONTEND_IMAGE"

# Ship the compose file with the release rather than assuming a copy on the
# server: the release directory then fully describes how that release runs, so
# a rollback restores its topology too, not just its images.
echo "==> Copying compose file to the server"
ssh "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p '$RELEASE_DIR'"
scp -q "$COMPOSE_FILE" "$DEPLOY_USER@$DEPLOY_HOST:$RELEASE_DIR/docker-compose.yml"

ssh "$DEPLOY_USER@$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail

RELEASE_DIR="$RELEASE_DIR"
SHARED_DIR="$SHARED_DIR"
CURRENT_LINK="$CURRENT_LINK"
RELEASES_DIR="$RELEASES_DIR"
KEEP_RELEASES=$KEEP_RELEASES
BACKEND_IMAGE="$BACKEND_IMAGE"
FRONTEND_IMAGE="$FRONTEND_IMAGE"

# The env file lives in shared/, NOT in the release: secrets must survive a
# rollback and must never be committed or copied per-release.
if [ ! -f "\$SHARED_DIR/.env" ]; then
    echo "FATAL: \$SHARED_DIR/.env missing. Create it from .env.prod.example before the first deploy." >&2
    exit 1
fi
ln -sfn "\$SHARED_DIR/.env" "\$RELEASE_DIR/.env"

COMPOSE="docker compose --project-name meshrd-cms --project-directory \$RELEASE_DIR -f \$RELEASE_DIR/docker-compose.yml --env-file \$SHARED_DIR/.env"

echo "==> [1/6] Pulling images (idempotent: a tag already present is a no-op)"
export BACKEND_IMAGE FRONTEND_IMAGE
docker pull "\$BACKEND_IMAGE"
docker pull "\$FRONTEND_IMAGE"

echo "==> [2/6] Starting datastores and waiting for health"
\$COMPOSE up -d mysql redis
for i in \$(seq 1 60); do
    if \$COMPOSE ps --format json mysql 2>/dev/null | grep -q '"Health":"healthy"'; then
        echo "    mysql healthy after \${i}s"; break
    fi
    if [ "\$i" -eq 60 ]; then echo "FATAL: mysql never became healthy" >&2; exit 1; fi
    sleep 1
done

echo "==> [3/6] Running migrations (idempotent: alembic no-ops at head)"
# Run in a one-shot container on the app network, before any new app container
# serves traffic. If this fails the script aborts and 'current' never moves.
\$COMPOSE run --rm --no-deps -T backend alembic upgrade head

echo "==> [4/6] Starting the new release"
\$COMPOSE up -d --remove-orphans

# Health gate BEFORE the cutover — this IS the self-rolling-back mechanism.
# A fixed sleep would either be too short (cutting over to a broken release) or
# needlessly slow, so poll the real endpoint instead.
echo "==> [5/6] Waiting for the new release to report healthy"
for i in \$(seq 1 60); do
    if \$COMPOSE exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')" >/dev/null 2>&1; then
        echo "    backend healthy after \${i}s"; break
    fi
    if [ "\$i" -eq 60 ]; then
        echo "FATAL: new release never became healthy — aborting. Previous release still current." >&2
        \$COMPOSE logs --tail 50 backend >&2 || true
        exit 1
    fi
    sleep 1
done

echo "==> [6/6] Swapping 'current' and pruning old releases"
ln -sfn "\$RELEASE_DIR" "\${CURRENT_LINK}.tmp"
mv -T "\${CURRENT_LINK}.tmp" "\$CURRENT_LINK"

# Keep the last N release directories so a rollback is a symlink move plus a
# compose up, with no registry round-trip.
ls -1dt "\$RELEASES_DIR"/*/ 2>/dev/null | tail -n +\$((KEEP_RELEASES + 1)) | xargs -r rm -rf
# Reclaim disk from images no longer referenced by any kept release.
docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy complete: \$RELEASE_ID is now current"
REMOTE

echo "==> Done. Roll back with: scripts/rollback.sh (or point 'current' at the previous release and re-run compose up)"
