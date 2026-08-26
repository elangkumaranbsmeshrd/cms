# Phase 7 hardening (BUILD-PROMPT.md §12): matches the locked deployment
# shape — nginx in front, gunicorn running this image's uvicorn workers,
# co-located MySQL on the same droplet (not in this image). Multi-stage so
# the final image carries no build toolchain.
#
# preload_app must stay False wherever gunicorn is actually invoked (systemd
# unit / docker-compose command), per the same BUILD-PROMPT §12 note this
# repo has already flagged elsewhere — a True here would make `systemctl
# reload`/a rolling restart silently no-op. Not baked into this Dockerfile's
# CMD since the real gunicorn command line belongs in the deploy runbook
# (ARCH-3 §9), not duplicated here where it would be easy to let drift.

FROM python:3.12-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential default-libmysqlclient-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash appuser
COPY --from=builder /install /usr/local
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN mkdir -p /app/storage && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

# Dev/single-process default. Production runs this under gunicorn with
# multiple uvicorn workers instead — see ARCH-3 §9 for the real command line.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
