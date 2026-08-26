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
  // Deactivate/Delete are deliberately NOT here. The prototype's own
  // masters.holidays definition carries no rowActions at all, and R.calendar's
  // renderer (app-screens.js:444-465) never emits a per-row destructive
  // control on either the calendar-grid cards or the list-view rows — only
  // "+ Add Holiday" and "Bulk Import" exist as page actions
  // (app-screens.js:446-447). The superseded ListScreenConfig this replaces
  // had added a Deactivate and a Delete row action beyond what the prototype
  // ever offered; CalendarScreenConfig has no rowActions hook at all (only
  // rowRoute, for click-to-edit), so moving to the shape the prototype
  // actually specifies restores exact parity rather than requiring a
  // separate removal step.
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
