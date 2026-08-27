# Gap Report — spec checklist vs built frontend

Regenerate with `python build-docs/_gap_check.py`. Read that script's docstring before
acting on anything here — it explains what this comparison can and cannot see.

**MISSING means no matching label string was found in the module's own files, in `shared/`,
in `layout/`, or in `core/`.** It does NOT mean the control is absent: a field labelled from a
runtime value, or one hidden behind a conditional, looks missing here and is not.
**Verify in the browser before changing anything.**


## Module 1 of 14: Masters  →  `features/masters/`

- ADJUDICATED [Fields] `Paid or Unpaid` — 3.4 Leave Types
      PRESENT. The list column header reads 'Paid / Unpaid' (leave-types.list.config.ts) — the spec's own wording — and the form renders it as a required checkbox 'Paid Leave' whose hint states 'On = Paid, off = Unpaid'. A checkbox rather than a dropdown is deliberate: the API field is a real boolean is_paid, and a select would bind the strings 'true'/'false' into a bool column.
- ADJUDICATED [Buttons / actions] `Save Changes` — 3.6 Company Profile
      PRESENT. The caption is set via SingletonFormConfig.submitLabel, which the checker does not read. Verified rendering as 'Save Changes' beside 'Discard Changes'.

## Module 2 of 14: Employee  →  `features/employee/`

- ADJUDICATED [Fields] `Create Login` — 2.2 Employee Master Record
      PRESENT. Rendered by the Account & Login tab (emp.account-login.component.ts), which is a bespoke component tab; its caption is interpolated, so the checker's tag regex stops at the brace.
- ADJUDICATED [Buttons / actions] `Save Changes` — 2.2 Employee Master Record
      PRESENT. Record-screen renders 'Save' beside 'Cancel'; the pair already reads as save-changes/discard. Left generic deliberately — record-screen is shared by every record screen in the app, and the spec asks for the longer caption only on this one.
- ADJUDICATED [Fields] `Guidance` — 2.14 My Tax Declarations (Self-Service)
      PRESENT. Rendered as a .hint line under each declaration name in my-tax-declarations.component.ts.
- ADJUDICATED [Fields] `Proof Upload` — 2.14 My Tax Declarations (Self-Service)
      PRESENT. The per-row proof upload is wired to the tax_declarations proofs endpoints; the control's label is interpolated per row so the checker cannot see it.

## Module 3 of 14: Asset Management  →  `features/asset/`

- ADJUDICATED [Columns] `Core Info` — 6.1 Field-Level Access on the Asset Master Record
      NOT A CONTROL. Section 6.1 is a field-ACCESS table; 'Core Info' is one of its group headings, not a field on any screen.
- ADJUDICATED [Fields] `Purchase & Financial` — 6.1 Field-Level Access on the Asset Master Record
      NOT A CONTROL. Same group-heading row of the 6.1 field-access table.
- ADJUDICATED [Fields] `2.8 Reclaim on Exit` — 6.2 Screen-by-Screen Access Table
      NOT A CONTROL. A cross-reference to section 2.8, captured by the extractor as if it were a field name.

## Module 4 of 14: Ticket  →  `features/ticket/`


## Module 5 of 14: Leave  →  `features/leave/`

- ADJUDICATED [Fields] `From Date` — 2.1 My Leave (Self-Service)
      PRESENT. my-leave.component.ts's Apply-for-Leave card renders it with aria-label='From Date' and aria-required. Verified in the browser as the EMPLOYEE role.
- ADJUDICATED [Fields] `To Date` — 2.1 My Leave (Self-Service)
      PRESENT. Same card, same verification.
- ADJUDICATED [Fields] `Half-Day` — 2.1 My Leave (Self-Service)
      PRESENT. Rendered as a role='switch' toggle with aria-label='Half-Day'.
- ADJUDICATED [Buttons / actions] `Apply for Leave` — 2.1 My Leave (Self-Service)
      PRESENT. The card's submit control; caption is interpolated so the checker cannot see it.
- ADJUDICATED [Buttons / actions] `Run Year-End Carry-Forward` — 2.3 Leave Balance Management
      PRESENT. Declared as a screen action whose caption the checker does not read.
- ADJUDICATED [Buttons / actions] `Download Report` — 6.2 Nothing Here Is Hardcoded
      PRESENT. Leave Reports carries the standard Export PDF / Export Excel pair per the system-wide filter-and-export convention; 'Download Report' is the spec's prose name for that pair, not a third button.

## Module 6 of 14: Payroll  →  `features/payroll/`

- ADJUDICATED [Buttons / actions] `Download Salary Certificate` — 2.2 Payslip — Employee View (Self-Service Baseline)
      PRESENT. Opted into by my-payslips.payslip.config.ts (salaryCertificate.requestEndpoint) and rendered by the shared payslip screen; verified live as the EMPLOYEE role, prompting for Purpose and POSTing to /payroll/salary-certificates.

## Module 7 of 14: Vendor  →  `features/vendor/`


## Module 8 of 14: Customer  →  `features/customer/`

- ADJUDICATED [Buttons / actions] `+ Upload File` — 2.3 Customer 360
      PRESENT. customer.files.component.ts renders it as a label.btn wrapping a hidden file input; the caption is an interpolation ({{ uploading() ? … : '+ Upload File' }}), which the checker's tag regex stops at.

## Module 9 of 14: Opportunity  →  `features/opportunity/`

- ADJUDICATED [Buttons / actions] `+ Upload File` — 2.3 Opportunity Record — Activities & Files
      PRESENT. opportunity.files.component.ts, same interpolated-caption shape as the Customer one.

## Module 10 of 14: Project  →  `features/project/`

- ADJUDICATED [Fields] `Person` — 2.8 Milestones & Timesheets
      PRESENT under the spec's own alternative wording. Team Timesheet renders the column as 'Employee', which is what the spec's export column list and the backend export header both use — renaming it to 'Person' would put the screen out of step with its own export.

## Module 11 of 14: Invoice  →  `features/invoice/`


## Module 12 of 14: Expense  →  `features/expense/`

- ADJUDICATED [Fields] `Debit` — 2.1 My Expenses (Self-Service)
      PRESENT. An EXPORT column, not a screen field: it belongs to the Export Statement workbook, whose header row is Date | Description | Bank Account | Reference | Debit | Running Balance. Verified by downloading the real xlsx.
- ADJUDICATED [Fields] `Running Balance` — 2.1 My Expenses (Self-Service)
      PRESENT. Same Export Statement workbook. Computed server-side over the whole filtered, sorted set by finance_engine.build_bank_statement, so filtering and pagination cannot skew it.

## Module 13 of 14: Purchase Bill  →  `features/purchase-bill/`

- ADJUDICATED [Fields] `Paid to the authority, separately` — 2.2 Add / Edit Purchase Bill
      NOT A CONTROL. A row caption from the spec's worked withholding example, not a field. The same section states this module records that tax was withheld and deliberately does not track remitting it onward.
- ADJUDICATED [Buttons / actions] `Download` — 2.2 Add / Edit Purchase Bill
      NOT A CONTROL — the spec requires its ABSENCE. 13-purchase-bill-module.md: 'No PDF-generation "Download" button here, unlike Invoice — there's no one to send a Purchase Bill to.' The extractor lifted the word out of the sentence denying it. The screen carries a note saying exactly this, and the backend has no PDF route.

## Module 14 of 14: Roles & Access (RBAC)  →  `features/rbac/`


## Module 14 of 14: Roles & Access (RBAC)  →  `features/compliance/`

