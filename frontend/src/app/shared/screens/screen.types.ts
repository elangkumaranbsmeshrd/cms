import type { RefDataService } from './ref-data.service';

// 'chip' (U.chip(), app-core.js:236): a plain neutral tag, not a status
// indicator — same badge-s markup as 'status' but always b-neutral/plain,
// no per-value colour lookup. 'avatar': the value prefixed with a small
// initials bubble (U.cell()'s own col.avatar branch, app-core.js:245) —
// for a person's name column, not an id.
export type ColumnType = 'text' | 'code' | 'date' | 'number' | 'money' | 'status' | 'chip' | 'avatar';

// Resolves a plain FK id (e.g. Customer.status_id) to a human label via one
// of the real Masters lookup endpoints (masters_lookup.py's generic factory
// — every one of the 15 simple sub-masters returns {id, name, is_active}).
// The raw list/detail JSON never denormalizes this server-side (confirmed by
// reading customers.py/assets.py — status_id/category_id/etc. go over the
// wire as bare ids, the export path is the only place that resolves them),
// so a screen with an FK column needs this to show something a person can
// read instead of a UUID.
export interface RefLookup {
  readonly endpoint: string; // e.g. '/masters/customer-statuses', under environment.apiBaseUrl
  readonly labelKey?: string; // defaults to 'name' — every simple sub-master uses that field name
}

export interface ColumnDef<T> {
  readonly key: string;
  readonly header: string;
  readonly type?: ColumnType;
  readonly compute?: (row: T) => unknown;
  readonly ref?: RefLookup; // resolves this column's raw value (an id) through a Masters lookup
  // The prototype's per-column class string (data.js columns[].c) — 'cell-strong'
  // for the identifying column, 'mono' for codes/dates, 'cell-accent' to tint.
  // Without this the config layer has no way to ask for the styling at all.
  readonly cellClass?: string;
  // Maps a raw backend enum onto the label a person should read. The backend
  // sends SCREAMING_SNAKE (claim_type: REIMBURSABLE, holiday_type: MANDATORY,
  // method: GST_CGST_SGST) and every one of those was rendering verbatim.
  readonly staticOptions?: readonly FilterOption[];
  // RBAC Layer 3 — names the FIELD (not necessarily this column's own `key`;
  // a computed/ref column may derive from a differently-named backend field)
  // whose fieldMode() this column's whole visibility rides on. 'hide' drops
  // the column (header included) entirely — the same "the field's visibility
  // decides" rule FilterDef.hideWhenFieldHidden already applies to filters,
  // e.g. Vendor's GSTIN/Bank columns for Manager. 'mask' keeps the column but
  // replaces the cell with a masked placeholder — e.g. Team Payslips' Net Pay
  // for Manager (prototype's own Layer 3 example, index.html's header note).
  readonly sensitiveField?: string;
  // Prototype's col.maskNote (app-core.js:243) — the masked placeholder's
  // tooltip. Defaults to a generic "hidden by a field-level permission" note.
  readonly maskNote?: string;
}

// ---------------------------------------------------------------------------
// Filters — RBAC 14 §2.2(c): the baseline set every list screen carries, and
// §2.2(f): "What exports is exactly what is on screen: current filters, current
// search, current sort, current column set."
//
// `transport` is the load-bearing member. A 'server' filter becomes a real query
// param, so the export URL carries it and the PDF's own "Filters:" header block
// is TRUE. A 'client' filter is applied in JS over the fetched array — necessary
// where the endpoint has no such param, but it means the export cannot honour it.
// ListScreenComponent tells the user that plainly rather than exporting a
// different set than the screen shows while claiming otherwise.
// ---------------------------------------------------------------------------
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  // Per-option badge colour override for a status-typed ColumnDef.staticOptions
  // entry — mirrors CalendarEventTypeOption's exact {value, label, badgeClass?}
  // shape (this file, below), merged onto FilterOption itself rather than a
  // parallel type since staticOptions and a FilterDef's own `options` are
  // routinely the SAME array (leave.approvals.list.config.ts's STATUS_OPTIONS
  // is the reference case), so the smaller change is one optional field here
  // rather than a second type both call sites would have to agree on. Only
  // ListScreenComponent's status-badge rendering reads this (falling back to
  // cell-format.ts's shared badgeClass() when absent) — every other FilterOption
  // consumer (plain filter dropdowns) simply never sets or reads it.
  readonly badgeClass?: string;
}

export interface DateRangeValue {
  readonly preset: string | null; // e.g. 'this_fy' — see date-presets.ts
  readonly from: string | null; // yyyy-mm-dd
  readonly to: string | null;
}

// A plain Min/To numeric bound, no presets — unlike DateRangeValue there is no
// financial-year-style named preset for a number (Purchase Value, Cost), so
// this is the simplest shape that still round-trips through sessionStorage
// persistence and the filter chip the same way DateRangeValue does. First
// needed use: rbac.role-directory.list.config.ts's own people_count filter
// was left off the bar for exactly this gap ("a real fix needs a new
// 'numberrange' FilterKind... frontend-shape scope beyond this one screen") —
// this is that fix, built generic rather than tied to whichever screen asked
// for it first (Asset Management's Purchase Value / Cost ranges).
export interface NumberRangeValue {
  readonly min: number | null;
  readonly max: number | null;
}

export type FilterValue = string | readonly string[] | boolean | null | DateRangeValue | NumberRangeValue;

export type FilterKind =
  | 'select' // one-of, rendered as a <select>
  | 'multiselect' // §2.2c: "Multi-select, not single-select" — Status is this
  | 'tristate' // Any / Yes / No, for the prototype's "Locked — Any", "Used — Any"
  | 'daterange' // From/To + presets incl. financial years
  | 'numberrange' // Min/Max on a plain numeric column — Purchase Value, Cost
  | 'activeInactive' // §3.0's Active-by-default + explicit "include inactive"
  // A bare substring match against one text column server-side (e.g.
  // Opportunity's Lost Reason) — distinct from the screen's own global
  // Search box, which spans several columns at once. First needed use:
  // 09-opportunity-module.md §2.1's lost_reason filter, same "no FilterKind
  // fits this" gap numberrange itself was added to close (see that kind's
  // own comment above) rather than left disclosed-and-deferred.
  | 'text'
  // A single numeric threshold, not a min/max pair — e.g. Opportunity's
  // "stale — no activity in N days" (stale_days). 'numberrange' doesn't fit:
  // the backend takes exactly one cutoff value, not two bounds.
  | 'number';

export type FilterTransport = 'server' | 'client';

export interface FilterDef<T> {
  readonly key: string;
  readonly label: string; // chip prefix and control title, e.g. 'Status'
  readonly kind: FilterKind;
  readonly transport: FilterTransport;
  // transport 'server': the query param name to send (defaults to `key`).
  readonly param?: string;
  // The neutral option's label, e.g. 'All Statuses', 'Locked — Any'.
  readonly allLabel?: string;
  readonly options?: readonly FilterOption[];
  readonly optionsRef?: RefLookup; // options sourced from a Masters lookup
  // Derive the option list from the rows actually present — the honest choice
  // for a dimension with no dedicated endpoint (e.g. distinct linked tax heads).
  // refData is the same cache ColumnDef.ref/FieldConfig.ref read from — passed
  // through so a row-derived option list can label its values via a lookup too
  // (e.g. a raw User id column with no dedicated Masters endpoint of its own).
  readonly optionsFromRows?: (rows: readonly T[], refData: RefDataService) => readonly FilterOption[];
  // REQUIRED when transport === 'client'. Returns whether `row` survives `value`.
  readonly predicate?: (row: T, value: FilterValue) => boolean;
  readonly defaultValue?: FilterValue;
  // §2.2e: Super Admin gets filters no other role sees ('Created By',
  // 'Last Modified By', 'Show inactive', 'All financial years').
  readonly superAdminOnly?: boolean;
  // §2.2b exception 1 — the dimension is meaningless at this role's scope
  // (an Employee's own payslip list has no Employee filter). NOT a permission.
  readonly hideForRoles?: readonly string[];
  // Same exception 1, but keyed on the screen's actually-RESOLVED mode
  // rather than a static role list — needed wherever a mode-widening
  // toggle (backend/app/rbac/toggles.py's MODE_TOGGLE_GATES) can change
  // whether the dimension is meaningless at runtime. hideForRoles alone
  // can't express this: it checks session.role() (the caller's real role
  // code), which a toggle never changes — only the resolved `mode` does.
  // Ticket List's own Assigned Staff filter (§2.2b's clearest worked
  // example) is the first real case: hidden while Employee's ticket.list
  // mode is 'own', shown once "Allow Staff to View the Full Open Ticket
  // Queue" widens it to 'full'.
  readonly hideWhenScopeIsOwn?: boolean;
  // §2.2b exception 2 — "a filter on a field that role cannot see at all…
  // The field's visibility decides; the filter follows." Names a column header
  // whose fieldMode() is consulted.
  readonly hideWhenFieldHidden?: string;
  // Chip text override; defaults to the selected option label(s).
  readonly formatChip?: (value: FilterValue) => string;
}

// A one-way, no-body POST action on an existing row — Financial Year's
// Lock/Set Current are the motivating case: NOT an edit (there's no PUT on
// that resource at all, some transitions are deliberately irreversible),
// just a button that fires a specific endpoint and refreshes the list.
export interface RowActionDef<T> {
  readonly label: string;
  readonly endpoint: (row: T) => string;
  readonly screenAction: string; // PolicyStore.can(id, screenAction) gates visibility
  readonly visible?: (row: T) => boolean; // e.g. hide "Lock" once already locked
  readonly confirm?: string; // window.confirm text before firing, for anything irreversible
  // Defaults to POST with an empty body. DELETE exists because Masters §3.0's
  // two-tier lifecycle is Deactivate (POST /{id}/deactivate) AND a real
  // DELETE /{id} for a row nothing references yet — the dispatcher used to
  // hardcode post(), so the delete half was not expressible at all.
  readonly method?: 'POST' | 'DELETE';
  // Most row actions are a no-body POST. Taxes' Duplicate is not — it takes a
  // full TaxHeadCreate, so firing it with `{}` 422s. Build it from the row.
  readonly body?: (row: T) => unknown;
  // Where to go afterwards instead of just reloading — Taxes' Duplicate
  // returns the newly created head and should open its edit form.
  readonly onSuccess?: (response: unknown) => readonly unknown[];
}

// A page-head button beyond "+ Add" — Holidays' "Bulk Import", Email
// Configuration's "Send Test Email". Either navigates (route) or fires a
// POST (endpoint); gated by PolicyStore.can(id, screenAction).
export interface SecondaryActionDef<T = unknown> {
  readonly label: string;
  readonly icon?: string;
  readonly route?: readonly unknown[];
  readonly endpoint?: string;
  readonly screenAction: string;
  readonly confirm?: string;
  // Defaults to a bare `{}` body (every pre-existing action — "Bulk Import",
  // "Send Test Email" — takes no input). Set this for an action that needs
  // one, built from whatever rows are currently on screen — e.g. Team
  // Timesheet's "Approve All Submitted" posts the visible page's Submitted
  // entry ids (project.team-timesheet.list.config.ts). Return null to mean
  // "nothing on screen qualifies right now" — the component skips the
  // request and shows that instead of firing a call the backend would just
  // reject.
  readonly endpointBody?: (rows: readonly T[]) => unknown;
}

