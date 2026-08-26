import { PayslipScreenConfig } from '../../../shared/screens/screen.types';
import { MONTH_NAMES, PayslipAdminRow } from '../payroll.api';

/** §2.3 Payslip — Accountant/HR View, detail. Reuses the 'payslip' shape
 * exactly as employee/screens/my-payslips.payslip.config.ts does (the
 * proven, already-built self-service baseline) — pointed at the admin
 * loadEndpoint instead of the self-service one.
 *
 * deductionLines/adhocLines here are MORE complete than that baseline: the
 * self-service config's deductionLines only maps statutory_lines, missing
 * unpaid_leave_deduction/lop_deduction and any ad-hoc SUBTRACTION line —
 * three real deduction sources a Payslip can carry (schemas/payroll.py:
 * 193-194 + adjustment_lines where adjustment_type === 'SUBTRACTION') that
 * would otherwise silently not show up on the printed breakup here.
 */
const config: PayslipScreenConfig<PayslipAdminRow> = {
  shape: 'payslip',
  id: 'payroll.payslips_admin',
  title: 'Payslip',
  specRef: '§2.3',
  loadEndpoint: (id) => `/payroll/payslips/${id}`,
  header: {
    recId: (row) => `Payslip · ${MONTH_NAMES[row.period_month]} ${row.period_year}`,
    employeeName: (row) => row.employee_name_snapshot,
    meta: (row) => [row.employee_code_snapshot, row.designation_snapshot ?? '', row.department_snapshot ?? ''],
    badge: (row) => (row.status === 'REISSUED' ? 'Reissued' : 'Processed'),
    subline: (row) => `Covers ${row.pay_period_start} to ${row.pay_period_end} · Credited on ${row.salary_credit_date}`,
    reissueSummary: (row) => (row.reissue_count > 0 && row.last_reissued_at ? `Reissued ${row.reissue_count} time(s), last on ${row.last_reissued_at.slice(0, 10)}` : null),
  },
  summary: {
    gross: (row) => Number(row.gross_pay),
    deductions: (row) => Number(row.total_deductions),
    netPay: (row) => Number(row.net_pay),
  },
  earningLines: (row) => row.earning_lines.filter((l) => l.show_on_payslip !== false).map((l) => ({ label: l.label, amount: Number(l.amount) })),
  deductionLines: (row) => [
    ...row.statutory_lines.map((l) => ({ label: l.print_label_snapshot, amount: Number(l.computed_amount) })),
    ...(Number(row.unpaid_leave_deduction) > 0 ? [{ label: 'Unpaid Leave Deduction', amount: Number(row.unpaid_leave_deduction) }] : []),
    ...(Number(row.lop_deduction) > 0 ? [{ label: 'Loss of Pay Deduction', amount: Number(row.lop_deduction) }] : []),
    ...row.adjustment_lines.filter((l) => l.adjustment_type === 'SUBTRACTION').map((l) => ({ label: l.label_snapshot, amount: Number(l.amount), tag: 'Ad-hoc' })),
  ],
  adhocLines: (row) => row.adjustment_lines.filter((l) => l.adjustment_type === 'ADDITION').map((l) => ({ label: l.label_snapshot, amount: Number(l.amount), tag: 'Ad-hoc' })),
  pdfEndpoint: (row) => `/payroll/payslips/${row.id}/pdf`,
  // §2.3's admin counterpart to §2.5's self-service "Download Salary
  // Certificate": POST /payroll/salary-certificates now accepts an optional
  // `employee_id` query param, gated additionally on payroll.payslips_admin
  // (payslips.py's request_salary_certificate) — employeeId here points it
  // at THIS payslip's owner, not the logged-in Accountant/HR/Super Admin.
  salaryCertificate: {
    requestEndpoint: '/payroll/salary-certificates',
    promptForPurpose: true,
    employeeId: (row) => row.employee_id,
  },
  reissue: {
    route: (row) => ['/payroll/payslips', row.id, 'reissue'],
    // screenAction defaults to 'reissue' on PayslipScreenConfig — matches
    // payroll.payslips_admin's real action name (app/rbac/registry/
    // screens.py: actions=("reissue",)), so no override needed here.
  },
  // reissueHistoryEndpoint deliberately omitted — no GET .../reissues list
  // endpoint exists (payslips.py has only the POST reissue at line 296), and
  // PayslipScreenConfig's own doc says omitting this just means no Reissue
  // History card renders. That is correct here, not a gap.
};

export default config;
