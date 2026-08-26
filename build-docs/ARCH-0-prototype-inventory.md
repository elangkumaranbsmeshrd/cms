# Meshrd CMS Prototype — Technical Inventory for Angular + FastAPI + MySQL Re-platform

## 0. Files, load order, architecture

All under `D:\Projects\Company Management Software\prototype\`

| File | Lines | Exports | Role |
|---|---|---|---|
| `data.js` | 1537 | `window.CMS = {ROLES, ALL, BADGE, MODULES, BADGES, D, PEOPLE, CUSTOMERS, VENDORS, DEPTS, FIN_PRESETS}` | Screen registry + all mock data + `D.masters` |
| `app-rbac.js` | 315 | `window.RBAC = {TOGGLES, POLICY, mode, canEdit, can, fieldMode, lockReason}` | Authorization source of truth |
| `app-core.js` | 743 | `window.U`, `window.RENDER`, `window.ACCENTS`, `window.SCALES`, `go/setTheme/setAccent/setCustomAccent/setScale`, `window.CMS_BOOT` | Router, RBAC engine hooks, shared UI builders, theme |
| `app-forms.js` | 880 | `window.FORMS_EXT` (63 form defs) | Declarative form definitions |
| `app-screens.js` | 572 | `R.list/dashboard/form/board/report/calendar/checklist/conversation/feedpage/soon` + `FORMS` (9 defs) | Generic renderers |
| `app-screens2.js` | 1613 | `R.record/pipeline/document/invdash/expsummary/payrollrun/payslip/leavemy/taxdecl/letter/assign/depreciation/assetcard/taskdetail/matrix/settings/attendance` + `RECORDS` (9 shapes) | Bespoke renderers |
| `app.css` | 939 | — | Design tokens + component CSS |
| `index.html` | 406 | — | Shell: `#login`, `#app` (`.topbar` + `.sidebar>#nav` + `.canvas>#canvas`), popovers `#notifPop/#roleMenu/#userMenu/#scrim`, `#toasts` |

Load order is strict and non-modular (`<script src>` in `index.html`, cache-busted `?v=44`): `data.js → app-rbac.js → app-core.js → app-forms.js → app-screens.js → app-screens2.js → CMS_BOOT()`.

Router: hash-based, `#/<screenId>`, `go(id)` in `app-core.js:653`. Single delegated `document.addEventListener('click')` handler (`app-core.js:663`) dispatches on data attributes: `data-go`, `data-mod`, `data-mod-go`, `data-tab="id:key"`, `data-view="id:key"`, `data-toggle`, `data-toast`, `data-stop`, `data-role`, `data-logout`, `data-theme-toggle`, `data-set-theme`, `data-set-accent`, `data-set-scale`, `data-login-role`. Keyboard: `Esc` closes popovers, `Ctrl/Cmd+K` focuses topbar search.

Renderer dispatch: `window.RENDER[screen.type] || window.RENDER.list`, wrapped in try/catch that renders an error card (`app-core.js:484-489`).

**Fonts:** IBM Plex Sans (400/450/500/600/700) + IBM Plex Mono (400/500/600), loaded from Google Fonts.

---

## 1. Screen registry — 161 screens, 15 module entries, 5 groups

`MODULES` is at `data.js:883-1523`. Each module: `{group, id, label, icon, ref, single?, screens[]}`. Each screen: `{id, label, ref, type, roles[], scope?, desc?, navHidden?, filters?, filterNames?, hideFilterFor?, columns?, rows, rowGo?, empty, actions?, rowActions?, form?/record?/report?/board?/doc?/list?}`.

`navHidden:1` screens are create/action forms reached from a parent button — routable, but only appear in the sidebar while active (`app-core.js:448`).

Roles: `superadmin, manager, accountant, hr, employee` (`ALL`).

### Group: Overview — module `home` (icon `dash`, `single:true`)
| id | label | ref | type | roles | scope |
|---|---|---|---|---|---|
| `dashboard` | Dashboard | Employee §2.11 · Invoice §2.1 | dashboard | ALL | — |

### Group: People — module `employee` (icon `employee`, ref Module 2)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `emp.directory` | Employee Directory | §2.1 | list | sa,mgr,acct,hr | manager:team | nav |
| `emp.record` | Employee Master Record | §2.2 | record(`employee`) | sa,mgr,acct,hr | manager:team | nav |
| `emp.profile` | My Profile | §2.3 | record(`myprofile`) | ALL | — | nav |
| `emp.documents` | My Documents | §2.7 | list | ALL | all:own | nav |
| `emp.docqueue` | Document Verification Queue | §2.7 | list | sa,hr | — | nav |
| `emp.assets` | My Assets | §2.10 | list | ALL | all:own | nav |
| `emp.announce` | Announcements & Notifications | §2.12 | feedpage | ALL | — | nav |
| `emp.onboarding` | Onboarding Checklist | §2.13 | checklist(`onboardingSteps`) | sa,hr | — | nav |
| `emp.onboardqueue` | Onboarding — All Employees | §2.13 | list | sa,hr | — | nav |
| `emp.offboarding` | Offboarding / Exit | §2.14 | checklist(`exitSteps`) | sa,hr | — | nav |
| `emp.exitqueue` | Exits — All Employees | §2.14 | list | sa,hr | — | nav |
| `emp.letter` | Offer & Appointment Letter | §2.15 | letter | sa,hr | — | nav |
| `emp.attendance` | Record Attendance | §2.2 | form(`e.attendance`) | sa | — | hidden |
| `emp.changereq` | Request Profile Change | §2.3 | form(`e.changereq`) | ALL | — | hidden |
| `emp.upload` | Upload Document | §2.7 | form(`e.upload`) | ALL | — | hidden |
| `emp.docreject` | Reject Document | §2.7 | form(`e.docreject`) | sa,hr | — | hidden |
| `emp.assetreq` | Raise Asset Request | §2.10 | form(`e.assetreq`) | ALL | — | hidden |
| `emp.postannounce` | Post Announcement | §2.12 | form(`e.announce`) | sa,hr | — | hidden |

### Group: People — module `leavepay` "Leave & Payroll" (icon `payroll`, ref Modules 5 & 6)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `leave.my` | My Leave | §2.1 | leavemy | ALL | all:own | nav |
| `leave.approvals` | Leave Approvals | §2.2 | list | sa,mgr,hr | manager:team | nav |
| `leave.balance` | Leave Balance Management | §2.3 | list | sa,hr | — | nav |
| `leave.comp` | Compensatory Hours | §2.6 | list | ALL | employee:own, manager:team | nav |
| `leave.comp.add` | Request Compensatory Hours | §2.6 | form(`l.comp`) | ALL | — | hidden |
| `leave.holidays` | Company Holiday Calendar | §2.4 | calendar | ALL | — | nav |
| `leave.reports` | Leave Reports | §2.5 | report(`leave`) | sa,hr,acct | — | nav |
| `payroll.run` | Run Payroll | §2.1 | payrollrun | sa,acct,hr | — | nav |
| `payroll.history` | Payroll History | §2.1 | list | sa,acct,hr | — | nav |
| `payroll.adhoc` | Ad-hoc Payslip Adjustments | §2.1a | list | sa,acct | — | nav |
| `payroll.mine` | My Payslips | §2.2 | list | ALL | all:own | nav |
| `payroll.slip` | Payslip | §2.2 | payslip | ALL | — | nav |
| `payroll.register` | Payroll Register | §2.4 | list | sa,acct,hr | — | nav |
| `payroll.attendance` | Attendance & Time Basis | §2.5 | attendance | sa,hr,mgr | manager:team | nav |
| `emp.tax` | My Tax Declarations | Employee §2.14 | taxdecl | ALL | — | nav |
| `leave.apply` | Apply for Leave | §2.1 | form(`l.apply`) | ALL | — | hidden |
| `leave.reject` | Reject Leave Request | §2.2 | form(`l.reject`) | sa,mgr,hr | — | hidden |
| `leave.adjust` | Adjust Balance | §2.3 | form(`l.adjust`) | sa,hr | — | hidden |
| `leave.carryfwd` | Run Year-End Carry-Forward | §2.3 | form(`l.carryfwd`) | sa,hr | — | hidden |
| `leave.adjhistory` | Adjustment History | §2.3 | form(`l.adjhistory`) | sa,hr | — | hidden |
| `payroll.adhoc.add` | Add Ad-hoc Adjustment | §2.1a | form(`p.adhoc`) | sa,acct | — | hidden |
| `payroll.salcert` | Request Salary Certificate | §2.2 | form(`p.salcert`) | ALL | — | hidden |
| `payroll.reissue` | Reissue Payslip | §2.4 | form(`p.reissue`) | sa,acct,hr | — | hidden |

