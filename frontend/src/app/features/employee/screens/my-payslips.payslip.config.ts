import { PayslipScreenConfig } from '../../../shared/screens/screen.types';

interface PayslipLineRow {
  readonly label: string;
  readonly amount: number;
}
interface StatutoryLineRow {
  readonly print_label_snapshot: string;
  readonly computed_amount: number;
}
interface AdjustmentLineRow {
  readonly label_snapshot: string;
  readonly amount: number;
  readonly adjustment_type: string;
}
interface PayslipRow {
  readonly id: string;
  readonly employee_code_snapshot: string;
  readonly employee_name_snapshot: string;
  readonly designation_snapshot: string;
  readonly department_snapshot: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly pay_period_start: string;
  readonly pay_period_end: string;
  readonly salary_credit_date: string;
  readonly gross_pay: number;
  readonly total_earnings: number;
  readonly total_deductions: number;
  readonly net_pay: number;
  readonly status: string;
  readonly reissue_count: number;
  readonly last_reissued_at: string | null;
  readonly earning_lines: readonly PayslipLineRow[];
  readonly statutory_lines: readonly StatutoryLineRow[];
  readonly adjustment_lines: readonly AdjustmentLineRow[];
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** §2.5 My Payslips — "Opening a payslip shows the breakup." Uses the
 * existing 'payslip' shape (screen.types.ts) — no bespoke component
 * needed, this is exactly what it was built for.
 */
const config: PayslipScreenConfig<PayslipRow> = {
  shape: 'payslip',
  id: 'payroll.my_payslips',
  title: 'Payslip',
  specRef: '§2.5',
  loadEndpoint: (id) => `/payroll/payslips/me/${id}`,
  header: {
    recId: (row) => `Payslip · ${MONTH_NAMES[row.period_month]} ${row.period_year}`,
    employeeName: (row) => row.employee_name_snapshot,
    meta: (row) => [row.employee_code_snapshot, row.designation_snapshot, row.department_snapshot],
    badge: (row) => (row.status === 'REISSUED' ? 'Reissued' : 'Processed'),
    subline: (row) => `Covers ${row.pay_period_start} to ${row.pay_period_end} · Credited on ${row.salary_credit_date}`,
    reissueSummary: (row) => (row.reissue_count > 0 && row.last_reissued_at ? `Reissued ${row.reissue_count} time(s), last on ${row.last_reissued_at.slice(0, 10)}` : null),
  },
  summary: {
    gross: (row) => row.gross_pay,
    deductions: (row) => row.total_deductions,
    netPay: (row) => row.net_pay,
  },
  earningLines: (row) => row.earning_lines.filter((l) => (l as unknown as { show_on_payslip?: boolean }).show_on_payslip !== false).map((l) => ({ label: l.label, amount: l.amount })),
  deductionLines: (row) => row.statutory_lines.map((l) => ({ label: l.print_label_snapshot, amount: l.computed_amount })),
  adhocLines: (row) => row.adjustment_lines.filter((l) => l.adjustment_type === 'ADDITION').map((l) => ({ label: l.label_snapshot, amount: l.amount, tag: 'Ad-hoc' })),
  pdfEndpoint: (row) => `/payroll/payslips/${row.id}/pdf`,
  salaryCertificate: {
    requestEndpoint: '/payroll/salary-certificates',
    promptForPurpose: true,
  },
};

export default config;
