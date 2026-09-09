import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { EmailTemplateRow } from '../masters.api';

/** The set of modules that actually fire an email is whatever the seeded rows
 * plus any later-added trigger say it is — there is no endpoint listing them
 * and there should not be one, since §3.21's whole point is that "a new
 * module's notification gets a new row here, not a new hardcoded email-sending
 * function". Derived from the rows on screen, so the choices are always
 * exactly the values present. */
function moduleOptions(rows: readonly EmailTemplateRow[]): { value: string; label: string }[] {
  const seen = [...new Set(rows.map((r) => r.triggered_from_module).filter(Boolean))].sort();
  return seen.map((m) => ({ value: m, label: m }));
}

const config: ListScreenConfig<EmailTemplateRow> = {
  shape: 'list',
  id: 'masters.email_configuration',
  title: 'Email Templates',
  specRef: '§3.21',
  recordNoun: 'email template',
  // The prototype's own note on this tab (app-screens2.js:783), minus its
  // inline markup.
  description:
    'Every automatic email this CMS sends is one row here. Switching Enabled to No silences just that trigger — the in-app notification still fires, only its email copy stops. Subject Line supports placeholders like {{first_name}} and {{month}}, filled in per recipient when the email actually sends.',
  endpoint: '/masters/email-configuration/templates',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/email-configuration/templates', row.id, 'edit'],
  createRoute: ['/masters/email-configuration/templates', 'new'],
  // §3.21: "Super Admin can add a row here the moment a future module
  // introduces a new notification." That growth path is what this button is.
  createLabel: 'Add Email Template',
  // The POST this button leads to requires action="create"
  // (masters_email_config.py:172), a distinct grantable action from 'edit' in
  // the RBAC registry (screens.py: masters.email_configuration actions
  // includes both "edit" and "create"). Without this override the button
  // falls back to the default 'edit' gate (screen.types.ts), which is wrong
  // in both directions for a role holding only one of the two.
  createScreenAction: 'create',
  // list_templates takes exactly one query param — `format`. No ?search=, and
  // no ?include_inactive= because a template has no active flag at all:
  // Enabled/Disabled is its entire lifecycle (§3.21 Status & Deletion Rule),
  // and that is the tri-state filter below rather than the shared checkbox.
  searchParam: false,
  // §3.0's "name and code fields" — template_key is this row's code, the
  // stable machine key other modules fire the email by. Subject is included
  // because "which template says {{month}}?" is the real question people ask.
  searchFields: ['template_name', 'template_key', 'subject'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: no ?triggered_from_module= param exists. Options are
      // derived from the loaded rows (see moduleOptions above) — honest for a
      // dimension with no endpoint of its own. It reads the page currently
      // rendered, which with 16 seeded rows and a 50-row page is all of them.
      key: 'triggered_from_module',
      label: 'Triggered From',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Modules',
      optionsFromRows: moduleOptions,
      predicate: (row, v) => (v as readonly string[]).includes(row.triggered_from_module),
    },
    {
      // Client transport: no ?is_enabled= param exists. Invariant 12 is the
      // reason this dimension matters — a disabled row is not a dead row, it
      // is a trigger whose in-app notification still fires without the email.
      key: 'is_enabled',
      label: 'Enabled',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Enabled — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_enabled : !row.is_enabled),
    },
  ],
  // The prototype's own columns and headers (app-screens2.js:785-788).
  columns: [
    { key: 'template_name', header: 'Template Name', cellClass: 'cell-strong' },
    // The prototype's own column type here (app-screens2.js:786 —
    // `{ k: 'category', t: 'Triggered From', type: 'chip' }`), and ColumnType
    // now carries 'chip'. It renders `badge-s b-neutral plain`, i.e. the same
    // neutral badge with the leading status dot suppressed
    // (components.css:335) — right for a module name, which labels the row
    // rather than reporting a state. No staticOptions needed:
    // triggered_from_module is already human-readable text ("Payroll",
    // "Leave"), not an enum.
    { key: 'triggered_from_module', header: 'Triggered From', type: 'chip' },
    { key: 'subject', header: 'Subject Line', cellClass: 'mono' },
    { key: 'is_enabled', header: 'Enabled', type: 'status' },
  ],
  // No row actions, deliberately. §3.21 Status & Deletion Rule: "An Email
  // Template row is never deleted once a trigger exists in the system;
  // Enabled/Disabled is the only lifecycle it has" — and the database enforces
  // it, rejecting DELETE outright with a trigger. There is no deactivate
  // endpoint either; Enabled is toggled on the edit form, not from here.
  defaultPageSize: 50,
  emptyText: 'No email templates found — the 16 starting rows are seeded, so an empty list means seeding has not run.',
};

export default config;
