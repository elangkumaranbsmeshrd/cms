import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// §2.1-2.5 Ticket module. List/New/Edit/Detail/Reassign/Close all share the
// 'ticket.list' RBAC screen key (has_scope, actions: create/reassign/close —
// app/rbac/registry/screens.py); Support Reports is a SEPARATE key
// ('ticket.reports', zero actions). New/Edit/Detail/Reassign/Close are
// bespoke, not screenRoute() — see each component's own header comment for
// why neither FormScreenConfig nor RecordScreenConfig fits Ticket's shape —
// so these are hand-written Route objects, same convention as masters.
// routes.ts's tax-head-child routes and rbac.routes.ts's matrix/overrides
// routes.
//
// Ordering is load-bearing: 'tickets/new' and 'tickets/reports' MUST be
// declared before 'tickets/:id' — all three are exactly two path segments,
// and Angular's router matches Route array entries in DECLARATION ORDER, not
// by specificity (screen-route.ts's own comment makes the same point about
// canMatch redirects). If 'tickets/:id' came first, it would swallow the
// literal URLs /tickets/new and /tickets/reports (id would resolve to the
// string "new"/"reports"), and the Detail component's GET /tickets/new (or
// /tickets/reports) would 404. 'tickets/:id/edit', 'tickets/:id/reassign' and
// 'tickets/:id/close' are unambiguous regardless of order — three segments
// never collide with the two-segment 'tickets/:id'.
export const ticketRoutes: Routes = [
  screenRoute('ticket.list', 'tickets', () => import('./screens/ticket.list.config')),
  {
    path: 'tickets/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.list')],
    data: { screenId: 'ticket.list', screenPath: 'tickets/new' },
    loadComponent: () => import('./screens/ticket.form.component').then((m) => m.TicketFormComponent),
  },
  {
    path: 'tickets/reports',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.reports')],
    data: { screenId: 'ticket.reports', screenPath: 'tickets/reports' },
    loadComponent: () => import('./screens/ticket.reports.component').then((m) => m.TicketReportsComponent),
  },
  {
    path: 'tickets/:id/edit',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.list')],
    data: { screenId: 'ticket.list', screenPath: 'tickets/:id/edit' },
    loadComponent: () => import('./screens/ticket.form.component').then((m) => m.TicketFormComponent),
  },
  {
    path: 'tickets/:id/reassign',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.list')],
    data: { screenId: 'ticket.list', screenPath: 'tickets/:id/reassign' },
    loadComponent: () => import('./screens/ticket.reassign.component').then((m) => m.TicketReassignComponent),
  },
  {
    // §2.3 t.close — navHidden in the prototype, reached only from Ticket
    // Detail's own "Close ticket" button / status select (ticket.detail.
    // component.ts's openClose()/onStatusSelect()), never a nav item or a
    // List row action.
    path: 'tickets/:id/close',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.list')],
    data: { screenId: 'ticket.list', screenPath: 'tickets/:id/close' },
    loadComponent: () => import('./screens/ticket.close.component').then((m) => m.TicketCloseComponent),
  },
  {
    path: 'tickets/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('ticket.list')],
    data: { screenId: 'ticket.list', screenPath: 'tickets/:id' },
    loadComponent: () => import('./screens/ticket.detail.component').then((m) => m.TicketDetailComponent),
  },
];
