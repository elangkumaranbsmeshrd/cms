"""Customer module (08-customer-module.md), production-readiness pass:

- `customers.last_activity_date` — backs the doc's own deferred "Last
  Activity date range" Directory filter, a plain rollup written by
  POST /customers/{id}/activities (same pattern as total_invoiced/received).
  NULL for a customer with no logged activity yet.
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE customers ADD COLUMN last_activity_date DATE NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE customers DROP COLUMN last_activity_date")