export interface ListScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'list';
  readonly id: string; // RBAC screen key, e.g. 'employee.directory'
  readonly title: string;
  readonly description?: string;
  readonly endpoint: string; // real backend path under environment.apiBaseUrl, e.g. '/employees'
  readonly rowId: (row: T) => string;
  readonly columns: readonly ColumnDef<T>[];
  // null/undefined for a SPECIFIC row (not the whole config) opts that one
  // row out of navigation — e.g. Obligations-By-Document, where a
  // Purchase-Bill-sourced row can link through to its real record but a
  // Payslip-sourced one has no frontend route to send it to.
  readonly rowRoute?: (row: T) => readonly unknown[] | null | undefined;
  readonly defaultPageSize?: 25 | 50 | 100;
  readonly emptyText?: string;
  // The prototype puts the spec section beside every page title ("§3.1"), which
  // is how a reader ties a screen back to the document that specifies it.
  readonly specRef?: string;
  // What one row IS, for honest counts and empty-state wording — "No holidays
  // match…" rather than "No records found." §2.2c: "A bare 'No records found'
  // is not acceptable on a filtered screen."
  readonly recordNoun?: string;
  // RBAC 14 §2.2c. Rendered in declaration order in the filter bar.
  readonly filters?: readonly FilterDef<T>[];
  // Which fields the search box actually searches. Today search is a
  // JSON.stringify substring match over the whole row, which quietly matches
  // ids and internal flags. §3.0 asks for "that sub-master's name and code fields".
  readonly searchFields?: readonly string[];
  // Server-side search param name; `false` keeps search client-side (and the
  // component then discloses that export cannot honour it).
  readonly searchParam?: string | false;
  // §3.0: "defaulting to Active with an explicit 'include inactive' option".
  // The param name to send when the user asks for inactive rows; `false` where
  // the endpoint has no such concept.
  readonly includeInactiveParam?: string | false;
  // A screen-level restriction that is NOT a user-facing filter and never
  // appears as a chip — e.g. a sub-resource list showing only rows belonging
  // to one parent. Applied before filters, so counts stay honest.
  readonly rowFilter?: (row: T) => boolean;
  // Renders a "+ Add New" button in the page header, gated on
  // PolicyStore.can(id, 'edit') — same action the real create endpoint
  // requires. Points at a 'form'-shape screen's create route.
  readonly createRoute?: readonly unknown[];
  readonly createLabel?: string;
  // Defaults to 'edit', which is what most module.directory ScreenDefs register
  // for their write endpoint. Email Templates is the exception — its POST
  // requires action="create" (masters_email_config.py:132), so without this a
  // role with edit-but-not-create saw an Add button that 403s.
  readonly createScreenAction?: string;
  // Page-head buttons beyond "+ Add" — Holidays' "Bulk Import", Email
  // Configuration's "Send Test Email". Either navigates (route) or fires a
  // no-body POST (endpoint); gated by PolicyStore.can(id, screenAction).
  readonly secondaryActions?: readonly SecondaryActionDef<T>[];
  readonly rowActions?: readonly RowActionDef<T>[];
  // RBAC 14 §2.2f: "every list screen gets Export to PDF and Export to
  // Excel, available to every role that can open the screen." Only set
  // this true where the real endpoint has actually been confirmed to
  // accept `?format=pdf|excel` (`list_export.build_export` — roughly 63 of
  // this backend's list endpoints, not all; e.g. Pay Cycle deliberately
  // has none, per its own docstring: "a single settings record... not a
  // list screen"). Exports the current backend-scoped result set — NOT
  // filtered by the client-side search box, since search here is a
  // client-side JS filter over the full fetched array, not a server query
  // param (ARCH-3's own documented divergence) — a real, disclosed limit,
  // not silently wrong.
  readonly exportable?: boolean;
}

// 'checkgroup' binds an ARRAY of strings to one key, rendered from
// staticOptions. tax_heads.withholding_directions is list[str] and
// masters_taxes.py:141-149 rejects a WITHHOLDING_AT_SOURCE head with none —
// so without this the Add Tax Head form could not create a withholding head
// at all, which is the entry point for Module 15's whole register.
// 'file' — an upload bound to a `*_file_id` column (Company Profile's
// logo_file_id/letterhead_file_id, Bank Account's upi_qr_file_id). Backed by
// the one generic upload endpoint every such column already resolves
// through (POST/GET /files, files.py) — see FileUploadService and each
// form component's own 'file' template branch. Read mode has no use for
// this: unlike every other FieldType there is no ColumnDef equivalent, a
// stored file is never a list column.
export type FieldType = 'text' | 'date' | 'status' | 'select' | 'number' | 'checkbox' | 'textarea' | 'password' | 'email' | 'checkgroup' | 'file';

export interface FieldConfig<T> {
  readonly key: keyof T & string;
  readonly label: string;
  readonly type?: FieldType;
  // `secondary` is only ever populated on a RecordFieldsTab that sets its own
  // `secondaryEndpoint` (e.g. Account & Login's login-status read) — every
  // other caller of FieldConfig ignores the 2nd param entirely, so existing
  // single-arg `compute: (row) => ...` definitions stay valid as-is.
  readonly compute?: (row: T, secondary?: unknown) => unknown;
  readonly ref?: RefLookup; // read mode: label resolution (ColumnDef.ref). 'select' write mode: same lookup sources the <option> list.
  // For a 'select' field backed by a fixed enum on the backend's Pydantic
  // model (e.g. Expense Type's claim_type: REIMBURSABLE|COMPANY_PAID) rather
  // than a Masters lookup table — no HTTP call, just this literal list.
  readonly staticOptions?: readonly { readonly value: string; readonly label: string }[];
  // Whether this field can be edited when the record is in edit mode. Only
  // meaningful on fields that map to a real writable key on the backend's
  // Write schema — computed/rollup fields (e.g. Customer's total_invoiced)
  // must never set this, there's nothing server-side to persist it to.
  readonly editable?: boolean;
  // Form shape only: settable at creation, immutable after — e.g. Number
  // Prefix Rule's code_type/label exist only on the Create schema, not the
  // Update one at all. An input in create mode, plain read-only text once
  // editing an existing row (FormScreenComponent has no other concept of
  // per-mode field editability, unlike the record shape's `editable`).
  readonly createOnly?: boolean;
  // The prototype puts a required marker on `req` fields and a hint line under
  // nearly every input (app-screens.js field objects: {l, req, hint, …}). Both
  // were being dropped, which is why the forms read as bare boxes beside the
  // prototype's.
  readonly required?: boolean;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly span?: 1 | 2; // 2 = full width in the two-column grid
  // Groups fields under a titled divider within the ONE flat grid every
  // 'form'-shape screen otherwise renders (FormScreenConfig has no tabs —
  // see its own doc). Optional and rare: most of the 25 lookup forms this
  // shape backs are genuinely flat, one-purpose screens with nothing to
  // group. Add Tax Head is the reference case needing it — the prototype's
  // own 3 titled sections (Tax Details / Rate / Extra) are part of what
  // distinguishes it from "28 fields in one sprawling page," not just field
  // order. A divider renders before the first field of each new section
  // value encountered, in field-array order — not a separate `sections`
  // array to keep in sync, so a reordered field carries its heading with it.
  readonly section?: string;
  // Client-side format check mirroring a real backend validator — GSTIN is
  // exactly 15 chars, PIN 6 digits, IFSC 11. Advisory; the API stays authority.
  readonly pattern?: { readonly re: RegExp; readonly message: string };
  // Progressive disclosure — e.g. a Tax Head's slab fields only apply once the
  // method is a slab method. A hidden field is not submitted.
  readonly visibleWhen?: (formModel: Record<string, unknown>) => boolean;
  // Masters §3.2d's "disappearance rule" — Tax Head's Tax Scheme field must
  // vanish entirely while zero schemes exist, not just show an empty
  // dropdown. Unlike `visibleWhen` (a pure function of THIS form's own
  // model), this is live external data — whether `ref`'s own endpoint has
  // any rows at all — so it can't be expressed as a formModel predicate.
  // Reuses the exact same RefDataService cache `ref` already populates for
  // the field's own <option> list; hidden for both "still loading" and
  // "loaded, zero rows" (RefDataService.options() returns null then [],
  // both falsy-length), same as `visibleWhen`, a hidden field is not
  // submitted either.
  readonly hideWhenRefEmpty?: RefLookup;
  // Record shape only, paired with RecordFieldsTab.secondaryEndpoint — hides
  // this field while that secondary read hasn't resolved to a real object
  // yet (still loading, or the host record has none — e.g. Account & Login's
  // Set Role/Must Change Password/Last Login only mean anything once a login
  // exists at all).
  readonly hideWhenNoSecondary?: boolean;
  // 'file' fields only. The `purpose` string POST /files validates the
  // upload against (files.py's `_PURPOSE_RULES` — e.g. 'company_logo' caps
  // JPEG/PNG at 2MB). Falls back to the endpoint's own generic rule when
  // omitted, so naming this is optional but always more correct than not.
  readonly uploadPurpose?: string;
  // Native <input type="file" accept="…">, e.g. 'image/jpeg,image/png' — a
  // client-side hint only (narrows the OS file picker); `uploadPurpose`'s
  // server-side rule is the real gate.
  readonly fileAccept?: string;
}

export interface FieldSection<T> {
  readonly title: string;
  readonly fields: readonly FieldConfig<T>[];
}

// A 'fields' tab reads/writes through the record's own single load+edit
// endpoint (RecordScreenConfig.loadEndpoint / edit.saveEndpoint) — the shape
// every tab used until now. An 'embed' tab hosts a genuinely separate
// RBAC-screen-keyed sub-resource with its OWN endpoint(s) — e.g. Employee
// Master Record's Documents/Assigned Assets (their own list endpoints) or
// Insurance & Benefits (its own enroll/list endpoints) — composing an
// existing shape (list/singleton) rather than inventing a sixth. Matches the
// 'tabbed' shape's own TabDef.config composition, so a screen embedding a
// list looks identical whether its host is 'tabbed' or 'record'.
// An immediate, individually-fired action button on a record's own fields
// tab — Employee Master Record's Account & Login is the motivating case
// (Create Login/Disable Login/Enable Login/Reset Password, 02-employee-
// module.md §2.2): none of these are edits to a stored field (there's no
// PUT that would cover them), each is its own dedicated POST the record's
// Edit/Save flow doesn't touch at all. Distinct from RowActionDef (a LIST
// row + list reload) — this fires against the HOST RECORD's own id and
// reloads that one record, not a list.
export interface RecordActionDef<T> {
  readonly label: string;
  readonly endpoint: (id: string) => string;
  // PolicyStore.can(screenId ?? recordConfig.id, screenAction). Most
  // actions belong to the host record's own screen (Create Login/Disable
  // Login/Reset Password are all real `employee.master_record` actions) —
  // `screenId` is only for the rare action gated on a genuinely DIFFERENT
  // RBAC screen, e.g. Send Welcome Email is `send_welcome_email` on
  // `employee.onboarding`, not anything registered on the master record
  // itself (app/rbac/registry/screens.py) — checking it against the host
  // record's id would silently never resolve true for any role.
  readonly screenId?: string;
  readonly screenAction: string;
  readonly visible?: (row: T) => boolean; // e.g. hide "Enable Login" while already enabled
  readonly confirm?: string;
  readonly method?: 'POST' | 'DELETE';
  readonly body?: (row: T) => unknown;
  // Create Login needs a Role picked BEFORE it fires (employees.py's
  // create-login takes `role_code` as a query param, not a body) — a single
  // inline <select> rendered beside the button rather than a full dialog,
  // since it's the only input the action needs.
  readonly selectParam?: {
    readonly label: string;
    readonly param: string; // query param name
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly defaultValue?: string;
  };
}

export interface RecordFieldsTab<T> {
  readonly kind?: 'fields'; // default; omit for a plain fields tab
  readonly id: string;
  readonly label: string;
  readonly sections: readonly FieldSection<T>[];
  // Rendered above the sections, in declaration order — see RecordActionDef.
  readonly actions?: readonly RecordActionDef<T>[];
  // GET, fetched once when this tab is first activated — for the rare field
  // that lives on a genuinely separate resource (Account & Login's
  // login-status: must_change_password/last_login_at/role_name all live on
  // the linked `users` row, not on the employee itself, see
  // LoginStatusOut's own backend docstring for why). Exposed to
  // FieldConfig.compute's 2nd param and to `hideWhenNoSecondary`. NOT for
  // tabular/list data — an embed tab hosting the 'list' shape already
  // covers that (Documents/Assigned Assets), this is for a handful of
  // extra read-only VALUES alongside this tab's own fields/actions.
  readonly secondaryEndpoint?: (id: string) => string;
}

export interface RecordEmbedTab {
  readonly kind: 'embed';
  readonly id: string;
  readonly label: string;
  // Most embed tabs need no parent context and can hand over a plain,
  // already-built ScreenConfig. Employee Master Record's Documents tab is
  // the first case that doesn't: its real list endpoint is scoped to ONE
  // employee (GET /employees/{employee_id}/documents — employee_documents.py),
  // and that id is only known once the host record's own route has resolved
  // — the exact same id RecordScreenConfig.loadEndpoint/edit.saveEndpoint
  // already close over (both `(id) => ...`). A function receiving that id
  // lets the embedded config build its own endpoint (and anything else that
  // needs it) around it, rather than growing a second, function-shaped
  // variant of ListScreenConfig.endpoint that every OTHER list screen — none
  // of which are ever embedded under a parent id — would have to account
  // for too. RecordScreenComponent resolves and caches this once per tab
  // (record-screen.component.ts's embedConfig()), not on every re-render:
  // a fresh object identity on each change-detection pass would make the
  // embedded list's own input() look like a new config and re-fetch/reset
  // its filters constantly.
  readonly config: ScreenConfig | ((parentId: string) => ScreenConfig);
}

// A tab hosting a bespoke, non-shape component — Salary Structure and
// Insurance & Benefits are the motivating case: real, separate RBAC-screen-
// keyed sub-resources (exactly like RecordEmbedTab's own Documents/Assigned
// Assets), but shaped as versioned-revision-with-history / enroll-with-
// nested-dependents rather than anything the generic list/singleton shapes
// model — see emp.salary-structure.component.ts's own doc comment for why
// a bespoke component, not a distorted generic type, is the house answer
// here (matching tax-head-child-screen.component.ts's precedent). Hosted via
// NgComponentOutlet rather than RecordEmbedTab's ScreenConfig union, since
// there's no ScreenConfig shape to hand it — just the host record's id.
export interface RecordComponentTab {
  readonly kind: 'component';
  readonly id: string;
  readonly label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly component: new (...args: any[]) => unknown;
  // The @Component's own input() property name the host record's id binds
  // to — e.g. 'employeeId' for EmpSalaryStructureComponent.
  readonly idInputName: string;
}

