import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// NOTE for whoever wires this into app.routes.ts: this array is deliberately
// NOT spread into the root routes yet (out of this task's scope — see the
// module-level build brief). Add `...expenseRoutes` to app.routes.ts's own
// `children` array (alongside ...leaveRoutes/...vendorRoutes/etc.) and the
// matching SCREEN_ROUTES entries to nav-registry.ts.
export const expenseRoutes: Routes = [
  // Expense Approvals is the one screen in this module that fits the plain
  // ListScreenConfig shape as-is — see expense.approvals.list.config.ts.
  screenRoute('expense.approvals', 'expenses/approvals', () => import('./screens/expense.approvals.list.config')),

  // Bespoke components, no ScreenConfig to resolve — My Expenses/All
  // Expenses/Company Expenses each need a real inline form and/or a second,
  // structurally distinct data source (Summary) no generic shape covers
  // (see each component's own header comment). Same canMatch/data wiring
  // screenRoute() itself uses, mirroring leave.routes.ts's own bespoke
  // entries (leave/carry-forward, leave/compensatory-hours/new).
  {
    path: 'my-expenses',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('expense.my_expenses')],
    data: { screenId: 'expense.my_expenses', screenPath: 'my-expenses' },
    loadComponent: () => import('./screens/my-expenses.component').then((m) => m.MyExpensesComponent),
  },
  {
    path: 'expenses/all',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('expense.all_expenses')],
    data: { screenId: 'expense.all_expenses', screenPath: 'expenses/all' },
    loadComponent: () => import('./screens/all-expenses.component').then((m) => m.AllExpensesComponent),
  },
  {
    path: 'expenses/company',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('expense.company')],
    data: { screenId: 'expense.company', screenPath: 'expenses/company' },
    loadComponent: () => import('./screens/company-expenses.component').then((m) => m.CompanyExpensesComponent),
  },
];