### Group: People — module `asset` "Asset Management" (icon `asset`, ref Module 3)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `asset.directory` | Asset Directory | §2.1 | list | sa,acct,hr,mgr | manager:team | nav |
| `asset.record` | Asset Master Record | §2.2 | record(`asset`) | sa,acct,hr,mgr | manager:team | nav |
| `asset.assign` | Assign / Transfer / Unassign | §2.3 | assign | sa,hr | — | nav |
| `asset.maintenance` | Maintenance & Service Log | §2.4 | list | sa,acct,hr,mgr | manager:team | nav |
| `asset.depreciation` | Depreciation & Current Value | §2.5 | depreciation | sa,acct,hr | — | nav |
| `asset.requests` | Asset Requests | §2.6 | list | sa,mgr | manager:team | nav |
| `asset.reports` | Asset Reports | §2.7 | report(`asset`) | sa,acct,hr,mgr | manager:team | nav |
| `asset.reclaim` | Reclaim on Exit | §2.8 | list | sa,hr | — | nav |
| `asset.download` | Download Asset Card | §2.9 | assetcard | sa,acct,hr,mgr | — | nav |
| `asset.reqreject` | Reject Asset Request | §2.6 | form(`a.reqreject`) | sa,mgr | — | hidden |
| `asset.maint.add` | Add Maintenance Entry | §2.4 | form(`a.maint`) | sa,acct | — | hidden |
| `asset.markreturned` | Mark Returned | §2.8 | form(`a.reclaim`) | sa,hr | — | hidden |

### Group: Operations — module `ticket` (icon `ticket`, ref Module 4)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `ticket.list` | Ticket List | §2.1 | list | sa,mgr,emp | employee:own | nav |
| `ticket.new` | New / Edit Ticket | §2.2 | form(`ticket`) | sa,mgr | — | nav |
| `ticket.detail` | Ticket Detail | §2.3 | conversation | sa,mgr,emp | employee:own | nav |
| `ticket.assign` | Assign / Reassign | §2.4 | form(`reassign`) | sa,mgr | — | nav |
| `ticket.reports` | Support Reports | §2.5 | report(`ticket`) | sa,mgr | — | nav |
| `emp.tickets` | My Tickets | Employee §2.7 | list | ALL | all:own | nav |
| `ticket.close` | Close Ticket | §2.3 | form(`t.close`) | sa,mgr,emp | — | hidden |

### Group: Operations — module `project` (icon `project`, ref Module 10)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `proj.directory` | Project Directory | §2.1 | list | sa,mgr,emp | employee:own | nav |
| `proj.edit` | Add / Edit Project | §2.2 | form(`project`) | sa,mgr | — | nav |
| `proj.board` | Task Board | §2.3 | board(`tasks`) | ALL | — | nav |
| `proj.task` | Task Detail | §2.4 | taskdetail | ALL | — | nav |
| `proj.sprints` | Sprints | §2.5 | list | ALL | — | nav |
| `proj.bugs` | Bugs | §2.6 | board(`bugs`) | ALL | — | nav |
| `proj.report` | Project Report | §2.7 | report(`project`) | sa,mgr | — | nav |
| `proj.milestones` | Milestones | §2.8 | list | ALL | — | nav |
| `proj.timesheets` | Timesheets | §2.8 | list | ALL | employee:own | nav |
| `emp.projects` | My Projects & Tasks | Employee §2.8 | list | ALL | all:own | nav |
| `proj.sprintstart` | Start Sprint | §2.5 | form(`pr.sprintstart`) | sa,mgr | — | hidden |
| `proj.sprintupdate` | Update Sprint | §2.5 | form(`pr.sprintupdate`) | sa,mgr | — | hidden |
| `proj.bugadd` | Report Bug | §2.6 | form(`pr.bug`) | ALL | — | hidden |
| `proj.milestoneadd` | Add / Edit Milestone | §2.8 | form(`pr.milestone`) | sa,mgr | — | hidden |
| `proj.loghours` | Log Hours | §2.8 | form(`pr.timesheet`) | ALL | — | hidden |

### Group: Operations — module `opportunity` (icon `opp`, ref Module 9)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `opp.pipeline` | Opportunity Pipeline | §2.1 | pipeline | sa,mgr | manager:team | nav |
| `opp.edit` | Add / Edit Opportunity | §2.2 | form(`opportunity`) | sa,mgr | — | hidden |
| `opp.360` | Opportunity Record | §2.3 | record(`opportunity`) | sa,mgr | manager:team | nav |
| `opp.activity` | Add Activity | §2.3 | form(`opp.activity`) | sa,mgr | — | hidden |
| `opp.lost` | Mark Opportunity Lost | §2.2 | form(`o.lost`) | sa,mgr | — | hidden |

### Group: Operations — module `customer` (icon `customer`, ref Module 8)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `cust.directory` | Customer Directory | §2.1 | list | sa,mgr | manager:team | nav |
| `cust.edit` | Add / Edit Customer | §2.2 | form(`customer`) | sa,mgr | — | nav |
| `cust.360` | Customer 360 | §2.3 | record(`customer`) | sa,mgr | manager:team | nav |
| `cust.contact` | Add / Edit Contact | §2.3 | form(`c.contact`) | sa,mgr | — | hidden |
| `cust.activity` | Add Activity | §2.3 | form(`c.activity`) | sa,mgr | — | hidden |

### Group: Finance — module `invoice` (icon `invoice`, ref Module 11)
| id | label | ref | type | roles | nav |
|---|---|---|---|---|---|
| `inv.dashboard` | Invoice Dashboard | §2.1 | invdash | sa,acct | nav |
| `inv.list` | Invoice List | §2.2 | list | sa,acct | nav |
| `inv.edit` | New / Edit Invoice | §2.3 | document(`invoice`) | sa,acct | nav |
| `inv.payment` | Record Payment | §2.4 | form(`payment`) | sa,acct | nav |
| `inv.creditnote` | Raise Credit Note | §2.5 | form(`creditnote`) | sa,acct | nav |
| `inv.cnlist` | Credit Note List | §2.5 | list | sa,acct | nav |

### Group: Finance — module `expense` (icon `expense`, ref Module 12)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `exp.my` | My Expenses | §2.1 | list | ALL | all:own | nav |
| `exp.approvals` | Expense Approvals | §2.2 | list | sa,acct | — | nav |
| `exp.all` | All Expenses / Summary | §2.3 | expsummary | sa,acct | — | nav |
| `exp.company` | Company Expenses | §2.4 | list | sa,acct | — | nav |
| `exp.add` | Add Expense | §2.1 | form(`x.add`) | ALL | — | hidden |
| `exp.reject` | Reject Expense | §2.2 | form(`x.reject`) | sa,acct | — | hidden |
| `exp.reimburse` | Mark as Reimbursed | §2.3 | form(`x.reimburse`) | sa,acct | — | hidden |

### Group: Finance — module `purchasebill` (icon `purchase`, ref Module 13)
| id | label | ref | type | roles | nav |
|---|---|---|---|---|---|
| `pb.list` | Purchase Bill List | §2.1 | list | sa,acct | nav |
| `pb.edit` | Add / Edit Purchase Bill | §2.2 | document(`bill`) | sa,acct | nav |
| `pb.payment` | Record Payment | §2.3 | form(`billpayment`) | sa,acct | nav |

### Group: Finance — module `vendor` (icon `vendor`, ref Module 7)
| id | label | ref | type | roles | nav |
|---|---|---|---|---|---|
| `vendor.directory` | Vendor Directory | §2.1 | list | sa,acct,mgr | nav |
| `vendor.edit` | Add / Edit Vendor | §2.2 | record(`vendor`) | sa,acct,mgr | nav |
| `vendor.usage` | Vendor Usage | §2.3 | list | sa,acct,mgr | nav |