export type RecordTab<T> = RecordFieldsTab<T> | RecordEmbedTab | RecordComponentTab;

export interface RecordHeaderConfig<T> {
  readonly primary: (row: T) => string;
  readonly secondary: (row: T) => string;
  readonly code: (row: T) => string;
  readonly badge?: (row: T) => string;
}

export interface RecordScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'record';
  readonly id: string; // RBAC screen key, e.g. 'employee.master_record'
  readonly title: string;
  readonly loadEndpoint: (id: string) => string; // real backend path, e.g. `/employees/${id}`
  readonly header: RecordHeaderConfig<T>;
  // ARCH-3 §3: "each tab is itself one of the shapes → tabs compose, they
  // don't special-case." Only the 'fields' kind (a read-only display of
  // data already on the loaded record) is built so far — Salary Structure/
  // Insurance/Documents/Assigned Assets are each a SEPARATE RBAC screen key
  // with their own endpoint (confirmed in app/rbac/registry/screens.py),
  // not additional fields on employee.master_record's own response, so
  // they need their own list/form sub-screen wiring later, not stuffed in
  // here as fake tabs.
  readonly tabs: readonly RecordTab<T>[];
  // Omit entirely for a permanently read-only record (e.g. a screen with no
  // 'edit' RBAC action at all). `screenAction` defaults to 'edit' — the real
  // action name every module.directory ScreenDef registers for its write
  // endpoint (app/rbac/registry/screens.py); PolicyStore.can(id, screenAction)
  // gates the Edit button, same source of truth the API itself checks via
  // require_screen(SCREEN, action="edit").
  readonly edit?: {
    readonly saveEndpoint: (id: string) => string; // e.g. `/customers/${id}`, PUT
    readonly screenAction?: string;
  };
  // A page-head button beyond Edit/Save/Cancel — Asset Master Record's
  // "Download Asset Card" is the motivating case (GET /assets/{id}/pdf, a
  // real PDF, not JSON). Distinct from ListScreenConfig's own
  // SecondaryActionDef: that type's `endpoint` is a fixed string, correct for
  // List/Report/Calendar/Checklist actions that never need the CURRENT
  // record's own id interpolated into the URL (they act on a list, or a
  // fixed resource) — a record-level action always does, so this takes
  // `(id) => string` instead of reusing that type as-is.
  readonly secondaryActions?: readonly RecordSecondaryActionDef<T>[];
}

export interface RecordSecondaryActionDef<T = Record<string, unknown>> {
  readonly label: string;
  readonly icon?: string;
  readonly endpoint: (id: string) => string;
  // PolicyStore.can(id, screenAction) gate — 'view' for a read-only download
  // off a GET with no `action=` at all (ALWAYS_ALLOWED in policy.store.ts),
  // matching every other visibility-only endpoint's own screenAction
  // convention in this codebase.
  readonly screenAction: string;
  // True for a GET that returns a FILE, not JSON — runs the same blob-fetch-
  // and-click-a-synthetic-<a> mechanic as ListScreenComponent.exportAs() /
  // ReportScreenComponent.exportTable(). Omit for a plain no-body POST that
  // reloads the record afterwards (mirrors SecondaryActionDef's own default).
  readonly download?: boolean;
  // 'DELETE' for an irreversible destructive page-head action (Vendor's own
  // "Delete" is the motivating case — DELETE /vendors/{id} already existed
  // server-side with nothing wired to it: RecordScreenComponent only ever
  // fired a no-body POST). Defaults to 'POST'. Always pair with `confirm`.
  readonly method?: 'POST' | 'DELETE';
  // Where to navigate after a successful DELETE — the record is gone, so
  // the normal "reload this same record" behaviour would 404. Omitted for
  // every non-destructive action, which keeps reloading in place as before.
  readonly navigateAfter?: readonly unknown[];
  readonly confirm?: string;
  readonly visible?: (row: T) => boolean;
}

// One column of a child-row array editor — Tax Head's Slab Bands / Split
// Components / Relief Rules are the motivating case: a real list of child
// rows living inside the parent's own create/update body (TaxHeadCreate's
// slab_bands/split_components/relief_rules), not a separate endpoint.
export interface ArrayColumnConfig {
  readonly key: string;
  readonly label: string;
  readonly type?: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  readonly staticOptions?: readonly { readonly value: string; readonly label: string }[];
  // A 'select' column backed by a Masters lookup endpoint instead of a fixed
  // enum — e.g. an Invoice line item's HSN/SAC code (RefLookup to
  // /masters/hsn-sac-codes, labelKey 'code'). Added alongside
  // DocumentLineItemsConfig's own first ref-backed column (Invoice);
  // FormScreenComponent's own arrayFields renderer does not consume this yet
  // (Tax Head's Slab Bands/Split Components/Relief Rules are all
  // staticOptions-only today) — only document-screen.component.ts's line-items
  // table resolves it, so this is additive and changes no existing
  // arrayFields screen's behaviour.
  readonly ref?: RefLookup;
}

export interface ArrayFieldConfig<T> {
  readonly key: keyof T & string; // the array's key on the parent, e.g. 'slab_bands'
  readonly label: string;
  readonly columns: readonly ArrayColumnConfig[];
  readonly emptyItem: () => Record<string, unknown>; // starting values for a new row
}

// A flat create-and-edit form, for screens whose backend has no
// GET-by-id endpoint at all (the 15 simple Masters lookups, per
// masters_lookup.py's generic factory: list/create/blind-PUT/deactivate/
// delete, no single-row read). Edit mode looks its row up client-side out
// of `listEndpoint`'s already-small full list rather than a dedicated GET
// — safe even on a direct URL visit/refresh, since ListScreenComponent
// already fetches the same full array for the very same screen.
export interface FormScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'form';
  readonly id: string; // RBAC screen key
  readonly title: string;
  readonly listEndpoint: string; // GET, same array the List shape's endpoint returns
  readonly createEndpoint: string; // POST
  // Omit for a screen with no PUT at all server-side (status/lifecycle moves
  // only via dedicated row actions). When present, isReadOnlyRecord() only
  // goes false at the SCREEN level — see readOnlyWhen below for record-level
  // freezing (a locked Financial Year has a real updateEndpoint but must
  // still refuse to look editable while locked).
  readonly updateEndpoint?: (id: string) => string; // PUT
  readonly rowId: (row: T) => string;
  readonly emptyRow: () => Partial<T>; // starting values in create mode
  // Freezes a SPECIFIC loaded record even though the screen has a real
  // updateEndpoint — Financial Year's own Invariant 4 is the reference case:
  // editing is real and works, but a LOCKED year must still render as "View",
  // Save hidden, exactly like a screen with no updateEndpoint at all. Checked
  // against the loaded formModel once fetched; irrelevant in create mode.
  readonly readOnlyWhen?: (formModel: Partial<T>) => boolean;
  // Optional narrowing on top of the mode check in FormScreenComponent's
  // canWrite(). Leave both unset for the normal case: a role whose mode is
  // 'view' already cannot write, and most screens need nothing more. Set these
  // only where the write genuinely requires a specific grant beyond being
  // non-view — Email Configuration's POST needs action 'create', for instance,
  // so a role with edit-but-not-create must not be offered the Add form.
  readonly screenAction?: string;
  readonly createScreenAction?: string;
  // How this record identifies itself in the breadcrumb trail once loaded —
  // "FY 2030–31", not the row's id. Omit to fall back to the bare "Edit"/
  // "View" verb with no name.
  readonly recordLabel?: (row: T) => string;
  readonly fields: readonly FieldConfig<T>[]; // one flat section — these are simple lookups, no tabs
  readonly arrayFields?: readonly ArrayFieldConfig<T>[]; // inline child-row editors, submitted with the rest of the form
  // Buttons to a child resource's OWN screen, shown only once editing an
  // EXISTING record (never in create mode — nothing to scope the child
  // screen to yet). §6a's reason for existing: Tax Head's Slab Bands/Split
  // Components/Relief Rules moved OUT of this form's own `arrayFields` into
  // standalone screens (tax-head-child-screen.component.ts) reached from
  // here, matching the prototype's "a clean N-field form, three child
  // editors reached by their own buttons" shape instead of one page with
  // three embedded tables. Every other `arrayFields` user on this shape is
  // untouched — this is additive, not a replacement for that mechanism.
  readonly recordActions?: readonly { readonly label: string; readonly routeFor: (id: string) => readonly unknown[]; readonly countFrom?: keyof T }[];
  // Read-only fields computed live from the CURRENT formModel, re-evaluated
  // on every change — Financial Year's own "+ Add" popup is the reference
  // case (prototype app-screens.js:297-313): Start Date is the only real
  // input, and a whole second section shows Label/End Date/Status/etc.
  // "derived automatically — shown as a preview before saving." Distinct
  // from `createOnly` (a real, once-writable field) — these never round-
  // trip to the server at all, they're pure UI feedback.
  readonly previewFields?: readonly { readonly label: string; readonly compute: (formModel: Partial<T>) => string }[];
  readonly listRoute: readonly unknown[]; // where Save/Cancel return to
  // Where to navigate after a successful CREATE (never consulted in edit
  // mode), built from the response body instead of the fixed listRoute —
  // Asset's own create-only form (assets/new, shape 'form') is the first
  // consumer: §2.8's "+ Add Asset" is specified to open the new asset's own
  // Master Record afterwards, not just return to the Directory list, and
  // this shape has no other hook that sees the POST response at all
  // (save()'s subscribe previously discarded it). Omit to keep every other
  // form's existing behaviour — always navigate to listRoute regardless of
  // what createEndpoint returned — unchanged.
  readonly onCreateSuccess?: (response: T) => readonly unknown[];
}

// Email Configuration's "Send Test Email" (app-screens2.js:774-776, and the
// dedicated form it opens — app-forms.js's 'm.emailtest', lines 372-379): a
// small prompt for the ONE variable field (who to send to) beside a
// read-only line naming which server the CURRENTLY SAVED settings would
// actually use, POSTing to a real endpoint that proves the saved
// configuration works rather than a separate hardcoded test path. Deliberately
// not SecondaryActionDef (the page-head button List/Checklist/Report/Calendar
// share) — that type only ever fires a no-body POST, and this one needs a
// body built from what the user typed.
export interface SingletonTestActionDef<T> {
  readonly label: string; // both the trigger button and the dialog's submit button, e.g. 'Send Test Email'
  readonly endpoint: string; // POST, real backend path
  // PolicyStore.can(id, screenAction) gate, same convention as every other
  // shape's secondary action. Defaults to 'edit'.
  readonly screenAction?: string;
  readonly promptLabel: string; // the one input's label, e.g. 'Send To'
  readonly promptPlaceholder?: string;
  // Prefills the prompt — the prototype's own hint is "Defaults to your own
  // signed-in address" (app-forms.js:374), so this reads SessionStore rather
  // than starting blank. Omit for a prompt with no sensible default.
  readonly defaultValue?: () => string;
  readonly buildBody: (value: string) => unknown;
  // The read-only "Using Server" line (app-forms.js:375) — built from the
  // record CURRENTLY on screen (the loaded formModel), not a second fetch,
  // so it can never show a different server than what Save would persist.
  readonly usingLabel?: (formModel: Partial<T>) => string;
  // Reads the endpoint's own response — e.g. Recent Sends' delivery_status —
  // so a FAILED test (a provider with "no transport implemented yet", or
  // Sending Enabled being off) is reported honestly instead of a blanket
  // "Sent!" the request's 201 alone would imply.
  readonly resultMessage?: (response: unknown) => string;
}

// A one-and-only record, no id anywhere — Company Profile and Email
// Configuration's Server Settings are the motivating cases: GET returns
// EITHER the row OR null/204 (nothing created yet), POST creates it the
// first time, PUT edits it from then on. No list, no route param, ever.
export interface SingletonFormConfig<T = Record<string, unknown>> {
  readonly shape: 'singleton';
  readonly id: string; // RBAC screen key
  readonly title: string;
  readonly loadEndpoint: string; // GET, may return null
  readonly createEndpoint: string; // used only when GET returned null
  readonly updateEndpoint: string; // PUT, used once a row exists
  // Some singletons expose PUT as a true upsert and have no POST route at all
  // (Email Configuration's /server-settings is GET+PUT only), so POSTing the
  // first save 405s and the screen can never be set up. Defaults to 'POST'.
  readonly createMethod?: 'POST' | 'PUT';
  // Defaults to 'Save'. Masters §3.6 asks Company Profile's button to read
  // "Save Changes" — an edit-in-place screen, where "Save" alone reads as
  // creating something. Made overridable per screen rather than renamed
  // globally, because the generic caption is right for the singletons that
  // genuinely are first-time setup (Email Configuration, Work Week).
  readonly submitLabel?: string;
  readonly emptyRow: () => Partial<T>;
  readonly fields: readonly FieldConfig<T>[];
  readonly screenAction?: string; // defaults to 'edit'
  // Email Configuration's "Send Test Email" — see SingletonTestActionDef's
  // own doc for why this is a distinct type from ListScreenConfig's
  // secondaryActions rather than a reuse of it.
  readonly testAction?: SingletonTestActionDef<T>;
  // `relatedLinks` used to live here — nav buttons to a screen's sub-resources.
  // Removed deliberately: sub-resources are TABS on a TabbedScreenConfig, which
  // keeps the record on screen and shows each child's row count. Reintroducing
  // a "…→" button is a regression, not a shortcut.
}

