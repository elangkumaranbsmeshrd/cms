"""Layer 3 — bypass matrix items 9 (token handling) and 11 (must_change_password).

Premise, verbatim from build-docs/COMPLETE-TEST-PROMPT.md: "assume the attacker
never opens your UI. They have a valid low-privilege token and call the API
directly with curl."

WHY THIS FILE DELIBERATELY DIVERGES FROM tests/test_file_download_authz.py:
that suite (the doc's "right shape") picks an actor by overriding
`app.auth.deps.get_current_user`. That is exactly the layer under test here —
with it overridden, an expired, forged, wrong-key or revoked token is never
looked at, so every assertion below would be vacuous. So this module drives the
REAL token path instead: every request carries an `Authorization: Bearer ...`
header holding a token that either came out of a genuine
`POST /api/v1/auth/login` or was forged with python-jose against the app's own
signing key and algorithm. `app/auth/deps.py`, `app/auth/security.py` and
`app/services/auth_tokens.py` all execute for real. Only `get_db` is overridden
— onto conftest's in-memory SQLite session seeded with the real canonical RBAC
policy by `seed_canonical`, same as every other suite here.

WHAT THE CODE ACTUALLY GUARANTEES ABOUT LOGOUT (item 9's "must be revoked, not
merely client-deleted"). There are two tokens and they have different
lifecycles, so the claim has to be stated precisely:

  * the REFRESH token is a random secret stored SHA-256-hashed in
    `refresh_tokens` (app/models/platform.py). `POST /auth/logout` stamps
    `revoked_at` on it and `rotate_refresh_token` refuses any row with
    `revoked_at` set. That is server-side revocation, and
    `test_logout_revokes_the_refresh_token_server_side` is what asserts it.
  * the ACCESS token is a stateless HS256 JWT carrying only `sub` and `exp`.
    Nothing is consulted at verification time except the signature, the `exp`,
    and a live re-read of the `users` row. There is no denylist, so logout
    cannot and does not invalidate an access token already in the attacker's
    hands — it stays usable until `exp`, i.e. at most
    `settings.access_token_expire_minutes` (15). That bound is the whole
    security argument, and it is a deliberate design property (see the comment
    on `access_token_expire_minutes` in app/core/config.py, which records the
    reduction from 480 minutes precisely because of this), not an oversight.
    `test_logout_leaves_an_issued_access_token_valid_for_its_short_window`
    characterises it so the bound is asserted rather than assumed.

RATE LIMITER. app/core/rate_limit.py counts only FAILED logins and resets on
success, so the legitimate logins below are safe — but the counters live in a
real Redis that may be up on the dev box and is shared with the sibling files
four other agents are writing into tests/security/ concurrently. One of their
brute-force tests tripping the per-IP key would 429 this file's logins before
the password is ever checked. `_client` is therefore patched to raise, which
routes all three counter functions down rate_limit.py's own documented
fail-open branch. Nothing on the token path is touched.

Two endpoints stand in for "a normal endpoint" and "an endpoint this role must
not reach", both chosen off the canonical policy in tests/conftest.py:
  * GET /api/v1/masters/holidays — screen `masters.holidays`, EMPLOYEE mode
    'view', so a plain low-privilege token gets 200 and an empty list.
  * GET /api/v1/rbac/roles — screen `rbac.role_directory`, 'full' for
    SUPER_ADMIN and 'none' for every other role, so a non-Super-Admin gets 404
    (require_screen's deliberate "an invisible screen does not reveal that it
    exists" response, not 403).
"""

import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select

from app.auth.security import ALGORITHM, hash_password
from app.core import rate_limit
from app.core.config import get_settings
from app.core.db import get_db
from app.main import app
from app.models.platform import RefreshToken, User
from tests.conftest import seed_canonical

# argon2id at 64 MiB / t=3 is deliberately expensive; hash the shared test
# password exactly once for the whole module instead of once per user.
PASSWORD = "Str0ng!Passw0rd#1"
_PASSWORD_HASH = hash_password(PASSWORD)
NEW_PASSWORD = "An0ther!Passw0rd#2"

