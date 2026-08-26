import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// Module 15 — Tax & Compliance. Wired into app.routes.ts (`...complianceRoutes`)
// and nav-registry.ts (the 'taxcompliance' group) — confirmed during the
// Stage 14 audit; an earlier version of this comment claimed otherwise.
export const complianceRoutes: Routes = [
  // Bespoke, no ScreenConfig to resolve — §2.1's OverviewOut nests its two
  // arrays inside one object response, which neither the `dashboard` nor
  // `report` shape can render (both need Array.isArray() on a raw top-level
  // fetch) — see compliance.overview.component.ts's own doc comment.
  {
    path: 'compliance/overview',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('compliance.overview')],
    data: { screenId: 'compliance.overview', screenPath: 'compliance/overview' },
    loadComponent: () => import('./screens/compliance.overview.component').then((m) => m.ComplianceOverviewComponent),
  },

  screenRoute('compliance.obligations', 'compliance/obligations', () => import('./screens/compliance.obligations.list.config')),
  screenRoute('compliance.obligations_by_document', 'compliance/obligations/by-document', () => import('./screens/compliance.obligations-by-document.list.config')),

  screenRoute('compliance.remittances', 'compliance/remittances', () => import('./screens/compliance.remittances.list.config')),
  // Bespoke, no ScreenConfig to resolve — reached from Obligations' own row
  // click, pre-scoped to one (tax head, period) via 3 route params.
  {
    path: 'compliance/remittances/record/:taxHeadId/:periodFrom/:periodTo',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('compliance.remittances')],
    data: { screenId: 'compliance.remittances', screenPath: 'compliance/remittances/record/:taxHeadId/:periodFrom/:periodTo' },
    loadComponent: () => import('./screens/compliance.remittances-record.component').then((m) => m.ComplianceRemittanceRecordComponent),
  },

  screenRoute('compliance.credits', 'compliance/credits', () => import('./screens/compliance.credits.list.config')),

  screenRoute('compliance.certificates', 'compliance/certificates', () => import('./screens/compliance.certificates.list.config')),
  // Bespoke, no ScreenConfig to resolve — §2.8's Receipts Covered picker and
  // live Variance computation don't fit FormScreenConfig's flat field list.
  {
    path: 'compliance/certificates/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('compliance.certificates')],
    data: { screenId: 'compliance.certificates', screenPath: 'compliance/certificates/new' },
    loadComponent: () => import('./screens/compliance.certificates-log.component').then((m) => m.ComplianceCertificateLogComponent),
  },
  // Bespoke, no ScreenConfig to resolve — reached from the Certificates
  // list's own row click (no per-row "already claimed" boolean exists to
  // gate a RowActionDef on, see compliance.certificates.list.config.ts).
  {
    path: 'compliance/certificates/:id/claim',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('compliance.certificates')],
    data: { screenId: 'compliance.certificates', screenPath: 'compliance/certificates/:id/claim' },
    loadComponent: () => import('./screens/compliance.certificates-claim.component').then((m) => m.ComplianceCertificateClaimComponent),
  },
];