// ---------------------------------------------------------------------------
// The tabbed record shape — the prototype's R.record (app-screens2.js:802),
// which is the layout the user asked for across the whole application: an
// identity card, then tabs with count badges, then the active tab's body.
// Sub-resources of one record are TABS, never "Addresses →" nav buttons.
//
// A tab hosts any of the other shapes by delegating to that shape's existing
// component with its own page chrome suppressed — so Company Profile's
// Addresses tab is literally the Addresses list screen, not a reimplementation
// of it, and stays in step with it automatically.
// ---------------------------------------------------------------------------
export interface RecordHeaderDef<T> {
  /** 1-2 characters, or omit for the screen's initial. */
  readonly avatar?: (row: T | null) => string;
  /** The small mono line above the name, e.g. "Masters §3.6". */
  readonly recId?: (row: T | null) => string;
  readonly name: (row: T | null) => string;
  /** Dot-separated facts under the name. Blank entries are dropped. */
  readonly meta?: (row: T | null) => readonly string[];
  readonly badge?: (row: T | null) => string;
  /** The metric tiles on the right — Work Week's Net Hours/Day etc.
   * `tabRows` is every 'list'-shape tab's already-fetched rows, keyed by
   * TabDef.key — the same fetch TabbedScreenComponent already makes for
   * each tab's own count badge (screen.types.ts's TabDef.hideCount only
   * suppresses that badge, not this data). Lets a header stat be built from
   * a DIFFERENT tab than headerEndpoint's own row — e.g. Email
   * Configuration's Templates/Enabled tiles read the 'templates' tab's rows,
   * not the Server Settings row headerEndpoint returns. Only 'list'-shape
   * tabs are collected; a key with no matching list tab (or one still
   * loading) is simply absent, not an empty array — check `key in tabRows`
   * if "not loaded yet" and "loaded, zero rows" must read differently. */
  readonly summary?: (row: T | null, tabRows: Readonly<Record<string, readonly unknown[]>>) => readonly { readonly label: string; readonly value: string }[];
}

/** A tab hosting a full, independently-routed screen (list/singleton/…),
 * embedded with its own page title suppressed. The original, still-default
 * tab kind — `kind` is omitted, matching every existing *.tabbed.config.ts. */
export interface TabScreenDef {
  readonly kind?: 'screen';
  readonly key: string;
  readonly label: string;
  /** Any shape config. Rendered by that shape's own component, embedded. */
  readonly config: ScreenConfig;
  /** Suppresses the auto-computed row-count badge for this tab even though
   * its shape is 'list' — e.g. a "Where Used" reference listing the prototype
   * never badges. */
  readonly hideCount?: boolean;
}

/** A read-only field grid computed from data the host screen already has —
 * no endpoint of its own. §4 (MASTERS-COMPLETION-PROMPT.md): Work Week &
 * Hours' Daily Hours / Compensation tabs are near-verbatim re-displays of
 * fields already on `WorkWeekPolicyRow`, the same GET the Policies tab (and
 * the header) already fetch — building a second endpoint for a second read
 * of the same row would be the wrong fix. `row` is the tabbed screen's own
 * `headerRow` (whatever `headerEndpoint` returned), passed straight through;
 * a tab needing a DIFFERENT row (e.g. "the active policy" filtered out of a
 * list) does that filtering inside `sections` itself. Rendered by
 * FieldGridComponent — the same read-only rendering this shape is modeled on
 * (record-screen.component.ts's own 'fields' tab kind), not a reinvention. */
export interface TabFieldsDef {
  readonly kind: 'fields';
  readonly key: string;
  readonly label: string;
  readonly sections: (row: Record<string, unknown> | null) => readonly FieldSection<Record<string, unknown>>[];
}

/** Fixed reference content, no endpoint and no host data at all — §4's
 * Where Used tab: eight static rows naming which module/screen reads the
 * policy (app-screens2.js:581-598), not data from any table. */
export interface TabStaticDef {
  readonly kind: 'static';
  readonly key: string;
  readonly label: string;
  readonly sections: readonly FieldSection<Record<string, unknown>>[];
}

export type TabDef = TabScreenDef | TabFieldsDef | TabStaticDef;

export interface TabbedScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'tabbed';
  readonly id: string; // RBAC screen key
  readonly title: string;
  readonly specRef?: string;
  readonly description?: string;
  /** GET for the header's own data. Omit for a header built from constants. */
  readonly headerEndpoint?: string;
  readonly header?: RecordHeaderDef<T>;
  readonly tabs: readonly TabDef[];
}

// ---------------------------------------------------------------------------
// The kanban/board shape — the prototype's R.board (app-screens.js:339, Task
// Board & Bugs) and R.pipeline's stage-summary view (app-screens2.js:820,
// Opportunity Pipeline), generalised into one config: columns keyed by a
// status-like field on each row, a card per row, and an optional per-column
// ₹/metric total (Pipeline's stage value sum; Task Board and Bugs have
// none). Split into three interfaces rather than one nested blob, matching
// the existing repeated-but-consistent style of the other shapes in this
// file (ColumnDef/FieldConfig are already the same kind of split) — no
// shared base interface is introduced.
// ---------------------------------------------------------------------------

/** One board column — the value of `statusField` that lands a card here, in
 * declared (left-to-right) order. Order is stated explicitly rather than
 * read off the data, since a raw distinct-values scan would put 'Backlog'
 * anywhere. */
export interface BoardColumnDef {
  readonly value: string;
  readonly label: string;
  // Column footer total (Pipeline: sum of `val` per stage,
  // app-screens2.js:829-830). Omit for a board with no per-column metric
  // (Task Board, Bugs) — the component then renders nothing rather than a
  // ₹0 that means nothing.
  readonly metricField?: string;
}

/** What one card shows — a small fixed layout (code/title/subtitle/badge/
 * money/meta/avatar/due), not an arbitrary column list, so these are named
 * slots rather than an array, the way RecordHeaderConfig's slots are. */
export interface BoardCardFieldsDef<T> {
  // The short mono id line at the top of the card (prototype's `i.id`, e.g.
  // "TSK-2026-0007"). Omit where the row's own id (rowId) is not a human-
  // readable code (a raw UUID renders badly there).
  readonly code?: (row: T) => string;
  readonly title: (row: T) => string;
  readonly subtitle?: (row: T) => string;
  // Rendered as a badge-s pill through the same badgeClass() every status/
  // severity column already uses (Bug's Severity, Task's Priority).
  readonly badge?: (row: T) => string;
  // Already formatted (formatMoney), e.g. Opportunity's ₹ value line.
  readonly money?: (row: T) => string;
  // A short extra line under the title — Opportunity's "Trinetra · 62%"
  // (app-screens2.js:832), a Task's sprint tag. Null/blank hides the line.
  readonly meta?: (row: T) => string | null;
  // Initials for the mini avatar circle — the caller computes the initials
  // (mirroring the prototype's U.initials), this stays a pure string slot.
  readonly avatar?: (row: T) => string | null;
  readonly due?: (row: T) => string | null;
  // Whether `due` renders in the overdue (red) style — a separate slot
  // rather than the component guessing from a parsed date, since "overdue"
  // means comparing against a different clock per row type (Task's Due
  // Date vs. a Bug's SLA).
  readonly dueOverdue?: (row: T) => boolean;
}

export interface BoardScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'board';
  readonly id: string; // RBAC screen key, e.g. 'project.board' / 'opp.pipeline'
  readonly title: string;
  readonly description?: string;
  readonly specRef?: string;
  readonly endpoint: string; // real backend path, e.g. '/projects/{id}/tasks'
  readonly rowId: (row: T) => string;
  // The raw field a stage change reads AND writes — a real key (not
  // `compute`), because the same field name is what the stage-change
  // request body defaults to updating.
  readonly statusField: keyof T & string;
  readonly columns: readonly BoardColumnDef[];
  readonly card: BoardCardFieldsDef<T>;
  // RBAC 14 §2.2c/e — the SAME FilterDef<T> every list/record screen uses,
  // not a parallel board-only filter type.
  readonly filters?: readonly FilterDef<T>[];
  // Board data is fetched whole (no `?search=` server param on this
  // config), so search always runs client-side over the fetched rows —
  // these name which fields it checks.
  readonly searchFields?: readonly string[];
  readonly recordNoun?: string; // "task", "bug", "deal" — empty-column and count wording
  // Builds the URL a stage change fires, for BOTH the drag-drop drop
  // handler and the <select> fallback (MASTER-BUILD §8.2 A14: "Implement
  // drag-and-drop; keep the Status dropdown as the equivalent path" — drag
  // is never the only way to move a card).
  readonly stageChangeEndpoint: (row: T, newValue: string) => string;
  readonly stageChangeMethod?: 'PUT' | 'PATCH' | 'POST'; // defaults to 'PUT'
  // Defaults to `{ [statusField]: newValue }`; override where the real
  // endpoint expects a differently-named or richer body.
  readonly stageChangeBody?: (row: T, newValue: string) => unknown;
  readonly stageChangeScreenAction?: string; // PolicyStore gate; defaults to 'edit'
  readonly createRoute?: readonly unknown[];
  readonly createLabel?: string;
  readonly createScreenAction?: string;
  readonly rowRoute?: (row: T) => readonly unknown[]; // card click -> its record
  // §7 Phase 11: "a board exports as a flat list, not a board" (the
  // prototype's own Export PDF toast, app-screens.js:345). The export
  // request is the SAME `?format=pdf|excel` GET against `endpoint` the list
  // shape uses — the backend already returns a flat table for it there —
  // so set this true only where that's been confirmed, exactly like
  // ListScreenConfig.exportable.
  readonly exportable?: boolean;
  // The flattened, one-row-per-card column set export produces — the
  // board's own statusField becomes the "Status" column. Mirrors
  // ListScreenConfig.columns for a future client-side flattener; today the
  // server-side export needs no column list from here at all (list_export.py
  // renders from its own model), so this is documentation of the shape more
  // than a parameter anything currently reads.
  readonly exportColumns?: readonly ColumnDef<T>[];
}

// ---------------------------------------------------------------------------
// The report shape — prototype's R.report (app-screens.js:426): KPI tiles
// above one or more summary tables, sharing ONE filter bar. leave_reports.py
// is the real backend shape this was modelled on: several GET endpoints that
// all accept the same query params, off one shared filter helper server-side
// — "the four views can never drift apart" (leave_reports.py:6-10) — and one
// of those endpoints (`/liability`) returns a single object with no export at
// all ("genuinely not list-shaped", leave_reports.py:31-33) while the other
// three return arrays and DO export. `ReportSourceDef` models that duality: a
// named GET whose response a tile or table reads for itself.
// ---------------------------------------------------------------------------

// One HTTP GET this screen reads, named so a tile or table can reference it
// by key instead of repeating the endpoint string. Returns EITHER a single
// JSON object (a headline-figure endpoint, e.g. /leave/reports/liability) or
// an array of row objects (a breakdown endpoint, e.g. .../balances-summary)
// — which one is a fact about that specific backend route, not something
// this config declares, since ReportTileDef/ReportTableDef each already know
// what shape they expect from the source they name.
export interface ReportSourceDef {
  readonly key: string;
  readonly endpoint: string; // real backend path under environment.apiBaseUrl
  // Only a source whose own endpoint takes a real `?search=` param (leave_
  // reports.py's by-employee view is the only one of its four) should ever
  // receive the shared search box's text; every other source ignores it.
  readonly searchParam?: string;
}

export type ReportTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

// One KPI tile (U.kpi, app-core.js:309 / app-screens.js:431). `compute` reads
// whatever `source` actually returned — a single object for a headline-
// figure endpoint, or an array for a tile that's really a rollup over a
// breakdown endpoint (e.g. a tile summing Total Purchase Value across the
// by-Category rows) — kept generic rather than typed per-shape because that
// duality is a genuine fact about the two backend response shapes, not a
// modelling gap.
export interface ReportTileDef {
  readonly icon: string; // IconComponent name, e.g. 'leave', 'rupee', 'clock'
  readonly tone: ReportTone;
  readonly label: string;
  readonly source: string; // a ReportSourceDef.key above
  readonly compute: (data: unknown) => string | number;
  readonly unit?: string;
  readonly foot?: string | ((data: unknown) => string);
  // The prototype's up/down trend indicator (U.kpi's o.delta/o.dir) — a
  // string like '+3 vs last month', shown only when both are set.
  readonly delta?: string | ((data: unknown) => string);
  readonly dir?: 'up' | 'down'; // required alongside `delta`; picks ▲/▼ and the success/danger tint
}

