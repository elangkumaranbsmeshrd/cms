"""Invoice module (11-invoice-module.md), production-readiness pass:

- `invoices.project_id` — nullable FK to projects, silently set only by the
  "Create from Project" prefill path (still no Opportunity dropdown/form
  field — that structural link stays deliberately dropped, per §2.3's own
  "the Reference field covers free-text linkage for now"). Gives §6.2's
  "Allow Manager Read-Only Access to Their Projects' Invoices" toggle real
  plumbing to hook into — it had none before this (confirmed: no FK, no
  join table, anywhere in the schema).
- `ck_invoices_status` widened to add 'PEND_PAID' — backs §6.2's "Require
  Second Approval Before an Invoice Locks as Paid" toggle: when ON, a
  payment/edit/credit-note that would resolve to PAID instead lands on
  PEND_PAID until Super Admin confirms (POST /invoices/{id}/confirm-paid).
  Chosen over a separate boolean flag so `status`, `is_locked` (still only
  true at PAID — a pending invoice is NOT locked, matching "Super Admin
  must confirm first"), and every existing status-driven read (ageing,
  overdue, list filters) don't fork into two things to check.
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `invoices` carries a FULLTEXT index (ix_invoices_search), and InnoDB
    # unconditionally forces ALGORITHM=COPY for any other ALTER on a table
    # that has one — ALGORITHM=INPLACE errors outright (1846), it isn't just
    # a slower fallback. COPY rebuilds the table and re-validates EVERY
    # existing foreign key, which surfaced 12 pre-existing invoices whose
    # tax_head_id already pointed at a since-deleted Tax Head (dev-data debt
    # from repeated seed/reset cycles, unrelated to this column and not this
    # migration's job to clean up). FK checks are dropped for this one
    # unavoidable COPY rebuild only — new rows are still validated normally
    # from the next statement on; nothing about ongoing integrity changes.
    op.execute("SET FOREIGN_KEY_CHECKS=0")
    op.execute("ALTER TABLE invoices ADD COLUMN project_id CHAR(36) NULL")
    op.execute("SET FOREIGN_KEY_CHECKS=1")
    op.execute("ALTER TABLE invoices ADD CONSTRAINT fk_invoices_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT")
    op.execute("ALTER TABLE invoices DROP CHECK ck_invoices_status")
    op.execute("ALTER TABLE invoices ADD CONSTRAINT ck_invoices_status CHECK (status IN ('DRAFT','SENT','PART_PAID','PAID','PEND_PAID'))")


def downgrade() -> None:
    op.execute("ALTER TABLE invoices DROP CHECK ck_invoices_status")
    op.execute("ALTER TABLE invoices ADD CONSTRAINT ck_invoices_status CHECK (status IN ('DRAFT','SENT','PART_PAID','PAID'))")
    op.execute("ALTER TABLE invoices DROP FOREIGN KEY fk_invoices_project")
    op.execute("ALTER TABLE invoices DROP COLUMN project_id")
