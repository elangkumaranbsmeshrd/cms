/* ==========================================================================
   MESHRD CMS PROTOTYPE — ACCESS POLICY (RBAC)

   The single source of truth for who can open a screen, what they may DO on it,
   and which fields they may see or edit. Generated from a full extraction of the
   "Who can open it" lines and Role-Based Access sections of all 14 module specs.

   WHY THIS EXISTS. Access used to be scattered: data.js said who could open a
   screen, and each renderer was trusted to honour `role` for everything else.
   Twenty renderers silently ignored it, so — for one real example — Super Admin
   was shown "Editable — needs HR approval" on their own profile, and every Masters
   create form rendered identically for all five roles. Policy now lives here and is
   enforced inside the shared builders (U.field, U.pageHead, U.table, U.formbar),
   which read the ACTIVE screen and role themselves. A renderer that forgets to use
   its `role` argument therefore still produces correctly restricted output.

   ACCESS MODES
     full       open, and may act within the screen's own action rules
     view       open, but READ-ONLY: every field locks, every mutating action hides
     view:team  read-only AND scoped to the signed-in person's direct reports
     own        may act, but only on their own records
     team       may act, but only on their direct reports' records
     none       screen does not exist for this role (Layer 1 — no nav entry, no route)
   ========================================================================== */