// One table section (U.card + U.table, app-core.js:266/396, app-screens.js:
// 436-439). Rows come from `source`, which must resolve to an array — reuses
// ColumnDef so cell formatting (money/date/status/ref) and alignment
// (column-policy.ts) match every other screen exactly rather than a second
// table renderer inventing its own rules.
export interface ReportTableDef<T = Record<string, unknown>> {
  readonly title: string;
  readonly source: string; // a ReportSourceDef.key above; must resolve to an array
  readonly columns: readonly ColumnDef<T>[];
  readonly rowId?: (row: T) => string; // falls back to the row's array index
  // §2.5: not every view is exportable — a headline-figure source has none
  // (leave_reports.py:31-33). Set this true only where `source`'s own
  // endpoint has been confirmed to accept `?format=pdf|excel`, same
  // confirmation ListScreenConfig.exportable's own doc requires.
  readonly exportable?: boolean;
  readonly emptyText?: string;
}

export interface ReportScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'report';
  readonly id: string; // RBAC screen key, e.g. 'leave.reports'
  readonly title: string;
  readonly description?: string;
  readonly specRef?: string;
  // RBAC 14 §2.2c, applied to EVERY source below — the report's own promise:
  // "All filters apply across every view on this screen simultaneously...
  // a figure that quietly reflects a different filter than the table beside
  // it would be worse than no figure at all" (app-screens.js:440).
  readonly filters?: readonly FilterDef<any>[];
  readonly sources: readonly ReportSourceDef[];
  readonly tiles?: readonly ReportTileDef[];
  readonly tables: readonly ReportTableDef<any>[];
  // Page-head buttons beyond the per-table export (e.g. a combined
  // "Download Report" the prototype shows that isn't wired to any one
  // table) — same contract as ListScreenConfig's own secondaryActions.
  readonly secondaryActions?: readonly SecondaryActionDef[];
}

// ---------------------------------------------------------------------------
// The calendar shape — the prototype's R.calendar (app-screens.js:444), a
// month-grid view of dated events with a Calendar/List switcher
// (app-screens.js:454). Used today by Masters → Holidays (editable —
// data.js:1526 `editable: 1`) and its read-only mirror, Leave → Company
// Holiday Calendar (data.js:1097, "sourced entirely from Masters →
// Holidays… not editable here", app-screens.js:463). Both are driven by the
// SAME endpoint and SAME rows; only `editable`/`createRoute`/`rowRoute`
// differ between the two configs — nothing about the read-only mirror is a
// special case in the component itself.
// ---------------------------------------------------------------------------

// A raw backend enum value (e.g. holiday_type: MANDATORY|OPTIONAL) mapped to
// the label and badge colour a person should see. `badgeClass` is explicit
// rather than always falling back to cell-format's own badgeClass() because
// that shared table has no entry for 'optional' at all (it maps 'mandatory'
// to b-danger, matching the prototype, but leaves 'optional' to the neutral
// default) — the prototype instead colours Optional the calmer b-outline
// (app-screens.js:459), which only an explicit override here can reproduce.
export interface CalendarEventTypeOption {
  readonly value: string;
  readonly label: string;
  readonly badgeClass?: string;
}

export interface CalendarScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'calendar';
  readonly id: string; // RBAC screen key, e.g. 'masters.holidays'
  readonly title: string;
  readonly description?: string;
  readonly specRef?: string;
  readonly endpoint: string; // GET, real backend path — returns a bare array, like ListScreenConfig.endpoint
  readonly date: (row: T) => string; // ISO 'yyyy-mm-dd' — every month grouping and the sort order key off this
  readonly name: (row: T) => string; // the event's own display name, e.g. row.name
  // The cal-day's secondary line under the name (prototype: the weekday,
  // data.js:114's `day: 'Saturday'`). Omit to compute the weekday from
  // `date` itself — a real endpoint has no reason to also store a value
  // that is purely derived from its own date column.
  readonly sub?: (row: T) => string;
  // The raw enum value driving the badge (e.g. row.holiday_type). Omit for a
  // calendar with no per-event category at all — no badge is then shown.
  readonly type?: (row: T) => string | undefined;
  readonly typeOptions?: readonly CalendarEventTypeOption[];
  // What one event IS, for the List view's row count and empty-state wording
  // — "No holidays match…", not a bare "No records found." Mirrors
  // ListScreenConfig.recordNoun (RBAC 14 §2.2c).
  readonly recordNoun?: string;
  // Belt-and-braces gate on top of PolicyStore.can(), matching the
  // prototype's own two-part check (`s.editable && (role === 'superadmin' ||
  // role === 'manager')`, app-screens.js:445) — Masters → Holidays sets
  // this; Leave → Company Holiday Calendar never does, so that mirror stays
  // read-only for every role regardless of what any RBAC grant says.
  // createRoute/rowRoute/secondaryActions are only honoured when this is true.
  readonly editable?: boolean;
  readonly createRoute?: readonly unknown[]; // "+ Add Holiday" — gated by PolicyStore.can(id, createScreenAction)
  readonly createLabel?: string;
  readonly createScreenAction?: string; // defaults to 'edit'
  readonly secondaryActions?: readonly SecondaryActionDef[]; // e.g. "Bulk Import" (masters.holidays.import)
  readonly rowRoute?: (row: T) => readonly unknown[]; // opens an existing event for edit
  readonly emptyText?: string;
  // RBAC 14 §2.2f, same contract as ListScreenConfig.exportable — only set
  // this true once the real endpoint is confirmed to accept ?format=pdf|excel.
  readonly exportable?: boolean;
  // A callout shown when NOT editable (U.note(), app-screens.js:463's "Read-
  // only for all five roles…"). Omitted entirely on a calendar that just
  // doesn't need one, rather than forcing generic filler text on every
  // read-only instance.
  readonly readOnlyNote?: string;
}

// ---------------------------------------------------------------------------
// The checklist shape — the prototype's R.checklist (app-screens.js:468),
// which drives Employee Onboarding (§2.13) and Offboarding/Exit (§2.14): a
// record's rec-head plus a single ordered (optionally grouped) run of steps,
// each one a checkbox-shaped row rather than a form field. Distinct from the
// 'record' shape's field TABS — a checklist step is an ACTION (toggle it, or
// open the screen that completes it), not a display value.
// ---------------------------------------------------------------------------

export interface ChecklistHeaderDef<T> {
  /** 1-2 characters, or omit to fall back to the subject's own initials
   * (prototype's U.initials, app-screens.js:473) — NOT the screen title's
   * initial, since this avatar identifies the PERSON the checklist is for. */
  readonly avatar?: (row: T | null) => string;
  /** The small mono line above the name — 'Onboarding' / 'Exit'
   * (app-screens.js:474), not a record id. */
  readonly recId?: (row: T | null) => string;
  readonly name: (row: T | null) => string;
  /** Dot-separated facts under the name, e.g. designation · joining date ·
   * employee code (app-screens.js:475). Blank entries are dropped. */
  readonly meta?: (row: T | null) => readonly string[];
}

// A step's shape is shared across every group on one screen (Onboarding's
// seven steps and Exit's five are each internally uniform), so this is ONE
// accessor set attached to the whole config rather than repeated per group.
export interface ChecklistItemDef<I = any> {
  // Stable identity — what `gate` below refers to, and what the toggle
  // endpoint builder is handed. NOT the display title, so relabelling a step
  // doesn't silently break its own gate or another step's gate on it.
  readonly id: (item: I) => string;
  readonly title: (item: I) => string;
  readonly description?: (item: I) => string;
  readonly done: (item: I) => boolean;
  // Names another step's `id` that must be Done first — the exit order is
  // the rule, not a suggestion (app-screens.js:541-550): asset return stays
  // locked until the resignation letter exists.
  readonly gate?: (item: I) => string | null | undefined;
  // Opens the screen that actually completes this step instead of toggling
  // it here directly — Exit's 'Return all assigned assets' goes to Asset
  // Reclaim (app-screens.js:494, s.go). Omit for a step with no screen of
  // its own.
  readonly route?: (item: I) => readonly unknown[] | null | undefined;
  // Onboarding/Exit's own steps (prototype data.js:532-551) carry neither
  // today, so both are optional and the renderer shows only what's
  // configured — never a blank "Due: —" line on a screen whose backend has
  // no such field.
  readonly dueDate?: (item: I) => string | null | undefined;
  readonly owner?: (item: I) => string | null | undefined;
}

export interface ChecklistGroupDef<T, I = any> {
  readonly key: string;
  // Omit for a single, ungrouped run of steps — Onboarding and Exit both
  // render as one flat list today (R.checklist has no group headers at
  // all). A label is for a future checklist whose steps fall into named
  // phases (e.g. "Documentation" / "Access" / "Assets").
  readonly label?: string;
  readonly items: (row: T) => readonly I[];
}

// The prototype's rec-actions pair — "All employees" / "Open record"
// (app-screens.js:478-479) — pure navigation, never permission-gated beyond
// the target screen's own RBAC. `screenAction` is only for a genuinely
// restricted shortcut.
export interface ChecklistHeaderActionDef {
  readonly label: string;
  readonly icon?: string;
  readonly route: readonly unknown[];
  readonly screenAction?: string;
}

export interface ChecklistScreenConfig<T = Record<string, unknown>, I = any> {
  readonly shape: 'checklist';
  readonly id: string; // RBAC screen key, e.g. 'emp.onboarding'
  readonly title: string; // also the card's own head title — app-screens.js:500 uses the same string for both the page title and the card title
  readonly specRef?: string;
  readonly description?: string;
  // GET, real backend path, keyed off the record's :id — same convention as
  // RecordScreenConfig's own loadEndpoint (record-screen.component.ts:152/160).
  // A checklist is always one subject's checklist, never a bare list.
  readonly endpoint: (id: string) => string;
  readonly header: ChecklistHeaderDef<T>;
  readonly headerActions?: readonly ChecklistHeaderActionDef[];
  readonly groups: readonly ChecklistGroupDef<T, I>[];
  readonly item: ChecklistItemDef<I>;
  // POST, no body — flips one step's done state. Return null for a step that
  // only ever auto-checks from elsewhere in the system and has no manual
  // override (most of Onboarding's seven steps, per their own description
  // text — app-screens.js:495's "Mark done" is the demo's own exception).
  readonly toggleEndpoint: (row: T, item: I) => string | null;
  // Gates the "Mark done" button; defaults to 'edit', the same action
  // module.directory ScreenDefs register for their write endpoint.
  readonly toggleScreenAction?: string;
  // Page-head buttons beyond the identity card — Onboarding's "Send Welcome
  // Email" / "Export PDF" (app-screens.js:471-472). Reuses ListScreenConfig's
  // own SecondaryActionDef rather than inventing a parallel type.
  readonly secondaryActions?: readonly SecondaryActionDef[];
  // What one step is called, for the card sub-head ("7 steps") and the foot
  // sentence ("2 steps outstanding") — app-screens.js:499-500.
  readonly itemNoun?: string; // defaults to 'step'
}

// ---------------------------------------------------------------------------
// The conversation shape — the prototype's R.conversation (app-screens.js:504),
// a threaded message list with a compose/reply box underneath it. Ticket
// Detail's Conversation tab is the intended first consumer, but the shape is
// generic: Task/Bug comment threads (models/project.py's TaskComment/
// BugComment) share the identical "author_id is a bare User id, no name
// denormalized onto the row" situation.
//
// Deliberately scoped to JUST the thread + composer. The prototype's own
// rec-head/status-select/Assignment-History-timeline/Linked-qlinks around it
// (app-screens.js:507-515, 542-553) are page composition for a specific
// ticket-detail screen — a future ticket.detail TabbedScreenConfig supplies
// its own RecordHeaderDef and adds those as separate tabs/cards, not fields
// stuffed onto this config (same reasoning RecordScreenConfig.tabs itself
// documents for Salary Structure/Insurance/Documents).
// ---------------------------------------------------------------------------
export interface ConversationEntryTypeDef {
  readonly value: string; // raw value written to entryTypeKey, e.g. 'PUBLIC_REPLY'
  readonly label: string; // segmented-control button label, e.g. 'Public Reply'
  readonly icon?: string; // IconComponent name for that button, e.g. 'send' / 'lock'
  // Internal-only entries get the warn tint (never emailed) instead of the
  // default info tint — tickets.py's INTERNAL_NOTE (schemas/ticket.py:65-74),
  // prototype's .msg.internal (app.css:728/734).
  readonly internal?: boolean;
}

