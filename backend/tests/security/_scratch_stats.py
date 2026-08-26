import collections
from tests.security.test_injection_and_export import (  # noqa: F401
    CONTROL_VALUE, FREE_TEXT_PAIRS, _as, _seed_base, _seed_searchable_rows, client, _quiet_http_log,
)

async def test_stats(db_session, client):
    ids, users = await _seed_base(db_session)
    await _seed_searchable_rows(db_session, ids)
    _as(users["SUPER_ADMIN"])
    by_status = collections.defaultdict(set)
    detail = {}
    for path, name in FREE_TEXT_PAIRS:
        c = await client.get(path, params={name: CONTROL_VALUE})
        if c.status_code != 200:
            by_status[c.status_code].add(path)
            detail[(c.status_code, path)] = c.text[:160]
    for code, paths in sorted(by_status.items()):
        print(f"\n--- HTTP {code}: {len(paths)} paths")
        for p in sorted(paths):
            print(f"   {p}  :: {detail[(code,p)]}")
