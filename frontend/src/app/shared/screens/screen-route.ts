import { Route } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { ScreenConfig } from './screen.types';

/** One helper, every screen route (ARCH-3 §3: "one helper, 161 routes, zero
 * copy-paste"). canMatch runs BEFORE the config's lazy chunk downloads — a
 * role that can't open this screen never fetches its code, not just never
 * sees it rendered.
 *
 * `pathMatch: 'full'` is load-bearing, not stylistic: a `canMatch` guard
 * that returns a `UrlTree` (ours does, to redirect to /403) redirects the
 * WHOLE navigation the instant Angular's router considers this route a
 * candidate — it does NOT just skip this route and try the next sibling.
 * Without `full`, a static leaf route like `employees` prefix-matches the
 * first segment of `/employees/:id` too, so its own guard fires first and
 * hijacks navigation to a record route before `employees/:id` is ever
 * tried (confirmed live: visiting a real employee's record while logged in
 * as a role that can open the record but not the directory list produced a
 * 403 for `employee.directory`, not `employee.master_record`). Every
 * `screenRoute()` is a leaf with no children, so full-match is always
 * correct here, never a behavior change worth opting out of per-call.
 */
export function screenRoute(id: string, path: string, configLoader: () => Promise<{ default: ScreenConfig }>): Route {
  return {
    path,
    pathMatch: 'full',
    canMatch: [screenAccessGuard(id)],
    // `screenId` was previously known only to the guard closure. Publishing it
    // on route data is what lets the breadcrumb trail be DERIVED (walk the URL
    // upwards, match each ancestor prefix against the real router config) rather
    // than read from a hand-maintained parent map that goes stale the moment a
    // path changes. `path` is published for the same reason — matching a URL
    // prefix back to the route that owns it needs the pattern, not just the id.
    data: { screenId: id, screenPath: path },
    loadComponent: () => import('./screen-host.component').then((m) => m.ScreenHostComponent),
    resolve: { config: () => configLoader().then((m) => m.default) },
  };
}