NORMAL_ENDPOINT = "/api/v1/masters/holidays"
SUPER_ADMIN_ONLY_ENDPOINT = "/api/v1/rbac/roles"
ME_ENDPOINT = "/api/v1/me"
CHANGE_PASSWORD_ENDPOINT = "/api/v1/auth/change-password"


# ================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session, monkeypatch):
    async def _get_db_override():
        yield db_session

    def _no_redis():
        raise RuntimeError("redis intentionally unavailable for this test module")

    # See the module docstring: forces rate_limit.py's own fail-open path so a
    # sibling security file's brute-force test can't 429 a legitimate login here.
    monkeypatch.setattr(rate_limit, "_client", _no_redis)

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# =========================================================== shared scaffolding
async def _make_user(db_session, ids: dict, role_code: str, label: str, **flags) -> User:
    """A real, loginnable account. conftest's own seeded users carry
    password_hash='x', which is not a valid hash of anything — they can never
    complete the real login this module requires.
    """
    user = User(
        id=str(uuid.uuid4()), email=f"{label}@tokens.test", password_hash=_PASSWORD_HASH,
        full_name=label, role_id=ids[f"role:{role_code}"], **flags,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _login(client: AsyncClient, email: str, password: str = PASSWORD) -> dict:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"login failed for {email}: {resp.status_code} {resp.text}"
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]
    return body


def _auth(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _claims(subject: str, *, minutes_from_now: int) -> dict:
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    return {"sub": subject, "exp": int(exp.timestamp())}


def _forge(claims: dict, *, key: str | None = None, algorithm: str = ALGORITHM) -> str:
    """A token built the way an attacker would, using the app's own library.
    `key=None` means the app's real signing key — so a test that passes here
    isolates exactly one variable (the expiry, or the algorithm, or the key).
    """
    return jwt.encode(claims, key if key is not None else get_settings().secret_key, algorithm=algorithm)


def _forge_unsigned(claims: dict) -> str:
    """The classic `alg: none` forgery: a well-formed header/payload and an
    empty signature segment. python-jose refuses to *encode* this ("Algorithm
    none not supported"), which is why it is assembled by hand — the attacker
    is not constrained by our library's encoder.
    """
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps(claims).encode())
    return f"{header}.{payload}."


# ==================== 0 — the control: the real token path works at all
async def test_a_genuine_login_token_works_and_a_missing_or_junk_one_does_not(db_session, client):
    """Everything below asserts 401/403/404 against the real auth dependency.
    Without this test those could all be passing for the wrong reason (a
    misrouted URL, a broken fixture, an endpoint that 401s for everyone).
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "control")

    tokens = await _login(client, user.email)
    ok = await client.get(NORMAL_ENDPOINT, headers=_auth(tokens["access_token"]))
    assert ok.status_code == 200, ok.text
    assert ok.json() == []

    assert (await client.get(NORMAL_ENDPOINT)).status_code == 401, "no Authorization header must not be anonymous access"
    assert (await client.get(NORMAL_ENDPOINT, headers=_auth("not.a.jwt"))).status_code == 401

    # ...and this low-privilege token really is low-privilege.
    assert (await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=_auth(tokens["access_token"]))).status_code == 404


# ============================================ ITEM 9a — an expired access token
async def test_expired_access_token_is_refused(db_session, client):
    """Forged with the app's own key and algorithm and a past `exp`, rather
    than waiting 15 minutes. The only difference between the two tokens
    asserted here is the expiry, so a pass cannot be explained by anything else.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "expired")

    expired = _forge(_claims(user.id, minutes_from_now=-5))
    resp = await client.get(NORMAL_ENDPOINT, headers=_auth(expired))
    assert resp.status_code == 401, f"an expired access token was accepted: {resp.status_code} {resp.text}"

    # Same subject, same key, same algorithm, future exp -> accepted. This is
    # what makes the 401 above attributable to `exp` and nothing else.
    still_valid = _forge(_claims(user.id, minutes_from_now=5))
    assert (await client.get(NORMAL_ENDPOINT, headers=_auth(still_valid))).status_code == 200

    # An exp one second in the past is still in the past — no silent leeway
    # window (python-jose applies none by default; assert it, don't assume it).
    just_expired = _forge({"sub": user.id, "exp": int(datetime.now(timezone.utc).timestamp()) - 1})
    assert (await client.get(NORMAL_ENDPOINT, headers=_auth(just_expired))).status_code == 401


