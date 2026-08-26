import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

export const employeeRoutes: Routes = [
  screenRoute('employee.directory', 'employees', () => import('./screens/emp.directory.config')),
  // §2.1 "+ Add Employee" — a create-only 'form'-shape sibling of the
  // 'record'-shape Master Record below, registered before ':id' so 'new'
  // never resolves as a route param (same ordering asset.routes.ts uses for
  // assets/new vs assets/:id).
  screenRoute('employee.master_record', 'employees/new', () => import('./screens/emp.create.form.config')),
  // §2.13 Onboarding — All Employees (emp.onboardqueue). Same static-before-
  // dynamic ordering as 'employees/new' just above — registered before
  // 'employees/:id' so 'onboarding-queue' never resolves as an employee id.
  screenRoute('employee.onboarding', 'employees/onboarding-queue', () => import('./screens/onboarding-queue.list.config')),
  screenRoute('employee.master_record', 'employees/:id', () => import('./screens/emp.record.config')),
  // Bespoke component, no ScreenConfig to resolve — same reasoning as
  // masters.routes.ts's tax-head-child routes (screenRoute() assumes a
  // config-driven shape; My Profile self-fetches /employees/me instead of
  // taking a route :id or a resolved config).
  {
    path: 'my-profile',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('employee.my_profile')],
    data: { screenId: 'employee.my_profile', screenPath: 'my-profile' },
    loadComponent: () => import('./screens/my-profile.component').then((m) => m.MyProfileComponent),
  },
  {
    path: 'my-leave',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('leave.my_leave')],
    data: { screenId: 'leave.my_leave', screenPath: 'my-leave' },
    loadComponent: () => import('./screens/my-leave.component').then((m) => m.MyLeaveComponent),
  },
  screenRoute('payroll.my_payslips', 'my-payslips', () => import('./screens/my-payslips.list.config')),
  screenRoute('payroll.my_payslips', 'my-payslips/:id', () => import('./screens/my-payslips.payslip.config')),
  {
    path: 'my-documents',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('employee.documents')],
    data: { screenId: 'employee.documents', screenPath: 'my-documents' },
    loadComponent: () => import('./screens/my-documents.component').then((m) => m.MyDocumentsComponent),
  },
  screenRoute('employee.documents', 'documents/verification-queue', () => import('./screens/document-verification-queue.list.config')),
  screenRoute('employee.my_tickets', 'my-tickets', () => import('./screens/my-tickets.list.config')),
  screenRoute('employee.my_projects_tasks', 'my-projects-tasks', () => import('./screens/my-projects-tasks.tabbed.config')),
  {
    path: 'my-assets',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('employee.my_assets')],
    data: { screenId: 'employee.my_assets', screenPath: 'my-assets' },
    loadComponent: () => import('./screens/my-assets.component').then((m) => m.MyAssetsComponent),
  },
  {
    path: 'dashboard',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('employee.my_profile')],
    data: { screenId: 'employee.my_profile', screenPath: 'dashboard' },
    loadComponent: () => import('./screens/my-dashboard.component').then((m) => m.MyDashboardComponent),
  },
  screenRoute('employee.announcements', 'announcements', () => import('./screens/announcements.list.config')),
  screenRoute('employee.announcements', 'announcements/new', () => import('./screens/announcements.form.config')),
  screenRoute('employee.offboarding', 'resignations', () => import('./screens/resignations.list.config')),
  screenRoute('employee.offboarding', 'resignations/:id/exit-checklist', () => import('./screens/resignation.exit-checklist.config')),
  {
    path: 'my-tax-declarations',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('employee.tax_declarations')],
    data: { screenId: 'employee.tax_declarations', screenPath: 'my-tax-declarations' },
    loadComponent: () => import('./screens/my-tax-declarations.component').then((m) => m.MyTaxDeclarationsComponent),
  },
];
