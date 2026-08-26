import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { HsnSacCodeRow } from '../masters.api';

// The real write schema for this lookup (build_lookup_router's write_schema,
// generated from masters_simple.py's field dict) is code, code_type,
// description, linked_tax_head_id, is_custom, custom_gst_type and
// custom_gst_rate_pct. masters.api.ts's HsnSacCodeRow declares only the first
// three, so the four Linked Tax fields — the whole subject of §3.11 — had no
// way to be typed here. Extended locally rather than in masters.api.ts, which
// another owner holds this pass; see the batch report.
interface HsnSacFormRow extends HsnSacCodeRow {
  linked_tax_head_id: string | null;
  is_custom: boolean;
  custom_gst_type: string | null;
  custom_gst_rate_pct: number | null;
}

// §3.11: Linked Tax is "built live from whatever heads currently exist in
// Taxes" — a real dropdown off the Taxes endpoint, never a fixed label. The
// identifying field on a tax head is tax_name, not RefDataService's default
// 'name'. The server re-checks the choice on write (_hsn_sac_before_write):
// the head must exist, be Sales/Billing or Purchase scope, and be in force
// today, or the save comes back 422 with that reason.
const TAX_HEAD_REF = { endpoint: '/masters/taxes', labelKey: 'tax_name' };

// Values are the two-letter codes the column is typed for (code_type is
// String(3)); labels are the prototype's own option strings (app-forms.js
// 'm.hsn'), SAC first because §3.11 says most entries will be SAC codes.
const CODE_TYPE_OPTIONS = [
  { value: 'SAC', label: 'SAC – Services' },
  { value: 'HSN', label: 'HSN – Goods' },
];

// The same two members TaxHead.tax_type uses for its GST heads
// (taxes.form.config.ts, tax_engine.py) — §3.11: the custom fallback "matches
// the same two types every configured GST head already uses".
const GST_TYPE_OPTIONS = [
  { value: 'GST_IGST', label: 'GST — IGST' },
  { value: 'GST_CGST_SGST', label: 'GST — CGST + SGST' },
];

// §3.11's Fields Table has a final "Status (Active/Inactive)" toggle
// (app-forms.js). §3b built it as `createOnly` — settable only when adding a
// new code (masters_lookup.py's create_only_fields). Once a row exists,
// Status only moves through the list screen's Super-Admin-only Deactivate/
// Activate row actions (§4a).
const config: FormScreenConfig<HsnSacFormRow> = {
  shape: 'form',
  id: 'masters.hsn_sac_codes',
  title: 'HSN / SAC Code',
  listEndpoint: '/masters/hsn-sac-codes',
  createEndpoint: '/masters/hsn-sac-codes',
  updateEndpoint: (id) => `/masters/hsn-sac-codes/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/hsn-sac-codes'],
  emptyRow: () => ({
    code: '',
    code_type: 'SAC',
    description: '',
    linked_tax_head_id: null,
    is_custom: false,
    custom_gst_type: null,
    custom_gst_rate_pct: null,
    is_active: true,
  }),
  fields: [
    {
      key: 'code',
      label: 'Code',
      required: true,
      placeholder: 'e.g. 998314',
      hint: 'Numeric; typically 4–8 digits; must be unique',
      // Only the part §3.11 states flatly ("Numeric") is enforced client-side —
      // the digit count is "typically 4–8", and the column itself is String(20)
      // with no server-side length rule, so blocking on it would reject codes
      // the API accepts.
      pattern: { re: /^\d+$/, message: 'Digits only — no spaces or letters.' },
    },
    {
      key: 'code_type',
      label: 'Type',
      type: 'select',
      required: true,
      staticOptions: CODE_TYPE_OPTIONS,
      hint: 'Mostly SAC, since Meshrd is primarily a services company',
    },
    {
      key: 'description',
      label: 'Description',
      required: true,
      span: 2,
      placeholder: 'e.g. Information technology consulting and support services',
    },
    {
      // The prototype offers "— Custom —" as an extra option inside the Linked
      // Tax dropdown; the backend models it as its own is_custom flag, so it is
      // its own control here. It has to come before the two fields it governs —
      // and before Linked Tax, which it replaces.
      key: 'is_custom',
      label: 'Use a one-off custom rate',
      type: 'checkbox',
      hint: 'Only when the rate this code needs genuinely is not configured in Taxes yet. A custom rate is not saved as a reusable tax head — if the same rate recurs, add it properly in Taxes and link to it like any other code.',
    },
    {
      key: 'linked_tax_head_id',
      label: 'Linked Tax',
      type: 'select',
      ref: TAX_HEAD_REF,
      // Hidden fields are not submitted (FormScreenComponent.save), so ticking
      // the custom flag clears any existing link on save — which is what §3.11
      // means by Custom being the alternative to a linked head.
      visibleWhen: (formModel) => !formModel['is_custom'],
      hint: 'Every in-force Sales/Billing or Purchase tax head from Masters → Taxes — a real, editable rate, never a fixed label. Two codes can carry two different types (IGST vs. CGST + SGST). Optional: the list it draws from may legitimately be empty. To change the rate later, edit the tax head in Taxes, not this field.',
    },
    {
      key: 'custom_gst_type',
      label: 'Custom GST Type',
      type: 'select',
      staticOptions: GST_TYPE_OPTIONS,
      // §3.11: "Conditional — required if Linked Tax is '— Custom —'". save()
      // only enforces `required` on fields that are actually visible, so this
      // is required exactly when the custom flag is on.
      required: true,
      visibleWhen: (formModel) => !!formModel['is_custom'],
      hint: 'The same two types every configured GST head already uses — interstate vs. intrastate',
    },
    {
      key: 'custom_gst_rate_pct',
      label: 'Custom GST Rate (%)',
      type: 'number',
      required: true,
      visibleWhen: (formModel) => !!formModel['is_custom'],
      placeholder: 'e.g. 18',
      hint: 'The one-off rate itself, for this code alone',
    },
    {
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: "Defaults to Active. Uncheck to create this code already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
