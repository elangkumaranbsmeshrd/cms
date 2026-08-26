import { FieldConfig, FormScreenConfig } from '../../../shared/screens/screen.types';
import { OPPORTUNITY_CUSTOMER_REF, OPPORTUNITY_OWNER_REF, OPPORTUNITY_STAGE_OPTIONS, OpportunityRow } from '../opportunity.api';

// Add / Edit Opportunity. Same shape already used for other non-trivial
// business objects with no GET-by-id endpoint the 'form' shape can call
// (masters.taxes is the reference case) — Opportunity DOES have a real GET
// /opportunities/{id}, but the 'form' shape has no slot to use a by-id GET
// at all, so edit mode uses the same "re-fetch the whole list, find by id"
// fallback via listEndpoint below. Accepted trade-off, not an oversight.
//
// Probability auto-suggestion (GET /opportunities/probability-suggestion?
// stage=X on Stage change) is deliberately NOT wired here: FieldConfig has
// no onChange-style hook at all (checked screen.types.ts in full — key,
// label, type, compute, ref, staticOptions, editable, createOnly, required,
// hint, placeholder, span, section, pattern, visibleWhen, hideWhenRefEmpty,
// hideWhenNoSecondary, uploadPurpose, fileAccept — nothing fires on a field
// changing), and form-screen.component.ts's <select> binds
// [(ngModel)]="formModel[field.key]" with no (ngModelChange) exposed to a
// config either. Wiring it would mean editing that shared component, out of
// this module's scope. Shipped as a plain editable field instead — a
// deliberate, brief-sanctioned simplification, not a gap.
const whenLost = (form: Record<string, unknown>) => form['stage'] === 'LOST';

const fields: readonly FieldConfig<OpportunityRow>[] = [
  { key: 'title', label: 'Title', required: true, span: 2 },
  // Prototype (app-screens.js FORMS.opportunity) shows Opportunity Code as a
  // read-only field right after Title — was missing entirely here. Server-
  // generated (allocate_number in opportunities.py's create_opportunity), so
  // there is nothing to show yet in create mode: createOnly renders it as
  // plain read-only text once editing (isEdit() true), and visibleWhen hides
  // it outright in create mode, where emptyRow() below never seeds this key
  // so formModel['opportunity_code'] is undefined. Combining the two is what
  // keeps a brand-new Add form from showing a live, typeable "Opportunity
  // Code" box that does nothing — createOnly alone would still render an
  // empty editable input pre-save.
  { key: 'opportunity_code', label: 'Opportunity Code', createOnly: true, visibleWhen: (form) => !!form['opportunity_code'], hint: 'Auto-generated on save.' },
  { key: 'customer_id', label: 'Customer', type: 'select', required: true, ref: OPPORTUNITY_CUSTOMER_REF },
  { key: 'value', label: 'Value', type: 'number', placeholder: '0', hint: 'Optional. Must be greater than 0 if given.' },
  { key: 'stage', label: 'Stage', type: 'select', required: true, staticOptions: OPPORTUNITY_STAGE_OPTIONS, hint: 'Moving to Won sets Probability to 100% automatically. Moving away from Lost clears the Lost Reason below.' },
  { key: 'probability_pct', label: 'Probability (%)', type: 'number', placeholder: '0', hint: 'Optional, 0-100.' },
  { key: 'expected_close_date', label: 'Expected Close Date', type: 'date' },
  { key: 'owner_id', label: 'Owner', type: 'select', ref: OPPORTUNITY_OWNER_REF },
  {
    key: 'lost_reason',
    label: 'Lost Reason',
    type: 'textarea',
    span: 2,
    required: true,
    visibleWhen: whenLost,
    hint: 'Required whenever Stage is Lost. Cleared automatically the moment Stage moves away from Lost — FormScreenComponent drops a hidden field from the request entirely, matching what the backend also does server-side. The prototype (app-forms.js’s dedicated ‘o.lost’ form) captures this on its own confirmation screen instead — see the ‘Mark Lost’ record action below, which is the prototype-matching path; this inline field stays as a safety net so choosing Lost here can never dead-end on an un-fixable 422.',
  },
  { key: 'description', label: 'Description', type: 'textarea', span: 2 },
];

const config: FormScreenConfig<OpportunityRow> = {
  shape: 'form',
  id: 'opportunity.pipeline',
  title: 'Opportunity',
  listEndpoint: '/opportunities',
  createEndpoint: '/opportunities',
  updateEndpoint: (id) => `/opportunities/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/opportunities'],
  recordLabel: (row) => row.title,
  emptyRow: () => ({
    // customer_id is a required, non-nullable string on OpportunityRow (it's
    // always present on a real GET row) — '' is the "not yet chosen" default
    // for a required field, matching every other required-string field's own
    // emptyRow convention in this codebase (e.g. taxes.form.config.ts's own
    // tax_name/applies_from). null is reserved for genuinely nullable fields
    // below.
    title: '',
    customer_id: '',
    stage: 'PROSPECTING',
    value: null,
    probability_pct: null,
    expected_close_date: null,
    owner_id: null,
    lost_reason: null,
    description: null,
  }),
  fields,
  // §3 of the brief this was built against: lands a newly created
  // Opportunity straight on its own Record screen rather than back on the
  // table — onCreateSuccess is only ever consulted on the CREATE branch
  // (form-screen.component.ts's save(), never on an edit save).
  onCreateSuccess: (response) => ['/opportunities', response.id],
  // Prototype's FORMS.opportunity button row is Save / Mark Lost / Cancel
  // (app-screens.js:237) — a THIRD button beside Save/Cancel, which this
  // shape has no slot for (form-screen.component.ts's card-foot is hardcoded
  // to Save/Cancel only, same limitation taxes.form.config.ts's own
  // recordActions doc already documents). recordActions is the sanctioned
  // escape hatch for exactly this — "a button to a child resource's own
  // screen, edit-mode only" — reused here for the dedicated Mark-Lost
  // confirmation (o.lost in app-forms.js) instead of a literal child list.
  // Edit-mode only matches the prototype too: there is no opportunity id to
  // mark Lost until the record exists.
  recordActions: [{ label: 'Mark Lost', routeFor: (id) => ['/opportunities', id, 'lost'] }],
};

export default config;
