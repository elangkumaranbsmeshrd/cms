import { CalendarEventTypeOption, CalendarScreenConfig } from '../../../shared/screens/screen.types';
import { HolidayRow } from '../masters.api';

// Raw enum on the wire (masters_simple.py:99 — MANDATORY | OPTIONAL), with the
// prototype's own colouring (app-screens.js:459: Mandatory -> b-danger,
// Optional -> the calmer b-outline) reproduced via an explicit badgeClass —
// cell-format's shared badgeClass() has no entry for 'optional' at all, so
// leaving it off here would silently fall through to the neutral default.
const HOLIDAY_TYPE_OPTIONS: readonly CalendarEventTypeOption[] = [
  { value: 'MANDATORY', label: 'Mandatory', badgeClass: 'b-danger' },
  { value: 'OPTIONAL', label: 'Optional', badgeClass: 'b-outline' },
];

// Audit fix (Masters §4.3): the prototype's masters.holidays is
// `type: 'calendar'` (data.js:1526), rendered by R.calendar (app-screens.js:
// 444-465) as a month-grid of holiday cards with a Calendar/List switcher —
// not a flat table. This screen replaces holidays.list.config.ts, which
// rendered it as a plain ListScreenConfig and has been removed; the shape
// built for exactly this (CalendarScreenConfig / CalendarScreenComponent,
// screen.types.ts:639) already existed but was never routed to. See
// masters.routes.ts's masters.holidays block for the routing switch.
const config: CalendarScreenConfig<HolidayRow> = {
  shape: 'calendar',
  id: 'masters.holidays',
  title: 'Holidays',
  specRef: '§3.5',
  recordNoun: 'holiday',
  description:
    'The company holiday calendar. Mandatory holidays are excluded from working-day counts in Leave and Payroll — and they override a working Saturday.',
  endpoint: '/masters/holidays',
  date: (row) => row.holiday_date,
  name: (row) => row.name,
  type: (row) => row.holiday_type,
  typeOptions: HOLIDAY_TYPE_OPTIONS,
  // §3.5 Role Access + the prototype's own two-part gate (`s.editable &&
  // (role === 'superadmin' || role === 'manager')`, app-screens.js:445) —
  // CalendarScreenComponent.canCreate() re-applies the same belt-and-braces
  // check on top of PolicyStore.can(), so a role without the 'edit' RBAC
  // grant sees no Add control even if this flag is left on.
  editable: true,
  createRoute: ['/masters/holidays', 'new'],
  createLabel: 'Add Holiday',
  rowRoute: (row) => ['/masters/holidays', row.id, 'edit'],
  exportable: true,
  emptyText: 'No holidays configured.',
  // KNOWN GAP — Deactivate/Delete are absent, and that is a real §3.5 miss,
  // not a deliberate choice. §3.5's Screen Design asks for "a confirmation
  // pop-up ... before deleting or deactivating a past holiday (that action is
  // available to Super Admin only)", and §3.0 rule 1 gives Super Admin both.
  // The API has both today (DELETE /masters/holidays/{id} returns 204 on an
  // unreferenced row; POST /{id}/deactivate and /{id}/activate exist) — there
  // is simply nowhere on this screen to put the buttons: CalendarScreenConfig
  // declares no rowActions hook at all (only rowRoute, for click-to-edit), and
  // FormScreenConfig.recordActions only navigates (routeFor), so the edit form
  // cannot host them either. The earlier note here read this as prototype
  // parity — R.calendar (app-screens.js:444-465) does only render "+ Add
  // Holiday" and "Bulk Import" — but the prototype is authoritative for looks,
  // not for what a role may do, so parity is not a reason to drop a specified
  // Super-Admin action. Closing it needs two shared-file changes reported to
  // the orchestrator: `rowActions?: readonly RowActionDef<T>[]` on
  // CalendarScreenConfig (screen.types.ts), rendered per cal-day card and per
  // list row by calendar-screen.component.ts under the same
  // policy.can(id, screenAction) filter ListScreenComponent.visibleActions
  // already applies. Once that exists this config adds Activate / Deactivate /
  // Delete on screenAction 'delete'. §3.5's partial-deletion rule ("deletable
  // until a Payroll run covers its date") additionally needs the backend to
  // expose `used_in_processed_payroll` on the row — the column exists, the
  // lookup factory's field list does not include it.
  //
  // Bulk Import (MASTERS-COMPLETION-PROMPT.md §2) — a route, not an endpoint
  // POST: SecondaryActionDef.route navigates instead of firing an empty POST
  // (calendar-screen.component.ts's runSecondary), which is exactly what a
  // file-upload/parse screen needs. Gated by the same 'import' RBAC action
  // the real endpoint checks (backend/app/rbac/registry/screens.py), so this
  // button's visibility can never drift from what the API actually allows.
  secondaryActions: [{ label: 'Bulk Import', icon: 'upload', route: ['/masters/holidays/import'], screenAction: 'import' }],
};

export default config;