# ==================================== ITEM 9b — logout, the revocable half
async def test_logout_revokes_the_refresh_token_server_side(db_session, client):
    """The doc's "must be revoked, not merely client-deleted" claim, asserted
    against the only token in this design that CAN be revoked. The refresh
    token is the long-lived one (30 days) — if logout only cleared it from the
    browser, a copy taken off the wire would keep minting fresh 15-minute
    access tokens for a month.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "logout")
    tokens = await _login(client, user.email)
    refresh_token = tokens["refresh_token"]

    # It works before logout, so the 401 afterwards is about revocation.
    before = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert before.status_code == 200, before.text
    rotated = before.json()["refresh_token"]

    logout = await client.post("/api/v1/auth/logout", json={"refresh_token": rotated})
    assert logout.status_code == 204, logout.text

    after = await client.post("/api/v1/auth/refresh", json={"refresh_token": rotated})
    assert after.status_code == 401, f"a logged-out refresh token was still exchangeable: {after.text}"

    # Server-side state, not just a 401 code path: the row is stamped revoked.
    rows = (
        await db_session.execute(select(RefreshToken).where(RefreshToken.user_id == user.id))
    ).scalars().all()
    assert rows, "no refresh token row was ever persisted"
    assert all(r.revoked_at is not None for r in rows), (
        "logout left a live refresh_tokens row for this user — the session is only client-deleted"
    )

    # Rotation means the pre-logout token is dead too: presenting the original
    # after it was exchanged must not resurrect the session either.
    replayed = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert replayed.status_code == 401, "a rotated-away refresh token was accepted"


async def test_logout_leaves_an_issued_access_token_valid_for_its_short_window(db_session, client):
    """CHARACTERISATION, not an aspiration — the exact bound of the guarantee
    above, stated as an assertion so it cannot drift unnoticed.

    The access token is a stateless HS256 JWT (`sub` + `exp` only). Verification
    in app/auth/deps.py checks the signature, the expiry, and re-reads the
    `users` row; there is no revocation list and logout writes nothing an access
    token is checked against. So an access token already issued survives logout
    until it expires. The containment is the 15-minute ceiling in
    app/core/config.py, asserted below off the token's own claims.

    If this test ever starts FAILING because a logged-out access token is now
    rejected, that is a hardening improvement, not a regression — replace this
    test with the stronger assertion.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "logoutaccess")
    tokens = await _login(client, user.email)

    assert (await client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})).status_code == 204

    survived = await client.get(NORMAL_ENDPOINT, headers=_auth(tokens["access_token"]))
    assert survived.status_code == 200, (
        "expected the stateless access token to outlive logout; if it is now rejected, "
        "access-token revocation was added and this characterisation should be tightened"
    )

    # The bound that makes the above acceptable. Decoded with the app's own key
    # and algorithm, so this also proves the login endpoint stamps a real exp.
    claims = jwt.decode(tokens["access_token"], get_settings().secret_key, algorithms=[ALGORITHM])
    remaining = datetime.fromtimestamp(claims["exp"], tz=timezone.utc) - datetime.now(timezone.utc)
    assert remaining <= timedelta(minutes=get_settings().access_token_expire_minutes), (
        "the surviving access token's window is longer than the configured ceiling"
    )
    assert remaining <= timedelta(minutes=15), (
        "access_token_expire_minutes was raised above 15 — the whole argument for not revoking "
        "access tokens on logout is that the window is short; re-review before accepting this"
    )


