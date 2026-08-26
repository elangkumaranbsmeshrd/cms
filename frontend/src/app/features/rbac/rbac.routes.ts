import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

export const rbacRoutes: Routes = [
  screenRoute('rbac.role_directory', 'rbac/roles', () => import('./screens/rbac.role-directory.list.config')),
  screenRoute('rbac.change_log', 'rbac/change-log', () => import('./screens/rbac.change-log.list.config')),
  screenRoute('rbac.overrides', 'rbac/overrides', () => import('./screens/rbac.overrides.list.config')),
  // Bespoke components, no ScreenConfig to resolve — same reasoning
  // my-profile.component.ts's own route entry documents.
  {
    path: 'rbac/matrix/:roleCode',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('rbac.permission_matrix')],
    data: { screenId: 'rbac.permission_matrix', screenPath: 'rbac/matrix/:roleCode' },
    loadComponent: () => import('./screens/rbac.matrix.component').then((m) => m.RbacMatrixComponent),
  },
  {
    path: 'rbac/matrix',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('rbac.permission_matrix')],
    data: { screenId: 'rbac.permission_matrix', screenPath: 'rbac/matrix' },
    loadComponent: () => import('./screens/rbac.matrix.component').then((m) => m.RbacMatrixComponent),
  },
  // rbac.overrides's own "add" action (registry: actions=("add","remove")) —
  // a bespoke cascading form (Employee -> Module -> Screen -> Permission),
  // not the generic create route every other module.directory screen's
  // createRoute points at. Same screenId as the list above, since the
  // registry has no separate key for this — matching how the prototype's
  // own rbac.addoverride (navHidden: 1) is reached only via the list's
  // "+ Add Override" button, never a nav entry of its own.
  {
    path: 'rbac/overrides/add',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('rbac.overrides')],
    data: { screenId: 'rbac.overrides', screenPath: 'rbac/overrides/add' },
    loadComponent: () => import('./screens/rbac.add-override.component').then((m) => m.RbacAddOverrideComponent),
  },
];
