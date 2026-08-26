"""Expense module (12-expense-module.md), production-readiness pass:

- `feature_toggles.numeric_value` — platform-wide, nullable. §6.1's "Set an
  Auto-Approval Threshold" toggle is the first one that needs a companion
  number, not just on/off (expenses.py's own QUEUED/NOT BUILT comment named
  this exact gap: "FeatureToggle is `enabled: bool` only — there is nowhere
  to store the auto-approval threshold amount itself"). Added to the shared
  FeatureToggle table rather than an Expense-only side table, so the same
  RBAC admin Toggles panel that already edits every other toggle can edit
  this one too — most toggles simply never set it.
- `expense_claims.manager_approved_by` / `manager_approved_at` — backs §6.1's
  "Allow Manager to Approve Their Team's Expenses" toggle, a real sign-off
  step distinct from Accountant's own `approved_by`/`approved_at` (conflating
  the two would make "who actually gave final approval" ambiguous).
- `ck_expclaims_status` widened to add 'MGR_APPROVED' — the intermediate
  status between Pending and Approved that step produces. 12 characters,
  fits the existing `status VARCHAR(12)` with no column-width change needed.
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE feature_toggles ADD COLUMN numeric_value DECIMAL(14,2) NULL")
    # expense_claims carries several FKs (expense_type_id among them) with
    # pre-existing orphaned dev-data rows — any ALTER on this table can
    # trigger MySQL's COPY algorithm, which re-validates every existing FK
    # and fails on that unrelated orphan. Same fix as 0014_invoice_gaps.py's
    # identical situation: drop FK checks for this table's own ALTERs only.
    op.execute("SET FOREIGN_KEY_CHECKS=0")
    op.execute("ALTER TABLE expense_claims ADD COLUMN manager_approved_by CHAR(36) NULL")
    op.execute("ALTER TABLE expense_claims ADD COLUMN manager_approved_at DATETIME(6) NULL")
    op.execute("ALTER TABLE expense_claims ADD CONSTRAINT fk_expclaims_manager_approved_by FOREIGN KEY (manager_approved_by) REFERENCES users(id) ON DELETE RESTRICT")
    op.execute("ALTER TABLE expense_claims DROP CHECK ck_expclaims_status")
    op.execute("ALTER TABLE expense_claims ADD CONSTRAINT ck_expclaims_status CHECK (status IN ('PENDING','MGR_APPROVED','APPROVED','REIMBURSED','REJECTED'))")
    op.execute("SET FOREIGN_KEY_CHECKS=1")


def downgrade() -> None:
    op.execute("ALTER TABLE expense_claims DROP CHECK ck_expclaims_status")
    op.execute("ALTER TABLE expense_claims ADD CONSTRAINT ck_expclaims_status CHECK (status IN ('PENDING','APPROVED','REIMBURSED','REJECTED'))")
    op.execute("ALTER TABLE expense_claims DROP FOREIGN KEY fk_expclaims_manager_approved_by")
    op.execute("ALTER TABLE expense_claims DROP COLUMN manager_approved_at")
    op.execute("ALTER TABLE expense_claims DROP COLUMN manager_approved_by")
    op.execute("ALTER TABLE feature_toggles DROP COLUMN numeric_value")
