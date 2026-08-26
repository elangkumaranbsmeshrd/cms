import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { TaxSchemeRow } from '../masters.api';
import { CHOICE_WINDOW_OPTIONS } from './tax-schemes.list.config';

// app-forms.js 'm.tax.scheme' (§3.2d Fields Table — d — Add Tax Scheme),
// navHidden, reached from the Tax Schemes tab's own "+ Add Tax Scheme"
// button, Super Admin and Accountant (ARCH-0-prototype-inventory.md:240) —
// the same "sa,acct" role set masters.taxes itself already grants Accountant
// through the existing "Allow Accountant to Manage Taxes" toggle, which is
// why this shares that screen id rather than registering a new one.
const config: FormScreenConfig<TaxSchemeRow> = {
  shape: 'form',
  id: 'masters.taxes',
  title: 'Tax Scheme',
  listEndpoint: '/masters/tax-schemes',
  createEndpoint: '/masters/tax-schemes',
  updateEndpoint: (id) => `/masters/tax-schemes/${id}`,
  rowId: (row) => row.id,
  // Same convention as saturday-overrides.form.config.ts / pay-cycles.form.
  // config.ts (also non-first tabs of a TabbedScreenConfig): Save/Cancel
  // return to this sub-resource's OWN standalone list route, not the parent
  // tab's root — landing on Billing Taxes (tab 1) after saving a scheme
  // would be a jarring return point. masters.routes.ts registers
  // /masters/taxes/schemes standalone for exactly this.
  listRoute: ['/masters/taxes/schemes'],
  emptyRow: () => ({
    scheme_name: '',
    description: null,
    is_default: false,
    choice_window: 'ONCE_PER_FY',
    is_active: true,
  }),
  fields: [
    {
      key: 'scheme_name',
      label: 'Scheme Name',
      required: true,
      span: 2,
      placeholder: 'Whatever the alternatives are called',
      hint: 'Must be unique (ux_tax_schemes_name).',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      span: 2,
      placeholder: 'What choosing this scheme means for the employee',
      hint: 'Shown to the employee at the point they choose.',
    },
    {
      key: 'is_default',
      label: 'Is Default',
      type: 'checkbox',
      required: true,
      hint: 'Exactly one scheme may be the default — turning this on automatically turns it off on whichever scheme currently holds it. Employees who never make a choice are assessed under it.',
    },
    {
      key: 'choice_window',
      label: 'Choice Window',
      type: 'select',
      staticOptions: CHOICE_WINDOW_OPTIONS,
      required: true,
      hint: 'When an employee is allowed to switch. Proposed options (A004) — the real constraint is a setting, not an assumption.',
    },
    {
      // §4a write-authority rule, same shape as every other sub-master's
      // §3b Status field this session added: createOnly, settable only at
      // creation; afterward moves only through this list's own
      // Deactivate/Activate row actions, Super Admin only.
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: 'Defaults to Active. If no schemes are active, the whole concept disappears from the interface.',
    },
  ],
};

export default config;