export interface ConversationScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'conversation';
  readonly id: string; // RBAC screen key
  readonly title: string;
  readonly specRef?: string;
  readonly description?: string;
  // GET returns the thread array; POST (same URL) appends one entry —
  // tickets.py's /tickets/{id}/entries is both verbs on one path
  // (api/v1/tickets.py:304 GET, :315 POST). Build this WITH the parent
  // record's id already interpolated, the same way a tab's
  // ListScreenConfig.endpoint is built per-record by whatever constructs
  // the TabDef.
  readonly endpoint: string;
  readonly rowId: (row: T) => string;
  readonly bodyKey: keyof T & string; // e.g. 'content'
  readonly timestampKey: keyof T & string; // e.g. 'created_at'
  // The real schema denormalizes NOTHING onto the row — author_id is a bare
  // User id (schemas/ticket.py:89, and equally TaskComment/BugComment,
  // models/project.py:75/107). authorRef reuses the exact RefDataService
  // lookup ColumnDef.ref/FieldConfig.ref already rely on for this same
  // situation; omit only for a future endpoint that DOES denormalize a name
  // directly onto authorKey.
  readonly authorKey: keyof T & string;
  readonly authorRef?: RefLookup;
  // True for the row the signed-in user just posted via the composer — shows
  // their own already-known name instead of waiting on (or risking a miss
  // in) the authorRef lookup cache.
  readonly authorIsSelf?: (row: T) => boolean;
  // Internal Note vs Public Reply, or any other closed set a future thread
  // needs (a Task/Bug comment thread has none of this — omit entirely for a
  // single-kind thread and the segmented control disappears along with the
  // type badge).
  readonly entryTypeKey?: keyof T & string;
  readonly entryTypes?: readonly ConversationEntryTypeDef[];
  readonly attachmentKey?: keyof T & string; // e.g. 'attachment_stored_file_id'
  // 'purpose' sent to POST /files — files.py's _PURPOSE_RULES keys the
  // allowed mime types/size by this string ('ticket_attachment': PDF/JPG/PNG,
  // 5MB — files.py:37). Defaults to 'generic' (files.py's own fallback rule).
  readonly attachmentUploadPurpose?: string;
  readonly composerPlaceholder?: string;
  readonly threadTitle?: string; // card title, defaults to 'Conversation'
  readonly recordNoun?: string; // singular noun for the "N ___" count, defaults to 'entry'
  readonly emptyText?: string;
  // Gates the composer — a role with view-only access to the host screen
  // sees the thread but not the reply box. Defaults to 'edit', the same
  // convention every other shape's write gate uses.
  readonly screenAction?: string;
}

// ---------------------------------------------------------------------------
// The dashboard shape — the prototype's R.dashboard (app-screens.js:147-183),
// one render function that branches on `role` internally rather than five
// separate screen defs. That branch moves OUT of the renderer and INTO
// config here: a later phase builds one DashboardScreenConfig PER ROLE
// (mirroring R.dashboard's own if/else — financeKpis()+opsKpis() for Super
// Admin, hrKpis() for HR, myCounts()+teamStrip() for Manager, the bare
// payslip+leave+quick-links trio for Employee/app-screens.js:177-181), and
// DashboardScreenComponent renders whichever one it's given.
//
// No backend endpoint returns a cross-module rollup for any of this — grepped
// `app/api/v1/*dashboard*` and `*summary*`: every hit (assets.py, invoices.py,
// payslips.py, tickets.py, ...) is a single module's own summary, none
// spanning modules. So every tile and every data-bearing widget fetches its
// OWN real endpoint independently — the same pattern TabbedScreenComponent
// already uses per-tab (tabbed-screen.component.ts:147-158), the cheapest
// option actually available today.
// ---------------------------------------------------------------------------

export type DashboardTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

// A KPI tile — prototype's U.kpi() (app-core.js:309), rendered in the
// `.grid.g-kpi` 4-up row every role's dashboard opens with (financeKpis/
// opsKpis/hrKpis, app-screens.js:95-117).
export interface DashboardTileDef {
  readonly key: string;
  readonly label: string;
  readonly icon: string; // an IconComponent name (icon.component.ts's ICONS map)
  readonly tone: DashboardTone;
  readonly endpoint: string; // GET, real backend path — see the shape-level note on why every tile fetches its own
  // Reads the tile's headline number out of whatever `endpoint` returned —
  // most often `(data) => Array.isArray(data) ? data.length : 0`, but an
  // endpoint returning a computed total (e.g. sum of outstanding balances)
  // needs its own reducer, so this stays a function rather than a fixed key.
  readonly compute: (data: unknown) => string | number;
  readonly unit?: string;
  readonly footer?: (data: unknown) => string;
  // The prototype's up/down delta arrow (app-core.js:313) — omit where the
  // real endpoint has no prior-period figure to compare against rather than
  // fabricate a trend.
  readonly delta?: (data: unknown) => { readonly dir: 'up' | 'down'; readonly text: string } | null;
  readonly route?: readonly unknown[]; // where the tile navigates on click
}

// One row of a 'meters' widget — leaveCard's balance bars and Team Ticket
// Load's per-person load (app-screens.js:36-41, :80-83).
export interface DashboardMeterRow {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly valueText?: string; // overrides the default "value / max" text, e.g. leaveCard's "Not tracked"
  readonly tone?: string; // a CSS colour, e.g. 'var(--danger)' — .meter-row reads --tone as a CSS var
}

// One row of a 'feed' widget — Recent Activity / Company Announcements
// (app-screens.js:62-64), built from U.feedItem() (app-core.js:324).
export interface DashboardFeedRow {
  readonly icon: string;
  readonly tone?: string; // a CSS colour, e.g. 'var(--accent)'
  readonly title: string;
  readonly meta: string;
  readonly pinned?: boolean;
}

// One tile of a 'stats' widget — myCounts()'s three ministat tiles
// (app-screens.js:58-61) and rbacStrip()'s three (:142-145). Each fetches its
// OWN endpoint (myTickets/myAssets/etc. are unrelated resources), same as a
// DashboardTileDef.
export interface DashboardStatDef {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly tone: DashboardTone;
  readonly endpoint: string;
  readonly compute: (data: unknown) => string | number;
  readonly route?: readonly unknown[];
}

// One entry of a 'links' widget — Quick Links (app-screens.js:65-71): static
// navigation, no backend data at all.
export interface DashboardLinkDef {
  readonly label: string;
  readonly icon: string;
  readonly route: readonly unknown[];
}

// One row of a 'record' widget's key/value block — Latest Payslip's Gross
// earnings / Total deductions / Payable days rows (app-screens.js:51-53).
export interface DashboardRecordRow {
  readonly label: string;
  readonly value: (row: unknown) => unknown;
  readonly tone?: 'default' | 'danger'; // payslip's deduction row prints red (.pr.ded)
}

// A single card in the dashboard body. `kind` decides which of the
// kind-specific fields below apply — TypeScript can't discriminate a union
// this permissive cleanly against a shared T, so (matching ColumnDef/
// FieldConfig's own established style of mixing orthogonal optional fields
// on one interface rather than a discriminated union) every widget carries
// the full set of optional fields and DashboardScreenComponent reads only
// the ones its own `kind` names.
export interface DashboardWidgetDef<T = any> {
  readonly key: string;
  readonly kind: 'table' | 'meters' | 'feed' | 'stats' | 'links' | 'record';
  readonly title: string;
  readonly subtitle?: string;
  // GET endpoint this widget's data comes from. Omit only for 'links'
  // (static navigation, no data) — every other kind needs one. 'record'
  // endpoints return a single object (may be null — nothing to show yet,
  // e.g. no payslip run this period); every other kind's endpoint returns an
  // array.
  readonly endpoint?: string;
  // A screen-level restriction, same contract as ListScreenConfig.rowFilter
  // — e.g. Overdue Invoices is `D.invoices.filter(i => i.over > 0)`
  // (app-screens.js:123-127), not a separate endpoint.
  readonly rowFilter?: (row: T) => boolean;
  // Caps rows shown — the prototype's "Showing 5 of 7" (app-screens.js:126).
  readonly limit?: number;
  readonly emptyText?: string;
  // The card-head's top-right badge, e.g. expApprovalCard's "4 pending"
  // (app-screens.js:141) or announceCard's "3 active" (:64). Computed from
  // the filtered-but-not-limited rows.
  readonly badge?: (rows: readonly T[]) => string | null;
  // badge-s only ships b-ok/b-warn/b-danger/b-info/b-accent keyed by STATUS
  // WORDS (cell-format.ts's BADGE_CLASS), which a free-text badge like "4
  // pending" can't resolve through — this names the badge's colour directly,
  // same vocabulary as a tile's `tone`. Defaults to neutral grey.
  readonly badgeTone?: DashboardTone;
  // The card-foot's "View all…" link, e.g. overdueTable's "View all 19
  // outstanding invoices" (app-screens.js:126).
  readonly linkLabel?: string;
  readonly linkRoute?: readonly unknown[];

  // kind: 'table' — deliberately typed via ColumnDef<T> (this file's own list
  // shape column), so a mini-table's money/date/status formatting runs
  // through the identical cell-format.ts rules a full list screen uses, and
  // it can be promoted to a real 'list' screen later without re-deriving its
  // column defs.
  readonly columns?: readonly ColumnDef<T>[];
  readonly rowId?: (row: T) => string;
  readonly rowRoute?: (row: T) => readonly unknown[];

  // kind: 'meters'
  readonly meters?: (rows: readonly T[]) => readonly DashboardMeterRow[];

  // kind: 'feed'
  readonly feedItems?: (rows: readonly T[]) => readonly DashboardFeedRow[];

  // kind: 'stats' — a bare row of ministat tiles (no card chrome), e.g.
  // myCounts() (app-screens.js:58-61). `endpoint` is unused for this kind —
  // each DashboardStatDef fetches its own.
  readonly stats?: readonly DashboardStatDef[];

  // kind: 'links' — Quick Links (app-screens.js:65-71).
  readonly links?: readonly DashboardLinkDef[];

  // kind: 'record' — a single-object summary card, e.g. Latest Payslip
  // (app-screens.js:46-57).
  readonly recordHeadline?: (row: T) => { readonly label: string; readonly value: string };
  readonly recordBadge?: (row: T) => string | null;
  readonly recordRows?: readonly DashboardRecordRow[];
}

// One `.grid` row of widgets side by side — the prototype composes these BY
// HAND per role (e.g. `` `<div class="grid g-8-4">${overdueTable()}${leaveCard()}</div>` ``,
// app-screens.js:159-160/165-166/170-171/175-176/179-180) rather than one flat
// list, because two widgets sharing a row need to agree on a column split.
// `layout` names the exact CSS grid class already in components.css's own
// GRID section ('single' renders bare `.grid`, i.e. one stacked column —
// quickLinks()'s own standalone placement, app-screens.js:172/176/180).
export interface DashboardWidgetRow<T = any> {
  readonly layout: 'g-8-4' | 'g-4-8' | 'g-2' | 'g-3' | 'g-4' | 'single';
  readonly widgets: readonly DashboardWidgetDef<T>[];
  // The prototype's "My Team" accent-bordered strip wrapping Manager's row
  // (teamStrip, app-screens.js:72-94) — a themed group heading rather than a
  // plain grid. Omit for every other row, which renders as a bare `.grid`.
  readonly strip?: {
    readonly tag: string; // e.g. 'Manager'
    readonly heading: string; // e.g. 'My Team'
    readonly meta?: string; // e.g. '5 direct reports · Team scope'
    readonly actionLabel?: string; // e.g. 'Team Directory'
    readonly actionRoute?: readonly unknown[];
  };
}

export interface DashboardScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'dashboard';
  readonly id: string; // RBAC screen key, e.g. 'dashboard.manager'
  // The greeting PREFIX only ('Good afternoon') — DashboardScreenComponent
  // appends the signed-in user's first name itself, matching the prototype's
  // `Good afternoon, ${Rl.who.split(' ')[0]}` (app-screens.js:150).
  readonly title: string;
  readonly specRef?: string;
  // The role/scope line under the greeting, e.g. 'Manager — Own records plus
  // direct reports' (app-screens.js:151's `${Rl.name} — ${Rl.scope}`).
  readonly description?: string;
  // The explanatory callout every role's dashboard opens with (app-screens.js
  // :157/163/168/174/178, e.g. "Super Admin — every widget, every filter,
  // unscoped."). Plain text, not HTML: the prototype's embedded <b>/<code>
  // markup is a display nicety, not information a person needs that plain
  // text can't carry, and keeping this a string avoids trusting arbitrary
  // markup out of a config object the way the prototype's raw template
  // strings do.
  readonly note?: { readonly text: string; readonly kind?: 'info' | 'warn' | 'danger' };
  readonly tiles?: readonly DashboardTileDef[];
  readonly widgetRows: readonly DashboardWidgetRow[];
}

