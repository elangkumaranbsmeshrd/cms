/** The real, UNMERGED module keys (app/rbac/registry/screens.py's ScreenDef.
 * module) an override or a change-log entry can actually belong to. Unlike
 * rbac.permission-matrix.config.ts's own MODULE_META (which merges "leave"
 * and "payroll" into one "Leave & Payroll" collapsible section purely for
 * the matrix grid's display), the prototype's own Add Override form
 * (app-forms.js's 'r.override', Module dropdown) lists Leave and Payroll as
 * two separate options — matching the real, independent module boundary
 * every override/change-log row actually carries. "Tax & Compliance" is
 * absent from that same prototype dropdown (the mock array predates Module
 * 15 being built) but is a real, live module_key today (compliance.* is
 * registered and reachable), so it's included here rather than reproducing
 * the mock's staleness.
 */
export const RBAC_MODULE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'masters', label: 'Masters' },
  { value: 'employee', label: 'Employee' },
  { value: 'asset', label: 'Asset Management' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'leave', label: 'Leave' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'customer', label: 'Customer' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'project', label: 'Project' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'expense', label: 'Expense' },
  { value: 'purchase_bill', label: 'Purchase Bill' },
  { value: 'compliance', label: 'Tax & Compliance' },
];

export const RBAC_ROLE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'HR', label: 'HR' },
  { value: 'EMPLOYEE', label: 'Employee' },
];

// §4.3's own vocabulary ("which layer — Visibility/Action/Field/Scope") —
// shares its L1-L4 codes with the Change Log's identical filter
// (rbac.change-log.list.config.ts), kept as a separate literal here since
// Overrides is a bespoke component with no shared config module to import
// a constant from without creating a features/rbac -> features/rbac
// cross-screen coupling for four strings.
export const RBAC_LAYER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'L1', label: 'Screen visibility' },
  { value: 'L2', label: 'Action permission' },
  { value: 'L3', label: 'Field toggle' },
  { value: 'L4', label: 'Scope restriction' },
];
