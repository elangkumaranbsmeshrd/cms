"""Phase 4 — Finance (08-customer-module.md pulled forward + 07-vendor,
13-purchase-bill, 11-invoice/credit-note, 12-expense modules). 18 tables.

CUSTOMER PULLED FORWARD FROM PHASE 5: Invoice/Credit Note need a real
`customers` FK target, and BUILD-PROMPT's phase table scopes Customer to
Phase 5 (Operations) — a genuine ordering gap in the phased plan, surfaced
and resolved on explicit instruction: build the full Customer module now,
not a stub. Its Customer 360 tabs for Opportunities/Projects/Tickets stay
read-only-empty until those modules exist (Phase 5) — Opportunity/Project
have no tables yet, so `customers` carries no FK toward them; those tabs are
a forward dependency, same pattern as Invoice Dashboard's cross-module
widgets.

Same MySQL dialect discipline as 0001-0004 (VARCHAR+CHECK instead of native
ENUM, generated-column singleton/guard tricks for partial uniques, RESTRICT
instead of CASCADE on any FK a same-table generated column depends on,
snapshot columns everywhere money/identity crosses a document boundary).

ARCHITECTURAL DEVIATION FROM ARCH-1, same split as every prior phase:
ARCH-1's original design leans on ~15 rollup triggers (vendor usage counts,
purchase_bill/invoice subtotal-from-lines and paid-from-payments,
credit_note_total, customer total_invoiced/received). None of those are
triggers here — the API computes and writes these plain columns directly
(new services: `invoice_engine.py`, `purchase_bill_engine.py` reusing
`tax_engine.calculate_tax` exactly as Payroll/Salary Structure already do).
What DOES stay a real trigger: FY-lock on every table, Tier-2/3 immutability
(credit notes and reversed payments never hard-deleted), and the ONE
uniqueness guard this phase's acceptance gate depends on — the 1:1
expense-claim <-> purchase-bill link (`ux_expclaims_linked_bill` /
`ux_pbills_linked_claim`). The actual double-payment PREVENTION (not just
the 1:1 link existing) is a service-layer check in the payment/reimbursement
endpoints — reusing this project's now-established "a link this consequential
needs a business-rule check, not just a DB uniqueness guard" pattern (same
reasoning as A116's dual-layer guard in Payroll).

Two real ARCH-1 schema bugs found and fixed here (not carried forward):
  1. `invoice_payments` was never actually given the withholding columns its
     own sibling `invoices` table's comments describe reading from
     (`withheld_amount` etc.) — added for real here (A276's mirror on the
     receivable side).
  2. `invoices.settled_amount`'s documented formula referenced a column
     name (`amount_received`) that didn't match the table's own paid-rollup
     column (`amount_paid`) elsewhere in the same document — resolved by
     naming the rollup `amount_received` throughout, matching the module
     spec's own post-2026-07-31 terminology ("Paid = Sum of Amount Received").

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-01
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ================================================================ customers
    op.execute("""
        CREATE TABLE customers (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            customer_code               VARCHAR(191)  NOT NULL,
            financial_year_id           CHAR(36)      NOT NULL,
            company_name                VARCHAR(200)  NOT NULL,
            display_name                VARCHAR(200)  NULL,
            gstin                       VARCHAR(15)   NULL,
            pan                         VARCHAR(10)   NULL,
            status_id                   CHAR(36)      NOT NULL,
            source_id                   CHAR(36)      NULL,
            website                     VARCHAR(255)  NULL,
            notes                       TEXT          NULL,
            mobile_number                VARCHAR(10)  NULL,
            email                       VARCHAR(191)  NULL,
            address                     TEXT          NULL,
            owner_id                    CHAR(36)      NULL,
            -- Reconciliation aid (§2.1) — who a payment arrives FROM. Never
            -- a payment instruction, both nullable (a Prospect who's never
            -- paid anything correctly has neither).
            bank_account_name           VARCHAR(191)  NULL,
            bank_name                   VARCHAR(191)  NULL,
            bank_account_number         VARCHAR(34)   NULL,
            bank_account_number_masked  VARCHAR(50)   GENERATED ALWAYS AS (
                CASE WHEN bank_account_number IS NULL THEN NULL
                ELSE CONCAT(COALESCE(bank_name, ''), ' ••••', SUBSTR(bank_account_number, -4)) END
            ) STORED,
            -- "Collected Into" — which Meshrd account this customer's
            -- payments normally land in, carried FROM their invoices' Bank
            -- Account. A rollup, not a typed field — plain, API-written
            -- (invoice_engine updates it when an invoice is raised/edited).
            collected_into_bank_account_id CHAR(36)    NULL,
            total_invoiced              DECIMAL(14,2) NOT NULL DEFAULT 0,
            received                    DECIMAL(14,2) NOT NULL DEFAULT 0,
            outstanding                 DECIMAL(14,2) GENERATED ALWAYS AS (total_invoiced - received) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_customers_code (customer_code),
            KEY ix_customers_status (status_id),
            KEY ix_customers_owner (owner_id),
            FULLTEXT KEY ix_customers_search (company_name, display_name, gstin, mobile_number, email),
            CONSTRAINT ck_customers_company_name CHECK (CHAR_LENGTH(TRIM(company_name)) BETWEEN 2 AND 200),
            CONSTRAINT ck_customers_gstin CHECK (gstin IS NULL OR gstin REGEXP '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
            CONSTRAINT ck_customers_pan CHECK (pan IS NULL OR pan REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'),
            CONSTRAINT ck_customers_mobile CHECK (mobile_number IS NULL OR mobile_number REGEXP '^[6-9][0-9]{9}$'),
            CONSTRAINT fk_customers_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_status FOREIGN KEY (status_id) REFERENCES customer_statuses(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_source FOREIGN KEY (source_id) REFERENCES customer_sources(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_owner FOREIGN KEY (owner_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_bank FOREIGN KEY (collected_into_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_customers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ========================================================= customer_contacts
    op.execute("""
        CREATE TABLE customer_contacts (
            id             CHAR(36)      NOT NULL PRIMARY KEY,
            customer_id    CHAR(36)      NOT NULL,
            name           VARCHAR(191)  NOT NULL,
            designation    VARCHAR(191)  NULL,
            email          VARCHAR(191)  NULL,
            phone          VARCHAR(10)   NULL,
            is_primary     TINYINT(1)    NOT NULL DEFAULT 0,
            -- One Primary per customer: generated-column singleton-guard
            -- trick (D0.1) — NULL when not primary, customer_id when it is,
            -- so only one TRUE-primary row per customer can ever exist.
            primary_guard  CHAR(36)      GENERATED ALWAYS AS (IF(is_primary = 1, customer_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_custcontacts_one_primary (primary_guard),
            KEY ix_custcontacts_customer (customer_id),
            CONSTRAINT ck_custcontacts_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$'),
            -- RESTRICT, not CASCADE: primary_guard (a STORED GENERATED
            -- column above) depends on customer_id — MySQL error 1215
            -- rejects CASCADE on any column a same-table generated column
            -- depends on (same limitation found on tax_head_slab_bands in
            -- Phase 1). Moot anyway since customers are never hard-deleted.
            CONSTRAINT fk_custcontacts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custcontacts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custcontacts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ======================================================== customer_activities
    op.execute("""
        CREATE TABLE customer_activities (
            id                 CHAR(36)      NOT NULL PRIMARY KEY,
            customer_id        CHAR(36)      NOT NULL,
            activity_type      VARCHAR(10)   NOT NULL,
            activity_date      DATE          NOT NULL,
            description        TEXT          NOT NULL,
            related_contact_id CHAR(36)      NULL,
            logged_by          CHAR(36)      NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_custactivities_customer (customer_id, activity_date),
            CONSTRAINT ck_custactivities_type CHECK (activity_type IN ('CALL','EMAIL','MEETING','NOTE')),
            CONSTRAINT ck_custactivities_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT fk_custactivities_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
            CONSTRAINT fk_custactivities_contact FOREIGN KEY (related_contact_id) REFERENCES customer_contacts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custactivities_logged_by FOREIGN KEY (logged_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custactivities_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custactivities_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================ customer_files
    op.execute("""
        CREATE TABLE customer_files (
            id             CHAR(36) NOT NULL PRIMARY KEY,
            customer_id    CHAR(36) NOT NULL,
            stored_file_id CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_custfiles_customer (customer_id),
            CONSTRAINT fk_custfiles_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
            CONSTRAINT fk_custfiles_file FOREIGN KEY (stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custfiles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_custfiles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================================== vendors
    op.execute("""
        CREATE TABLE vendors (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            vendor_name                 VARCHAR(150)  NOT NULL,
            vendor_category             VARCHAR(191)  NULL,
            gstin                       VARCHAR(15)   NULL,
            pan                         VARCHAR(10)   NULL,
            contact_email               VARCHAR(191)  NULL,
            contact_phone               VARCHAR(10)   NULL,
            payment_terms_days          INT           NOT NULL DEFAULT 30,
            address_street              VARCHAR(191)  NULL,
            address_city                VARCHAR(120)  NULL,
            -- No Masters sub-master for State on this record — matches
            -- ARCH-1's own note, plain text validated client-side, same as
            -- every other free-text address field in this schema.
            address_state               VARCHAR(120)  NULL,
            address_pin_code            VARCHAR(6)    NULL,
            -- Account NAME is primary, number is secondary (Appendix B,
            -- verbatim) — a masked number alone answers nothing; order the
            -- columns and every screen accordingly, everywhere in this phase.
            bank_account_name           VARCHAR(191)  NULL,
            bank_name                   VARCHAR(191)  NULL,
            bank_account_number         VARCHAR(34)   NULL,
            bank_account_number_masked  VARCHAR(50)   GENERATED ALWAYS AS (
                CASE WHEN bank_account_number IS NULL THEN NULL
                ELSE CONCAT(COALESCE(bank_name, ''), ' ••••', SUBSTR(bank_account_number, -4)) END
            ) STORED,
            ifsc_code                   VARCHAR(11)   NULL,
            has_bank_details             TINYINT(1)   GENERATED ALWAYS AS (bank_account_number IS NOT NULL) STORED,
            is_active                   TINYINT(1)    NOT NULL DEFAULT 1,
            deactivated_at              DATETIME(6)   NULL,
            deactivated_by              CHAR(36)      NULL,
            deactivation_reason         TEXT          NULL,
            created_inline              TINYINT(1)    NOT NULL DEFAULT 0,
            -- Rollups (plain, API-written — see module docstring). Drive
            -- the Delete-vs-Deactivate reference guard: Delete button is
            -- simply not offered once has_usage_history is true.
            purchase_bill_count         INT           NOT NULL DEFAULT 0,
            expense_count               INT           NOT NULL DEFAULT 0,
            has_usage_history           TINYINT(1)    NOT NULL DEFAULT 0,
            outstanding_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_spend                 DECIMAL(14,2) NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            FULLTEXT KEY ix_vendors_search (vendor_name, gstin, bank_account_name),
            CONSTRAINT ck_vendors_name CHECK (CHAR_LENGTH(TRIM(vendor_name)) BETWEEN 2 AND 150),
            CONSTRAINT ck_vendors_gstin CHECK (gstin IS NULL OR gstin REGEXP '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
            CONSTRAINT ck_vendors_pan CHECK (pan IS NULL OR pan REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'),
            CONSTRAINT ck_vendors_phone CHECK (contact_phone IS NULL OR contact_phone REGEXP '^[6-9][0-9]{9}$'),
            CONSTRAINT ck_vendors_pin CHECK (address_pin_code IS NULL OR address_pin_code REGEXP '^[0-9]{6}$'),
            CONSTRAINT ck_vendors_ifsc CHECK (ifsc_code IS NULL OR ifsc_code REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'),
            CONSTRAINT ck_vendors_terms CHECK (payment_terms_days > 0),
            CONSTRAINT fk_vendors_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_vendors_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_vendors_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================ purchase_bills
    # linked_expense_claim_id's FK is added via trailing ALTER once
    # expense_claims exists later in this same migration (circular
    # reference — expense_claims.linked_purchase_bill_id points back here).
    op.execute("""
        CREATE TABLE purchase_bills (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            purchase_bill_code              VARCHAR(191)  NOT NULL,
            vendor_bill_number              VARCHAR(191)  NOT NULL,
            vendor_id                       CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            vendor_name_snapshot            VARCHAR(150)  NOT NULL,
            vendor_gstin_snapshot           VARCHAR(15)   NULL,
            bill_date                       DATE          NOT NULL,
            due_date                        DATE          NULL,
            payment_terms_days_snapshot     INT           NULL,
            attachment_stored_file_id       CHAR(36)      NULL,
            has_attachment                  TINYINT(1)    GENERATED ALWAYS AS (attachment_stored_file_id IS NOT NULL) STORED,
            bank_account_id                 CHAR(36)      NULL,
            linked_expense_claim_id         CHAR(36)      NULL,
            subtotal                        DECIMAL(14,2) NOT NULL DEFAULT 0,
            tax_head_id                     CHAR(36)      NULL,
            tax_amount                      DECIMAL(14,2) NOT NULL DEFAULT 0,
            tax_amount_is_manual_override   TINYINT(1)    NOT NULL DEFAULT 0,
            total_amount                    DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount) STORED,
            withholding_tax_head_id         CHAR(36)      NULL,
            withholding_calculated_on       VARCHAR(10)   NULL,
            withholding_amount              DECIMAL(14,2) NOT NULL DEFAULT 0,
            withholding_amount_is_manual_override TINYINT(1) NOT NULL DEFAULT 0,
            withholding_head_name_snapshot  VARCHAR(191)  NULL,
            withholding_rate_snapshot       DECIMAL(7,4)  NULL,
            amount_payable_to_vendor        DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount - withholding_amount) STORED,
            amount_paid                     DECIMAL(14,2) NOT NULL DEFAULT 0,
            -- Restated, not chained through amount_payable_to_vendor — MySQL
            -- forbids a generated column referencing another generated
            -- column (same "spell it out again" pattern as Payroll's
            -- total_deductions/net_pay).
            balance_due                     DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount - withholding_amount - amount_paid) STORED,
            status                          VARCHAR(10)   NOT NULL DEFAULT 'UNPAID',
            paid_at                         DATETIME(6)   NULL,
            notes                           TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_pbills_code (purchase_bill_code),
            UNIQUE KEY ux_pbills_linked_claim (linked_expense_claim_id),
            KEY ix_pbills_vendor (vendor_id),
            KEY ix_pbills_status (status),
            FULLTEXT KEY ix_pbills_search (purchase_bill_code, vendor_bill_number, vendor_name_snapshot),
            CONSTRAINT ck_pbills_vendor_bill_number CHECK (CHAR_LENGTH(TRIM(vendor_bill_number)) > 0),
            CONSTRAINT ck_pbills_due_after_bill CHECK (due_date IS NULL OR due_date >= bill_date),
            CONSTRAINT ck_pbills_tax_amount CHECK (tax_amount >= 0),
            CONSTRAINT ck_pbills_withholding_basis CHECK (withholding_calculated_on IS NULL OR withholding_calculated_on IN ('SUBTOTAL','TOTAL')),
            CONSTRAINT ck_pbills_withholding_amount CHECK (withholding_amount >= 0 AND withholding_amount <= subtotal + tax_amount),
            CONSTRAINT ck_pbills_status CHECK (status IN ('UNPAID','PART_PAID','PAID')),
            CONSTRAINT fk_pbills_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_attachment FOREIGN KEY (attachment_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_bank FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_withholding_head FOREIGN KEY (withholding_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbills_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ================================================= purchase_bill_line_items
    op.execute("""
        CREATE TABLE purchase_bill_line_items (
            id                 CHAR(36)      NOT NULL PRIMARY KEY,
            purchase_bill_id   CHAR(36)      NOT NULL,
            sequence           INT           NOT NULL,
            description        VARCHAR(500)  NOT NULL,
            hsn_code_id        CHAR(36)      NULL,
            hsn_code_snapshot  VARCHAR(20)   NULL,
            quantity           DECIMAL(14,2) NOT NULL,
            rate               DECIMAL(14,2) NOT NULL,
            line_total         DECIMAL(14,2) GENERATED ALWAYS AS (quantity * rate) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_pbillines_bill (purchase_bill_id),
            CONSTRAINT ck_pbillines_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT ck_pbillines_qty CHECK (quantity > 0),
            CONSTRAINT ck_pbillines_rate CHECK (rate > 0),
            CONSTRAINT fk_pbillines_bill FOREIGN KEY (purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE CASCADE,
            CONSTRAINT fk_pbillines_hsn FOREIGN KEY (hsn_code_id) REFERENCES hsn_sac_codes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillines_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ================================================== purchase_bill_tax_lines
    op.execute("""
        CREATE TABLE purchase_bill_tax_lines (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            purchase_bill_id          CHAR(36)      NOT NULL,
            sequence                  INT           NOT NULL,
            tax_head_id               CHAR(36)      NULL,
            head_name_snapshot        VARCHAR(191)  NULL,
            print_label_snapshot      VARCHAR(191)  NULL,
            scope_snapshot            VARCHAR(40)   NULL,
            tax_type_snapshot         VARCHAR(20)   NULL,
            rate_snapshot             DECIMAL(7,4)  NULL,
            cgst_rate_snapshot        DECIMAL(7,4)  NULL,
            sgst_rate_snapshot        DECIMAL(7,4)  NULL,
            fixed_amount_snapshot     DECIMAL(14,2) NULL,
            computed_base             DECIMAL(14,2) NOT NULL,
            computed_amount           DECIMAL(14,2) NOT NULL,
            entered_amount            DECIMAL(14,2) NOT NULL,
            parent_line_id            CHAR(36)      NULL,
            component_name_snapshot   VARCHAR(191)  NULL,
            share_pct_snapshot        DECIMAL(6,2)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_pbilltax_bill (purchase_bill_id),
            CONSTRAINT fk_pbilltax_bill FOREIGN KEY (purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE CASCADE,
            CONSTRAINT fk_pbilltax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbilltax_parent FOREIGN KEY (parent_line_id) REFERENCES purchase_bill_tax_lines(id) ON DELETE CASCADE,
            CONSTRAINT fk_pbilltax_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbilltax_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================== purchase_bill_payments
    op.execute("""
        CREATE TABLE purchase_bill_payments (
            id                                       CHAR(36)      NOT NULL PRIMARY KEY,
            purchase_bill_id                         CHAR(36)      NOT NULL,
            vendor_id                                CHAR(36)      NOT NULL,
            financial_year_id                        CHAR(36)      NOT NULL,
            amount                                   DECIMAL(14,2) NOT NULL,
            balance_due_at_entry                     DECIMAL(14,2) NOT NULL,
            payment_mode_id                          CHAR(36)      NOT NULL,
            paid_from_bank_account_id                CHAR(36)      NULL,
            -- Snapshotted at insert, never resolved live — "a historic
            -- payment still shows where it went after the vendor changes
            -- details" (Appendix B, verbatim).
            paid_into_account_name_snapshot          VARCHAR(191)  NULL,
            paid_into_bank_name_snapshot             VARCHAR(191)  NULL,
            paid_into_account_number_masked_snapshot VARCHAR(50)   NULL,
            paid_into_ifsc_snapshot                  VARCHAR(11)   NULL,
            payment_date                             DATE          NOT NULL,
            reference                                VARCHAR(191)  NULL,
            status                                   VARCHAR(10)   NOT NULL DEFAULT 'RECORDED',
            reversed_at                              DATETIME(6)   NULL,
            reversed_by                              CHAR(36)      NULL,
            reversal_reason                          TEXT          NULL,
            recorded_by                              CHAR(36)      NOT NULL,
            recorded_at                              DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_pbillpay_bill (purchase_bill_id),
            KEY ix_pbillpay_vendor (vendor_id),
            CONSTRAINT ck_pbillpay_amount CHECK (amount > 0),
            CONSTRAINT ck_pbillpay_status CHECK (status IN ('RECORDED','REVERSED')),
            CONSTRAINT ck_pbillpay_reversal CHECK (status <> 'REVERSED' OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)),
            CONSTRAINT fk_pbillpay_bill FOREIGN KEY (purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_modes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_bank FOREIGN KEY (paid_from_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_reversed_by FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pbillpay_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================================== invoices
    # No opportunity_id/project_id yet — Opportunity/Project (Phase 5) don't
    # exist. "Create from Opportunity/Project" pre-fill is a Phase 5
    # cross-phase ALTER, same pattern as every other forward-referencing
    # column this project has deferred (payroll_basis, queued_adjustment_id).
    op.execute("""
        CREATE TABLE invoices (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            invoice_number            VARCHAR(191)  NOT NULL,
            financial_year_id         CHAR(36)      NOT NULL,
            customer_id               CHAR(36)      NOT NULL,
            invoice_date              DATE          NOT NULL,
            due_date                  DATE          NULL,
            reference                 VARCHAR(191)  NULL,
            notes                     TEXT          NULL,
            customer_name_snapshot    VARCHAR(200)  NOT NULL,
            customer_address_snapshot TEXT          NULL,
            customer_gstin_snapshot   VARCHAR(15)   NULL,
            service_category_id       CHAR(36)      NULL,
            bank_account_id           CHAR(36)      NULL,
            subtotal                  DECIMAL(14,2) NOT NULL DEFAULT 0,
            tax_head_id               CHAR(36)      NULL,
            tax_amount                DECIMAL(14,2) NOT NULL DEFAULT 0,
            grand_total                DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount) STORED,
            -- "Paid" = Sum of Amount Received (module spec's own post-
            -- 2026-07-31 terminology) — named amount_received throughout,
            -- not amount_paid, so it agrees with settled_amount below.
            amount_received           DECIMAL(14,2) NOT NULL DEFAULT 0,
            credit_note_total         DECIMAL(14,2) NOT NULL DEFAULT 0,
            claim_amount              DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount - credit_note_total) STORED,
            withheld_total            DECIMAL(14,2) NOT NULL DEFAULT 0,
            settled_amount            DECIMAL(14,2) GENERATED ALWAYS AS (amount_received + withheld_total) STORED,
            -- Restated (not chained through claim_amount/settled_amount)
            -- for the same MySQL generated-on-generated reason as Purchase
            -- Bill's balance_due above.
            balance_due               DECIMAL(14,2) GENERATED ALWAYS AS (subtotal + tax_amount - credit_note_total - amount_received - withheld_total) STORED,
            status                    VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            sent_at                   DATETIME(6)   NULL,
            sent_by                   CHAR(36)      NULL,
            paid_at                   DATETIME(6)   NULL,
            -- Unconditional (no RBAC toggle, unlike Purchase Bill's opt-in
            -- lock) — §2.3's lock is a hard rule, not a per-company setting.
            is_locked                 TINYINT(1)    GENERATED ALWAYS AS (status = 'PAID') STORED,
            pdf_stored_file_id        CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_invoices_number (invoice_number),
            KEY ix_invoices_customer (customer_id),
            KEY ix_invoices_status (status),
            FULLTEXT KEY ix_invoices_search (invoice_number, customer_name_snapshot, reference),
            CONSTRAINT ck_invoices_due_after_date CHECK (due_date IS NULL OR due_date >= invoice_date),
            CONSTRAINT ck_invoices_tax_amount CHECK (tax_amount >= 0),
            CONSTRAINT ck_invoices_status CHECK (status IN ('DRAFT','SENT','PART_PAID','PAID')),
            CONSTRAINT fk_invoices_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_service_category FOREIGN KEY (service_category_id) REFERENCES service_categories(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_bank FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_sent_by FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_pdf FOREIGN KEY (pdf_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invoices_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ======================================================= invoice_line_items
    op.execute("""
        CREATE TABLE invoice_line_items (
            id                CHAR(36)      NOT NULL PRIMARY KEY,
            invoice_id        CHAR(36)      NOT NULL,
            sequence          INT           NOT NULL,
            description       VARCHAR(500)  NOT NULL,
            hsn_code_id       CHAR(36)      NULL,
            hsn_code_snapshot VARCHAR(20)   NULL,
            quantity          DECIMAL(14,2) NOT NULL,
            rate              DECIMAL(14,2) NOT NULL,
            line_total        DECIMAL(14,2) GENERATED ALWAYS AS (quantity * rate) STORED,
            credited_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_invlines_invoice (invoice_id),
            CONSTRAINT ck_invlines_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT ck_invlines_qty CHECK (quantity > 0),
            CONSTRAINT ck_invlines_rate CHECK (rate > 0),
            CONSTRAINT fk_invlines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            CONSTRAINT fk_invlines_hsn FOREIGN KEY (hsn_code_id) REFERENCES hsn_sac_codes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invlines_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invlines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ========================================================== invoice_tax_lines
    op.execute("""
        CREATE TABLE invoice_tax_lines (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            invoice_id                CHAR(36)      NOT NULL,
            sequence                  INT           NOT NULL,
            tax_head_id               CHAR(36)      NULL,
            head_name_snapshot        VARCHAR(191)  NULL,
            print_label_snapshot      VARCHAR(191)  NULL,
            scope_snapshot            VARCHAR(40)   NULL,
            tax_type_snapshot         VARCHAR(20)   NULL,
            rate_snapshot             DECIMAL(7,4)  NULL,
            cgst_rate_snapshot        DECIMAL(7,4)  NULL,
            sgst_rate_snapshot        DECIMAL(7,4)  NULL,
            fixed_amount_snapshot     DECIMAL(14,2) NULL,
            computed_base             DECIMAL(14,2) NOT NULL,
            computed_amount           DECIMAL(14,2) NOT NULL,
            parent_line_id            CHAR(36)      NULL,
            component_name_snapshot   VARCHAR(191)  NULL,
            share_pct_snapshot        DECIMAL(6,2)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_invtax_invoice (invoice_id),
            CONSTRAINT fk_invtax_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
            CONSTRAINT fk_invtax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invtax_parent FOREIGN KEY (parent_line_id) REFERENCES invoice_tax_lines(id) ON DELETE CASCADE,
            CONSTRAINT fk_invtax_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invtax_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =========================================================== invoice_payments
    # The two ARCH-1 gaps fixed here (see module docstring): withholding
    # columns actually added, and named amount_received to match
    # invoices.amount_received/settled_amount.
    op.execute("""
        CREATE TABLE invoice_payments (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            invoice_id                      CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            amount_received                 DECIMAL(14,2) NOT NULL,
            balance_due_at_entry            DECIMAL(14,2) NOT NULL,
            customer_withheld_tax_head_id   CHAR(36)      NULL,
            tax_head_name_snapshot          VARCHAR(191)  NULL,
            print_label_snapshot            VARCHAR(191)  NULL,
            withholding_calculated_on       VARCHAR(12)   NULL,
            withheld_amount                 DECIMAL(14,2) NOT NULL DEFAULT 0,
            amount_settled                  DECIMAL(14,2) GENERATED ALWAYS AS (amount_received + withheld_amount) STORED,
            payment_mode_id                 CHAR(36)      NOT NULL,
            received_into_bank_account_id   CHAR(36)      NULL,
            payment_date                    DATE          NOT NULL,
            reference                       VARCHAR(191)  NULL,
            status                          VARCHAR(10)   NOT NULL DEFAULT 'RECORDED',
            reversed_at                     DATETIME(6)   NULL,
            reversed_by                     CHAR(36)      NULL,
            reversal_reason                 TEXT          NULL,
            recorded_by                     CHAR(36)      NOT NULL,
            recorded_at                     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_invpay_invoice (invoice_id),
            CONSTRAINT ck_invpay_amount CHECK (amount_received > 0),
            CONSTRAINT ck_invpay_withheld CHECK (withheld_amount >= 0),
            CONSTRAINT ck_invpay_basis CHECK (withholding_calculated_on IS NULL OR withholding_calculated_on IN ('SUBTOTAL','GRAND_TOTAL')),
            CONSTRAINT ck_invpay_status CHECK (status IN ('RECORDED','REVERSED')),
            CONSTRAINT ck_invpay_reversal CHECK (status <> 'REVERSED' OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)),
            CONSTRAINT fk_invpay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_wh_head FOREIGN KEY (customer_withheld_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_modes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_bank FOREIGN KEY (received_into_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_reversed_by FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_invpay_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =============================================================== credit_notes
    op.execute("""
        CREATE TABLE credit_notes (
            id                     CHAR(36)      NOT NULL PRIMARY KEY,
            credit_note_number     VARCHAR(191)  NOT NULL,
            invoice_id             CHAR(36)      NOT NULL,
            customer_id            CHAR(36)      NOT NULL,
            financial_year_id      CHAR(36)      NOT NULL,
            invoice_number_snapshot VARCHAR(191) NOT NULL,
            customer_name_snapshot VARCHAR(200)  NOT NULL,
            credit_note_date       DATE          NOT NULL,
            reason                 VARCHAR(30)   NOT NULL,
            reason_detail          TEXT          NOT NULL,
            credit_amount          DECIMAL(14,2) NOT NULL,
            status                 VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
            raised_by              CHAR(36)      NOT NULL,
            submitted_at           DATETIME(6)   NULL,
            approved_by            CHAR(36)      NULL,
            approved_at            DATETIME(6)   NULL,
            applied_to_invoice_at  DATETIME(6)   NULL,
            pdf_stored_file_id     CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_creditnotes_number (credit_note_number),
            KEY ix_creditnotes_invoice (invoice_id),
            KEY ix_creditnotes_customer (customer_id),
            FULLTEXT KEY ix_creditnotes_search (credit_note_number, invoice_number_snapshot, customer_name_snapshot),
            CONSTRAINT ck_creditnotes_reason CHECK (reason IN ('BILLING_ERROR','CUSTOMER_DISPUTE','GOODS_NOT_DELIVERED','OTHER')),
            CONSTRAINT ck_creditnotes_detail CHECK (CHAR_LENGTH(TRIM(reason_detail)) > 0),
            CONSTRAINT ck_creditnotes_amount CHECK (credit_amount > 0),
            CONSTRAINT ck_creditnotes_status CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED')),
            CONSTRAINT ck_creditnotes_approval CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
            CONSTRAINT fk_creditnotes_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_raised_by FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_pdf FOREIGN KEY (pdf_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditnotes_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ===================================================== credit_note_line_items
    op.execute("""
        CREATE TABLE credit_note_line_items (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            credit_note_id            CHAR(36)      NOT NULL,
            invoice_line_item_id      CHAR(36)      NULL,
            sequence                  INT           NOT NULL,
            description_snapshot      VARCHAR(500)  NOT NULL,
            quantity_snapshot         DECIMAL(14,2) NULL,
            rate_snapshot             DECIMAL(14,2) NULL,
            line_total_snapshot       DECIMAL(14,2) NOT NULL,
            credited_amount           DECIMAL(14,2) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_cnlines_creditnote (credit_note_id),
            CONSTRAINT ck_cnlines_credited CHECK (credited_amount > 0 AND credited_amount <= line_total_snapshot),
            CONSTRAINT fk_cnlines_creditnote FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE,
            CONSTRAINT fk_cnlines_invline FOREIGN KEY (invoice_line_item_id) REFERENCES invoice_line_items(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cnlines_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cnlines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================= expense_claims
    # A201: no auto-generated Expense number/code exists anywhere in this
    # table on purpose — identified by internal record id, exposed as the
    # Reference column on the Export Statement, per explicit instruction.
    op.execute("""
        CREATE TABLE expense_claims (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                     CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            expense_type_id                 CHAR(36)      NOT NULL,
            -- Snapshotted from expense_types.claim_type at creation, never
            -- submitter-chosen — the API stamps this, mirroring
            -- ExpenseType's own claim_type-changed audit trail (Masters).
            claim_type                      VARCHAR(20)   NOT NULL,
            expense_type_name_snapshot      VARCHAR(120)  NOT NULL,
            expense_type_short_code_snapshot VARCHAR(20)  NULL,
            is_recurring_type_snapshot      TINYINT(1)    NOT NULL DEFAULT 0,
            vendor_id                       CHAR(36)      NULL,
            amount                          DECIMAL(14,2) NOT NULL,
            tax_head_id                     CHAR(36)      NULL,
            tax_amount                      DECIMAL(14,2) NULL,
            tax_head_name_snapshot          VARCHAR(191)  NULL,
            expense_date                    DATE          NOT NULL,
            linked_purchase_bill_id         CHAR(36)      NULL,
            description                     TEXT          NOT NULL,
            receipt_stored_file_id          CHAR(36)      NULL,
            has_receipt                     TINYINT(1)    GENERATED ALWAYS AS (receipt_stored_file_id IS NOT NULL) STORED,
            bank_account_id                 CHAR(36)      NULL,
            status                          VARCHAR(12)   NOT NULL DEFAULT 'PENDING',
            submitted_at                    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            approved_by                     CHAR(36)      NULL,
            approved_at                     DATETIME(6)   NULL,
            rejected_by                     CHAR(36)      NULL,
            rejected_at                     DATETIME(6)   NULL,
            rejection_reason                TEXT          NULL,
            reimbursed_at                   DATETIME(6)   NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_expclaims_linked_bill (linked_purchase_bill_id),
            KEY ix_expclaims_employee (employee_id),
            KEY ix_expclaims_status (status),
            CONSTRAINT ck_expclaims_claim_type CHECK (claim_type IN ('REIMBURSABLE','COMPANY_PAID')),
            CONSTRAINT ck_expclaims_amount CHECK (amount > 0),
            CONSTRAINT ck_expclaims_tax_amount CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)),
            CONSTRAINT ck_expclaims_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT ck_expclaims_status CHECK (status IN ('PENDING','APPROVED','REIMBURSED','REJECTED')),
            CONSTRAINT ck_expclaims_rejection CHECK (status <> 'REJECTED' OR (rejected_by IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(rejection_reason, ''))) > 0)),
            CONSTRAINT fk_expclaims_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_type FOREIGN KEY (expense_type_id) REFERENCES expense_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_bill FOREIGN KEY (linked_purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_receipt FOREIGN KEY (receipt_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_bank FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_rejected_by FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expclaims_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # Trailing ALTER closing the circular reference deferred at purchase_bills'
    # own CREATE TABLE, above — same technique as every prior phase's
    # forward/circular references (queued_adjustment_id, monthly_hour_
    # reconciliations <-> payroll_run_employees).
    op.execute("""
        ALTER TABLE purchase_bills
            ADD CONSTRAINT fk_pbills_linked_claim FOREIGN KEY (linked_expense_claim_id) REFERENCES expense_claims(id) ON DELETE RESTRICT;
    """)

    # ======================================================= expense_reimbursements
    op.execute("""
        CREATE TABLE expense_reimbursements (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            expense_claim_id                CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            reimbursed_date                 DATE          NOT NULL,
            amount                          DECIMAL(14,2) NOT NULL,
            payment_mode_id                 CHAR(36)      NOT NULL,
            reimbursed_from_bank_account_id CHAR(36)      NOT NULL,
            reference                       VARCHAR(191)  NULL,
            status                          VARCHAR(10)   NOT NULL DEFAULT 'RECORDED',
            reversed_at                     DATETIME(6)   NULL,
            reversed_by                     CHAR(36)      NULL,
            reversal_reason                 TEXT          NULL,
            reimbursed_by                   CHAR(36)      NOT NULL,
            reimbursed_at                   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            -- Singleton guard: one LIVE (non-reversed) reimbursement per
            -- claim — a claim can be reimbursed, reversed, and
            -- re-reimbursed, never simultaneously twice-live.
            live_guard                      CHAR(36)      GENERATED ALWAYS AS (IF(status = 'RECORDED', expense_claim_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_expreimb_one_live_per_claim (live_guard),
            KEY ix_expreimb_claim (expense_claim_id),
            CONSTRAINT ck_expreimb_amount CHECK (amount > 0),
            CONSTRAINT ck_expreimb_status CHECK (status IN ('RECORDED','REVERSED')),
            CONSTRAINT ck_expreimb_reversal CHECK (status <> 'REVERSED' OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL)),
            CONSTRAINT fk_expreimb_claim FOREIGN KEY (expense_claim_id) REFERENCES expense_claims(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_modes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_bank FOREIGN KEY (reimbursed_from_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_reversed_by FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_reimbursed_by FOREIGN KEY (reimbursed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expreimb_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================= company_expenses
    op.execute("""
        CREATE TABLE company_expenses (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            financial_year_id           CHAR(36)      NOT NULL,
            expense_type_id             CHAR(36)      NOT NULL,
            vendor_id                   CHAR(36)      NULL,
            linked_purchase_bill_id     CHAR(36)      NULL,
            -- One-way only — set only when routed automatically from an Add
            -- Expense submission whose Type was Company-Paid; a row created
            -- directly on this screen has no source claim at all.
            source_expense_claim_id     CHAR(36)      NULL,
            amount                      DECIMAL(14,2) NOT NULL,
            tax_head_id                 CHAR(36)      NULL,
            tax_amount                  DECIMAL(14,2) NULL,
            paid_from_bank_account_id   CHAR(36)      NULL,
            payment_mode_id             CHAR(36)      NULL,
            payment_reference           VARCHAR(191)  NULL,
            paid_on                     DATE          NULL,
            expense_date                DATE          NOT NULL,
            billing_period_month        SMALLINT      NULL,
            billing_period_year         SMALLINT      NULL,
            description                 TEXT          NULL,
            bill_stored_file_id         CHAR(36)      NULL,
            has_bill_attached           TINYINT(1)    GENERATED ALWAYS AS (bill_stored_file_id IS NOT NULL) STORED,
            status                      VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            cancelled_at                DATETIME(6)   NULL,
            cancelled_by                CHAR(36)      NULL,
            cancellation_reason         TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_compexp_source_claim (source_expense_claim_id),
            KEY ix_compexp_status (status),
            KEY ix_compexp_type (expense_type_id),
            CONSTRAINT ck_compexp_amount CHECK (amount > 0),
            CONSTRAINT ck_compexp_paid_after_date CHECK (paid_on IS NULL OR paid_on >= expense_date),
            CONSTRAINT ck_compexp_status CHECK (status IN ('PENDING','PAID','CANCELLED')),
            -- "Paid From" becomes required once Status reaches Paid — the
            -- one place this screen's own payment record IS the settlement,
            -- no separate reimbursement step behind it.
            CONSTRAINT ck_compexp_paid_needs_bank CHECK (status <> 'PAID' OR paid_from_bank_account_id IS NOT NULL),
            CONSTRAINT fk_compexp_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_type FOREIGN KEY (expense_type_id) REFERENCES expense_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_bill FOREIGN KEY (linked_purchase_bill_id) REFERENCES purchase_bills(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_source_claim FOREIGN KEY (source_expense_claim_id) REFERENCES expense_claims(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_bank FOREIGN KEY (paid_from_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_modes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_file FOREIGN KEY (bill_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_compexp_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # Cross-phase ALTER: Notification's ck_notif_type (0003) never
    # anticipated Finance events — Credit Note approval and (later) Expense
    # decisions need real values, not an ill-fitting reuse of an existing
    # one. Same "extend an earlier phase's schema via ALTER once a real
    # consumer exists" pattern as company_profile.payroll_basis (0004).
    op.execute("ALTER TABLE notifications DROP CHECK ck_notif_type;")
    op.execute("""
        ALTER TABLE notifications
        ADD CONSTRAINT ck_notif_type CHECK (notification_type IN (
            'LEAVE','DOCUMENT','PAYSLIP','TICKET','TASK','ASSET','PROFILE_CHANGE','ANNOUNCEMENT',
            'COMPENSATORY_HOURS','ONBOARDING','EXIT','TAX_DECLARATION','CREDIT_NOTE','EXPENSE'
        ));
    """)

    # ============================================== FY-lock triggers (9 tables)
    # Same universal invariant as every table in every prior phase: no
    # mutation against a locked Financial Year. One trigger per table,
    # BEFORE INSERT and BEFORE UPDATE, checking the row's own financial_year_id.
    # (The remaining 9 of this migration's 18 tables are child rows with no
    # financial_year_id of their own — the FY lock is enforced through their
    # parent's own trigger since edits to them always accompany a parent write.)
    for table in (
        "customers", "purchase_bills", "purchase_bill_payments", "invoices", "invoice_payments", "credit_notes",
        "expense_claims", "expense_reimbursements", "company_expenses",
    ):
        for event in ("INSERT", "UPDATE"):
            op.execute(f"""
                CREATE TRIGGER trg_{table}_fy_lock_{event.lower()}
                BEFORE {event} ON {table}
                FOR EACH ROW
                BEGIN
                    IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
                    END IF;
                END
            """)

    # ============================================ append-only / immutability
    # Credit Notes, once Approved, are frozen (correction goes through a new
    # Credit Note, not editing this one) — mirrors Payslip/PayslipReissue's
    # append-only discipline from Phase 3.
    op.execute("""
        CREATE TRIGGER trg_creditnotes_frozen_after_approval
        BEFORE UPDATE ON credit_notes
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'APPROVED' AND (
                NEW.credit_amount <> OLD.credit_amount OR NEW.reason <> OLD.reason
                OR NEW.reason_detail <> OLD.reason_detail OR NEW.invoice_id <> OLD.invoice_id
            ) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An Approved Credit Note is frozen — raise a new one to correct it';
            END IF;
        END
    """)
    # Invoice never reopens once Paid — locks every field the API itself
    # doesn't already guard (defense in depth, same split as Payroll's
    # trg_prun_no_unprocess).
    op.execute("""
        CREATE TRIGGER trg_invoices_no_unlock
        BEFORE UPDATE ON invoices
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'PAID' AND NEW.status <> 'PAID' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A Paid invoice never reopens';
            END IF;
        END
    """)


def downgrade() -> None:
    # Revert the cross-phase notification-type ALTER before dropping this
    # phase's own tables.
    op.execute("ALTER TABLE notifications DROP CHECK ck_notif_type;")
    op.execute("""
        ALTER TABLE notifications
        ADD CONSTRAINT ck_notif_type CHECK (notification_type IN (
            'LEAVE','DOCUMENT','PAYSLIP','TICKET','TASK','ASSET','PROFILE_CHANGE','ANNOUNCEMENT',
            'COMPENSATORY_HOURS','ONBOARDING','EXIT','TAX_DECLARATION'
        ));
    """)

    # Drop the circular FK first (purchase_bills -> expense_claims) — same
    # technique as every prior phase's circular-reference cleanup, must
    # happen before expense_claims can be dropped.
    op.execute("ALTER TABLE purchase_bills DROP FOREIGN KEY fk_pbills_linked_claim;")

    # Children before parents, respecting every FK above (dropping a table
    # automatically drops its own triggers, so no explicit DROP TRIGGER is
    # needed).
    for table in (
        "company_expenses",
        "expense_reimbursements",
        "expense_claims",
        "credit_note_line_items",
        "credit_notes",
        "invoice_payments",
        "invoice_tax_lines",
        "invoice_line_items",
        "invoices",
        "purchase_bill_payments",
        "purchase_bill_tax_lines",
        "purchase_bill_line_items",
        "purchase_bills",
        "vendors",
        "customer_files",
        "customer_activities",
        "customer_contacts",
        "customers",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table};")
