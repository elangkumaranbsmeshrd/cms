// Mirrors app/schemas/employee.py's EmployeeOut, in full.
export interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  employment_status: string;
  joining_date: string;
  exit_date: string | null;
  gender: string | null;
  date_of_birth: string | null;
  current_address: string | null;
  pan_number: string | null;
  aadhaar_number: string | null;
  // EmployeeWrite's real required FKs (backend/app/schemas/employee.py) —
  // department_id/designation_id/employment_type_id are never null on a
  // saved record (models/employee.py:31-33, nullable=False).
  department_id: string;
  designation_id: string;
  employment_type_id: string;
  // Nullable FKs — reporting_manager_id (models/employee.py:35) and
  // photo_file_id (models/employee.py:23, FK -> stored_files.id) are both
  // optional on EmployeeWrite.
  reporting_manager_id: string | null;
  photo_file_id: string | null;
  // Bank & Statutory tab.
  work_location_address_id: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc_code: string | null;
  // Account & Login tab. user_id is null until Create Login fires;
  // login_removed_at flips non-null on Disable Login, back to null on
  // Enable Login (employees.py) — this pair alone is enough to render
  // Account Status without a secondary fetch, see emp.record.config.ts.
  user_id: string | null;
  login_created_at: string | null;
  login_removed_at: string | null;
  onboarding_completed_at: string | null;
  // §2.2e Super Admin extra filter, added to EmployeeOut (schemas/employee.py)
  // in the 2026-08-11 production-readiness audit.
  created_by: string | null;
  updated_by: string | null;
}

export const EMPLOYEE_USER_REF = { endpoint: '/users', labelKey: 'name' };

// Mirrors app/schemas/employee.py's DocumentOut, verbatim — every field the
// real GET /employees/{employee_id}/documents response returns.
export interface EmployeeDocumentRow {
  id: string;
  employee_id: string;
  document_type: string;
  file_id: string;
  note: string | null;
  status: string;
  uploaded_at: string;
  uploaded_by_user_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  source: string;
}
