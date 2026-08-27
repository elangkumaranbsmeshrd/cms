"""Give Company Profile the biometric-attendance switch Masters §3.6 requires.

The spec adds two fields, marked "New in this revision":

    Biometric Attendance          Toggle (On/Off), required, defaults to Off
    Biometric Device Endpoint     Text, required when the toggle is On

Neither existed anywhere — not on the screen, not in the schema, not in the
model. A spec-inventory pass found them absent at every layer.

This is not cosmetic. §3.6 defines the toggle as an input-source gate, and its
Off state as an active refusal: "any inbound device payload is rejected", and
Payroll → Attendance's Biometric Feed tab must show the integration as
"available-but-inactive rather than pretending a device exists". Without a
stored value there is nothing for that check to read, so the only safe default
is the one the spec names — Off. Hence server_default '0' rather than a
nullable column: an existing row must come out of this migration explicitly
NOT accepting device writes, never as an ambiguous NULL that some later caller
might read as permission.

The endpoint column is nullable because its requirement is conditional — it is
only mandatory while the toggle is On, which is a rule the API enforces
(a CHECK could not express it without also rejecting every currently-valid row
that has the toggle Off and no endpoint).

Switching the toggle never alters attendance already recorded and never changes
how hours are calculated; §3.6 is explicit that this is an input-source switch,
not a calculation setting. So there is no data backfill here, and none is owed.

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "company_profile",
        sa.Column("biometric_attendance", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "company_profile",
        sa.Column("biometric_device_endpoint", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("company_profile", "biometric_device_endpoint")
    op.drop_column("company_profile", "biometric_attendance")