### Group: Administration — module `masters` (icon `masters`, ref Module 1)
| id | label | ref | type | roles | scope | nav |
|---|---|---|---|---|---|---|
| `masters.fy` | Financial Year | §3.1 | list | sa | — | nav |
| `masters.fy.add` | Add Financial Year | §3.1 | form(`financialyear`) | sa | — | nav |
| `masters.taxes` | Taxes | §3.2 | record(`taxes`) | sa,acct | — | nav |
| `masters.expensetypes` | Expense Types | §3.3 | list | sa,mgr | — | nav |
| `masters.leavetypes` | Leave Types | §3.4 | list | sa,mgr,hr | — | nav |
| `masters.workweek` | Work Week & Hours | §3.20 | record(`workweek`) | sa,hr,mgr | hr:view, manager:view | nav |
| `masters.holidays` | Holidays | §3.5 | calendar (`editable:1`) | sa,mgr | — | nav |
| `masters.company` | Company Profile | §3.6 | record(`company`) | sa,mgr | manager:view | nav |
| `masters.paymentmode` | Payment Mode | §3.8 | list | sa | — | nav |
| `masters.department` | Department | §3.9 | list | sa | — | nav |
| `masters.designation` | Designation / Job Title | §3.10 | list | sa | — | nav |
| `masters.hsn` | HSN / SAC Code | §3.11 | list | sa | — | nav |
| `masters.servicecategory` | Service Category | §3.12 | list | sa | — | nav |
| `masters.uom` | Unit of Measure | §3.13 | list | sa | — | nav |
| `masters.ticketcategories` | Ticket Categories | §3.14 | list | sa | — | nav |
| `masters.customerstatus` | Customer Status | §3.15 | list | sa | — | nav |
| `masters.customersource` | Customer Source | §3.16 | list | sa | — | nav |
| `masters.assetcategories` | Asset Categories | §3.17 | list | sa | — | nav |
| `masters.employmenttype` | Employment Type | §3.18 | list | sa | — | nav |
| `masters.insurance` | Insurance Plans | §3.19 | list | sa,hr | hr:view | nav |
| `masters.email` | Email Configuration | §3.21 | record(`emailconfig`) | sa | — | nav |
| `masters.expensetypes.add` | Add Expense Type | §3.3 | form(`m.expensetypes`) | sa,mgr | — | hidden |
| `masters.leavetypes.add` | Add / Edit Leave Type | §3.4 | form(`m.leavetypes`) | sa,mgr,hr | — | hidden |
| `masters.holidays.add` | Add Holiday | §3.5 | form(`m.holidays`) | sa,mgr | — | hidden |
| `masters.holidays.import` | Bulk Import Holidays | §3.5 | form(`m.holidays.import`) | sa | — | hidden |
| `masters.workweek.add` | Add / Edit Work Week Policy | §3.20a | form(`m.workweek`) | sa | — | hidden |
| `masters.workweek.satrule` | Override a Saturday | §3.20b | form(`m.satrule`) | sa | — | hidden |
| `masters.paycycle.edit` | Edit Pay Cycle | §3.20c | form(`m.paycycle`) | sa | — | hidden |
| `masters.bank.add` | Add Bank Account | §3.7 | form(`m.bank`) | sa | — | hidden |
| `masters.paymentmode.add` | Add Payment Mode | §3.8 | form(`m.paymentmode`) | sa | — | hidden |
| `masters.department.add` | Add Department | §3.9 | form(`m.department`) | sa | — | hidden |
| `masters.designation.add` | Add Designation | §3.10 | form(`m.designation`) | sa | — | hidden |
| `masters.hsn.add` | Add HSN / SAC Code | §3.11 | form(`m.hsn`) | sa | — | hidden |
| `masters.servicecategory.add` | Add Service Category | §3.12 | form(`m.servicecategory`) | sa | — | hidden |
| `masters.uom.add` | Add Unit of Measure | §3.13 | form(`m.uom`) | sa | — | hidden |
| `masters.ticketcategories.add` | Add Ticket Category | §3.14 | form(`m.ticketcategories`) | sa | — | hidden |
| `masters.customerstatus.add` | Add Customer Status | §3.15 | form(`m.customerstatus`) | sa | — | hidden |
| `masters.customersource.add` | Add Customer Source | §3.16 | form(`m.customersource`) | sa | — | hidden |
| `masters.assetcategories.add` | Add Asset Category | §3.17 | form(`m.assetcategories`) | sa | — | hidden |
| `masters.employmenttype.add` | Add Employment Type | §3.18 | form(`m.employmenttype`) | sa | — | hidden |
| `masters.insurance.add` | Add Insurance Plan | §3.19 | form(`m.insurance`) | sa | — | hidden |
| `masters.email.template` | Edit Email Template | §3.21a | form(`m.emailtemplate`) | sa | — | hidden |
| `masters.email.test` | Send Test Email | §3.21b | form(`m.emailtest`) | sa | — | hidden |
| `masters.company.address` | Add Another Address | §3.6b | form(`m.company.address`) | sa | — | hidden |
| `masters.company.prefix` | Edit Number Prefix | §3.6e | form(`m.company.prefix`) | sa | — | hidden |
| `masters.taxes.add` | Add Tax Head | §3.2a | form(`m.tax.head`) | sa,acct | — | hidden |
| `masters.taxes.slab` | Tax Head — Slab Bands | §3.2b | form(`m.tax.slab`) | sa,acct | — | hidden |
| `masters.taxes.split` | Tax Head — Split Components | §3.2c | form(`m.tax.split`) | sa,acct | — | hidden |
| `masters.taxes.scheme` | Add Tax Scheme | §3.2d | form(`m.tax.scheme`) | sa,acct | — | hidden |
| `masters.taxes.relief` | Tax Head — Relief Rules | §3.2e | form(`m.tax.relief`) | sa,acct | — | hidden |

### Group: Administration — module `rbac` "Roles & Access" (icon `rbac`, ref Module 14) + module `settings` (`single:true`)
| id | label | ref | type | roles | nav |
|---|---|---|---|---|---|
| `rbac.roles` | Role Directory | §4.1 | list | sa | nav |
| `rbac.matrix` | Role Permission Matrix | §4.2 | matrix | sa | nav |
| `rbac.overrides` | Individual Permission Overrides | §4.3 | list | sa | nav |
| `rbac.log` | Permission Change Log | §4.4 | list | sa | nav |
| `rbac.addoverride` | Add Permission Override | §4.3 | form(`r.override`) | sa | hidden |
| `settings` | Settings | Prototype | settings | sa | nav (rendered from `.nav-foot`, excluded from tree — `app-core.js:420`) |

### Nav badges (`data.js:1526`, `BADGES`)
```
leave.approvals: {manager:5, hr:7, superadmin:7}
ticket.list:     {employee:3, manager:23, superadmin:23}
asset.requests:  {manager:2, superadmin:2}
exp.approvals:   {accountant:4, superadmin:4}
emp.docqueue:    {hr:6, superadmin:6}
inv.list:        {accountant:{n:7,hot:1}, superadmin:{n:7,hot:1}}   // hot = red badge
inv.cnlist:      {accountant:1, superadmin:1}
```
Module-level badge = sum of its screens' badges for that role; `hot` propagates up.

### Screen types → renderer (23 distinct)
`dashboard, list, form, record, board, report, calendar, checklist, conversation, feedpage, soon, pipeline, document, invdash, expsummary, payrollrun, payslip, leavemy, taxdecl, letter, assign, depreciation, assetcard, taskdetail, matrix, settings, attendance`

---

## 2. RBAC — the complete authorization model

Four layers, exactly as documented at `app-rbac.js:1-24`:
- **Layer 1** screen visibility (`POLICY[sid][role] === 'none'` → no nav entry, no route)
- **Layer 2** action permissions (`ACTIONS` + `MUTATING`/`READ_ONLY_ACTIONS` regexes)
- **Layer 3** field-level hide/read/mask (`FIELDS` + column `hideFrom`)
- **Layer 4** row scope (`screen.scope` + `SCOPE_RULES` in `app-core.js:131`)

### 2.1 Access modes
| mode | meaning |
|---|---|
| `full` | open, may act within screen's own action rules |
| `view` | open, READ-ONLY — every field locks, every mutating action hides |
| `view:team` | read-only AND scoped to direct reports |
| `own` | may act, only on own records |
| `team` | may act, only on direct reports' records |
| `none` | screen does not exist for this role |

`mode(role, sid)` returns `'full'` for an unlisted screen (falls back to `data.js roles[]`). **117 of 161 screens have a POLICY row**; the 44 without (all Masters `*.add` forms, `rbac.*`, `settings`, `emp.onboardqueue`, `emp.exitqueue`, `masters.customersource`, and the six `emp.*`/`asset.*`/`payroll.adhoc.add` hidden forms) fall through to Layer-1-only enforcement. `masters.bank` is a POLICY key with **no** matching screen (bank accounts live as a tab inside `masters.company`).

### 2.2 Complete POLICY table (`superadmin | manager | accountant | hr | employee`)