// ---------------------------------------------------------------------------
// The document shape — Invoice/Purchase Bill detail screens. Header modeled
// on TabbedScreenConfig's RecordHeaderDef (see DocumentHeaderDef's own
// comment below for why); fields/line items/totals reuse FieldConfig and
// ArrayColumnConfig verbatim rather than inventing parallel field types.
// ---------------------------------------------------------------------------

/** The identity card at the top of the screen. Deliberately shaped like
 * TabbedScreenConfig's RecordHeaderDef (avatar/recId/name/meta/badge/summary)
 * rather than RecordScreenConfig's flatter primary/secondary/code/badge — a
 * document's own header (app-screens2.js:858-866: "INV-2627-0138" / "Aarohi
 * Retail Solutions" / "Due 11-07-2026 · Part-Paid · FY 2026–27" / Total-Paid-
 * Balance tiles) is a multi-fact meta line plus summary tiles, which
 * RecordHeaderDef already models and RecordHeaderConfig's single `secondary`
 * string does not. `icon` is static (which document TYPE this is — 'invoice'
 * vs 'purchase' — decided once at config-authoring time, app-screens2.js:858's
 * `svg(isInv ? 'invoice' : 'purchase', 20)`), not a per-row function. */
export interface DocumentHeaderDef<T> {
  readonly icon: string; // app-icon name for the avatar square
  readonly recId: (row: T) => string; // the document's own number — invoice/bill number
  readonly name: (row: T) => string; // the counter-party — customer or vendor
  readonly meta?: (row: T) => readonly string[]; // dot-separated facts; blanks dropped
  readonly badge?: (row: T) => string; // status
  readonly summary?: (row: T) => readonly { readonly label: string; readonly value: string }[]; // Total / Paid / Balance tiles
}

/** A compact "from" line under the page title, sourced from the Company
 * Profile singleton (masters_company_profile.py's GET /masters/company-
 * profile, which may return null before it's set up — handled the same way
 * TabbedScreenComponent's own headerEndpoint does: a failed/empty fetch just
 * means the line doesn't render). Field keys are real columns on
 * CompanyProfile (backend/app/models/masters.py:286-314) — legal_name /
 * cin / tan / gstin / pan / phone / official_email / website; there is no
 * `company_name` or `address` column here, Address lives on the separate
 * CompanyAddress sub-resource. Optional: a screen whose role can't reach
 * masters.company_profile, or that simply doesn't need it, omits this. */
export interface DocumentLetterheadConfig {
  readonly endpoint: string; // GET, e.g. '/masters/company-profile'
  readonly fields: readonly { readonly key: string; readonly label: string }[];
}

/** The editable line-items table (app-screens2.js:908-918). Reuses
 * ArrayColumnConfig verbatim — a line item IS the same "child row living
 * inside the parent's own body" shape Tax Head's slab bands already
 * established, not a distinct concept needing its own column type.
 * invoice_line_items / purchase_bill_line_items are real child tables, but
 * Create/Update take them as a nested array on the parent's own Write body
 * (line_total is DB-Computed from quantity*rate — finance.py:159 / :66 —
 * never sent), which is exactly what emptyItem()/lineTotal() below are for. */
export interface DocumentLineItemsConfig<T> {
  readonly key: keyof T & string; // the array's key on the loaded record, e.g. 'line_items'
  readonly columns: readonly ArrayColumnConfig[];
  readonly emptyItem: () => Record<string, unknown>;
  // line_total is server-Computed and absent from a row the user just added
  // client-side — this is how the on-screen Line Total column gets a number
  // before the first save, mirroring quantity*rate (finance.py:159).
  readonly lineTotal: (item: Record<string, unknown>) => number;
}

/** One row of the totals block (app-screens2.js:919-924's `.totals .tr`
 * stack: Subtotal, Tax, Grand Total always; Withholding + Amount Payable to
 * Vendor only on a bill with one configured). A function over the loaded
 * record AND the current line items — not a static list — because which
 * rows even exist differs between Invoice and Purchase Bill, and within
 * Purchase Bill on whether a withholding tax is set at all; and because the
 * subtotal must track LIVE edits to quantity/rate, not just the last-saved
 * figure. `value` arrives pre-formatted (e.g. via formatMoney()) so the
 * config decides rounding/sign. */
export interface DocumentTotalRow {
  readonly label: string;
  readonly value: string;
  // The Grand Total / Total row — bold, distinct background. The prototype
  // gets this for free from `:last-child` (app.css:658); this flag makes it
  // explicit rather than relying on the config always ordering it last.
  readonly emphasize?: boolean;
}

/** A page action — Save / Send / Download / Record Payment / Raise Credit
 * Note (app-screens2.js:855-857). Deliberately reuses SecondaryActionDef's
 * field names (label/icon/route/endpoint/screenAction/confirm) rather than
 * inventing new ones: three of these five behave exactly like a list
 * screen's secondary action (navigate, or fire a no-body POST and reload) —
 * only Save is genuinely different, and `kind` is what tells the two apart. */
export interface DocumentActionDef<T> {
  readonly label: string;
  readonly icon?: string;
  // 'save' PUTs (edit mode) or POSTs (create mode, see
  // DocumentScreenConfig.createEndpoint) the current form state and needs
  // neither `route` nor `endpoint` of its own. 'route' and 'endpoint' behave
  // exactly like SecondaryActionDef's own two branches. 'download' is for a
  // GET that returns a FILE, not JSON (Invoice/Credit Note's own "Download
  // PDF") — 'endpoint's no-body-POST-and-reload is the wrong verb and
  // mechanism for that, so this runs the same auth'd
  // blob-fetch-and-click-a-synthetic-<a> mechanic as
  // ListScreenComponent.exportAs()/ReportScreenComponent.exportTable()
  // (`endpoint(row)` is the GET URL) instead of reloading the document
  // afterwards.
  readonly kind: 'save' | 'route' | 'endpoint' | 'download';
  readonly route?: (row: T) => readonly unknown[];
  readonly endpoint?: (row: T) => string;
  // Button emphasis — Save is 'primary' in every prototype instance
  // (app-screens2.js:856-857), everything else the default outline button.
  readonly cls?: 'primary';
  readonly screenAction: string;
  // PolicyStore.can(screenId ?? config.id, screenAction) — mirrors
  // RecordActionDef.screenId's own doc exactly. Most document actions
  // belong to the document's OWN screen (Invoice's Save/Send/Record Payment
  // are all real invoice.list actions) — this is only for the rare action
  // gated on a genuinely DIFFERENT RBAC screen, e.g. Invoice's own "Raise
  // Credit Note" button is credit_note.list's 'raise' action, not anything
  // registered on invoice.list itself (app/rbac/registry/screens.py) —
  // checking it against the host document's id would silently never
  // resolve true for any role.
  readonly screenId?: string;
  readonly confirm?: string;
  // Raise Credit Note only makes sense once something has been paid; Record
  // Payment stops applying once the balance is zero. Absent means always
  // visible once the screenAction check passes. Only ever consulted in EDIT
  // mode — see DocumentScreenComponent.visibleActions()'s own comment on why
  // create mode shows 'save' alone regardless of what this returns.
  readonly visible?: (row: T) => boolean;
}

export interface DocumentScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'document';
  readonly id: string; // RBAC screen key, e.g. 'invoice.detail'
  readonly title: string;
  readonly specRef?: string;
  readonly description?: string;
  readonly loadEndpoint: (id: string) => string; // GET, e.g. `/invoices/${id}`
  // PUT. Omit only for a document with no edit action at all — mirrors
  // RecordScreenConfig.edit and FormScreenConfig.updateEndpoint both being
  // optional for the identical reason: don't require what the backend
  // doesn't offer.
  readonly saveEndpoint?: (id: string) => string;
  // Create mode — Invoice's own New Invoice screen is the first consumer
  // (11-invoice-module.md §2.3's New/Edit share one screen/route pair, same
  // way FormScreenConfig's create/update do). POST, e.g. `/invoices`. Omit
  // for a document that can only ever be edited, never created here.
  // DocumentScreenComponent branches on the route: no :id means create
  // mode — the form seeds from `emptyRow()` instead of fetching, and Save
  // POSTs here instead of PUTing `saveEndpoint`.
  readonly createEndpoint?: string;
  // Starting values for a brand-new, unsaved document — same contract as
  // FormScreenConfig.emptyRow. Defaults to `{}` when `createEndpoint` is set
  // but this is omitted; in practice every config that sets `createEndpoint`
  // should also set this, since header/totals/locked all read the loaded
  // row unconditionally and a bare `{}` renders blank labels rather than
  // sensible defaults (Invoice seeds status: 'DRAFT' so the badge and the
  // locked()/note() checks behave exactly like a freshly-saved row already
  // would, and line_items/tax_lines as [] so the line-items table and
  // totals never see `undefined`).
  // queryParams: the create route's own query string (e.g. /invoices/new?
  // customer_id=X), for a document started from a related record elsewhere
  // in the app (Opportunity's own "Create Invoice" action) to hand off a
  // starting value or two without a dedicated draft-handoff endpoint.
  readonly emptyRow?: (queryParams: Record<string, string>) => Partial<T>;
  // Where Save navigates after a successful CREATE (never consulted on an
  // edit save, which stays on the same route) — mirrors
  // FormScreenConfig.onCreateSuccess, but fixed-shape rather than reading
  // the response generically, since every document route is `<base>/:id`
  // and the created row's own id is all that's ever needed, e.g.
  // `(row) => ['/invoices', row.id]`. Effectively required wherever
  // `createEndpoint` is set — omitting it leaves the screen showing the
  // freshly-created record without navigating to its own :id route (a
  // documented gap; no config omits it today).
  readonly recordRoute?: (row: T) => readonly unknown[];
  readonly header: DocumentHeaderDef<T>;
  readonly letterhead?: DocumentLetterheadConfig;
  // The prototype's U.note() callout right under the header — "The lock on
  // Paid, stated exactly" for Invoice, "No PDF-generation button here" for
  // Purchase Bill (app-screens2.js:925-927). A function of the loaded row
  // because which note (or whether one shows at all) can depend on status.
  // Config-authored copy only — rendered via bypassSecurityTrustHtml in the
  // component, the same trust boundary IconComponent's own frozen icon map
  // already relies on (never user or API data).
  readonly note?: (row: T) => string | null;
  // Read-only fields (Internal Bill ID, Financial Year, the computed Amount
  // Payable) sit alongside genuinely editable ones in the SAME section in
  // the prototype (app-screens2.js:867-907) — FieldConfig.editable is what
  // already tells them apart on the 'record' shape; reused here rather than
  // inventing a second on/off switch.
  readonly fields: readonly FieldConfig<T>[];
  readonly lineItems: DocumentLineItemsConfig<T>;
  readonly totals: (row: T, items: readonly Record<string, unknown>[]) => readonly DocumentTotalRow[];
  // True once the document can no longer be edited at all — Invoice's own
  // rule is "Status = Paid" (app-screens2.js:926), never a fixed property of
  // the document TYPE, so this reads the loaded row rather than being a
  // flag on the config. Omit for a document that is never locked.
  readonly locked?: (row: T) => boolean;
  readonly actions: readonly DocumentActionDef<T>[];
}

// ---------------------------------------------------------------------------
// The payslip shape — the prototype's R.payslip (app-screens2.js:1031): a
// structured document, not a generic record. An identity header with the pay
// period and credit date, an Earnings card and a Deductions card built purely
// from the loaded payslip's own line-item arrays, an optional Reissue History
// card, and up to three page-head actions (Download PDF, Download Salary
// Certificate, Reissue).
//
// §6 "no tax named in code": the backend already keeps deduction rows generic
// — PayslipOut.statutory_lines carries one row per applicable tax head with
// its own print_label_snapshot (backend/app/schemas/payroll.py:147-158), and
// PayslipOut.adjustment_lines carries ad-hoc additions/deductions with their
// own label_snapshot (:161-169). This component reads those arrays only
// through the accessor functions below and never prints a literal row label
// itself — a payslip with three configured tax heads shows three rows, one
// with none shows none, exactly like the prototype's own payroll-run preview
// ("This module contains no knowledge of any specific deduction",
// app-screens2.js:1023).
// ---------------------------------------------------------------------------

/** One printed line — an earning, a deduction, or an ad-hoc addition. Every
 * row this component draws is one of these, sourced from the payslip's own
 * `earning_lines` / `statutory_lines` / `adjustment_lines`
 * (backend/app/schemas/payroll.py:135-169) via the config's accessor
 * functions below — never a label invented in the component. */
export interface PayslipLineItem {
  readonly label: string;
  readonly amount: number;
  /** A short pill next to the label — the prototype's "Ad-hoc" tag on a
   * Diwali Bonus row (app-screens2.js:1054). Omit for a plain line. */
  readonly tag?: string;
}

