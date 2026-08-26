"""Adds `code` to the 9 simple lookups the prototype shows a Code column for
but the schema never carried, plus `default_useful_life_years` on Asset
Categories.

MASTERS-COMPLETION-PROMPT.md §3a: the prototype's shape for every simple
lookup is "Name | Code | Status | Used" — verified against `data.js` for all
of them. `departments` already has `code` (migration 0002); these nine never
did: payment_modes, designations, service_categories, units_of_measure,
ticket_categories, customer_statuses, customer_sources, asset_categories,
employment_types. `code` is nullable (existing rows have none, and not every
future row will either — this is a convenience label, not a generated key
like Number Prefix Rules' codes) and unique per table; MySQL treats multiple
NULLs as distinct under a UNIQUE key, so any number of code-less rows can
coexist without colliding.

`default_useful_life_years` on `asset_categories` is a separate, unrelated
addition bundled into the same migration only because it targets the same
table this pass is already touching — the prototype's own form hint: "feeds
the Straight Line depreciation calculation" (matches Asset.useful_life_years,
migration 0006, same Integer type, so a category's default and an asset's
own override are always directly comparable).

No `is_referenced` column here — that's computed live per §3a's own
instruction ("pick one [pattern] and use it everywhere"), matching
`masters_bank_accounts.py`'s existing `_referenced_account_ids` approach
(a query against whatever real FKs exist today), not a stored counter like
`ExpenseType.usage_count` — a stored counter needs the CONSUMING module to
increment it, and most of these nine are consumed by modules with no
frontend yet. Nothing to migrate for a value that's never stored.
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_CODE_TABLES = [
    ("payment_modes", "ux_payment_modes_code", 20),
    ("designations", "ux_designations_code", 30),
    ("service_categories", "ux_service_categories_code", 30),
    ("units_of_measure", "ux_units_of_measure_code", 20),
    ("ticket_categories", "ux_ticket_categories_code", 30),
    ("customer_statuses", "ux_customer_statuses_code", 20),
    ("customer_sources", "ux_customer_sources_code", 20),
    ("asset_categories", "ux_asset_categories_code", 30),
    ("employment_types", "ux_employment_types_code", 20),
]


def upgrade() -> None:
    for table, constraint, length in _CODE_TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN code VARCHAR({length}) NULL")
        op.execute(f"ALTER TABLE {table} ADD UNIQUE KEY {constraint} (code)")
    op.execute("ALTER TABLE asset_categories ADD COLUMN default_useful_life_years INT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE asset_categories DROP COLUMN default_useful_life_years")
    for table, constraint, _length in reversed(_CODE_TABLES):
        op.execute(f"ALTER TABLE {table} DROP KEY {constraint}")
        op.execute(f"ALTER TABLE {table} DROP COLUMN code")
