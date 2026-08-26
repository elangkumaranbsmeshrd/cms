import { RecordScreenConfig } from '../../../shared/screens/screen.types';
import { EmployeeRow } from '../employee.api';
import { buildAssignedAssetsListConfig } from './emp.assigned-assets.list.config';
import { buildEmployeeDocumentsListConfig } from './emp.documents.list.config';
import { EmpSalaryStructureComponent } from './emp.salary-structure.component';
import { EmpInsuranceComponent } from './emp.insurance.component';
import { EmpEmergencyContactsComponent } from './emp.emergency-contacts.component';
import { EmpLeaveAttendanceComponent } from './emp.leave-attendance.component';
import onboardingChecklist from './emp.onboarding.checklist.config';
import { EmpOfferLettersComponent } from './emp.offer-letters.component';

// §2.2 Employment Details: Department/Designation/Employment Type are each a
// Masters lookup (masters_lookup.py's generic factory — {id, name, is_active}
// over the wire), the same RefLookup shape every other select-backed FK field
// in this app uses (e.g. designations.form.config.ts's own DEPARTMENT_REF).
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const DESIGNATION_REF = { endpoint: '/masters/designations/options', labelKey: 'label' };
const EMPLOYMENT_TYPE_REF = { endpoint: '/masters/employment-types/options', labelKey: 'label' };
// §2.2's "Work Location" is a plain Chennai/Coimbatore select over the mock
// data, but the real column (work_location_address_id, models/employee.py:36)
// is a genuine FK to company_addresses — CompanyAddressOut has no bare 'name'
// field, so labelKey resolves through 'city' instead (the real analogue of
// the prototype's Chennai/Coimbatore distinction). Same endpoint + labelKey
// pattern asset.create.form.config.ts's own LOCATION_REF already establishes
// for the identical FK shape on Asset.location_address_id (that one uses
// 'line1' instead of 'city', since an asset's storage location cares about
// the street address, not the city).
const WORK_LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };
// §0.3: GET /employees returns first_name/last_name as separate fields, no
// {id,name} shape — labelKey: 'first_name' is the established workaround
// used repeatedly across every other already-built module (asset.directory.
// list.config.ts's own EMPLOYEE_REF, leave.reports.config.ts's Reporting
// Manager filter, etc.) — RefDataService reads exactly `row[labelKey]`,
// which resolves fine to a first-name-only label. Previously left this
// field unrendered on the theory that no such lookup source existed; it
// does, this file just hadn't adopted the same pattern its siblings already
// had.
const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };

