import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// Purchase Bill module. List/Add/Edit/Record Payment all live under exactly
// ONE RBAC screen key — app/rbac/registry/screens.py has only
// purchase_bill.list for this whole module (has_scope=False,
// actions=("edit", "record_payment")), unlike Invoice's three keys — so
// every route below gates on it. Add/Edit share one screen+route pair
// (purchase-bills/new + purchase-bills/:id) the same way invoice.routes.ts's
// New/Edit Invoice do, since DocumentScreenComponent itself branches on
// whether :id is present in the route.
//
// Ordering is load-bearing (screen-route.ts's own comment; matches
// invoice.routes.ts/ticket.routes.ts's identical note): 'purchase-bills/new'
// MUST be declared BEFORE 'purchase-bills/:id' — both are exactly two path
// segments, and Angular's router matches Route array entries in DECLARATION
// ORDER, not by specificity. If 'purchase-bills/:id' came first, it would
// swallow the literal URL /purchase-bills/new (id would resolve to the
// string "new"), and the document screen's own GET /purchase-bills/new
// would 404. The three-segment route ('purchase-bills/:id/record-payment')
// is unambiguous regardless of order — it never collides with the
// two-segment 'purchase-bills/:id' — but is still declared before it here,
// matching invoice.routes.ts's own layout (every more-specific route ahead
// of the bare :id catch-all).
export const purchaseBillRoutes: Routes = [
  screenRoute('purchase_bill.list', 'purchase-bills', () => import('./screens/purchase-bill.list.config')),
  screenRoute('purchase_bill.list', 'purchase-bills/new', () => import('./screens/purchase-bill.document.config')),
  {
    path: 'purchase-bills/:id/record-payment',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('purchase_bill.list')],
    data: { screenId: 'purchase_bill.list', screenPath: 'purchase-bills/:id/record-payment' },
    loadComponent: () => import('./screens/purchase-bill.record-payment.component').then((m) => m.PurchaseBillRecordPaymentComponent),
  },
  screenRoute('purchase_bill.list', 'purchase-bills/:id', () => import('./screens/purchase-bill.document.config')),
];
