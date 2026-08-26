"""Adds `approval_status` to `vendors` (07-vendor-module.md §6.1: "Require
Approval to Add a New Vendor" — OFF by default: any role with vendor access
adds one directly. Turned ON: new vendors need Accountant or Super Admin
sign-off before they can be used on a Purchase Bill.

Previously deferred — the doc's own "Deferred/not implemented" note said
plainly "no approval workflow — vendors are created directly." Unlike the
same-shaped Leave HR-co-approval and Payroll reissue-approval deferrals
(both genuinely blocked by a CHECK constraint or an append-only trigger),
nothing here blocks a real column: `vendors` has no such constraint and is
freely UPDATE-able (update_vendor already does full-field replaces), so this
one gets built for real rather than deferred a third time.
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE vendors ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'")
    op.execute("ALTER TABLE vendors ADD CONSTRAINT ck_vendors_approval_status CHECK (approval_status IN ('approved', 'pending_approval'))")


def downgrade() -> None:
    op.execute("ALTER TABLE vendors DROP CHECK ck_vendors_approval_status")
    op.execute("ALTER TABLE vendors DROP COLUMN approval_status")