const config: RecordScreenConfig<EmployeeRow> = {
  shape: 'record',
  id: 'employee.master_record',
  title: 'Employee Master Record',
  loadEndpoint: (id) => `/employees/${id}`,
  // PUT /employees/{id} (employees.py's EmployeeWrite) also requires
  // work_location_address_id, bank_name/bank_account_number/bank_ifsc_code —
  // real fields belonging to a Bank & Statutory tab not built in this pass.
  // Safe regardless: Save always PUTs a full copy of the loaded row
  // (RecordScreenComponent.startEdit), so those untouched fields round-trip
  // unchanged rather than being nulled — this only edits what's actually
  // shown here.
  edit: { saveEndpoint: (id) => `/employees/${id}` },
  header: {
    primary: (row) => `${row.first_name} ${row.last_name ?? ''}`.trim(),
    secondary: (row) => row.email,
    code: (row) => row.employee_code,
    badge: (row) => row.employment_status,
  },
  tabs: [
    {
      id: 'personal',
      label: 'Personal',
      sections: [
        {
          title: 'Personal Details',
          fields: [
            // §2.2 Personal Details table lists Photo first. screen.types.ts's
            // FieldType has no 'file' member yet (only the Documents tab's own
            // upload flow, employee_documents.py, handles real file uploads) —
            // rather than invent one here, this shows the raw photo_file_id
            // (a stored_files FK, models/employee.py:23) read-only. Once a
            // 'file' FieldType exists this becomes a thumbnail + uploader.
            { key: 'photo_file_id', label: 'Photo' },
            { key: 'first_name', label: 'First Name', editable: true },
            { key: 'last_name', label: 'Last Name', editable: true },
            { key: 'email', label: 'Email', editable: true },
            { key: 'phone', label: 'Phone', editable: true },
            { key: 'date_of_birth', label: 'Date of Birth', type: 'date', editable: true },
            // Backend gender column (models/employee.py:29) is a bare
            // String(20) with no CHECK constraint — freeform, not a real
            // enum — so these staticOptions are the spec's own proposed
            // list (§2.2), not a value set the server enforces.
            {
              key: 'gender',
              label: 'Gender',
              type: 'select',
              editable: true,
              staticOptions: [
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
                { value: 'Other', label: 'Other' },
                { value: 'Prefer not to say', label: 'Prefer not to say' },
              ],
            },
            // §2.2: "Assumption: added here because Section 2.3 (My Profile)
            // lists Address as something an employee can edit directly... it
            // needs a home on the record, and Personal Details is the
            // natural place." textarea is now a real edit-mode FieldType
            // (record-screen.component.ts), so this is a real multi-line
            // input rather than a single-line one pretending to be an address.
            { key: 'current_address', label: 'Current Address', type: 'textarea', editable: true },
          ],
        },
        // PAN/Aadhaar were previously duplicated here AND on Bank & Statutory
        // below. §2.2's own Personal Details table (Photo/First Name/Last
        // Name/Email/Phone/Date of Birth/Gender/Current Address) has no
        // statutory identifiers on it at all — those belong on Bank &
        // Statutory's own "Bank Details" section, alongside Bank Name/Account
        // Number/IFSC, exactly where PAN and Aadhaar sit in the prototype
        // (app-screens2.js:69-73). Removed here rather than kept in both
        // places.
      ],
    },
    {
      id: 'employment',
      label: 'Employment',
      sections: [
        {
          // §2.2 Employment Details wants Department/Designation/Joining
          // Date/Employment Type/Reporting Manager/Status all present.
          // employee_code/employment_status/exit_date stay read-only exactly
          // as before: they aren't part of EmployeeWrite at all
          // (backend/app/schemas/employee.py — server-managed via lifecycle
          // actions: resignation, exit checklist, etc.), so there's nothing
          // to PUT them as.
          title: 'Employment Details',
          fields: [
            { key: 'employee_code', label: 'Employee Code', type: 'text' },
            // department_id/designation_id/employment_type_id ARE required,
            // real keys on EmployeeWrite (backend/app/schemas/employee.py) —
            // confirmed genuinely editable, unlike employee_code/status/
            // exit_date above. Each Masters lookup (departments/designations/
            // employment-types) returns {id, name, is_active}, so 'select' +
            // ref is the same pattern designations.form.config.ts already
            // uses for its own Department dropdown.
            { key: 'department_id', label: 'Department', type: 'select', ref: DEPARTMENT_REF, editable: true },
            { key: 'designation_id', label: 'Designation', type: 'select', ref: DESIGNATION_REF, editable: true },
            // §2.2 marks Joining Date editable by HR/Super Admin (ro: !canEdit
            // in the prototype, never permanently locked), and it's a real,
            // genuinely-editable EmployeeWrite key server-side — there is no
            // backend gap here. Now open to match: the payroll/attendance
            // recalculation this could trigger is a real product concern, but
            // one for a future confirm-before-you-go flow, not a reason to
            // leave a spec-mandated field read-only today.
            { key: 'joining_date', label: 'Joining Date', type: 'date', editable: true },
            {
              key: 'employment_type_id',
              label: 'Employment Type',
              type: 'select',
              ref: EMPLOYMENT_TYPE_REF,
              editable: true,
            },
            // §2.2: real, editable EmployeeWrite key. reporting_manager_id
            // IS scoped/masked per role on the GET /employees list itself
            // (org_scope.apply_scope, _masked_employee) — a Manager viewing
            // this dropdown only ever sees the employees their own role can
            // already see elsewhere, the same tradeoff every other
            // EMPLOYEE_REF consumer in this app already accepts.
            { key: 'reporting_manager_id', label: 'Reporting Manager', type: 'select', ref: EMPLOYEE_REF, editable: true, hint: 'Circular reporting chains are blocked' },
            { key: 'employment_status', label: 'Status', type: 'status' },
            // §2.2's "Work Location" (Chennai/Coimbatore in the mock) — see
            // WORK_LOCATION_REF's own comment above for why this resolves
            // through Masters → Company Profile's Addresses endpoint rather
            // than a static two-option list. Real, editable EmployeeWrite key
            // (work_location_address_id); previously present on EmployeeRow
            // but not rendered anywhere on this record at all.
            { key: 'work_location_address_id', label: 'Work Location', type: 'select', ref: WORK_LOCATION_REF, editable: true },
            { key: 'exit_date', label: 'Exit Date', type: 'date' },
          ],
        },
      ],
    },
    // §2.2 Tab: Account & Login. Set Role/Must Change Password on Next
    // Login/Last Login all live on the linked `users` row, not on the
    // employee (see LoginStatusOut's own backend docstring) — sourced via
    // secondaryEndpoint, hidden until it resolves to a real object (no
    // login yet -> null). Account Status/Disable/Enable visibility uses
    // row.login_removed_at instead (already on EmployeeOut, no secondary
    // fetch needed for that part).
    {
      id: 'account_login',
      label: 'Account & Login',
      actions: [
        {
          label: 'Create Login',
          endpoint: (id) => `/employees/${id}/create-login`,
          screenAction: 'manage_login',
          visible: (row) => !row.user_id,
          selectParam: {
            label: 'Role',
            param: 'role_code',
            defaultValue: 'EMPLOYEE',
            options: [
              { value: 'EMPLOYEE', label: 'Employee' },
              { value: 'MANAGER', label: 'Manager' },
              { value: 'ACCOUNTANT', label: 'Accountant' },
              { value: 'HR', label: 'HR' },
              { value: 'SUPER_ADMIN', label: 'Super Admin' },
            ],
          },
        },
        {
          label: 'Disable Login',
          endpoint: (id) => `/employees/${id}/disable-login`,
          screenAction: 'manage_login',
          visible: (row) => !!row.user_id && !row.login_removed_at,
          confirm: 'Disable this login? It ends every active session immediately — all of this person’s refresh tokens are revoked at once.',
        },
        {
          label: 'Enable Login',
          endpoint: (id) => `/employees/${id}/enable-login`,
          screenAction: 'manage_login',
          visible: (row) => !!row.user_id && !!row.login_removed_at,
        },
        {
          label: 'Reset Password',
          endpoint: (id) => `/employees/${id}/reset-password`,
          screenAction: 'manage_login',
          visible: (row) => !!row.user_id,
          confirm: 'Generate a new temporary password and email it to this employee? Every one of their active sessions will be signed out.',
        },
        // §2.12 Onboarding's "Send Welcome Email" button — lives here, not
        // on the Onboarding tab itself, since RecordActionDef supports a
        // per-record dynamic endpoint and SecondaryActionDef (the
        // checklist shape's own action mechanism) doesn't — see
        // emp.onboarding.checklist.config.ts's own note. Different RBAC
        // screen key (employee.onboarding) than the rest of this tab
        // (employee.master_record), same as every other action here being
        // gated on its OWN real screen/action, not a blanket tab-level one.
        {
          label: 'Send Welcome Email',
          endpoint: (id) => `/employees/${id}/send-welcome-email`,
          screenId: 'employee.onboarding',
          screenAction: 'send_welcome_email',
          confirm: "Send this employee's welcome email now?",
        },
      ],
      // employees.py's GET /{id}/login-status (LoginStatusOut) — see its
      // own docstring for why this can't just be more EmployeeOut fields.
      secondaryEndpoint: (id) => `/employees/${id}/login-status`,
      sections: [
        {
          title: 'Login Access',
          fields: [
            { key: 'email', label: 'Login Email' },
            {
              key: 'user_id',
              label: 'Account Status',
              compute: (row) => (row.user_id ? (row.login_removed_at ? 'Disabled' : 'Enabled') : 'No login'),
            },
            {
              key: 'user_id',
              label: 'Set Role',
              hideWhenNoSecondary: true,
              compute: (_row, secondary) => (secondary as { role_name?: string } | null)?.role_name,
            },
            {
              key: 'user_id',
              label: 'Must Change Password on Next Login',
              hideWhenNoSecondary: true,
              compute: (_row, secondary) => ((secondary as { must_change_password?: boolean } | null)?.must_change_password ? 'Yes' : 'No'),
            },
            {
              key: 'user_id',
              label: 'Last Login',
              hideWhenNoSecondary: true,
              compute: (_row, secondary) => {
                const at = (secondary as { last_login_at?: string | null } | null)?.last_login_at;
                return at ? new Date(at).toLocaleString('en-IN') : 'Never';
              },
            },
            // Extra Permissions (§2.2's per-person RBAC override list): reads
            // and writes the SAME rbac_admin.py /rbac/overrides endpoint the
            // standalone RBAC → Permission Overrides admin screen owns
            // (that screen is where an override actually gets created —
            // picking a module/screen/action needs that screen's own
            // picker). Deliberately not duplicated here as a second, partial
            // picker UI; once that admin screen exists, link to it filtered
            // by this employee's user_id rather than rebuilding it inline.
          ],
        },
      ],
    },
    // §2.2 Tab: Bank & Statutory.
    {
      id: 'bank_statutory',
      label: 'Bank & Statutory',
      sections: [
        {
          title: 'Bank Details',
          fields: [
            { key: 'bank_name', label: 'Bank Name', editable: true },
            // Confirm Bank Account Number (spec: "not stored separately", a
            // client-side typo-guard only, unlike Masters → Bank
            // Accounts' server-validated Confirm Account Number) is
            // deliberately not built — it's the spec's own "Assumption",
            // not a confirmed requirement, and EmployeeWrite has no such
            // field to validate against server-side.
            { key: 'bank_account_number', label: 'Bank Account Number', editable: true },
            {
              key: 'bank_ifsc_code',
              label: 'IFSC Code',
              editable: true,
              pattern: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: '4 letters, then 0, then 6 alphanumeric characters' },
            },
          ],
        },
        {
          title: 'Statutory Identifiers',
          fields: [
            {
              key: 'pan_number',
              label: 'PAN',
              editable: true,
              pattern: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: '5 letters, 4 digits, 1 letter — e.g. AAAAA9999A' },
            },
            {
              key: 'aadhaar_number',
              label: 'Aadhaar Number',
              editable: true,
              pattern: { re: /^[0-9]{12}$/, message: '12 digits' },
            },
            // §2.2's per-tax-head dynamic identifier block (one field per
            // Tax Head with "Requires an Employee Identifier" = Yes) is a
            // real, working pair of endpoints (GET/PUT .../statutory-
            // identifiers[/{tax_head_id}]) but genuinely can't be rendered
            // yet: tax_heads has no requires_employee_identifier /
            // employee_identifier_label column at all (masters_taxes.py/
            // models/masters.py — confirmed absent, not just unused),
            // and Taxes is currently empty in this DB regardless (this
            // session's own §7 reseed left it empty on purpose). Adding
            // those two columns is Masters/Taxes-module scope, not this
            // tab's — flagged for a follow-up rather than silently
            // skipped.
          ],
        },
      ],
    },
    // §2.2 Tab: Salary Structure — versioned revisions, not a field-edit;
    // see emp.salary-structure.component.ts's own doc comment.
    { kind: 'component', id: 'salary_structure', label: 'Salary Structure', component: EmpSalaryStructureComponent, idInputName: 'employeeId' },
    // §2.2 Tab: Insurance & Benefits — enroll/dependents/nominees/end; see
    // emp.insurance.component.ts's own doc comment.
    { kind: 'component', id: 'insurance', label: 'Insurance & Benefits', component: EmpInsuranceComponent, idInputName: 'employeeId' },
    // §2.2 Tab: Emergency Contact — same employee.master_record screen key
    // as the rest of the record (unlike Salary Structure/Insurance's own
    // separate keys); see emp.emergency-contacts.component.ts's own doc.
    { kind: 'component', id: 'emergency_contact', label: 'Emergency Contact', component: EmpEmergencyContactsComponent, idInputName: 'employeeId' },
    // §2.2 Tab: Documents — "the same uploaded documents and verification
    // statuses described in full in Section 2.6 (My Documents)... this tab
    // is simply that same data, viewed from inside one employee's record
    // instead of across everyone's pending documents." A genuinely separate
    // RBAC-screen-keyed sub-resource (employee.documents, its own endpoint —
    // employee_documents.py), so it's an 'embed' tab composing the 'list'
    // shape rather than a fake 'fields' tab pretending this data lives on
    // the employee row itself. buildEmployeeDocumentsListConfig is a
    // factory (not a plain config) because the real endpoint is scoped to
    // ONE employee — see that file's own header comment.
    {
      kind: 'embed',
      id: 'documents',
      label: 'Documents',
      config: buildEmployeeDocumentsListConfig,
    },
    // §2.2 Tab: Assigned Assets (read-only) — "Pulled from Asset
    // Management... No add, edit, or reassign actions live here — those
    // happen inside Asset Management itself." Same reasoning as Documents
    // just above: a genuinely separate RBAC-screen-keyed sub-resource
    // (asset.directory's own GET /assets, filtered to this employee) rather
    // than fields on the employee row itself, so it's an 'embed' tab too.
    // buildAssignedAssetsListConfig is a factory for the same reason
    // buildEmployeeDocumentsListConfig is — see that file's own header
    // comment for why RecordEmbedTab.config has to be a function here.
    {
      kind: 'embed',
      id: 'assigned_assets',
      label: 'Assigned Assets',
      config: buildAssignedAssetsListConfig,
    },
    // §2.2 Tab: Leave & Attendance Summary (read-only) — leave_balance.py +
    // attendance.py, both filtered to this employee; see
    // emp.leave-attendance.component.ts's own doc comment.
    { kind: 'component', id: 'leave_attendance', label: 'Leave & Attendance', component: EmpLeaveAttendanceComponent, idInputName: 'employeeId' },
    // §2.12 Onboarding (HR/SA only — mode 'none' for every other role, so
    // this tab renders but its fetch 403s for anyone else, same tradeoff
    // documented on RecordScreenComponent's tab list not being per-tab
    // RBAC-filtered). A plain 'embed' tab, NOT a factory: ChecklistScreen
    // Component resolves its own :id from the route directly (confirmed
    // — same route param this record's own loadEndpoint already uses),
    // so there's no host-id-closure step needed the way Documents/
    // Assigned Assets require for their own scoped list endpoints.
    { kind: 'embed', id: 'onboarding', label: 'Onboarding', config: onboardingChecklist },
    // §2.15 Offer & Appointment Letter — Accountant + Super Admin only
    // (mode 'none' for HR/Manager/Employee, deliberately — "Not a typo"
    // per the backend's own comment). See emp.offer-letters.component.ts
    // for why this is bespoke.
    { kind: 'component', id: 'offer_letters', label: 'Offer & Appointment Letter', component: EmpOfferLettersComponent, idInputName: 'employeeId' },
  ],
};

export default config;
