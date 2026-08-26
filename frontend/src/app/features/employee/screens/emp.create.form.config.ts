import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { EmployeeRow } from '../employee.api';

const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const DESIGNATION_REF = { endpoint: '/masters/designations/options', labelKey: 'label' };
const EMPLOYMENT_TYPE_REF = { endpoint: '/masters/employment-types/options', labelKey: 'label' };
// §0.3: GET /employees returns first_name/last_name as separate fields, no
// {id,name} shape — labelKey: 'first_name' is the established workaround
// used repeatedly across every other already-built module (see
// asset.directory.list.config.ts's own EMPLOYEE_REF for the precedent).
const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };
// Same reasoning as emp.record.config.ts's own WORK_LOCATION_REF.
const WORK_LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };

// §2.1's "+ Add Employee" (Super Admin/HR) create flow. record-screen
// component has no create branch anywhere in this codebase (confirmed —
// every 'record'-shape screen hard-requires an :id route param, see
// asset.create.form.config.ts's own precedent-setting comment), so this is a
// SEPARATE, create-only 'form'-shape config sharing the same RBAC id
// ('employee.master_record' — create_employee in employees.py gates on
// require_screen(MASTER_RECORD, action="edit"), not employee.directory,
// which registers no actions of its own) at the sibling route employees/new.
//
// Fields are EmployeeWrite's real keys only (backend/app/schemas/
// employee.py). employee_code/employment_status/exit_date/user_id/
// login_created_at/login_removed_at/onboarding_completed_at are all
// server-managed and not part of EmployeeWrite at all — nothing to submit
// for them, exactly the same class of gap emp.record.config.ts's own
// Employment tab documents for the same three fields on the edit side.
const config: FormScreenConfig<EmployeeRow> = {
  shape: 'form',
  id: 'employee.master_record',
  title: 'Employee',
  // Never actually read: this route carries no :id param, so
  // form-screen.component.ts's constructor takes its "no id -> create mode"
  // branch and never touches listEndpoint/rowId. Still required by the type.
  listEndpoint: '/employees',
  rowId: (row) => row.id,
  createEndpoint: '/employees',
  // Deliberately no updateEndpoint — permanently create-only. Editing an
  // existing employee happens on the Master Record (emp.record.config.ts),
  // which is a 'record'-shape screen, not this form.
  emptyRow: () => ({
    first_name: '',
    last_name: null,
    email: '',
    phone: null,
    date_of_birth: null,
    gender: null,
    current_address: null,
    department_id: '',
    designation_id: '',
    employment_type_id: '',
    joining_date: '',
    reporting_manager_id: null,
    work_location_address_id: null,
    bank_name: null,
    bank_account_number: null,
    bank_ifsc_code: null,
    pan_number: null,
    aadhaar_number: null,
    photo_file_id: null,
  }),
  fields: [
    // §2.2 Personal Details table lists Photo first — the create form is
    // the one place on this whole module a 'file' FieldType actually
    // renders (record-screen.component.ts, unlike form-screen.component.ts,
    // has no 'file' branch at all yet — see emp.record.config.ts's own
    // Personal tab comment for that side of the gap).
    { key: 'photo_file_id', label: 'Photo', type: 'file', fileAccept: 'image/jpeg,image/png', hint: 'Optional. JPEG or PNG.' },
    { key: 'first_name', label: 'First Name', required: true, hint: '2–50 characters', section: 'Personal Details' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email', type: 'email', required: true, hint: 'Must be unique — also used as the login identifier' },
    { key: 'phone', label: 'Phone', hint: '10-digit Indian mobile number' },
    { key: 'date_of_birth', label: 'Date of Birth', type: 'date', hint: 'Must be at least 18 as of the Joining Date' },
    {
      key: 'gender',
      label: 'Gender',
      type: 'select',
      staticOptions: [
        { value: 'Male', label: 'Male' },
        { value: 'Female', label: 'Female' },
        { value: 'Other', label: 'Other' },
        { value: 'Prefer not to say', label: 'Prefer not to say' },
      ],
    },
    { key: 'current_address', label: 'Current Address', type: 'textarea', span: 2 },
    { key: 'department_id', label: 'Department', type: 'select', ref: DEPARTMENT_REF, required: true, section: 'Employment Details' },
    { key: 'designation_id', label: 'Designation', type: 'select', ref: DESIGNATION_REF, required: true },
    { key: 'joining_date', label: 'Joining Date', type: 'date', required: true },
    { key: 'employment_type_id', label: 'Employment Type', type: 'select', ref: EMPLOYMENT_TYPE_REF, required: true },
    { key: 'reporting_manager_id', label: 'Reporting Manager', type: 'select', ref: EMPLOYEE_REF, hint: 'Circular reporting chains are blocked' },
    { key: 'work_location_address_id', label: 'Work Location', type: 'select', ref: WORK_LOCATION_REF },
    { key: 'bank_name', label: 'Bank Name', section: 'Bank & Statutory' },
    { key: 'bank_account_number', label: 'Bank Account Number' },
    {
      key: 'bank_ifsc_code',
      label: 'IFSC Code',
      hint: 'Exactly 11 characters',
      pattern: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: '4 letters, then 0, then 6 alphanumeric characters' },
    },
    {
      key: 'pan_number',
      label: 'PAN',
      pattern: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: '5 letters, 4 digits, 1 letter — e.g. AAAAA9999A' },
    },
    {
      key: 'aadhaar_number',
      label: 'Aadhaar Number',
      hint: '12 digits; displayed masked once saved',
      pattern: { re: /^[0-9]{12}$/, message: '12 digits' },
    },
  ],
  listRoute: ['/employees'],
  // §2.1: "+ Add Employee" opens the new employee's own Master Record
  // afterwards (rowGo: 'emp.record'), not just the Directory list — same
  // onCreateSuccess hook asset.create.form.config.ts's own §2.8 comment
  // documents for the identical Asset Directory pattern.
  onCreateSuccess: (response) => ['/employees', response.id],
};

export default config;
