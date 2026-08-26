"""A002 revisited — Super Admin gets a real, gated Unlock action.

The original design (0001_platform_core.py) made Financial Year locking
categorically one-way: `trg_fy_reject_unlock` rejected ANY UPDATE that flipped
`status` from 'locked' back to 'open', no matter who or what issued it — a
deliberate defence-in-depth choice, proven by a direct SQL test at the time
(see the trigger's own original comment). Explicit product decision now
reverses that: Super Admin gets a genuine Unlock capability.

This does NOT mean "drop the trigger and rely on RBAC alone" — the whole point
of a DB-level guarantee is that it doesn't degrade to "well-behaved application
code only." The trigger is rewritten to check a session variable
(`@fy_unlock_allowed`) instead of rejecting unconditionally: `POST
/{id}/unlock` is the only code path in this codebase that ever sets it, and it
resets to NULL immediately after use. A raw `UPDATE financial_years SET
status='open' ...` from any other client — a stray script, a different
service, a DBA's ad-hoc session — still gets rejected exactly as before,
because that session's `@fy_unlock_allowed` was never set. Defence in depth is
preserved; only the one sanctioned path through it changed.

Unlocking clears `locked_by`/`locked_at` (no longer meaningful once open) —
`updated_by`/`updated_at` (AuditMixin, already on every table) record who
reopened it and when, the same place every other change to this row is
already tracked, rather than adding bespoke unlock-audit columns for a
one-action story.
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TRIGGER trg_fy_reject_unlock")
    op.execute("""
        CREATE TRIGGER trg_fy_reject_unlock
        BEFORE UPDATE ON financial_years
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'locked' AND NEW.status <> 'locked'
               AND (@fy_unlock_allowed IS NULL OR @fy_unlock_allowed <> 1) THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Financial Year is locked and cannot be unlocked except via the Super Admin Unlock action (A002)';
            END IF;
        END
    """)


def downgrade() -> None:
    # Restores the original, unconditional one-way lock — no session-variable
    # exception at all, matching 0001_platform_core.py exactly.
    op.execute("DROP TRIGGER trg_fy_reject_unlock")
    op.execute("""
        CREATE TRIGGER trg_fy_reject_unlock
        BEFORE UPDATE ON financial_years
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Financial Year is locked and cannot be unlocked (A002)';
            END IF;
        END
    """)
