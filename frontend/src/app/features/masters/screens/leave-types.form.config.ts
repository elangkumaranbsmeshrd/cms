import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { LeaveTypeRow } from '../masters.api';

const config: FormScreenConfig<LeaveTypeRow> = {
  shape: 'form',
  id: 'masters.leave_types',
  title: 'Leave Type',
  listEndpoint: '/masters/leave-types',
  createEndpoint: '/masters/leave-types',
  updateEndpoint: (id) => `/masters/leave-types/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/leave-types'],
  emptyRow: () => ({
    name: '',
    short_code: null,
    is_paid: true,
    default_annual_quota_days: 0,
    carry_forward_allowed: false,
    max_carry_forward_days: null,
    is_quota_tracked: true,
    is_active: true,
  }),
  // §3b built Status as `createOnly` (masters_lookup.py's
  // create_only_fields) — settable only when adding a new leave type. Once a
  // row exists, Status only moves through the list screen's Super-Admin-only
  // Deactivate/Activate row actions (§4a).
  fields: [
    {
      key: 'name',
      label: 'Leave Type Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Casual Leave, Work From Home, Optional Leave, Earned Leave',
      hint: 'Must be unique',
    },
    {
      key: 'short_code',
      label: 'Short Code',
      placeholder: 'e.g. CL',
      hint: 'Used in compact views like a leave calendar',
    },
    {
      // The prototype draws this as a Paid/Unpaid dropdown, but the API field
      // is a real boolean (is_paid), and a select would bind the string
      // 'true'/'false' into a bool column. A toggle says the same thing
      // without the type mismatch — hence the label carries both readings.
      key: 'is_paid',
      label: 'Paid Leave',
      type: 'checkbox',
      required: true,
      hint: 'On = Paid, off = Unpaid. Drives whether Payroll deducts pay for this leave type.',
    },
    {
      key: 'default_annual_quota_days',
      label: 'Default Annual Quota (Days)',
      type: 'number',
      placeholder: '0',
      hint: 'Days granted per employee per financial year; 0 is allowed for types like WFH that do not consume a quota',
    },
    {
      key: 'carry_forward_allowed',
      label: 'Carry Forward Allowed',
      type: 'checkbox',
      required: true,
      hint: 'Defaults to No',
    },
    {
      // §3.4 marks this "Conditional — required if Carry Forward Allowed =
      // Yes". Hidden while carry-forward is off, and FormScreenComponent drops
      // hidden fields from the request body, so switching carry-forward off
      // also clears the stored cap instead of leaving a stale number behind.
      // The "≤ Default Annual Quota" comparison is stated in the hint rather
      // than enforced — §3.4 records that the API does not check it either,
      // and a client-only block would be a rule the server does not share.
      key: 'max_carry_forward_days',
      label: 'Max Carry Forward Days',
      type: 'number',
      required: true,
      placeholder: '0',
      visibleWhen: (form) => !!form['carry_forward_allowed'],
      hint: 'Required when Carry Forward Allowed is on. Must be less than or equal to the Default Annual Quota.',
    },
    {
      key: 'is_quota_tracked',
      label: 'Is Quota Tracked',
      type: 'checkbox',
      required: true,
      hint: 'Defaults to Yes. Off means this type never consumes a balance at all — the cleaner expression of "types that do not consume a quota" than a 0 quota. Leave reads it when deciding whether an application draws a balance down.',
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
      hint: "Defaults to Active. Uncheck to create this leave type already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
