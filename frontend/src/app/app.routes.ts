import { Routes } from '@angular/router';

import { authGuard, changePasswordGuard } from './core/auth/auth.guard';
import { assetRoutes } from './features/asset/asset.routes';
import { complianceRoutes } from './features/compliance/compliance.routes';
import { customerRoutes } from './features/customer/customer.routes';
import { employeeRoutes } from './features/employee/employee.routes';
import { expenseRoutes } from './features/expense/expense.routes';
import { invoiceRoutes } from './features/invoice/invoice.routes';
import { leaveRoutes } from './features/leave/leave.routes';
import { mastersRoutes } from './features/masters/masters.routes';
import { opportunityRoutes } from './features/opportunity/opportunity.routes';
import { payrollRoutes } from './features/payroll/payroll.routes';
import { projectRoutes } from './features/project/project.routes';
import { purchaseBillRoutes } from './features/purchase-bill/purchase-bill.routes';
import { rbacRoutes } from './features/rbac/rbac.routes';
import { ticketRoutes } from './features/ticket/ticket.routes';
import { vendorRoutes } from './features/vendor/vendor.routes';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./layout/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./layout/forgot-password-page.component').then((m) => m.ForgotPasswordPageComponent),
  },
  {
    path: '403',
    loadComponent: () => import('./layout/forbidden-page.component').then((m) => m.ForbiddenPageComponent),
  },
  {
    // Deliberately OUTSIDE the authGuard-gated shell below. A user with
    // must_change_password set is 403'd by the backend on every endpoint except
    // POST /auth/change-password and GET /me (app/auth/deps.py), so the shell —
    // which loads reference data as it renders — cannot host this screen. See
    // the component's own doc comment for the full history.
    path: 'change-password',
    canMatch: [changePasswordGuard],
    loadComponent: () => import('./layout/change-password-page.component').then((m) => m.ChangePasswordPageComponent),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      // §2.10: Dashboard is the natural landing page — was 'employees'
      // (the bare Directory) before this screen existed. Reached this way
      // rather than through SCREEN_ROUTES/the sidebar, since its RBAC gate
      // (employee.my_profile — GET /employees/me/dashboard has no
      // dedicated screen key) already owns that map slot for My Profile.
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      ...employeeRoutes,
      ...leaveRoutes,
      ...vendorRoutes,
      ...customerRoutes,
      ...mastersRoutes,
      ...rbacRoutes,
      ...ticketRoutes,
      ...assetRoutes,
      ...expenseRoutes,
      ...opportunityRoutes,
      ...invoiceRoutes,
      ...complianceRoutes,
      ...payrollRoutes,
      ...projectRoutes,
      ...purchaseBillRoutes,
      {
        path: 'settings',
        pathMatch: 'full',
        loadComponent: () => import('./layout/settings-page.component').then((m) => m.SettingsPageComponent),
      },
      {
        path: 'coming-soon/:id',
        loadComponent: () => import('./layout/coming-soon.component').then((m) => m.ComingSoonComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
