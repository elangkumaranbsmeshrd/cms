"""Phase 7 hardening round 2 — a basic local concurrency sanity check, not a
real load test. This dev box's hardware bears no relationship to the
eventual droplet (ARCH-3 §9.5: 4 vCPU, 5 gunicorn workers), so throughput/
latency numbers here are not meaningful benchmarks — the only thing worth
proving locally is that moderate concurrency doesn't deadlock the async
session pool, blow up unhandled, or silently serialize where it shouldn't.
Real load testing needs the real droplet shape and is explicitly deferred
(BUILD-PROMPT.md §13's Phase 7 row lists it, ARCH-3 doesn't specify a tool).

Usage: .venv/Scripts/python.exe scripts/load_check.py
"""

import asyncio
import statistics
import sys
import time

import httpx

BASE_URL = "http://127.0.0.1:8001"
CONCURRENCY = 50
REQUESTS_PER_ENDPOINT = 100


async def _timed_get(client: httpx.AsyncClient, path: str, headers: dict | None = None) -> tuple[int, float]:
    start = time.perf_counter()
    resp = await client.get(path, headers=headers)
    return resp.status_code, time.perf_counter() - start


async def _run_endpoint(client: httpx.AsyncClient, name: str, path: str, headers: dict | None, n: int, concurrency: int) -> None:
    sem = asyncio.Semaphore(concurrency)

    async def _one():
        async with sem:
            return await _timed_get(client, path, headers)

    results = await asyncio.gather(*(_one() for _ in range(n)))
    codes = [r[0] for r in results]
    durations_ms = sorted(r[1] * 1000 for r in results)
    bad = [c for c in codes if c >= 500]
    p50 = durations_ms[len(durations_ms) // 2]
    p95 = durations_ms[int(len(durations_ms) * 0.95)]
    print(f"{name}: {n} requests @ concurrency {concurrency} -> "
          f"p50={p50:.1f}ms p95={p95:.1f}ms max={durations_ms[-1]:.1f}ms "
          f"5xx={len(bad)} non-200/401={sum(1 for c in codes if c not in (200, 401))}")
    if bad:
        print(f"  !! {len(bad)} server errors: {bad[:10]}")


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        login = await client.post("/api/v1/auth/login", json={"email": "superadmin@meshrd.in", "password": "Passw0rd!"})
        if login.status_code != 200:
            print(f"Setup login failed: {login.status_code} {login.text}")
            sys.exit(1)
        token = login.json()["access_token"]
        auth_headers = {"Authorization": f"Bearer {token}"}

        await _run_endpoint(client, "GET /health", "/health", None, REQUESTS_PER_ENDPOINT, CONCURRENCY)
        await _run_endpoint(client, "GET /employees (authed list)", "/api/v1/employees", auth_headers, REQUESTS_PER_ENDPOINT, CONCURRENCY)
        await _run_endpoint(client, "GET /auth/me-equivalent (employees, low concurrency)", "/api/v1/employees", auth_headers, 20, 5)


if __name__ == "__main__":
    asyncio.run(main())
