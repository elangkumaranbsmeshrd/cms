"""Phase 2 — Employee (02-employee-module.md) + Leave (05-leave-module.md).
29 tables in one migration, not two: attendance_records (Employee) carries a
real FK to leave_requests (Leave) — Attendance and Leave are genuinely
interdependent here, exactly as both spec documents say ("time and pay"
share one sidebar tab because they're already tightly coupled), so splitting
them into separate migration files would just create a forward-reference
problem for no benefit. Table order below is the actual dependency order.

Same MySQL dialect discipline as 0001/0002 (see 0002_masters.py's docstring
for the full list of translations applied throughout): VARCHAR + CHECK
instead of native ENUM, REGEXP instead of `~`, generated-column singleton
guards using a literal CONSTANT for a global rule and the GROUPING KEY for a
per-group rule (the bug found and fixed in Phase 0), RESTRICT instead of
CASCADE on any FK a same-table generated column depends on (the MySQL 1215
limitation found in Phase 1).

ARCHITECTURAL DEVIATION FROM ARCH-1, DELIBERATE AND DOCUMENTED HERE ONCE
rather than repeated at every table: ARCH-1 specifies dozens of "spans
tables" / "spans rows" triggers for this scope — attendance day-type/hours
resolution reading three other tables, leave working-days calculation,
salary-structure total rollups, compensatory-hours window/cap derivation,
document-number allocation. Every one of those is genuinely complex,
multi-table DERIVATION logic, not a simple invariant. Writing that as MySQL
trigger bodies makes it both hard to unit-test and hard to read — exactly
the kind of logic the tax engine (Phase 1, app/services/tax_engine.py) was
built as an isolated, independently-tested Python service instead of a SQL
routine, and that worked well. This migration keeps every UNIVERSAL
invariant a trigger can express cleanly (locks, uniqueness guards,
sequencing gates, append-only logs, cycle prevention) in the database, and
moves multi-table DERIVATION into Python services (app/services/
attendance_engine.py, leave_engine.py, salary_engine.py, numbering.py),
called by the API layer before commit — the same "service computes and
validates, trigger is the backstop for the invariants that ARE simple
enough to state as one" split already established for Taxes and Work Week
in Phase 1. The one invariant this migration does NOT relax is the Phase 2
acceptance gate itself: exit-checklist step sequencing is enforced with a
real trigger (trg_exit_checklist_steps_enforce_gate) — "enforced in data"
is non-negotiable and is not a derivation, it is a rule.

Cross-phase notes:
  - `offer_letter_custom_terms.queued_adjustment_id` has NO FK — it will
    reference `payslip_adhoc_adjustments`, a Payroll/Phase 3 table that
    doesn't exist yet. Same pattern as Phase 1's
    work_week_policy_employees.employee_id.
  - `exit_checklist_steps.outstanding_asset_count` defaults to and stays 0
    until Asset Management (Phase 5) exists to populate it — the gate logic
    is real and tested now, but is trivially satisfied on a fresh system
    with no assets yet, which is correct: nothing is owed back if nothing
    was ever issued.
  - number_prefix_rules' code_type CHECK is extended here with two new
    values this phase needs (LTR for offer/appointment/acceptance letters,
    CHR for Compensatory Hour Requests) — EMP already existed in Phase 1's
    list for Employee Code.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-01
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------------------------------------------- number_prefix_rules (extend)
    op.execute("ALTER TABLE number_prefix_rules DROP CHECK ck_prefix_rules_type;")
    op.execute("""
        ALTER TABLE number_prefix_rules ADD CONSTRAINT ck_prefix_rules_type
        CHECK (code_type IN ('INV','PB','CUST','AST','TKT','EMP','PRJ','OPP','CN','EXP','CMP','TSK','BUG','QUO','LTR','CHR'));
    """)

    # ==================================================================== employees
    op.execute("""
        CREATE TABLE employees (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            employee_code               VARCHAR(20)   NOT NULL,
            code_financial_year_id      CHAR(36)      NOT NULL,
            photo_file_id               CHAR(36)      NULL,
            first_name                  VARCHAR(50)   NOT NULL,
            last_name                   VARCHAR(50)   NULL,
            full_name                   VARCHAR(101)  GENERATED ALWAYS AS (TRIM(CONCAT(first_name, ' ', COALESCE(last_name,'')))) STORED,
            email                       VARCHAR(191)  NOT NULL,
            phone                       CHAR(10)      NULL,
            date_of_birth               DATE          NULL,
            gender                      VARCHAR(20)   NULL,
            current_address             TEXT          NULL,
            department_id               CHAR(36)      NOT NULL,
            designation_id              CHAR(36)      NOT NULL,
            employment_type_id          CHAR(36)      NOT NULL,
            joining_date                DATE          NOT NULL,
            reporting_manager_id        CHAR(36)      NULL,
            work_location_address_id    CHAR(36)      NULL,
            employment_status           VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
            exit_date                   DATE          NULL,
            bank_name                   VARCHAR(120)  NULL,
            bank_account_number         VARCHAR(20)   NULL,
            bank_account_last4          VARCHAR(4)    GENERATED ALWAYS AS (RIGHT(bank_account_number, 4)) STORED,
            bank_ifsc_code               CHAR(11)      NULL,
            pan_number                  CHAR(10)      NULL,
            aadhaar_number               VARCHAR(12)   NULL,
            aadhaar_last4                VARCHAR(4)    GENERATED ALWAYS AS (RIGHT(aadhaar_number, 4)) STORED,
            user_id                     CHAR(36)      NULL,
            has_login                   TINYINT(1)    GENERATED ALWAYS AS (user_id IS NOT NULL) STORED NOT NULL,
            login_created_at            DATETIME(6)   NULL,
            login_removed_at            DATETIME(6)   NULL,
            welcome_email_sent_at       DATETIME(6)   NULL,
            welcome_email_sent_by       CHAR(36)      NULL,
            onboarding_completed_at     DATETIME(6)   NULL,
            biometric_enrollment_id     VARCHAR(191)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_employees_code (employee_code),
            UNIQUE KEY ux_employees_email (email),
            UNIQUE KEY ux_employees_user (user_id),
            UNIQUE KEY ux_employees_biometric (biometric_enrollment_id),
            KEY ix_employees_department (department_id),
            KEY ix_employees_designation (designation_id),
            KEY ix_employees_employment_type (employment_type_id),
            KEY ix_employees_status (employment_status),
            KEY ix_employees_reporting_manager (reporting_manager_id),
            KEY ix_employees_joining_date (joining_date),
            FULLTEXT KEY ix_employees_search (first_name, last_name, email),
            CONSTRAINT fk_employees_code_fy FOREIGN KEY (code_financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_photo FOREIGN KEY (photo_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_designation FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_employment_type FOREIGN KEY (employment_type_id) REFERENCES employment_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_reporting_manager FOREIGN KEY (reporting_manager_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_work_location FOREIGN KEY (work_location_address_id) REFERENCES company_addresses(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_welcome_sent_by FOREIGN KEY (welcome_email_sent_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_employees_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_employees_first_name CHECK (CHAR_LENGTH(TRIM(first_name)) BETWEEN 2 AND 50),
            CONSTRAINT ck_employees_gender CHECK (gender IS NULL OR gender IN ('MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY')),
            CONSTRAINT ck_employees_phone CHECK (phone IS NULL OR phone REGEXP '^[6-9][0-9]{9}$'),
            -- No CHECK for "date_of_birth < today": MySQL 8 rejects any
            -- non-deterministic function (CURDATE(), NOW(), etc.) inside a
            -- CHECK constraint (error 3814) — found by actually running
            -- this against the container. Validated at the API layer only.
            CONSTRAINT ck_employees_status CHECK (employment_status IN ('ACTIVE','INACTIVE','ON_NOTICE','EXITED')),
            CONSTRAINT ck_employees_exit_date CHECK (exit_date IS NULL OR exit_date >= joining_date),
            CONSTRAINT ck_employees_bank_account CHECK (bank_account_number IS NULL OR bank_account_number REGEXP '^[0-9]{6,20}$'),
            CONSTRAINT ck_employees_ifsc CHECK (bank_ifsc_code IS NULL OR bank_ifsc_code REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$'),
            CONSTRAINT ck_employees_pan CHECK (pan_number IS NULL OR pan_number REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'),
            CONSTRAINT ck_employees_aadhaar CHECK (aadhaar_number IS NULL OR aadhaar_number REGEXP '^[0-9]{12}$'),
            CONSTRAINT ck_employees_no_self_manager CHECK (reporting_manager_id IS NULL OR reporting_manager_id <> id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Cycle prevention (A→B→A) — spans rows, so a trigger not a CHECK. Bounded
    # walk (max 200 hops) rather than an unbounded loop, since a MySQL
    # trigger has no statement timeout of its own to fall back on.
    op.execute("""
        CREATE TRIGGER trg_employees_reject_reporting_cycle
        BEFORE UPDATE ON employees
        FOR EACH ROW
        BEGIN
            DECLARE current_id CHAR(36);
            DECLARE hops INT DEFAULT 0;
            IF NEW.reporting_manager_id IS NOT NULL THEN
                SET current_id = NEW.reporting_manager_id;
                WHILE current_id IS NOT NULL AND hops < 200 DO
                    IF current_id = NEW.id THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This would create a circular reporting chain';
                    END IF;
                    SELECT reporting_manager_id INTO current_id FROM employees WHERE id = current_id;
                    SET hops = hops + 1;
                END WHILE;
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_employees_enforce_min_age
        BEFORE INSERT ON employees
        FOR EACH ROW
        BEGIN
            IF NEW.date_of_birth IS NOT NULL AND NEW.joining_date < DATE_ADD(NEW.date_of_birth, INTERVAL 18 YEAR) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Employee must be at least 18 years old as of the Joining Date';
            END IF;
        END
    """)
    # A002-style: locking is one-way, and moving to EXITED is gated by the
    # exit checklist's own mark_exited step (see exit_checklist_steps below,
    # created later in this file — this trigger is added there instead,
    # since it must reference that table).

    op.execute("""
        CREATE TABLE employee_statutory_identifiers (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                 CHAR(36)      NOT NULL,
            tax_head_id                 CHAR(36)      NOT NULL,
            identifier_label_snapshot   VARCHAR(191)  NOT NULL,
            identifier_value            VARCHAR(191)  NOT NULL,
            captured_at                 DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_emp_statutory_ids (employee_id, tax_head_id),
            KEY ix_emp_statutory_ids_head (tax_head_id),
            CONSTRAINT fk_esi_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            CONSTRAINT fk_esi_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_esi_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_esi_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_esi_value CHECK (TRIM(identifier_value) <> '')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE employee_emergency_contacts (
            id              CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id     CHAR(36)      NOT NULL,
            contact_name    VARCHAR(191)  NOT NULL,
            relationship    VARCHAR(20)   NULL,
            contact_phone   CHAR(10)      NULL,
            is_primary      TINYINT(1)    NOT NULL DEFAULT 1,
            display_order   SMALLINT      NOT NULL DEFAULT 1,
            primary_guard   CHAR(36)      GENERATED ALWAYS AS (IF(is_primary = 1, employee_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_emergency_contacts_one_primary (primary_guard),
            KEY ix_emergency_contacts_employee (employee_id),
            -- RESTRICT, not CASCADE: primary_guard is a STORED generated
            -- column depending on employee_id (MySQL error 1215 — the same
            -- limitation found and documented in Phase 1's 0002_masters.py).
            CONSTRAINT fk_eec_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_eec_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_eec_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_eec_name CHECK (TRIM(contact_name) <> ''),
            CONSTRAINT ck_eec_relationship CHECK (relationship IS NULL OR relationship IN ('SPOUSE','PARENT','SIBLING','FRIEND','OTHER')),
            CONSTRAINT ck_eec_phone CHECK (contact_phone IS NULL OR contact_phone REGEXP '^[6-9][0-9]{9}$')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ============================================================== salary_structures
    op.execute("""
        CREATE TABLE salary_structures (
            id                                      CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                             CHAR(36)      NOT NULL,
            financial_year_id                       CHAR(36)      NOT NULL,
            effective_from                          DATE          NOT NULL,
            effective_to                            DATE          NULL,
            is_current                              TINYINT(1)    GENERATED ALWAYS AS (effective_to IS NULL) STORED NOT NULL,
            changed_by                              CHAR(36)      NOT NULL,
            change_note                             TEXT          NULL,
            basic_salary_monthly                    DECIMAL(14,2) NOT NULL,
            dearness_allowance_monthly              DECIMAL(14,2) NOT NULL DEFAULT 0,
            hra_monthly                             DECIMAL(14,2) NOT NULL DEFAULT 0,
            lta_amount                              DECIMAL(14,2) NOT NULL DEFAULT 0,
            lta_payout_basis                        VARCHAR(10)   NOT NULL DEFAULT 'MONTHLY',
            special_allowance_monthly               DECIMAL(14,2) NOT NULL DEFAULT 0,
            other_earnings_monthly                  DECIMAL(14,2) NOT NULL DEFAULT 0,
            variable_pay_amount                     DECIMAL(14,2) NOT NULL DEFAULT 0,
            variable_pay_frequency                  VARCHAR(10)   NOT NULL DEFAULT 'ANNUAL',
            gross_monthly                           DECIMAL(14,2) GENERATED ALWAYS AS (
                basic_salary_monthly + dearness_allowance_monthly + hra_monthly
                + IF(lta_payout_basis = 'MONTHLY', lta_amount, 0)
                + special_allowance_monthly + other_earnings_monthly
            ) STORED NOT NULL,
            variable_pay_annualised                 DECIMAL(14,2) GENERATED ALWAYS AS (
                variable_pay_amount * IF(variable_pay_frequency = 'QUARTERLY', 4, 1)
            ) STORED NOT NULL,
            insurance_employee_contribution_monthly DECIMAL(14,2) NOT NULL DEFAULT 0,
            insurance_employer_contribution_monthly DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employee_statutory_monthly        DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employer_statutory_ctc_monthly    DECIMAL(14,2) NOT NULL DEFAULT 0,
            net_monthly                             DECIMAL(14,2) NOT NULL DEFAULT 0,
            annual_ctc                               DECIMAL(14,2) NOT NULL DEFAULT 0,
            basic_plus_da_share_pct                 DECIMAL(6,3)  NOT NULL DEFAULT 0,
            is_wage_code_compliant                  TINYINT(1)    NOT NULL DEFAULT 1,
            wage_code_override_reason               TEXT          NULL,
            wage_code_override_by                   CHAR(36)      NULL,
            wage_code_override_at                   DATETIME(6)   NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_salary_structures_current (employee_id, is_current),
            KEY ix_salary_structures_employee (employee_id, effective_from),
            KEY ix_salary_structures_fy (financial_year_id),
            CONSTRAINT fk_ss_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ss_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ss_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ss_wage_override_by FOREIGN KEY (wage_code_override_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ss_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ss_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ss_effective_to CHECK (effective_to IS NULL OR effective_to >= effective_from),
            CONSTRAINT ck_ss_basic CHECK (basic_salary_monthly >= 0),
            CONSTRAINT ck_ss_lta_basis CHECK (lta_payout_basis IN ('MONTHLY','ANNUAL')),
            CONSTRAINT ck_ss_variable_freq CHECK (variable_pay_frequency IN ('ANNUAL','QUARTERLY')),
            CONSTRAINT ck_ss_wage_override_reason CHECK (is_wage_code_compliant = 1 OR TRIM(COALESCE(wage_code_override_reason,'')) <> '')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # UNIQUE (employee_id, is_current) relies on is_current being a plain
    # generated 0/1 column, not NULL-collapsed — MySQL DOES enforce
    # uniqueness across (employee_id, 1) pairs normally since neither column
    # is NULL, but that would wrongly reject two DIFFERENT employees each
    # having is_current=1. Composite unique on (employee_id, is_current) is
    # actually correct here BECAUSE is_current is only ever 1 for the live
    # row and there can be many rows with is_current=0 per employee (MySQL
    # allows duplicate (employee_id, 0) pairs? No — composite UNIQUE keys
    # treat 0 as a real value like any other, so two historical rows for the
    # same employee would BOTH be (employee_id, 0) and collide.
    # Corrected below with the guard-column pattern instead.
    op.execute("ALTER TABLE salary_structures DROP INDEX ux_salary_structures_current;")
    op.execute("""
        ALTER TABLE salary_structures
        ADD COLUMN current_guard CHAR(36) GENERATED ALWAYS AS (IF(effective_to IS NULL, employee_id, NULL)) STORED,
        ADD UNIQUE KEY ux_salary_structures_current (current_guard);
    """)
    op.execute("""
        CREATE TRIGGER trg_salary_structures_fy_lock_ins
        BEFORE INSERT ON salary_structures
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_salary_structures_fy_lock_upd
        BEFORE UPDATE ON salary_structures
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = OLD.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    # Closing the previous current version is done in the SERVICE layer (the
    # API sets the prior row's effective_to before inserting the new one, in
    # the same transaction) rather than a BEFORE INSERT trigger writing to
    # OTHER rows of the same table it fires on — MySQL forbids that, the
    # same restriction already worked around for company_addresses.is_primary
    # and bank_accounts.is_default in Phase 1.

    op.execute("""
        CREATE TABLE salary_structure_statutory_lines (
            id                                        CHAR(36)      NOT NULL PRIMARY KEY,
            salary_structure_id                       CHAR(36)      NOT NULL,
            tax_head_id                                CHAR(36)      NOT NULL,
            head_name_snapshot                        VARCHAR(191)  NOT NULL,
            print_label_snapshot                      VARCHAR(191)  NOT NULL,
            scope_snapshot                            VARCHAR(40)   NOT NULL,
            tax_type_snapshot                         VARCHAR(20)   NOT NULL,
            rate_snapshot                             DECIMAL(7,4)  NULL,
            fixed_amount_snapshot                     DECIMAL(14,2) NULL,
            slab_application_snapshot                 VARCHAR(20)   NULL,
            computed_base_amount                      DECIMAL(14,2) NOT NULL DEFAULT 0,
            computed_amount_monthly                   DECIMAL(14,2) NOT NULL DEFAULT 0,
            borne_by                                  VARCHAR(10)   NOT NULL,
            include_in_ctc_snapshot                   TINYINT(1)    NOT NULL DEFAULT 0,
            per_employee_opt_out_allowed_snapshot     TINYINT(1)    NOT NULL DEFAULT 0,
            is_applicable                             TINYINT(1)    NOT NULL DEFAULT 1,
            applicability_changed_by                  CHAR(36)      NULL,
            applicability_changed_at                  DATETIME(6)   NULL,
            calculated_at                             DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            display_order                             SMALLINT      NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_ss_statutory_lines (salary_structure_id, tax_head_id),
            KEY ix_ss_statutory_lines_head (tax_head_id),
            CONSTRAINT fk_sssl_structure FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE CASCADE,
            CONSTRAINT fk_sssl_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sssl_applicability_by FOREIGN KEY (applicability_changed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sssl_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sssl_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_sssl_scope CHECK (scope_snapshot IN ('PAYROLL_EMPLOYEE_DEDUCTION','PAYROLL_EMPLOYER_CONTRIBUTION')),
            CONSTRAINT ck_sssl_borne_by CHECK (borne_by IN ('EMPLOYEE','EMPLOYER'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_sssl_guard_opt_out
        BEFORE UPDATE ON salary_structure_statutory_lines
        FOR EACH ROW
        BEGIN
            IF NEW.is_applicable <> OLD.is_applicable AND OLD.per_employee_opt_out_allowed_snapshot = 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This statutory line does not allow a per-employee opt-out';
            END IF;
        END
    """)

    # ===================================================== insurance enrollment
    op.execute("""
        CREATE TABLE employee_insurance_enrollments (
            id                                          CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                                 CHAR(36)      NOT NULL,
            insurance_plan_id                           CHAR(36)      NOT NULL,
            enrollment_date                             DATE          NOT NULL,
            unenrolled_date                             DATE          NULL,
            plan_type_snapshot                          VARCHAR(20)   NOT NULL,
            plan_name_snapshot                          VARCHAR(191)  NOT NULL,
            coverage_amount_snapshot                    DECIMAL(14,2) NOT NULL,
            company_contribution_monthly_snapshot       DECIMAL(14,2) NOT NULL DEFAULT 0,
            employee_contribution_monthly_snapshot      DECIMAL(14,2) NOT NULL DEFAULT 0,
            status                                      VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
            active_pair_guard                           VARCHAR(80)   GENERATED ALWAYS AS (IF(unenrolled_date IS NULL, CONCAT(employee_id,':',insurance_plan_id), NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_eie_active (active_pair_guard),
            KEY ix_eie_employee (employee_id),
            KEY ix_eie_plan (insurance_plan_id),
            CONSTRAINT fk_eie_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_eie_plan FOREIGN KEY (insurance_plan_id) REFERENCES insurance_plans(id) ON DELETE RESTRICT,
            CONSTRAINT fk_eie_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_eie_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_eie_unenrolled CHECK (unenrolled_date IS NULL OR unenrolled_date >= enrollment_date),
            CONSTRAINT ck_eie_plan_type CHECK (plan_type_snapshot IN ('HEALTH','LIFE','PERSONAL_ACCIDENT')),
            CONSTRAINT ck_eie_status CHECK (status IN ('ACTIVE','ENDED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    op.execute("""
        CREATE TABLE insurance_dependents (
            id                                    CHAR(36)      NOT NULL PRIMARY KEY,
            employee_insurance_enrollment_id      CHAR(36)      NOT NULL,
            dependent_name                        VARCHAR(191)  NOT NULL,
            relationship                          VARCHAR(20)   NOT NULL,
            display_order                         SMALLINT      NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_insurance_dependents_enrollment (employee_insurance_enrollment_id),
            CONSTRAINT fk_id_enrollment FOREIGN KEY (employee_insurance_enrollment_id) REFERENCES employee_insurance_enrollments(id) ON DELETE CASCADE,
            CONSTRAINT fk_id_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_id_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_id_name CHECK (TRIM(dependent_name) <> ''),
            CONSTRAINT ck_id_relationship CHECK (relationship IN ('SPOUSE','CHILD','PARENT','PARENT_IN_LAW','SIBLING','OTHER'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_insurance_dependents_guard_plan_type
        BEFORE INSERT ON insurance_dependents
        FOR EACH ROW
        BEGIN
            IF (SELECT plan_type_snapshot FROM employee_insurance_enrollments WHERE id = NEW.employee_insurance_enrollment_id) <> 'HEALTH' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Dependents may only be added to a Health plan enrollment';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE insurance_nominees (
            id                                    CHAR(36)      NOT NULL PRIMARY KEY,
            employee_insurance_enrollment_id      CHAR(36)      NOT NULL,
            nominee_name                          VARCHAR(191)  NOT NULL,
            relationship                          VARCHAR(20)   NOT NULL,
            contact_phone                         CHAR(10)      NULL,
            is_primary                            TINYINT(1)    NOT NULL DEFAULT 1,
            primary_guard                         CHAR(36)      GENERATED ALWAYS AS (IF(is_primary = 1, employee_insurance_enrollment_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_insurance_nominees_primary (primary_guard),
            KEY ix_insurance_nominees_enrollment (employee_insurance_enrollment_id),
            -- RESTRICT: primary_guard depends on this column (MySQL 1215).
            CONSTRAINT fk_in_enrollment FOREIGN KEY (employee_insurance_enrollment_id) REFERENCES employee_insurance_enrollments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_in_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_in_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_in_name CHECK (TRIM(nominee_name) <> ''),
            CONSTRAINT ck_in_phone CHECK (contact_phone IS NULL OR contact_phone REGEXP '^[6-9][0-9]{9}$')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_insurance_nominees_guard_plan_type
        BEFORE INSERT ON insurance_nominees
        FOR EACH ROW
        BEGIN
            IF (SELECT plan_type_snapshot FROM employee_insurance_enrollments WHERE id = NEW.employee_insurance_enrollment_id) NOT IN ('LIFE','PERSONAL_ACCIDENT') THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nominees may only be added to a Life or Personal Accident plan enrollment';
            END IF;
        END
    """)

    # ==================================================================== documents
    op.execute("""
        CREATE TABLE employee_documents (
            id                     CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id            CHAR(36)      NOT NULL,
            document_type          VARCHAR(30)   NOT NULL,
            file_id                CHAR(36)      NOT NULL,
            note                   TEXT          NULL,
            status                 VARCHAR(25)   NOT NULL DEFAULT 'PENDING_VERIFICATION',
            uploaded_at            DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            uploaded_by_user_id    CHAR(36)      NULL,
            verified_by            CHAR(36)      NULL,
            verified_at            DATETIME(6)   NULL,
            rejection_reason       TEXT          NULL,
            source                 VARCHAR(20)   NOT NULL DEFAULT 'EMPLOYEE_UPLOAD',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_employee_documents_employee_status (employee_id, status),
            KEY ix_employee_documents_type (document_type),
            CONSTRAINT fk_ed_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ed_file FOREIGN KEY (file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ed_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ed_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ed_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ed_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ed_type CHECK (document_type IN ('ID_PROOF','EDUCATIONAL_CERTIFICATE','RESUME','OFFER_LETTER_COPY','OTHER')),
            CONSTRAINT ck_ed_status CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
            CONSTRAINT ck_ed_rejection_reason CHECK (status <> 'REJECTED' OR TRIM(COALESCE(rejection_reason,'')) <> ''),
            CONSTRAINT ck_ed_source CHECK (source IN ('EMPLOYEE_UPLOAD','HR_UPLOAD'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Delete rule is role-differentiated (employee: only while Pending;
    # HR/Super Admin: always) — that's an RBAC/API-layer distinction, not a
    # universal invariant, so it's enforced there rather than here. See the
    # module docstring's split.

    # ============================================================ profile changes
    op.execute("""
        CREATE TABLE profile_change_requests (
            id                      CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id             CHAR(36)      NOT NULL,
            requested_by_user_id    CHAR(36)      NOT NULL,
            field_key               VARCHAR(30)   NOT NULL,
            target_tax_head_id      CHAR(36)      NULL,
            old_value               TEXT          NULL,
            requested_value         TEXT          NOT NULL,
            employee_note           TEXT          NULL,
            status                  VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            decided_by              CHAR(36)      NULL,
            decided_at              DATETIME(6)   NULL,
            decision_reason         TEXT          NULL,
            applied_at              DATETIME(6)   NULL,
            pending_guard           VARCHAR(220)  GENERATED ALWAYS AS (
                IF(status = 'PENDING', CONCAT(employee_id, ':', field_key, ':', COALESCE(target_tax_head_id, '-')), NULL)
            ) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_pcr_one_pending (pending_guard),
            KEY ix_pcr_queue (status, created_at),
            KEY ix_pcr_employee (employee_id, created_at),
            CONSTRAINT fk_pcr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcr_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcr_tax_head FOREIGN KEY (target_tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcr_decided_by FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcr_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_pcr_field CHECK (field_key IN ('FIRST_NAME','LAST_NAME','EMAIL','DATE_OF_BIRTH','GENDER','BANK_NAME','BANK_ACCOUNT_NUMBER','BANK_IFSC_CODE','PAN_NUMBER','AADHAAR_NUMBER','STATUTORY_IDENTIFIER')),
            CONSTRAINT ck_pcr_target_head CHECK ((field_key = 'STATUTORY_IDENTIFIER') = (target_tax_head_id IS NOT NULL)),
            CONSTRAINT ck_pcr_requested_value CHECK (TRIM(requested_value) <> ''),
            CONSTRAINT ck_pcr_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
            CONSTRAINT ck_pcr_decision_reason CHECK (status <> 'REJECTED' OR TRIM(COALESCE(decision_reason,'')) <> '')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_pcr_immutable_after_decision
        BEFORE UPDATE ON profile_change_requests
        FOR EACH ROW
        BEGIN
            IF OLD.status <> 'PENDING' AND NEW.status = OLD.status AND NEW.decision_reason <=> OLD.decision_reason THEN
                -- allow no-op re-saves; block anything that actually changes a decided row
                SET @noop = 1;
            ELSEIF OLD.status <> 'PENDING' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A decided change request is immutable';
            END IF;
        END
    """)

    # ================================================================= leave_requests
    # (created here, before attendance_records, which references it)
    op.execute("""
        CREATE TABLE leave_requests (
            id                            CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                   CHAR(36)      NOT NULL,
            leave_type_id                 CHAR(36)      NOT NULL,
            financial_year_id             CHAR(36)      NOT NULL,
            from_date                     DATE          NOT NULL,
            to_date                       DATE          NOT NULL,
            is_half_day                   TINYINT(1)    NOT NULL DEFAULT 0,
            half_day_session              VARCHAR(12)   NULL,
            days_requested                DECIMAL(5,2)  NOT NULL,
            working_days_basis_policy_id  CHAR(36)      NOT NULL,
            reason                        TEXT          NOT NULL,
            paid_type_snapshot            VARCHAR(10)   NOT NULL,
            status                        VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            routed_to_role                VARCHAR(20)   NOT NULL,
            routed_to_user_id             CHAR(36)      NULL,
            routing_reason                TEXT          NOT NULL,
            applied_at                    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            actioned_by                   CHAR(36)      NULL,
            actioned_at                   DATETIME(6)   NULL,
            decision_reason               TEXT          NULL,
            cancelled_at                  DATETIME(6)   NULL,
            cancelled_by_user_id          CHAR(36)      NULL,
            reassigned_from_user_id       CHAR(36)      NULL,
            reassigned_by                 CHAR(36)      NULL,
            reassigned_at                 DATETIME(6)   NULL,
            hr_co_approval_required       TINYINT(1)    NOT NULL DEFAULT 0,
            hr_co_approved_by             CHAR(36)      NULL,
            hr_co_approved_at             DATETIME(6)   NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_leave_requests_queue (routed_to_user_id, applied_at),
            KEY ix_leave_requests_pending_role (routed_to_role, applied_at),
            KEY ix_leave_requests_employee_dates (employee_id, from_date),
            KEY ix_leave_requests_type (leave_type_id, status),
            KEY ix_leave_requests_fy (financial_year_id, status),
            CONSTRAINT fk_lr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_policy FOREIGN KEY (working_days_basis_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_actioned_by FOREIGN KEY (actioned_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_routed_to_user FOREIGN KEY (routed_to_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_reassigned_from FOREIGN KEY (reassigned_from_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_reassigned_by FOREIGN KEY (reassigned_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_hr_co_approved_by FOREIGN KEY (hr_co_approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lr_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_lr_dates CHECK (to_date >= from_date),
            CONSTRAINT ck_lr_half_day_same_date CHECK (is_half_day = 0 OR from_date = to_date),
            CONSTRAINT ck_lr_half_session CHECK ((half_day_session IS NOT NULL) = (is_half_day = 1)),
            CONSTRAINT ck_lr_half_session_value CHECK (half_day_session IS NULL OR half_day_session IN ('FIRST_HALF','SECOND_HALF')),
            CONSTRAINT ck_lr_days CHECK (days_requested > 0 AND days_requested * 2 = FLOOR(days_requested * 2)),
            CONSTRAINT ck_lr_reason CHECK (TRIM(reason) <> ''),
            CONSTRAINT ck_lr_paid_type CHECK (paid_type_snapshot IN ('PAID','UNPAID')),
            CONSTRAINT ck_lr_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
            CONSTRAINT ck_lr_routed_role CHECK (routed_to_role IN ('REPORTING_MANAGER','HR','SUPER_ADMIN')),
            CONSTRAINT ck_lr_decision_reason CHECK (status <> 'REJECTED' OR TRIM(COALESCE(decision_reason,'')) <> '')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_leave_requests_fy_lock
        BEFORE INSERT ON leave_requests
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_leave_requests_block_self_approval
        BEFORE UPDATE ON leave_requests
        FOR EACH ROW
        BEGIN
            IF NEW.status <> OLD.status AND NEW.actioned_by IS NOT NULL THEN
                IF (SELECT user_id FROM employees WHERE id = NEW.employee_id) = NEW.actioned_by THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A person may not approve their own leave request';
                END IF;
            END IF;
        END
    """)
    # The hard balance-block, the working-days calculation and the routing
    # rule are computed by app/services/leave_engine.py BEFORE the INSERT is
    # issued (so the API can return the exact shortfall message) — the same
    # "service computes, DB is the backstop for what's cheap to restate as a
    # single CHECK" split as Taxes in Phase 1. The overlapping-Pending/
    # Approved-dates check (ARCH-1: "no MySQL equivalent, needs a trigger
    # plus a service-layer SELECT...FOR UPDATE check") is service-layer only
    # here for the same reason.

    # =============================================================== attendance
    op.execute("""
        CREATE TABLE attendance_records (
            id                                CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                       CHAR(36)      NOT NULL,
            attendance_date                   DATE          NOT NULL,
            financial_year_id                 CHAR(36)      NOT NULL,
            work_week_policy_id               CHAR(36)      NOT NULL,
            policy_name_snapshot              VARCHAR(191)  NOT NULL,
            day_type                          VARCHAR(20)   NOT NULL,
            saturday_ordinal                  SMALLINT      NULL,
            holiday_id                        CHAR(36)      NULL,
            saturday_override_id              CHAR(36)      NULL,
            check_in_time                     TIME          NULL,
            check_out_time                    TIME          NULL,
            spans_midnight                    TINYINT(1)    NOT NULL DEFAULT 0,
            gross_hours                       DECIMAL(6,2)  NOT NULL DEFAULT 0,
            break_hours                       DECIMAL(6,2)  NOT NULL DEFAULT 0,
            net_worked_hours                  DECIMAL(6,2)  GENERATED ALWAYS AS (gross_hours - break_hours) STORED NOT NULL,
            required_hours                    DECIMAL(6,2)  NOT NULL DEFAULT 0,
            balance_hours                     DECIMAL(6,2)  GENERATED ALWAYS AS (gross_hours - break_hours - required_hours) STORED NOT NULL,
            day_status                        VARCHAR(20)   NOT NULL DEFAULT 'NOT_REQUIRED',
            net_hours_per_day_snapshot        DECIMAL(6,2)  NOT NULL DEFAULT 0,
            grace_window_minutes_snapshot     INT           NOT NULL DEFAULT 0,
            half_day_threshold_hours_snapshot DECIMAL(6,2)  NULL,
            leave_credit_hours                DECIMAL(6,2)  NOT NULL DEFAULT 0,
            leave_request_id                  CHAR(36)      NULL,
            compensatory_credit_hours         DECIMAL(6,2)  NOT NULL DEFAULT 0,
            is_compensatory_makeup_day        TINYINT(1)    NOT NULL DEFAULT 0,
            shortfall_cleared_hours           DECIMAL(6,2)  NOT NULL DEFAULT 0,
            source                            VARCHAR(20)   NOT NULL DEFAULT 'MANUAL_ENTRY',
            recorded_by_user_id                CHAR(36)      NULL,
            recorded_by_label                 VARCHAR(191)  NOT NULL,
            recorded_by_device_id              VARCHAR(191)  NULL,
            office_location_address_id        CHAR(36)      NULL,
            note                              TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_attendance_employee_date (employee_id, attendance_date),
            KEY ix_attendance_date (attendance_date),
            KEY ix_attendance_employee_recent (employee_id, attendance_date),
            KEY ix_attendance_policy (work_week_policy_id),
            KEY ix_attendance_fy (financial_year_id),
            KEY ix_attendance_status (day_status),
            CONSTRAINT fk_ar_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_holiday FOREIGN KEY (holiday_id) REFERENCES holidays(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_saturday_override FOREIGN KEY (saturday_override_id) REFERENCES saturday_overrides(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_leave_request FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_recorded_by_user FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_office FOREIGN KEY (office_location_address_id) REFERENCES company_addresses(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ar_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ar_day_type CHECK (day_type IN ('WORKING_DAY','WORKING_SATURDAY','WEEKLY_OFF','MANDATORY_HOLIDAY','OPTIONAL_HOLIDAY')),
            CONSTRAINT ck_ar_saturday_ordinal CHECK (saturday_ordinal IS NULL OR saturday_ordinal BETWEEN 1 AND 5),
            CONSTRAINT ck_ar_gross CHECK (gross_hours >= 0),
            CONSTRAINT ck_ar_break CHECK (break_hours >= 0),
            CONSTRAINT ck_ar_required CHECK (required_hours >= 0),
            CONSTRAINT ck_ar_day_status CHECK (day_status IN ('FULL_DAY','FULL_DAY_GRACE','HALF_DAY','ABSENT','NOT_REQUIRED')),
            CONSTRAINT ck_ar_leave_credit CHECK (leave_credit_hours >= 0),
            CONSTRAINT ck_ar_comp_credit CHECK (compensatory_credit_hours >= 0),
            CONSTRAINT ck_ar_shortfall_cleared CHECK (shortfall_cleared_hours >= 0),
            CONSTRAINT ck_ar_source CHECK (source IN ('MANUAL_ENTRY','BIOMETRIC_DEVICE','EXTERNAL_HR_SYSTEM','MOBILE_CHECKIN'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_attendance_fy_lock_ins
        BEFORE INSERT ON attendance_records
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_attendance_fy_lock_upd
        BEFORE UPDATE ON attendance_records
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = OLD.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    # day_type/required_hours/day_status resolution is
    # app/services/attendance_engine.py, computed before INSERT — this is
    # the clearest case of "genuinely complex, multi-table derivation better
    # served by a tested Python function than a SQL trigger body" in this
    # migration: it reads the covering work_week_policy, the Saturday rule,
    # the Holiday calendar and any Saturday override together.

    op.execute("""
        CREATE TABLE compensatory_hour_requests (
            id                                          CHAR(36)      NOT NULL PRIMARY KEY,
            request_number                              VARCHAR(20)   NOT NULL,
            employee_id                                 CHAR(36)      NOT NULL,
            financial_year_id                           CHAR(36)      NOT NULL,
            shortfall_attendance_record_id              CHAR(36)      NOT NULL,
            shortfall_date                              DATE          NOT NULL,
            hours_short                                 DECIMAL(6,2)  NOT NULL,
            day_status_at_request                       VARCHAR(20)   NOT NULL,
            shortfall_reason                            TEXT          NOT NULL,
            make_up_date                                DATE          NOT NULL,
            make_up_day_type                            VARCHAR(20)   NOT NULL,
            work_week_policy_id                         CHAR(36)      NOT NULL,
            hours_to_work                               DECIMAL(6,2)  NOT NULL,
            planned_check_in_time                       TIME          NULL,
            planned_check_out_time                      TIME          NULL,
            planned_break_hours                         DECIMAL(6,2)  NOT NULL DEFAULT 0,
            compensation_window_days_snapshot           INT           NOT NULL,
            window_last_permissible_date                DATE          NOT NULL,
            max_comp_hours_per_month_snapshot           DECIMAL(6,2)  NULL,
            month_hours_used_at_submit                  DECIMAL(6,2)  NOT NULL DEFAULT 0,
            allow_makeup_on_week_off_snapshot           TINYINT(1)    NOT NULL DEFAULT 0,
            allow_makeup_on_mandatory_holiday_snapshot  TINYINT(1)    NOT NULL DEFAULT 0,
            estimated_payroll_impact                    DECIMAL(14,2) NOT NULL DEFAULT 0,
            uncompensated_shortfall_becomes_snapshot    VARCHAR(20)   NOT NULL,
            status                                      VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            open_shortfall_guard                        CHAR(36)      GENERATED ALWAYS AS (IF(status IN ('PENDING','APPROVED'), shortfall_attendance_record_id, NULL)) STORED,
            routed_to_role                               VARCHAR(20)   NOT NULL,
            routed_to_user_id                           CHAR(36)      NULL,
            routing_reason                              TEXT          NOT NULL,
            actioned_by                                 CHAR(36)      NULL,
            actioned_at                                 DATETIME(6)   NULL,
            decision_reason                             TEXT          NULL,
            makeup_attendance_record_id                 CHAR(36)      NULL,
            hours_actually_worked                       DECIMAL(6,2)  NULL,
            hours_credited                              DECIMAL(6,2)  NOT NULL DEFAULT 0,
            residual_shortfall_hours                    DECIMAL(6,2)  NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_chr_number (request_number),
            UNIQUE KEY ux_chr_one_open_per_shortfall (open_shortfall_guard),
            KEY ix_chr_queue (routed_to_user_id, created_at),
            KEY ix_chr_employee (employee_id, shortfall_date),
            KEY ix_chr_makeup_date (make_up_date),
            KEY ix_chr_window_expiry (window_last_permissible_date),
            KEY ix_chr_fy (financial_year_id, status),
            CONSTRAINT fk_chr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_shortfall_ar FOREIGN KEY (shortfall_attendance_record_id) REFERENCES attendance_records(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_actioned_by FOREIGN KEY (actioned_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_makeup_ar FOREIGN KEY (makeup_attendance_record_id) REFERENCES attendance_records(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_chr_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_chr_hours_short CHECK (hours_short > 0),
            CONSTRAINT ck_chr_day_status CHECK (day_status_at_request IN ('FULL_DAY','FULL_DAY_GRACE','HALF_DAY','ABSENT','NOT_REQUIRED')),
            CONSTRAINT ck_chr_reason CHECK (TRIM(shortfall_reason) <> ''),
            CONSTRAINT ck_chr_makeup_after_shortfall CHECK (make_up_date >= shortfall_date),
            CONSTRAINT ck_chr_makeup_day_type CHECK (make_up_day_type IN ('WORKING_DAY','WORKING_SATURDAY','WEEKLY_OFF','MANDATORY_HOLIDAY','OPTIONAL_HOLIDAY')),
            CONSTRAINT ck_chr_hours_to_work CHECK (hours_to_work >= hours_short),
            CONSTRAINT ck_chr_break CHECK (planned_break_hours >= 0),
            CONSTRAINT ck_chr_window_days CHECK (compensation_window_days_snapshot >= 0),
            CONSTRAINT ck_chr_within_window CHECK (make_up_date <= window_last_permissible_date),
            CONSTRAINT ck_chr_max_hours CHECK (max_comp_hours_per_month_snapshot IS NULL OR max_comp_hours_per_month_snapshot >= 0),
            CONSTRAINT ck_chr_shortfall_treatment CHECK (uncompensated_shortfall_becomes_snapshot IN ('PRO_RATA_LOP','ROUND_HALF_DAY','ROUND_FULL_DAY','LEAVE_THEN_LOP','IGNORE')),
            CONSTRAINT ck_chr_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
            CONSTRAINT ck_chr_routed_role CHECK (routed_to_role IN ('REPORTING_MANAGER','HR','SUPER_ADMIN')),
            CONSTRAINT ck_chr_decision_reason CHECK (status <> 'REJECTED' OR TRIM(COALESCE(decision_reason,'')) <> ''),
            CONSTRAINT ck_chr_hours_credited CHECK (hours_credited >= 0),
            CONSTRAINT ck_chr_residual CHECK (residual_shortfall_hours >= 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_chr_fy_lock
        BEFORE INSERT ON compensatory_hour_requests
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_chr_block_self_approval
        BEFORE UPDATE ON compensatory_hour_requests
        FOR EACH ROW
        BEGIN
            IF NEW.status <> OLD.status AND NEW.actioned_by IS NOT NULL THEN
                IF (SELECT user_id FROM employees WHERE id = NEW.employee_id) = NEW.actioned_by THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A person may not approve their own compensatory hour request';
                END IF;
            END IF;
        END
    """)

    # ============================================================== leave balances
    op.execute("""
        CREATE TABLE leave_balances (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                     CHAR(36)      NOT NULL,
            leave_type_id                   CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            allowed_days                    DECIMAL(5,2)  NOT NULL DEFAULT 0,
            carried_forward_days            DECIMAL(5,2)  NOT NULL DEFAULT 0,
            adjustment_days                 DECIMAL(5,2)  NOT NULL DEFAULT 0,
            taken_days                      DECIMAL(5,2)  NOT NULL DEFAULT 0,
            pending_days                    DECIMAL(5,2)  NOT NULL DEFAULT 0,
            remaining_days                  DECIMAL(6,2)  GENERATED ALWAYS AS (allowed_days + carried_forward_days + adjustment_days - taken_days - pending_days) STORED NOT NULL,
            is_quota_tracked                TINYINT(1)    NOT NULL DEFAULT 1,
            default_annual_quota_snapshot   DECIMAL(5,2)  NOT NULL DEFAULT 0,
            carry_forward_allowed_snapshot  TINYINT(1)    NOT NULL DEFAULT 0,
            max_carry_forward_days_snapshot DECIMAL(5,2)  NULL,
            prorated_from_date              DATE          NULL,
            proration_months                DECIMAL(6,3)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_leave_balances (employee_id, leave_type_id, financial_year_id),
            KEY ix_leave_balances_fy_type (financial_year_id, leave_type_id),
            KEY ix_leave_balances_employee (employee_id, financial_year_id),
            CONSTRAINT fk_lb_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lb_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lb_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lb_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lb_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_lb_allowed CHECK (allowed_days >= 0 AND allowed_days * 2 = FLOOR(allowed_days * 2)),
            CONSTRAINT ck_lb_carried CHECK (carried_forward_days >= 0 AND carried_forward_days * 2 = FLOOR(carried_forward_days * 2)),
            CONSTRAINT ck_lb_adjustment CHECK (adjustment_days * 2 = FLOOR(adjustment_days * 2)),
            CONSTRAINT ck_lb_taken CHECK (taken_days >= 0 AND taken_days * 2 = FLOOR(taken_days * 2)),
            CONSTRAINT ck_lb_pending CHECK (pending_days >= 0 AND pending_days * 2 = FLOOR(pending_days * 2))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_leave_balances_fy_lock_ins
        BEFORE INSERT ON leave_balances
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_leave_balances_fy_lock_upd
        BEFORE UPDATE ON leave_balances
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = OLD.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE leave_carry_forward_runs (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            from_financial_year_id    CHAR(36)      NOT NULL,
            to_financial_year_id      CHAR(36)      NOT NULL,
            status                    VARCHAR(12)   NOT NULL DEFAULT 'PREVIEW',
            previewed_at              DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            previewed_by              CHAR(36)      NOT NULL,
            committed_at              DATETIME(6)   NULL,
            committed_by              CHAR(36)      NULL,
            cancelled_at              DATETIME(6)   NULL,
            employee_count            INT           NOT NULL DEFAULT 0,
            line_count                INT           NOT NULL DEFAULT 0,
            total_days_carried        DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_days_lapsed         DECIMAL(14,2) NOT NULL DEFAULT 0,
            filter_snapshot           JSON          NULL,
            committed_guard           VARCHAR(80)   GENERATED ALWAYS AS (IF(status = 'COMMITTED', CONCAT(from_financial_year_id, ':', to_financial_year_id), NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_lcfr_one_committed (committed_guard),
            KEY ix_lcfr_status (status, previewed_at),
            KEY ix_lcfr_to_fy (to_financial_year_id),
            CONSTRAINT fk_lcfr_from_fy FOREIGN KEY (from_financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfr_to_fy FOREIGN KEY (to_financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfr_previewed_by FOREIGN KEY (previewed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfr_committed_by FOREIGN KEY (committed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfr_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_lcfr_distinct_fy CHECK (to_financial_year_id <> from_financial_year_id),
            CONSTRAINT ck_lcfr_status CHECK (status IN ('PREVIEW','COMMITTED','CANCELLED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # Locked against the TARGET year only, deliberately not the source year —
    # this run is what closes the source year out, so locking against the
    # source would make the feature unrunnable (matches ARCH-1's own note).
    op.execute("""
        CREATE TRIGGER trg_lcfr_fy_lock
        BEFORE INSERT ON leave_carry_forward_runs
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.to_financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The target Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_lcfr_immutable_after_commit
        BEFORE UPDATE ON leave_carry_forward_runs
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'COMMITTED' AND (
                NEW.status <> OLD.status OR NEW.total_days_carried <> OLD.total_days_carried
            ) THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A committed carry-forward run is immutable';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE leave_carry_forward_lines (
            id                                  CHAR(36)      NOT NULL PRIMARY KEY,
            leave_carry_forward_run_id          CHAR(36)      NOT NULL,
            employee_id                         CHAR(36)      NOT NULL,
            leave_type_id                       CHAR(36)      NOT NULL,
            source_leave_balance_id             CHAR(36)      NOT NULL,
            target_leave_balance_id             CHAR(36)      NULL,
            remaining_days_at_run               DECIMAL(5,2)  NOT NULL,
            carry_forward_allowed_snapshot      TINYINT(1)    NOT NULL,
            max_carry_forward_days_snapshot     DECIMAL(5,2)  NULL,
            days_carried_forward                DECIMAL(5,2)  NOT NULL DEFAULT 0,
            days_lapsed                         DECIMAL(5,2)  GENERATED ALWAYS AS (remaining_days_at_run - days_carried_forward) STORED NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_lcfl (leave_carry_forward_run_id, employee_id, leave_type_id),
            KEY ix_lcfl_employee (employee_id),
            KEY ix_lcfl_run (leave_carry_forward_run_id),
            CONSTRAINT fk_lcfl_run FOREIGN KEY (leave_carry_forward_run_id) REFERENCES leave_carry_forward_runs(id) ON DELETE CASCADE,
            CONSTRAINT fk_lcfl_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfl_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfl_source_balance FOREIGN KEY (source_leave_balance_id) REFERENCES leave_balances(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfl_target_balance FOREIGN KEY (target_leave_balance_id) REFERENCES leave_balances(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfl_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lcfl_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_lcfl_remaining CHECK (remaining_days_at_run * 2 = FLOOR(remaining_days_at_run * 2)),
            CONSTRAINT ck_lcfl_max_days CHECK (max_carry_forward_days_snapshot IS NULL OR max_carry_forward_days_snapshot >= 0),
            CONSTRAINT ck_lcfl_carried_bounds CHECK (days_carried_forward >= 0 AND days_carried_forward <= remaining_days_at_run AND days_carried_forward * 2 = FLOOR(days_carried_forward * 2))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_lcfl_lock_after_commit
        BEFORE UPDATE ON leave_carry_forward_lines
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM leave_carry_forward_runs WHERE id = OLD.leave_carry_forward_run_id) = 'COMMITTED' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This carry-forward run has already been committed';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE leave_balance_adjustments (
            id                            CHAR(36)      NOT NULL PRIMARY KEY,
            leave_balance_id              CHAR(36)      NOT NULL,
            employee_id                   CHAR(36)      NOT NULL,
            leave_type_id                 CHAR(36)      NOT NULL,
            financial_year_id             CHAR(36)      NOT NULL,
            adjustment_days               DECIMAL(5,2)  NOT NULL,
            adjustment_direction          VARCHAR(10)   GENERATED ALWAYS AS (IF(adjustment_days > 0, 'INCREASE', 'DECREASE')) STORED,
            reason                        TEXT          NOT NULL,
            source                        VARCHAR(25)   NOT NULL DEFAULT 'MANUAL_CORRECTION',
            leave_carry_forward_line_id   CHAR(36)      NULL,
            adjusted_by                   CHAR(36)      NOT NULL,
            adjusted_at                   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            balance_before                DECIMAL(6,2)  NOT NULL,
            balance_after                 DECIMAL(6,2)  NOT NULL,
            notification_sent_at          DATETIME(6)   NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_lba_employee (employee_id, adjusted_at),
            KEY ix_lba_balance (leave_balance_id),
            KEY ix_lba_adjusted_by (adjusted_by, adjusted_at),
            KEY ix_lba_type (leave_type_id),
            KEY ix_lba_direction (adjustment_direction, adjusted_at),
            CONSTRAINT fk_lba_balance FOREIGN KEY (leave_balance_id) REFERENCES leave_balances(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_leave_type FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_cf_line FOREIGN KEY (leave_carry_forward_line_id) REFERENCES leave_carry_forward_lines(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_adjusted_by FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_lba_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_lba_nonzero CHECK (adjustment_days <> 0 AND adjustment_days * 2 = FLOOR(adjustment_days * 2)),
            CONSTRAINT ck_lba_reason CHECK (TRIM(reason) <> ''),
            CONSTRAINT ck_lba_source CHECK (source IN ('MANUAL_CORRECTION','CARRY_FORWARD_RUN','ONBOARDING_PRORATION','SYSTEM')),
            CONSTRAINT ck_lba_cf_line_pairing CHECK ((source = 'CARRY_FORWARD_RUN') = (leave_carry_forward_line_id IS NOT NULL))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_lba_append_only_upd
        BEFORE UPDATE ON leave_balance_adjustments
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'leave_balance_adjustments is append-only — no updates';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_lba_append_only_del
        BEFORE DELETE ON leave_balance_adjustments
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'leave_balance_adjustments is append-only — no deletes';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_lba_fy_lock
        BEFORE INSERT ON leave_balance_adjustments
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    # ============================================================ announcements
    op.execute("""
        CREATE TABLE announcements (
            id               CHAR(36)      NOT NULL PRIMARY KEY,
            title            VARCHAR(255)  NOT NULL,
            message          TEXT          NOT NULL,
            target_scope     VARCHAR(20)   NOT NULL,
            posted_by_user_id CHAR(36)     NOT NULL,
            published_at     DATETIME(6)   NULL,
            expiry_date      DATE          NULL,
            status           VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_announcements_feed (published_at),
            KEY ix_announcements_posted_by (posted_by_user_id),
            FULLTEXT KEY ix_announcements_search (title, message),
            CONSTRAINT fk_ann_posted_by FOREIGN KEY (posted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ann_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ann_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ann_title CHECK (TRIM(title) <> ''),
            CONSTRAINT ck_ann_message CHECK (TRIM(message) <> ''),
            CONSTRAINT ck_ann_scope CHECK (target_scope IN ('ALL_EMPLOYEES','DEPARTMENT')),
            CONSTRAINT ck_ann_status CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TABLE announcement_targets (
            id               CHAR(36) NOT NULL PRIMARY KEY,
            announcement_id  CHAR(36) NOT NULL,
            department_id    CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_announcement_targets (announcement_id, department_id),
            KEY ix_announcement_targets_department (department_id),
            CONSTRAINT fk_at_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
            CONSTRAINT fk_at_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_at_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_at_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_announcements_require_target
        BEFORE UPDATE ON announcements
        FOR EACH ROW
        BEGIN
            IF NEW.status = 'PUBLISHED' AND OLD.status <> 'PUBLISHED' AND NEW.target_scope = 'DEPARTMENT' THEN
                IF (SELECT COUNT(*) FROM announcement_targets WHERE announcement_id = NEW.id) = 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A department-scoped announcement needs at least one target department before publishing';
                END IF;
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE notifications (
            id                    CHAR(36)      NOT NULL PRIMARY KEY,
            recipient_user_id     CHAR(36)      NOT NULL,
            notification_type     VARCHAR(25)   NOT NULL,
            title                 VARCHAR(255)  NOT NULL,
            body                  TEXT          NOT NULL,
            source_module         VARCHAR(60)   NOT NULL,
            source_record_id      CHAR(36)      NULL,
            deep_link_path        VARCHAR(255)  NULL,
            is_read               TINYINT(1)    NOT NULL DEFAULT 0,
            read_at               DATETIME(6)   NULL,
            email_send_log_id     CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_notifications_unread (recipient_user_id, created_at),
            KEY ix_notifications_recipient (recipient_user_id, created_at),
            KEY ix_notifications_type (recipient_user_id, notification_type),
            CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_notif_email_log FOREIGN KEY (email_send_log_id) REFERENCES email_send_log(id) ON DELETE RESTRICT,
            CONSTRAINT fk_notif_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_notif_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_notif_type CHECK (notification_type IN ('LEAVE','DOCUMENT','PAYSLIP','TICKET','TASK','ASSET','PROFILE_CHANGE','ANNOUNCEMENT','COMPENSATORY_HOURS','ONBOARDING','EXIT','TAX_DECLARATION')),
            CONSTRAINT ck_notif_read_at CHECK ((read_at IS NULL) = (is_read = 0))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_notifications_stamp_read
        BEFORE UPDATE ON notifications
        FOR EACH ROW
        BEGIN
            IF NEW.is_read = 1 AND OLD.is_read = 0 AND NEW.read_at IS NULL THEN
                SET NEW.read_at = CURRENT_TIMESTAMP(6);
            ELSEIF NEW.is_read = 0 THEN
                SET NEW.read_at = NULL;
            END IF;
        END
    """)

    # ============================================================== resignations
    op.execute("""
        CREATE TABLE resignations (
            id                                CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                       CHAR(36)      NOT NULL,
            financial_year_id                 CHAR(36)      NOT NULL,
            last_working_day                  DATE          NOT NULL,
            reason                            TEXT          NULL,
            submitted_at                      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            submitted_by_user_id              CHAR(36)      NOT NULL,
            status                            VARCHAR(20)   NOT NULL DEFAULT 'SUBMITTED',
            manager_acknowledgement_required  TINYINT(1)    NOT NULL DEFAULT 1,
            acknowledged_by_user_id           CHAR(36)      NULL,
            acknowledged_at                   DATETIME(6)   NULL,
            acknowledgement_note              TEXT          NULL,
            exit_checklist_activated_at       DATETIME(6)   NULL,
            final_last_working_day            DATE          NULL,
            final_settlement_status           VARCHAR(10)   NOT NULL DEFAULT 'NOT_DUE',
            final_settlement_marked_at        DATETIME(6)   NULL,
            final_settlement_paid_at          DATETIME(6)   NULL,
            completed_at                      DATETIME(6)   NULL,
            open_guard                        CHAR(36)      GENERATED ALWAYS AS (IF(status IN ('SUBMITTED','MANAGER_ACKNOWLEDGED','HR_PROCESSING'), employee_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_resignations_one_open (open_guard),
            KEY ix_resignations_status (status),
            KEY ix_resignations_last_working_day (last_working_day),
            KEY ix_resignations_employee (employee_id, submitted_at),
            CONSTRAINT fk_res_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_res_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_res_submitted_by FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_res_acknowledged_by FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_res_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_res_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_res_status CHECK (status IN ('SUBMITTED','MANAGER_ACKNOWLEDGED','HR_PROCESSING','WITHDRAWN','COMPLETED')),
            CONSTRAINT ck_res_settlement CHECK (final_settlement_status IN ('NOT_DUE','DUE','PAID'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_resignations_fy_lock
        BEFORE INSERT ON resignations
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_resignations_set_on_notice
        AFTER INSERT ON resignations
        FOR EACH ROW
        BEGIN
            UPDATE employees SET employment_status = 'ON_NOTICE' WHERE id = NEW.employee_id AND employment_status = 'ACTIVE';
        END
    """)

    # ============================================================= offer_letters
    op.execute("""
        CREATE TABLE offer_letters (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                 CHAR(36)      NOT NULL,
            letter_number               VARCHAR(20)   NOT NULL,
            financial_year_id           CHAR(36)      NOT NULL,
            letter_type                 VARCHAR(30)   NOT NULL,
            resignation_id              CHAR(36)      NULL,
            designation_snapshot        VARCHAR(191)  NOT NULL,
            department_snapshot         VARCHAR(191)  NOT NULL,
            employment_type_snapshot    VARCHAR(191)  NOT NULL,
            joining_date_snapshot       DATE          NULL,
            last_working_day_snapshot   DATE          NULL,
            salary_structure_id         CHAR(36)      NULL,
            basic_salary_snapshot       DECIMAL(14,2) NULL,
            hra_snapshot                DECIMAL(14,2) NULL,
            gross_monthly_snapshot      DECIMAL(14,2) NULL,
            annual_ctc_snapshot         DECIMAL(14,2) NULL,
            status                      VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            generated_at                DATETIME(6)   NULL,
            generated_by                CHAR(36)      NULL,
            pdf_file_id                 CHAR(36)      NULL,
            sent_at                     DATETIME(6)   NULL,
            sent_by                     CHAR(36)      NULL,
            sent_to_email               VARCHAR(191)  NULL,
            email_send_log_id           CHAR(36)      NULL,
            acceptance_guard            CHAR(36)      GENERATED ALWAYS AS (IF(letter_type = 'RESIGNATION_ACCEPTANCE_LETTER', resignation_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_offer_letters_number (letter_number),
            UNIQUE KEY ux_offer_letters_one_acceptance (acceptance_guard),
            KEY ix_offer_letters_employee_type (employee_id, letter_type),
            KEY ix_offer_letters_status (status),
            CONSTRAINT fk_ol_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_resignation FOREIGN KEY (resignation_id) REFERENCES resignations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_salary_structure FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_generated_by FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_pdf_file FOREIGN KEY (pdf_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_sent_by FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_email_log FOREIGN KEY (email_send_log_id) REFERENCES email_send_log(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ol_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ol_type CHECK (letter_type IN ('OFFER_LETTER','APPOINTMENT_LETTER','RESIGNATION_ACCEPTANCE_LETTER')),
            CONSTRAINT ck_ol_resignation_pairing CHECK ((letter_type = 'RESIGNATION_ACCEPTANCE_LETTER') = (resignation_id IS NOT NULL)),
            CONSTRAINT ck_ol_lwd_required CHECK (letter_type <> 'RESIGNATION_ACCEPTANCE_LETTER' OR last_working_day_snapshot IS NOT NULL),
            CONSTRAINT ck_ol_status CHECK (status IN ('DRAFT','GENERATED','SENT'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_offer_letters_fy_lock
        BEFORE INSERT ON offer_letters
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE offer_letter_custom_terms (
            id                    CHAR(36)      NOT NULL PRIMARY KEY,
            offer_letter_id       CHAR(36)      NOT NULL,
            label                 VARCHAR(191)  NOT NULL,
            adjustment_type       VARCHAR(15)   NOT NULL,
            amount                DECIMAL(14,2) NOT NULL,
            is_recurring          TINYINT(1)    NOT NULL DEFAULT 0,
            is_taxable            TINYINT(1)    NOT NULL DEFAULT 1,
            effective_from        DATE          NOT NULL,
            -- No FK: payslip_adhoc_adjustments is a Payroll/Phase 3 table
            -- that does not exist yet. See the module docstring.
            queued_adjustment_id  CHAR(36)      NULL,
            queued_at             DATETIME(6)   NULL,
            display_order         SMALLINT      NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_olct_letter (offer_letter_id),
            KEY ix_olct_unqueued (offer_letter_id, queued_adjustment_id),
            CONSTRAINT fk_olct_letter FOREIGN KEY (offer_letter_id) REFERENCES offer_letters(id) ON DELETE CASCADE,
            CONSTRAINT fk_olct_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_olct_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_olct_label CHECK (TRIM(label) <> ''),
            CONSTRAINT ck_olct_type CHECK (adjustment_type IN ('ADDITION','SUBTRACTION')),
            CONSTRAINT ck_olct_amount CHECK (amount > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_olct_lock_after_generate
        BEFORE UPDATE ON offer_letter_custom_terms
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM offer_letters WHERE id = OLD.offer_letter_id) <> 'DRAFT' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This letter has already been generated — its custom terms are locked';
            END IF;
        END
    """)

    # ========================================================= exit checklist
    op.execute("""
        CREATE TABLE exit_checklist_steps (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            resignation_id              CHAR(36)      NOT NULL,
            employee_id                 CHAR(36)      NOT NULL,
            step_key                    VARCHAR(35)   NOT NULL,
            ordinal                     SMALLINT      NOT NULL,
            gated_by_step_id            CHAR(36)      NULL,
            status                      VARCHAR(15)   NOT NULL DEFAULT 'LOCKED',
            outstanding_asset_count     INT           NOT NULL DEFAULT 0,
            linked_offer_letter_id      CHAR(36)      NULL,
            completed_by                CHAR(36)      NULL,
            completed_at                DATETIME(6)   NULL,
            completion_note             TEXT          NULL,
            confirmation_acknowledged   TINYINT(1)    NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_ecs_key (resignation_id, step_key),
            UNIQUE KEY ux_ecs_ordinal (resignation_id, ordinal),
            KEY ix_ecs_gate (gated_by_step_id),
            KEY ix_ecs_open (resignation_id, ordinal),
            KEY ix_ecs_assets_outstanding (employee_id, outstanding_asset_count),
            CONSTRAINT fk_ecs_resignation FOREIGN KEY (resignation_id) REFERENCES resignations(id) ON DELETE CASCADE,
            CONSTRAINT fk_ecs_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ecs_gated_by FOREIGN KEY (gated_by_step_id) REFERENCES exit_checklist_steps(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ecs_offer_letter FOREIGN KEY (linked_offer_letter_id) REFERENCES offer_letters(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ecs_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ecs_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ecs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_ecs_step_key CHECK (step_key IN ('RESIGNATION_ACCEPTANCE_LETTER','RETURN_ALL_ASSETS','MARK_FINAL_SETTLEMENT_DUE','DISABLE_LOGIN','MARK_EXITED')),
            CONSTRAINT ck_ecs_ordinal CHECK (ordinal BETWEEN 1 AND 5),
            CONSTRAINT ck_ecs_gate_pairing CHECK ((gated_by_step_id IS NULL) = (ordinal = 1)),
            CONSTRAINT ck_ecs_status CHECK (status IN ('LOCKED','OPEN','DONE','NOT_APPLICABLE')),
            CONSTRAINT ck_ecs_outstanding CHECK (outstanding_asset_count >= 0),
            CONSTRAINT ck_ecs_completed_at CHECK ((completed_at IS NULL) = (status <> 'DONE'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    # THE GATE. Phase 2's acceptance criterion is "exit checklist gating
    # enforced in data" — this is that enforcement, not a derivation, so it
    # stays a real trigger rather than moving to the service layer.
    #
    # Cascade-unlock (opening every step gated by the one that just
    # completed) is deliberately NOT a trigger: MySQL forbids a trigger from
    # modifying other rows of the SAME table the triggering statement is
    # already modifying ("Can't update table ... it is already used by
    # statement which invoked this stored function/trigger") — the identical
    # restriction already worked around for company_addresses.is_primary and
    # bank_accounts.is_default in Phase 1. The API performs the cascade
    # (opening steps 3/4/5 together once step 2 reaches DONE) as a second
    # UPDATE in the same request/transaction, immediately after the gate
    # trigger above accepts the completing step's own UPDATE.
    op.execute("""
        CREATE TRIGGER trg_ecs_enforce_gate
        BEFORE UPDATE ON exit_checklist_steps
        FOR EACH ROW
        BEGIN
            DECLARE gate_status VARCHAR(15);
            IF NEW.status IN ('OPEN', 'DONE') AND NEW.status <> OLD.status THEN
                IF NEW.gated_by_step_id IS NOT NULL THEN
                    SELECT status INTO gate_status FROM exit_checklist_steps WHERE id = NEW.gated_by_step_id;
                    IF gate_status <> 'DONE' THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This step is locked until the step it depends on is Done';
                    END IF;
                END IF;
            END IF;
            IF NEW.status = 'DONE' AND OLD.status <> 'DONE' THEN
                IF NEW.step_key = 'RESIGNATION_ACCEPTANCE_LETTER' AND NEW.linked_offer_letter_id IS NULL THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The resignation acceptance letter must be generated before this step can be Done';
                END IF;
                IF NEW.step_key = 'RETURN_ALL_ASSETS' AND NEW.outstanding_asset_count > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every assigned asset must be Returned or Retired before this step can be Done';
                END IF;
            END IF;
            IF OLD.status = 'DONE' AND NEW.status <> 'DONE' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A completed exit checklist step cannot be moved backwards';
            END IF;
            -- Companion to ck_ecs_completed_at (missed on the first pass —
            -- onboarding_checklist_items has the equivalent trg_oci_stamp,
            -- this table needs the same auto-stamp, folded into this
            -- trigger since both already fire BEFORE UPDATE on this table).
            IF NEW.status = 'DONE' AND OLD.status <> 'DONE' THEN
                SET NEW.completed_at = CURRENT_TIMESTAMP(6);
            ELSEIF NEW.status <> 'DONE' THEN
                SET NEW.completed_at = NULL;
            END IF;
        END
    """)
    # Seeds the 5 steps with their ordinals and gate wiring already set —
    # step 2 is gated by step 1; steps 3, 4 and 5 are ALL gated by step 2,
    # not by each other (Masters spec: "everything after asset return may
    # proceed in any order, but none of it may start before the assets are
    # back"). Session variables capture the generated ids so later rows in
    # the same INSERT can reference step 1's and step 2's own id.
    op.execute("""
        CREATE TRIGGER trg_resignations_seed_exit_checklist
        AFTER INSERT ON resignations
        FOR EACH ROW
        BEGIN
            SET @ecs_step1 = UUID();
            SET @ecs_step2 = UUID();
            INSERT INTO exit_checklist_steps (id, resignation_id, employee_id, step_key, ordinal, gated_by_step_id, status)
            VALUES
                (@ecs_step1, NEW.id, NEW.employee_id, 'RESIGNATION_ACCEPTANCE_LETTER', 1, NULL, 'LOCKED'),
                (@ecs_step2, NEW.id, NEW.employee_id, 'RETURN_ALL_ASSETS', 2, @ecs_step1, 'LOCKED'),
                (UUID(), NEW.id, NEW.employee_id, 'MARK_FINAL_SETTLEMENT_DUE', 3, @ecs_step2, 'LOCKED'),
                (UUID(), NEW.id, NEW.employee_id, 'DISABLE_LOGIN', 4, @ecs_step2, 'LOCKED'),
                (UUID(), NEW.id, NEW.employee_id, 'MARK_EXITED', 5, @ecs_step2, 'LOCKED');
        END
    """)
    # If Manager acknowledgment is not required, step 1 opens immediately;
    # otherwise it opens only once the resignation reaches
    # 'manager_acknowledged' — modelled at the service layer alongside the
    # other cross-row status transitions in this migration (see the
    # docstring's DB/service split), since "immediately when X is false"
    # needs to run in the SAME transaction as the INSERT above, which a
    # second AFTER INSERT trigger on the same table can do, but the
    # acknowledgment-driven path (AFTER UPDATE OF status) more naturally
    # belongs with the API endpoint that performs that update.
    op.execute("""
        CREATE TRIGGER trg_resignations_activate_if_no_ack_required
        AFTER INSERT ON resignations
        FOR EACH ROW
        BEGIN
            IF NEW.manager_acknowledgement_required = 0 THEN
                UPDATE exit_checklist_steps SET status = 'OPEN' WHERE resignation_id = NEW.id AND step_key = 'RESIGNATION_ACCEPTANCE_LETTER';
            END IF;
        END
    """)

    # employees.employment_status -> EXITED is gated by exit_checklist_steps'
    # mark_exited step — added now that this table exists.
    op.execute("""
        CREATE TRIGGER trg_employees_guard_exit_transition
        BEFORE UPDATE ON employees
        FOR EACH ROW
        BEGIN
            DECLARE step_status VARCHAR(15);
            IF NEW.employment_status = 'EXITED' AND OLD.employment_status <> 'EXITED' THEN
                SELECT ecs.status INTO step_status
                FROM exit_checklist_steps ecs
                JOIN resignations r ON r.id = ecs.resignation_id
                WHERE ecs.employee_id = NEW.id AND ecs.step_key = 'MARK_EXITED'
                  AND r.status NOT IN ('WITHDRAWN','COMPLETED')
                ORDER BY r.submitted_at DESC LIMIT 1;
                IF step_status IS NULL OR step_status <> 'OPEN' THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Employment status cannot move to Exited until the exit checklist''s Mark Exited step is open';
                END IF;
            END IF;
        END
    """)

    # ======================================================== onboarding checklist
    op.execute("""
        CREATE TABLE onboarding_checklist_items (
            id              CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id     CHAR(36)      NOT NULL,
            step_key        VARCHAR(30)   NOT NULL,
            ordinal         SMALLINT      NOT NULL,
            status          VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            is_auto_checked TINYINT(1)    NOT NULL DEFAULT 1,
            completed_at    DATETIME(6)   NULL,
            completed_by    CHAR(36)      NULL,
            skipped_reason  TEXT          NULL,
            note            TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_oci (employee_id, step_key),
            KEY ix_oci_incomplete (employee_id, ordinal),
            KEY ix_oci_step_status (step_key, status),
            CONSTRAINT fk_oci_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            CONSTRAINT fk_oci_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oci_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oci_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_oci_step_key CHECK (step_key IN ('CREATE_EMPLOYEE_RECORD','CREATE_LOGIN','ASSIGN_REPORTING_MANAGER','SETUP_LEAVE_BALANCE','LINK_SALARY_STRUCTURE','ASSIGN_STARTER_ASSETS','SEND_WELCOME_EMAIL')),
            CONSTRAINT ck_oci_ordinal CHECK (ordinal BETWEEN 1 AND 7),
            CONSTRAINT ck_oci_status CHECK (status IN ('PENDING','COMPLETE','SKIPPED')),
            CONSTRAINT ck_oci_completed_at CHECK ((completed_at IS NULL) = (status = 'PENDING')),
            CONSTRAINT ck_oci_skipped_reason CHECK (status <> 'SKIPPED' OR TRIM(COALESCE(skipped_reason,'')) <> '')
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_employees_seed_onboarding_checklist
        AFTER INSERT ON employees
        FOR EACH ROW
        BEGIN
            INSERT INTO onboarding_checklist_items (id, employee_id, step_key, ordinal, status, is_auto_checked, completed_at, completed_by)
            VALUES
                (UUID(), NEW.id, 'CREATE_EMPLOYEE_RECORD', 1, 'COMPLETE', 1, CURRENT_TIMESTAMP(6), NEW.created_by),
                (UUID(), NEW.id, 'CREATE_LOGIN', 2, 'PENDING', 1, NULL, NULL),
                (UUID(), NEW.id, 'ASSIGN_REPORTING_MANAGER', 3, IF(NEW.reporting_manager_id IS NOT NULL, 'COMPLETE', 'PENDING'), 1, IF(NEW.reporting_manager_id IS NOT NULL, CURRENT_TIMESTAMP(6), NULL), NULL),
                (UUID(), NEW.id, 'SETUP_LEAVE_BALANCE', 4, 'PENDING', 1, NULL, NULL),
                (UUID(), NEW.id, 'LINK_SALARY_STRUCTURE', 5, 'PENDING', 1, NULL, NULL),
                (UUID(), NEW.id, 'ASSIGN_STARTER_ASSETS', 6, 'PENDING', 1, NULL, NULL),
                (UUID(), NEW.id, 'SEND_WELCOME_EMAIL', 7, 'PENDING', 0, NULL, NULL);
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_oci_stamp
        BEFORE UPDATE ON onboarding_checklist_items
        FOR EACH ROW
        BEGIN
            IF NEW.status <> 'PENDING' AND OLD.status = 'PENDING' THEN
                SET NEW.completed_at = CURRENT_TIMESTAMP(6);
            ELSEIF NEW.status = 'PENDING' THEN
                SET NEW.completed_at = NULL;
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_employees_autocheck_manager
        AFTER UPDATE ON employees
        FOR EACH ROW
        BEGIN
            IF NEW.reporting_manager_id IS NOT NULL AND (OLD.reporting_manager_id IS NULL OR OLD.reporting_manager_id <> NEW.reporting_manager_id) THEN
                UPDATE onboarding_checklist_items SET status = 'COMPLETE'
                WHERE employee_id = NEW.id AND step_key = 'ASSIGN_REPORTING_MANAGER' AND status = 'PENDING';
            END IF;
            IF NEW.user_id IS NOT NULL AND OLD.user_id IS NULL THEN
                UPDATE onboarding_checklist_items SET status = 'COMPLETE'
                WHERE employee_id = NEW.id AND step_key = 'CREATE_LOGIN' AND status = 'PENDING';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_oci_rollup
        AFTER UPDATE ON onboarding_checklist_items
        FOR EACH ROW
        BEGIN
            IF NEW.status <> 'PENDING' AND (
                SELECT COUNT(*) FROM onboarding_checklist_items WHERE employee_id = NEW.employee_id AND status = 'PENDING'
            ) = 0 THEN
                UPDATE employees SET onboarding_completed_at = CURRENT_TIMESTAMP(6) WHERE id = NEW.employee_id AND onboarding_completed_at IS NULL;
            END IF;
        END
    """)

    # =================================================== tax scheme elections
    op.execute("""
        CREATE TABLE employee_tax_scheme_elections (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id               CHAR(36)      NOT NULL,
            financial_year_id         CHAR(36)      NOT NULL,
            tax_scheme_id             CHAR(36)      NOT NULL,
            scheme_name_snapshot      VARCHAR(191)  NOT NULL,
            choice_window_snapshot    VARCHAR(20)   NOT NULL,
            was_default               TINYINT(1)    NOT NULL DEFAULT 0,
            elected_at                DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            elected_by_user_id        CHAR(36)      NOT NULL,
            superseded_at             DATETIME(6)   NULL,
            superseded_by_election_id CHAR(36)      NULL,
            current_guard             CHAR(80)      GENERATED ALWAYS AS (IF(superseded_at IS NULL, CONCAT(employee_id, ':', financial_year_id), NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_etse_current (current_guard),
            KEY ix_etse_scheme (tax_scheme_id),
            KEY ix_etse_employee (employee_id, financial_year_id),
            CONSTRAINT fk_etse_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_scheme FOREIGN KEY (tax_scheme_id) REFERENCES tax_schemes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_elected_by FOREIGN KEY (elected_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_superseded_by FOREIGN KEY (superseded_by_election_id) REFERENCES employee_tax_scheme_elections(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_etse_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_etse_window CHECK (choice_window_snapshot IN ('ONCE_PER_FY','ANY_TIME','FIXED_AT_JOINING'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_etse_fy_lock
        BEFORE INSERT ON employee_tax_scheme_elections
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    # Superseding the prior election (closing it out) and enforcing the
    # snapshotted choice window are service-layer, for the same "can't
    # modify another row of the same table from a trigger" reason as
    # salary_structures' close-previous step above.

    # ============================================================ tax declarations
    op.execute("""
        CREATE TABLE tax_declarations (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id               CHAR(36)      NOT NULL,
            financial_year_id         CHAR(36)      NOT NULL,
            tax_scheme_election_id    CHAR(36)      NULL,
            status                    VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            submitted_at              DATETIME(6)   NULL,
            submitted_by_user_id      CHAR(36)      NULL,
            verified_by               CHAR(36)      NULL,
            verified_at               DATETIME(6)   NULL,
            verification_note         TEXT          NULL,
            total_declared_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_eligible_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
            has_flagged_lines         TINYINT(1)    NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_tax_declarations (employee_id, financial_year_id),
            KEY ix_tax_declarations_status (financial_year_id, status),
            KEY ix_tax_declarations_flagged (financial_year_id, has_flagged_lines),
            CONSTRAINT fk_td_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_election FOREIGN KEY (tax_scheme_election_id) REFERENCES employee_tax_scheme_elections(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_submitted_by FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_td_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_td_status CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED')),
            CONSTRAINT ck_td_submitted_at CHECK ((submitted_at IS NULL) = (status = 'DRAFT'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_td_fy_lock
        BEFORE INSERT ON tax_declarations
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_td_submit_lock
        BEFORE UPDATE ON tax_declarations
        FOR EACH ROW
        BEGIN
            IF OLD.status <> 'DRAFT' AND NEW.tax_scheme_election_id <=> OLD.tax_scheme_election_id = 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tax Scheme cannot change once the declaration has left Draft';
            END IF;
            IF OLD.status <> 'DRAFT' AND NEW.status = 'DRAFT' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A declaration cannot return to Draft once submitted';
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE tax_declaration_lines (
            id                                  CHAR(36)      NOT NULL PRIMARY KEY,
            tax_declaration_id                  CHAR(36)      NOT NULL,
            tax_head_id                         CHAR(36)      NULL,
            is_other_catch_all                  TINYINT(1)    NOT NULL DEFAULT 0,
            declaration_name_snapshot           VARCHAR(191)  NOT NULL,
            guidance_snapshot                   TEXT          NULL,
            declaration_cap_snapshot            DECIMAL(14,2) NULL,
            requires_proof_snapshot             TINYINT(1)    NOT NULL DEFAULT 0,
            reduces_taxable_income_snapshot     TINYINT(1)    NOT NULL DEFAULT 0,
            amount_declared                     DECIMAL(14,2) NOT NULL DEFAULT 0,
            other_description                   TEXT          NULL,
            amount_accepted_for_calculation     DECIMAL(14,2) NOT NULL DEFAULT 0,
            flagged_for_review                  TINYINT(1)    NOT NULL DEFAULT 0,
            verification_status                 VARCHAR(20)   NOT NULL DEFAULT 'NOT_REVIEWED',
            verification_note                   TEXT          NULL,
            display_order                       SMALLINT      NOT NULL DEFAULT 0,
            catch_all_guard                     CHAR(36)      GENERATED ALWAYS AS (IF(is_other_catch_all = 1, tax_declaration_id, NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_tdl_one_catch_all (catch_all_guard),
            KEY ix_tdl_declaration (tax_declaration_id),
            KEY ix_tdl_head (tax_head_id),
            -- RESTRICT: catch_all_guard depends on this column (MySQL 1215).
            CONSTRAINT fk_tdl_declaration FOREIGN KEY (tax_declaration_id) REFERENCES tax_declarations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdl_tax_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdl_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdl_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_tdl_head_pairing CHECK ((is_other_catch_all = 1) = (tax_head_id IS NULL)),
            CONSTRAINT ck_tdl_amount CHECK (amount_declared >= 0),
            CONSTRAINT ck_tdl_cap CHECK (declaration_cap_snapshot IS NULL OR amount_declared <= declaration_cap_snapshot),
            CONSTRAINT ck_tdl_other_desc CHECK (is_other_catch_all = 0 OR TRIM(COALESCE(other_description,'')) <> ''),
            CONSTRAINT ck_tdl_accepted CHECK (amount_accepted_for_calculation >= 0),
            CONSTRAINT ck_tdl_verification CHECK (verification_status IN ('NOT_REVIEWED','PROOF_MATCHES','PROOF_MISSING','REJECTED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_tdl_locked_after_submit
        BEFORE UPDATE ON tax_declaration_lines
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM tax_declarations WHERE id = OLD.tax_declaration_id) <> 'DRAFT' THEN
                IF NOT (
                    NEW.amount_declared <=> OLD.amount_declared
                    AND NEW.other_description <=> OLD.other_description
                ) THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This declaration has been submitted — only verification fields may still change';
                END IF;
            END IF;
        END
    """)

    op.execute("""
        CREATE TABLE tax_declaration_line_proofs (
            id                        CHAR(36)      NOT NULL PRIMARY KEY,
            tax_declaration_line_id   CHAR(36)      NOT NULL,
            file_id                   CHAR(36)      NOT NULL,
            uploaded_at               DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            uploaded_by_user_id       CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_tdlp_line (tax_declaration_line_id),
            CONSTRAINT fk_tdlp_line FOREIGN KEY (tax_declaration_line_id) REFERENCES tax_declaration_lines(id) ON DELETE CASCADE,
            CONSTRAINT fk_tdlp_file FOREIGN KEY (file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdlp_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdlp_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tdlp_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_tdlp_locked_after_submit
        BEFORE INSERT ON tax_declaration_line_proofs
        FOR EACH ROW
        BEGIN
            IF (SELECT td.status FROM tax_declaration_lines tdl JOIN tax_declarations td ON td.id = tdl.tax_declaration_id WHERE tdl.id = NEW.tax_declaration_line_id) NOT IN ('DRAFT') THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This declaration has already been submitted';
            END IF;
        END
    """)


def downgrade() -> None:
    for table in [
        "tax_declaration_line_proofs",
        "tax_declaration_lines",
        "tax_declarations",
        "employee_tax_scheme_elections",
        "onboarding_checklist_items",
        "exit_checklist_steps",
        "offer_letter_custom_terms",
        "offer_letters",
        "resignations",
        "notifications",
        "announcement_targets",
        "announcements",
        "leave_balance_adjustments",
        "leave_carry_forward_lines",
        "leave_carry_forward_runs",
        "leave_balances",
        "compensatory_hour_requests",
        "attendance_records",
        "leave_requests",
        "profile_change_requests",
        "employee_documents",
        "insurance_nominees",
        "insurance_dependents",
        "employee_insurance_enrollments",
        "salary_structure_statutory_lines",
        "salary_structures",
        "employee_emergency_contacts",
        "employee_statutory_identifiers",
        "employees",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table};")
    op.execute("ALTER TABLE number_prefix_rules DROP CHECK ck_prefix_rules_type;")
    op.execute("""
        ALTER TABLE number_prefix_rules ADD CONSTRAINT ck_prefix_rules_type
        CHECK (code_type IN ('INV','PB','CUST','AST','TKT','EMP','PRJ','OPP','CN','EXP','CMP','TSK','BUG','QUO'));
    """)
