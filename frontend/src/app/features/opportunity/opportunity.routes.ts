import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// Opportunity module. Every write action is 'edit' — RBAC registry:
// "opportunity.pipeline": ScreenDef(has_scope=False, actions=("edit",)).
// There is no create/delete/approve action anywhere in this module; List,
// Board, New, Edit and Record all gate on the same single screen key.
//
// Pipeline is split into TWO routes over that one key: 'opportunities' (the
// table, canonical — plain screenRoute() onto a ListScreenConfig) and
// 'opportunities/board' (the stage-summary board — bespoke wrapper, see
// opportunity.board.component.ts's own header comment for why BoardScreenConfig
// itself can't carry a "Table View" link). New/:id/edit share ONE
// FormScreenConfig module, same convention as masters.routes.ts's own
// taxes.form.config.ts reuse ('masters/taxes/new' and 'masters/taxes/:id/edit'
// both point at the same import). :id is bespoke (OpportunityRecordComponent)
// — see that component's own header comment for why neither 'record' nor
// 'tabbed' fits.
//
// Ordering is load-bearing (screen-route.ts's own doc, and ticket.routes.ts/
// asset.routes.ts's identical reasoning): 'opportunities/board' and
// 'opportunities/new' are both literal two-segment paths and MUST precede
// 'opportunities/:id' (also two segments) — Angular's router matches Route
// array entries in DECLARATION ORDER, not by specificity, so if ':id' came
// first it would swallow /opportunities/board and /opportunities/new (id
// would resolve to the literal string "board"/"new"). 'opportunities/:id/edit'
// and 'opportunities/:id/lost' (three segments each) never collide with the
// two-segment ':id' route regardless of order.
export const opportunityRoutes: Routes = [
  screenRoute('opportunity.pipeline', 'opportunities', () => import('./screens/opportunity.pipeline.list.config')),
  {
    path: 'opportunities/board',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('opportunity.pipeline')],
    data: { screenId: 'opportunity.pipeline', screenPath: 'opportunities/board' },
    loadComponent: () => import('./screens/opportunity.board.component').then((m) => m.OpportunityBoardComponent),
  },
  screenRoute('opportunity.pipeline', 'opportunities/new', () => import('./screens/opportunity.form.config')),
  screenRoute('opportunity.pipeline', 'opportunities/:id/edit', () => import('./screens/opportunity.form.config')),
  // Opportunity §2.2 — "Mark Opportunity Lost" (app-forms.js's 'o.lost'),
  // reached from the "Mark Lost" record action on the Add/Edit form above.
  // Bespoke for the same reason opportunities/board and opportunities/:id
  // are: no generic shape has a slot for this (see
  // opportunity.lost.component.ts's own header comment).
  {
    path: 'opportunities/:id/lost',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('opportunity.pipeline')],
    data: { screenId: 'opportunity.pipeline', screenPath: 'opportunities/:id/lost' },
    loadComponent: () => import('./screens/opportunity.lost.component').then((m) => m.OpportunityLostComponent),
  },
  {
    path: 'opportunities/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('opportunity.pipeline')],
    data: { screenId: 'opportunity.pipeline', screenPath: 'opportunities/:id' },
    loadComponent: () => import('./screens/opportunity.record.component').then((m) => m.OpportunityRecordComponent),
  },
];