# ================================== ITEM 9c — a token from a deactivated user
async def test_token_of_a_deactivated_user_is_refused_on_the_next_request(db_session, client):
    """The token is issued while the account is live, then the account is
    disabled — the realistic offboarding case. `get_current_user` re-reads the
    users row on every request, so `is_enabled=False` must bite immediately,
    not at the token's natural expiry.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "deactivated")
    tokens = await _login(client, user.email)
    headers = _auth(tokens["access_token"])

    assert (await client.get(NORMAL_ENDPOINT, headers=headers)).status_code == 200

    user.is_enabled = False
    await db_session.commit()

    resp = await client.get(NORMAL_ENDPOINT, headers=headers)
    assert resp.status_code == 401, f"a disabled user's access token still worked: {resp.status_code} {resp.text}"

    # The long-lived half has to die too, or the disabled account just mints a
    # new access token (rotate_refresh_token re-checks is_enabled for this).
    refreshed = await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 401, "a disabled user could exchange their refresh token for a new access token"

    # And the front door is shut: no new session can be started either.
    relogin = await client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert relogin.status_code == 401


# ======================================= ITEM 9d — role changed after issue
async def test_role_change_after_token_issue_applies_on_the_very_next_request(db_session, client):
    """Permissions must be resolved per request from the DB, never baked into
    the token. The token carries only `sub`, and app/rbac/deps.py resolves
    against a freshly-read `user.role_id` — so a demotion has to take effect
    without waiting for the token to expire or forcing a re-login. Verified in
    both directions, because only one of them is a security property: losing
    access must be immediate (the other direction is merely convenience).
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "SUPER_ADMIN", "rolechange")
    tokens = await _login(client, user.email)
    headers = _auth(tokens["access_token"])

    assert (await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=headers)).status_code == 200

    # --- demotion: the privilege must be gone on the next call, same token ---
    user.role_id = ids["role:EMPLOYEE"]
    await db_session.commit()

    demoted = await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=headers)
    assert demoted.status_code == 404, (
        f"a Super Admin demoted to Employee kept the Role Directory with their old token: "
        f"{demoted.status_code} {demoted.text}"
    )
    # Still authenticated — just less privileged. Proves the 404 is the RBAC
    # layer re-resolving, not the token having become invalid outright.
    assert (await client.get(NORMAL_ENDPOINT, headers=headers)).status_code == 200

    # The policy snapshot the client renders from must agree, in the response
    # body — not just the route guard.
    me = await client.get(ME_ENDPOINT, headers=headers)
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "EMPLOYEE", "GET /me still reported the role baked in at login"
    assert "rbac.role_directory" not in me.json()["policy"]["screens"]

    # --- promotion: a widened role is live on the next call too ---
    user.role_id = ids["role:SUPER_ADMIN"]
    await db_session.commit()

    repromoted = await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=headers)
    assert repromoted.status_code == 200, repromoted.text
    assert (await client.get(ME_ENDPOINT, headers=headers)).json()["role"] == "SUPER_ADMIN"


# ============================================= ITEM 9e — a wrong signing key
async def test_token_signed_with_the_wrong_key_is_refused(db_session, client):
    """An attacker who knows the payload shape (`sub` is just a user id, and
    ids leak through ordinary API responses) can mint whatever claims they
    like — the signature is the only thing standing between them and
    impersonating a Super Admin.
    """
    ids = await seed_canonical(db_session)
    employee = await _make_user(db_session, ids, "EMPLOYEE", "wrongkey")
    admin = await _make_user(db_session, ids, "SUPER_ADMIN", "wrongkeyadmin")

    attacker_key = "attacker-chosen-signing-key-" + "0" * 40
    assert attacker_key != get_settings().secret_key

    forged = _forge(_claims(employee.id, minutes_from_now=10), key=attacker_key)
    resp = await client.get(NORMAL_ENDPOINT, headers=_auth(forged))
    assert resp.status_code == 401, f"a token signed with an unknown key was accepted: {resp.text}"

    # The escalation the signature actually prevents: claiming to be someone else.
    escalated = _forge(_claims(admin.id, minutes_from_now=10), key=attacker_key)
    assert (await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=_auth(escalated))).status_code == 401

    # An untouched-payload token whose signature bytes were tampered with.
    genuine = _forge(_claims(employee.id, minutes_from_now=10))
    head, payload, signature = genuine.split(".")
    tampered = f"{head}.{payload}.{signature[:-4]}AAAA" if not signature.endswith("AAAA") else f"{head}.{payload}.{signature[:-4]}BBBB"
    assert (await client.get(NORMAL_ENDPOINT, headers=_auth(tampered))).status_code == 401


