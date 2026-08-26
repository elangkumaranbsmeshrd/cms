/* ==========================================================================
   MESHRD CMS PROTOTYPE — FORM FIELD DEFINITIONS (window.FORMS_EXT)

   One entry per capture screen whose Fields Table is defined in the 14 module
   specs. Generated from a full audit of those specs so that EVERY documented
   field is rendered as a real field — never described only in a hint or note.
   Derived / auto-generated / system values are rendered read-only (ro:1) with
   a lock label and a hint explaining how they are derived.

   Consumed by R.form in app-screens.js. Same shape as the FORMS registry there.
   ========================================================================== */
(function () {
  'use strict';
  const C = window.CMS, D = C.D;

  window.FORMS_EXT = {

    /* Masters §3.3 — Add Expense Type */
    'm.expensetypes': {
      sections: [['Add Expense Type', [
        { l: 'Expense Type Name', req: 1, span: 2, ph: 'e.g. Travel, Snacks, Internet / Wi-Fi, Office Rent', hint: 'Must be unique' },
        { l: 'Short Code', ph: 'e.g. TRV, NET', hint: 'Used in compact views and on the statement export' },
        { l: 'Claim Type', type: 'select', req: 1, opts: ['Reimbursable', 'Company-Paid'], hint: 'The field that decides who may raise this expense and what happens at the end. Reimbursable — an employee paid out of their own pocket; every role can raise it and it ends in a payout to that person. Company-Paid — the company was billed directly (Wi-Fi, electricity, office rent, cloud hosting); only Super Admin and Accountant can raise it, nobody is owed a reimbursement, and it is settled straight from the company bank account.' },
        { l: 'Recurring', type: 'toggle', on: 'Yes', hint: 'Turn on for a standing monthly bill — Wi-Fi, rent, hosting. It has no effect on approval; it simply lets Accounts filter the expected monthly bills apart from one-off spend, and flags a month where an expected bill never arrived.' },
        { l: 'Default Bank Account', type: 'select', opts: ['— None —'].concat(D.masters.bank.filter(b => b.status === 'Active').map(b => b.name)), hint: 'Optional. Pre-selects the account on Add Expense for this type — useful when every Wi-Fi bill always leaves the same account. Still editable on the expense itself.' },
        { l: 'Description', type: 'textarea', span: 3, ph: 'Optional clarifying note' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Deactivation is Super Admin only' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Expense Type saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.4 — Add / Edit Leave Type */
    'm.leavetypes': {
      sections: [['Add / Edit Leave Type', [
        { l: 'Leave Type Name', req: 1, span: 2, ph: 'e.g. Casual Leave, Work From Home, Optional Leave, Earned Leave', hint: 'Must be unique' },
        { l: 'Short Code', ph: 'e.g. CL', hint: 'Used in compact views like a leave calendar' },
        { l: 'Paid or Unpaid', type: 'select', req: 1, opts: ['Paid', 'Unpaid'], hint: 'Drives whether Payroll deducts pay for this leave type' },
        { l: 'Default Annual Quota (Days)', ph: '0', hint: 'Days granted per employee per financial year; 0 is allowed for types like WFH that do not consume a quota' },
        { l: 'Carry Forward Allowed', type: 'toggle', req: 1, on: 'Yes', hint: 'Defaults to No' },
        { l: 'Max Carry Forward Days', req: 1, ph: '0', hint: 'Required if Carry Forward Allowed = Yes. Must be less than or equal to the Default Annual Quota' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Leave Type saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.5 — Add Holiday */
    'm.holidays.import': {
      sections: [
        ['Upload File', [
          { l: 'Financial Year', type: 'select', req: 1, opts: ['FY 2026–27', 'FY 2025–26', 'FY 2024–25'], hint: 'All imported holidays will be linked to this financial year. Dates outside the year range will be rejected.' },
          { l: 'Holiday Type', type: 'select', req: 1, opts: ['Mandatory', 'Optional', 'Mixed — use Type column in file'], hint: 'Choose Mandatory or Optional to apply one type to all rows. Choose Mixed to read the Type column from your file.' },
          { l: 'File', type: 'file', req: 1, v: 'Choose Excel or CSV', hint: 'Accepted formats: .xlsx, .xls, .csv — maximum 500 rows per import' },
          { l: 'Skip Duplicates', type: 'toggle', v: 1, on: 'Yes — skip any date already in the calendar (recommended)', hint: 'If Off, importing a date that already exists will overwrite the existing holiday name and type' }
        ]],
        ['Expected CSV / Excel Format', [
          { l: 'Required columns', v: 'Holiday Name, Date', ro: 1, lock: 'Fixed', hint: 'Column headers must match exactly (case-insensitive)' },
          { l: 'Optional columns', v: 'Type, Recurring', ro: 1, lock: 'Fixed', hint: 'Type values: Mandatory or Optional. Recurring values: Yes or No' },
          { l: 'Date format', v: 'dd-mm-yyyy', ro: 1, lock: 'Fixed', hint: 'Example: 15-08-2026 for Independence Day' },
          { l: 'Sample CSV preview', type: 'textarea', ro: 1, lock: 'Read-only', span: 3,
            v: 'Holiday Name,Date,Type,Recurring\nRepublic Day,26-01-2027,Mandatory,Yes\nHoli,14-03-2027,Mandatory,No\nGood Friday,03-04-2027,Optional,No\nIndependence Day,15-08-2027,Mandatory,Yes\nGandhi Jayanti,02-10-2027,Mandatory,Yes\nDiwali,20-10-2027,Mandatory,No\nChristmas,25-12-2026,Optional,Yes',
            hint: 'Copy this format into Excel or a .csv file — one holiday per row, no blank rows between them' }
        ]]
      ],
      buttons: [{ l: 'Preview Import', cls: 'primary', toast: 'File parsed — 7 holidays found, 0 duplicates, 0 errors. Review and confirm to add them to the calendar.' }, { l: 'Download Sample CSV', toast: 'Sample CSV file downloaded — open in Excel, fill in your holidays, save as CSV and upload.' }, { l: 'Cancel' }]
    },

    'm.holidays': {
      sections: [['Add Holiday', [
        { l: 'Holiday Name', req: 1, span: 2, ph: 'e.g. Independence Day' },
        { l: 'Date', req: 1, ph: 'dd-mm-yyyy', hint: 'Must fall inside the linked Financial Year date range' },
        { l: 'Financial Year', type: 'select', req: 1, opts: ['FY 2026–27', 'FY 2025–26', 'FY 2024–25'], hint: 'From Masters → Financial Year. Ties the holiday to a specific year, for reporting and for scoping bulk imports' },
        { l: 'Type', type: 'select', req: 1, opts: ['Mandatory', 'Optional'], hint: 'Mandatory = compulsory company-wide day off; Optional = employee may choose to take it, drawn from their leave balance' },
        { l: 'Recurring Every Year', type: 'toggle', on: 'Yes', hint: 'Convenience flag for the user own reference — it does not automatically create next year entry in this version' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Holiday saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.20a — Work Week & Hour Policy. Every number is configurable; nothing is hard-coded. */
    'm.workweek': {
      sections: [
        ['Policy', [
          { l: 'Policy Name', req: 1, span: 2, ph: 'e.g. Standard — 40 Hour Week', hint: 'Free text — name it however the company talks about it' },
          { l: 'Applies To', type: 'select', req: 1, opts: ['Company-wide (default)', 'Department', 'Designation', 'Employment Type', 'Specific Employees'], hint: 'Company-wide is the fallback. A narrower policy always wins over the company default for the people it covers' },
          { l: 'Applies To — Value', type: 'select', opts: ['— Not applicable —', 'Engineering', 'Sales', 'Accounts', 'Human Resources', 'Support', 'Operations', 'Design', 'Intern', 'Contract', 'Full Time', 'Part Time'], hint: 'Required unless Applies To is Company-wide. The list changes to match whichever dimension is selected above' },
          { l: 'Effective From', req: 1, ph: 'dd-mm-yyyy', hint: 'A policy change never rewrites a payroll period that has already been processed' },
          { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' }
        ]],
        ['Daily Hours', [
          { l: 'Gross Hours per Day', req: 1, v: '9', hint: 'Total time on site — from check-in to check-out' },
          { l: 'Unpaid Break (hours)', req: 1, v: '1', hint: 'Deducted from Gross before anything is credited' },
          { l: 'Net Working Hours per Day', v: '8.00', ro: 1, lock: 'Derived', hint: 'Gross − Break. This is the number an employee has to actually reach on a working day. Never typed directly' },
          { l: 'Grace Window (minutes)', v: '15', hint: 'A day that lands inside this much of the target still counts as a Full Day. Set 0 to switch grace off entirely' },
          { l: 'Half Day Threshold (hours)', v: '4', hint: 'At or above this but below the full target, the day is a Half Day. Below it, the day is Absent' },
          { l: 'Count Overtime Beyond Net', type: 'toggle', v: 1, on: 'Yes — bank as compensatory credit', hint: 'When on, hours past the daily target are banked and can offset a shortfall elsewhere in the same period' }
        ]],
        ['Week Pattern', [
          { l: 'Weekly Hour Target', req: 1, v: '40', hint: 'Hours per week excluding Saturdays — 5 days × 8 net hours. Payroll checks the monthly total, but this is the figure people quote' },
          { l: 'Weekly Off Day(s)', type: 'select', req: 1, opts: ['Sunday', 'Saturday, Sunday', 'Sunday + alternate Saturday', 'Rotational — 1 day/week', 'Friday', 'None'], hint: 'The fixed non-working day(s). Saturdays are handled separately below, because they are usually a pattern rather than a flat rule' },
          {
            l: 'Saturday Rule', type: 'select', req: 1,
            opts: ['Odd Saturdays Working (1st, 3rd, 5th)', 'Even Saturdays Working (2nd, 4th)', 'All Saturdays Working', 'All Saturdays Off', 'First Saturday Only', 'Last Saturday Only', 'Custom — set each Saturday by hand'],
            hint: 'This is the dynamic bit. Odd/even is the common Indian pattern, but nothing forces it — pick any option, or Custom to flip Saturdays one at a time on the Saturday Calendar tab'
          },
          { l: 'Hours on a Working Saturday', type: 'select', v: 'Full day — same as Net Working Hours', opts: ['Full day — same as Net Working Hours', 'Half day — 50% of Net Working Hours', 'Custom hours'], hint: 'Many companies run a working Saturday as a half day. If Custom, enter the figure below' },
          { l: 'Custom Saturday Hours', ph: 'e.g. 5', hint: 'Only used when the option above is Custom hours' },
          { l: 'Mandatory Holiday Overrides Saturday', type: 'toggle', v: 1, req: 1, on: 'Yes — the holiday wins', lock: 'Recommended', hint: 'A Mandatory holiday falling on a working Saturday makes it non-working. 15-08-2026 is a 3rd Saturday and shows exactly this' }
        ]],
        ['Shortfall & Compensation', [
          { l: 'Allow Compensatory Hours', type: 'toggle', v: 1, on: 'Yes — employee may make the balance up', hint: 'The core rule: someone who leaves halfway through the day can work the missing hours on another day of their own choosing instead of losing pay' },
          { l: 'Compensation Window (days)', v: '30', hint: 'How long after the shortfall the make-up day may fall. 0 means it must be inside the same payroll period' },
          { l: 'Make-Up Day Chosen By', type: 'select', v: 'Employee — subject to approval', opts: ['Employee — subject to approval', 'Employee — no approval needed', 'Manager assigns the day'], hint: 'Default lets the employee pick, with their manager confirming it' },
          { l: 'Allow Make-Up on a Week Off', type: 'toggle', v: 1, on: 'Yes — including non-working Saturdays', hint: 'Off Saturdays are the most common make-up day in practice' },
          { l: 'Allow Make-Up on a Mandatory Holiday', type: 'toggle', on: 'No', hint: 'Left off by default — a mandatory holiday should stay a holiday' },
          { l: 'Max Compensatory Hours per Month', v: '16', hint: 'A ceiling, so compensation cannot quietly become unpaid overtime. 0 removes the cap' },
          { l: 'Uncompensated Shortfall Becomes', type: 'select', req: 1, v: 'Pro-rata per hour (Loss of Pay)', opts: ['Pro-rata per hour (Loss of Pay)', 'Rounded to nearest half day', 'Rounded up to a full day', 'Deduct from leave balance first, then Loss of Pay', 'Ignore — no payroll impact'], hint: 'What Payroll does with hours that were never made up. Pro-rata is the fairest and the default' },
          { l: 'Excess Hours Become', type: 'select', v: 'Compensatory credit (expires with the window)', opts: ['Compensatory credit (expires with the window)', 'Comp Off leave balance', 'Paid overtime', 'Nothing — not tracked'], hint: 'The mirror of the rule above, for people who work past the target' }
        ]]
      ],
      buttons: [{ l: 'Save Policy', cls: 'primary', toast: 'Work week policy saved — Payroll and Leave pick it up from the next unprocessed period.' }, { l: 'Preview Working Days', toast: 'Preview: June 2026 — 22 weekdays + 2 working Saturdays (1st, 3rd) = 24 working days × 8 net hours = 192 required hours.' }, { l: 'Cancel' }]
    },

    /* Masters §3.20b — flip one Saturday against the pattern */
    'm.satrule': {
      sections: [['Override a Single Saturday', [
        { l: 'Saturday', type: 'select', req: 1, opts: ['13-06-2026 — 2nd Saturday (currently Week Off)', '20-06-2026 — 3rd Saturday (currently Working)', '27-06-2026 — 4th Saturday (currently Week Off)', '04-07-2026 — 1st Saturday (currently Working)', '11-07-2026 — 2nd Saturday (currently Week Off)'], hint: 'Only Saturdays inside the active Financial Year' },
        { l: 'Pattern Says', v: 'Week Off — 2nd Saturday, even', ro: 1, lock: 'Derived', hint: 'What the Saturday Rule on the policy resolves to for this date' },
        { l: 'Override To', type: 'select', req: 1, opts: ['Working', 'Week Off'], hint: 'The value that will actually apply' },
        { l: 'Hours Required', v: '8', hint: 'Only used when the override is Working. Leave at the policy default unless this particular Saturday is a short day' },
        { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'e.g. Release weekend — all Engineering working', hint: 'Required. A Saturday that silently changes pay for 148 people needs a stated reason, and it shows on the Saturday Calendar tab' },
        { l: 'Notify Affected Employees', type: 'toggle', v: 1, on: 'Yes — send an announcement', hint: 'Posts to Announcements and emails everyone the policy covers' }
      ]]],
      buttons: [{ l: 'Save Override', cls: 'primary', toast: 'Saturday overridden — the Saturday Calendar and every affected employee\'s required hours update at once.' }, { l: 'Cancel' }]
    },

    /* Masters §3.20c — Edit Pay Cycle. Start Day / End Day are the only inputs;
       every resolved period date on the Pay Cycle tab is computed from these two. */
    'm.paycycle': {
      sections: [
        ['Pay Cycle', [
          { l: 'Cycle Type', type: 'select', req: 1, opts: ['Fixed Cycle — Custom Start/End Day', 'Calendar Month (1st to last day)'], v: D.masters.payrollCycle.mode, hint: 'Calendar Month ignores Start/End Day below and simply runs 1st to the last day of the month' },
          { l: 'Start Day', req: 1, v: String(D.masters.payrollCycle.startDay), hint: '1–31. The day of the previous month a pay period opens. Only used in Fixed Cycle mode' },
          { l: 'End Day', req: 1, v: String(D.masters.payrollCycle.endDay), hint: '1–31. The day of the current month a pay period closes — this is the cutoff. An event dated after this always rolls into next month\'s run. Only used in Fixed Cycle mode' },
          { l: 'Salary Credit Day', req: 1, v: String(D.masters.payrollCycle.creditDay), hint: '1–31. The day of the month the bank transfer actually reaches employees\' accounts — usually a few days after End Day, to leave room for the run to be calculated and confirmed. Clamped automatically to the real last day in a shorter month' }
        ]],
        ['Preview — before you save', [
          { l: 'July 2026 would cover', v: D.payPeriodRange('July', 2026).from + ' to ' + D.payPeriodRange('July', 2026).to, ro: 1, lock: 'Computed', hint: 'Recalculates live as Start Day / End Day change, so you see the effect before committing' },
          { l: 'Salary would be credited', v: D.payCreditDate('July', 2026), ro: 1, lock: 'Computed', hint: 'Recalculates live as Salary Credit Day changes' }
        ]]
      ],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Pay Cycle saved. Applies to every future payroll run — a period already Processed keeps the dates it was calculated with.' }, { l: 'Cancel' }],
      note: 'A change here never rewrites history. It only changes what date range the next Run Payroll (Payroll, §2.1) resolves for a given month — exactly like every other Work Week & Hours setting.'
    },

    /* Masters §3.7 — Add Bank Account */
    'm.bank': {
      sections: [['Add Bank Account', [
        { l: 'Account Nickname', req: 1, span: 2, ph: 'e.g. HDFC – Current Account', hint: 'Shown wherever the account is picked in a dropdown; must be unique' },
        { l: 'Bank Name', req: 1, ph: 'e.g. HDFC Bank' },
        { l: 'Account Holder Name', req: 1, span: 2, v: 'Meshrd Technologies Pvt Ltd', hint: 'Normally the Company Legal Name' },
        { l: 'Account Number', req: 1, hint: 'Numeric; checked for a plausible length of 9–18 digits' },
        { l: 'Confirm Account Number', req: 1, hint: 'Must match Account Number exactly; not stored as a separate value' },
        { l: 'Account Type', type: 'select', req: 1, opts: ['Current', 'Savings'] },
        { l: 'IFSC Code', req: 1, v: 'HDFC0000521', hint: 'Exactly 11 characters — 4 letters, then 0, then 6 alphanumeric characters' },
        { l: 'Branch', req: 1, ph: 'e.g. T. Nagar' },
        { l: 'UPI ID', ph: 'e.g. meshrd@hdfcbank', hint: 'Optional' },
        { l: 'UPI QR Code', type: 'file', hint: 'Image upload. Optional' },
        { l: 'Is Default', type: 'toggle', on: 'Default account', hint: 'Pre-selected across Invoice/Expense/Purchase Bill payment forms; only one account can be Default at a time' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once used in a payment record' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Bank Account saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.8 — Add Payment Mode */
    'm.paymentmode': {
      sections: [['Add Payment Mode', [
        { l: 'Mode Name', req: 1, span: 2, ph: 'e.g. Bank Transfer, UPI, IMPS, Cash, Cheque, Card', hint: 'Must be unique' },
        { l: 'Requires Reference Number', type: 'toggle', on: 'Yes', hint: 'Typically Yes for Bank Transfer/UPI/IMPS/Cheque, No for Cash' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Payment Mode saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.9 — Add Department */
    'm.department': {
      sections: [['Add Department', [
        { l: 'Department Name', req: 1, span: 2, ph: 'e.g. Engineering, Design, Sales, HR, Finance, Operations', hint: 'Must be unique' },
        { l: 'Department Code', ph: 'e.g. ENG', hint: 'Short code' },
        { l: 'Description', type: 'textarea', span: 3 },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once assigned to any Employee record' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Department saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.10 — Add Designation */
    'm.designation': {
      sections: [['Add Designation', [
        { l: 'Designation Name', req: 1, span: 2, ph: 'e.g. Software Engineer, UI/UX Designer, Project Manager, HR Executive', hint: 'Must be unique' },
        { l: 'Linked Department', type: 'select', opts: ['—'].concat(D.masters.department.map(d => d.name)), hint: 'From Masters → Department. Optional, since some titles span more than one department' },
        { l: 'Level / Grade', ph: 'e.g. Junior, Senior, Lead' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once assigned to any Employee record' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Designation saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.11 — Add HSN / SAC Code */
    'm.hsn': {
      sections: [['Add HSN / SAC Code', [
        { l: 'Code', req: 1, ph: 'e.g. 998314', hint: 'Numeric; typically 4–8 digits; must be unique' },
        { l: 'Type', type: 'select', req: 1, opts: ['SAC – Services', 'HSN – Goods'], hint: 'Mostly SAC, since Meshrd is primarily a services company' },
        { l: 'Description', req: 1, span: 3, ph: 'e.g. Information technology consulting and support services' },
        {
          l: 'Linked Tax', type: 'select',
          opts: ['—'].concat(D.masters.taxHeads.filter(h => /Sales|Purchase/.test(h.scope) && h.force === 'In Force').map(h => h.name + ' (' + h.rate + ')')).concat(['— Custom —']),
          hint: 'Every in-force Sales/Billing or Purchase tax head from Masters → Taxes — a real, editable rate, never a fixed label. Pick GST — IGST for a code typically billed interstate, GST — CGST + SGST for intrastate; two different codes can carry two different types. Optional — the list it draws from may legitimately be empty. To change the rate later, edit the tax head itself in Taxes, not this field. If the rate this code needs genuinely isn\'t configured yet, choose "— Custom —" below rather than leaving the code unlinked.'
        },
        { l: 'Custom GST Type', type: 'select', opts: ['GST — IGST', 'GST — CGST + SGST'], hint: 'Only used when Linked Tax above is "— Custom —". Matches the same two types every configured GST head already uses — interstate vs. intrastate' },
        { l: 'Custom GST Rate (%)', ph: 'e.g. 18', hint: 'Only used when Linked Tax above is "— Custom —". A one-off rate for this code alone — not saved as a reusable tax head in Masters → Taxes. If this rate turns out to apply to more than one code, add it properly in Taxes instead and link to it like any other code' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once used on any Invoice line item' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Code saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.12 — Add Service Category */
    'm.servicecategory': {
      sections: [['Add Service Category', [
        { l: 'Service Category Name', req: 1, span: 2, ph: 'e.g. Product Development, Cloud Computing, Internet of Things', hint: 'Must be unique' },
        { l: 'Description', type: 'textarea', span: 3 },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once tagged on any Opportunity, Project or Invoice' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Service Category saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.13 — Add Unit of Measure */
    'm.uom': {
      sections: [['Add Unit of Measure', [
        { l: 'Unit Name', req: 1, span: 2, ph: 'e.g. Hours, Days, Fixed / Lump Sum, License, Unit', hint: 'Must be unique' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once used on any Invoice or Quote line item' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Unit saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.14 — Add Ticket Category */
    'm.ticketcategories': {
      sections: [['Add Ticket Category', [
        { l: 'Category Name', req: 1, span: 2, ph: 'e.g. Technical Issue, Billing Query, Feature Request', hint: 'Must be unique' },
        { l: 'Description', type: 'textarea', span: 3 },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once used on any Ticket' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Ticket Category saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.15 — Add Customer Status */
    'm.customerstatus': {
      sections: [['Add Customer Status', [
        { l: 'Status Name', req: 1, span: 2, ph: 'e.g. Prospect, Active, Inactive', hint: 'Must be unique' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Governs whether this status value can be selected on new or edited customers' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Customer Status saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.16 — Add Customer Source (re-added 2026-07-31) */
    'm.customersource': {
      sections: [['Add Customer Source', [
        { l: 'Source Name', req: 1, span: 2, ph: 'e.g. Referral, Website, Cold Outreach', hint: 'Must be unique' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Deactivation is Super Admin only, as on every sub-master' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Customer Source saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.17 — Add Asset Category */
    'm.assetcategories': {
      sections: [['Add Asset Category', [
        { l: 'Category Name', req: 1, span: 2, ph: 'e.g. Laptop, Monitor, Furniture, ID Card, Vehicle', hint: 'Must be unique' },
        { l: 'Description', type: 'textarea', span: 3 },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once assigned to any Asset' },
        { l: 'Default Useful Life (Years)', ph: '3', hint: 'Not a Masters §3.17 spec field — carried over from the existing prototype, where it feeds the Straight Line depreciation calculation on each asset record. Retained so a wholesale replace loses nothing' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Asset Category saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.18 — Add Employment Type */
    'm.employmenttype': {
      sections: [['Add Employment Type', [
        { l: 'Employment Type Name', req: 1, span: 2, ph: 'e.g. Full Time, Part Time, Contract, Intern', hint: 'Must be unique' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Never hard-deleted once assigned to any Employee' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Employment Type saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.19 — Add Insurance Plan */
    'm.insurance': {
      sections: [['Add Insurance Plan', [
        { l: 'Plan Name', req: 1, span: 2, ph: 'e.g. Group Mediclaim — Standard', hint: 'Must be unique' },
        { l: 'Type', type: 'select', req: 1, opts: ['Health', 'Life', 'Personal Accident'] },
        { l: 'Provider', span: 2, ph: 'The insurance company underwriting the plan' },
        { l: 'Coverage Amount (₹)', req: 1, ph: '0', hint: 'Sum insured' },
        { l: 'Company Contribution (Monthly, ₹)', req: 1, ph: '0', hint: 'What Meshrd pays toward the premium — a flat monthly amount per employee. Feeds Annual CTC' },
        { l: 'Employee Contribution (Monthly, ₹)', ph: '0', hint: 'Any amount deducted from the employee own pay if the plan is not fully company-funded; 0 if fully covered. Feeds the monthly payroll deduction' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. Deactivating stops it being offered to new enrollments but does not remove existing coverage records' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Insurance Plan saved.' }, { l: 'Cancel' }]
    },

    /* Tax & Compliance §8.3a — Record Remittance */
    'tax.remit': {
      sections: [['Record Remittance — Withholding — Professional Fees · Jul 2026', [
        { l: 'Tax Head', v: 'Withholding — Professional Fees', ro: 1, lock: 'From the period row' },
        { l: 'Period', v: 'Jul 2026 · 01-07-2026 to 31-07-2026', ro: 1, lock: 'From the period row' },
        { l: 'Withheld in this Period', v: '₹19,750', ro: 1, hint: 'Shown for reference — the total held back from suppliers under this head in this period' },
        { l: 'Already Remitted', v: '₹0', ro: 1, hint: 'Shown for reference' },
        { l: 'Amount Remitted (₹)', req: 1, v: '19,750', hint: 'Defaults to the full outstanding figure. A part-remittance is allowed — the period then reads Part-Remitted and stays open for the balance.' },
        { l: 'Paid On', req: 1, v: '05-08-2026', hint: 'Cannot be in the future. The due date for this period is 07-08-2026.' },
        { l: 'Paid From (Bank Account)', type: 'select', req: 1, opts: D.masters.bank.filter(b => b.status === 'Active').map(b => b.name), hint: 'Which Meshrd account the money left from' },
        { l: 'Mode', type: 'select', req: 1, opts: D.masters.paymentMode.filter(m => m.status === 'Active').map(m => m.name), hint: 'From Masters → Payment Mode' },
        /* Labelled from the head's own Authority Reference Label, so no jurisdiction's
           paperwork vocabulary is ever named in the specification or in code. */
        { l: 'Challan Number', req: 1, ph: 'e.g. CHLN-2026-00843', hint: 'The reference on the authority\'s receipt. This field is labelled from the tax head\'s own "Authority Reference Label" — it reads "Challan Number" here because that is what this head was configured to call it, not because the system knows the word.' },
        { l: 'Receipt / Challan Attachment', type: 'file', span: 2, hint: 'The audit source document — treat as important, the same posture Purchase Bill takes toward its bill scan' },
        { l: 'Documents Covered', type: 'checkgroup', span: 3, opts: D.taxWithheldDocs.filter(d => d.period === 'Jul 2026').map(d => ({ v: d.doc, l: d.doc + ' · ' + d.party + ' · ₹' + d.withheld.toLocaleString('en-IN') })), checked: D.taxWithheldDocs.filter(d => d.period === 'Jul 2026').map(d => d.doc), hint: 'Which withheld amounts this remittance covers — confirmed by the person recording it, never inferred by the system. The ticked total must equal Amount Remitted; a part-allocation on the final document is allowed, so an odd figure can never be forced to an untrue one.' },
        { l: 'Notes', type: 'textarea', span: 3 }
      ]]],
      buttons: [{ l: 'Record Remittance', cls: 'primary', toast: 'Remittance recorded. The period moves to Remitted and can no longer be edited — a correction goes through a reversal that references this record.' }, { l: 'Cancel' }],
      note: 'Not editable after save. A wrong remittance is corrected by a reversal that writes a negative-signed record referencing the original, never by deleting or editing it.'
    },

    /* Tax & Compliance §8.5a — Log Withholding Certificate */
    'tax.cert': {
      sections: [['Log Withholding Certificate', [
        { l: 'Customer', type: 'select', req: 1, opts: C.CUSTOMERS, hint: 'Who issued the certificate' },
        { l: 'Certificate Reference', req: 1, ph: 'e.g. CERT-VAY-8890', hint: 'The number printed on the customer\'s certificate. Must be unique per customer' },
        { l: 'Certificate Date', req: 1, v: '05-08-2026', hint: 'Cannot be in the future' },
        { l: 'Covered From', req: 1, v: '01-07-2026', hint: 'The period the certificate covers — often a quarter, not a month' },
        { l: 'Covered To', req: 1, v: '30-09-2026', hint: 'Must be on or after Covered From' },
        { l: 'Tax Head', type: 'select', req: 1, opts: D.masters.taxHeads.filter(t => /Withholding — On (Receipts|Payments &)/.test(t.scope)).map(t => t.name) },
        { l: 'Amount on Certificate (₹)', req: 1, ph: '0.00', hint: 'What the certificate itself states' },
        { l: 'Receipts Covered', type: 'checkgroup', span: 3, opts: D.taxReceipts.filter(r => r.cert === 'No').map(r => ({ v: r.inv, l: r.inv + ' · ' + r.cust + ' · withheld ₹' + r.withheld.toLocaleString('en-IN') + ' · ' + r.date })), checked: [], hint: 'Which receipts this certificate evidences. Ticking them computes Amount Matched; any difference from the stated figure shows as a Variance rather than being silently absorbed.' },
        { l: 'Amount Matched', v: '₹0.00', ro: 1, lock: 'Sum of ticked receipts', hint: 'Computed from the receipts ticked above' },
        { l: 'Variance', v: '₹0.00', ro: 1, lock: 'Certificate − Matched', hint: 'Non-zero means the customer\'s figure differs from ours. **The certified amount is what may be claimed**, not our recorded figure — the authority will accept the certificate, not our spreadsheet. A variance is surfaced for investigation, never auto-corrected in either direction.' },
        { l: 'Certificate Attachment', type: 'file', span: 2, hint: 'The evidence the credit rests on. Expected, not technically blocking' }
      ]]],
      buttons: [{ l: 'Save Certificate', cls: 'primary', toast: 'Certificate logged. The covered receipts move to Certified — Unclaimed.' }, { l: 'Cancel' }]
    },

    /* Tax & Compliance §8.6 — Mark Credit Claimed */
    'tax.claim': {
      sections: [['Mark Credit Claimed', [
        { l: 'Receipts', v: 'INV-2627-0149 · Trinetra Systems Pvt Ltd · ₹1,18,000', ro: 1, span: 2, lock: 'Carried from the row', hint: 'Only a certified receipt can be claimed — an uncertified one has no evidence behind it' },
        { l: 'Certificate Reference', v: 'CERT-TRN-4471', ro: 1, lock: 'From the certificate' },
        { l: 'Amount Claimable', v: '₹1,18,000', ro: 1, lock: 'The CERTIFIED amount', hint: 'Where the certificate and our own record disagree, this is the certificate\'s figure — that is what the authority will accept' },
        { l: 'Claimed In (Period / Return)', req: 1, ph: 'e.g. Q2 FY 2026–27 return', hint: 'Which of the company\'s own filings this credit was taken in' },
        { l: 'Claim Reference', ph: 'Acknowledgement number of that filing', hint: 'Optional — the handle back into the filing' },
        { l: 'Claim Date', req: 1, v: '05-08-2026', hint: 'Cannot be in the future' },
        { l: 'Notes', type: 'textarea', span: 3 }
      ]]],
      buttons: [{ l: 'Mark Claimed', cls: 'primary', toast: 'Credit marked claimed. The receipt moves to Claimed and leaves the outstanding-credit figure.' }, { l: 'Cancel' }]
    },

    /* Masters §3.21a — Edit Email Template */
    'm.emailtemplate': {
      sections: [['Edit Email Template — Payslip Available', [
        { l: 'Triggered From', v: 'Payroll', ro: 1, lock: 'Fixed to the module that fires this email', hint: 'What causes this email to send is defined where the trigger actually happens, not here — this screen only controls whether it sends and what it says' },
        { l: 'Enabled', type: 'toggle', v: 1, req: 1, on: 'Yes', hint: 'Off silences only the email copy of this notification. The in-app bell notification is unaffected — it always fires' },
        { l: 'Subject Line', req: 1, span: 3, v: 'Your payslip for {{month}} is ready', hint: 'Supports placeholders — {{first_name}}, {{month}}, {{ticket_no}} and similar, specific to this trigger. Filled in per recipient at send time' },
        { l: 'Body', type: 'textarea', req: 1, span: 3, v: 'Hi {{first_name}},\n\nYour payslip for {{month}} is now available. Sign in to Meshrd CMS to view or download it.\n\n— Meshrd', hint: 'Plain text in this prototype; the real system would offer a rich-text editor with the same placeholder set' },
        { l: 'Available Placeholders', v: '{{first_name}}, {{month}}', ro: 1, lock: 'Fixed per trigger', hint: 'Only the placeholders this specific trigger actually has data for are usable — an unsupported placeholder would print literally instead of a value' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Email Template saved.' }, { l: 'Send Preview to Myself' }, { l: 'Cancel' }]
    },

    /* Masters §3.21b — Send Test Email */
    'm.emailtest': {
      sections: [['Send Test Email', [
        { l: 'Send To', req: 1, span: 2, ph: 'you@meshrd.in', hint: 'Defaults to your own signed-in address' },
        { l: 'Using Server', v: 'smtp.meshrd.in:587 · STARTTLS', ro: 1, lock: 'From Server Settings', hint: 'Exactly the connection Server Settings currently has configured — this button proves that configuration actually works, not a separate hardcoded test path' }
      ]]],
      buttons: [{ l: 'Send Test Email', cls: 'primary', toast: 'Test email sent. Delivered — check Recent Sends for the result.' }, { l: 'Cancel' }],
      note: 'Sends one real email through the configured server right now, without waiting for a genuine trigger — the fastest way to confirm new credentials actually work before relying on them.'
    },

    /* Masters §3.2 Fields Table — a — Add Tax Head */
    'm.tax.head': {
      sections: [
        ['Tax Details', [
          { l: 'Tax Name', req: 1, span: 2, ph: 'e.g. GST 18% — IGST', hint: 'This name appears in Invoice and Quote dropdowns' },
          { l: 'Tax Type', type: 'select', req: 1, opts: ['GST — IGST', 'GST — CGST + SGST', 'Percentage', 'Fixed Amount', 'Slab', 'Declaration Cap'], hint: 'Picking a type shows only the fields that apply — CGST+SGST shows two rate fields, IGST and Percentage show one, Fixed Amount shows a rupee amount' },
          { l: 'Scope', type: 'select', req: 1, opts: ['Sales / Billing', 'Purchase', 'Sales / Billing & Purchase', 'Payroll — Employee Deduction', 'Payroll — Employer Contribution', 'Payroll — Income Tax', 'Employee Declaration / Exemption', 'Withholding / Deduction at Source'], hint: 'Where the head attaches. Sales / Billing appears in Invoice tax dropdowns; Purchase in Purchase Bill and Expense; Payroll scopes apply to salary runs only. Withholding / Deduction at Source (added 2026-07-31) is the one scope where a tax is DEDUCTED from a payment rather than added to a document; its direction is a field below, not a separate scope.' },
          { l: 'Applies From', req: 1, v: '01-04-2026', hint: 'Date from which this tax applies. Records before this date are not affected.' },
          { l: 'Applies Until', ph: 'dd-mm-yyyy — leave blank if still active', hint: 'Set this to retire the tax from a future date without deleting it' }
        ]],
        ['Rate — shown based on Tax Type', [
          { l: 'Rate (%)', ph: '18', hint: 'For GST — IGST and Percentage types. E.g. enter 18 for 18%' },
          { l: 'CGST Rate (%)', ph: '9', hint: 'For GST — CGST + SGST only. Half the total GST — e.g. 9% CGST + 9% SGST = 18% total' },
          { l: 'SGST Rate (%)', ph: '9', hint: 'For GST — CGST + SGST only. Must equal CGST Rate' },
          { l: 'Fixed Amount (₹)', ph: '0', hint: 'For Fixed Amount type only — a flat charge regardless of the invoice value' },
          { l: 'Declaration Cap (₹)', ph: '150000', hint: 'For Declaration Cap type — the maximum amount an employee can declare under this head per year' }
        ]],
        ['Extra', [
          { l: 'Print Label', ph: 'e.g. IGST @ 18%', hint: 'Short label printed on the invoice or payslip line. Defaults to Tax Name if left blank.' },
          /* THE GATE. Visible on every scope, not only withholding — which is how a
             PAYROLL head joins the same remittance register without duplicating any of
             this. If no head anywhere has this on, Module 15 does not appear at all. */
          { l: 'Creates an Onward Liability', type: 'toggle', on: 'Yes', hint: 'Available on EVERY scope. Yes means the amount this head calculates is money the company holds on somebody elses behalf and must pay to a third party — not revenue, not an expense, and not the counterpartys to receive. This single switch is what puts a head into the Tax & Compliance register (Module 15), and it is how a payroll deduction joins the same register as a supplier withholding. Everything below is revealed by it.' },
          { l: 'Remitted To (Authority)', ph: 'e.g. Income Tax Department, EPFO', hint: 'Whoever this is actually paid to. Groups the register and prints on the remittance record. A label, never arithmetic, so it stays editable after the head figures lock.' },
          { l: 'Remittance Period', type: 'select', opts: ['Monthly', 'Quarterly', 'Half-Yearly', 'Annual', 'Per Document'], hint: 'How often the accumulated amount is deposited. Per Document means each source document is its own obligation with its own due date, rather than being pooled.' },
          { l: 'Period Aligns To', type: 'select', opts: ['Calendar', 'Financial Year', 'Pay Cycle'], hint: 'Calendar — calendar months and quarters. Financial Year — counted from the FY start (§3.1). Pay Cycle — the payroll cycle from Work Week & Hours (§3.20c), which for a payroll head is the only alignment that makes the register agree with the payslips that produced it.' },
          { l: 'Deposit Due — Days After Period End', ph: '7', hint: 'Days added to the last day of the period to get the deadline. Expressed as days rather than a fixed calendar day so it survives short months without a second rule. Drives the Due Date, the Due Soon badge and the Overdue state.' },
          { l: 'Liability Arises On', type: 'select', opts: ['Payment Date', 'Source Document Date'], hint: 'Which date decides the period an amount belongs to. This must match how the authority actually keys the period — set it wrong and every total is right in aggregate but filed against the wrong month. Locks once the first remittance is recorded under this head.' },
          { l: 'Authority Reference Label', ph: 'e.g. Challan Number, ECR Challan Number', hint: 'What this authority calls the reference on its receipt. It labels the field on Record Remittance — which is how no jurisdictions paperwork vocabulary ends up named in the specification or in code.' },
          { l: 'Withholding Direction', type: 'checkgroup', opts: [{ v: 'made', l: 'On Payments Made — we withhold from a supplier' }, { v: 'recv', l: 'On Payments Received — a customer withholds from us' }], checked: ['made'], hint: 'Withholding scope only; at least one required. On Payments Made puts the head in the Purchase Bill dropdown; On Payments Received puts it in Invoice → Record Payment. Both is common — which is why direction is a field on one head rather than two separate scopes.' },
          { l: 'Default Calculated On', type: 'select', opts: ['Subtotal', 'Total'], hint: 'Withholding scope only. Pre-selects the Calculated On dropdown wherever this head is applied. The two bases produce materially different figures.' },
          { l: 'Certificate Expected from Counterparty', type: 'toggle', on: 'Yes', hint: 'Shown when Direction includes On Payments Received: whether the customer is expected to issue a certificate evidencing what they withheld. When on, an uncertified receipt joins the chase queue; when off, its status reads Not Expected and no chase is raised.' },
          { l: 'Notes', type: 'textarea', span: 3, ph: 'Any internal notes — which authority levies it, registration number, etc.' },
          { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active' }
        ]]
      ],
      buttons: [{ l: 'Save Tax', cls: 'primary', toast: 'Tax saved. It will now appear in the relevant dropdowns.' }, { l: 'Cancel' }]
    },

    /* Masters §3.2 Fields Table — b — Slab Band */
    'm.tax.slab': {
      sections: [['Slab Band', [
        { l: 'Band From (₹)', req: 1, ph: '0', hint: 'Lower bound, inclusive' },
        { l: 'Band To (₹)', ph: 'blank = and above', hint: 'Upper bound, inclusive. Blank means and above — exactly one band may leave this blank, and it must be the last' },
        { l: 'Rate (%) or Amount (₹)', req: 1, ph: '0', hint: 'Which of the two is asked for follows the head Calculation Method' },
        { l: 'Band Label', span: 2, ph: 'Optional', hint: 'Optional display name for this band on reports. Bands may not overlap and may not leave a gap — the screen warns inline as bands are entered, not only on save' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Slab band saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.2 Fields Table — c — Split Component */
    'm.tax.split': {
      sections: [['Split Component', [
        { l: 'Component Name', req: 1, span: 2, ph: 'Whatever this portion is called', hint: 'Whatever this portion is called on a document and in a return' },
        { l: 'Share of Total (%)', req: 1, ph: '0.00', hint: 'The portion of the head calculated amount this component represents. Component shares must total 100%' },
        { l: 'Applies When', type: 'select', req: 1, opts: ['Always', 'Only when a condition is met'], hint: 'A head with no component rows is simply a single undivided tax, which is the common case' },
        { l: 'Condition', type: 'textarea', req: 1, span: 3, ph: 'e.g. counterparty location does not match company location', hint: 'Required if Applies When is conditional. Modeled as a simple comparison rather than a general expression language' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Split component saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.2 Fields Table — d — Add Tax Scheme */
    'm.tax.scheme': {
      sections: [['Add Tax Scheme', [
        { l: 'Scheme Name', req: 1, span: 2, ph: 'Whatever the alternatives are called', hint: 'Must be unique' },
        { l: 'Description', type: 'textarea', span: 3, ph: 'What choosing this scheme means for the employee', hint: 'Shown to the employee at the point they choose' },
        { l: 'Is Default', type: 'toggle', req: 1, on: 'Default scheme', hint: 'Exactly one scheme may be the default. Employees who never make a choice are assessed under it' },
        { l: 'Choice Window', type: 'select', req: 1, opts: ['Once per financial year', 'Changeable any time', 'Fixed at joining'], hint: 'When an employee is allowed to switch. Proposed options — the real constraint is a setting, not an assumption' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active. If no schemes are created, the whole concept disappears from the interface' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Tax Scheme saved.' }, { l: 'Cancel' }]
    },

    /* Masters §3.2 Fields Table — e — Relief Rule */
    'm.tax.relief': {
      sections: [['Relief Rule', [
        { l: 'Relief Name', req: 1, span: 2, ph: 'Whatever this relief is called' },
        { l: 'Applies If Base Is At Or Below (₹)', req: 1, ph: '0', hint: 'The threshold under which this relief triggers' },
        { l: 'Relief Type', type: 'select', req: 1, opts: ['Reduce tax by a fixed amount', 'Reduce tax to zero', 'Cap tax at an amount'] },
        { l: 'Relief Amount (₹)', req: 1, ph: '0', hint: 'Required unless Relief Type = Reduce tax to zero. The relief applied is the lesser of this figure and the tax actually computed, so it can never turn into a refund' },
        { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Relief rule saved.' }, { l: 'Cancel' }]
    },

    /* Employee §2.2 Tab: Leave & Attendance Summary — Record Attendance */
    'e.attendance': {
      sections: [
        ['Record Attendance', [
          { l: 'Employee', type: 'select', req: 1, opts: ['Arun Menon', 'Vikram Iyer', 'Sneha Pillai', 'Rohit Deshmukh', 'Ayesha Khan', 'Karthik Nair'], hint: 'Only Super Admin can record attendance manually today' },
          { l: 'Date', v: '29-07-2026', req: 1, hint: 'The attendance date being recorded' },
          { l: 'Day Type', v: 'Working Day', ro: 1, lock: 'Derived', hint: 'Resolved from Masters → Work Week & Hours — Working Day, Week Off, a working or non-working Saturday, or a Holiday. This is what sets Required Hours' },
          { l: 'Check-In Time', req: 1, ph: 'HH:MM', hint: '24-hour time' },
          { l: 'Check-Out Time', req: 1, ph: 'HH:MM', hint: 'Must be after Check-In Time' },
          { l: 'Break Deducted (hours)', v: '1.0', hint: 'Pre-filled from the policy (9 hours gross − 1 hour break = 8 net). Override only when the break actually differed' }
        ]],
        ['Derived — nothing here is typed', [
          { l: 'Gross Hours', v: '—', ro: 1, lock: 'Calculated', hint: 'Check-Out − Check-In' },
          { l: 'Net Worked Hours', v: '—', ro: 1, lock: 'Calculated', hint: 'Gross Hours − Break Deducted. This is the figure payroll uses' },
          { l: 'Required Hours', v: '8.00', ro: 1, lock: 'From policy', hint: 'Net hours per day on the work-week policy that applies to this employee' },
          { l: 'Balance', v: '—', ro: 1, lock: 'Calculated', hint: 'Net Worked − Required. Negative is a shortfall; positive counts toward compensatory credit if the policy allows it' },
          { l: 'Day Status', v: '—', ro: 1, lock: 'Calculated', hint: 'Full Day, Full Day — grace, Half Day or Absent, decided by the hour bands on the policy — not by whether the person turned up' },
          { l: 'Shortfall Treatment', v: 'Compensable within 30 days', ro: 1, lock: 'From policy', hint: 'If the balance is negative: whether the employee may make it up on a day of their choosing, and by when' },
          { l: 'Recorded By', v: 'Ravi Shankar', ro: 1, lock: 'System', hint: 'Holds either a person (Manual Entry today) or a device / system source (e.g. "Biometric — Chennai Office") once biometric goes live — deliberately not a strict user reference' }
        ]]
      ],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Attendance recorded — net worked hours posted against the day.' }, { l: 'Cancel' }]
    },

    /* Employee §2.3 (approval group) / §3.2 — Request Profile Change */
    'e.changereq': {
      sections: [['Request Profile Change', [
        { l: 'Field', v: 'Bank Account Number', ro: 1, lock: 'The field you clicked Request Change on' },
        { l: 'Current Value', v: '50100XXXXXX8842', ro: 1, hint: 'Stays in effect and keeps displaying until HR approves' },
        { l: 'Proposed New Value', req: 1, ph: 'New value', hint: 'You cannot submit another change to the same field until this one is resolved' },
        { l: 'Note', type: 'textarea', span: 3, ph: 'Optional context for HR' },
        { l: 'Status', v: 'Pending', ro: 1, lock: 'System', hint: 'Pending → Approved (the Master Record updates) or Rejected (the value stays, with HR\'s reason shown back to you)' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Change request submitted to HR.' }, { l: 'Cancel' }]
    },

    /* Employee §2.7 — Upload Document */
    'e.upload': {
      sections: [['Upload Document', [
        { l: 'Document Type', type: 'select', req: 1, opts: ['ID Proof', 'Educational Certificate', 'Resume', 'Offer Letter Copy', 'Others'], hint: 'More than one file can be uploaded under the same Document Type' },
        { l: 'File', type: 'file', req: 1, v: 'Choose file', hint: 'PDF, JPG or PNG, up to 5 MB' },
        { l: 'Note', span: 2, ph: 'e.g. Degree certificate, page 2 of 2', hint: 'Optional context for HR' },
        { l: 'Status', v: 'Verified', ro: 1, lock: 'Auto-verified', hint: 'Super Admin uploads are automatically marked Verified — no HR approval needed. Other roles start at Pending Verification.' }
      ]]],
      buttons: [{ l: 'Upload', cls: 'primary', toast: 'Document uploaded and automatically marked Verified.' }, { l: 'Cancel' }]
    },

    /* Employee §2.7 (HR Document Verification Queue) — Reject Document */
    'e.docreject': {
      sections: [['Reject Document', [
        { l: 'Rejection Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this document was rejected', hint: 'Required before Reject can be confirmed. Sent to the employee with the notification so they can correct and re-upload' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Document rejected; the employee is notified with the reason.' }, { l: 'Cancel' }]
    },

    /* Employee §2.10 — Raise Asset Request */
    'e.assetreq': {
      sections: [['Raise Asset Request', [
        { l: 'Asset', type: 'select', req: 1, opts: ['AST-2026-0001 · MacBook Pro 14" M3', 'AST-2026-0003 · Dell UltraSharp U2723QE', 'AST-2026-0009 · ID Card'], hint: 'Pre-filled when raised from a specific row. Must be one of your currently assigned assets' },
        { l: 'Request Type', type: 'select', req: 1, opts: ['Repair', 'Damage Report', 'Return'] },
        { l: 'Description', type: 'textarea', req: 1, span: 3 },
        { l: 'Photo', type: 'file', span: 2, v: 'Choose file', hint: 'Useful for damage reports specifically, to show the issue. PDF/JPG/PNG up to 5 MB' }
        /* Submitting routes the request to the employee\'s Reporting Manager for approval; Super Admin can also act on any request. */
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Request raised.' }, { l: 'Cancel' }]
    },

    /* Employee §2.12 — Post Announcement */
    'e.announce': {
      sections: [['Post Announcement', [
        { l: 'Title', req: 1, span: 2, ph: 'Short headline for the announcement' },
        { l: 'Message', type: 'textarea', req: 1, span: 3 },
        { l: 'Post To', type: 'select', req: 1, opts: ['All Employees', 'Engineering', 'Sales', 'Support', 'Accounts', 'Human Resources', 'Design'], hint: 'All Employees, or a specific Department. Everyone in scope sees it in the feed and on their Dashboard mini feed' },
        { l: 'Expiry Date', ph: 'dd-mm-yyyy', hint: 'After this date it stops showing on dashboards' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Announcement posted.' }, { l: 'Cancel' }]
    },

    /* Leave §2.1 — Apply for Leave */
    'l.apply': {
      sections: [['Apply for Leave', [
        { l: 'Employee', v: 'Ayesha Khan', ro: 1, lock: 'Locked to you', hint: 'Read-only, locked to the logged-in person. Cannot be changed on this screen — this is what makes it "my" leave.' },
        { l: 'Leave Type', type: 'select', req: 1, opts: ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Comp Off', 'Work From Home'], hint: 'From Masters → Leave Types. A Default Annual Quota of 0 (e.g. Work From Home) does not consume a balance — Remaining shows "Not tracked" and the balance check below does not apply to that type.' },
        { l: 'From Date', req: 1, v: '18-08-2026', ph: 'dd-mm-yyyy' },
        { l: 'To Date', req: 1, v: '22-08-2026', ph: 'dd-mm-yyyy', hint: 'Must be on or after From Date' },
        { l: 'Half-Day', type: 'toggle', on: 'No', hint: 'If Yes, a First Half / Second Half choice appears' },
        { l: 'First Half / Second Half', type: 'select', opts: ['First Half', 'Second Half'], hint: 'Shown only when Half-Day is Yes' },
        { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'Why you need the leave' },
        { l: 'Days Requested', v: '5', ro: 1, lock: 'Calculated', hint: 'Working days between From Date and To Date, excluding weekends and Mandatory holidays from the Company Holiday Calendar (§2.4), minus 0.5 for a Half-Day' },
        { l: 'Remaining for this Leave Type', v: '11', ro: 1, lock: 'From your balance', hint: 'Allowed + Carried Forward − Taken − Pending. If Days Requested exceeds this, submission is blocked outright with the exact shortfall — "You have 2 days remaining for Casual Leave, but requested 4." There is no submit-anyway option; the fix is an HR balance adjustment (§2.3).' },
        { l: 'Overlap Check', v: 'No clash with an existing request', ro: 1, lock: 'Validated on submit', hint: 'A separate hard check blocks a request that overlaps dates with an existing Pending or Approved request from the same person' },
        { l: 'Status', v: 'Pending', ro: 1, lock: 'Set on submit', hint: 'Every new request is created at Status = Pending' },
        { l: 'Routed To', v: 'Vikram Iyer (Reporting Manager)', ro: 1, lock: 'Auto-routed', hint: 'Reporting Manager by default → HR if none is set, or if the applicant is a Manager/Accountant/HR person → Super Admin if HR is unavailable or is the applicant. HR can step in on any request at any time.' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Leave request submitted.' }, { l: 'Cancel' }]
    },

    /* Leave §2.6 — Compensatory Hours request. The employee picks their own make-up day. */
    'l.comp': {
      sections: [
        ['The Shortfall', [
          { l: 'Employee', v: 'Arun Menon', ro: 1, lock: 'Locked to you', hint: 'Read-only, locked to the logged-in person — you can only compensate your own hours' },
          { l: 'Shortfall Date', type: 'select', req: 1, opts: ['09-06-2026 — Half Day, 3.58 h short', '24-06-2026 — Full Day (grace), 0.17 h short', '— Other date —'], hint: 'Only dates that actually recorded a shortfall appear here, pulled from your attendance. You cannot invent a shortfall to earn credit' },
          { l: 'Hours Short', v: '3.58', ro: 1, lock: 'From attendance', hint: 'Required Hours − Net Worked Hours for that date. This is the ceiling on what you may claim' },
          { l: 'Day Status That Day', v: 'Half Day', ro: 1, lock: 'From attendance', hint: 'What the day currently counts as. Approving this request lifts it back to Full Day' },
          { l: 'Reason for the Shortfall', type: 'textarea', req: 1, span: 3, ph: 'e.g. Family medical emergency — left after half day', hint: 'Required. Your manager sees this when deciding' }
        ]],
        ['Your Make-Up Day', [
          { l: 'Make-Up Date', req: 1, ph: 'dd-mm-yyyy', v: '27-06-2026', hint: 'Your choice. Must fall inside the 30-day compensation window on your work-week policy, and cannot be a Mandatory holiday' },
          { l: 'Day Type', v: '4th Saturday — Week Off', ro: 1, lock: 'Derived', hint: 'Resolved from Masters → Work Week & Hours. Your policy permits make-up on a non-working Saturday, which is why this date is accepted' },
          { l: 'Hours You Will Work', req: 1, v: '4.0', hint: 'Must be at least the hours short. Anything beyond that is not banked as extra credit — it simply closes the shortfall' },
          { l: 'Planned Check-In', ph: 'HH:MM', v: '10:00' },
          { l: 'Planned Check-Out', ph: 'HH:MM', v: '14:30', hint: 'A break is only deducted if the stretch runs past 6 hours' },
          { l: 'Window Check', v: 'Inside the window — 18 days after the shortfall', ro: 1, lock: 'Validated on submit', hint: 'A make-up date past the window is refused outright, with the last permissible date stated' },
          { l: 'Monthly Cap Check', v: '4.0 of 16 h used this month', ro: 1, lock: 'Validated on submit', hint: 'Against Max Compensatory Hours per Month on your policy' }
        ]],
        ['Routing', [
          { l: 'Status', v: 'Pending', ro: 1, lock: 'Set on submit', hint: 'Pending → Approved (hours credited, the shortfall clears, payroll stops deducting) or Rejected (the shortfall stands and becomes Loss of Pay)' },
          { l: 'Routed To', v: 'Vikram Iyer (Reporting Manager)', ro: 1, lock: 'Auto-routed', hint: 'Same routing as leave: Reporting Manager → HR if none is set → Super Admin. HR can step in on any request' },
          { l: 'Payroll Impact if Rejected', v: '₹1,612 — 3.58 h at pro-rata', ro: 1, lock: 'Calculated', hint: 'Shown up front so nobody is surprised by the payslip. Uses the Uncompensated Shortfall Becomes setting on your policy' }
        ]]
      ],
      buttons: [{ l: 'Submit Request', cls: 'primary', toast: 'Compensatory hours requested — routed to Vikram Iyer.' }, { l: 'Cancel' }]
    },

    /* Leave §2.2 — Reject Leave Request */
    'l.reject': {
      sections: [['Reject Leave Request', [
        { l: 'Employee', v: 'Sneha Pillai', ro: 1, lock: 'From the request' },
        { l: 'Leave Type', v: 'Casual Leave', ro: 1, lock: 'From the request' },
        { l: 'Dates', v: '04–06 Aug 2026 · 3 days', ro: 1, lock: 'From the request' },
        { l: 'Rejection Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this request is being refused', hint: 'Required on every rejection (§6.2 — flipped from optional to required this revision). The applicant is notified by email and in-app, with the reason.' },
        { l: 'Status After Rejection', v: 'Rejected', ro: 1, lock: 'Set on save', hint: 'Remaining is unaffected — the days were only ever held in Pending, never deducted from Taken' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Rejected; the applicant is notified with the reason.' }, { l: 'Cancel' }]
    },

    /* Leave §2.3 — Adjust Balance */
    'l.adjust': {
      sections: [['Adjust Balance', [
        { l: 'Employee', v: 'Sneha Pillai', ro: 1, lock: 'From the row', hint: 'Adjustment is made per employee and Leave Type' },
        { l: 'Leave Type', v: 'Casual Leave', ro: 1, lock: 'From the filter', hint: 'The Leave Type currently selected in the balance table filter' },
        { l: 'Current Remaining', v: '6.5', ro: 1, lock: 'Calculated', hint: 'Allowed + Carried Forward − Taken − Pending, before this adjustment' },
        { l: 'Adjustment Amount', req: 1, ph: 'e.g. +5 or −2', hint: 'Number — can be positive or negative. +5 to grant extra days, −2 to correct an over-grant.' },
        { l: 'Reason / Note', type: 'textarea', req: 1, span: 3, ph: 'e.g. Pro-rated first-year allowance / Correcting duplicate grant', hint: 'Required on every adjustment — this is the audit trail' },
        { l: 'New Remaining', v: '11.5', ro: 1, lock: 'Calculated', hint: 'Current Remaining + Adjustment Amount — previewed before saving' },
        { l: 'Adjusted By', v: 'Nisha Kulkarni', ro: 1, lock: 'System', hint: 'The logged-in user; written to Adjustment History on save' },
        { l: 'Date', v: '29-07-2026', ro: 1, lock: 'System', hint: 'Auto-stamped and written to Adjustment History on save. The employee is also notified that an adjustment was made, with the reason.' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Balance adjusted and logged.' }, { l: 'Cancel' }]
    },

    /* Leave §2.3 — Run Year-End Carry-Forward */
    'l.carryfwd': {
      sections: [['Run Year-End Carry-Forward', [
        { l: 'From Financial Year', type: 'select', req: 1, opts: ['FY 2026–27', 'FY 2025–26'], hint: 'From Masters → Financial Year. The year whose Remaining balances are being carried out.' },
        { l: 'To Financial Year', v: 'FY 2027–28', ro: 1, lock: 'Derived', hint: 'The financial year immediately following the one selected — e.g. "Run carry-forward from FY2026 to FY2027"' },
        { l: 'Leave Types In Scope', v: 'Earned Leave', ro: 1, lock: 'From Masters', hint: 'Only Leave Types where Masters → Leave Types has Carry Forward Allowed = Yes (Masters §3.4). Nothing new is needed there.' },
        { l: 'Cap Applied Per Type', v: 'Max Carry Forward Days (Earned Leave: 30)', ro: 1, lock: 'From Masters', hint: 'Each employee\'s Remaining is carried over, capped at that type\'s Max Carry Forward Days. Anything above the cap is not carried forward.' },
        { l: 'Employees In Scope', v: '148 active employees', ro: 1, lock: 'Calculated' },
        { l: 'Total Days To Carry Forward', v: '412', ro: 1, lock: 'Calculated', hint: 'Sum across the preview, after caps are applied' },
        { l: 'Preview Before Committing', type: 'toggle', v: 1, on: 'Always on', ro: 1, lock: 'Mandatory step', hint: 'A per-employee, per-type preview of exactly what will be carried forward is shown before committing, with a confirm-before-you-go prompt. This is a manual, deliberate action — never recalculated silently in the background — and running it twice or on the wrong financial year would be hard to undo cleanly.' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Carry-forward preview generated.' }, { l: 'Cancel' }]
    },

    /* Leave §2.3 — Adjustment History */
    'l.adjhistory': {
      sections: [['Adjustment History', [
        { k: 'date', t: 'Date', c: 'mono' },
        { k: 'type', t: 'Leave Type', c: 'cell-strong' },
        { k: 'amt', t: 'Amount', c: 'mono r', th: 'r' },
        { k: 'reason', t: 'Reason' },
        { k: 'by', t: 'Adjusted By' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Adjustment history is read-only.' }, { l: 'Cancel' }]
    },

    /* Payroll §2.1a — Add Ad-hoc Adjustment */
    'p.adhoc': {
      sections: [['Add Ad-hoc Adjustment', [
        { l: 'Applies To', type: 'select', req: 1, span: 2, opts: ['One specific employee…', 'Multiple employees…', 'All Active Employees'], hint: 'The bulk option covers a company-wide addition like a festival bonus everyone gets in the same month, so it does not have to be entered one person at a time' },
        { l: 'Label', req: 1, span: 2, ph: 'e.g. Diwali Bonus, Laptop Advance Recovery, October Tax Correction', hint: 'Free text — whatever the Accountant or Super Admin actually knows this to be. It prints on the employee payslip exactly as typed, never as a generic "Adjustment"' },
        { l: 'Type', type: 'select', req: 1, opts: ['Addition', 'Subtraction'] },
        { l: 'Amount (₹)', req: 1, ph: '0.00', hint: 'Must be a positive number; Type above determines whether it adds to or subtracts from pay' },
        { l: 'Taxable', type: 'toggle', req: 1, v: 1, on: 'Yes — counts as taxable income', hint: 'Whether this amount counts as taxable income when an income-tax head computes its base. Defaults to Yes, but needs a human decision each time. Has no effect if no income-tax head is configured' },
        { l: 'Recurring', type: 'toggle', req: 1, on: 'Yes — every run until removed', hint: 'If Yes, applies to every payroll run from this one forward until removed. If No, applies once, to the next run only' },
        { l: 'Note / Reason', type: 'textarea', span: 3, ph: 'e.g. Approved by Ravi Shankar, see email dated 22-07-2026', hint: 'Internal context only — never printed on the payslip' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Adjustment queued for the next payroll run.' }, { l: 'Cancel' }]
    },

    /* Payroll §2.2 (also §3.2 step 2, §7 item 4) — Request Salary Certificate */
    'p.salcert': {
      sections: [['Request Salary Certificate', [
        { l: 'Purpose', span: 2, ph: 'e.g. Visa application, Loan application', hint: 'Optional — these letters commonly state their purpose, but it is not a blocking requirement. Leaving it blank produces a general-purpose certificate' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Salary Certificate generated.' }, { l: 'Cancel' }]
    },

    /* Payroll §2.4 — Reissue Payslip */
    'p.reissue': {
      sections: [['Reissue Payslip', [
        { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this payslip is being corrected', hint: 'Required either way — whether the payslip is recalculated from updated attendance/leave data or specific figures are adjusted manually. Recorded in Reissue History alongside Date, Reissued By, and the old figures next to the new' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Payslip reissued; a Reissue History entry records the old and new figures.' }, { l: 'Cancel' }]
    },

    /* Asset Management §2.4 Tab on the asset record — Maintenance & Service Log — Add Maintenance Entry */
    'a.maint': {
      sections: [['Add Maintenance Entry', [
        { l: 'Date', req: 1, v: '29-07-2026', hint: 'Cannot be in the future' },
        { l: 'Description', type: 'textarea', req: 1, span: 3, ph: 'What was done', hint: 'Pre-filled from the original request when the entry is system-generated by an approved Repair / Damage request (§2.6)' },
        { l: 'Cost (₹)', ph: '0.00', hint: 'Must be a positive number if provided. Left blank on system-generated entries until the Accountant fills it in once known' },
        { l: 'Next Due Date', hint: 'For recurring service (e.g. annual servicing) — must be after Date' },
        { l: 'Source', v: 'Manual entry', ro: 1, hint: 'Reads "System-generated" when the entry was created automatically by an approved Repair or Damage request (§2.6)' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Maintenance entry saved.' }, { l: 'Cancel' }]
    },

    /* Asset Management §2.8 Row action — "Mark Returned" — Mark Returned */
    'a.reclaim': {
      sections: [['Mark Returned', [
        { l: 'Return Outcome', type: 'select', req: 1, opts: ['Returned, working condition', 'Not working / damaged'], span: 2, hint: 'Returned → Status In Store and Assigned To cleared, the same effect as Unassign (§2.3). Not working → Status Retired-Disposed' },
        { l: 'Effective Date', req: 1, v: '29-07-2026', hint: 'Closes the current Assignment History row for this employee' },
        { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'Why the asset cannot go back into store', hint: 'Required when the outcome is Not working / damaged — this path is not reversible from this screen, so it also shows the confirm-before-you-go prompt' },
        { l: 'Retired Date', v: '29-07-2026', ro: 1, hint: 'Recorded as today automatically when the outcome is Not working / damaged; feeds the Retired / Disposed view in Asset Reports (§2.7)' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Asset return recorded.' }, { l: 'Cancel' }]
    },

    /* Ticket §2.3 — Close Ticket */
    't.close': {
      sections: [['Close Ticket', [
        { l: 'Satisfaction Rating', type: 'select', opts: ['— Not recorded —', '5 — Very Satisfied', '4 — Satisfied', '3 — Neutral', '2 — Unsatisfied', '1 — Very Unsatisfied'], span: 2, hint: 'Optional. Recorded by whoever closes the ticket, based on what the customer said — not an automated customer survey. Becomes mandatory when \"Require Satisfaction Rating on Close\" is ON (Section 6.2).' },
        { l: 'Status', v: 'Closed', ro: 1, hint: 'Set by this action — the rating prompt only appears when Status moves to Closed.' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Ticket closed.' }, { l: 'Cancel' }]
    },

    /* Project §2.5 — Start Sprint */
    'pr.sprintstart': {
      sections: [['Start Sprint', [
        { l: 'Sprint Name', req: 1, span: 2, v: 'Sprint 15 — Migration & UAT', ph: 'e.g. Sprint 15 — Migration & UAT' },
        { l: 'Start Date', req: 1, v: '04-08-2026' },
        { l: 'End Date', req: 1, v: '17-08-2026', hint: 'Must be after Start Date' },
        { l: 'Status', type: 'select', req: 1, opts: ['Active', 'Planned', 'Completed'], ro: 1, lock: 'Set on creation', hint: 'Start Sprint creates the sprint at Status = Active. Complete Sprint sets it to Completed — any task still not Done returns to the Backlog.' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Sprint started.' }, { l: 'Cancel' }]
    },

    /* Project §2.5 — Update Sprint */
    'pr.sprintupdate': {
      sections: [['Update Sprint', [
        { l: 'Sprint', v: 'Sprint 14 — SSO & Exports', ro: 1, lock: 'Active sprint', hint: 'Only an Active sprint can be updated' },
        {
          l: 'Tasks in this Sprint', type: 'checkgroup', span: 3,
          opts: D.tasks.map(t => ({ v: t.id, l: t.id + ' — ' + t.t })),
          checked: D.tasks.filter(t => t.sprint === 'Sprint 14 — SSO & Exports').map(t => t.id),
          hint: 'Every task on this project — checked ones belong to the sprint. Checking or unchecking here is what the Sprint column on the Task Board and Task Detail read from.'
        }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Sprint updated — the Task Board and Task Detail reflect the new membership immediately.' }, { l: 'Cancel' }]
    },

    /* Project §2.6 — Report Bug */
    'pr.bug': {
      sections: [['Report Bug', [
        { l: 'Title', req: 1, span: 3, v: 'Export produces an empty PDF above 5k rows' },
        { l: 'Description', type: 'textarea', span: 3, v: 'Any export over roughly 5,000 rows returns a 0-byte PDF. Reproduced on Chrome and Safari; the Excel export of the same set is fine.' },
        { l: 'Severity', type: 'select', req: 1, opts: ['Critical', 'High', 'Medium', 'Low'], hint: 'Shown as a colored badge on the card — Low grey, Medium blue, High orange, Critical red' },
        { l: 'Status', type: 'select', req: 1, opts: ['Open', 'In Progress', 'Fixed', 'Closed'], hint: 'Defaults to Open. This status set is a reasonable default, not a confirmed requirement (§2.6, Assumption 3)' },
        { l: 'Assignee', type: 'select', opts: ['Unassigned'].concat(C.PEOPLE), hint: 'Limited to employees on this project\'s team' },
        { l: 'Due Date', v: '31-07-2026' },
        { l: 'Bug ID', v: 'BUG-0071', ro: 1, hint: 'Auto-generated on save — search covers Bug ID, Title and Description' }
        // Comments — render as the same thread component used on Task Detail (proj.task), not as a field.
        // Anyone on the team can add one; comments are never edited or deleted once posted.
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Bug saved.' }, { l: 'Cancel' }]
    },

    /* Project §2.8 Milestones — Add / Edit Milestone */
    'pr.milestone': {
      sections: [['Add / Edit Milestone', [
        { l: 'Milestone Name', req: 1, span: 2, v: 'Go-live — phase 1' },
        { l: 'Target Date', req: 1, v: '15-09-2026' },
        { l: 'Description', type: 'textarea', span: 3 },
        { l: 'Linked Tasks', type: 'select', span: 2, opts: ['TSK-0141, TSK-0142, TSK-0143'], hint: 'Multi-select of this project\'s tasks. Optional — when set, the milestone shows how many of its linked tasks are Done' },
        { l: 'Status', type: 'select', req: 1, opts: ['Upcoming', 'Reached', 'Missed'], hint: 'Reached is set manually once actually achieved — never inferred from linked-task completion. Missed is set automatically if the Target Date passes while Status is still Upcoming' },
        { l: 'Linked Task Progress', v: '2/11 tasks done', ro: 1, lock: 'Derived', hint: 'Computed from the Linked Tasks that are Done — a rollup view of real progress, not a manually entered figure' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Milestone saved.' }, { l: 'Cancel' }]
    },

    /* Project §2.8 Timesheets — Log Hours */
    'pr.timesheet': {
      sections: [['Log Hours', [
        { l: 'Date', req: 1, v: '29-07-2026', hint: 'Cannot be in the future, and no more than 1 day in the past — log today, or catch up on yesterday. An older correction needs a Manager or Super Admin to make it, not a fresh entry here.' },
        {
          l: 'Task', type: 'select', req: 1,
          opts: D.tasks.map(t => t.id + ' · ' + t.t).concat(['— Not task-specific —', 'Bench / Free Time', 'Internal Meeting', 'Training / Learning', 'Admin & Overhead', 'Other']),
          hint: 'This project\'s tasks, or one of the non-task categories at the bottom of the list — for time that genuinely isn\'t against any task, e.g. free time after finishing one early, an internal meeting, or admin work. Logging it as something rather than leaving it off keeps the day\'s hours honest.'
        },
        { l: 'Hours', req: 1, v: '6.5', hint: 'Must be positive. Capped at 24 per entry; above 12 shows a soft plausibility warning, not a hard block' },
        { l: 'Notes', span: 2, ph: 'What the hours went on' },
        { l: 'Person', v: 'Arun Menon', ro: 1, lock: 'Auto-set', hint: 'Auto-set to the logged-in team member — never editable' },
        { l: 'Status', type: 'select', opts: ['Submitted', 'Draft', 'Approved'], ro: 1, lock: 'Workflow-managed', hint: 'Submitted when the team member logs it, then Approved by the Project Lead, Manager or Super Admin. Only Approved hours count toward Payroll\'s hour-basis input (Module 6) — non-task entries approve the same way as task entries' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Hours logged — Submitted, pending Project Lead approval.' }, { l: 'Cancel' }]
    },

    /* Customer §2.3 Tab: Contacts — Add / Edit Contact */
    'c.contact': {
      sections: [['Add / Edit Contact', [
        { l: 'Name', req: 1, span: 2, v: 'Priya Nandakumar' },
        { l: 'Designation', v: 'IT Manager', ph: 'e.g. Procurement Manager' },
        { l: 'Email', v: 'priya.n@trinetra.in', hint: 'Standard email format' },
        { l: 'Phone', v: '98410 22001', hint: '10-digit Indian mobile number' },
        { l: 'Primary Contact', type: 'toggle', v: 1, on: 'Primary contact', hint: 'Only one contact per customer can be Primary — marking this one automatically un-marks the previous. Deleting the Primary leaves the customer with none; no replacement is auto-promoted' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Contact saved.' }, { l: 'Cancel' }]
    },

    /* Expense §2.1 — Add Expense */
    'x.add': {
      sections: [['Add Expense', [
        { l: 'Type', type: 'select', req: 1, opts: D.masters.expenseTypes.filter(t => t.status === 'Active').map(t => t.name + ' — ' + t.kind), hint: 'From Masters → Expense Types (Section 3.3) — Active types only, each showing its Claim Type. Reimbursable types are open to everyone and end in a payout to the claimant. Company-Paid types (Wi-Fi, rent, hosting, electricity) are the company\'s own running bills and are listed only for Super Admin and Accountant — an ordinary employee never sees them, because nobody is owed anything on one.' },
        { l: 'Claim Type', v: 'Reimbursable', ro: 1, lock: 'Carried from the Type', hint: 'Derived from the selected Expense Type, never chosen separately. Reimbursable enters the reimbursement queue; Company-Paid skips it entirely and is simply settled from the company account below.' },
        { l: 'Vendor', type: 'select', span: 2, opts: ['— None —', 'Sundaram Office Supplies', 'Chola Technologies', 'Gokul Facility Services', 'Anand Travels', 'Bharat Print House', '+ Add New Vendor'], hint: 'Optional. From the Vendor module. "+ Add New Vendor" opens the same inline modal documented in Module 7, Section 3.2 — captures a Vendor Name and selects it back here without losing progress on this form' },
        { l: 'Amount (₹)', req: 1, ph: '0.00', hint: 'Must be a positive number. The total the claimant actually paid, tax included' },
        { l: 'Tax', type: 'select', opts: ['— None —', 'Input Tax — Purchases (18.00%)'], hint: 'Optional and never blocks submission. From Masters → Taxes (Section 3.2) — Purchase-scope heads in force on the expense date. The whole tax pair is hidden if no Purchase-scope head is configured' },
        { l: 'Tax Amount (₹)', ph: '0.00', hint: 'Optional, directly enterable. Recorded as a component of Amount, NOT added on top — unlike Invoice and Purchase Bill, tax never increases the total here' },
        { l: 'Date', req: 1, v: '29-07-2026', hint: 'dd-mm-yyyy. Cannot be in the future — treated as the date of purchase' },
        { l: 'Linked Purchase Bill', type: 'select', opts: ['— None —'].concat(D.bills.map(b => b.id + ' · ' + b.vendor + ' · ₹' + b.total.toLocaleString('en-IN'))), hint: 'Optional, and deliberately so — most claims have no supplier bill behind them. Link one when the same spend also arrived as a vendor invoice (a Wi-Fi bill paid on a personal card, a software renewal the vendor also invoiced). The link is what stops the company paying twice: the bill and the claim settle as one amount, and the Purchase Bill shows the claim back on its own record.' },
        { l: 'Description', type: 'textarea', req: 1, span: 3, ph: 'e.g. Client visit — Pune, cab + tolls', hint: 'Required. This is the line the approver reads and the line that appears on the bank-statement export, so "Travel — ₹8,450" alone is not enough: say what it was for, where, and for whom. A claim with no usable description is the single most common reason an approval stalls.' },
        { l: 'Receipt', type: 'file', span: 2, hint: 'Image or PDF. Not required to submit — the "Require a Receipt Before Approval" toggle (Section 6.1) decides whether a missing receipt blocks approval. Upload shows a thumbnail preview, not just a filename' },
        { l: 'Bank Account', type: 'select', opts: ['— None —'].concat(D.masters.bank.filter(b => b.status === 'Active').map(b => b.name)), hint: 'From Company Profile in Masters (Section 3.7) — which company account this expense is recorded against, and for a Company-Paid type, paid straight out of. Optional while the claim is Pending; it is what the bank-statement export groups and reconciles by, so a Reimbursed claim without one cannot be tied back to a real statement line.' },
        { l: 'Status', v: 'Pending', ro: 1, lock: 'Set by the system', hint: 'Never set by the person submitting. Defaults to Pending the moment the form is saved, and only changes when someone with approval rights acts on it (Section 2.2)' },
        { l: 'Expense Record ID', v: 'EXP-00192', ro: 1, lock: 'Internal record ID', hint: 'No formal auto-generated code applies here, unlike Invoice or Purchase Bill — an expense is never shared outside the company, so it carries only an internal record ID' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Expense submitted — status Pending.' }, { l: 'Cancel' }]
    },

    /* Expense §2.2 — Reject Expense */
    'x.reject': {
      sections: [['Reject Expense', [
        { l: 'Expense', v: 'Karthik Nair · Meals · ₹4,820 · 24-07-2026', ro: 1, span: 2, lock: 'The claim being rejected', hint: 'Carried through from the approvals queue row' },
        { l: 'Current Status', v: 'Pending', ro: 1, hint: 'Only a Pending expense can be rejected' },
        { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this claim is being rejected — the submitter sees this', hint: 'Required, not optional — flipped in this revision for consistency with Documents, Asset Requests and Leave (Module 5)' },
        { l: 'Status After Rejection', v: 'Rejected', ro: 1, lock: 'Set on save', hint: 'Status becomes Rejected; no further action happens to it. The submitter is notified of the outcome' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Rejected; the claimant is notified with the reason.' }, { l: 'Cancel' }]
    },

    /* Expense §2.3 — Mark as Reimbursed */
    'x.reimburse': {
      sections: [['Mark as Reimbursed', [
        { l: 'Expense', v: 'Rohit Deshmukh · Software · ₹2,400 · 20-07-2026', ro: 1, span: 2, lock: 'Selected from the list', hint: 'Available only on an expense whose Status is Approved' },
        { l: 'Approved By', v: 'Nisha Kulkarni · 21-07-2026', ro: 1, hint: 'Carried from the approval record' },
        { l: 'Reimbursed Date', req: 1, v: '29-07-2026', hint: 'Defaults to today. dd-mm-yyyy' },
        { l: 'Mode', type: 'select', req: 1, opts: ['Bank Transfer', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash'], hint: 'From Masters → Payment Mode (Section 3.8) — how the reimbursement was paid out' },
        /* This is where `acc` actually gets set on the expense row — My Expenses and
           All Expenses only ever show a Bank Account once Status reaches Reimbursed
           (see Expense §2.1), and this screen is the one place that transition
           happens. Leaving it off here was the gap: the column existed downstream
           with nothing upstream to populate it. */
        { l: 'Reimbursed From (Bank Account)', type: 'select', req: 1, opts: D.masters.bank.filter(b => b.status === 'Active').map(b => b.name), hint: 'Which Meshrd account actually paid this out — required, since a real payment has to leave a real account. This is what fills the Bank Account column on My Expenses and All Expenses, and what the bank-statement export reconciles against' },
        { l: 'Reference', span: 2, ph: 'e.g. a transaction ID' },
        { l: 'Status', v: 'Reimbursed', ro: 1, lock: 'Set on save', hint: 'Marking this sets Status to Reimbursed. A manual confirmation that a real payment happened elsewhere (bank transfer, cash handout) — this module tracks that reimbursement occurred, it does not move money itself' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Marked Reimbursed.' }, { l: 'Cancel' }]
    },

    /* Roles §4.3 — Add Permission Override */
    'r.override': {
      sections: [['Add Permission Override', [
        { l: 'Employee', type: 'select', req: 1, span: 2, opts: C.PEOPLE, hint: 'Person picker (§4.3 Layout 1) — search/select from active employees. One person at a time; overrides are individual by definition' },
        { l: 'Role', v: 'Manager', ro: 1, lock: 'From the employee record', hint: 'The selected person\'s current role — shown so the role default is visible before overriding it' },
        { l: 'Module', type: 'select', req: 1, opts: ['Masters', 'Employee', 'Asset Management', 'Ticket', 'Leave', 'Payroll', 'Vendor', 'Customer', 'Opportunity', 'Project', 'Invoice', 'Expense', 'Purchase Bill'], hint: 'From the 13 modules in §3' },
        { l: 'Screen', type: 'select', req: 1, span: 2, opts: ['Team Payslips', 'Employee Master Record — Salary Structure tab', 'Employee Directory', 'Customer Directory', 'Customer 360', 'Asset Directory', 'Project Report'], hint: 'Filtered to the selected Module — only that module\'s screens are offered' },
        { l: 'Permission', type: 'select', req: 1, span: 3, opts: ['Layer 1 — Screen Visibility (Visible / Hidden)', 'Layer 2 — Action: Add', 'Layer 2 — Action: Edit', 'Layer 2 — Action: Export', 'Layer 3 — Field: Show Salary Amount to Manager', 'Layer 4 — Scope: All / Team / Own'], hint: 'Filtered to what that screen actually has — a Layer 1 visibility flip, a specific Layer 2 action, a specific Layer 3 field, or the Layer 4 scope. Only options that genuinely exist on that screen appear (§2)' },
        { l: 'Grant or Revoke', type: 'select', req: 1, opts: ['Grant', 'Revoke'], hint: 'Grant adds something the person\'s role default doesn\'t have; Revoke removes something it does' },
        { l: 'Role Default (for reference)', v: 'Hidden — Employee cannot see Team Payslips', ro: 1, span: 2, lock: 'Read from the Role Permission Matrix (§4.2)', hint: 'The baseline this override departs from. Every saved override row is marked "different from role default" (§6)' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Override applied to this one person only.' }, { l: 'Cancel' }]
    },

    /* Asset Management §2.8 — the Mark Returned choice itself (working vs damaged) */
    '_patch.a.reclaim': [
      { l: 'Return Condition', type: 'select', req: 1, opts: ['Returned, working condition', 'Not working / damaged'], hint: 'Working condition behaves like Unassign (Status → In Store). Not working sets Status → Retired-Disposed, with a required reason and a Retired Date of today.' }
    ],
    /* Project §2.6 — Bugs carry a comment thread, same behaviour as Task comments */
    '_patch.pr.bug': [
      { l: 'Comments', type: 'textarea', span: 3, ph: 'Add a comment…', hint: 'Anyone on the team can add a comment; comments are never edited or deleted once posted, only added to.' }
    ],
  };

  /* Merge the hand-completed controls into their forms, then drop the scratch keys. */
  const X = window.FORMS_EXT;
  if (X['a.reclaim'] && X['_patch.a.reclaim']) X['a.reclaim'].sections[0][1] = X['_patch.a.reclaim'].concat(X['a.reclaim'].sections[0][1]);
  if (X['pr.bug'] && X['_patch.pr.bug']) X['pr.bug'].sections[0][1] = X['pr.bug'].sections[0][1].concat(X['_patch.pr.bug']);
  delete X['_patch.a.reclaim']; delete X['_patch.pr.bug'];

  /* ======================================================================
     Second pass — screens drawn by bespoke renderers rather than a FORMS key,
     which the first pass missed. Found by an independent re-audit.
     ====================================================================== */

  /* Masters §3.6b — Company Profile → Addresses → "Add Another Address" */
  X['m.company.address'] = {
    sections: [['Add Another Address', [
      { l: 'Address Type', type: 'select', req: 1, opts: ['Registered Office', 'Branch Office', 'Correspondence'] },
      { l: 'Address Line 1', req: 1, span: 2, ph: 'e.g. No. 14, Habibullah Road, T. Nagar' },
      { l: 'Address Line 2', span: 2 },
      { l: 'City', req: 1, ph: 'e.g. Chennai' },
      { l: 'State', type: 'select', req: 1, opts: ['Tamil Nadu', 'Karnataka', 'Maharashtra', 'Kerala', 'Telangana'], hint: 'Indian states / UTs' },
      { l: 'PIN Code', req: 1, ph: '600017', hint: 'Exactly 6 digits' },
      { l: 'Mark as Primary', type: 'toggle', req: 1, on: 'Primary address', hint: 'Only one address can be Primary at a time; marking a new one automatically un-marks the previous. The Primary address is what General Info shows as Registered Address.' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Address saved.' }, { l: 'Cancel' }]
  };

  /* Masters §3.6e — Company Profile → Number Prefixes → per-row edit pop-up */
  X['m.company.prefix'] = {
    sections: [['Edit Number Prefix', [
      { l: 'Code Type', v: 'Invoice Number', ro: 1, lock: 'Fixed list' },
      { l: 'Prefix', req: 1, v: 'INV', hint: 'Must be 2–6 uppercase letters, no spaces' },
      { l: 'Include Financial Year in Code', type: 'toggle', v: 1, req: 1, on: 'Yes' },
      { l: 'Running Number Digits', req: 1, v: '5', hint: 'Must be between 3 and 6' },
      { l: 'Starting Number', req: 1, v: '00001', ro: 1, lock: 'Locked — 153 already generated', hint: 'Cannot be changed once any code of that type has been generated; only the prefix and future behaviour can be adjusted going forward' },
      { l: 'Resets Every Financial Year', type: 'toggle', v: 1, req: 1, on: 'Yes', hint: 'When Yes, the running number restarts at the Starting Number on the first record created in each new financial year' },
      { l: 'Example Preview', span: 2, v: 'INV-2026-00154', ro: 1, lock: 'Live preview', hint: 'Exactly what the next generated code will look like' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Prefix saved. Existing codes are never rewritten — the change applies to codes generated from now on.' }, { l: 'Cancel' }]
  };

  /* Asset Management §2.6 — rejecting an Asset Request needs a reason */
  X['a.reqreject'] = {
    sections: [['Reject Asset Request', [
      { l: 'Request', v: 'Rohit Deshmukh · Repair · AST-2026-0003 · 26-07-2026', ro: 1, span: 2, lock: 'From the queue row' },
      { l: 'Request Type', v: 'Repair', ro: 1, lock: 'From the request', hint: 'Repair / Damage Report / Return — the three types an employee can raise' },
      { l: 'Rejection Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this request is being refused — the employee sees this', hint: 'Required on every rejection. Shown back to the employee through the notification system.' },
      { l: 'Asset Status After Rejection', v: 'Unchanged — In Use', ro: 1, lock: 'Set on save', hint: 'Rejecting leaves the asset Status untouched; no Maintenance Log entry is created.' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Request rejected; the employee is notified with the reason. Asset Status unchanged.' }, { l: 'Cancel' }]
  };

  /* Customer §2.3 Activities — "+ Add Activity" */
  X['c.activity'] = {
    sections: [['Add Activity', [
      { l: 'Type', type: 'select', req: 1, opts: ['Call', 'Email', 'Meeting', 'Note'] },
      { l: 'Date', req: 1, v: '29-07-2026', hint: 'Defaults to today; can be backdated to log something that already happened' },
      { l: 'Related Contact', type: 'select', opts: ['— None —', 'Priya Nandakumar', 'Ganesh Subramani', 'Lakshmi Venkat'], hint: 'From the Contacts tab — which person at the company this was with, if applicable' },
      { l: 'Logged By', v: 'Meera Joshi', ro: 1, lock: 'Auto-filled', hint: 'The user who added the entry — auto-filled, never editable' },
      { l: 'Description', type: 'textarea', req: 1, span: 3, ph: 'e.g. Quarterly review at their Guindy office' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Activity logged — added to the top of the timeline.' }, { l: 'Cancel' }]
  };

  /* Opportunity §2.3 Activities — "+ Add Activity" */
  X['opp.activity'] = {
    sections: [['Add Activity', [
      { l: 'Type', type: 'select', req: 1, opts: ['Call', 'Email', 'Meeting', 'Note'] },
      { l: 'Date', req: 1, v: '29-07-2026', hint: 'Defaults to today; can be backdated to log something that already happened' },
      { l: 'Related Contact', type: 'select', opts: ['— None —', 'Priya Nandakumar', 'Ganesh Subramani', 'Lakshmi Venkat'], hint: 'From the linked Customer’s Contacts tab — which person this was with, if applicable' },
      { l: 'Logged By', v: 'Meera Joshi', ro: 1, lock: 'Auto-filled', hint: 'The user who added the entry — auto-filled, never editable' },
      { l: 'Description', type: 'textarea', req: 1, span: 3, ph: 'e.g. Walked through the analytics add-on pricing' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Activity logged — added to the top of the timeline.' }, { l: 'Cancel' }]
  };

  /* Opportunity §2.2 — marking a deal Lost requires a reason, immediately */
  X['o.lost'] = {
    sections: [['Mark Opportunity Lost', [
      { l: 'Opportunity', v: 'OPP-2026-0001 · Analytics add-on — Trinetra', ro: 1, span: 2, lock: 'From the record' },
      { l: 'Stage', v: 'Proposal → Lost', ro: 1, lock: 'Set on save' },
      { l: 'Reason', type: 'textarea', req: 1, span: 3, ph: 'Why this deal was lost', hint: 'Required. The prompt appears the moment Stage is changed to Lost — from the Add/Edit form or from a drag into the Lost column — and the change cannot be saved without it.' },
      { l: 'Probability (%)', v: '0', ro: 1, lock: 'Auto-set', hint: 'Lost auto-sets Probability to 0%.' }
    ]]],
    buttons: [{ l: 'Save', cls: 'primary', toast: 'Opportunity marked Lost with its reason recorded.' }, { l: 'Cancel' }]
  };
})();
