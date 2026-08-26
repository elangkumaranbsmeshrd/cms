import { Routes } from '@angular/router';

import { screenRoute } from '../../shared/screens/screen-route';

// Both routes gate on the SAME RBAC screen key — the real backend's
// GET /vendors and GET /vendors/{id} both check require_screen('vendor.directory')
// too (app/api/v1/vendors.py's SCREEN constant), there is no separate
// 'vendor.master_record' key the way Employee has one.
export const vendorRoutes: Routes = [
  screenRoute('vendor.directory', 'vendors', () => import('./screens/vendor.directory.config')),
  // Must precede 'vendors/:id' below — both are single-segment, pathMatch:
  // 'full' routes under /vendors/, and the router picks the FIRST match in
  // array order (screen-route.ts's own doc; asset.routes.ts's own
  // assets/new-before-assets/:id is the same ordering rule). §2.2's "+ Add
  // Vendor": the create-only 'form' shape lives at vendors/new; the record
  // shape below owns vendors/:id for view/tabs/edit.
  screenRoute('vendor.directory', 'vendors/new', () => import('./screens/vendor.create.form.config')),
  screenRoute('vendor.directory', 'vendors/:id', () => import('./screens/vendor.record.config')),
];
