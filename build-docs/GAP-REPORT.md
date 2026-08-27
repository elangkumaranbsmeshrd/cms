# Gap Report — spec checklist vs built frontend

Regenerate with `python build-docs/_gap_check.py`. Read that script's docstring before
acting on anything here — it explains what this comparison can and cannot see.

**MISSING means no matching label string was found in the module's own files, in `shared/`,
in `layout/`, or in `core/`.** It does NOT mean the control is absent: a field labelled from a
runtime value, or one hidden behind a conditional, looks missing here and is not.
**Verify in the browser before changing anything.**


## Module 1 of 14: Masters  →  `features/masters/`

- **MISSING** [Buttons / actions] `+ Add Tax` — 3.2 Taxes
- **MISSING** [Fields] `Paid or Unpaid` — 3.4 Leave Types
- **MISSING** [Fields] `Biometric Attendance` — 3.6 Company Profile
- **MISSING** [Fields] `Biometric Device Endpoint / Reference` — 3.6 Company Profile
- **MISSING** [Buttons / actions] `Save Changes` — 3.6 Company Profile
- **MISSING** [Buttons / actions] `+ Add Code` — 3.11 HSN / SAC Code
- **MISSING** [Buttons / actions] `+ Add Unit` — 3.13 Unit of Measure
- **MISSING** [Buttons / actions] `+ Add Category` — 3.14 Ticket Categories
- **MISSING** [Buttons / actions] `+ Add Source` — 3.16 Customer Source
- **MISSING** [Buttons / actions] `+ Add Category` — 3.17 Asset Categories
- **MISSING** [Buttons / actions] `+ Add Plan.` — 3.19 Insurance Plans
- **MISSING** [Fields] `Resolved Periods` — 3.20 Work Week & Hours

## Module 2 of 14: Employee  →  `features/employee/`

- **MISSING** [Fields] `Extra Permissions` — 2.2 Employee Master Record
- **MISSING** [Fields] `HRA — House Rent Allowance (Monthly)` — 2.2 Employee Master Record
- **MISSING** [Fields] `Leave Travel Allowance — LTA (Monthly or Annual)` — 2.2 Employee Master Record
- **MISSING** [Buttons / actions] `Save Changes` — 2.2 Employee Master Record
- **MISSING** [Buttons / actions] `+ Add Permission Override` — 2.2 Employee Master Record
- **MISSING** [Fields] `File Name` — 2.6 My Documents (Self-Service)
- **MISSING** [Fields] `Guidance` — 2.14 My Tax Declarations (Self-Service)
- **MISSING** [Fields] `Proof Upload` — 2.14 My Tax Declarations (Self-Service)

## Module 3 of 14: Asset Management  →  `features/asset/`

- **MISSING** [Fields] `From Date` — 2.3 Assign / Transfer / Unassign
- **MISSING** [Fields] `To Date` — 2.3 Assign / Transfer / Unassign
- **MISSING** [Columns] `Core Info` — 6.1 Field-Level Access on the Asset Master Record
- **MISSING** [Fields] `Purchase & Financial` — 6.1 Field-Level Access on the Asset Master Record
- **MISSING** [Fields] `2.8 Reclaim on Exit` — 6.2 Screen-by-Screen Access Table

## Module 4 of 14: Ticket  →  `features/ticket/`


## Module 5 of 14: Leave  →  `features/leave/`

- **MISSING** [Fields] `From Date` — 2.1 My Leave (Self-Service)
- **MISSING** [Fields] `To Date` — 2.1 My Leave (Self-Service)
- **MISSING** [Fields] `Half-Day` — 2.1 My Leave (Self-Service)
- **MISSING** [Buttons / actions] `Apply for Leave` — 2.1 My Leave (Self-Service)
- **MISSING** [Buttons / actions] `Run Year-End Carry-Forward` — 2.3 Leave Balance Management
- **MISSING** [Fields] `Day Type` — 2.6 Compensatory Hours
- **MISSING** [Fields] `Window Check` — 2.6 Compensatory Hours
- **MISSING** [Buttons / actions] `Download Report` — 6.2 Nothing Here Is Hardcoded

## Module 6 of 14: Payroll  →  `features/payroll/`

- **MISSING** [Buttons / actions] `+ Add Adjustment,` — 2.1a Ad-hoc Payslip Adjustments
- **MISSING** [Buttons / actions] `Download Salary Certificate` — 2.2 Payslip — Employee View (Self-Service Baseline)

## Module 7 of 14: Vendor  →  `features/vendor/`


## Module 8 of 14: Customer  →  `features/customer/`

- **MISSING** [Buttons / actions] `+ Upload File` — 2.3 Customer 360

## Module 9 of 14: Opportunity  →  `features/opportunity/`

- **MISSING** [Buttons / actions] `+ Upload File` — 2.3 Opportunity Record — Activities & Files

## Module 10 of 14: Project  →  `features/project/`

- **MISSING** [Buttons / actions] `+ Add Task` — 2.3 Task Board
- **MISSING** [Buttons / actions] `+ Add Sub-task` — 2.4 Task Detail
- **MISSING** [Fields] `Person` — 2.8 Milestones & Timesheets

## Module 11 of 14: Invoice  →  `features/invoice/`


## Module 12 of 14: Expense  →  `features/expense/`

- **MISSING** [Fields] `Debit` — 2.1 My Expenses (Self-Service)
- **MISSING** [Fields] `Running Balance` — 2.1 My Expenses (Self-Service)

## Module 13 of 14: Purchase Bill  →  `features/purchase-bill/`

- **MISSING** [Fields] `Paid to the authority, separately` — 2.2 Add / Edit Purchase Bill
- **MISSING** [Buttons / actions] `Download` — 2.2 Add / Edit Purchase Bill

## Module 14 of 14: Roles & Access (RBAC)  →  `features/rbac/`

- **MISSING** [Buttons / actions] `+ Add Override` — 4.3 Individual Permission Overrides
- **MISSING** [Columns] `Date/Time` — 4.4 Permission Change Log
- **MISSING** [Columns] `Old Value` — 4.4 Permission Change Log
- **MISSING** [Columns] `New Value` — 4.4 Permission Change Log

## Module 14 of 14: Roles & Access (RBAC)  →  `features/compliance/`

