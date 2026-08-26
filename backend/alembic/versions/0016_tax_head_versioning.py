"""Let a Tax Head be re-versioned under its own name.

Masters §3.19 gives tax heads an `applies_from` date precisely so a rate can
change over time, and `masters_taxes.py`'s own "figures are locked" 409 tells
the user to "use Duplicate instead" once a head has been used in a real
calculation. But Duplicate could never satisfy that instruction: the unique
key was (scope, tax_name) with no date component, so a second dated version of
"Professional Tax" under the same name was rejected by MySQL 1062 before any
router logic ran. The advice and the schema contradicted each other, and the
user was left in a closed loop — PUT says use Duplicate, Duplicate says rename.

Adding `applies_from` to the key is the minimal, data-preserving fix. It keeps
the property that actually matters — one head per Scope + Name *in force from a
given date* — so a genuine accidental duplicate is still rejected, while a new
dated version is now allowed.

The new key is strictly weaker than the old one, so every existing row already
satisfies it; verified against the live schema before writing this (zero rows
share a scope + tax_name + applies_from triple).

Revision ID: 0016
Revises: 0015
"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ux_tax_heads_scope_name", "tax_heads", type_="unique")
    op.create_unique_constraint(
        "ux_tax_heads_scope_name_from",
        "tax_heads",
        ["scope", "tax_name", "applies_from"],
    )


def downgrade() -> None:
    # Deliberately note-worthy: this direction can fail, and that is correct
    # rather than something to force. Once a head has been genuinely
    # re-versioned (two rows sharing scope + tax_name on different dates), the
    # old two-column key no longer describes the data. Collapsing it silently
    # would mean choosing which dated version to destroy, which no migration
    # should decide on its own. Resolve the duplicates first, then downgrade.
    op.drop_constraint("ux_tax_heads_scope_name_from", "tax_heads", type_="unique")
    op.create_unique_constraint(
        "ux_tax_heads_scope_name",
        "tax_heads",
        ["scope", "tax_name"],
    )