(function () {
  'use strict';

  /* RBAC §2.1 — the 46 documented field/action toggles, at their SPEC DEFAULTS.
     Flip one here to demonstrate the permission it governs. */
  var TOGGLES = {
    'Show Salary Amount to Manager': false,
    'Allow Employee to Edit Bank Details Directly': false,
    'Show Financial Year Management to Manager': false,
    'Allow Manager to Edit Team Member Employment Details': false,
    'Require Manager Acknowledgment Before HR Processes Exit': true,
    'Allow HR to Edit Salary Structure': false,
    'Allow HR to Edit Statutory Applicability Toggles': false,
    'Allow Employee to Change Insurance Plan Mid-Year': false,
    'Allow Accountant to Manage Taxes': false,
    'Allow Manager to Reassign Assets Directly': false,
    'Show Purchase Value to Manager': false,
    'Allow HR to Edit Depreciation Method': false,
    'Allow HR to Edit Core Info': false,
    'Allow Staff to View the Full Open Ticket Queue': false,
    'Allow Staff to Reassign Their Own Ticket': false,
    'Show Support Reports to Staff': false,
    'Allow Staff to Create New Tickets': false,
    'Require Satisfaction Rating on Close': false,
    'Allow Manager to Adjust Team Leave Balance': false,
    'Require HR Co-Approval for Leave Longer Than X Days': false,
    'Allow Manager to Run Payroll': false,
    'Allow HR to Add Ad-hoc Payslip Adjustments': false,
    'Hide Ad-hoc Adjustment Labels from Employee': false,
    'Require Super Admin Approval to Reissue a Payslip': false,
    'Notify Employee When a Payslip Is Reissued': true,
    'Allow Manager to Edit Vendor Bank & GST Details': false,
    'Allow Hard Delete of a Vendor': false,
    'Require Approval to Add a New Vendor': false,
    'Restrict Manager to Only Their Own Customers': false,
    'Give Accountant Read Access to Customer Financial Summary': false,
    'Allow Employee to Log Activities on Customers They\'re Staffed On': false,
    'Restrict Manager to Only Their Own Opportunities': false,
    'Give Accountant Read Access to Pipeline Value': false,
    'Allow Employee to View the Opportunity Behind Their Assigned Project': false,
    'Restrict Manager to Only Projects They Manage': false,
    'Give Accountant Read Access to Project Budgets': false,
    'Allow Employee to Manage Sprints on Their Own Projects': false,
    'Show Project Report to Employee': false,
    'Hide Budget from Employee\'s Project View': false,
    'Allow Manager Read-Only Access to Their Projects\' Invoices': false,
    'Require Second Approval Before an Invoice Locks as Paid': false,
    'Show Non-Financial Dashboard Widgets to HR': false,
    'Allow Manager to Approve Their Team\'s Expenses': false,
    'Require a Receipt Before Approval': false,
    'Set an Auto-Approval Threshold': false,
    'Auto-Mark as Reimbursed When Paid via Payroll': false,
    'Give HR Read-Only Access to the Permission Matrix': false
  };

  /* Per-screen access, generated from the specs. */
  var POLICY = {
    'asset.assign': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'full', employee: 'none' },   /* Asset Management (Module 3) §2.3, §6.2 row 3, §6.4 */
    'asset.depreciation': { superadmin: 'full', manager: 'none', accountant: 'view', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.5, §6.2 row 5 */
    'asset.directory': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.1, §6.2 row 1 */
    'asset.download': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.9, §6.2 row 9 */
    'asset.maintenance': { superadmin: 'full', manager: 'view:team', accountant: 'full', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.4, §6.2 row 4 */
    'asset.reclaim': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Asset Management (Module 3) §2.8, §6.2 row 8 */
    'asset.record': { superadmin: 'full', manager: 'view:team', accountant: 'full', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.2, §6.1, §6.2 row 2 */
    'asset.reports': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'view', employee: 'none' },   /* Asset Management (Module 3) §2.7, §6.2 row 7 */
    'asset.requests': { superadmin: 'full', manager: 'team', accountant: 'none', hr: 'none', employee: 'none' },   /* Asset Management (Module 3) §2.6, §6.2 row 6, §6.4 */
    'cust.360': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Customer 08-customer-module.md §2.3, §5, §6, §6.1 */
    'cust.activity': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Customer 08-customer-module.md §2.3 Tab: Activiti */
    'cust.contact': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Customer 08-customer-module.md §2.3 Tab: Contacts */
    'cust.directory': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Customer 08-customer-module.md §2.1, §6, §6.1 */
    'cust.edit': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Customer 08-customer-module.md §2.2, §3.1, §6 */
    'dashboard': { superadmin: 'own', manager: 'team', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.11 + §6.1 row 18 */
    'emp.announce': { superadmin: 'full', manager: 'view', accountant: 'view', hr: 'full', employee: 'view' },   /* Employee §2.12 + §6.1 row 19 */
    'emp.assets': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.10 + §6.1 rows 16-17 */
    'emp.attendance': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Employee §2.2 (Leave & Attendance Summary tab) +  */
    'emp.directory': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'full', employee: 'none' },   /* Employee §2.1 + §6.1 row 1 */
    'emp.docqueue': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Employee §2.7 (HR Document Verification Queue) +  */
    'emp.documents': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.7 + §6.1 row 11 */
    'emp.letter': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Employee §2.16 + §6.1 row 25 */
    'emp.offboarding': { superadmin: 'full', manager: 'team', accountant: 'none', hr: 'full', employee: 'none' },   /* Employee §2.14 + §6.1 rows 21-22 */
    'emp.onboarding': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Employee §2.13 + §6.1 row 20 */
    'emp.profile': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.3 + §6.1 rows 5-6 */
    'emp.projects': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.9 + §6.1 row 15 */
    'emp.record': { superadmin: 'full', manager: 'view:team', accountant: 'view', hr: 'full', employee: 'none' },   /* Employee §2.2 + §6.1 rows 2-4 */
    'emp.tax': { superadmin: 'full', manager: 'own', accountant: 'view', hr: 'view', employee: 'own' },   /* Employee §2.15 + §6.1 rows 23-24 */
    'emp.tickets': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.8 + §6.1 rows 13-14 */
    'exp.add': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Expense §2.1, §3.1, §3.2 */
    'exp.all': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Expense §2.3, §6 */
    'exp.approvals': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Expense §2.2, §6 */
    'exp.my': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Expense §2.1, §6 baseline */
    'exp.company': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Expense §2.4 — Company-Paid spend, never an employee's business */
    'exp.reimburse': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Expense §2.3, §7.5 */
    'exp.reject': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Expense §2.2, §7.4 */
    'inv.cnlist': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.5 ("The Credit N */
    'inv.creditnote': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.5 (Who can open  */
    'inv.dashboard': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.1 (Who can open  */
    'inv.edit': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.3 (Who can open  */
    'inv.list': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.2 (Who can open  */
    'inv.payment': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Invoice 11-invoice-module.md §2.4 (Who can open  */
    'leave.adjhistory': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.3, §7 item 4 */
    'leave.adjust': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.3, §3.4 */
    'leave.apply': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Leave 05-leave-module.md §2.1, §3.1 */
    'leave.approvals': { superadmin: 'full', manager: 'team', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.2 + the Approval R */
    'leave.balance': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.3, §3.3, §3.4, §6, */
    'leave.carryfwd': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.3, §3.3, §7 item 5 */
    'leave.comp': { superadmin: 'full', manager: 'team', accountant: 'own', hr: 'full', employee: 'own' },   /* Leave §2.6 — compensatory hours. Same shape as leave.approvals: Manager sees their team, HR sees everyone, Employee sees only their own requests */
    'leave.comp.add': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Leave §2.6 — anyone can request make-up hours for their own shortfall */
    'leave.holidays': { superadmin: 'view', manager: 'view', accountant: 'view', hr: 'view', employee: 'view' },   /* Leave 05-leave-module.md §2.4, §7 item 10 */
    'leave.my': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.4 + §6.1 rows 7-8 */
    'leave.reject': { superadmin: 'full', manager: 'team', accountant: 'none', hr: 'full', employee: 'none' },   /* Leave 05-leave-module.md §2.2, §6.2, §7 item 7 */
    'leave.reports': { superadmin: 'full', manager: 'none', accountant: 'view', hr: 'view', employee: 'none' },   /* Leave 05-leave-module.md §2.5, §6, §7 item 9 */
    'masters.assetcategories': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.17 + §3.0 access */
    'masters.bank': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.7 + §3.0 access  */
    'masters.company': { superadmin: 'full', manager: 'view', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.6 + §3.0 access  */
    'masters.customerstatus': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.15 + §3.0 access */
    'masters.department': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.9 + §3.0 access  */
    'masters.designation': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.10 + §3.0 access */
    'masters.employmenttype': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.18 + §3.0 access */
    'masters.expensetypes': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.3 + §3.0 access  */
    'masters.fy': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.1 + §3.0 access  */
    'masters.holidays': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.5 + §3.0 access  */
    'masters.hsn': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.11 + §3.0 access */
    'masters.insurance': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'view', employee: 'none' },   /* Masters 01-masters-module.md §3.19 + §3.0 access */
    'masters.email': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.21 — mail server credentials, Super Admin only */
    /* Tax & Compliance — Module 13 §8. Accountant + Super Admin only: this is the
       company's tax liability and its claimable credits, not anyone else's business.
       Reverse Remittance and Void Certificate stay Super Admin (see ACTIONS). */
    'tax.overview': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* 13-purchase-bill-module.md §8.1 */
    'tax.payable': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.2 */
    'tax.docs': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.2b */
    'tax.remittances': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.3 */
    'tax.receivable': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.4 */
    'tax.certificates': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.5 */
    'tax.remit': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.3a */
    'tax.cert': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.5a */
    'tax.claim': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* §8.6 */
    'masters.leavetypes': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'full', employee: 'none' },   /* Masters 01-masters-module.md §3.4 + §3.0 access; HR=Manage(no delete), generic Deactivate block covers that */
    'masters.paymentmode': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.8 + §3.0 access  */
    'masters.servicecategory': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.12 + §3.0 access */
    'masters.taxes': { superadmin: 'full', manager: 'none', accountant: 'view', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.2 + §3.0 access  */
    'masters.ticketcategories': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.14 + §3.0 access */
    'masters.uom': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters 01-masters-module.md §3.13 + §3.0 access */
    'masters.workweek': { superadmin: 'full', manager: 'view', accountant: 'none', hr: 'view', employee: 'none' },   /* Masters §3.20 — hours/day, break, weekly target, Saturday rule. HR & Manager read it (they answer the questions); only Super Admin changes pay-affecting rules */
    'masters.workweek.add': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters §3.20a */
    'masters.workweek.satrule': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters §3.20b */
    'masters.paycycle.edit': { superadmin: 'full', manager: 'none', accountant: 'none', hr: 'none', employee: 'none' },   /* Masters §3.20c */
    'opp.360': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Opportunity 09-opportunity-module.md §2.3 (Details / Activities / Files) */
    'opp.activity': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Opportunity 09-opportunity-module.md §2.3 Tab: Activities */
    'opp.edit': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Opportunity 09-opportunity-module.md §2.2, §3.1, §3. */
    'opp.lost': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Opportunity 09-opportunity-module.md §2.2 (Marking a */
    'opp.pipeline': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Opportunity 09-opportunity-module.md §2.1, §6, §6.1; */
    'payroll.adhoc': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Payroll 06-payroll-module.md §2.1a ("Who can ope */
    'payroll.attendance': { superadmin: 'full', manager: 'view:team', accountant: 'none', hr: 'view', employee: 'none' },   /* Payroll §2.5 — hour-basis live (net hours × working days from Masters → Work Week); only the biometric feed is planned */
    'payroll.history': { superadmin: 'full', manager: 'none', accountant: 'view', hr: 'view', employee: 'none' },   /* Payroll 06-payroll-module.md §2.1 (Payroll Histo */
    'payroll.mine': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Employee §2.5 + §6.1 row 9 */
    'payroll.register': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'full', employee: 'none' },   /* Payroll 06-payroll-module.md §2.4 ("Who can open */
    'payroll.reissue': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'full', employee: 'none' },   /* Payroll 06-payroll-module.md §2.4 Reissue action */
    'payroll.run': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'full', employee: 'none' },   /* Payroll 06-payroll-module.md §2.1 ("Who can open */
    'payroll.salcert': { superadmin: 'own', manager: 'own', accountant: 'own', hr: 'own', employee: 'own' },   /* Payroll 06-payroll-module.md §2.2 ("Download Sal */
    'payroll.slip': { superadmin: 'full', manager: 'own', accountant: 'full', hr: 'full', employee: 'own' },   /* Payroll 06-payroll-module.md §2.2 ("Opening a pa */
    'pb.edit': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Purchase Bill 13-purchase-bill-module.md §2.2, §3.1, § */
    'pb.list': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Purchase Bill 13-purchase-bill-module.md §2.1, §6, §6. */
    'pb.payment': { superadmin: 'full', manager: 'none', accountant: 'full', hr: 'none', employee: 'none' },   /* Purchase Bill 13-purchase-bill-module.md §2.3, §3.1, § */
    'proj.board': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.3 */
    'proj.bugadd': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.6, §3.3 */
    'proj.bugs': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.6, §6, §3.3 */
    'proj.directory': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.1, §6, §6.1 */
    'proj.edit': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Project §2.2 */
    'proj.loghours': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.8 */
    'proj.milestoneadd': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Project §2.8 */
    'proj.milestones': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'view' },   /* Project §2.8 (Milestones) */
    'proj.report': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Project §2.7, §6.1, §7.5 */
    'proj.sprints': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'view' },   /* Project §2.5, §6, §6.1 */
    'proj.sprintstart': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Project §2.5 */
    'proj.sprintupdate': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Project §2.5 */
    'proj.task': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.4, §3.2 */
    'proj.timesheets': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Project §2.8 (Timesheets), §3.5 */
    'ticket.assign': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Ticket §2.4 Assign / Reassign Ticket (+ §6.2, § */
    'ticket.close': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Ticket §2.3 (Closing a ticket prompt) + §6.2 */
    'ticket.detail': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Ticket §2.3 Ticket Detail / Conversation (+ §6, */
    'ticket.list': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'own' },   /* Ticket §2.1 Ticket List (+ §6, RBAC §2.2) */
    'ticket.new': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Ticket §2.2 New / Edit Ticket (+ §6.2) */
    'ticket.reports': { superadmin: 'full', manager: 'full', accountant: 'none', hr: 'none', employee: 'none' },   /* Ticket §2.5 Support Reports (+ §6.2, RBAC §2.2) */
    'vendor.directory': { superadmin: 'full', manager: 'full', accountant: 'full', hr: 'none', employee: 'none' },   /* Vendor 07 §2.1, §6 */
    'vendor.edit': { superadmin: 'full', manager: 'full', accountant: 'full', hr: 'none', employee: 'none' },   /* Vendor 07 §2.2, §3.1, §3.2, §3.3, §4, §6, §6.1 */
    'vendor.usage': { superadmin: 'view', manager: 'view', accountant: 'view', hr: 'none', employee: 'none' },   /* Vendor 07 §2.3 */
  };

  /* Actions that CHANGE something. A read-only role never sees these; a role with
     'full'/'own'/'team' sees them unless a per-screen rule below says otherwise. */
  var MUTATING = /^(\+|save|add|edit|delete|deactivate|activate|lock|approve|reject|reissue|assign|transfer|unassign|record payment|submit|send|post|run|mark|create|verify|update|complete|start|raise|generate|apply|log |adjust|reassign|revoke|confirm|remove|upload|quick create)/i;

  /* Actions that only ever read. Always allowed to anyone who can open the screen —
     RBAC §2.2f: export is available to every role that can open a list screen. */
  var READ_ONLY_ACTIONS = /^(view|open|export|download|preview|cancel|back|close|clear)/i;

  /* Per-screen action overrides. [] means nobody; a list means only those roles.
     Delete/Deactivate default to Super Admin only everywhere (Masters §3.0 rule 1,
     echoed across modules), so they are not repeated per screen. */
  var ACTIONS = {
    'masters.taxes':      { 'Add Tax Head': function (r) { return r === 'superadmin' || (r === 'accountant' && TOGGLES['Allow Accountant to Manage Taxes']); } },
    'masters.fy':         { 'Lock': ['superadmin'], 'Edit': ['superadmin'] },
    'asset.directory':    { '+ Add Asset': ['superadmin', 'accountant'] },
    'asset.record':       { 'Save': ['superadmin', 'accountant'], 'Mark Retired/Disposed': ['superadmin', 'accountant'] },
    'asset.assign':       { 'Assign': ['superadmin', 'hr'], 'Transfer': ['superadmin', 'hr'], 'Unassign': ['superadmin', 'hr'] },
    'asset.maintenance':  { '+ Add Maintenance Entry': ['superadmin', 'accountant'] },
    'asset.requests':     { 'Approve': ['superadmin', 'manager'], 'Reject': ['superadmin', 'manager'] },
    'ticket.list':        { '+ New Ticket': function (r) { return r === 'superadmin' || r === 'manager' || (r === 'employee' && TOGGLES['Allow Staff to Create New Tickets']); } },
    'ticket.detail':      { 'Reassign': function (r) { return r === 'superadmin' || r === 'manager' || (r === 'employee' && TOGGLES['Allow Staff to Reassign Their Own Ticket']); } },
    'leave.approvals':    { 'Approve': ['superadmin', 'manager', 'hr'], 'Reject': ['superadmin', 'manager', 'hr'] },
    'leave.comp':         { 'Approve': ['superadmin', 'manager', 'hr'], 'Reject': ['superadmin', 'manager', 'hr'] },
    'masters.workweek':   { 'Add Policy': ['superadmin'], 'Save': ['superadmin'], 'Override a Saturday': ['superadmin'], 'Deactivate': ['superadmin'] },
    'leave.balance':      { 'Adjust Balance': ['superadmin', 'hr'], 'Run Year-End Carry-Forward': ['superadmin', 'hr'] },
    'payroll.run':        { 'Confirm & Generate Payslips': function (r) { return r === 'superadmin' || r === 'accountant' || r === 'hr' || (r === 'manager' && TOGGLES['Allow Manager to Run Payroll']); } },
    'payroll.adhoc':      { '+ Add Adjustment': function (r) { return r === 'superadmin' || r === 'accountant' || (r === 'hr' && TOGGLES['Allow HR to Add Ad-hoc Payslip Adjustments']); } },
    'payroll.register':   { 'Reissue': ['superadmin', 'accountant', 'hr'] },
    'exp.approvals':      { 'Approve': ['superadmin', 'accountant'], 'Reject': ['superadmin', 'accountant'] },
    'exp.all':            { 'Mark as Reimbursed': ['superadmin', 'accountant'] },
    'inv.creditnote':     { 'Approve': ['superadmin'] },
    'emp.docqueue':       { 'Verify': ['superadmin', 'hr'], 'Reject': ['superadmin', 'hr'] },
    'emp.record':         { 'Edit': ['superadmin', 'hr'], 'Generate Letter': ['superadmin', 'hr'], 'Raise Exit': ['superadmin', 'hr'], '+ Record Attendance': ['superadmin'] },
    'proj.task':          { 'Delete': ['superadmin', 'manager'] },
    'proj.bugs':          { 'Delete': ['superadmin', 'manager'] },
    'proj.sprints':       { 'Start Sprint': function (r) { return r === 'superadmin' || r === 'manager' || (r === 'employee' && TOGGLES['Allow Employee to Manage Sprints on Their Own Projects']); }, 'Update': ['superadmin', 'manager'], 'Complete': ['superadmin', 'manager'] },
    'proj.milestones':    { '+ Add Milestone': ['superadmin', 'manager'] },
    'vendor.edit':        { 'Delete': function (r) { return r === 'superadmin' && TOGGLES['Allow Hard Delete of a Vendor']; } }
  };

  /* Field-level rules (Layer 3). Matched case-insensitively against the field label.
     hide/read list the roles affected; `toggle` names the RBAC §2.1 switch that,
     when ON, removes the restriction. */
  var FIELDS = {
    'asset.directory':   [{ m: /purchase value|current value/i, hide: ['manager'], toggle: 'Show Purchase Value to Manager' }],
    'asset.record':      [{ m: /purchase value|current value/i, hide: ['manager'], toggle: 'Show Purchase Value to Manager' },
                          { m: /depreciation method/i, read: ['hr'], toggle: 'Allow HR to Edit Depreciation Method' },
                          { m: /asset name|category|serial number|location|vendor/i, read: ['hr'], toggle: 'Allow HR to Edit Core Info' }],
    'asset.depreciation':[{ m: /purchase value|current value/i, hide: ['manager'], toggle: 'Show Purchase Value to Manager' }],
    'asset.download':    [{ m: /purchase value|current value/i, hide: ['manager'], toggle: 'Show Purchase Value to Manager' }],
    'vendor.edit':       [{ m: /gstin|pan|bank account number|ifsc/i, read: ['manager'], toggle: 'Allow Manager to Edit Vendor Bank & GST Details' }],
    'emp.record':        [{ m: /basic salary|dearness|hra|leave travel|special allowance|other earnings|variable|effective from/i, read: ['hr', 'accountant', 'manager'], toggle: 'Allow HR to Edit Salary Structure' }],
    'proj.directory':    [{ m: /^budget/i, hide: ['employee'], toggle: 'Hide Budget from Employee\'s Project View', invert: true }]
  };

  function mode(role, sid) {
    var p = POLICY[sid];
    if (!p) return 'full';                 /* unlisted screens fall back to data.js roles[] */
    return p[role] || 'none';
  }
  var isView = function (m) { return m === 'view' || m === 'view:team'; };

  window.RBAC = {
    TOGGLES: TOGGLES,
    POLICY: POLICY,
    mode: mode,
    /* may this role change anything on this screen? */
    canEdit: function (role, sid) {
      var m = mode(role, sid);
      return m !== 'none' && !isView(m);
    },
    /* may this role perform this specific action here?
       Order matters: an explicit per-screen rule is consulted BEFORE the screen's
       default access mode, because some RBAC §2.1 toggles exist precisely to grant
       one action to an otherwise read-only role — e.g. 'Allow Accountant to Manage
       Taxes' upgrades Accountant from view to add/edit on Masters → Taxes. */
    can: function (role, sid, label) {
      label = String(label || '').trim();
      if (mode(role, sid) === 'none') return false;
      if (READ_ONLY_ACTIONS.test(label)) return true;
      var rule = ACTIONS[sid] && ACTIONS[sid][label];
      if (typeof rule === 'function') return !!rule(role);
      if (Array.isArray(rule)) return rule.indexOf(role) >= 0;
      if (!this.canEdit(role, sid)) return false;
      /* Delete / Deactivate are Super Admin only unless a screen says otherwise */
      if (/^(delete|deactivate)/i.test(label)) return role === 'superadmin';
      if (MUTATING.test(label)) return true;
      return true;
    },
    /* 'edit' | 'read' | 'hidden' | 'masked' for one field on one screen */
    fieldMode: function (role, sid, label) {
      if (mode(role, sid) === 'none') return 'hidden';
      var rules = FIELDS[sid] || [];
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (!r.m.test(String(label || ''))) continue;
        var on = r.toggle ? !!TOGGLES[r.toggle] : false;
        var active = r.invert ? on : !on;       /* most toggles GRANT when ON */
        if (!active) continue;
        if (r.hide && r.hide.indexOf(role) >= 0) return 'hidden';
        if (r.mask && r.mask.indexOf(role) >= 0) return 'masked';
        if (r.read && r.read.indexOf(role) >= 0) return 'read';
      }
      return isView(mode(role, sid)) ? 'read' : 'edit';
    },
    /* why a field is locked — surfaced in the UI so the rule is legible */
    lockReason: function (role, sid, label) {
      var rules = FIELDS[sid] || [];
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].m.test(String(label || '')) && rules[i].toggle) return rules[i].toggle + ' is OFF';
      }
      return isView(mode(role, sid)) ? 'Read-only for ' + role : '';
    }
  };
})();
