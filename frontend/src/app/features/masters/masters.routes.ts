import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

// Each lookup gets 3 routes on the SAME RBAC screen id: the list, and two
// routes both loading the SAME form config module — 'new' (create mode,
// no :id) and ':id/edit' (edit mode). masters_lookup.py's generic factory
// has no GET-by-id endpoint at all, which is why these are 'form'-shape,
// not 'record'-shape, screens (see FormScreenConfig's own doc comment).
//
// Holidays is deliberately NOT here — its financial_year_id is a required
// FK and Financial Year has no screen built yet to source a value from.
export const mastersRoutes: Routes = [
  // :id/edit reuses the create form's config — Financial Year has no PUT
  // endpoint at all, so form-screen.component.ts's isReadOnlyRecord() detects
  // that (no updateEndpoint) and renders it as a read-only "View" instead.
  // Status still only ever moves via the list screen's own row actions.
  screenRoute('masters.financial_year', 'masters/financial-years', () => import('./screens/financial-years.list.config')),
  screenRoute('masters.financial_year', 'masters/financial-years/new', () => import('./screens/financial-years.form.config')),
  screenRoute('masters.financial_year', 'masters/financial-years/:id/edit', () => import('./screens/financial-years.form.config')),

  // §3.2's tabs group heads by attachment point (Billing / Purchase / Payroll /
  // Withholding / Where Used), which is how the prototype presents it and how
  // people actually ask the question.
  screenRoute('masters.taxes', 'masters/taxes', () => import('./screens/taxes.tabbed.config')),
  screenRoute('masters.taxes', 'masters/taxes/new', () => import('./screens/taxes.form.config')),
  screenRoute('masters.taxes', 'masters/taxes/:id/edit', () => import('./screens/taxes.form.config')),
  // §6b — Tax Schemes: its own resource (/masters/tax-schemes), its own
  // standalone routes, same "tab embeds the list config, the form returns to
  // the list config's own route" shape saturday-overrides/pay-cycles use.
  screenRoute('masters.taxes', 'masters/taxes/schemes', () => import('./screens/tax-schemes.list.config')),
  screenRoute('masters.taxes', 'masters/taxes/schemes/new', () => import('./screens/tax-schemes.form.config')),
  screenRoute('masters.taxes', 'masters/taxes/schemes/:id/edit', () => import('./screens/tax-schemes.form.config')),
  // §6a — Slab Bands / Split Components / Relief Rules, moved out of the Tax
  // Head form's own inline arrayFields into their own screens (masters.
  // taxes.slab / .split / .relief in the prototype), reached from
  // recordActions buttons on an existing head's edit page. Not screenRoute()
  // — TaxHeadChildScreenComponent takes a per-screen ArrayFieldConfig, not a
  // ScreenConfig, the same "bespoke, not one of the 14 generic shapes"
  // reasoning as the Holidays Bulk Import route below. `resolve: { config }`
  // still binds via withComponentInputBinding() (app.config.ts) exactly like
  // screenRoute()'s own config resolution does for ScreenHostComponent.
  {
    path: 'masters/taxes/:id/slab-bands',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('masters.taxes')],
    data: { screenId: 'masters.taxes', screenPath: 'masters/taxes/:id/slab-bands' },
    resolve: { config: () => import('./screens/taxes.slab-bands.config').then((m) => m.default) },
    loadComponent: () => import('./screens/tax-head-child-screen.component').then((m) => m.TaxHeadChildScreenComponent),
  },
  {
    path: 'masters/taxes/:id/split-components',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('masters.taxes')],
    data: { screenId: 'masters.taxes', screenPath: 'masters/taxes/:id/split-components' },
    resolve: { config: () => import('./screens/taxes.split-components.config').then((m) => m.default) },
    loadComponent: () => import('./screens/tax-head-child-screen.component').then((m) => m.TaxHeadChildScreenComponent),
  },
  {
    path: 'masters/taxes/:id/relief-rules',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('masters.taxes')],
    data: { screenId: 'masters.taxes', screenPath: 'masters/taxes/:id/relief-rules' },
    resolve: { config: () => import('./screens/taxes.relief-rules.config').then((m) => m.default) },
    loadComponent: () => import('./screens/tax-head-child-screen.component').then((m) => m.TaxHeadChildScreenComponent),
  },

  // The tabbed record IS the screen (Server Settings / Templates / Recent
  // Sends are its tabs). The child routes below stay reachable for deep links
  // and for the add/edit forms the tabs' own "+ Add" buttons navigate to.
  screenRoute('masters.email_configuration', 'masters/email-configuration', () => import('./screens/email-configuration.tabbed.config')),
  screenRoute('masters.email_configuration', 'masters/email-configuration/templates', () => import('./screens/email-templates.list.config')),
  screenRoute('masters.email_configuration', 'masters/email-configuration/templates/new', () => import('./screens/email-templates.form.config')),
  screenRoute('masters.email_configuration', 'masters/email-configuration/templates/:id/edit', () => import('./screens/email-templates.form.config')),
  screenRoute('masters.email_configuration', 'masters/email-configuration/recent-sends', () => import('./screens/email-recent-sends.list.config')),

  // Policies / Pay Cycle / Saturday Overrides are one RBAC screen key and now
  // one tabbed screen; /policies redirects into it in app.routes via the nav.
  screenRoute('masters.work_week_hours', 'masters/work-week-hours', () => import('./screens/work-week.tabbed.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/policies', () => import('./screens/work-week-policies.list.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/policies/new', () => import('./screens/work-week-policies.form.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/policies/:id/edit', () => import('./screens/work-week-policies.form.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/pay-cycles', () => import('./screens/pay-cycles.list.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/pay-cycles/new', () => import('./screens/pay-cycles.form.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/saturday-overrides', () => import('./screens/saturday-overrides.list.config')),
  screenRoute('masters.work_week_hours', 'masters/work-week-hours/saturday-overrides/new', () => import('./screens/saturday-overrides.form.config')),

  // General Info / Addresses / Bank Details / Number Prefixes as tabs.
  screenRoute('masters.company_profile', 'masters/company-profile', () => import('./screens/company-profile.tabbed.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/addresses', () => import('./screens/company-addresses.list.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/addresses/new', () => import('./screens/company-addresses.form.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/addresses/:id/edit', () => import('./screens/company-addresses.form.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/prefix-rules', () => import('./screens/number-prefix-rules.list.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/prefix-rules/new', () => import('./screens/number-prefix-rules.form.config')),
  screenRoute('masters.company_profile', 'masters/company-profile/prefix-rules/:id/edit', () => import('./screens/number-prefix-rules.form.config')),

  screenRoute('masters.bank_accounts', 'masters/bank-accounts', () => import('./screens/bank-accounts.list.config')),
  screenRoute('masters.bank_accounts', 'masters/bank-accounts/new', () => import('./screens/bank-accounts.form.config')),
  screenRoute('masters.bank_accounts', 'masters/bank-accounts/:id/edit', () => import('./screens/bank-accounts.form.config')),

  // Masters §4.3 audit fix: the prototype's masters.holidays is
  // `type: 'calendar'` (data.js:1526), not a flat list — routed at the
  // purpose-built calendar shape instead of a ListScreenConfig. See
  // holidays.calendar.config.ts's own header comment for the full history.
  screenRoute('masters.holidays', 'masters/holidays', () => import('./screens/holidays.calendar.config')),
  screenRoute('masters.holidays', 'masters/holidays/new', () => import('./screens/holidays.form.config')),
  screenRoute('masters.holidays', 'masters/holidays/:id/edit', () => import('./screens/holidays.form.config')),
  // Bespoke, not screenRoute() — none of the 14 generic shapes handle a
  // client-side file upload/parse, so this is a real standalone component
  // rather than a config module. `data: { screenId }` is set by hand so the
  // breadcrumb trail (which scans ALL routes' `data.screenId`, not only ones
  // registered via screenRoute) still finds it. MASTERS-COMPLETION-PROMPT.md §2.
  {
    path: 'masters/holidays/import',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('masters.holidays')],
    data: { screenId: 'masters.holidays', screenPath: 'masters/holidays/import' },
    loadComponent: () => import('./screens/holidays-import.component').then((m) => m.HolidaysImportComponent),
  },

  screenRoute('masters.departments', 'masters/departments', () => import('./screens/departments.list.config')),
  screenRoute('masters.departments', 'masters/departments/new', () => import('./screens/departments.form.config')),
  screenRoute('masters.departments', 'masters/departments/:id/edit', () => import('./screens/departments.form.config')),

  screenRoute('masters.designations', 'masters/designations', () => import('./screens/designations.list.config')),
  screenRoute('masters.designations', 'masters/designations/new', () => import('./screens/designations.form.config')),
  screenRoute('masters.designations', 'masters/designations/:id/edit', () => import('./screens/designations.form.config')),

  screenRoute('masters.expense_types', 'masters/expense-types', () => import('./screens/expense-types.list.config')),
  screenRoute('masters.expense_types', 'masters/expense-types/new', () => import('./screens/expense-types.form.config')),
  screenRoute('masters.expense_types', 'masters/expense-types/:id/edit', () => import('./screens/expense-types.form.config')),

  screenRoute('masters.leave_types', 'masters/leave-types', () => import('./screens/leave-types.list.config')),
  screenRoute('masters.leave_types', 'masters/leave-types/new', () => import('./screens/leave-types.form.config')),
  screenRoute('masters.leave_types', 'masters/leave-types/:id/edit', () => import('./screens/leave-types.form.config')),

  screenRoute('masters.payment_modes', 'masters/payment-modes', () => import('./screens/payment-modes.list.config')),
  screenRoute('masters.payment_modes', 'masters/payment-modes/new', () => import('./screens/payment-modes.form.config')),
  screenRoute('masters.payment_modes', 'masters/payment-modes/:id/edit', () => import('./screens/payment-modes.form.config')),

  screenRoute('masters.hsn_sac_codes', 'masters/hsn-sac-codes', () => import('./screens/hsn-sac-codes.list.config')),
  screenRoute('masters.hsn_sac_codes', 'masters/hsn-sac-codes/new', () => import('./screens/hsn-sac-codes.form.config')),
  screenRoute('masters.hsn_sac_codes', 'masters/hsn-sac-codes/:id/edit', () => import('./screens/hsn-sac-codes.form.config')),

  screenRoute('masters.service_categories', 'masters/service-categories', () => import('./screens/service-categories.list.config')),
  screenRoute('masters.service_categories', 'masters/service-categories/new', () => import('./screens/service-categories.form.config')),
  screenRoute('masters.service_categories', 'masters/service-categories/:id/edit', () => import('./screens/service-categories.form.config')),

  screenRoute('masters.units_of_measure', 'masters/units-of-measure', () => import('./screens/units-of-measure.list.config')),
  screenRoute('masters.units_of_measure', 'masters/units-of-measure/new', () => import('./screens/units-of-measure.form.config')),
  screenRoute('masters.units_of_measure', 'masters/units-of-measure/:id/edit', () => import('./screens/units-of-measure.form.config')),

  screenRoute('masters.ticket_categories', 'masters/ticket-categories', () => import('./screens/ticket-categories.list.config')),
  screenRoute('masters.ticket_categories', 'masters/ticket-categories/new', () => import('./screens/ticket-categories.form.config')),
  screenRoute('masters.ticket_categories', 'masters/ticket-categories/:id/edit', () => import('./screens/ticket-categories.form.config')),

  screenRoute('masters.customer_statuses', 'masters/customer-statuses', () => import('./screens/customer-statuses.list.config')),
  screenRoute('masters.customer_statuses', 'masters/customer-statuses/new', () => import('./screens/customer-statuses.form.config')),
  screenRoute('masters.customer_statuses', 'masters/customer-statuses/:id/edit', () => import('./screens/customer-statuses.form.config')),

  screenRoute('masters.customer_sources', 'masters/customer-sources', () => import('./screens/customer-sources.list.config')),
  screenRoute('masters.customer_sources', 'masters/customer-sources/new', () => import('./screens/customer-sources.form.config')),
  screenRoute('masters.customer_sources', 'masters/customer-sources/:id/edit', () => import('./screens/customer-sources.form.config')),

  screenRoute('masters.asset_categories', 'masters/asset-categories', () => import('./screens/asset-categories.list.config')),
  screenRoute('masters.asset_categories', 'masters/asset-categories/new', () => import('./screens/asset-categories.form.config')),
  screenRoute('masters.asset_categories', 'masters/asset-categories/:id/edit', () => import('./screens/asset-categories.form.config')),

  screenRoute('masters.employment_types', 'masters/employment-types', () => import('./screens/employment-types.list.config')),
  screenRoute('masters.employment_types', 'masters/employment-types/new', () => import('./screens/employment-types.form.config')),
  screenRoute('masters.employment_types', 'masters/employment-types/:id/edit', () => import('./screens/employment-types.form.config')),

  screenRoute('masters.insurance_plans', 'masters/insurance-plans', () => import('./screens/insurance-plans.list.config')),
  screenRoute('masters.insurance_plans', 'masters/insurance-plans/new', () => import('./screens/insurance-plans.form.config')),
  screenRoute('masters.insurance_plans', 'masters/insurance-plans/:id/edit', () => import('./screens/insurance-plans.form.config')),
];