# ================================================= ITEM 9f — the alg is pinned
async def test_algorithm_is_pinned_so_alg_none_and_a_swapped_algorithm_are_refused(db_session, client):
    """CWE-347. `decode_access_token` passes `algorithms=[ALGORITHM]`, which is
    what makes the header's own `alg` claim non-authoritative. Two forgeries:

      * `alg: none` — the header declares there is no signature at all. Built
        by hand, since python-jose refuses to encode it.
      * `alg: HS512` with the app's REAL key — the signature is genuine, only
        the algorithm differs. This is the one a decoder that trusts the header
        would wave through, and the reason `algorithms=` must be an allow-list
        rather than a hint.
    """
    ids = await seed_canonical(db_session)
    employee = await _make_user(db_session, ids, "EMPLOYEE", "algpin")
    admin = await _make_user(db_session, ids, "SUPER_ADMIN", "algpinadmin")

    unsigned = _forge_unsigned(_claims(admin.id, minutes_from_now=10))
    assert unsigned.endswith("."), "the alg=none forgery must carry an empty signature segment"
    resp = await client.get(NORMAL_ENDPOINT, headers=_auth(unsigned))
    assert resp.status_code == 401, f"an alg=none token was accepted: {resp.status_code} {resp.text}"
    assert (await client.get(SUPER_ADMIN_ONLY_ENDPOINT, headers=_auth(unsigned))).status_code == 401

    for swapped_alg in ("HS384", "HS512"):
        token = _forge(_claims(employee.id, minutes_from_now=10), algorithm=swapped_alg)
        swapped = await client.get(NORMAL_ENDPOINT, headers=_auth(token))
        assert swapped.status_code == 401, (
            f"a token signed with {swapped_alg} against the real key was accepted — "
            f"the decoder is trusting the header's alg claim"
        )

    # Control: the same claims under the pinned algorithm are fine, so the
    # rejections above are about the algorithm and not the claims.
    assert (
        await client.get(NORMAL_ENDPOINT, headers=_auth(_forge(_claims(employee.id, minutes_from_now=10))))
    ).status_code == 200


