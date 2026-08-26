import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { InsurancePlanRow } from '../masters.api';

/** insurance_plans.plan_type — masters_simple.py's own comment on the field:
 * HEALTH | LIFE | PERSONAL_ACCIDENT. Exported because
 * insurance-plans.list.config.ts renders the same enum as a column label and as
 * its Plan Type filter, and the three must never drift apart. */
export const PLAN_TYPE_OPTIONS = [
  { value: 'HEALTH', label: 'Health' },
  { value: 'LIFE', label: 'Life' },
  { value: 'PERSONAL_ACCIDENT', label: 'Personal Accident' },
];

const config: FormScreenConfig<InsurancePlanRow> = {
  shape: 'form',
  id: 'masters.insurance_plans',
  title: 'Insurance Plan',
  listEndpoint: '/masters/insurance-plans',
  createEndpoint: '/masters/insurance-plans',
  updateEndpoint: (id) => `/masters/insurance-plans/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/insurance-plans'],
  emptyRow: () => ({
    plan_name: '',
    plan_type: 'HEALTH',
    provider: null,
    coverage_amount: 0,
    company_contribution_monthly: 0,
    employee_contribution_monthly: 0,
    is_active: true,
  }),
  // Labels, required markers, placeholders and hints are the prototype's own
  // (app-forms.js 'm.insurance'), which in turn match §3.19's Fields Table. The
  // required set also matches the API exactly: masters_simple.py declares
  // plan_name / plan_type / coverage_amount / company_contribution_monthly with
  // no default (mandatory), provider nullable, and
  // employee_contribution_monthly defaulted to 0.
  fields: [
    {
      key: 'plan_name',
      label: 'Plan Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Group Mediclaim — Standard',
      hint: 'Must be unique.',
    },
    {
      key: 'plan_type',
      label: 'Type',
      type: 'select',
      staticOptions: PLAN_TYPE_OPTIONS,
      required: true,
    },
    {
      key: 'provider',
      label: 'Provider',
      span: 2,
      placeholder: 'The insurance company underwriting the plan',
    },
    {
      key: 'coverage_amount',
      label: 'Coverage Amount (₹)',
      type: 'number',
      required: true,
      placeholder: '0',
      hint: 'Sum insured.',
    },
    {
      key: 'company_contribution_monthly',
      label: 'Company Contribution (Monthly, ₹)',
      type: 'number',
      required: true,
      placeholder: '0',
      hint: 'What the company pays toward the premium — a flat monthly amount per employee. Feeds Annual CTC.',
    },
    {
      key: 'employee_contribution_monthly',
      label: 'Employee Contribution (Monthly, ₹)',
      type: 'number',
      placeholder: '0',
      hint: 'Any amount deducted from the employee\'s own pay if the plan is not fully company-funded; 0 if fully covered. Feeds the monthly payroll deduction.',
    },
    {
      // §3b built this as `createOnly` (masters_lookup.py's
      // create_only_fields) — settable only when adding a new plan. Once a
      // row exists, Status only moves through the list screen's
      // Super-Admin-only Deactivate/Activate row actions (§4a).
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: "Defaults to Active. Uncheck to create this plan already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