export interface PayslipHeaderDef<T> {
  /** 1-2 characters for the avatar tile; falls back to the employee name's
   * own initials (prototype's initials(), app-core.js:74) when omitted. */
  readonly avatar?: (row: T) => string;
  /** The small mono line above the name, e.g. "Payslip · June 2026". */
  readonly recId: (row: T) => string;
  readonly employeeName: (row: T) => string;
  /** Dot-separated facts under the name, e.g. [employee code, designation]. */
  readonly meta: (row: T) => readonly string[];
  readonly badge: (row: T) => string; // status, e.g. "Processed"
  /** The small line under the identity card — "Covers ... Credited on ...". */
  readonly subline?: (row: T) => string;
  /** Reissue count/date, phrased by the caller — return null/'' to show
   * nothing. Read straight off the loaded record's own reissue_count /
   * last_reissued_at (backend/app/schemas/payroll.py:203-204), never
   * fabricated here. */
  readonly reissueSummary?: (row: T) => string | null;
}

export interface PayslipSummaryDef<T> {
  readonly gross: (row: T) => number;
  readonly deductions: (row: T) => number;
  readonly netPay: (row: T) => number;
}

/** A recorded reissue — rendered only when `reissueHistoryEndpoint` is set.
 * No `GET /payroll/payslips/{id}/reissues` exists yet (payslips.py has only
 * the POST at :281), so a screen that doesn't set this endpoint simply gets
 * no Reissue History card — never a fabricated empty table. */
export interface PayslipReissueRow {
  readonly date: string;
  readonly by: string;
  readonly reason: string;
  readonly oldNet: number;
  readonly newNet: number;
}

export interface PayslipScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'payslip';
  readonly id: string; // RBAC screen key, e.g. 'payroll.my_payslips' or 'payroll.payslips_admin'
  readonly title: string;
  readonly specRef?: string;
  readonly description?: string;
  readonly loadEndpoint: (id: string) => string; // real backend path, e.g. `/payroll/payslips/${id}` or `/payroll/payslips/me/${id}`
  readonly header: PayslipHeaderDef<T>;
  readonly summary: PayslipSummaryDef<T>;
  readonly earningLines: (row: T) => readonly PayslipLineItem[];
  readonly deductionLines: (row: T) => readonly PayslipLineItem[];
  /** Ad-hoc ADDITIONS only (adjustment_lines where adjustment_type ===
   * 'ADDITION') — printed at the bottom of Earnings with an "Ad-hoc" pill,
   * per the prototype (app-screens2.js:1054). Ad-hoc DEDUCTIONS belong in
   * `deductionLines` instead; this component only draws what each accessor
   * returns, it never sorts or relabels. */
  readonly adhocLines?: (row: T) => readonly PayslipLineItem[];
  readonly earningsNote?: string;
  readonly deductionsNote?: string;
  // Download PDF — the real letterheaded document (payslips.py:189), shared
  // by self-service and admin views alike; ownership is enforced server-side,
  // so no extra RBAC gate is needed on this button.
  readonly pdfEndpoint?: (row: T) => string;
  // Download Salary Certificate — a SEPARATE on-demand document, not this
  // payslip's own PDF (payslips.py:456; SalaryCertificateRequestCreate takes
  // an optional Purpose). POSTs the request, then downloads the returned
  // pdf_file_id through the generic `/files/{id}` endpoint (files.py:111).
  readonly salaryCertificate?: {
    readonly requestEndpoint: string; // POST, e.g. '/payroll/salary-certificates'
    readonly promptForPurpose?: boolean; // shows a native prompt() for Purpose first
    // Admin-view only: generates the certificate for the payslip's OWNER
    // instead of the caller (payslips.py's request_salary_certificate now
    // takes an optional `employee_id` query param, gated additionally on
    // payroll.payslips_admin — the caller's own self-service path, with this
    // omitted, is unaffected). Never set on the self-service my-payslips
    // config, where the certificate is always the caller's own.
    readonly employeeId?: (row: T) => string;
  };
  // Reissue — Accountant/HR/Super Admin only (payslips.py:287, action=
  // "reissue"). Needs Reason + Method (+ optional manual figures), a real
  // form rather than a no-body POST, so this navigates to that route.
  readonly reissue?: {
    readonly route: (row: T) => readonly unknown[];
    readonly screenAction?: string; // defaults to 'reissue'
  };
  // Set only once a list endpoint for a payslip's own reissues exists.
  readonly reissueHistoryEndpoint?: (row: T) => string;
}

// ---------------------------------------------------------------------------
// The permission-matrix shape — the prototype's R.matrix (app-screens2.js:
// 1295), RBAC's own Permission Matrix screen (14-rbac-module.md §4.2) and
// the reference case this shape was built for (Phase 17 wires the real
// screen; matrix-screen.component.ts only owns the reusable shell). Grounded
// directly in the backend contract ALREADY BUILT for it — `GET`/`PUT
// /rbac/matrix/{role_code}` (app/api/v1/rbac_admin.py) and
// MatrixModuleState/MatrixScreenState (app/schemas/rbac_admin.py) — not just
// the prototype's demo data, which models Layer 3 one level too shallow (see
// MatrixItem's own comment below).
//
// Matrix data is fetched ONE COLUMN at a time — a role dropdown, exactly the
// prototype's `S.view['matrixRole']` switcher AND the real backend's
// per-role GET — rather than every role rendered side by side; a 168-screen
// x 900-field grid with 5 role columns at once would not fit a screen.
//
// Each row (a "screen" in RBAC's own vocabulary, kept generic here since the
// shape is not RBAC-exclusive) carries up to three independently editable
// layers — the RBAC module's four layers, with Layer 1 and Layer 4 merged
// into one field exactly as the real data model merges them:
//   Layer 1 + Layer 4 — mode: session.model.ts's ScreenMode (none/full/view/
//     view_team/own/team) — ONE field that encodes visibility AND scope
//     together (app/rbac/resolver.py's own docstring: "'full'/'view'/
//     'view_team'/'own'/'team'/'none' encodes both at once"). Rendered as a
//     single segmented control rather than two controls that could disagree
//     — a deliberate, disclosed departure from the prototype's own two
//     separate scope-seg controls (see judgmentCalls).
//   Layer 2 — actions: independent boolean chips, e.g. "Add", "Export".
//   Layer 3 — fields: chips that CYCLE a small value list (FieldMode:
//     show/mask/hide) rather than a plain on/off boolean.
// Edits accumulate as PENDING CHANGES per row — the prototype's own copy:
// "Toggles accumulate as pending edits rather than saving one at a time" —
// and commit together in one request: RBAC 14 §3.2's "bulk-apply", built to
// exactly the shape rbac_admin.py's MatrixSaveRequest/MatrixScreenChange
// already expects by default (buildSaveBody may override it).
// ---------------------------------------------------------------------------

export interface MatrixItemActionState {
  readonly key: string;
  readonly label: string;
  readonly allowed: boolean;
}

export interface MatrixItemFieldState {
  readonly key: string;
  readonly label: string;
  readonly mode: string; // one of the config's fieldModeOptions
}

// One row. Named generically ("item", not "screen") since this shape is not
// RBAC-exclusive, but every field here maps 1:1 onto MatrixScreenState.
export interface MatrixItem {
  readonly key: string;
  readonly label: string;
  readonly specRef?: string;
  // Layer 4 gate — an item without a real scope concept (most Masters
  // screens: nothing on them is "your own" vs "your team's") never offers
  // own/team/view_team, matching Screen.has_scope server-side. The real
  // backend ties `fields` to ONE screen (ScreenSensitiveField.screen_id) —
  // more granular than the prototype's own demo data, which attaches its
  // Layer-3 toggle list once PER MODULE (D.toggles[m.label]). This type
  // follows the real, already-built backend model, not the prototype's
  // simplified demo shape (see judgmentCalls).
  readonly hasScope?: boolean;
  readonly mode: string; // one of the config's modeOptions
  readonly actions: readonly MatrixItemActionState[];
  readonly fields: readonly MatrixItemFieldState[];
}

// One collapsible group of rows — a "module" in RBAC's own vocabulary.
export interface MatrixGroup {
  readonly key: string;
  readonly label: string;
  readonly specRef?: string;
  readonly items: readonly MatrixItem[];
}

// One row's accumulated edits, keyed by MatrixItem.key. `actions`/`fields`
// are PARTIAL — only the keys actually touched — matching
// MatrixScreenChange's own optional dict fields, so a save never overwrites
// an untouched field/action on the same row with a stale value.
export interface MatrixPendingChange {
  readonly itemKey: string;
  readonly mode?: string;
  readonly actions?: Record<string, boolean>;
  readonly fields?: Record<string, string>;
}

// Where the column selector's options come from — the prototype's role
// dropdown (`Object.keys(C.ROLES)`); the real backend equivalent is
// GET /rbac/roles (RoleDirectoryRow: role_code/role_name/...).
export interface MatrixColumnsSource {
  readonly label: string; // control's own label, e.g. "Configure permissions for"
  readonly options?: readonly FilterOption[]; // static, when the column set is fixed (e.g. the 5 seeded roles)
  readonly optionsEndpoint?: string; // GET, when the column set can grow
  // Maps one raw row of optionsEndpoint's array response to an option.
  // Defaults to `{ value: row.role_code ?? row.id, label: row.role_name ?? row.name }`
  // — RoleDirectoryRow's own field names — override for a differently-shaped endpoint.
  readonly mapOption?: (row: any) => FilterOption;
  readonly defaultValue?: string;
}

export interface MatrixScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'matrix';
  readonly id: string; // RBAC screen key, e.g. 'rbac.permission_matrix'
  readonly title: string;
  readonly specRef?: string;
  readonly description?: string;
  // Rendered as the top instructional callout (.rbac-note) — plain text only
  // (no bold/markup), unlike the prototype's own U.note() which allows inline
  // HTML; kept safe/simple rather than adding a sanitized-HTML input for one
  // optional field.
  readonly helpNote?: string;
  readonly emptyText?: string; // shown when a column's matrix has no rows at all (not a filtered-to-zero state, which gets its own "Clear filters" message)

  readonly columns: MatrixColumnsSource;

  // GET, scoped by the selected column's value (e.g. `/rbac/matrix/${role}`).
  // Returns the raw group array; `mapGroups` normalizes it into MatrixGroup[]
  // so the component itself never assumes a particular backend field naming.
  readonly rowsEndpoint: (column: string) => string;
  readonly mapGroups: (raw: readonly T[]) => readonly MatrixGroup[];
  // Server-side search param name (real backend: GET .../matrix/{role_code}
  // ?search=, matches module OR screen label only — see judgmentCalls on why
  // action/field-name search is handled client-side regardless of this).
  // `false`/omitted keeps search entirely client-side over the loaded rows.
  readonly searchParam?: string | false;

  readonly modeOptions: readonly FilterOption[]; // Layer 1+4 — session.model.ts's ScreenMode, all 6 members (none/full/view/view_team/own/team)
  // Layer 1 values that require `item.hasScope` — hidden from an item's
  // segmented control otherwise. Defaults to ['own', 'team', 'view_team'].
  readonly scopedModeValues?: readonly string[];
  readonly fieldModeOptions: readonly FilterOption[]; // Layer 3 — FieldMode, all 3 members (show/mask/hide); index 0 is treated as the implicit default value

  // PUT (matching rbac_admin.py's save_matrix), scoped by the selected column.
  readonly saveEndpoint: (column: string) => string;
  readonly saveMethod?: 'PUT' | 'POST'; // defaults to 'PUT'
  // Builds the real request body from the accumulated pending changes.
  // Defaults to `{ changes: pending.map(p => ({screen_key: p.itemKey, mode: p.mode, actions: p.actions, fields: p.fields})) }`
  // — MatrixSaveRequest's own shape.
  readonly buildSaveBody?: (pending: readonly MatrixPendingChange[]) => unknown;
  readonly saveScreenAction?: string; // PolicyStore.can(id, ...) gate; defaults to 'edit'

  // RBAC 14 §3.2 "filter by module" — options are derived automatically from
  // the loaded groups' own keys/labels; this only supplies the control's label.
  readonly moduleFilterLabel?: string; // defaults to 'All Modules'

  // RBAC 14 §3.2 "show only non-default rules by default, with a show-all
  // toggle". Optional because "non-default" cannot be computed without a
  // declared default baseline — a config that omits this always shows every
  // row (a documented gap; see judgmentCalls).
  readonly isDefaultItem?: (item: MatrixItem) => boolean;
  readonly defaultsToggleLabel?: string; // defaults to 'Show all (including defaults)'
}

export type ScreenConfig =
  | ListScreenConfig<any>
  | RecordScreenConfig<any>
  | FormScreenConfig<any>
  | SingletonFormConfig<any>
  | TabbedScreenConfig<any>
  | BoardScreenConfig<any>
  | ReportScreenConfig<any>
  | CalendarScreenConfig<any>
  | ChecklistScreenConfig<any>
  | ConversationScreenConfig<any>
  | DashboardScreenConfig<any>
  | DocumentScreenConfig<any>
  | PayslipScreenConfig<any>
  | MatrixScreenConfig<any>;
