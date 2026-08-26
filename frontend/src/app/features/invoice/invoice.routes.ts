import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// §2 Invoice module. Dashboard/List/New/Edit/Send/Record Payment all live
// under invoice.list except the Dashboard itself (app/rbac/registry/
// screens.py has exactly three keys for this module: invoice.dashboard,
// invoice.list, credit_note.list — there is no separate invoice.detail key,
// so New/Edit Invoice both gate on invoice.list, same screenRoute() config
// module for both routes since DocumentScreenComponent itself branches on
// whether :id is present, exactly like FormScreenComponent already does for
// its own create-vs-edit routes).
//
// Ordering is load-bearing (screen-route.ts's own comment; matches
// ticket.routes.ts's identical note): 'invoices/dashboard' and 'invoices/new'
// MUST be declared before 'invoices/:id' — all three are exactly two path
// segments, and Angular's router matches Route array entries in DECLARATION
// ORDER, not by specificity. If 'invoices/:id' came first, it would swallow
// the literal URLs /invoices/dashboard and /invoices/new (id would resolve
// to the string "dashboard"/"new"), and the document screen's own GET
// /invoices/dashboard (or /invoices/new) would 404. The three-segment routes
// ('invoices/:id/record-payment', 'invoices/:invoiceId/credit-note') are
// unambiguous regardless of order — they never collide with the two-segment
// 'invoices/:id'. 'credit-notes' vs 'credit-notes/:id' likewise never
// collide with each other or with anything under 'invoices/*' (different
// first path segment entirely).
export const invoiceRoutes: Routes = [
  screenRoute('invoice.list', 'invoices', () => import('./screens/invoice.list.config')),
  {
    path: 'invoices/dashboard',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('invoice.dashboard')],
    data: { screenId: 'invoice.dashboard', screenPath: 'invoices/dashboard' },
    loadComponent: () => import('./screens/invoice.dashboard.component').then((m) => m.InvoiceDashboardComponent),
  },
  screenRoute('invoice.list', 'invoices/new', () => import('./screens/invoice.document.config')),
  {
    // Param named :invoiceId, NOT :id — CreditNoteDetailComponent branches on
    // which of the two route params is present (see its own header comment);
    // this is the CREATE route, reached from Invoice's own Raise Credit Note
    // action, so it needs the PARENT invoice's id under a distinct name from
    // credit-notes/:id's own (the credit note's own id) below.
    path: 'invoices/:invoiceId/credit-note',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('credit_note.list')],
    data: { screenId: 'credit_note.list', screenPath: 'invoices/:invoiceId/credit-note' },
    loadComponent: () => import('./screens/credit-note.detail.component').then((m) => m.CreditNoteDetailComponent),
  },
  {
    path: 'invoices/:id/record-payment',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('invoice.list')],
    data: { screenId: 'invoice.list', screenPath: 'invoices/:id/record-payment' },
    loadComponent: () => import('./screens/invoice.record-payment.component').then((m) => m.InvoiceRecordPaymentComponent),
  },
  screenRoute('invoice.list', 'invoices/:id', () => import('./screens/invoice.document.config')),
  screenRoute('credit_note.list', 'credit-notes', () => import('./screens/credit-note.list.config')),
  {
    // VIEW/submit/approve an existing credit note (param :id — the credit
    // note's own id, unlike the create route's :invoiceId above).
    path: 'credit-notes/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('credit_note.list')],
    data: { screenId: 'credit_note.list', screenPath: 'credit-notes/:id' },
    loadComponent: () => import('./screens/credit-note.detail.component').then((m) => m.CreditNoteDetailComponent),
  },
];
