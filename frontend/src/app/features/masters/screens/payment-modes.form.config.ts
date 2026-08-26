import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { PaymentModeRow } from '../masters.api';

// §3.8's Fields Table has a fourth field, "Status (Active/Inactive)"
// (app-forms.js 'm.paymentmode'). §3b built it as `createOnly` — settable
// only when adding a new mode (masters_lookup.py's create_only_fields), not
// through an ordinary edit. Once a row exists, Status only moves through the
// list screen's Super-Admin-only Deactivate/Activate actions (§4a) — see
// FieldConfig.createOnly for exactly how the form renders it read-only from
// then on.
const config: FormScreenConfig<PaymentModeRow> = {
  shape: 'form',
  id: 'masters.payment_modes',
  title: 'Payment Mode',
  listEndpoint: '/masters/payment-modes',
  createEndpoint: '/masters/payment-modes',
  updateEndpoint: (id) => `/masters/payment-modes/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/payment-modes'],
  emptyRow: () => ({ name: '', code: null, requires_reference_number: false, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Mode Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Bank Transfer, UPI, IMPS, Cash, Cheque, Card',
      // payment_modes.name is UNIQUE in the schema; a clash comes back as a 409
      // ("Duplicate name or invalid reference"), so the hint warns first.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique like `name`.
      key: 'code',
      label: 'Code',
      placeholder: 'e.g. BT, UPI, CHQ',
      hint: 'Optional short code, shown on the list and usable in exports. Must be unique if set.',
    },
    {
      key: 'requires_reference_number',
      label: 'Requires Reference Number',
      type: 'checkbox',
      hint: 'Typically Yes for Bank Transfer/UPI/IMPS/Cheque, No for Cash',
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
      hint: "Defaults to Active. Uncheck to create this mode already inactive — e.g. staging next year's config before it goes live. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
