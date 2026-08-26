from datetime import datetime, timedelta, timezone

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()

ALGORITHM = "HS256"

# passlib's bcrypt backend detection is broken against modern bcrypt (4.x
# removed the `__about__` attribute passlib's legacy code probed for, and
# tightened the 72-byte input limit passlib's self-test relied on silently
# truncating) — found while seeding Phase 0's first user. Rather than pin
# around an unmaintained compatibility shim, call bcrypt directly.

# Phase 7 hardening round 2 — argon2id per ARCH-2 §5.2's exact parameters,
# replacing bcrypt for all NEW hashes. Existing users keep their bcrypt
# hash until their next successful login (see verify_password/needs_rehash
# below) — there is no way to convert a bcrypt hash to argon2id without the
# plaintext password, so a forced mass reset isn't an option and isn't
# needed: this is the standard lazy-migration pattern for a password
# algorithm change.
_argon2_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)


def _is_argon2_hash(hashed: str) -> bool:
    return hashed.startswith("$argon2")


def hash_password(plain: str) -> str:
    return _argon2_hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    if _is_argon2_hash(hashed):
        try:
            return _argon2_hasher.verify(hashed, plain)
        except VerifyMismatchError:
            return False
    return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))


def needs_rehash(hashed: str) -> bool:
    """True for every remaining bcrypt hash (migrate to argon2id on next
    successful login), or an argon2id hash whose stored parameters no
    longer match _argon2_hasher's (e.g. after a future tuning change).
    """
    if not _is_argon2_hash(hashed):
        return True
    return _argon2_hasher.check_needs_rehash(hashed)


# Phase 7 hardening round 2 — a fixed, precomputed argon2id hash with no
# real password behind it. /auth/login always runs verify_password against
# a real user's hash OR this one, never skipping the call outright, so a
# nonexistent/disabled email can't be distinguished from a real one by
# response timing (CWE-208, confirmed exploitable by this session's
# security audit — bcrypt's cost was previously paid only on the "user
# exists and is enabled" branch; now argon2id's cost is, matching whatever
# a real account's hash currently costs to verify).
DUMMY_PASSWORD_HASH = _argon2_hasher.hash("not-a-real-password-used-only-for-constant-time-comparison")


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": subject, "exp": expire}, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None