# ================== ITEM 11 — must_change_password blocks everything else
async def test_flagged_user_is_refused_on_a_normal_endpoint(db_session, client):
    """A temporary password is a credential HR (or a self-service reset) handed
    out; until it is changed it must not function as a working session. The
    flag is checked in `get_current_user`, so it fires before RBAC — the user's
    own role permissions are irrelevant to this 403.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "flagged", must_change_password=True)

    # Login itself still succeeds — it has to, or the change-password screen
    # could never be reached. The token is real; it is just heavily restricted.
    tokens = await _login(client, user.email)
    headers = _auth(tokens["access_token"])

    resp = await client.get(NORMAL_ENDPOINT, headers=headers)
    assert resp.status_code == 403, (
        f"a must_change_password user reached a normal endpoint: {resp.status_code} {resp.text}"
    )
    assert "password" in resp.json()["detail"].lower()

    # Not merely one endpoint: anything outside the allowlist, whatever the
    # method, including the ones this role could never reach anyway.
    for method, path, payload in (
        ("GET", SUPER_ADMIN_ONLY_ENDPOINT, None),
        ("GET", "/api/v1/masters/leave-types", None),
        ("POST", NORMAL_ENDPOINT, {"name": "X", "holiday_date": "2026-01-01",
                                   "financial_year_id": "fy-1", "holiday_type": "MANDATORY"}),
    ):
        blocked = await client.request(method, path, headers=headers, json=payload)
        assert blocked.status_code == 403, f"{method} {path} was reachable while flagged: {blocked.status_code}"


async def test_flagged_user_is_allowed_on_exactly_the_allowlisted_endpoints(db_session, client):
    """app/auth/deps.py's `_PASSWORD_CHANGE_ALLOWLIST` is exactly two
    (method, path) pairs: POST /api/v1/auth/change-password and GET /api/v1/me.
    Both are required for the forced-change screen to function at all — the
    Angular shell reads /me to know whose session it is and what to render.
    Logout is reachable too, but for a different reason worth recording: it
    carries no auth dependency at all (the refresh token in the body IS the
    credential), so it never passes through the flag check.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "allowlist", must_change_password=True)
    tokens = await _login(client, user.email)
    headers = _auth(tokens["access_token"])

    me = await client.get(ME_ENDPOINT, headers=headers)
    assert me.status_code == 200, f"GET /me is allowlisted but was refused: {me.text}"
    assert me.json()["must_change_password"] is True, "the client has to be told why it is being redirected"

    # Reaches the change-password HANDLER — 401 is that handler rejecting a
    # wrong current password, which only happens after the flag check let it
    # through. 403 here would mean the allowlist entry does not work.
    wrong = await client.post(
        CHANGE_PASSWORD_ENDPOINT, headers=headers,
        json={"current_password": "definitely-not-it", "new_password": NEW_PASSWORD},
    )
    assert wrong.status_code == 401, f"POST /auth/change-password is allowlisted but returned {wrong.status_code}"

    # Unauthenticated by design, so the flag never applies to it.
    assert (await client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]})).status_code == 204

    # The allowlist is (method, path) pairs, not path prefixes: a different
    # method on an allowlisted path must not inherit the exemption. GET
    # /auth/change-password is not a registered route, so FastAPI answers 405
    # from routing — the point is only that it is never a successful call.
    stray = await client.get(CHANGE_PASSWORD_ENDPOINT, headers=headers)
    assert stray.status_code in (403, 404, 405), stray.status_code


async def test_flagged_user_reaches_the_refused_endpoint_after_changing_the_password(db_session, client):
    """The whole point of the gate is that it is an escape hatch with an exit,
    not a lockout: refused, change the password, and the same session works.
    """
    ids = await seed_canonical(db_session)
    user = await _make_user(db_session, ids, "EMPLOYEE", "completes", must_change_password=True)
    tokens = await _login(client, user.email)
    headers = _auth(tokens["access_token"])

    assert (await client.get(NORMAL_ENDPOINT, headers=headers)).status_code == 403

    changed = await client.post(
        CHANGE_PASSWORD_ENDPOINT, headers=headers,
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert changed.status_code == 204, f"change-password failed: {changed.status_code} {changed.text}"

    now_allowed = await client.get(NORMAL_ENDPOINT, headers=headers)
    assert now_allowed.status_code == 200, (
        f"still refused after completing the password change: {now_allowed.status_code} {now_allowed.text}"
    )
    assert (await client.get(ME_ENDPOINT, headers=headers)).json()["must_change_password"] is False

    # The flag is cleared in the DB, not merely absent from one response.
    refreshed_user = (await db_session.execute(select(User).where(User.id == user.id))).scalar_one()
    assert refreshed_user.must_change_password is False

    # And the change really took: the old temporary password is dead, the new
    # one starts a fresh session, and that session is unflagged from the start.
    assert (await client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})).status_code == 401
    fresh = await _login(client, user.email, NEW_PASSWORD)
    assert (await client.get(NORMAL_ENDPOINT, headers=_auth(fresh["access_token"]))).status_code == 200