```
asset.assign              full | view:team | view | full | none
asset.depreciation        full | none      | view | view | none
asset.directory           full | view:team | view | view | none
asset.download            full | view:team | view | view | none
asset.maintenance         full | view:team | full | view | none
asset.reclaim             full | none      | none | full | none
asset.record              full | view:team | full | view | none
asset.reports             full | view:team | view | view | none
asset.requests            full | team      | none | none | none
cust.360                  full | full      | none | none | none
cust.activity             full | full      | none | none | none
cust.contact              full | full      | none | none | none
cust.directory            full | full      | none | none | none
cust.edit                 full | full      | none | none | none
dashboard                 own  | team      | own  | own  | own
emp.announce              full | view      | view | full | view
emp.assets                own  | own       | own  | own  | own
emp.attendance            full | none      | none | none | none
emp.directory             full | view:team | view | full | none
emp.docqueue              full | none      | none | full | none
emp.documents             own  | own       | own  | own  | own
emp.letter                full | none      | none | full | none
emp.offboarding           full | team      | none | full | none
emp.onboarding            full | none      | none | full | none
emp.profile               own  | own       | own  | own  | own
emp.projects              own  | own       | own  | own  | own
emp.record                full | view:team | view | full | none
emp.tax                   full | own       | view | view | own
emp.tickets               own  | own       | own  | own  | own
exp.add                   own  | own       | own  | own  | own
exp.all                   full | none      | full | none | none
exp.approvals             full | none      | full | none | none
exp.company               full | none      | full | none | none
exp.my                    own  | own       | own  | own  | own
exp.reimburse             full | none      | full | none | none
exp.reject                full | none      | full | none | none
inv.cnlist                full | none      | full | none | none
inv.creditnote            full | none      | full | none | none
inv.dashboard             full | none      | full | none | none
inv.edit                  full | none      | full | none | none
inv.list                  full | none      | full | none | none
inv.payment               full | none      | full | none | none
leave.adjhistory          full | none      | none | full | none
leave.adjust              full | none      | none | full | none
leave.apply               own  | own       | own  | own  | own
leave.approvals           full | team      | none | full | none
leave.balance             full | none      | none | full | none
leave.carryfwd            full | none      | none | full | none
leave.comp                full | team      | own  | full | own
leave.comp.add            own  | own       | own  | own  | own
leave.holidays            view | view      | view | view | view
leave.my                  own  | own       | own  | own  | own
leave.reject              full | team      | none | full | none
leave.reports             full | none      | view | view | none
masters.assetcategories   full | none      | none | none | none
masters.bank              full | none      | none | none | none
masters.company           full | view      | none | none | none
masters.customerstatus    full | none      | none | none | none
masters.department        full | none      | none | none | none
masters.designation       full | none      | none | none | none
masters.email             full | none      | none | none | none
masters.employmenttype    full | none      | none | none | none
masters.expensetypes      full | full      | none | none | none
masters.fy                full | none      | none | none | none
masters.holidays          full | full      | none | none | none
masters.hsn               full | none      | none | none | none
masters.insurance         full | none      | none | view | none
masters.leavetypes        full | full      | none | full | none
masters.paycycle.edit     full | none      | none | none | none
masters.paymentmode       full | none      | none | none | none
masters.servicecategory   full | none      | none | none | none
masters.taxes             full | none      | view | none | none
masters.ticketcategories  full | none      | none | none | none
masters.uom               full | none      | none | none | none
masters.workweek          full | view      | none | view | none
masters.workweek.add      full | none      | none | none | none
masters.workweek.satrule  full | none      | none | none | none
opp.360                   full | full      | none | none | none
opp.activity              full | full      | none | none | none
opp.edit                  full | full      | none | none | none
opp.lost                  full | full      | none | none | none
opp.pipeline              full | full      | none | none | none
payroll.adhoc             full | none      | full | none | none
payroll.attendance        full | view:team | none | view | none
payroll.history           full | none      | view | view | none
payroll.mine              own  | own       | own  | own  | own
payroll.register          full | none      | full | full | none
payroll.reissue           full | none      | full | full | none
payroll.run               full | none      | full | full | none
payroll.salcert           own  | own       | own  | own  | own
payroll.slip              full | own       | full | full | own
pb.edit                   full | none      | full | none | none
pb.list                   full | none      | full | none | none
pb.payment                full | none      | full | none | none
proj.board                full | full      | none | none | own
proj.bugadd               full | full      | none | none | own
proj.bugs                 full | full      | none | none | own
proj.directory            full | full      | none | none | own
proj.edit                 full | full      | none | none | none
proj.loghours             full | full      | none | none | own
proj.milestoneadd         full | full      | none | none | none
proj.milestones           full | full      | none | none | view
proj.report               full | full      | none | none | none
proj.sprints              full | full      | none | none | view
proj.sprintstart          full | full      | none | none | none
proj.sprintupdate         full | full      | none | none | none
proj.task                 full | full      | none | none | own
proj.timesheets           full | full      | none | none | own
ticket.assign             full | full      | none | none | none
ticket.close              full | full      | none | none | own
ticket.detail             full | full      | none | none | own
ticket.list               full | full      | none | none | own
ticket.new                full | full      | none | none | none
ticket.reports            full | full      | none | none | none
vendor.directory          full | full      | full | none | none
vendor.edit               full | full      | full | none | none
vendor.usage              view | view      | view | none | none
```

### 2.3 Action resolution (`RBAC.can(role, sid, label)` — `app-rbac.js:277`)

Order (this order matters — a toggle can upgrade a view-only role to act):
1. `mode === 'none'` → **false**
2. `READ_ONLY_ACTIONS` matches → **true** — regex `/^(view|open|export|download|preview|cancel|back|close|clear)/i`. *Export is always available to anyone who can open a list (RBAC §2.2f).*
3. Explicit `ACTIONS[sid][label]` (function or array) → its verdict
4. `!canEdit(role, sid)` → **false**
5. `/^(delete|deactivate)/i` → **superadmin only** (global default, Masters §3.0 rule 1)
6. `MUTATING` matches → **true** — regex:
```
/^(\+|save|add|edit|delete|deactivate|activate|lock|approve|reject|reissue|assign|transfer|
   unassign|record payment|submit|send|post|run|mark|create|verify|update|complete|start|
   raise|generate|apply|log |adjust|reassign|revoke|confirm|remove|upload|quick create)/i
```
7. else **true**

### 2.4 ACTIONS table (complete, `app-rbac.js:212-239`)
```
masters.taxes       'Add Tax Head'            fn: superadmin || (accountant && TOGGLES['Allow Accountant to Manage Taxes'])
masters.fy          'Lock' ['superadmin'] · 'Edit' ['superadmin']
asset.directory     '+ Add Asset' ['superadmin','accountant']
asset.record        'Save' ['superadmin','accountant'] · 'Mark Retired/Disposed' ['superadmin','accountant']
asset.assign        'Assign' / 'Transfer' / 'Unassign' ['superadmin','hr']
asset.maintenance   '+ Add Maintenance Entry' ['superadmin','accountant']
asset.requests      'Approve' / 'Reject' ['superadmin','manager']
ticket.list         '+ New Ticket'  fn: superadmin || manager || (employee && TOGGLES['Allow Staff to Create New Tickets'])
ticket.detail       'Reassign'      fn: superadmin || manager || (employee && TOGGLES['Allow Staff to Reassign Their Own Ticket'])
leave.approvals     'Approve' / 'Reject' ['superadmin','manager','hr']
leave.comp          'Approve' / 'Reject' ['superadmin','manager','hr']
masters.workweek    'Add Policy' / 'Save' / 'Override a Saturday' / 'Deactivate' ['superadmin']
leave.balance       'Adjust Balance' / 'Run Year-End Carry-Forward' ['superadmin','hr']
payroll.run         'Confirm & Generate Payslips' fn: superadmin || accountant || hr || (manager && TOGGLES['Allow Manager to Run Payroll'])
payroll.adhoc       '+ Add Adjustment'            fn: superadmin || accountant || (hr && TOGGLES['Allow HR to Add Ad-hoc Payslip Adjustments'])
payroll.register    'Reissue' ['superadmin','accountant','hr']
exp.approvals       'Approve' / 'Reject' ['superadmin','accountant']
exp.all             'Mark as Reimbursed' ['superadmin','accountant']
inv.creditnote      'Approve' ['superadmin']
emp.docqueue        'Verify' / 'Reject' ['superadmin','hr']
emp.record          'Edit' / 'Generate Letter' / 'Raise Exit' ['superadmin','hr'] · '+ Record Attendance' ['superadmin']
proj.task           'Delete' ['superadmin','manager']
proj.bugs           'Delete' ['superadmin','manager']
proj.sprints        'Start Sprint' fn: superadmin || manager || (employee && TOGGLES['Allow Employee to Manage Sprints on Their Own Projects'])
                    'Update' / 'Complete' ['superadmin','manager']
proj.milestones     '+ Add Milestone' ['superadmin','manager']
vendor.edit         'Delete' fn: superadmin && TOGGLES['Allow Hard Delete of a Vendor']
```

### 2.5 FIELDS masking table (complete, `app-rbac.js:244-254`)
Matched **case-insensitively against the field label** (works for both form fields and table column headers).

```
asset.directory    /purchase value|current value/i          hide:[manager]                   toggle: Show Purchase Value to Manager
asset.record       /purchase value|current value/i          hide:[manager]                   toggle: Show Purchase Value to Manager
                   /depreciation method/i                   read:[hr]                        toggle: Allow HR to Edit Depreciation Method
                   /asset name|category|serial number|location|vendor/i  read:[hr]           toggle: Allow HR to Edit Core Info
asset.depreciation /purchase value|current value/i          hide:[manager]                   toggle: Show Purchase Value to Manager
asset.download     /purchase value|current value/i          hide:[manager]                   toggle: Show Purchase Value to Manager
vendor.edit        /gstin|pan|bank account number|ifsc/i     read:[manager]                   toggle: Allow Manager to Edit Vendor Bank & GST Details
emp.record         /basic salary|dearness|hra|leave travel|special allowance|other earnings|variable|effective from/i
                                                            read:[hr,accountant,manager]     toggle: Allow HR to Edit Salary Structure
proj.directory     /^budget/i                               hide:[employee]  invert:true     toggle: Hide Budget from Employee's Project View
```

`fieldMode(role, sid, label)` → `'edit' | 'read' | 'hidden' | 'masked'`. Rule is **active when its toggle is OFF** (most toggles *grant*); `invert:true` reverses that. Falls through to `'read'` if the mode is `view`/`view:team`, else `'edit'`. `lockReason()` returns `"<Toggle> is OFF"` or `"Read-only for <role>"` and is surfaced in the UI — the rule is always legible, never a silently missing control. `mask` is supported by `fieldMode` but no rule currently uses it (only `hide`/`read` are populated).

Column-level masking in `data.js` (independent of FIELDS, applied first in `U.table`):
```
asset.directory  → Purchase Value, Current Value           hideFrom:[manager]
cust.directory   → Collected Into                          hideFrom:[manager]
vendor.directory → GSTIN, Bank Account Name, Bank, Account Number   hideFrom:[manager]
vendor.usage     → Paid From (Meshrd Account), Paid Into (Vendor's Account Name), Account Number  hideFrom:[manager]
```

