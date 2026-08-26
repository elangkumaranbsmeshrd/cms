import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

/** 06-payroll-module.md — Run Payroll + History, Ad-hoc Payslip Adjustments,
 * Payslip (Accountant/HR view) + Reissue, and Attendance & Time Basis.
 * Static literal segments ('new') are listed BEFORE their sibling `:id`
 * route at the same depth (payroll/run/new before payroll/run/:id) so the
 * Router's first-match-wins, pathMatch:'full' resolution picks the literal
 * route for that exact URL rather than swallowing it into the param route.
 */
export const payrollRoutes: Routes = [
  // ---- Run Payroll + History (payroll.run) --------------------------------
  screenRoute('payroll.run', 'payroll/run', () => import('./screens/payroll.run-history.list.config')),
  // Bespoke component, no ScreenConfig to resolve — one component behind two
  // routes (Stage 1 create form / Stage 2 preview+actions), see
  // payroll.run.component.ts's own doc.
  {
    path: 'payroll/run/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('payroll.run')],
    data: { screenId: 'payroll.run', screenPath: 'payroll/run/new' },
    loadComponent: () => import('./screens/payroll.run.component').then((m) => m.PayrollRunComponent),
  },
  {
    path: 'payroll/run/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('payroll.run')],
    data: { screenId: 'payroll.run', screenPath: 'payroll/run/:id' },
    loadComponent: () => import('./screens/payroll.run.component').then((m) => m.PayrollRunComponent),
  },

  // ---- Ad-hoc Payslip Adjustments (payroll.adhoc_adjustments) -------------
  screenRoute('payroll.adhoc_adjustments', 'payroll/adhoc-adjustments', () => import('./screens/payroll.adhoc-adjustments.list.config')),
  // Bespoke create form — MULTIPLE_EMPLOYEES mode needs the live employee
  // picker, which FormScreenConfig's static-only 'checkgroup' cannot express.
  {
    path: 'payroll/adhoc-adjustments/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('payroll.adhoc_adjustments')],
    data: { screenId: 'payroll.adhoc_adjustments', screenPath: 'payroll/adhoc-adjustments/new' },
    loadComponent: () => import('./screens/payroll.adhoc-adjustments-create.component').then((m) => m.PayrollAdhocAdjustmentsCreateComponent),
  },

  // ---- Payslip — Accountant/HR View (payroll.payslips_admin) --------------
  screenRoute('payroll.payslips_admin', 'payroll/payslips', () => import('./screens/payroll.payslips.list.config')),
  screenRoute('payroll.payslips_admin', 'payroll/payslips/:id', () => import('./screens/payroll.payslips.payslip.config')),
  // Bespoke Reissue — the real endpoint is POST .../reissue, a different verb
  // to a sub-resource action URL FormScreenConfig's updateEndpoint (always
  // PUT) cannot express.
  {
    path: 'payroll/payslips/:id/reissue',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('payroll.payslips_admin')],
    data: { screenId: 'payroll.payslips_admin', screenPath: 'payroll/payslips/:id/reissue' },
    loadComponent: () => import('./screens/payroll.payslip-reissue.component').then((m) => m.PayrollPayslipReissueComponent),
  },

  // ---- Attendance & Time Basis (payroll.attendance_time_basis) ------------
  // Bespoke tabbed component — needs switchable tabs (not all-tables-
  // stacked, unlike the 'report' shape), Day-wise Log has a mandatory
  // employee_id the other tabs don't share, and Biometric Feed takes zero
  // params and has no export. Single route, no per-tab sub-routes.
  {
    path: 'payroll/attendance',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('payroll.attendance_time_basis')],
    data: { screenId: 'payroll.attendance_time_basis', screenPath: 'payroll/attendance' },
    loadComponent: () => import('./screens/payroll.attendance.component').then((m) => m.PayrollAttendanceComponent),
  },
];
