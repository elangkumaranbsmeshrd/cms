import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

export const assetRoutes: Routes = [
  screenRoute('asset.directory', 'assets', () => import('./screens/asset.directory.list.config')),
  // Must precede 'assets/:id' below — both are single-segment, pathMatch:
  // 'full' routes under /assets/, and the router picks the FIRST match in
  // array order (screen-route.ts's own doc, re: employee.routes.ts's
  // announcements/announcements-new ordering). §0.8's two-config split: this
  // is the create-only 'form' shape at assets/new; the record shape below
  // owns assets/:id for view/tabs/edit.
  screenRoute('asset.directory', 'assets/new', () => import('./screens/asset.create.form.config')),
  screenRoute('asset.directory', 'assets/:id', () => import('./screens/asset.record.config')),
  screenRoute('asset.maintenance', 'asset-maintenance', () => import('./screens/asset.maintenance.list.config')),
  screenRoute('asset.requests', 'asset-requests', () => import('./screens/asset.requests.list.config')),
  // Bespoke components, no ScreenConfig to resolve — same reasoning
  // rbac.routes.ts's own matrix/overrides routes document.
  {
    path: 'asset-reports',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('asset.reports')],
    data: { screenId: 'asset.reports', screenPath: 'asset-reports' },
    loadComponent: () => import('./screens/asset.reports.component').then((m) => m.AssetReportsComponent),
  },
  // §2.8 Reclaim on Exit — always reached with a specific employeeId (the
  // Employee module's own Exit Checklist link, resignation.exit-checklist
  // .config.ts's RETURN_ALL_ASSETS step), never browsed bare from the
  // sidebar — see asset.routes' own report on why this screen key has no
  // SCREEN_ROUTES entry.
  {
    path: 'assets/reclaim/:employeeId',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('asset.reclaim')],
    data: { screenId: 'asset.reclaim', screenPath: 'assets/reclaim/:employeeId' },
    loadComponent: () => import('./screens/asset.reclaim.component').then((m) => m.AssetReclaimComponent),
  },
];
