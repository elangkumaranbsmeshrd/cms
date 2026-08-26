"""Layer 3 gains its missing state: 'read' (visible, locked).

MASTER-BUILD-PROMPT.md §3 names field visibility as FOUR states —
"hide · read (locked) · masked" — mirroring app-rbac.js's fieldMode(), which
returns edit/read/hidden/masked. This codebase's schema only ever had THREE
(role_permission_fields.mode: show/mask/hide, enforced by ck_rpf_mode) — a
field on this system could be shown-and-editable, obscured, or absent, but
never "shown, and you can look but not touch," which is exactly the
prototype's own Salary Structure rule for HR/Accountant/Manager
(app-rbac.js:264, gated by 'Allow HR to Edit Salary Structure') and Vendor's
GSTIN/PAN/bank fields for Manager (app-rbac.js:263). Both were only
approximable before this migration by hiding the field outright, which is a
different and more restrictive thing than the spec actually asks for.

'read' means: the value is present in the API response (never stripped —
app/core/serialization/masking.py's apply_field_masking only acts on 'hide'
and 'mask', so 'read' passes straight through unchanged), and the frontend
renders it as non-editable with app-rbac.js's lockReason concept surfaced —
see role_permission_fields.mask_reason, whose name predates this migration
but whose purpose (explain why the default was overridden) already covers
'read' rows too.
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE role_permission_fields DROP CHECK ck_rpf_mode")
    op.execute("ALTER TABLE role_permission_fields ADD CONSTRAINT ck_rpf_mode CHECK (mode IN ('show','read','mask','hide'))")


def downgrade() -> None:
    # Any existing 'read' rows would violate the narrowed constraint — same
    # "the operator's problem to resolve first" stance every other narrowing
    # downgrade in this project takes (there is no silent data-loss path).
    op.execute("ALTER TABLE role_permission_fields DROP CHECK ck_rpf_mode")
    op.execute("ALTER TABLE role_permission_fields ADD CONSTRAINT ck_rpf_mode CHECK (mode IN ('show','mask','hide'))")
