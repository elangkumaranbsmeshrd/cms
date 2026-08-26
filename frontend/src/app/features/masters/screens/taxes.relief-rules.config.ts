import { ArrayFieldConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';

// §6a — moved out of taxes.form.config.ts's own arrayFields into its own
// screen (masters.taxes.relief in the prototype).
const config: ArrayFieldConfig<TaxHeadRow> = {
  key: 'relief_rules',
  label: 'Relief Rules — Payroll — Income Tax scope only.',
  columns: [
    { key: 'relief_name', label: 'Relief Name' },
    { key: 'applies_if_base_at_or_below', label: 'Applies If Base Is At Or Below (₹)', type: 'number' },
    {
      key: 'relief_type',
      label: 'Relief Type',
      type: 'select',
      staticOptions: [
        { value: 'REDUCE_BY_FIXED', label: 'Reduce by Fixed Amount' },
        { value: 'REDUCE_TO_ZERO', label: 'Reduce to Zero' },
        { value: 'CAP_AT_AMOUNT', label: 'Cap at Amount' },
      ],
    },
    { key: 'relief_amount', label: 'Relief Amount (not needed for Reduce to Zero)', type: 'number' },
    // Masters §3.2e / app-forms.js 'm.tax.relief': a required Status toggle,
    // defaulting Active, is the row's last field in the prototype. Real and
    // already API-accepted (ReliefRuleIn.is_active, schemas/masters.py:52 —
    // "tax_head_relief_rules.is_active already exists on the model with this
    // same default; this was the only thing stopping the API from accepting
    // a caller-supplied value for it") — was simply never added to this
    // column list.
    { key: 'is_active', label: 'Status (Active/Inactive)', type: 'checkbox' },
  ],
  emptyItem: () => ({ relief_name: '', applies_if_base_at_or_below: 0, relief_type: 'REDUCE_BY_FIXED', relief_amount: 0, is_active: true }),
};

export default config;
