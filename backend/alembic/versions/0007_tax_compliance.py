"""Phase "Module 15" — Tax & Compliance (15-tax-compliance-module.md).

Tracks money the company holds on somebody else's behalf (a liability, owed
onward to a tax authority — Purchase Bill vendor withholding + Payroll
employee deductions) and money somebody else holds on the company's behalf
(an asset, a claimable credit — Invoice customer withholding). §1.1 explains
at length why this is its own module rather than a field on three others:
a remittance is a real document nothing else owns, its counterparty (a tax
authority) is a fourth party this CMS models nowhere else, and the whole
module is hidden — no sidebar tab, no screens — unless at least one
tax_heads row has creates_onward_liability=1 (Masters §3.2, already built in
0002_masters.py; this migration adds nothing to tax_heads itself).

THE OBLIGATIONS REGISTER (§2.2) IS NOT A STORED TABLE. It's the live
aggregation this project has used every time a derived rollup would drift if
stored (MonthlyHourReconciliation's Phase-3 precedent, asset depreciation,
milestone auto-Missed): group withheld amounts already sitting on
purchase_bills.withholding_amount / payslip_statutory_lines.computed_amount
by tax head + period (per that head's remittance_period/period_aligns_to/
liability_arises_on), net against remittance_allocations, and derive status
(Remitted/Overdue/Due Soon/Part-Remitted/Open) on every read. Only the
REMITTANCE ITSELF — a real deposit, with its own number series and a
void-never-edit rule — is a real row. Same split as every prior phase: real
transactional documents are tables, derived reconciliation figures are
service-layer computation (app/services/obligation_engine.py, next task).

FOUR NEW TABLES, all RESTRICT not CASCADE on every FK per this project's
standing convention (nothing here should ever silently vanish because a
row it references was deleted — none of masters/bank_accounts/payment_modes/
tax_heads/customers/users/stored_files are ever hard-deleted anyway):

  - remittances — one row per deposit ACTUALLY made. Never editable after
    save (§2.4): a wrong one is corrected by a REVERSAL, a negative-signed
    row referencing the original via reverses_remittance_id, never an
    UPDATE or DELETE — same principle as Credit Note against a locked
    Invoice. ck_remittances_reversal enforces the shape at the DB level:
    a normal remittance has amount_remitted > 0 and no reverses_remittance_id;
    a reversal has amount_remitted < 0, a reverses_remittance_id, and a
    non-empty reversal_reason.
  - remittance_allocations — "Documents Covered" (§2.5): which withheld
    source rows this remittance pays down, and how much of each. Polymorphic
    (source_type + source_id) across purchase_bills / payslip_statutory_lines
    — the two LIABILITY sources — deliberately with no FK on source_id since
    it crosses two different tables; source_type is a real CHECK-constrained
    discriminator instead. Append-only child of an append-only parent, so it
    gets the same reduced column set (id/fk/amount/created_at, no
    updated_at/updated_by) already established for task_comments/
    asset_assignment_history — there is no "edit an allocation" workflow.
  - withholding_certificates — what a customer's certificate evidences
    (§2.7/2.8), one per (customer, certificate_reference) since the spec
    states the reference is "unique per customer." amount_matched is a
    plain API-written sum of its certificate_receipts (computed once at Log
    Certificate time — no later "add more receipts" workflow exists in the
    spec, so no recompute trigger is needed); variance is a real GENERATED
    column off the two stored figures, matching every other derived-from-
    two-stored-siblings figure in this codebase (e.g. invoices.balance_due).
    Voiding is Super Admin only and requires a reason (§2.7) — same
    ACTIVE/VOIDED-with-mandatory-reason shape as nothing-hardcoded's other
    Super-Admin-only irreversible actions elsewhere in this codebase.
  - certificate_receipts — "Receipts Covered" (§2.8): which invoice_payments
    rows (the customer-withholding source, §1's third flow) a certificate
    evidences, and how much of each.
  - credit_claims — "Mark Credit Claimed" (§2.9), one per certificate (a
    certificate is claimed as a whole once its receipts are matched — the
    spec's Amount Claimable is explicitly "the certified figure," i.e. the
    certificate's own amount_on_certificate, not the company's recorded
    figure, whenever they differ per §7.4).

RMT number series added to number_prefix_rules via a plain INSERT, same
pattern INV/CN/PB etc already use (app/services/numbering.py, unchanged).

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-01
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Same "DROP CHECK, ADD CHECK with the code type appended" pattern
    # 0003_employee_leave.py already used to add LTR/CHR — RMT-<FY>-0000
    # (§2.4/§5) needs a slot in number_prefix_rules.ck_prefix_rules_type too.
    op.execute("ALTER TABLE number_prefix_rules DROP CHECK ck_prefix_rules_type;")
    op.execute("""
        ALTER TABLE number_prefix_rules ADD CONSTRAINT ck_prefix_rules_type
        CHECK (code_type IN ('INV','PB','CUST','AST','TKT','EMP','PRJ','OPP','CN','EXP','CMP','TSK','BUG','QUO','LTR','CHR','RMT'));
    """)

    # ================================================================ remittances
    op.execute("""
        CREATE TABLE remittances (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            remittance_number          VARCHAR(191)  NOT NULL,
            financial_year_id           CHAR(36)      NOT NULL,
            tax_head_id                 CHAR(36)      NOT NULL,
            tax_head_name_snapshot     VARCHAR(191)  NOT NULL,
            remitted_to_snapshot        VARCHAR(191)  NULL,
            -- Snapshotted at record time from the period row the operator
            -- opened Record Remittance from (§2.5's three read-only
            -- pre-filled fields) — never re-derived later, so a remittance
            -- keeps meaning the same thing even if the head's own
            -- remittance_period/period_aligns_to changes afterward.
            period_label                VARCHAR(60)   NOT NULL,
            period_from                 DATE          NOT NULL,
            period_to                   DATE          NOT NULL,
            amount_remitted             DECIMAL(14,2) NOT NULL,
            paid_on                     DATE          NOT NULL,
            paid_from_bank_account_id   CHAR(36)      NOT NULL,
            payment_mode_id             CHAR(36)      NOT NULL,
            -- §2.5: labelled from the head's own Authority Reference Label
            -- at the UI layer — this column just stores the value typed.
            authority_reference         VARCHAR(191)  NOT NULL,
            receipt_file_id             CHAR(36)      NULL,
            notes                       TEXT          NULL,
            recorded_by                 CHAR(36)      NOT NULL,
            is_reversal                 TINYINT(1)    NOT NULL DEFAULT 0,
            reverses_remittance_id      CHAR(36)      NULL,
            reversal_reason             TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_remittances_number (remittance_number),
            KEY ix_remittances_taxhead_period (tax_head_id, period_from, period_to),
            KEY ix_remittances_reverses (reverses_remittance_id),
            CONSTRAINT ck_remittances_period CHECK (period_to >= period_from),
            -- No CHECK for "paid_on <= today": MySQL 8 rejects any
            -- non-deterministic function (CURDATE(), NOW(), etc.) inside a
            -- CHECK constraint (error 3814) — same limitation already hit in
            -- 0003_employee_leave.py. Validated at the API layer only.
            CONSTRAINT ck_remittances_authority_ref CHECK (CHAR_LENGTH(TRIM(authority_reference)) > 0),
            -- A normal remittance is positive with no reversal link; a
            -- reversal is negative, links back to the original, and must
            -- state why (§3.3) — enforced as one shape, not two code paths
            -- that could independently drift.
            CONSTRAINT ck_remittances_reversal_shape CHECK (
                (is_reversal = 0 AND reverses_remittance_id IS NULL AND amount_remitted > 0)
                OR
                (is_reversal = 1 AND reverses_remittance_id IS NOT NULL AND amount_remitted < 0
                 AND reversal_reason IS NOT NULL AND CHAR_LENGTH(TRIM(reversal_reason)) > 0)
            ),
            CONSTRAINT fk_remittances_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_taxhead FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_bank FOREIGN KEY (paid_from_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_mode FOREIGN KEY (payment_mode_id) REFERENCES payment_modes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_receipt FOREIGN KEY (receipt_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_reverses FOREIGN KEY (reverses_remittance_id) REFERENCES remittances(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_remittances_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ===================================================== remittance_allocations
    op.execute("""
        CREATE TABLE remittance_allocations (
            id                CHAR(36)      NOT NULL PRIMARY KEY,
            remittance_id     CHAR(36)      NOT NULL,
            source_type       VARCHAR(30)   NOT NULL,
            source_id         CHAR(36)      NOT NULL,
            amount_allocated  DECIMAL(14,2) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_remalloc_remittance (remittance_id),
            KEY ix_remalloc_source (source_type, source_id),
            CONSTRAINT ck_remalloc_type CHECK (source_type IN ('PURCHASE_BILL', 'PAYSLIP_STATUTORY_LINE')),
            -- <> 0, not > 0: a reversal (app/api/v1/compliance.py's
            -- reverse_remittance) mirrors the original allocation rows with
            -- negated amounts against the reversal's own remittance_id, so a
            -- document's "already allocated" total nets back to its true
            -- outstanding figure — otherwise a reversed remittance would
            -- leave its covered documents permanently stuck showing as fully
            -- allocated even though the period itself correctly reopens.
            CONSTRAINT ck_remalloc_amount CHECK (amount_allocated <> 0),
            CONSTRAINT fk_remalloc_remittance FOREIGN KEY (remittance_id) REFERENCES remittances(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================== withholding_certificates
    op.execute("""
        CREATE TABLE withholding_certificates (
            id                       CHAR(36)      NOT NULL PRIMARY KEY,
            certificate_reference    VARCHAR(191)  NOT NULL,
            customer_id              CHAR(36)      NOT NULL,
            certificate_date         DATE          NOT NULL,
            covered_from             DATE          NOT NULL,
            covered_to               DATE          NOT NULL,
            tax_head_id              CHAR(36)      NOT NULL,
            tax_head_name_snapshot   VARCHAR(191)  NOT NULL,
            amount_on_certificate    DECIMAL(14,2) NOT NULL,
            -- Plain API-written sum of certificate_receipts.amount, set once
            -- at Log Certificate time (§2.8's "Receipts Covered... computes
            -- Amount Matched") — not a trigger, matching this project's
            -- established rollup doctrine (Vendor Usage precedent, Phase 4).
            amount_matched           DECIMAL(14,2) NOT NULL DEFAULT 0,
            variance                 DECIMAL(14,2) GENERATED ALWAYS AS (amount_on_certificate - amount_matched) STORED,
            attachment_file_id       CHAR(36)      NULL,
            status                   VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
            voided_at                DATETIME(6)   NULL,
            voided_by                CHAR(36)      NULL,
            void_reason              TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_withcert_customer_ref (customer_id, certificate_reference),
            KEY ix_withcert_taxhead (tax_head_id),
            KEY ix_withcert_status (status),
            CONSTRAINT ck_withcert_ref CHECK (CHAR_LENGTH(TRIM(certificate_reference)) > 0),
            CONSTRAINT ck_withcert_dates CHECK (covered_to >= covered_from),
            -- No CHECK for "certificate_date <= today" — same MySQL 8
            -- non-deterministic-function limitation noted above. API layer only.
            CONSTRAINT ck_withcert_amount CHECK (amount_on_certificate > 0),
            CONSTRAINT ck_withcert_matched CHECK (amount_matched >= 0),
            CONSTRAINT ck_withcert_status CHECK (status IN ('ACTIVE', 'VOIDED')),
            CONSTRAINT ck_withcert_void_reason CHECK (status = 'ACTIVE' OR (void_reason IS NOT NULL AND CHAR_LENGTH(TRIM(void_reason)) > 0)),
            CONSTRAINT fk_withcert_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_withcert_taxhead FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_withcert_attachment FOREIGN KEY (attachment_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_withcert_voided_by FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_withcert_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_withcert_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ======================================================= certificate_receipts
    op.execute("""
        CREATE TABLE certificate_receipts (
            id                   CHAR(36)      NOT NULL PRIMARY KEY,
            certificate_id       CHAR(36)      NOT NULL,
            invoice_payment_id   CHAR(36)      NOT NULL,
            amount               DECIMAL(14,2) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_certreceipts_cert (certificate_id),
            KEY ix_certreceipts_payment (invoice_payment_id),
            UNIQUE KEY ux_certreceipts_cert_payment (certificate_id, invoice_payment_id),
            CONSTRAINT ck_certreceipts_amount CHECK (amount > 0),
            CONSTRAINT fk_certreceipts_cert FOREIGN KEY (certificate_id) REFERENCES withholding_certificates(id) ON DELETE CASCADE,
            CONSTRAINT fk_certreceipts_payment FOREIGN KEY (invoice_payment_id) REFERENCES invoice_payments(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================== credit_claims
    op.execute("""
        CREATE TABLE credit_claims (
            id                CHAR(36)      NOT NULL PRIMARY KEY,
            certificate_id    CHAR(36)      NOT NULL,
            amount_claimable  DECIMAL(14,2) NOT NULL,
            claimed_in        VARCHAR(120)  NOT NULL,
            claim_reference   VARCHAR(191)  NULL,
            claim_date        DATE          NOT NULL,
            notes             TEXT          NULL,
            claimed_by        CHAR(36)      NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            -- A certificate is claimed once, as a whole (§2.9) — Amount
            -- Claimable is the certificate's own certified figure, not a
            -- partial/per-receipt claim.
            UNIQUE KEY ux_creditclaims_cert (certificate_id),
            CONSTRAINT ck_creditclaims_amount CHECK (amount_claimable > 0),
            -- No CHECK for "claim_date <= today" — same MySQL 8
            -- non-deterministic-function limitation noted above. API layer only.
            CONSTRAINT ck_creditclaims_claimed_in CHECK (CHAR_LENGTH(TRIM(claimed_in)) > 0),
            CONSTRAINT fk_creditclaims_cert FOREIGN KEY (certificate_id) REFERENCES withholding_certificates(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditclaims_claimed_by FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditclaims_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_creditclaims_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # RMT number series — same plain-INSERT pattern as every other code type's
    # rule row would use if this migration seeded rows (it doesn't; app/seed.py
    # does, matching every prior phase — see SEED_NUMBER_PREFIX_RULES).


def downgrade() -> None:
    for table in ("credit_claims", "certificate_receipts", "withholding_certificates", "remittance_allocations", "remittances"):
        op.execute(f"DROP TABLE IF EXISTS {table};")
