import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// One RBAC screen key ('customer.directory') backs every route below —
// customers.py's SCREEN constant gates the list, the record, and both the
// create/update endpoints (all via action="edit") alike, same convention
// customer.record.component.ts's own header comment documents.
//
// Ordering is load-bearing (screen-route.ts's own doc, and opportunity.
// routes.ts's identical reasoning): 'customers/new' is a literal two-segment
// path and MUST precede 'customers/:id' (also two segments) — Angular's
// router matches Route array entries in DECLARATION ORDER, not by
// specificity, so if ':id' came first it would swallow /customers/new (id
// would resolve to the literal string "new"). 'customers/:id/edit' (three
// segments) never collides with the two-segment ':id' route regardless of
// order, but is declared alongside 'new' for the same reason — they share
// one form module (customer.form.config.ts branches on whether :id is
// present, exactly like every other FormScreenConfig route pair).
export const customerRoutes: Routes = [
  screenRoute('customer.directory', 'customers', () => import('./screens/customer.directory.config')),
  screenRoute('customer.directory', 'customers/new', () => import('./screens/customer.form.config')),
  screenRoute('customer.directory', 'customers/:id/edit', () => import('./screens/customer.form.config')),
  {
    // §2.3 Customer 360 — bespoke (neither 'record' nor 'tabbed' fits; see
    // customer.record.component.ts's own header comment for why).
    path: 'customers/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('customer.directory')],
    data: { screenId: 'customer.directory', screenPath: 'customers/:id' },
    loadComponent: () => import('./screens/customer.record.component').then((m) => m.CustomerRecordComponent),
  },
];
