"""Phase 7 hardening round 2 — auth revocability (ARCH-2 §5, scoped down).

This session's security audit flagged the actual gap in how ARCH-2 §5 was
built: the access token is a stateless 8-hour bearer JWT with nothing
server-side backing it, so disabling a user (offboarding's DISABLE_LOGIN
exit-checklist step, HR's Disable Login button) doesn't cut their access —
it just waits out the token's own expiry. ARCH-2's full answer bundles two
separate things together: (1) server-side revocability via a short-lived
access token + a DB-backed refresh token, and (2) delivering that pair via
an HttpOnly/Secure/SameSite cookie instead of a bearer header. Only (1) is
being built now — (2) is meaningless before a browser client (the Angular
frontend) exists to receive and use a cookie, and switching the delivery
mechanism is a decision that belongs with that frontend's auth-interceptor
work, not bundled into a backend-only hardening pass. Tokens stay bearer/
header-delivered here.

Two new tables, both RESTRICT not CASCADE on their FK to users per this
project's standing convention, both a reduced column set (no AuditMixin —
these are system-managed session/security artifacts, not user-editable
business data; there's no "who edited this row" story beyond "the system
did, on a login/refresh/logout/disable event" already visible in
app/services/auth_tokens.py's own callers):

  - refresh_tokens — one row per issued refresh token. Stores only a SHA-256
    hash of the actual token value (never the raw value — same "never in
    logs or a response body" discipline temp passwords already follow),
    since a refresh token IS the credential and must never be recoverable
    from a DB dump. SHA-256, not bcrypt/argon2: this hashes a 256-bit random
    value (secrets.token_urlsafe(32)), not a human password — the whole
    point of slow password hashing (resisting a low-entropy dictionary/
    brute-force guess) doesn't apply to a token an attacker can't guess
    regardless of hash speed; a fast hash keeps every /auth/refresh call
    cheap. revoked_at is set on rotation (a refresh token is single-use —
    the old one is marked revoked the instant it's exchanged for a new
    pair, so a stolen-then-reused old token fails), on logout, or in bulk
    by revoke_all_refresh_tokens (password reset/change, disabling a login).
  - password_history — last-N password hashes per user (N=5, chosen in
    app/services/auth_tokens.py, not enforced at the DB layer since "keep
    only 5" is a service-layer trim, not a constraint), blocking reuse on
    /auth/change-password per ARCH-2 §5.2's "a password_hashes history
    table of the last N hashes blocks reuse."

No change to `users.password_hash`'s column width (VARCHAR(255)) — an
argon2id hash string is ~97 characters, comfortably within the existing
limit, so existing bcrypt hashes and new argon2id hashes coexist in the
same column with no migration needed for existing rows (verify_password
detects which algorithm a given hash string is and dispatches to the
matching verifier; a successful login with an old bcrypt hash triggers a
transparent lazy rehash to argon2id — see app/auth/security.py).
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE refresh_tokens (
            id           CHAR(36)      NOT NULL PRIMARY KEY,
            user_id      CHAR(36)      NOT NULL,
            token_hash   CHAR(64)      NOT NULL,
            issued_at    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            expires_at   DATETIME(6)   NOT NULL,
            revoked_at   DATETIME(6)   NULL,
            UNIQUE KEY ux_refresh_tokens_hash (token_hash),
            KEY ix_refresh_tokens_user (user_id),
            CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    op.execute("""
        CREATE TABLE password_history (
            id            CHAR(36)      NOT NULL PRIMARY KEY,
            user_id       CHAR(36)      NOT NULL,
            password_hash VARCHAR(255)  NOT NULL,
            created_at    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_password_history_user (user_id, created_at),
            CONSTRAINT fk_password_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)


def downgrade() -> None:
    for table in ("password_history", "refresh_tokens"):
        op.execute(f"DROP TABLE IF EXISTS {table};")
