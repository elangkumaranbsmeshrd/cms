"""Phase 3 — Payroll (06-payroll-module.md). 11 tables, hour-basis engine.

Same MySQL dialect discipline as 0001-0003 (VARCHAR+CHECK instead of native
ENUM, generated-column singleton/guard tricks for partial uniques, RESTRICT
instead of CASCADE on any FK a same-table generated column depends on).

ARCHITECTURAL DEVIATION FROM ARCH-1, DOCUMENTED HERE ONCE per the same
"genuinely complex multi-table DERIVATION belongs in an isolated Python
service, a simple UNIVERSAL invariant stays a trigger" split established in
0002/0003: ARCH-1 has ~10 rollup triggers maintaining a parent row's totals
from its child rows (payroll_runs' 4 money totals from payroll_run_employees;
payroll_run_employees' totals from the three payslip_*_lines tables;
payslips' totals mirroring payroll_run_employees; adhoc_payslip_adjustments'
target/applied counts from adhoc_adjustment_employees; and that table's own
times_applied/total_applied_amount from payslip_adjustment_lines). None of
those are moved here — the API computes gross/net/every subtotal via
app/services/payroll_engine.py (extending attendance_engine.py's day-level
work and reusing leave_engine.calculate_working_days and
tax_engine.calculate_tax unchanged) and writes the final figures directly,
the same "service computes and writes, DB triggers only backstop the simple
universal invariants" pattern already used for Salary Structure (0003) and
Taxes (0002). What DOES stay a real trigger: the A116 double-processing
guard (a generated-column UNIQUE, this phase's literal acceptance gate),
FY-lock on every table, the Tier-2 immutability rules (payslips never
deleted, payslip_reissues append-only, a Processed run never reverts to
Draft, an ad-hoc adjustment's label/type/amount freeze once applied).

Cross-phase notes:
  - `offer_letter_custom_terms.queued_adjustment_id` (0003) had NO FK,
    targeting this phase's adhoc_payslip_adjustments, which didn't exist
    yet. The FK is added here via ALTER, closing that deferral (A134a).
  - Company Profile gains `payroll_basis` (A121: "needs a home, most likely
    Company Profile... do not hardcode the basis inside the Payroll
    module") via ALTER — Masters (0002) never had a reason to add it until
    a real consumer (this phase) existed.
  - `monthly_hour_reconciliations` and `payroll_run_employees` reference
    each other (the reconciliation is consumed by a run-employee row; the
    run-employee row is what a reconciliation is `consumed_by`) — created
    in dependency order with the circular FK added via a trailing ALTER,
    the same technique already used for 0003's forward references.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-01
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ============================================== monthly_hour_reconciliations
    # Created FIRST (before payroll_run_employees, which references it) —
    # its own consumed_by_payroll_run_employee_id FK is added via ALTER
    # at the end, once payroll_run_employees exists (circular reference).
    op.execute("""
        CREATE TABLE monthly_hour_reconciliations (
            id                                   CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                          CHAR(36)      NOT NULL,
            financial_year_id                    CHAR(36)      NOT NULL,
            period_month                         SMALLINT      NOT NULL,
            period_year                          SMALLINT      NOT NULL,
            pay_period_start                     DATE          NOT NULL,
            pay_period_end                       DATE          NOT NULL,
            work_week_policy_id                  CHAR(36)      NOT NULL,
            policy_name_snapshot                 VARCHAR(191)  NOT NULL,
            gross_hours_per_day_snapshot         DECIMAL(6,2)  NOT NULL,
            unpaid_break_hours_snapshot          DECIMAL(6,2)  NOT NULL,
            net_hours_per_day_snapshot           DECIMAL(6,2)  NOT NULL,
            grace_window_minutes_snapshot        INT           NOT NULL DEFAULT 0,
            half_day_threshold_hours_snapshot    DECIMAL(6,2)  NULL,
            saturday_rule_snapshot               VARCHAR(20)   NOT NULL,
            weekday_count                        SMALLINT      NOT NULL DEFAULT 0,
            working_saturdays_count              SMALLINT      NOT NULL DEFAULT 0,
            mandatory_holidays_count             SMALLINT      NOT NULL DEFAULT 0,
            working_days                         DECIMAL(5,2)  NOT NULL,
            required_hours                       DECIMAL(6,2)  GENERATED ALWAYS AS (working_days * net_hours_per_day_snapshot) STORED,
            worked_hours                         DECIMAL(6,2)  NOT NULL DEFAULT 0,
            comp_credit_hours                    DECIMAL(6,2)  NOT NULL DEFAULT 0,
            leave_credit_hours                   DECIMAL(6,2)  NOT NULL DEFAULT 0,
            credited_hours                       DECIMAL(6,2)  GENERATED ALWAYS AS (worked_hours + leave_credit_hours) STORED,
            balance_hours                        DECIMAL(6,2)  GENERATED ALWAYS AS (worked_hours + leave_credit_hours - (working_days * net_hours_per_day_snapshot)) STORED,
            hours_short                          DECIMAL(6,2)  GENERATED ALWAYS AS (CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END) STORED,
            comp_pending_hours                   DECIMAL(6,2)  NOT NULL DEFAULT 0,
            comp_approved_hours                  DECIMAL(6,2)  NOT NULL DEFAULT 0,
            comp_rejected_hours                  DECIMAL(6,2)  NOT NULL DEFAULT 0,
            net_short_hours                      DECIMAL(6,2)  GENERATED ALWAYS AS (CASE WHEN (CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END) - comp_pending_hours > 0 THEN (CASE WHEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) > 0 THEN (working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours) ELSE 0 END) - comp_pending_hours ELSE 0 END) STORED,
            payable_days                         DECIMAL(5,2)  NOT NULL DEFAULT 0,
            lop_days                             DECIMAL(5,2)  NOT NULL DEFAULT 0,
            lop_days_net_of_pending              DECIMAL(5,2)  NOT NULL DEFAULT 0,
            estimated_deduction                  DECIMAL(14,2) NOT NULL DEFAULT 0,
            uncompensated_shortfall_rule_snapshot VARCHAR(20)  NOT NULL,
            excess_hours_rule_snapshot           VARCHAR(20)   NULL,
            status                               VARCHAR(30)   NOT NULL DEFAULT 'MET',
            next_step_note                       TEXT          NULL,
            recorded_by_source                   VARCHAR(20)   NOT NULL DEFAULT 'MANUAL_ENTRY',
            recorded_by_user_id                  CHAR(36)      NULL,
            consumed_by_payroll_run_employee_id  CHAR(36)      NULL,
            is_locked                            TINYINT(1)    NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_hourrecon_employee_period (employee_id, period_year, period_month),
            KEY ix_hourrecon_period_status (period_year, period_month, status),
            KEY ix_hourrecon_policy (work_week_policy_id),
            KEY ix_hourrecon_window (pay_period_start, pay_period_end),
            CONSTRAINT fk_hourrecon_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hourrecon_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hourrecon_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hourrecon_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hourrecon_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_hourrecon_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_hourrecon_month CHECK (period_month BETWEEN 1 AND 12),
            CONSTRAINT ck_hourrecon_dates CHECK (pay_period_end > pay_period_start),
            CONSTRAINT ck_hourrecon_net_hours CHECK (net_hours_per_day_snapshot > 0),
            CONSTRAINT ck_hourrecon_working_days CHECK (working_days * 2 = FLOOR(working_days * 2)),
            CONSTRAINT ck_hourrecon_comp_credit CHECK (comp_credit_hours <= worked_hours),
            CONSTRAINT ck_hourrecon_payable_days CHECK (payable_days * 2 = FLOOR(payable_days * 2)),
            CONSTRAINT ck_hourrecon_lop_days CHECK (lop_days * 2 = FLOOR(lop_days * 2)),
            CONSTRAINT ck_hourrecon_lop_net CHECK (lop_days_net_of_pending * 2 = FLOOR(lop_days_net_of_pending * 2)),
            CONSTRAINT ck_hourrecon_saturday_rule CHECK (saturday_rule_snapshot IN ('ODD_WORKING','EVEN_WORKING','ALL_WORKING','ALL_OFF','FIRST_ONLY','LAST_ONLY','CUSTOM')),
            CONSTRAINT ck_hourrecon_shortfall_rule CHECK (uncompensated_shortfall_rule_snapshot IN ('PRO_RATA_LOP','ROUND_HALF_DAY','ROUND_FULL_DAY','LEAVE_THEN_LOP','IGNORE')),
            CONSTRAINT ck_hourrecon_excess_rule CHECK (excess_hours_rule_snapshot IS NULL OR excess_hours_rule_snapshot IN ('COMP_CREDIT','COMP_OFF_LEAVE','PAID_OVERTIME','NOT_TRACKED')),
            CONSTRAINT ck_hourrecon_status CHECK (status IN ('MET','SHORT_COMPENSABLE','SHORT_PAYROLL_IMPACT')),
            CONSTRAINT ck_hourrecon_source CHECK (recorded_by_source IN ('MANUAL_ENTRY','BIOMETRIC_DEVICE','EXTERNAL_HR_SYSTEM','MOBILE_CHECKIN'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_hourrecon_fy_lock
        BEFORE INSERT ON monthly_hour_reconciliations
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_hourrecon_no_edit_when_locked
        BEFORE UPDATE ON monthly_hour_reconciliations
        FOR EACH ROW
        BEGIN
            IF OLD.is_locked = 1 AND NEW.is_locked = 1 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This period has been Processed and is locked — corrections go through Reissue';
            END IF;
        END
    """)

    # ======================================================== payroll_runs
    op.execute("""
        CREATE TABLE payroll_runs (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            financial_year_id               CHAR(36)      NOT NULL,
            period_month                    SMALLINT      NOT NULL,
            period_year                     SMALLINT      NOT NULL,
            pay_period_start                DATE          NOT NULL,
            pay_period_end                  DATE          NOT NULL,
            salary_credit_date              DATE          NOT NULL,
            pay_cycle_type_snapshot         VARCHAR(20)   NOT NULL,
            pay_cycle_start_day_snapshot    SMALLINT      NULL,
            pay_cycle_end_day_snapshot      SMALLINT      NULL,
            salary_credit_day_snapshot      SMALLINT      NOT NULL,
            total_days_in_period            DECIMAL(5,2)  NOT NULL,
            working_days_auto               DECIMAL(5,2)  NOT NULL,
            working_days_override            DECIMAL(5,2)  NULL,
            working_days_effective          DECIMAL(5,2)  GENERATED ALWAYS AS (COALESCE(working_days_override, working_days_auto)) STORED,
            employee_selection_mode         VARCHAR(20)   NOT NULL,
            status                          VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            employee_count                  INT           NOT NULL DEFAULT 0,
            total_gross                     DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employee_deductions       DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employer_contributions    DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_net                       DECIMAL(14,2) NOT NULL DEFAULT 0,
            work_week_policy_note           TEXT          NULL,
            run_by                          CHAR(36)      NOT NULL,
            run_on                          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            processed_by                    CHAR(36)      NULL,
            processed_at                    DATETIME(6)   NULL,
            discarded_at                    DATETIME(6)   NULL,
            notes                           TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_payroll_runs_period (period_year, period_month),
            KEY ix_payroll_runs_fy_status (financial_year_id, status),
            KEY ix_payroll_runs_run_by (run_by, run_on),
            KEY ix_payroll_runs_window (pay_period_start, pay_period_end),
            CONSTRAINT fk_prun_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prun_run_by FOREIGN KEY (run_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prun_processed_by FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prun_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prun_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_prun_month CHECK (period_month BETWEEN 1 AND 12),
            CONSTRAINT ck_prun_year CHECK (period_year BETWEEN 2000 AND 2200),
            CONSTRAINT ck_prun_dates CHECK (pay_period_end > pay_period_start),
            CONSTRAINT ck_prun_credit CHECK (salary_credit_date > pay_period_end),
            CONSTRAINT ck_prun_cycle_type CHECK (pay_cycle_type_snapshot IN ('FIXED_CYCLE','CALENDAR_MONTH')),
            CONSTRAINT ck_prun_total_days CHECK (total_days_in_period * 2 = FLOOR(total_days_in_period * 2)),
            CONSTRAINT ck_prun_wd_auto CHECK (working_days_auto * 2 = FLOOR(working_days_auto * 2)),
            CONSTRAINT ck_prun_wd_override CHECK (working_days_override IS NULL OR working_days_override * 2 = FLOOR(working_days_override * 2)),
            CONSTRAINT ck_prun_selection CHECK (employee_selection_mode IN ('ALL_ACTIVE','SPECIFIC_EMPLOYEES')),
            CONSTRAINT ck_prun_status CHECK (status IN ('DRAFT','PROCESSED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_prun_fy_lock
        BEFORE INSERT ON payroll_runs
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    # A002-style one-way lock: Processed never reverts to Draft. Every other
    # field the API writes (the four rollups, employee_count) is legitimately
    # still app-computed post-Processed only by the SAME confirm action that
    # sets status, never by a later independent edit — no route exists for
    # that, so no further column-level guard is needed here.
    op.execute("""
        CREATE TRIGGER trg_prun_no_unprocess
        BEFORE UPDATE ON payroll_runs
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'PROCESSED' AND NEW.status <> 'PROCESSED' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A Processed payroll run cannot revert to Draft';
            END IF;
        END
    """)

    # =============================================== payroll_run_employees
    op.execute("""
        CREATE TABLE payroll_run_employees (
            id                                     CHAR(36)      NOT NULL PRIMARY KEY,
            payroll_run_id                         CHAR(36)      NOT NULL,
            employee_id                            CHAR(36)      NOT NULL,
            financial_year_id                      CHAR(36)      NOT NULL,
            period_month                           SMALLINT      NOT NULL,
            period_year                            SMALLINT      NOT NULL,
            status                                 VARCHAR(10)   NOT NULL DEFAULT 'DRAFT',
            inclusion_status                       VARCHAR(35)   NOT NULL DEFAULT 'INCLUDED',
            skip_reason                            TEXT          NULL,
            salary_structure_id                    CHAR(36)      NULL,
            work_week_policy_id                    CHAR(36)      NULL,
            monthly_hour_reconciliation_id         CHAR(36)      NULL,
            tax_scheme_id                          CHAR(36)      NULL,
            gross_monthly_snapshot                 DECIMAL(14,2) NOT NULL DEFAULT 0,
            gross_pay                              DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_days_in_period                   DECIMAL(5,2)  NOT NULL,
            working_days                           DECIMAL(5,2)  NOT NULL,
            present_days                           DECIMAL(5,2)  NOT NULL DEFAULT 0,
            paid_leave_days                        DECIMAL(5,2)  NOT NULL DEFAULT 0,
            unpaid_leave_days                      DECIMAL(5,2)  NOT NULL DEFAULT 0,
            paid_days                              DECIMAL(5,2)  GENERATED ALWAYS AS (present_days + paid_leave_days) STORED,
            lop_days                               DECIMAL(5,2)  NOT NULL DEFAULT 0,
            required_hours                         DECIMAL(6,2)  NOT NULL DEFAULT 0,
            worked_hours                           DECIMAL(6,2)  NOT NULL DEFAULT 0,
            comp_credit_hours                      DECIMAL(6,2)  NOT NULL DEFAULT 0,
            leave_credit_hours                     DECIMAL(6,2)  NOT NULL DEFAULT 0,
            credited_hours                         DECIMAL(6,2)  GENERATED ALWAYS AS (worked_hours + leave_credit_hours) STORED,
            balance_hours                          DECIMAL(6,2)  GENERATED ALWAYS AS (worked_hours + leave_credit_hours - required_hours) STORED,
            comp_pending_hours                     DECIMAL(6,2)  NOT NULL DEFAULT 0,
            net_short_hours                        DECIMAL(6,2)  NOT NULL DEFAULT 0,
            unpaid_leave_deduction                 DECIMAL(14,2) NOT NULL DEFAULT 0,
            lop_deduction                          DECIMAL(14,2) NOT NULL DEFAULT 0,
            uncompensated_shortfall_rule_snapshot  VARCHAR(20)   NULL,
            total_earnings                         DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employee_statutory               DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_employer_statutory               DECIMAL(14,2) NOT NULL DEFAULT 0,
            income_tax_amount                      DECIMAL(14,2) NOT NULL DEFAULT 0,
            insurance_employee_contribution        DECIMAL(14,2) NOT NULL DEFAULT 0,
            insurance_employer_contribution        DECIMAL(14,2) NOT NULL DEFAULT 0,
            adhoc_addition_total                   DECIMAL(14,2) NOT NULL DEFAULT 0,
            adhoc_subtraction_total                DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_deductions                       DECIMAL(14,2) GENERATED ALWAYS AS (total_employee_statutory + income_tax_amount + insurance_employee_contribution + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total) STORED,
            -- total_earnings already has adhoc_addition_total folded in (see
            -- _calculate_employee: row.total_earnings += adhoc_addition_total)
            -- — do not add it again here, or every ad-hoc ADDITION overpays
            -- by its own amount. Found live: a 5000 Festival Bonus made
            -- net_pay 12800 instead of 7800.
            net_pay                                DECIMAL(14,2) GENERATED ALWAYS AS (total_earnings - (total_employee_statutory + income_tax_amount + insurance_employee_contribution + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total)) STORED,
            annualised_taxable_income              DECIMAL(14,2) NULL,
            annual_tax_computed                    DECIMAL(14,2) NULL,
            annual_relief_applied                  DECIMAL(14,2) NULL,
            remaining_payroll_months               SMALLINT      NULL,
            calculated_at                          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            recalculated_count                     INT           NOT NULL DEFAULT 0,
            processed_period_guard                 VARCHAR(80)   GENERATED ALWAYS AS (IF(status = 'PROCESSED', CONCAT(employee_id, ':', period_year, ':', period_month), NULL)) STORED,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            -- A116, THE PHASE 3 ACCEPTANCE GATE: at most one PROCESSED row
            -- per employee+month, enforced in data, not just in the API.
            UNIQUE KEY ux_prempl_one_processed_per_employee_period (processed_period_guard),
            UNIQUE KEY ux_prempl_run_employee (payroll_run_id, employee_id),
            KEY ix_prempl_employee_period (employee_id, period_year, period_month),
            KEY ix_prempl_run_status (payroll_run_id, inclusion_status),
            KEY ix_prempl_recon (monthly_hour_reconciliation_id),
            CONSTRAINT fk_prempl_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
            CONSTRAINT fk_prempl_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_structure FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_policy FOREIGN KEY (work_week_policy_id) REFERENCES work_week_policies(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_recon FOREIGN KEY (monthly_hour_reconciliation_id) REFERENCES monthly_hour_reconciliations(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_scheme FOREIGN KEY (tax_scheme_id) REFERENCES tax_schemes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_prempl_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_prempl_month CHECK (period_month BETWEEN 1 AND 12),
            CONSTRAINT ck_prempl_status CHECK (status IN ('DRAFT','PROCESSED')),
            CONSTRAINT ck_prempl_inclusion CHECK (inclusion_status IN ('INCLUDED','SKIPPED_ALREADY_PROCESSED','EXCLUDED_NOT_ACTIVE','EXCLUDED_NO_SALARY_STRUCTURE')),
            CONSTRAINT ck_prempl_total_days CHECK (total_days_in_period * 2 = FLOOR(total_days_in_period * 2)),
            CONSTRAINT ck_prempl_working_days CHECK (working_days * 2 = FLOOR(working_days * 2)),
            CONSTRAINT ck_prempl_present CHECK (present_days * 2 = FLOOR(present_days * 2)),
            CONSTRAINT ck_prempl_paid_leave CHECK (paid_leave_days * 2 = FLOOR(paid_leave_days * 2)),
            CONSTRAINT ck_prempl_unpaid_leave CHECK (unpaid_leave_days * 2 = FLOOR(unpaid_leave_days * 2)),
            CONSTRAINT ck_prempl_lop CHECK (lop_days * 2 = FLOOR(lop_days * 2)),
            CONSTRAINT ck_prempl_shortfall_rule CHECK (uncompensated_shortfall_rule_snapshot IS NULL OR uncompensated_shortfall_rule_snapshot IN ('PRO_RATA_LOP','ROUND_HALF_DAY','ROUND_FULL_DAY','LEAVE_THEN_LOP','IGNORE')),
            CONSTRAINT ck_prempl_remaining_months CHECK (remaining_payroll_months IS NULL OR remaining_payroll_months BETWEEN 0 AND 12)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_prempl_fy_lock
        BEFORE INSERT ON payroll_run_employees
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    # Circular FK #1: monthly_hour_reconciliations.consumed_by_payroll_run_employee_id -> payroll_run_employees(id)
    op.execute("""
        ALTER TABLE monthly_hour_reconciliations
        ADD CONSTRAINT fk_hourrecon_consumed FOREIGN KEY (consumed_by_payroll_run_employee_id) REFERENCES payroll_run_employees(id) ON DELETE RESTRICT;
    """)

    # ============================================================= payslips
    op.execute("""
        CREATE TABLE payslips (
            id                                      CHAR(36)      NOT NULL PRIMARY KEY,
            payroll_run_id                          CHAR(36)      NOT NULL,
            payroll_run_employee_id                 CHAR(36)      NOT NULL,
            employee_id                             CHAR(36)      NOT NULL,
            financial_year_id                       CHAR(36)      NOT NULL,
            pay_period_start                        DATE          NOT NULL,
            pay_period_end                          DATE          NOT NULL,
            salary_credit_date                      DATE          NOT NULL,
            pay_cycle_type_snapshot                 VARCHAR(20)   NOT NULL,
            pay_cycle_start_day_snapshot            SMALLINT      NULL,
            pay_cycle_end_day_snapshot              SMALLINT      NULL,
            salary_credit_day_snapshot              SMALLINT      NOT NULL,
            period_month                            SMALLINT      NOT NULL,
            period_year                             SMALLINT      NOT NULL,
            period_label                            VARCHAR(20)   GENERATED ALWAYS AS (CONCAT(ELT(period_month,'January','February','March','April','May','June','July','August','September','October','November','December'), ' ', period_year)) STORED,
            employee_code_snapshot                  VARCHAR(20)   NOT NULL,
            employee_name_snapshot                  VARCHAR(191)  NOT NULL,
            designation_snapshot                    VARCHAR(191)  NULL,
            department_id                           CHAR(36)      NULL,
            department_snapshot                     VARCHAR(191)  NULL,
            employment_type_id                      CHAR(36)      NULL,
            employment_type_snapshot                VARCHAR(191)  NULL,
            joining_date_snapshot                   DATE          NULL,
            employee_bank_name_snapshot             VARCHAR(120)  NULL,
            employee_bank_account_masked_snapshot   VARCHAR(4)    NULL,
            gross_pay                               DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_earnings                          DECIMAL(14,2) NOT NULL DEFAULT 0,
            total_deductions                        DECIMAL(14,2) NOT NULL DEFAULT 0,
            net_pay                                 DECIMAL(14,2) NOT NULL DEFAULT 0,
            unpaid_leave_deduction                  DECIMAL(14,2) NOT NULL DEFAULT 0,
            lop_deduction                           DECIMAL(14,2) NOT NULL DEFAULT 0,
            income_tax_amount                       DECIMAL(14,2) NOT NULL DEFAULT 0,
            insurance_employee_contribution         DECIMAL(14,2) NOT NULL DEFAULT 0,
            paid_days                               DECIMAL(5,2)  NOT NULL DEFAULT 0,
            unpaid_leave_days                       DECIMAL(5,2)  NOT NULL DEFAULT 0,
            lop_days                                DECIMAL(5,2)  NOT NULL DEFAULT 0,
            has_unpaid_leave                        TINYINT(1)    GENERATED ALWAYS AS (unpaid_leave_days > 0 OR lop_days > 0) STORED,
            has_adhoc_adjustments                   TINYINT(1)    NOT NULL DEFAULT 0,
            status                                  VARCHAR(10)   NOT NULL DEFAULT 'PROCESSED',
            reissue_count                           INT           NOT NULL DEFAULT 0,
            last_reissued_at                        DATETIME(6)   NULL,
            generated_at                            DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            generated_by                            CHAR(36)      NOT NULL,
            employee_notified_at                    DATETIME(6)   NULL,
            notification_email_send_log_id          CHAR(36)      NULL,
            pdf_file_id                             CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_payslips_run_employee (payroll_run_employee_id),
            UNIQUE KEY ux_payslips_employee_period (employee_id, period_year, period_month),
            KEY ix_payslips_employee_recent (employee_id, pay_period_end),
            KEY ix_payslips_fy_status (financial_year_id, status),
            KEY ix_payslips_department (department_id, period_year, period_month),
            KEY ix_payslips_flags (has_adhoc_adjustments, has_unpaid_leave),
            CONSTRAINT fk_payslip_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_run_employee FOREIGN KEY (payroll_run_employee_id) REFERENCES payroll_run_employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_employment_type FOREIGN KEY (employment_type_id) REFERENCES employment_types(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_email_log FOREIGN KEY (notification_email_send_log_id) REFERENCES email_send_log(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_generated_by FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_pdf_file FOREIGN KEY (pdf_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_payslip_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_payslip_month CHECK (period_month BETWEEN 1 AND 12),
            CONSTRAINT ck_payslip_dates CHECK (pay_period_end > pay_period_start),
            CONSTRAINT ck_payslip_credit CHECK (salary_credit_date > pay_period_end),
            CONSTRAINT ck_payslip_cycle_type CHECK (pay_cycle_type_snapshot IN ('FIXED_CYCLE','CALENDAR_MONTH')),
            CONSTRAINT ck_payslip_paid_days CHECK (paid_days * 2 = FLOOR(paid_days * 2)),
            CONSTRAINT ck_payslip_unpaid_days CHECK (unpaid_leave_days * 2 = FLOOR(unpaid_leave_days * 2)),
            CONSTRAINT ck_payslip_lop_days CHECK (lop_days * 2 = FLOOR(lop_days * 2)),
            CONSTRAINT ck_payslip_status CHECK (status IN ('PROCESSED','REISSUED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_payslips_fy_lock
        BEFORE INSERT ON payslips
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_payslips_no_delete
        BEFORE DELETE ON payslips
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A payslip is never deleted — corrections go through Reissue';
        END
    """)

    # =============================================== adhoc_payslip_adjustments
    op.execute("""
        CREATE TABLE adhoc_payslip_adjustments (
            id                                CHAR(36)      NOT NULL PRIMARY KEY,
            financial_year_id                 CHAR(36)      NOT NULL,
            applies_to_mode                   VARCHAR(25)   NOT NULL,
            employee_id                       CHAR(36)      NULL,
            label                             VARCHAR(191)  NOT NULL,
            adjustment_type                   VARCHAR(15)   NOT NULL,
            amount                            DECIMAL(14,2) NOT NULL,
            is_taxable                        TINYINT(1)    NOT NULL DEFAULT 1,
            is_recurring                      TINYINT(1)    NOT NULL DEFAULT 0,
            applies_to_component              VARCHAR(10)   NOT NULL DEFAULT 'GROSS',
            note                              TEXT          NULL,
            effective_from                    DATE          NOT NULL,
            effective_until                   DATE          NULL,
            source                            VARCHAR(20)   NOT NULL DEFAULT 'MANUAL',
            offer_letter_id                   CHAR(36)      NULL,
            offer_letter_custom_term_id       CHAR(36)      NULL,
            status                            VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
            removed_at                        DATETIME(6)   NULL,
            removed_by                        CHAR(36)      NULL,
            removal_reason                    TEXT          NULL,
            target_employee_count             INT           NOT NULL DEFAULT 0,
            applied_employee_count            INT           NOT NULL DEFAULT 0,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_adhoc_employee_status (employee_id, status),
            KEY ix_adhoc_status_recurring (status, is_recurring),
            KEY ix_adhoc_effective (effective_from, effective_until),
            KEY ix_adhoc_created_by (created_by, created_at),
            KEY ix_adhoc_amount (amount),
            KEY ix_adhoc_letter (offer_letter_id),
            FULLTEXT KEY ix_adhoc_label_search (label),
            CONSTRAINT fk_adhoc_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_letter FOREIGN KEY (offer_letter_id) REFERENCES offer_letters(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_letter_term FOREIGN KEY (offer_letter_custom_term_id) REFERENCES offer_letter_custom_terms(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_removed_by FOREIGN KEY (removed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoc_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_adhoc_mode CHECK (applies_to_mode IN ('SINGLE_EMPLOYEE','MULTIPLE_EMPLOYEES','ALL_ACTIVE_EMPLOYEES')),
            CONSTRAINT ck_adhoc_employee_pairing CHECK ((applies_to_mode = 'SINGLE_EMPLOYEE') = (employee_id IS NOT NULL)),
            CONSTRAINT ck_adhoc_label CHECK (TRIM(label) <> ''),
            CONSTRAINT ck_adhoc_type CHECK (adjustment_type IN ('ADDITION','SUBTRACTION')),
            CONSTRAINT ck_adhoc_amount CHECK (amount > 0),
            CONSTRAINT ck_adhoc_component CHECK (applies_to_component IN ('GROSS','NET')),
            CONSTRAINT ck_adhoc_until CHECK (effective_until IS NULL OR effective_until >= effective_from),
            CONSTRAINT ck_adhoc_source CHECK (source IN ('MANUAL','APPOINTMENT_LETTER')),
            CONSTRAINT ck_adhoc_status CHECK (status IN ('ACTIVE','CONSUMED','REMOVED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_adhoc_fy_lock
        BEFORE INSERT ON adhoc_payslip_adjustments
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)
    # Label/type/amount freeze once any payslip line has consumed this
    # adjustment — correction goes through Reissue (Payroll 2.1a), not an
    # edit here. Checked BEFORE UPDATE by counting the child table; the
    # child table (payslip_adjustment_lines) is created later in this file,
    # which MySQL permits since the check runs at trigger EXECUTION time,
    # not creation time.
    op.execute("""
        CREATE TRIGGER trg_adhoc_no_edit_once_applied
        BEFORE UPDATE ON adhoc_payslip_adjustments
        FOR EACH ROW
        BEGIN
            IF (NEW.label <> OLD.label OR NEW.adjustment_type <> OLD.adjustment_type OR NEW.amount <> OLD.amount)
               AND (SELECT COUNT(*) FROM payslip_adjustment_lines WHERE adhoc_payslip_adjustment_id = OLD.id) > 0 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This adjustment has already been applied to a payslip — Label/Type/Amount are frozen; correct via Reissue instead';
            END IF;
        END
    """)

    # =============================================== adhoc_adjustment_employees
    op.execute("""
        CREATE TABLE adhoc_adjustment_employees (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            adhoc_payslip_adjustment_id     CHAR(36)      NOT NULL,
            employee_id                     CHAR(36)      NOT NULL,
            status                          VARCHAR(10)   NOT NULL DEFAULT 'PENDING',
            times_applied                   INT           NOT NULL DEFAULT 0,
            total_applied_amount            DECIMAL(14,2) NOT NULL DEFAULT 0,
            first_applied_on                DATE          NULL,
            last_applied_on                 DATE          NULL,
            last_applied_period_month       SMALLINT      NULL,
            last_applied_period_year        SMALLINT      NULL,
            last_applied_payslip_id         CHAR(36)      NULL,
            last_applied_payroll_run_id     CHAR(36)      NULL,
            cancelled_at                    DATETIME(6)   NULL,
            cancelled_by                    CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_adhoc_target (adhoc_payslip_adjustment_id, employee_id),
            KEY ix_adhoc_target_pending (employee_id, status),
            KEY ix_adhoc_target_last_period (last_applied_period_year, last_applied_period_month),
            CONSTRAINT fk_adhoctgt_adjustment FOREIGN KEY (adhoc_payslip_adjustment_id) REFERENCES adhoc_payslip_adjustments(id) ON DELETE CASCADE,
            CONSTRAINT fk_adhoctgt_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoctgt_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoctgt_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adhoctgt_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_adhoctgt_status CHECK (status IN ('PENDING','APPLIED','CANCELLED')),
            CONSTRAINT ck_adhoctgt_last_month CHECK (last_applied_period_month IS NULL OR last_applied_period_month BETWEEN 1 AND 12)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ================================================== payslip_earning_lines
    op.execute("""
        CREATE TABLE payslip_earning_lines (
            id                          CHAR(36)      NOT NULL PRIMARY KEY,
            payslip_id                  CHAR(36)      NOT NULL,
            sequence                    SMALLINT      NOT NULL,
            component_type              VARCHAR(20)   NOT NULL,
            label                       VARCHAR(191)  NOT NULL,
            amount                      DECIMAL(14,2) NOT NULL,
            is_taxable                  TINYINT(1)    NOT NULL DEFAULT 1,
            source                      VARCHAR(20)   NOT NULL,
            adhoc_payslip_adjustment_id CHAR(36)      NULL,
            show_on_payslip             TINYINT(1)    NOT NULL DEFAULT 1,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_earning_lines_seq (payslip_id, sequence),
            KEY ix_earning_lines_adhoc (adhoc_payslip_adjustment_id),
            CONSTRAINT fk_earnline_payslip FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE,
            CONSTRAINT fk_earnline_adhoc FOREIGN KEY (adhoc_payslip_adjustment_id) REFERENCES adhoc_payslip_adjustments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_earnline_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_earnline_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_earnline_seq CHECK (sequence > 0),
            CONSTRAINT ck_earnline_type CHECK (component_type IN ('BASIC','DEARNESS_ALLOWANCE','HRA','LTA','SPECIAL_ALLOWANCE','OTHER_EARNINGS','VARIABLE_PAY','INSURANCE_BENEFIT','ADHOC_ADDITION','ARREAR','OTHER')),
            CONSTRAINT ck_earnline_amount CHECK (amount >= 0),
            CONSTRAINT ck_earnline_source CHECK (source IN ('SALARY_STRUCTURE','ADHOC_ADJUSTMENT','INSURANCE','SYSTEM'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ================================================ payslip_statutory_lines
    op.execute("""
        CREATE TABLE payslip_statutory_lines (
            id                                     CHAR(36)      NOT NULL PRIMARY KEY,
            payslip_id                             CHAR(36)      NOT NULL,
            sequence                               SMALLINT      NOT NULL,
            tax_head_id                            CHAR(36)      NOT NULL,
            head_name_snapshot                     VARCHAR(191)  NOT NULL,
            print_label_snapshot                   VARCHAR(191)  NOT NULL,
            scope_snapshot                         VARCHAR(40)   NOT NULL,
            tax_type_snapshot                      VARCHAR(20)   NOT NULL,
            rate_snapshot                          DECIMAL(7,4)  NULL,
            fixed_amount_snapshot                  DECIMAL(14,2) NULL,
            slab_application_snapshot              VARCHAR(20)   NULL,
            computed_base                          DECIMAL(14,2) NOT NULL,
            computed_amount                        DECIMAL(14,2) NOT NULL,
            calculation_note                       TEXT          NULL,
            borne_by                               VARCHAR(10)   NOT NULL,
            reduces_taxable_income_snapshot        TINYINT(1)    NOT NULL DEFAULT 0,
            include_in_ctc_snapshot                TINYINT(1)    NOT NULL DEFAULT 0,
            show_on_payslip_snapshot               TINYINT(1)    NOT NULL DEFAULT 1,
            per_employee_applicable_snapshot       TINYINT(1)    NOT NULL DEFAULT 1,
            tax_scheme_id                          CHAR(36)      NULL,
            tax_scheme_name_snapshot               VARCHAR(191)  NULL,
            component_name_snapshot                VARCHAR(191)  NULL,
            component_share_pct_snapshot           DECIMAL(6,3)  NULL,
            annual_taxable_income                  DECIMAL(14,2) NULL,
            annual_declared_reductions             DECIMAL(14,2) NULL,
            annual_tax_before_relief               DECIMAL(14,2) NULL,
            relief_rule_id                         CHAR(36)      NULL,
            relief_name_snapshot                   VARCHAR(120)  NULL,
            relief_amount_applied                  DECIMAL(14,2) NULL,
            remaining_payroll_months               SMALLINT      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_statline_seq (payslip_id, sequence),
            KEY ix_statline_payslip_borne (payslip_id, borne_by),
            KEY ix_statline_head (tax_head_id),
            KEY ix_statline_scope (scope_snapshot),
            CONSTRAINT fk_statline_payslip FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE,
            CONSTRAINT fk_statline_head FOREIGN KEY (tax_head_id) REFERENCES tax_heads(id) ON DELETE RESTRICT,
            CONSTRAINT fk_statline_scheme FOREIGN KEY (tax_scheme_id) REFERENCES tax_schemes(id) ON DELETE RESTRICT,
            CONSTRAINT fk_statline_relief FOREIGN KEY (relief_rule_id) REFERENCES tax_head_relief_rules(id) ON DELETE RESTRICT,
            CONSTRAINT fk_statline_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_statline_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_statline_seq CHECK (sequence > 0),
            CONSTRAINT ck_statline_scope CHECK (scope_snapshot IN ('PAYROLL_EMPLOYEE_DEDUCTION','PAYROLL_EMPLOYER_CONTRIBUTION','PAYROLL_INCOME_TAX')),
            CONSTRAINT ck_statline_amount CHECK (computed_amount >= 0),
            CONSTRAINT ck_statline_borne_by CHECK (borne_by IN ('EMPLOYEE','EMPLOYER')),
            CONSTRAINT ck_statline_share_pct CHECK (component_share_pct_snapshot IS NULL OR (component_share_pct_snapshot > 0 AND component_share_pct_snapshot <= 100)),
            CONSTRAINT ck_statline_relief_amt CHECK (relief_amount_applied IS NULL OR relief_amount_applied >= 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_statline_lock_head
        AFTER INSERT ON payslip_statutory_lines
        FOR EACH ROW
        BEGIN
            UPDATE tax_heads SET is_arithmetic_locked = 1, first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP(6)), usage_count = usage_count + 1
            WHERE id = NEW.tax_head_id;
        END
    """)

    # =============================================== payslip_adjustment_lines
    op.execute("""
        CREATE TABLE payslip_adjustment_lines (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            payslip_id                      CHAR(36)      NOT NULL,
            sequence                        SMALLINT      NOT NULL,
            adhoc_payslip_adjustment_id     CHAR(36)      NOT NULL,
            adhoc_adjustment_employee_id    CHAR(36)      NOT NULL,
            label_snapshot                  VARCHAR(191)  NOT NULL,
            adjustment_type                 VARCHAR(15)   NOT NULL,
            amount                          DECIMAL(14,2) NOT NULL,
            signed_amount                   DECIMAL(14,2) GENERATED ALWAYS AS (CASE WHEN adjustment_type = 'ADDITION' THEN amount ELSE -amount END) STORED,
            applies_to_component            VARCHAR(10)   NOT NULL DEFAULT 'GROSS',
            is_taxable_snapshot             TINYINT(1)    NOT NULL DEFAULT 1,
            is_recurring_snapshot           TINYINT(1)    NOT NULL DEFAULT 0,
            note_snapshot                   TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_adjline_seq (payslip_id, sequence),
            UNIQUE KEY ux_adjline_once_per_payslip (payslip_id, adhoc_adjustment_employee_id),
            KEY ix_adjline_adjustment (adhoc_payslip_adjustment_id),
            CONSTRAINT fk_adjline_payslip FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE,
            CONSTRAINT fk_adjline_adjustment FOREIGN KEY (adhoc_payslip_adjustment_id) REFERENCES adhoc_payslip_adjustments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adjline_target FOREIGN KEY (adhoc_adjustment_employee_id) REFERENCES adhoc_adjustment_employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adjline_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_adjline_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_adjline_seq CHECK (sequence > 0),
            CONSTRAINT ck_adjline_type CHECK (adjustment_type IN ('ADDITION','SUBTRACTION')),
            CONSTRAINT ck_adjline_amount CHECK (amount > 0),
            CONSTRAINT ck_adjline_component CHECK (applies_to_component IN ('GROSS','NET'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # Circular FK #2/#3: adhoc_adjustment_employees.last_applied_payslip_id/last_applied_payroll_run_id
    op.execute("""
        ALTER TABLE adhoc_adjustment_employees
        ADD CONSTRAINT fk_adhoctgt_last_payslip FOREIGN KEY (last_applied_payslip_id) REFERENCES payslips(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_adhoctgt_last_run FOREIGN KEY (last_applied_payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT;
    """)

    # ===================================================== payslip_reissues
    op.execute("""
        CREATE TABLE payslip_reissues (
            id                              CHAR(36)      NOT NULL PRIMARY KEY,
            payslip_id                      CHAR(36)      NOT NULL,
            financial_year_id               CHAR(36)      NOT NULL,
            reissue_number                  INT           NOT NULL,
            reason                          TEXT          NOT NULL,
            reissue_method                  VARCHAR(20)   NOT NULL,
            old_gross_pay                   DECIMAL(14,2) NOT NULL,
            new_gross_pay                   DECIMAL(14,2) NOT NULL,
            old_total_earnings              DECIMAL(14,2) NOT NULL,
            new_total_earnings              DECIMAL(14,2) NOT NULL,
            old_total_deductions            DECIMAL(14,2) NOT NULL,
            new_total_deductions            DECIMAL(14,2) NOT NULL,
            old_net_pay                     DECIMAL(14,2) NOT NULL,
            new_net_pay                     DECIMAL(14,2) NOT NULL,
            net_pay_delta                   DECIMAL(14,2) GENERATED ALWAYS AS (new_net_pay - old_net_pay) STORED,
            old_income_tax_amount           DECIMAL(14,2) NULL,
            new_income_tax_amount           DECIMAL(14,2) NULL,
            old_paid_days                   DECIMAL(5,2)  NULL,
            new_paid_days                   DECIMAL(5,2)  NULL,
            old_lop_days                    DECIMAL(5,2)  NULL,
            new_lop_days                    DECIMAL(5,2)  NULL,
            old_adhoc_net_total              DECIMAL(14,2) NULL,
            new_adhoc_net_total              DECIMAL(14,2) NULL,
            line_change_summary              TEXT          NULL,
            reissued_by                     CHAR(36)      NOT NULL,
            reissued_at                     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            approval_required                TINYINT(1)    NOT NULL DEFAULT 0,
            approved_by                      CHAR(36)      NULL,
            approved_at                      DATETIME(6)   NULL,
            employee_notified                TINYINT(1)    NOT NULL DEFAULT 1,
            notified_at                      DATETIME(6)   NULL,
            notification_email_send_log_id   CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_reissue_seq (payslip_id, reissue_number),
            KEY ix_reissue_payslip (payslip_id, reissued_at),
            KEY ix_reissue_by (reissued_by, reissued_at),
            CONSTRAINT fk_reissue_payslip FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_by FOREIGN KEY (reissued_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_email_log FOREIGN KEY (notification_email_send_log_id) REFERENCES email_send_log(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_reissue_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_reissue_number CHECK (reissue_number > 0),
            CONSTRAINT ck_reissue_reason CHECK (TRIM(reason) <> ''),
            CONSTRAINT ck_reissue_method CHECK (reissue_method IN ('RECALCULATED','MANUAL_ADJUSTMENT')),
            CONSTRAINT ck_reissue_approval CHECK (NOT approval_required OR approved_by IS NOT NULL)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_reissue_append_only
        BEFORE UPDATE ON payslip_reissues
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payslip_reissues is append-only — no updates';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_reissue_no_delete
        BEFORE DELETE ON payslip_reissues
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'payslip_reissues is append-only — no deletes';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_reissue_fy_lock
        BEFORE INSERT ON payslip_reissues
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    # ============================================== salary_certificate_requests
    op.execute("""
        CREATE TABLE salary_certificate_requests (
            id                            CHAR(36)      NOT NULL PRIMARY KEY,
            employee_id                   CHAR(36)      NOT NULL,
            financial_year_id             CHAR(36)      NOT NULL,
            requested_by                  CHAR(36)      NOT NULL,
            requested_at                  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            purpose                       VARCHAR(191)  NULL,
            salary_structure_id           CHAR(36)      NULL,
            employee_name_snapshot        VARCHAR(191)  NOT NULL,
            employee_code_snapshot        VARCHAR(20)   NOT NULL,
            designation_snapshot          VARCHAR(191)  NULL,
            department_snapshot           VARCHAR(191)  NULL,
            joining_date_snapshot         DATE          NULL,
            employment_type_snapshot      VARCHAR(191)  NULL,
            basic_salary_snapshot         DECIMAL(14,2) NULL,
            gross_monthly_snapshot        DECIMAL(14,2) NULL,
            net_monthly_snapshot          DECIMAL(14,2) NULL,
            annual_ctc_snapshot           DECIMAL(14,2) NULL,
            company_name_snapshot         VARCHAR(191)  NULL,
            company_address_snapshot      TEXT          NULL,
            status                        VARCHAR(15)   NOT NULL DEFAULT 'GENERATED',
            generated_at                  DATETIME(6)   NULL,
            pdf_file_id                   CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_salcert_employee (employee_id, requested_at),
            KEY ix_salcert_fy_status (financial_year_id, status),
            CONSTRAINT fk_salcert_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_structure FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_pdf_file FOREIGN KEY (pdf_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_salcert_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_salcert_status CHECK (status IN ('REQUESTED','GENERATED','FAILED'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_salcert_fy_lock
        BEFORE INSERT ON salary_certificate_requests
        FOR EACH ROW
        BEGIN
            IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
            END IF;
        END
    """)

    # ================================================================ A134a
    # Close the Phase 2 cross-phase deferral: offer_letter_custom_terms.
    # queued_adjustment_id had no FK since adhoc_payslip_adjustments didn't
    # exist yet — it does now.
    op.execute("""
        ALTER TABLE offer_letter_custom_terms
        ADD CONSTRAINT fk_olct_queued_adjustment FOREIGN KEY (queued_adjustment_id) REFERENCES adhoc_payslip_adjustments(id) ON DELETE RESTRICT;
    """)

    # =================================================================== A121
    # "Payroll Basis (Day/Hour) setting flagged as needing a home, most
    # likely Company Profile" — given a real home now that Payroll exists.
    op.execute("""
        ALTER TABLE company_profile
        ADD COLUMN payroll_basis VARCHAR(10) NOT NULL DEFAULT 'HOUR_BASIS',
        ADD CONSTRAINT ck_cp_payroll_basis CHECK (payroll_basis IN ('DAY_BASIS','HOUR_BASIS'));
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE company_profile DROP CHECK ck_cp_payroll_basis;")
    op.execute("ALTER TABLE company_profile DROP COLUMN payroll_basis;")
    op.execute("ALTER TABLE offer_letter_custom_terms DROP FOREIGN KEY fk_olct_queued_adjustment;")
    # Break the circular FK first (monthly_hour_reconciliations <-> payroll_run_employees)
    # — found live: dropping payroll_run_employees while this constraint still
    # points at it fails with error 3730, same class of ordering bug as any
    # other circular reference in this schema.
    op.execute("ALTER TABLE monthly_hour_reconciliations DROP FOREIGN KEY fk_hourrecon_consumed;")
    op.execute("ALTER TABLE adhoc_adjustment_employees DROP FOREIGN KEY fk_adhoctgt_last_payslip;")
    op.execute("ALTER TABLE adhoc_adjustment_employees DROP FOREIGN KEY fk_adhoctgt_last_run;")
    for table in [
        "salary_certificate_requests",
        "payslip_reissues",
        "payslip_adjustment_lines",
        "payslip_statutory_lines",
        "payslip_earning_lines",
        "adhoc_adjustment_employees",
        "adhoc_payslip_adjustments",
        "payslips",
        "payroll_run_employees",
        "payroll_runs",
        "monthly_hour_reconciliations",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table};")
