"""Masters module (01-masters-module.md) — all 21 sub-masters except Financial
Year, which shipped in Phase 0. Raw-DDL, hand-written against ARCH-1, same
discipline as 0001: generated-column singleton guards use a LITERAL CONSTANT
for global rules and the GROUPING KEY for per-group rules (ARCH-1 D0.1 — the
bug found and fixed in Phase 0's financial_years table).

Dialect notes versus ARCH-1's Postgres-flavoured prose, applied throughout:
  - `~`/`~*` (Postgres regex) -> MySQL `REGEXP` (case-insensitive already,
    because utf8mb4_0900_ai_ci is an accent/case-insensitive collation).
  - `citext` -> plain VARCHAR (same reason).
  - `bytea` -> VARBINARY.
  - `'{}'::JSON` / `'[]'::JSON` defaults -> MySQL 8.0.13+ expression defaults:
    DEFAULT (JSON_OBJECT()) / DEFAULT (JSON_ARRAY()).
  - EXTRACT(DOW FROM d)=6 (Postgres Saturday) -> DAYOFWEEK(d)=7 (MySQL
    Saturday; MySQL's DAYOFWEEK is 1=Sunday..7=Saturday).
  - `tax_heads.withholding_direction` (a Postgres array column) is split out
    into its own junction table, `tax_head_withholding_directions`, per ARCH-1's
    own note next to that field ("moved to tax_head_withholding_directions").
  - GIN indexes on JSON columns have no MySQL equivalent (ARCH-1 D0.4) and are
    omitted; behaviour/available_placeholders stay unindexed JSON blobs.
  - "UNIQUE NULLS NOT DISTINCT" (Postgres 15+) has no MySQL equivalent — MySQL
    unique indexes always treat NULL as distinct. Accepted as a known,
    pre-existing simplification (0001 already made the same call for
    document_number_sequences); noted per-table below where it recurs.
  - Deferred cross-row constraints MySQL cannot express at all (slab-band
    contiguity, split-component shares summing to 100%) are validated in the
    service layer before commit — ARCH-1 itself requires that layer too
    ("the API also validates inline as bands are typed"), so this is not a
    reduction in rigor, just where the check actually has to live.

Cross-phase note: `work_week_policy_employees.employee_id` references a table
(`employees`) that does not exist until Phase 2. The column is created here
as a plain CHAR(36) with NO foreign key; Phase 2's migration must ALTER TABLE
to add `fk_wwpe_employee` once `employees` exists. Flagged inline below too.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-01
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ================================================================ TAXES
    # Masters §3.2d — created before tax_heads, which optionally FKs to it.
    op.execute("""
        CREATE TABLE tax_schemes (
            id              CHAR(36)      NOT NULL PRIMARY KEY,
            scheme_name     VARCHAR(191)  NOT NULL,
            description     TEXT          NULL,
            is_default      TINYINT(1)    NOT NULL DEFAULT 0,
            choice_window   VARCHAR(20)   NOT NULL,
            is_active       TINYINT(1)    NOT NULL DEFAULT 1,
            -- Global singleton ("exactly one default scheme") -> constant guard.
            default_guard   TINYINT       GENERATED ALWAYS AS (IF(is_default = 1, 1, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_tax_schemes_name (scheme_name),
            UNIQUE KEY ux_tax_schemes_one_default (default_guard),
            CONSTRAINT fk_tax_schemes_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tax_schemes_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_tax_schemes_window CHECK (choice_window IN ('ONCE_PER_FY','ANY_TIME','FIXED_AT_JOINING'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # Masters §3.2a — the whole tax engine. Models the SHAPE of a tax; names none.
    op.execute("""
        CREATE TABLE tax_heads (
            id                                 CHAR(36)      NOT NULL PRIMARY KEY,
            tax_name                           VARCHAR(191)  NOT NULL,
            short_code                         VARCHAR(20)   NULL,
            scope                              VARCHAR(40)   NOT NULL,
            tax_type                           VARCHAR(20)   NOT NULL,
            applies_from                       DATE          NOT NULL,
            applies_until                      DATE          NULL,
            rate_pct                           DECIMAL(7,4)  NULL,
            cgst_rate_pct                      DECIMAL(7,4)  NULL,
            sgst_rate_pct                      DECIMAL(7,4)  NULL,
            fixed_amount                       DECIMAL(14,2) NULL,
            declaration_cap                    DECIMAL(14,2) NULL,
            slab_application                   VARCHAR(20)   NULL,
            tax_scheme_id                      CHAR(36)      NULL,
            print_label                        VARCHAR(191)  NULL,
            notes                              TEXT          NULL,
            -- Deliberately trimmed-out behaviour, kept open-ended per Masters
            -- §3.2a's own note: include_in_ctc, show_on_payslip, borne_by,
            -- max_amount_per_period, applicable_location_ids,
            -- applicable_employment_type_ids, requires_employee_identifier(+label).
            behaviour                          JSON          NOT NULL DEFAULT (JSON_OBJECT()),
            creates_onward_liability           TINYINT(1)    NOT NULL DEFAULT 0,
            remitted_to_authority               VARCHAR(191)  NULL,
            remittance_period                  VARCHAR(20)   NULL,
            period_aligns_to                   VARCHAR(20)   NULL,
            deposit_due_days_after_period_end  INT           NULL,
            liability_arises_on                VARCHAR(30)   NULL,
            authority_reference_label          VARCHAR(120)  NULL,
            default_calculated_on              VARCHAR(10)   NULL,
            certificate_expected                TINYINT(1)    NOT NULL DEFAULT 0,
            is_active                          TINYINT(1)    NOT NULL DEFAULT 1,
            is_arithmetic_locked               TINYINT(1)    NOT NULL DEFAULT 0,
            first_used_at                      DATETIME(6)   NULL,
            usage_count                        INT           NOT NULL DEFAULT 0,
            supersedes_tax_head_id             CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_tax_heads_scope_name (scope, tax_name),
            KEY idx_tax_heads_inforce (scope, is_active, applies_from, applies_until),
            CONSTRAINT fk_tax_heads_scheme FOREIGN KEY (tax_scheme_id) REFERENCES tax_schemes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tax_heads_supersedes FOREIGN KEY (supersedes_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tax_heads_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tax_heads_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_tax_heads_scope CHECK (scope IN ('SALES_BILLING','PURCHASE','SALES_AND_PURCHASE','PAYROLL_EMPLOYEE_DEDUCTION','PAYROLL_EMPLOYER_CONTRIBUTION','PAYROLL_INCOME_TAX','EMPLOYEE_DECLARATION','WITHHOLDING_AT_SOURCE')),
            CONSTRAINT ck_tax_heads_type CHECK (tax_type IN ('GST_IGST','GST_CGST_SGST','PERCENTAGE','FIXED_AMOUNT','SLAB','DECLARATION_CAP')),
            CONSTRAINT ck_tax_heads_applies_until CHECK (applies_until IS NULL OR applies_until >= applies_from),
            CONSTRAINT ck_tax_heads_rate_gst_igst CHECK (tax_type <> 'GST_IGST' OR rate_pct IS NOT NULL),
            CONSTRAINT ck_tax_heads_rate_pct CHECK (tax_type <> 'PERCENTAGE' OR rate_pct IS NOT NULL),
            CONSTRAINT ck_tax_heads_gst_split CHECK (tax_type <> 'GST_CGST_SGST' OR (cgst_rate_pct IS NOT NULL AND sgst_rate_pct = cgst_rate_pct)),
            CONSTRAINT ck_tax_heads_fixed CHECK (tax_type <> 'FIXED_AMOUNT' OR fixed_amount IS NOT NULL),
            CONSTRAINT ck_tax_heads_decl_cap CHECK (tax_type <> 'DECLARATION_CAP' OR declaration_cap IS NOT NULL),
            CONSTRAINT ck_tax_heads_slab CHECK (tax_type <> 'SLAB' OR slab_application IS NOT NULL),
            CONSTRAINT ck_tax_heads_remittance_period CHECK (remittance_period IS NULL OR remittance_period IN ('PER_DOCUMENT','MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL')),
            CONSTRAINT ck_tax_heads_period_aligns CHECK (period_aligns_to IS NULL OR period_aligns_to IN ('CALENDAR','FINANCIAL_YEAR','PAY_CYCLE')),
            CONSTRAINT ck_tax_heads_deposit_days CHECK (deposit_due_days_after_period_end IS NULL OR deposit_due_days_after_period_end >= 0),
            CONSTRAINT ck_tax_heads_liability_arises CHECK (liability_arises_on IS NULL OR liability_arises_on IN ('SOURCE_DOCUMENT_DATE','PAYMENT_DATE')),
            CONSTRAINT ck_tax_heads_calc_on CHECK (default_calculated_on IS NULL OR default_calculated_on IN ('SUBTOTAL','TOTAL')),
            CONSTRAINT ck_tax_heads_gate_complete CHECK (
                creates_onward_liability = 0
                OR (remittance_period IS NOT NULL AND period_aligns_to IS NOT NULL AND deposit_due_days_after_period_end IS NOT NULL)
            )
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # SPEC AMBIGUITY, surfaced rather than silently resolved (found by the
    # Phase 1 audit): Masters §3.2's Status & Deletion Rule states "A locked
    # Financial Year freezes any head scoped to it" — but tax_heads has no
    # financial_year_id field anywhere in its own Fields Table, and ARCH-1's
    # own tax_heads design never had one either. A head is versioned by
    # Applies From/Applies Until date ranges, not a discrete FY link, so
    # which FY(s) a head is "scoped to" is genuinely undefined: its
    # applies_from..applies_until range can span multiple financial years, or
    # sit half in an open year and half in a locked one. Implementing this
    # would mean inventing that resolution rule rather than reading it off
    # the spec — left undone on purpose until grooming defines it, per
    # BUILD-PROMPT §1's "do not silently resolve a conflict — surface it."
    #
    # D10/Invariant 10: once used in any calculation, a head's figures lock —
    # for everyone, Super Admin included. Guards both direction (no
    # relocking->unlocking either) and the specific fields that are arithmetic.
    op.execute("""
        CREATE TRIGGER trg_tax_heads_reject_locked_change
        BEFORE UPDATE ON tax_heads
        FOR EACH ROW
        BEGIN
            IF OLD.is_arithmetic_locked = 1 THEN
                IF NEW.is_arithmetic_locked = 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tax head cannot be unlocked once used in a calculation';
                ELSEIF NOT (OLD.rate_pct <=> NEW.rate_pct)
                    OR NOT (OLD.cgst_rate_pct <=> NEW.cgst_rate_pct)
                    OR NOT (OLD.sgst_rate_pct <=> NEW.sgst_rate_pct)
                    OR NOT (OLD.fixed_amount <=> NEW.fixed_amount)
                    OR NOT (OLD.declaration_cap <=> NEW.declaration_cap)
                    OR NOT (OLD.slab_application <=> NEW.slab_application) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tax head figures are locked once used in a calculation — Duplicate instead';
                END IF;
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE tax_head_slab_bands (
            id              CHAR(36)      NOT NULL PRIMARY KEY,
            tax_head_id     CHAR(36)      NOT NULL,
            sequence_no     SMALLINT      NOT NULL,
            band_from       DECIMAL(14,2) NOT NULL,
            band_to         DECIMAL(14,2) NULL,
            rate_or_amount  DECIMAL(14,4) NOT NULL,
            band_label      VARCHAR(120)  NULL,
            -- Per-group singleton ("exactly one open band PER HEAD") -> the
            -- GROUPING KEY (tax_head_id) is the correct guard value here,
            -- unlike financial_years.is_current which has no grouping key.
            open_band_guard CHAR(36)      GENERATED ALWAYS AS (IF(band_to IS NULL, tax_head_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_slab_bands_seq (tax_head_id, sequence_no),
            UNIQUE KEY ux_slab_bands_one_open (open_band_guard),
            KEY idx_slab_bands_head (tax_head_id, band_from),
            -- RESTRICT, not CASCADE: MySQL rejects (error 1215) an ON DELETE
            -- CASCADE/SET NULL FK on any column a STORED generated column in
            -- the SAME table depends on (open_band_guard depends on
            -- tax_head_id here) — proven empirically against this container.
            -- Harmless in practice: tax heads are never hard-deleted once
            -- used anyway (Masters §3.2's own rule), so an unused head's
            -- bands must be deleted explicitly first, which the API does.
            CONSTRAINT fk_slab_bands_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_slab_bands_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_slab_bands_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_slab_bands_seq CHECK (sequence_no > 0),
            CONSTRAINT ck_slab_bands_from CHECK (band_from >= 0),
            CONSTRAINT ck_slab_bands_to CHECK (band_to IS NULL OR band_to >= band_from),
            CONSTRAINT ck_slab_bands_rate CHECK (rate_or_amount >= 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE"), ("DELETE", "BEFORE")]:
        row_ref = "NEW" if verb != "DELETE" else "OLD"
        op.execute(f"""
            CREATE TRIGGER trg_slab_bands_reject_locked_{verb.lower()}
            {timing} {verb} ON tax_head_slab_bands
            FOR EACH ROW
            BEGIN
                IF (SELECT is_arithmetic_locked FROM tax_heads WHERE id = {row_ref}.tax_head_id) = 1 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot modify slab bands of a tax head already used in a calculation';
                END IF;
            END
        """)

    op.execute("""
        CREATE TABLE tax_head_split_components (
            id              CHAR(36)      NOT NULL PRIMARY KEY,
            tax_head_id     CHAR(36)      NOT NULL,
            sequence_no     SMALLINT      NOT NULL,
            component_name  VARCHAR(120)  NOT NULL,
            share_pct       DECIMAL(7,4)  NOT NULL,
            applies_when    VARCHAR(20)   NOT NULL DEFAULT 'ALWAYS',
            condition_rule  JSON          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_split_components_name (tax_head_id, component_name),
            UNIQUE KEY ux_split_components_seq (tax_head_id, sequence_no),
            CONSTRAINT fk_split_components_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE CASCADE,
            CONSTRAINT fk_split_components_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_split_components_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_split_components_share CHECK (share_pct > 0 AND share_pct <= 100),
            CONSTRAINT ck_split_components_when CHECK (applies_when IN ('ALWAYS','CONDITIONAL'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE"), ("DELETE", "BEFORE")]:
        row_ref = "NEW" if verb != "DELETE" else "OLD"
        op.execute(f"""
            CREATE TRIGGER trg_split_components_reject_locked_{verb.lower()}
            {timing} {verb} ON tax_head_split_components
            FOR EACH ROW
            BEGIN
                IF (SELECT is_arithmetic_locked FROM tax_heads WHERE id = {row_ref}.tax_head_id) = 1 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot modify split components of a tax head already used in a calculation';
                END IF;
            END
        """)

    op.execute("""
        CREATE TABLE tax_head_relief_rules (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            tax_head_id                     CHAR(36)      NOT NULL,
            relief_name                     VARCHAR(120)  NOT NULL,
            applies_if_base_at_or_below     DECIMAL(14,2) NOT NULL,
            relief_type                     VARCHAR(20)   NOT NULL,
            relief_amount                   DECIMAL(14,2) NULL,
            is_active                       TINYINT(1)    NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_relief_rules_name (tax_head_id, relief_name),
            CONSTRAINT fk_relief_rules_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE CASCADE,
            CONSTRAINT fk_relief_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_relief_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_relief_base CHECK (applies_if_base_at_or_below >= 0),
            CONSTRAINT ck_relief_type CHECK (relief_type IN ('REDUCE_BY_FIXED','REDUCE_TO_ZERO','CAP_AT_AMOUNT')),
            CONSTRAINT ck_relief_amount CHECK (relief_type = 'REDUCE_TO_ZERO' OR relief_amount IS NOT NULL)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Trigger: parent head scope must be PAYROLL_INCOME_TAX (ARCH-1 note).
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE")]:
        op.execute(f"""
            CREATE TRIGGER trg_relief_rules_scope_check_{verb.lower()}
            {timing} {verb} ON tax_head_relief_rules
            FOR EACH ROW
            BEGIN
                IF (SELECT scope FROM tax_heads WHERE id = NEW.tax_head_id) <> 'PAYROLL_INCOME_TAX' THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Relief rules only apply to Payroll — Income Tax scoped heads';
                END IF;
            END
        """)

    # Masters §3.2 Withholding Direction — a Postgres array in ARCH-1, split
    # into its own junction table here (ARCH-1's own note next to the field).
    op.execute("""
        CREATE TABLE tax_head_withholding_directions (
            id            CHAR(36)    NOT NULL PRIMARY KEY,
            tax_head_id   CHAR(36)    NOT NULL,
            direction     VARCHAR(24) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_thwd (tax_head_id, direction),
            CONSTRAINT fk_thwd_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE CASCADE,
            CONSTRAINT fk_thwd_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_thwd_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_thwd_direction CHECK (direction IN ('ON_PAYMENTS_MADE','ON_PAYMENTS_RECEIVED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ==================================================== NUMBER PREFIX RULES
    op.execute("""
        CREATE TABLE number_prefix_rules (
            id                      CHAR(36)     NOT NULL PRIMARY KEY,
            code_type               VARCHAR(20)  NOT NULL,
            label                   VARCHAR(120) NOT NULL,
            prefix                  VARCHAR(10)  NOT NULL,
            include_fy_in_code      TINYINT(1)   NOT NULL DEFAULT 1,
            running_number_digits   SMALLINT     NOT NULL,
            starting_number         INT          NOT NULL,
            resets_every_fy         TINYINT(1)   NOT NULL DEFAULT 1,
            starting_number_locked  TINYINT(1)   NOT NULL DEFAULT 0,
            first_generated_at      DATETIME(6)  NULL,
            generated_count         INT          NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_prefix_rules_code_type (code_type),
            CONSTRAINT fk_prefix_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prefix_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_prefix_rules_type CHECK (code_type IN ('INV','PB','CUST','AST','TKT','EMP','PRJ','OPP','CN','EXP','CMP','TSK','BUG','QUO')),
            CONSTRAINT ck_prefix_rules_prefix CHECK (prefix REGEXP '^[A-Z]{2,6}$'),
            CONSTRAINT ck_prefix_rules_digits CHECK (running_number_digits BETWEEN 3 AND 6),
            CONSTRAINT ck_prefix_rules_start CHECK (starting_number >= 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_prefix_rules_reject_start_change
        BEFORE UPDATE ON number_prefix_rules
        FOR EACH ROW
        BEGIN
            IF OLD.starting_number_locked = 1 AND NEW.starting_number <> OLD.starting_number THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Starting Number is immutable once any code of this type has been generated';
            END IF;
        END
    """)

    # =========================================================== BANK ACCOUNT
    # Masters §3.7 — created ahead of expense_types, which optionally FKs to it.
    op.execute("""
        CREATE TABLE bank_accounts (
            id                    CHAR(36)     NOT NULL PRIMARY KEY,
            nickname              VARCHAR(120) NOT NULL,
            bank_name             VARCHAR(120) NOT NULL,
            account_holder_name   VARCHAR(191) NOT NULL,
            account_number        VARCHAR(18)  NOT NULL,
            account_type          VARCHAR(10)  NOT NULL,
            ifsc                  CHAR(11)     NOT NULL,
            branch                VARCHAR(120) NOT NULL,
            upi_id                VARCHAR(120) NULL,
            upi_qr_file_id        CHAR(36)     NULL,
            is_default            TINYINT(1)   NOT NULL DEFAULT 0,
            is_active             TINYINT(1)   NOT NULL DEFAULT 1,
            -- Global singleton ("only one default account") -> constant guard.
            default_guard         TINYINT      GENERATED ALWAYS AS (IF(is_default = 1, 1, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_bank_accounts_number_ifsc (account_number, ifsc),
            UNIQUE KEY ux_bank_accounts_nickname (nickname),
            UNIQUE KEY ux_bank_accounts_one_default (default_guard),
            KEY idx_bank_accounts_active (is_active),
            CONSTRAINT fk_bank_accounts_qr FOREIGN KEY (upi_qr_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_bank_accounts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_bank_accounts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_bank_accounts_number CHECK (account_number REGEXP '^[0-9]{9,18}$'),
            CONSTRAINT ck_bank_accounts_type CHECK (account_type IN ('CURRENT','SAVINGS')),
            CONSTRAINT ck_bank_accounts_ifsc CHECK (ifsc REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Masters §3.7: "please choose a new default before deactivating this one."
    op.execute("""
        CREATE TRIGGER trg_bank_accounts_reject_deactivate_default
        BEFORE UPDATE ON bank_accounts
        FOR EACH ROW
        BEGIN
            IF OLD.is_default = 1 AND NEW.is_default = 1 AND NEW.is_active = 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose a new default account before deactivating this one';
            END IF;
        END
    """)

    # ============================================================ SIMPLE LOOKUPS
    op.execute("""
        CREATE TABLE expense_types (
            id                       CHAR(36)     NOT NULL PRIMARY KEY,
            name                     VARCHAR(120) NOT NULL,
            short_code               VARCHAR(20)  NULL,
            claim_type               VARCHAR(20)  NOT NULL,
            is_recurring             TINYINT(1)   NOT NULL DEFAULT 0,
            default_bank_account_id  CHAR(36)     NULL,
            description              TEXT         NULL,
            is_active                TINYINT(1)   NOT NULL DEFAULT 1,
            claim_type_changed_at    DATETIME(6)  NULL,
            previous_claim_type      VARCHAR(20)  NULL,
            usage_count              INT          NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_expense_types_name (name),
            KEY idx_expense_types_active (is_active, claim_type),
            CONSTRAINT fk_expense_types_bank FOREIGN KEY (default_bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expense_types_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_expense_types_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_expense_types_claim CHECK (claim_type IN ('REIMBURSABLE','COMPANY_PAID'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE leave_types (
            id                          CHAR(36)     NOT NULL PRIMARY KEY,
            name                        VARCHAR(120) NOT NULL,
            short_code                  VARCHAR(20)  NULL,
            is_paid                     TINYINT(1)   NOT NULL,
            default_annual_quota_days   DECIMAL(5,2) NOT NULL DEFAULT 0,
            carry_forward_allowed       TINYINT(1)   NOT NULL DEFAULT 0,
            max_carry_forward_days      DECIMAL(5,2) NULL,
            is_quota_tracked            TINYINT(1)   NOT NULL DEFAULT 1,
            is_active                   TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_leave_types_name (name),
            CONSTRAINT fk_leave_types_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_leave_types_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_leave_types_quota CHECK (default_annual_quota_days >= 0),
            CONSTRAINT ck_leave_types_cf CHECK (NOT carry_forward_allowed OR (max_carry_forward_days IS NOT NULL AND max_carry_forward_days <= default_annual_quota_days))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE holidays (
            id                        CHAR(36)     NOT NULL PRIMARY KEY,
            name                      VARCHAR(191) NOT NULL,
            holiday_date              DATE         NOT NULL,
            financial_year_id         CHAR(36)     NOT NULL,
            holiday_type              VARCHAR(10)  NOT NULL,
            recurring_every_year      TINYINT(1)   NOT NULL DEFAULT 0,
            is_active                 TINYINT(1)   NOT NULL DEFAULT 1,
            used_in_processed_payroll TINYINT(1)   NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_holidays_fy_date_name (financial_year_id, holiday_date, name),
            KEY idx_holidays_date (holiday_date, is_active),
            CONSTRAINT fk_holidays_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_holidays_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_holidays_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_holidays_type CHECK (holiday_type IN ('MANDATORY','OPTIONAL'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE")]:
        op.execute(f"""
            CREATE TRIGGER trg_holidays_date_in_fy_range_{verb.lower()}
            {timing} {verb} ON holidays
            FOR EACH ROW
            BEGIN
                DECLARE fy_start DATE;
                DECLARE fy_end DATE;
                SELECT start_date, end_date INTO fy_start, fy_end FROM financial_years WHERE id = NEW.financial_year_id;
                IF NEW.holiday_date < fy_start OR NEW.holiday_date > fy_end THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Holiday date must fall inside the linked Financial Year';
                END IF;
            END
        """)
    # Masters §3.0 rule 2: "A locked Financial Year is frozen for everyone,
    # including Super Admin. Once a year is Locked, no record dated inside it
    # can be added, edited, or deleted by anyone." Holidays is the only one of
    # the 15 simple lookups that carries a financial_year_id, so it's the only
    # one this rule can bite for in Phase 1 (found by the Phase 1 audit —
    # nothing enforced it anywhere before this).
    op.execute("""
        CREATE TRIGGER trg_holidays_reject_if_fy_locked_insert
        BEFORE INSERT ON holidays
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked — no Holiday dated inside it can change';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_holidays_reject_if_fy_locked_update
        BEFORE UPDATE ON holidays
        FOR EACH ROW
        BEGIN
            -- Both directions matter: a record currently inside a locked year
            -- may not be touched at all, and it may not be moved INTO one.
            IF (SELECT status FROM financial_years WHERE id = OLD.financial_year_id) = 'locked'
                OR (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked — no Holiday dated inside it can change';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_holidays_reject_if_fy_locked_delete
        BEFORE DELETE ON holidays
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = OLD.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked — no Holiday dated inside it can change';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE payment_modes (
            id                          CHAR(36)     NOT NULL PRIMARY KEY,
            name                        VARCHAR(60)  NOT NULL,
            requires_reference_number   TINYINT(1)   NOT NULL DEFAULT 0,
            is_active                   TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_payment_modes_name (name),
            CONSTRAINT fk_payment_modes_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payment_modes_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE departments (
            id            CHAR(36)     NOT NULL PRIMARY KEY,
            name          VARCHAR(120) NOT NULL,
            code          VARCHAR(20)  NULL,
            description   TEXT         NULL,
            is_active     TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_departments_name (name),
            UNIQUE KEY ux_departments_code (code),
            CONSTRAINT fk_departments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_departments_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE designations (
            id             CHAR(36)     NOT NULL PRIMARY KEY,
            name           VARCHAR(120) NOT NULL,
            department_id  CHAR(36)     NULL,
            level_grade    VARCHAR(60)  NULL,
            is_active      TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            -- Masters §3.10 Fields Table: "Designation Name ... must be
            -- unique" — globally, with no department qualifier. (Fixed by
            -- the Phase 1 audit: this was originally scoped to (name,
            -- department_id), which let the same title exist under two
            -- departments — not what the spec asks for.)
            UNIQUE KEY ux_designations_name (name),
            KEY idx_designations_dept (department_id, is_active),
            CONSTRAINT fk_designations_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_designations_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_designations_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE hsn_sac_codes (
            id                    CHAR(36)     NOT NULL PRIMARY KEY,
            code                  VARCHAR(20)  NOT NULL,
            code_type             VARCHAR(3)   NOT NULL,
            description           VARCHAR(255) NOT NULL,
            linked_tax_head_id    CHAR(36)     NULL,
            is_custom             TINYINT(1)   NOT NULL DEFAULT 0,
            custom_gst_type       VARCHAR(20)  NULL,
            custom_gst_rate_pct   DECIMAL(7,4) NULL,
            is_active             TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            -- Masters §3.11 Fields Table: "Code ... must be unique" —
            -- globally, no Type qualifier (fixed by the Phase 1 audit: this
            -- was originally (code_type, code), which let the same numeric
            -- code exist as both an HSN and a SAC row).
            UNIQUE KEY ux_hsn_sac_code (code),
            CONSTRAINT fk_hsn_sac_tax FOREIGN KEY (linked_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hsn_sac_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hsn_sac_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_hsn_sac_type CHECK (code_type IN ('HSN','SAC')),
            CONSTRAINT ck_hsn_sac_custom CHECK (is_custom = (linked_tax_head_id IS NULL)),
            CONSTRAINT ck_hsn_sac_custom_fields CHECK (NOT is_custom OR (custom_gst_type IS NOT NULL AND custom_gst_rate_pct IS NOT NULL)),
            CONSTRAINT ck_hsn_sac_gst_type CHECK (custom_gst_type IS NULL OR custom_gst_type IN ('GST_IGST','GST_CGST_SGST'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    for table, extra_cols in [
        ("service_categories", "description TEXT NULL,"),
        ("ticket_categories", "description TEXT NULL,"),
        ("asset_categories", "description TEXT NULL,"),
    ]:
        op.execute(f"""
            CREATE TABLE {table} (
                id            CHAR(36)     NOT NULL PRIMARY KEY,
                name          VARCHAR(120) NOT NULL,
                {extra_cols}
                is_active     TINYINT(1)   NOT NULL DEFAULT 1,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                created_by CHAR(36) NULL,
                updated_by CHAR(36) NULL,
                UNIQUE KEY ux_{table}_name (name),
                CONSTRAINT fk_{table}_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
                CONSTRAINT fk_{table}_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        """)

    for table in ["units_of_measure", "customer_statuses", "customer_sources", "employment_types"]:
        op.execute(f"""
            CREATE TABLE {table} (
                id            CHAR(36)     NOT NULL PRIMARY KEY,
                name          VARCHAR(120) NOT NULL,
                is_active     TINYINT(1)   NOT NULL DEFAULT 1,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                created_by CHAR(36) NULL,
                updated_by CHAR(36) NULL,
                UNIQUE KEY ux_{table}_name (name),
                CONSTRAINT fk_{table}_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
                CONSTRAINT fk_{table}_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
        """)

    op.execute("""
        CREATE TABLE insurance_plans (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            plan_name                       VARCHAR(191)  NOT NULL,
            plan_type                       VARCHAR(20)   NOT NULL,
            provider                        VARCHAR(191)  NULL,
            coverage_amount                 DECIMAL(14,2) NOT NULL,
            company_contribution_monthly    DECIMAL(14,2) NOT NULL,
            employee_contribution_monthly   DECIMAL(14,2) NOT NULL DEFAULT 0,
            is_active                       TINYINT(1)    NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_insurance_plans_name (plan_name),
            KEY idx_insurance_plans_type (plan_type, is_active),
            CONSTRAINT fk_insurance_plans_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_insurance_plans_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_insurance_plans_type CHECK (plan_type IN ('HEALTH','LIFE','PERSONAL_ACCIDENT')),
            CONSTRAINT ck_insurance_plans_coverage CHECK (coverage_amount > 0),
            CONSTRAINT ck_insurance_plans_company CHECK (company_contribution_monthly >= 0),
            CONSTRAINT ck_insurance_plans_employee CHECK (employee_contribution_monthly >= 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ========================================================= COMPANY PROFILE
    op.execute("""
        CREATE TABLE company_profile (
            id                            CHAR(36)     NOT NULL PRIMARY KEY,
            singleton_lock                TINYINT(1)   NOT NULL DEFAULT 1,
            legal_name                    VARCHAR(191) NOT NULL,
            cin                           VARCHAR(30)  NOT NULL,
            tan                           VARCHAR(20)  NULL,
            gstin                         VARCHAR(20)  NULL,
            pan                           CHAR(10)     NOT NULL,
            company_type                  VARCHAR(60)  NOT NULL,
            year_of_incorporation         SMALLINT     NOT NULL,
            industry                      VARCHAR(191) NULL,
            msme_registration_number      VARCHAR(60)  NULL,
            phone                         CHAR(10)     NOT NULL,
            alternate_phone               CHAR(10)     NULL,
            official_email                VARCHAR(191) NOT NULL,
            support_email                 VARCHAR(191) NULL,
            website                       VARCHAR(255) NULL,
            logo_file_id                  CHAR(36)     NULL,
            letterhead_file_id            CHAR(36)     NULL,
            invoice_template_file_id      CHAR(36)     NULL,
            default_billing_tax_head_id   CHAR(36)     NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_company_profile_singleton (singleton_lock),
            CONSTRAINT fk_cp_logo FOREIGN KEY (logo_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cp_letterhead FOREIGN KEY (letterhead_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cp_invoice_template FOREIGN KEY (invoice_template_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cp_default_tax FOREIGN KEY (default_billing_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cp_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_cp_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_cp_singleton CHECK (singleton_lock = 1),
            CONSTRAINT ck_cp_pan CHECK (pan REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'),
            -- Masters §3.6a: "format-checked by the GST Validator utility."
            -- Standard 15-character GSTIN shape: 2-digit state code + 10-char
            -- PAN + 1-digit entity number + 'Z' + 1 checksum char. Optional
            -- (GSTIN was downgraded from mandatory in this revision), but
            -- when present it must be well-formed.
            CONSTRAINT ck_cp_gstin CHECK (gstin IS NULL OR gstin REGEXP '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
            CONSTRAINT ck_cp_phone CHECK (phone REGEXP '^[0-9]{10}$'),
            CONSTRAINT ck_cp_alt_phone CHECK (alternate_phone IS NULL OR alternate_phone REGEXP '^[0-9]{10}$'),
            CONSTRAINT ck_cp_year CHECK (year_of_incorporation BETWEEN 1850 AND 2200),
            CONSTRAINT ck_cp_website CHECK (website IS NULL OR website REGEXP '^https?://')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE company_addresses (
            id             CHAR(36)     NOT NULL PRIMARY KEY,
            address_type   VARCHAR(20)  NOT NULL,
            line1          VARCHAR(191) NOT NULL,
            line2          VARCHAR(191) NULL,
            city           VARCHAR(120) NOT NULL,
            state_id       CHAR(36)     NOT NULL,
            pin_code       CHAR(6)      NOT NULL,
            is_primary     TINYINT(1)   NOT NULL DEFAULT 0,
            is_active      TINYINT(1)   NOT NULL DEFAULT 1,
            -- Global singleton ("only one Primary address, company-wide") ->
            -- constant guard. Unmarking the previous primary happens in the
            -- service layer (see module docstring): MySQL forbids a row
            -- trigger from modifying other rows of the SAME table it fires on.
            primary_guard  TINYINT      GENERATED ALWAYS AS (IF(is_primary = 1, 1, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_company_addresses_one_primary (primary_guard),
            KEY idx_company_addresses_type (address_type, is_active),
            CONSTRAINT fk_company_addresses_state FOREIGN KEY (state_id) REFERENCES indian_states(id) ON DELETE RESTRICT,
            CONSTRAINT fk_company_addresses_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_company_addresses_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_company_addresses_type CHECK (address_type IN ('REGISTERED_OFFICE','BRANCH_OFFICE','CORRESPONDENCE')),
            CONSTRAINT ck_company_addresses_pin CHECK (pin_code REGEXP '^[0-9]{6}$')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE company_documents (
            id                  CHAR(36)     NOT NULL PRIMARY KEY,
            doc_group           VARCHAR(10)  NOT NULL,
            file_id             CHAR(36)     NOT NULL,
            financial_year_id   CHAR(36)     NULL,
            title               VARCHAR(191) NULL,
            is_active           TINYINT(1)   NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY idx_company_documents (doc_group, financial_year_id),
            CONSTRAINT fk_company_documents_file FOREIGN KEY (file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_company_documents_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_company_documents_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_company_documents_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_company_documents_group CHECK (doc_group IN ('GENERAL','FINANCIAL','ROC')),
            CONSTRAINT ck_company_documents_fy_required CHECK (doc_group = 'GENERAL' OR financial_year_id IS NOT NULL)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ====================================================== WORK WEEK & HOURS
    op.execute("""
        CREATE TABLE work_week_policies (
            id                                     CHAR(36)     NOT NULL PRIMARY KEY,
            policy_name                            VARCHAR(191) NOT NULL,
            applies_to                             VARCHAR(20)  NOT NULL,
            department_id                          CHAR(36)     NULL,
            designation_id                         CHAR(36)     NULL,
            employment_type_id                     CHAR(36)     NULL,
            effective_from                         DATE         NOT NULL,
            gross_hours_per_day                    DECIMAL(6,2) NOT NULL,
            unpaid_break_hours                     DECIMAL(6,2) NOT NULL DEFAULT 0,
            net_working_hours_per_day              DECIMAL(6,2) GENERATED ALWAYS AS (gross_hours_per_day - unpaid_break_hours) STORED,
            grace_window_minutes                   SMALLINT     NOT NULL DEFAULT 0,
            half_day_threshold_hours               DECIMAL(6,2) NULL,
            count_overtime_beyond_net              TINYINT(1)   NOT NULL DEFAULT 0,
            weekly_hour_target                     DECIMAL(6,2) NOT NULL,
            weekly_off_days                        VARCHAR(20)  NOT NULL,
            saturday_rule                          VARCHAR(20)  NOT NULL,
            working_saturday_hours_mode            VARCHAR(10)  NULL,
            custom_saturday_hours                  DECIMAL(6,2) NULL,
            mandatory_holiday_overrides_saturday   TINYINT(1)   NOT NULL DEFAULT 1,
            allow_compensatory_hours               TINYINT(1)   NOT NULL DEFAULT 1,
            compensation_window_days               SMALLINT     NULL,
            make_up_day_chosen_by                  VARCHAR(30)  NULL,
            allow_makeup_on_week_off               TINYINT(1)   NOT NULL DEFAULT 0,
            allow_makeup_on_mandatory_holiday      TINYINT(1)   NOT NULL DEFAULT 0,
            max_comp_hours_per_month               DECIMAL(6,2) NOT NULL DEFAULT 0,
            uncompensated_shortfall_becomes        VARCHAR(20)  NOT NULL DEFAULT 'PRO_RATA_LOP',
            excess_hours_become                    VARCHAR(20)  NULL,
            is_active                              TINYINT(1)   NOT NULL DEFAULT 1,
            -- Global singleton ("exactly one active Company-wide policy") ->
            -- constant guard, keyed off BOTH conditions (applies_to AND active).
            company_wide_active_guard              VARCHAR(20)  GENERATED ALWAYS AS (IF(applies_to = 'COMPANY_WIDE' AND is_active = 1, 'COMPANY_WIDE', NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_wwp_one_company_wide (company_wide_active_guard),
            UNIQUE KEY ux_wwp_name (policy_name),
            KEY idx_wwp_resolution (applies_to, is_active, effective_from),
            CONSTRAINT fk_wwp_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wwp_designation FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wwp_emp_type FOREIGN KEY (employment_type_id) REFERENCES employment_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wwp_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wwp_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_wwp_applies_to CHECK (applies_to IN ('COMPANY_WIDE','DEPARTMENT','DESIGNATION','EMPLOYMENT_TYPE','SPECIFIC_EMPLOYEES')),
            CONSTRAINT ck_wwp_applies_to_match CHECK (
                (applies_to = 'COMPANY_WIDE')
                OR (applies_to = 'DEPARTMENT' AND department_id IS NOT NULL)
                OR (applies_to = 'DESIGNATION' AND designation_id IS NOT NULL)
                OR (applies_to = 'EMPLOYMENT_TYPE' AND employment_type_id IS NOT NULL)
                OR (applies_to = 'SPECIFIC_EMPLOYEES')
            ),
            CONSTRAINT ck_wwp_gross_hours CHECK (gross_hours_per_day > 0 AND gross_hours_per_day <= 24),
            CONSTRAINT ck_wwp_break CHECK (unpaid_break_hours >= 0),
            CONSTRAINT ck_wwp_grace CHECK (grace_window_minutes >= 0),
            CONSTRAINT ck_wwp_half_day CHECK (half_day_threshold_hours IS NULL OR half_day_threshold_hours >= 0),
            CONSTRAINT ck_wwp_weekly_target CHECK (weekly_hour_target > 0),
            CONSTRAINT ck_wwp_weekly_off CHECK (weekly_off_days IN ('SUNDAY','SAT_SUN','SUN_ALT_SAT','ROTATIONAL_ONE','FRIDAY','NONE')),
            CONSTRAINT ck_wwp_sat_rule CHECK (saturday_rule IN ('ODD_WORKING','EVEN_WORKING','ALL_WORKING','ALL_OFF','FIRST_ONLY','LAST_ONLY','CUSTOM')),
            CONSTRAINT ck_wwp_sat_hours_mode CHECK (working_saturday_hours_mode IS NULL OR working_saturday_hours_mode IN ('FULL','HALF','CUSTOM')),
            CONSTRAINT ck_wwp_custom_sat_hours CHECK (working_saturday_hours_mode <> 'CUSTOM' OR custom_saturday_hours IS NOT NULL),
            CONSTRAINT ck_wwp_comp_window CHECK (compensation_window_days IS NULL OR compensation_window_days >= 0),
            CONSTRAINT ck_wwp_makeup_by CHECK (make_up_day_chosen_by IS NULL OR make_up_day_chosen_by IN ('EMPLOYEE_WITH_APPROVAL','EMPLOYEE_NO_APPROVAL','MANAGER_ASSIGNS')),
            CONSTRAINT ck_wwp_max_comp CHECK (max_comp_hours_per_month >= 0),
            CONSTRAINT ck_wwp_shortfall CHECK (uncompensated_shortfall_becomes IN ('PRO_RATA_LOP','ROUND_HALF_DAY','ROUND_FULL_DAY','LEAVE_THEN_LOP','IGNORE')),
            CONSTRAINT ck_wwp_excess CHECK (excess_hours_become IS NULL OR excess_hours_become IN ('COMP_CREDIT','COMP_OFF_LEAVE','PAID_OVERTIME','NOT_TRACKED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_wwp_reject_deactivate_sole_company_wide
        BEFORE UPDATE ON work_week_policies
        FOR EACH ROW
        BEGIN
            IF OLD.applies_to = 'COMPANY_WIDE' AND OLD.is_active = 1 AND NEW.is_active = 0 THEN
                IF (SELECT COUNT(*) FROM work_week_policies WHERE applies_to = 'COMPANY_WIDE' AND is_active = 1 AND id <> OLD.id) = 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot deactivate the only active Company-wide Work Week policy';
                END IF;
            END IF;
        END
    """)

    # Cross-phase note (see module docstring): employee_id has NO foreign key
    # yet. Phase 2's migration must ALTER TABLE ADD CONSTRAINT fk_wwpe_employee
    # FOREIGN KEY (employee_id) REFERENCES employees(id) once that table exists.
    op.execute("""
        CREATE TABLE work_week_policy_employees (
            id                     CHAR(36)  NOT NULL PRIMARY KEY,
            work_week_policy_id    CHAR(36)  NOT NULL,
            employee_id            CHAR(36)  NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_wwpe (work_week_policy_id, employee_id),
            KEY idx_wwpe_employee (employee_id),
            CONSTRAINT fk_wwpe_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE CASCADE,
            CONSTRAINT fk_wwpe_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_wwpe_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE saturday_overrides (
            id                          CHAR(36)     NOT NULL PRIMARY KEY,
            saturday_date               DATE         NOT NULL,
            financial_year_id           CHAR(36)     NOT NULL,
            work_week_policy_id         CHAR(36)     NULL,
            pattern_says                VARCHAR(20)  NULL,
            override_to                 VARCHAR(10)  NOT NULL,
            hours_required              DECIMAL(6,2) NOT NULL,
            reason                      VARCHAR(500) NOT NULL,
            notify_affected_employees   TINYINT(1)   NOT NULL DEFAULT 0,
            -- NULL work_week_policy_id means "applies to every policy"; MySQL
            -- has no NULLS-NOT-DISTINCT unique index, so NULL is coalesced to
            -- a sentinel to still get one-row-per-(date, policy-or-all).
            policy_scope_key            VARCHAR(36)  GENERATED ALWAYS AS (COALESCE(work_week_policy_id, 'ALL')) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_sat_overrides_date_policy (saturday_date, policy_scope_key),
            KEY idx_sat_overrides_fy (financial_year_id, saturday_date),
            CONSTRAINT fk_sat_overrides_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sat_overrides_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sat_overrides_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sat_overrides_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_sat_overrides_to CHECK (override_to IN ('WORKING','WEEK_OFF')),
            CONSTRAINT ck_sat_overrides_hours CHECK (hours_required >= 0),
            CONSTRAINT ck_sat_overrides_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE")]:
        op.execute(f"""
            CREATE TRIGGER trg_sat_overrides_must_be_saturday_{verb.lower()}
            {timing} {verb} ON saturday_overrides
            FOR EACH ROW
            BEGIN
                IF DAYOFWEEK(NEW.saturday_date) <> 7 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'saturday_date must actually be a Saturday';
                END IF;
            END
        """)
    # Same rule as holidays' FY-range trigger a few dozen lines up — the
    # sibling table got this check originally and saturday_overrides didn't;
    # fixed by the Phase 1 audit.
    for verb, timing in [("INSERT", "BEFORE"), ("UPDATE", "BEFORE")]:
        op.execute(f"""
            CREATE TRIGGER trg_sat_overrides_date_in_fy_range_{verb.lower()}
            {timing} {verb} ON saturday_overrides
            FOR EACH ROW
            BEGIN
                DECLARE fy_start DATE;
                DECLARE fy_end DATE;
                SELECT start_date, end_date INTO fy_start, fy_end FROM financial_years WHERE id = NEW.financial_year_id;
                IF NEW.saturday_date < fy_start OR NEW.saturday_date > fy_end THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'saturday_date must fall inside the linked Financial Year';
                END IF;
            END
        """)

    op.execute("""
        CREATE TABLE pay_cycles (
            id                    CHAR(36)     NOT NULL PRIMARY KEY,
            cycle_type            VARCHAR(20)  NOT NULL,
            start_day             SMALLINT     NULL,
            end_day               SMALLINT     NULL,
            salary_credit_day     SMALLINT     NOT NULL,
            effective_from        DATE         NOT NULL,
            is_active              TINYINT(1)   NOT NULL DEFAULT 1,
            -- Global singleton ("only one active pay cycle") -> constant guard.
            active_guard          TINYINT      GENERATED ALWAYS AS (IF(is_active = 1, 1, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_pay_cycles_one_active (active_guard),
            CONSTRAINT fk_pay_cycles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pay_cycles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_pay_cycles_type CHECK (cycle_type IN ('FIXED_CYCLE','CALENDAR_MONTH')),
            CONSTRAINT ck_pay_cycles_start CHECK (start_day IS NULL OR start_day BETWEEN 1 AND 31),
            CONSTRAINT ck_pay_cycles_end CHECK (end_day IS NULL OR end_day BETWEEN 1 AND 31),
            CONSTRAINT ck_pay_cycles_credit CHECK (salary_credit_day BETWEEN 1 AND 31),
            CONSTRAINT ck_pay_cycles_fixed_complete CHECK (cycle_type = 'CALENDAR_MONTH' OR (start_day IS NOT NULL AND end_day IS NOT NULL))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE pay_periods (
            id                     CHAR(36)     NOT NULL PRIMARY KEY,
            pay_cycle_id           CHAR(36)     NOT NULL,
            financial_year_id      CHAR(36)     NOT NULL,
            period_year            SMALLINT     NOT NULL,
            period_month           SMALLINT     NOT NULL,
            period_start           DATE         NOT NULL,
            period_end             DATE         NOT NULL,
            salary_credit_date     DATE         NOT NULL,
            is_closed              TINYINT(1)   NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_pay_periods_cycle_month (pay_cycle_id, period_year, period_month),
            KEY idx_pay_periods_range (period_start, period_end),
            CONSTRAINT fk_pay_periods_cycle FOREIGN KEY (pay_cycle_id) REFERENCES pay_cycles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pay_periods_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pay_periods_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pay_periods_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_pay_periods_month CHECK (period_month BETWEEN 1 AND 12),
            CONSTRAINT ck_pay_periods_dates CHECK (period_end >= period_start),
            CONSTRAINT ck_pay_periods_credit CHECK (salary_credit_date > period_end)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ===================================================== EMAIL CONFIGURATION
    op.execute("""
        CREATE TABLE email_server_settings (
            id                       CHAR(36)      NOT NULL PRIMARY KEY,
            singleton_lock           TINYINT(1)    NOT NULL DEFAULT 1,
            sending_enabled          TINYINT(1)    NOT NULL DEFAULT 0,
            provider                 VARCHAR(20)   NOT NULL,
            smtp_host                VARCHAR(191)  NULL,
            smtp_port                INT           NULL,
            encryption               VARCHAR(10)   NULL,
            username                 VARCHAR(191)  NULL,
            password_encrypted       VARBINARY(512) NULL,
            api_key_encrypted        VARBINARY(512) NULL,
            credential_hint          VARCHAR(8)    NULL,
            from_name                VARCHAR(191)  NOT NULL,
            from_email               VARCHAR(191)  NOT NULL,
            reply_to_email           VARCHAR(191)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_email_server_settings_singleton (singleton_lock),
            CONSTRAINT fk_ess_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ess_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ess_singleton CHECK (singleton_lock = 1),
            CONSTRAINT ck_ess_provider CHECK (provider IN ('CUSTOM_SMTP','SENDGRID','SES','MAILGUN','POSTMARK')),
            CONSTRAINT ck_ess_smtp_complete CHECK (provider <> 'CUSTOM_SMTP' OR (smtp_host IS NOT NULL AND smtp_port IS NOT NULL AND encryption IS NOT NULL)),
            CONSTRAINT ck_ess_api_key CHECK (provider = 'CUSTOM_SMTP' OR api_key_encrypted IS NOT NULL),
            CONSTRAINT ck_ess_port CHECK (smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535),
            CONSTRAINT ck_ess_encryption CHECK (encryption IS NULL OR encryption IN ('STARTTLS','SSL_TLS','NONE'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE email_templates (
            id                       CHAR(36)     NOT NULL PRIMARY KEY,
            template_key             VARCHAR(80)  NOT NULL,
            template_name            VARCHAR(191) NOT NULL,
            triggered_from_module    VARCHAR(60)  NOT NULL,
            triggered_from_screen    VARCHAR(60)  NULL,
            is_enabled               TINYINT(1)   NOT NULL DEFAULT 1,
            subject                  VARCHAR(255) NOT NULL,
            body                     TEXT         NOT NULL,
            available_placeholders   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_email_templates_key (template_key),
            CONSTRAINT fk_email_templates_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_email_templates_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Masters §3.23: rows are seeded from trigger points and NEVER deleted.
    # A trigger (not a GRANT) so the guarantee holds regardless of which
    # MySQL user the app connects as — same reasoning as permission_change_log.
    op.execute("""
        CREATE TRIGGER trg_email_templates_reject_delete
        BEFORE DELETE ON email_templates
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Email Template rows are never deleted — disable instead';
        END
    """)

    op.execute("""
        CREATE TABLE email_send_log (
            id                     CHAR(36)     NOT NULL PRIMARY KEY,
            email_template_id      CHAR(36)     NULL,
            recipient_email        VARCHAR(191) NOT NULL,
            subject_snapshot       VARCHAR(255) NOT NULL,
            sent_at                DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            delivery_status        VARCHAR(10)  NOT NULL,
            provider_message_id    VARCHAR(191) NULL,
            error_detail           TEXT         NULL,
            related_record_type    VARCHAR(60)  NULL,
            related_record_id      CHAR(36)     NULL,
            CONSTRAINT fk_email_send_log_template FOREIGN KEY (email_template_id) REFERENCES email_templates(id) ON DELETE RESTRICT,
            KEY idx_email_log_sent (sent_at),
            KEY idx_email_log_recipient (recipient_email, sent_at),
            KEY idx_email_log_status (delivery_status, sent_at),
            CONSTRAINT ck_email_log_status CHECK (delivery_status IN ('QUEUED','DELIVERED','BOUNCED','FAILED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Append-only (ARCH-1 D2): no updated_at/updated_by on this table at all;
    # both mutating verbs are rejected by trigger for the same reason as above.
    op.execute("""
        CREATE TRIGGER trg_email_send_log_reject_update
        BEFORE UPDATE ON email_send_log
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email_send_log is append-only — no updates';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_email_send_log_reject_delete
        BEFORE DELETE ON email_send_log
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email_send_log is append-only — no deletes';
        END
    """)


def downgrade() -> None:
    for table in [
        "email_send_log",
        "email_templates",
        "email_server_settings",
        "pay_periods",
        "pay_cycles",
        "saturday_overrides",
        "work_week_policy_employees",
        "work_week_policies",
        "company_documents",
        "company_addresses",
        "company_profile",
        "insurance_plans",
        "employment_types",
        "customer_sources",
        "customer_statuses",
        "units_of_measure",
        "asset_categories",
        "ticket_categories",
        "service_categories",
        "hsn_sac_codes",
        "designations",
        "departments",
        "payment_modes",
        "holidays",
        "leave_types",
        "expense_types",
        "bank_accounts",
        "number_prefix_rules",
        "tax_head_withholding_directions",
        "tax_head_relief_rules",
        "tax_head_split_components",
        "tax_head_slab_bands",
        "tax_heads",
        "tax_schemes",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table};")