Filter-level masking (`hideFilterFor`, indices into `filters[]`):
```
ticket.list      {employee:[4]}  → hides "Assigned Staff"
proj.timesheets  {employee:[0]}  → hides "Person"
vendor.directory {manager:[3]}   → hides "Has Bank Details"
```
The rule stated in `R.list` (`app-screens.js:26`): *the field's visibility decides; the filter follows*.

### 2.6 Layer 4 — scope rules (`app-core.js:121-168`)
`TEAM = D.team.map(name).concat(['Vikram Iyer'])` (Vikram's 5 direct reports + himself).
`applyScope(rows, sid, scope, role)`: returns rows unchanged for `'all'`/`'view'`; otherwise looks up `SCOPE_RULES[sid][scope]` and filters. **If no rule exists it pushes `sid + ':' + scope` into `window.SCOPE_UNRESOLVED` rather than silently returning the full set** — an explicit test hook worth preserving.

```
emp.directory     team: r.mgr === me || r.name === me      own: r.name === me
proj.directory    own:  r.lead === me || r.members.includes(me)
proj.timesheets   own:  r.person === me
ticket.list       own:  r.to === me
emp.tickets       own:  r.to === me
asset.directory   team: TEAM.includes(r.to)                own: r.to === me
asset.maintenance team: () => true
asset.requests    team: TEAM.includes(r.emp)
emp.assets        own:  r.to === me
leave.approvals   team: TEAM.includes(r.emp)
payroll.team      team: TEAM.includes(r.emp)               // orphan — no such screen id
emp.projects / emp.documents / exp.my / payroll.mine / leave.my   own: () => true
```
Scope labels shown in the filterbar chip: `own → "Own records"`, `team → "My team (5)"` (manager) / `"Team"`, `view → "View only"`, else `"Company-wide"`.

---

## 3. TOGGLES — all 47 with defaults

`RBAC.TOGGLES` (`app-rbac.js:30-78`). **Only two default to `true`:**

| Toggle | Default |
|---|---|
| Show Salary Amount to Manager | false |
| Allow Employee to Edit Bank Details Directly | false |
| Show Financial Year Management to Manager | false |
| Allow Manager to Edit Team Member Employment Details | false |
| **Require Manager Acknowledgment Before HR Processes Exit** | **true** |
| Allow HR to Edit Salary Structure | false |
| Allow HR to Edit Statutory Applicability Toggles | false |
| Allow Employee to Change Insurance Plan Mid-Year | false |
| Allow Accountant to Manage Taxes | false |
| Allow Manager to Reassign Assets Directly | false |
| Show Purchase Value to Manager | false |
| Allow HR to Edit Depreciation Method | false |
| Allow HR to Edit Core Info | false |
| Allow Staff to View the Full Open Ticket Queue | false |
| Allow Staff to Reassign Their Own Ticket | false |
| Show Support Reports to Staff | false |
| Allow Staff to Create New Tickets | false |
| Require Satisfaction Rating on Close | false |
| Allow Manager to Adjust Team Leave Balance | false |
| Require HR Co-Approval for Leave Longer Than X Days | false |
| Allow Manager to Run Payroll | false |
| Allow HR to Add Ad-hoc Payslip Adjustments | false |
| Hide Ad-hoc Adjustment Labels from Employee | false |
| Require Super Admin Approval to Reissue a Payslip | false |
| **Notify Employee When a Payslip Is Reissued** | **true** |
| Allow Manager to Edit Vendor Bank & GST Details | false |
| Allow Hard Delete of a Vendor | false |
| Require Approval to Add a New Vendor | false |
| Restrict Manager to Only Their Own Customers | false |
| Give Accountant Read Access to Customer Financial Summary | false |
| Allow Employee to Log Activities on Customers They're Staffed On | false |
| Restrict Manager to Only Their Own Opportunities | false |
| Give Accountant Read Access to Pipeline Value | false |
| Allow Employee to View the Opportunity Behind Their Assigned Project | false |
| Restrict Manager to Only Projects They Manage | false |
| Give Accountant Read Access to Project Budgets | false |
| Allow Employee to Manage Sprints on Their Own Projects | false |
| Show Project Report to Employee | false |
| Hide Budget from Employee's Project View | false |
| Allow Manager Read-Only Access to Their Projects' Invoices | false |
| Require Second Approval Before an Invoice Locks as Paid | false |
| Show Non-Financial Dashboard Widgets to HR | false |
| Allow Manager to Approve Their Team's Expenses | false |
| Require a Receipt Before Approval | false |
| Set an Auto-Approval Threshold | false |
| Auto-Mark as Reimbursed When Paid via Payroll | false |
| Give HR Read-Only Access to the Permission Matrix | false |

**Discrepancy to resolve during re-platform:** `D.toggles` (`data.js:855`, the list the matrix UI renders, grouped by module label) contains **50** entries. Three Purchase Bill toggles exist only there and have **no entry in `RBAC.TOGGLES`** — they render in the matrix but nothing enforces them:
- `Require Attachment Before Marking a Bill Paid`
- `Lock Purchase Bill Once Fully Paid`
- `Give Manager Read-Only Access to Purchase Bills`

`D.defaultOn = ['Require Manager Acknowledgment Before HR Processes Exit', 'Notify Employee When a Payslip Is Reissued']` — the matrix UI's own default-on list, consistent with `RBAC.TOGGLES`.

`D.toggles` module-group keys (used to bind toggles to modules in the matrix): `Employee (8)`, `Masters (1)`, `Asset Management (4)`, `Ticket (5)`, `Leave & Payroll (7)`, `Vendor (3)`, `Customer (3)`, `Opportunity (3)`, `Project (5)`, `Invoice (3)`, `Expense (4)`, `Purchase Bill (3)`, `Roles & Access (1)`.

---

## 4. Reusable UI patterns worth carrying over

All shared builders are on `window.U` (`app-core.js:171-415`). The key architectural decision, stated explicitly at `app-rbac.js:8-15`: **policy is enforced inside the shared builders, which read the ACTIVE screen (`S.route`) and role (`S.role`) themselves — so a renderer that forgets to use its `role` argument still produces correctly restricted output.** Replicate this in Angular via a directive/pipe layer rather than per-component checks.

### 4.1 List shape (`R.list`, `app-screens.js:14-30`)
```
U.pageHead(screen, actions)          role-filtered action buttons + "Read-only" badge when mode is view/view:team
  ↓
[U.note] Layer-3 masking note OR Layer-4 scope note (mutually exclusive)
  ↓
U.filterbar(screen, role, shown, total)
  ↓
<div class="card rise"><div class="card-body flush">U.table(...)</div>U.pager(...)</div>
```
Rows: `rowsOf(s)` = `typeof s.rows === 'function' ? s.rows() : D[s.rows]`, then `U.applyScope(all, s.id, scopeOf(s,role), role)`. Every list screen gets Export PDF + Export Excel appended automatically, with toasts stating *"exactly the filtered, searched, sorted set on screen, with a header block naming the filters, result count, who exported it, and when"*.

**Filterbar** (`app-core.js:200-227`) — two rows:
- Row 1: 216px searchbox, one `<select class="fselect">` per `filters[i]` (skipped if in `hideFilterFor[role]`), a "N filters hidden" caption, then right-aligned PDF/Excel small buttons.
- Row 2: removable chips (`Period: This Financial Year`, `Scope: <label>`, plus `Super Admin: All filters, unscoped` for superadmin), `Clear all`, and `Showing X of Y` count.

**Pager** (`app-core.js:299`): "Rows per page" select `[25,10,50,100]`, `Showing 1–N of M` (mono), page buttons `‹ 1 2 ›`.

**Table** (`U.table`, `app-core.js:266-297`) column pipeline:
1. drop columns where `c.hideFrom.includes(role)`
2. drop columns where `RBAC.fieldMode(role, sid, c.t) === 'hidden'`
3. convert to `type:'masked'` where `fieldMode(...) === 'masked'`, carrying `maskNote = lockReason(...)`
4. `.map(U.moneyAlign)`
5. row actions filtered by `a.roles` **and** `RBAC.can(role, sid, label)`
6. empty state via `U.empty(s.empty, 'No records match the filters currently applied…')`

Row click: `<tr class="clickable" data-go="{rowGo}">`. A row action carrying `go` deliberately omits `data-stop` so `closest()` finds the button before the row.

Column spec: `{k, t, c?, th?, type?, avatar?, hideFrom?, calc?, maskNote?}`. `c`/`th` are CSS classes (`mono`, `r`, `cell-strong`, `cell-accent`, `num`). Only one `calc` column exists: `leave.balance → Remaining = allowed + cf − taken − pending`.

### 4.2 Record-with-tabs shape (`R.record`, `app-screens2.js:802-817`)
```
U.pageHead(screen)
  ↓
.rec-head  =  .rec-avatar (initials or SVG) + [.rec-id / .rec-name / .rec-meta(chips, dot separators, badge)]
              + optional .rec-summary (persistent KPI strip: {l, v} pairs, mono values)
              + .rec-actions (buttons)
  ↓
U.tabs(screenId, tabs, active)   // tab = {k, l, n?} — n renders a count pill
  ↓
<div class="card rise"><div class="card-body">activeTab.body(role)</div></div>
```
Active tab state lives in `S.tab[screenId]`, set by `data-tab="screenId:key"`, with a guard falling back to `tabs[0].k`.

The nine `RECORDS` shapes and their tabs:
| shape | screens | tabs |
|---|---|---|
| `employee` | emp.record | personal, employment, account, bank, salary, insurance, emergency, docs(n), assets(n), leave |
| `myprofile` | emp.profile | personal, password, insurance, resign |
| `asset` | asset.record | details, history(n), maint(n), dep |
| `customer` | cust.360 | overview, contacts(n), activities(n), opps, projects, invoices, tickets, files |
| `opportunity` | opp.360 | details, activities(n), files(n) |
| `vendor` | vendor.edit | details, usage(n) |
| `workweek` | masters.workweek | policies(n), day, saturday(n), comp, paycycle, used |
| `taxes` | masters.taxes | billing(n), purchase(n), payroll(n), schemes(n), used |
| `company` | masters.company | general, addresses(n), bank(n), docs, prefix(n) |
| `emailconfig` | masters.email | server, templates(n), log |

The persistent-header-with-summary pattern is the one to standardise: Customer 360 keeps Total Invoiced / Received / Outstanding visible on every tab; Work Week keeps Net Hours/Day, Weekly Target, Working Days, Required Hours; invoice/bill documents keep Total / Paid / Balance.

### 4.3 Declarative field renderer (`U.field`, `app-core.js:336-367`)

Field spec: `{l, type?, v?, opts?, ph?, hint?, req?, ro?, lock?, span?, on?, checked?}`

Every field passes through `RBAC.fieldMode(S.role, S.route, f.l)` **before** rendering:
- `'hidden'` → returns `''`
- `'masked'` → renders `.masked` lock chip with `lockReason` as title
- `'read'` and not already `ro` → clones with `{ro:1, lock: lockReason(...) || 'Read-only'}`

**Supported field types (7):**
| type | control |
|---|---|
| *(default / omitted)* | `<input class="input" value placeholder [disabled]>` |
| `select` | `<select class="input">` from `opts[]`, `[disabled]` |
| `textarea` | `<textarea class="input" placeholder>`, `[disabled]` |
| `toggle` | `<span class="toggle [on]" data-toggle><span class="track"></span><span class="tl">{f.on \|\| 'Enabled'}</span></span>` — click handler toggles `.on` |
| `file` | full-width button → toast "File picker — PDF/JPG/PNG up to 5 MB." |
| `checkgroup` | `.checklist` of `.ck` rows with `.ck-box` checkmarks; `opts` may be `string` or `{l, v}`; `checked[]` marks selected (used only by `pr.sprintupdate`) |
| — | `masked` is not a field type but a **rendered state** produced by RBAC |

Markup: `<div class="field[ ro][ span2|span3]"><label>{l}[<span class="req">*</span>][<span class="field-lock">🔒 {lock}</span>]</label>{control}[<div class="hint">]</div>`

**Field-type usage across all 72 forms:** 69 `select`, 42 `toggle`, 32 `textarea`, 5 `file`, 1 `checkgroup`, remainder plain text.

**Composition helpers:**
- `U.section(title, fields[], note?, cols?)` → `.form-section` > `.form-section-head` (h4 + note) + `.form-grid[.two]` (3-col default, 2-col with `cols===2`; `.span2`/`.span3` on fields)
- `U.formbar(note, buttons[])` → sticky action bar; buttons filtered by `RBAC.can(S.role, S.route, b.l)`; adds "*<Role> is view-only on this screen — no save action is offered*" when mode is view. Button spec `{l, cls?, icon?, toast?, go?}` — `go` navigates, otherwise toast.

**Form registry:** `FORMS` in `app-screens.js:186` (9: `ticket, reassign, project, opportunity, customer, payment, billpayment, financialyear, creditnote`) + `FORMS_EXT` in `app-forms.js` (63). `R.form` looks up `FORMS[s.form] || FORMS_EXT[s.form]`. Shape: `{sections: [[title, fields[]], …], buttons: [...], note?}`. The convention documented at the top of `app-forms.js` is worth keeping: **every documented field is rendered as a real control — derived/auto/system values render `ro:1` with a lock label and a hint explaining the derivation**, never described only in prose.

### 4.4 Money alignment — one control point
`U.moneyAlign(c)` at `app-core.js:256-264`. **Amounts are LEFT-aligned.** It strips the `r` class from both `c.c` and `c.th` for any column where `type === 'money'`, or `type === 'masked'` and the header matches `/amount|total|value|salary|net|pay|balance|cost|price/i` — so masking an amount never shifts the column. Applied by `U.table` (app-core), `tableCard` (app-screens.js:119), and `mini` (app-screens2.js:13). Report tables detect money from the values themselves (`/₹/` in any cell → left; counts and averages stay right, `app-screens.js:427`). To flip the whole product to right-aligned, append `' r'` in this one function.

Formatters: `inr(n)` → Indian lakh grouping `₹18,45,000`, `—` for null/empty; `inrAbbr(n)` → `₹2.3L` / `₹50.0K` for dashboard/KPI only. Individual records never abbreviate.

### 4.5 Badge / status conventions
`U.cell` (`app-core.js:238`) maps column `type`:
- `status` → `U.badge(v)` = `<span class="badge-s {BADGE[v] || 'b-neutral'}">` with a 5px dot pseudo-element
- `chip` → `U.chip(v)` = `b-neutral plain` (dot suppressed)
- `money` → `inr(v)`, with `₹0` rendered in `--text-tertiary`
- `masked` → `.masked` lock chip with `maskNote` title
- `avatar:1` → `.mini-av` initials circle + name
- undefined/null/empty → `—`

Badge classes: `b-ok` (success), `b-warn` (warning), `b-danger`, `b-info`, `b-purple`, `b-neutral`, `b-accent`, `b-outline`.

**Complete `BADGE` status→class map** (`data.js:20-45`, 60 entries):
```
generic:      Active·b-ok  Inactive·b-neutral  Draft·b-neutral  Pending·b-warn  Approved·b-ok
              Rejected·b-danger  Cancelled·b-neutral  Completed·b-ok  Locked·b-danger  Open·b-warn
              Closed·b-neutral  Verified·b-ok  Pending Verification·b-warn  Submitted·b-info
              Yes·b-ok  No·b-neutral
employee:     On Notice·b-warn  Exited·b-neutral  In Progress·b-info  Not Started·b-neutral
ticket:       Resolved·b-ok  Urgent·b-danger  High·b-warn  Medium·b-info  Low·b-neutral  Unassigned·b-outline
asset:        In Use·b-ok  In Store·b-info  Under Repair·b-warn  Retired-Disposed·b-neutral
              Overdue·b-danger  Upcoming·b-info
finance:      Sent·b-info  Part-Paid·b-warn  Paid·b-ok  Unpaid·b-danger  Pending Approval·b-warn
              Reimbursed·b-ok  Processed·b-ok  Reissued·b-purple
opp/project:  Prospecting·b-neutral  Qualifying·b-info  Proposal·b-warn  Won·b-ok  Lost·b-danger
              Prospect·b-info  On Hold·b-warn  Planned·b-neutral  Fixed·b-ok  Critical·b-danger
              Backlog·b-neutral  To Do·b-info  In Review·b-purple  Done·b-ok
              'Upcoming '·b-info (trailing space — bug)  Reached·b-ok  Missed·b-danger
masters:      Mandatory·b-danger  Optional·b-outline  In Force·b-ok  Superseded·b-neutral
              Visible·b-ok  Hidden·b-neutral  Granted·b-ok  Revoked·b-danger
```
Note: `'Upcoming '` (line 41) carries a trailing space and shadows the correct `'Upcoming'` at line 33 only by key order — the trailing-space key is dead. Fix on port.

### 4.6 Other reusable primitives
- `U.kpi({icon, tone, bg, label, value, unit, foot, delta, dir, go, i})` — `.kpi` card with staggered `animation-delay: i*35ms`
- `U.ministat({icon, tone, bg, n, l, go})` — compact stat row with arrow affordance
- `U.card(title, sub, body, foot, right)` — auto-applies `.flush` padding when body contains `<table`, `class="feed"`, or `checklist`
- `U.feedItem({ico, tone, bg, t, m, u?, pin?})` — notification/announcement row with unread dot and Pinned flag
- `U.tabs(id, list, active)`, `U.note(html, kind)` (`''`/`warn`/`danger`), `U.empty(msg, hint)`, `U.soon(t, p)`, `U.exportBtns(label)`, `U.toast(msg, kind)` (auto-dismiss 3600ms)
- Meter rows: `.meter-row` with `--tone` custom property, used for leave balances, team ticket load, spend-by-type/month
- Board: `.board.c5` (tasks: Backlog/To Do/In Progress/In Review/Done) and `.board.c4` (bugs: Open/In Progress/Fixed/Closed); each column head shows a filtered live count
- Timeline (`.timeline`/`.tl-item`/`.tl-dot`), conversation thread (`.msg`/`.msg.internal`), composer with hard-to-miss Public Reply vs Internal Note segmented control

---

## 5. Design tokens (`app.css`)

### 5.1 Light `:root` (lines 7-49)
```css
--canvas:#f1f2f5;  --surface:#ffffff;  --surface-sunk:#f7f8fa;  --surface-raised:#ffffff;
--border:#e0e3e9;  --border-strong:#c7ccd6;  --hairline:#eaecf0;
--text-primary:#14171d;  --text-secondary:#545b68;  --text-tertiary:#878e9c;  --text-inverse:#ffffff;
--accent:#2a4bd7;  --accent-hover:#1f3ab0;  --accent-subtle:#eaeeff;  --accent-line:#c3cffb;
--success:#05704a;  --success-bg:#e4f5ed;  --success-line:#a8ddc6;
--warning:#8f5300;  --warning-bg:#fdf0dd;  --warning-line:#f0cf9c;
--danger:#ad2419;   --danger-bg:#fbe8e6;   --danger-line:#f0b8b3;
--info:#0d6088;     --info-bg:#e4f2f9;     --info-line:#a9d4e8;
--purple:#5b3aa6;   --purple-bg:#efe9fb;   --purple-line:#c9b8ec;
--neutral-bg:#edeff3;  --neutral-text:#545b68;  --neutral-line:#d8dce3;
--sidebar-bg:#14171e;  --sidebar-bg-hover:#1d222c;  --sidebar-bg-active:#222a3a;
--sidebar-text:#959daf; --sidebar-text-active:#ffffff; --sidebar-border:#232833; --sidebar-muted:#666e80;
--shadow-sm:0 1px 2px rgba(16,19,26,.06);
--shadow-md:0 6px 20px rgba(16,19,26,.10), 0 1px 3px rgba(16,19,26,.07);
--shadow-lg:0 20px 48px rgba(16,19,26,.22), 0 2px 8px rgba(16,19,26,.10);
--r-sm:4px;  --r-md:6px;  --r-lg:10px;
--topbar-h:52px;  --sidebar-w:246px;  --sidebar-w-collapsed:56px;
```
Note the sidebar is dark in **both** themes — the light theme is "cool grey canvas, dark sidebar".

### 5.2 Dark `:root[data-theme="dark"]` (lines 51-84)
```css
--canvas:#0a0c11;  --surface:#111419;  --surface-sunk:#0d1015;  --surface-raised:#161a21;
--border:#232830;  --border-strong:#333a46;  --hairline:#1d2128;
--text-primary:#eceef2;  --text-secondary:#9fa7b6;  --text-tertiary:#6b7382;  --text-inverse:#0a0c11;
--accent:#7592ff;  --accent-hover:#8fa6ff;  --accent-subtle:#18203a;  --accent-line:#2c3a63;
--success:#4fd39c;  --success-bg:#0f2b21;  --success-line:#1d4a39;
--warning:#efab55;  --warning-bg:#31220a;  --warning-line:#543c13;
--danger:#f2938c;   --danger-bg:#341714;   --danger-line:#5a2823;
--info:#63bce4;     --info-bg:#0d2632;     --info-line:#1b4356;
--purple:#b39bf0;   --purple-bg:#1e1733;   --purple-line:#3a2c5e;
--neutral-bg:#1a1e26;  --neutral-text:#9fa7b6;  --neutral-line:#2a303a;
--sidebar-bg:#0a0c11;  --sidebar-bg-hover:#161a21;  --sidebar-bg-active:#1a2130;  --sidebar-border:#1a1e25;
--shadow-md:0 6px 20px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.4);
--shadow-lg:0 20px 48px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.5);
```
Radii, spacing and layout dimensions are theme-invariant. `--shadow-sm` is not overridden in dark.

**Bug to fix on port:** `app-screens2.js` (attendance renderer, lines 1451/1480/1495/1497/1555-1557) references `var(--ok)` and `var(--warn)` — **neither is defined anywhere in `app.css`**. Those cells inherit their colour instead of turning green/amber. Correct tokens are `--success` and `--warning`.

### 5.3 Typography
```css
body { font-family:"IBM Plex Sans",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
       font-size:13px; line-height:1.45; -webkit-font-smoothing:antialiased; }
.mono,.num { font-family:"IBM Plex Mono",SFMono-Regular,Consolas,Menlo,monospace;
             font-variant-numeric:tabular-nums }
.num { letter-spacing:-.01em }
```
Scale in use: 13px body · 12.5px table cells and tab labels · 12px meters/links · 11.5px labels, hints, chips, notes · 11px badges, ids, `when` stamps · 10.5px table headers (uppercase, `letter-spacing:.06em`) · 9.5–10px matrix micro-labels · 22px login h1 · 24px payslip amount · 32px login pitch. Weights 400/450/500/550/600/650/700.

### 5.4 Layout / spacing / grids
```css
.grid { display:grid; gap:12px; margin-bottom:18px }
.g-kpi, .g-4 { repeat(4, minmax(0,1fr)) }   .g-2 { repeat(2,…) }   .g-3 { repeat(3,…) }
.g-8-4 { 2fr 1fr }   .g-4-8 { 1fr 2fr }
@media(max-width:1240px) { .g-kpi,.g-4 → 2 cols;  .g-8-4,.g-4-8,.g-2,.g-3 → 1 col }
@media(max-width:680px)  { .g-kpi,.g-4 → 1 col }
```
Card padding `13px`; card foot `8px 13px`; table cells `8px 13px`, headers `7px 13px`; pager `9px 13px`; form grid 3 columns collapsing to 2 at 1000px and 1 at 640px. Sidebar collapses to icon rail at ≤1080px, becomes an overlay at ≤860px.

Motion: `.rise { animation:rise .3s cubic-bezier(.22,.9,.3,1) both }` (opacity + 8px translateY); `pop` for popovers; `slidein` for toasts. Fully disabled under `@media(prefers-reduced-motion:reduce)`. A `@media print` block exists.

### 5.5 Theme / accent / scale runtime mechanism (`app-core.js:533-607`)

**All three are in-memory only — nothing is written to `localStorage`.** Each writes an **inline custom property on `<html>`**, which beats the stylesheet's `[data-theme]` values, so a live change survives a theme switch without recomputation.

- `setTheme(t)` → `S.theme = t`; `document.documentElement.setAttribute('data-theme', t)`; swaps the topbar icon; calls `applyAccent()`; re-renders the user menu; re-renders Settings if it's the active route. `'system'` resolves via `matchMedia('(prefers-color-scheme: dark)')` at click time (it does not subscribe to changes).
- `applyAccent()` writes `--accent`, `--accent-hover`, `--accent-subtle`, `--accent-line` onto `document.documentElement.style`.

**Six presets (`window.ACCENTS`), each hand-tuned per theme:**
| key | name | light accent/hover/subtle/line | dark accent/hover/subtle/line |
|---|---|---|---|
| `blue` | Blue (default) | `#2a4bd7 #1f3ab0 #eaeeff #c3cffb` | `#7592ff #8fa6ff #18203a #2c3a63` |
| `purple` | Purple | `#7c3aed #6425d1 #f2ebfe #d8c2fb` | `#a78bfa #b79cfc #241a3d #3d2e5c` |
| `green` | Green | `#059669 #047857 #e6f7f1 #b9e8d6` | `#34d399 #4ade80 #103328 #1f4d3c` |
| `amber` | Amber | `#d97706 #b45309 #fef3e2 #fbd9a5` | `#fbbf24 #fcd34d #3a2a0d #5c4318` |
| `rose` | Rose | `#e11d48 #be123c #fde8ec #f9c2ce` | `#fb7185 #fda4af #3a1620 #5c2432` |
| `teal` | Teal | `#0d9488 #0f766e #e3f6f4 #a8e0da` | `#2dd4bf #5eead4 #0f2e2b #1b4842` |

**Custom accent** (`setCustomAccent(hex, rerender)`, default `#2a4bd7`): validates `/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i`, sets `S.accent='custom'`, and derives the full 4-colour ramp via `rampFrom(hex, dark)`:
```
light: accent = hex
       hover  = mix(base, black, .22)
       subtle = mix(base, white, .90)
       line   = mix(base, white, .68)
dark:  accent = mix(base, white, .22)
       hover  = mix(base, white, .38)
       subtle = mix(base, #0a0c11, .84)
       line   = mix(base, #0a0c11, .66)
```
The Settings swatch **is** the `<input type="color">` (opacity 0, absolutely positioned over a conic-gradient circle), so `oninput` recolours the whole app live while dragging the OS colour wheel.

**Display scale** (`setScale(n)`): `SCALES = [90, 100, 110, 125, 150]`, clamped `80…200`, applied as `document.body.style.zoom = (n/100).toFixed(2)`. **Default is 110** (`S.scale = 110`) — "the size this prototype was reviewed and signed off at". A range input (`min 80 max 200 step 5`) drives it live. `body.style.zoom` is a non-standard property — Angular should use a root `font-size`/`rem` scale or a CSS transform instead.

**Global state object** (`app-core.js:78`):
```js
const S = { authed:false, role:'superadmin', route:'dashboard', theme:'light',
            accent:'blue', customAccent:'#2a4bd7', scale:110, collapsed:false,
            open:{}, tab:{}, view:{} };
```
`open` = expanded sidebar modules; `tab` = active tab per screen id; `view` = active segmented-view per screen id (`cal|list`, `stages|table`, `matrixRole`).

---

## 6. Genuinely stateful logic already implemented — preserve as real behaviour

These are computed at load or render time from real inputs, not hardcoded strings. Each maps to a FastAPI service + MySQL schema.

### 6.1 Pay-cycle date resolution (`data.js:658-692`)
`D.masters.payrollCycle = { mode:'Fixed Cycle — Custom Start/End Day', startDay:26, endDay:25, creditDay:30, status:'Active' }`

- **`D.payPeriodRange(monthName, year)`** — returns `{from, to}` in `dd-mm-yyyy`. Fixed-cycle mode: `from = new Date(year, monthIndex-1, startDay)`, `to = new Date(year, monthIndex, endDay)`. If `mode` starts with `'Calendar'`, falls back to first/last of month. Nothing hardcodes 26th/25th; every consumer reads the master.
- **`D.payCreditDate(monthName, year)`** — `day = Math.min(creditDay || lastDay, lastDay)` where `lastDay = new Date(year, mi+1, 0).getDate()`. **Correctly clamps a credit day of 30/31 into February** instead of rolling into March the way raw `Date` arithmetic would.
- **Cutoff carryover rule** (`D.payrollCarryover`): an event dated after `endDay` always rolls into the *next* run, never the period that already closed. Worked example encoded: Arun Menon's 1-day Casual Leave on `27-07-2026` misses the July cutoff (`26-06 → 25-07`) and is picked up by August (`26-07 → 25-08`). Surfaced on `payroll.run` and the Work Week → Pay Cycle tab.

### 6.2 Saturday calendar derivation (`D.masters.satCalendar`, `data.js:697-721`)
Generated by iterating every day from `01-Apr-2026` to `31-Mar-2027`, keeping Saturdays, counting the ordinal within its month. Odd ordinals (1st, 3rd, 5th) → `rule:'Working'`, `hrs:8`; even (2nd, 4th) → `Week Off`, `hrs:0`. **A `Mandatory` holiday overrides the rule** (`actual:'Holiday'`, `hrs:0` — e.g. 15-08-2026, a 3rd Saturday). An `Optional` holiday does *not* — the Saturday stays working and anyone taking it draws on leave balance. Output rows: `{month, date, ord, rule, actual, hrs, note}`.

### 6.3 Day-wise attendance computation (`D.attendanceDaily`, `data.js:724-775`)
For each of the 30 days of June 2026, from raw check-in/check-out pairs:
- **Day type**: Mandatory holiday → `req 0`; Sunday → `Week Off — Sunday`, `req 0`; Saturday → reads `satCalendar.actual`, `req = working ? 8 : 0`; else `Working Day`, `req 8`.
- **Break deduction**: `brk = gross < 6 ? 0.5 : 1`; `worked = gross − brk`.
- **Status ladder**: `req===0` → `Comp / Extra Work` if punched, else `Holiday`/`Week Off`; no punch → `Absent`; `worked >= req` → `Full Day`; `worked >= req − 0.25` → **`Full Day — grace`** (the 15-minute grace window); `worked >= 4` → `Half Day`; else `Absent`.
- **`bal = worked − req`** for that day alone. **`comp` is an "of which" subset of `worked`, never added on top** — it labels how much of that day's hours are credited against an earlier shortfall.

The encoded worked example: 09-06 half day (4.42 worked vs 8 → 3.58h short), made up on **27-06, a 4th Saturday (normally off)**, 10:00–14:30 = 4.0h, employee's own chosen day. 24-06 is 0.17h under and absorbed by grace.

Companion master `D.masters.hourRules` states the same ladder declaratively: Full Day ≥8.00h / Full Day—grace 7.75–7.99 / Half Day 4.00–7.74 (0.50 day, "unless compensated") / Absent 0.00–3.99 (full-day LOP unless approved leave covers it).

### 6.4 Monthly hour reconciliation (`D.attendanceMonthly`, `data.js:778-815`)
Per employee, driven by which work-week policy covers them:
```
dayNet  = intern ? 4.5 : 8
days    = sixDayPolicy ? 26 : (intern ? 22 : 24)     // 24 = 22 weekdays + 2 working Saturdays in Jun 2026
reqH    = days × dayNet
lvH     = leaveDays × dayNet
credited= worked + lvH                                // comp already inside worked — adding it double-counts
bal     = credited − reqH
short   = bal < 0 ? |bal| : 0
payable = min(days, credited / dayNet)
lop     = max(0, days − payable)
status  = short===0 ? 'Met' : short <= dayNet ? 'Short — compensable' : 'Short — payroll impact'
```
Arun Menon's row is computed by reducing `D.attendanceDaily`, not seeded — the two screens can never disagree.

### 6.5 Shortfall → Loss of Pay conversion (`R.attendance`, `app-screens2.js:1532-1568`)
```
pend   = Σ makeupHrs of that employee's Pending compRequests
net    = max(0, short − pend)
lopNet = net / dayNet
rate   = 112500 / (22 + workingSaturdays) / policy.net        // gross ÷ working days ÷ net hours
estimatedDeduction = round(net × rate)
```
The rule this encodes: **a pending compensatory request suspends the deduction, it does not cancel it.** Approved → shortfall clears, nothing reaches the payslip. Rejected, or the compensation window (`policy.window`, 30 days) closes → the full amount converts at the next run. Next-step text is derived per row (`no make-up proposed` / `approve and this clears in full` / `covers only X of Y h`).

### 6.6 Exit checklist gating (`R.checklist`, `app-screens.js:472-491` + `D.exitSteps`)
`gate` names the step that must be `done` before a step can be actioned. `blockedBy(i) = i.gate && !doneNames.includes(i.gate) ? i.gate : null`. A blocked step renders a lock icon, a `Locked` badge, and "Blocked — '<gate>' has to be done first"; its Open/Mark done buttons are withheld. The chain:
```
Generate resignation acceptance letter   (no gate — fixes Last Working Day)
  └─ Return all assigned assets          gate: Generate resignation acceptance letter
       ├─ Mark final settlement due      gate: Return all assigned assets
       ├─ Disable login                  gate: Return all assigned assets
       └─ Change status to Exited        gate: Return all assigned assets
```
Footer counts outstanding steps and how many are still locked behind an earlier one. This is the only genuinely enforced workflow ordering in the prototype and should become a real state machine.

### 6.7 Derived masters and cross-screen dependencies
- `BANKS = D.masters.bank.filter(b => b.status === 'Active').map(b => b.name)` (`data.js:881`) — **every** bank-account filter and dropdown across Expense, Purchase Bill, Invoice and Vendor is built from this, so a deactivated account can never be listed.
- `D.masters.satCalendar` is itself derived (§6.2) and read by `attendanceDaily`, `attendanceMonthly`, `R.attendance`, and the Work Week record.
- Invoice/bill tax dropdowns filter `D.masters.taxHeads` by `scope` (`/Sales/` vs `/Purchase/`) **and** `force === 'In Force'`, appending `— Custom —`.
- `masters.hsn` rows carry `tax` = the linked head's real editable name, never a generic bucket; different codes deliberately link to different heads (IGST vs CGST+SGST, different rates).
- Tax Declarations (`R.taxdecl`) renders one row per head with `scope === 'Employee Declaration / Exemption'` — the screen contains no knowledge of any deduction's name (project-wide rule: no tax may be named in the spec).
- `D.team = D.employees.filter(e => e.mgr === 'Vikram Iyer')` drives every `team` scope.
- Straight-line depreciation (`R.depreciationBody`, `app-screens2.js:1149`): `cv = max(0, round(pv − (pv/life) × years))`; never typed in; missing Purchase Value or Useful Life must show "Not available" rather than guessing.
- Leave remaining is always computed (`allowed + cf − taken − pending`), never stored; `quota === 0` renders "Not tracked".
- `D.masters.numberPrefixes` holds the running-code generators: `EMP-<FY>-0000` (next 15), `CUST-<FY>-0000` (9), `INV-<FY>-00000` (154), `CN-<FY>-0000` (5), `PB-<FY>-0000` (32), `TKT-<FY>-0000` (913), `AST-<FY>-0000` (14), `PRJ-<FY>-0000` (9), `OPP-<FY>-0000` (9), `QUO-<FY>-0000` (6). Starting Number locks once a code of that type has been generated (`masters.company.prefix`).
- `D.masters.emailTemplates` — 16 trigger points with per-trigger `enabled` flag and `{{merge_field}}` subjects; `Asset Request Rejected` is the one shipped disabled.
- `window.SCOPE_UNRESOLVED` — an intentional test hook: any screen declaring a scope with no matching `SCOPE_RULES` entry records itself instead of silently returning unscoped data. Port this as a startup assertion.

### 6.8 What is *not* real (decorative)
Filters, search, sort, pagination, save/approve/reject, exports, file upload, toggles and the RBAC matrix's own toggle state are all `data-toast` handlers or CSS class flips — they report what they would do. The counts they display (`Showing X of Y`, board column counts, tab count pills, badge totals) *are* live, computed from the filtered/scoped arrays.