import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

export const leaveRoutes: Routes = [
  screenRoute('leave.approvals', 'leave/approvals', () => import('./screens/leave.approvals.list.config')),
  screenRoute('leave.balance_management', 'leave/balances', () => import('./screens/leave.balance-management.list.config')),
  screenRoute('leave.balance_management', 'leave/balances/adjustments', () => import('./screens/leave.balance-adjustment-history.list.config')),
  screenRoute('leave.reports', 'leave/reports', () => import('./screens/leave.reports.config')),
  screenRoute('leave.compensatory_hours', 'leave/compensatory-hours', () => import('./screens/leave.comp-hours.list.config')),
  screenRoute('leave.compensatory_hours', 'leave/compensatory-hours-approvals', () => import('./screens/leave.comp-hours-approvals.list.config')),
  // Company Holiday Calendar (§2.4) reuses masters.holidays as its RBAC
  // screen key (see leave.holiday-calendar.config.ts's own comment) —
  // masters.routes.ts already owns that key's ONE sidebar-reachable route
  // (/masters/holidays), so this mirror is a second, sidebar-invisible
  // route reached only via My Leave's own "Holiday Calendar" link
  // (my-leave.component.ts) — the same one-path-per-screen-key limitation
  // documented on nav-registry.ts's employee.documents entry.
  screenRoute('masters.holidays', 'leave/holiday-calendar', () => import('./screens/leave.holiday-calendar.config')),
  // Bespoke components, no ScreenConfig to resolve.
  {
    path: 'leave/carry-forward',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('leave.balance_management')],
    data: { screenId: 'leave.balance_management', screenPath: 'leave/carry-forward' },
    loadComponent: () => import('./screens/leave.carry-forward.component').then((m) => m.LeaveCarryForwardComponent),
  },
  {
    path: 'leave/compensatory-hours/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('leave.compensatory_hours')],
    data: { screenId: 'leave.compensatory_hours', screenPath: 'leave/compensatory-hours/new' },
    loadComponent: () => import('./screens/leave.comp-hours-apply.component').then((m) => m.LeaveCompHoursApplyComponent),
  },
  {
    path: 'leave/balances/:id/adjust',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('leave.balance_management')],
    data: { screenId: 'leave.balance_management', screenPath: 'leave/balances/:id/adjust' },
    loadComponent: () => import('./screens/leave.balance-adjust.component').then((m) => m.LeaveBalanceAdjustComponent),
  },
];
