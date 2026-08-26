# ARCH-1 — Database Schema (MySQL 8 / MariaDB)

**134 tables across the platform core and all 15 modules.** Targets **MySQL 8.0.16+ / MariaDB 10.5+**, InnoDB, `utf8mb4` — see **D0** for the dialect mapping and the three constructs that needed redesign.

Every table carries the audit mixin (see Schema-Wide Decisions). Column lists are the required
minimum: where a module spec Fields Table names a field not listed here, **the spec wins** and the
column is added. Nothing in this document overrides a `.md` module specification.

---

## D0 — Dialect: MySQL 8 / MariaDB, and the three things that do not port

**Target: MySQL 8.0.16 or later** (8.4 LTS recommended), or **MariaDB 10.5+**. The floor is 8.0.16 because
that is the first release where `CHECK` constraints are *enforced* rather than parsed and ignored — this
schema leans on them heavily, and on 8.0.15 or earlier every one of them would silently do nothing.

**Engine: InnoDB throughout.** Required for foreign keys, transactions, and the `SELECT … FOR UPDATE`
row-lock the document-numbering allocator depends on. **Charset `utf8mb4`, collation
`utf8mb4_0900_ai_ci`** (MariaDB: `utf8mb4_uca1400_ai_ci`) — not `utf8`, which is a 3-byte subset that
cannot store every character a person may legitimately type into a name or an address field.

### Type mapping applied throughout this document

| Concept | MySQL type | Note |
|---|---|---|
| Primary / foreign keys | `CHAR(36)` | UUID as text. `BINARY(16)` with `UUID_TO_BIN()` is ~2.5× smaller and indexes better, but is unreadable in a console and complicates every ad-hoc query. At this system's row counts the readability wins; revisit if any table passes a few million rows |
| Money | `DECIMAL(14,2)` | Never `FLOAT`/`DOUBLE` |
| Hours | `DECIMAL(6,2)` | |
| Percentages | `DECIMAL(7,4)` | |
| Timestamps | `DATETIME(6)` | **Not `TIMESTAMP`** — MySQL's `TIMESTAMP` range ends in 2038 and this system stores future-dated records. Store UTC explicitly; the application converts |
| Booleans | `TINYINT(1)` | MySQL's `BOOLEAN` is an alias for exactly this |
| Open-ended config | `JSON` | MySQL has no `jsonb`; `JSON` is validated and indexable via generated columns |
| Derived single-row values | `GENERATED ALWAYS AS (…) STORED` | Supported since 5.7.6 — **this one ports cleanly** and all 56 uses stand |

UUIDs are generated in the **application layer** (SQLAlchemy `default=uuid4`), not by a column default.
Expression defaults need 8.0.13+, and generating them in Python keeps the id available before the INSERT.

### The three constructs that have NO MySQL equivalent

**1. Partial unique indexes → the generated-column trick (59 uses).**
Postgres allows `UNIQUE (…) WHERE condition`; MySQL has no filtered indexes. But MySQL treats `NULL`s as
distinct in a unique index, so a stored generated column that is the key when the condition holds and `NULL`
otherwise gives exactly the same guarantee:

```sql
-- Postgres: UNIQUE (company_id) WHERE is_primary
-- MySQL:
is_primary          TINYINT(1)  NOT NULL DEFAULT 0,
primary_guard       CHAR(36)    GENERATED ALWAYS AS (IF(is_primary = 1, company_id, NULL)) STORED,
UNIQUE KEY ux_one_primary_address (primary_guard)
```

**The one detail in this pattern that is trivial to get backwards, and was — caught by running Phase 0's
`financial_years` table against a real MySQL 8.4 container, not by reading the code.** The guard column's
true-branch value decides what "one" means, and it must never be a value that is already unique per row:

- **Per-group rule** ("one primary address *per company*"): the true-branch value is the **grouping key**
  (`company_id` above). Two different companies each get their own primary address, because their
  `company_id`s differ; two rows in the *same* company both claiming primary collide correctly, because
  they'd generate the same `company_id` value.
- **Global rule, no grouping key** ("one *current* financial year", full stop): there is nothing to group
  by, so the true-branch value must be a **literal constant** — `IF(is_current = 1, 1, NULL)`, not
  `IF(is_current = 1, id, NULL)`. The first Phase 0 migration used `id` here. Since a primary key is
  already unique by definition, the `UNIQUE KEY` on the guard column never fired — two financial years both
  flagged `is_current = 1` inserted without error, silently defeating the entire rule. Fixed to the
  constant form and re-verified: the second insert now correctly raises a duplicate-key error.

**Apply this check before writing any of the other four "only one X" rules this schema still owes** — one
primary company address, one default bank account, one default tax scheme, one singleton company profile.
Ask: is there a genuine grouping key, or is this actually global? Get that question wrong and the
constraint compiles, looks correct in review, and does nothing.

Every "only one X" rule in this schema uses this pattern: one current financial year, one primary company
address, one default bank account, one default tax scheme, one singleton company profile. **The rule is
still enforced by the database, not by application code** — which was the point of making them indexes.

**2. `EXCLUDE` constraints → application guard + trigger (14 uses, 3 of them load-bearing).**
Postgres prevents overlapping date ranges declaratively with `EXCLUDE USING gist`. MySQL cannot express
this at all. The three real cases — **overlapping salary-structure periods per employee**, **overlapping
pay-cycle periods**, and **overlapping pending leave requests per employee** — are enforced two ways
together, because neither alone is sufficient:

- A `BEFORE INSERT` / `BEFORE UPDATE` trigger that `SIGNAL SQLSTATE '45000'` on overlap. Catches anything
  reaching the table by any route.
- A service-layer check inside the same transaction, taking `SELECT … FOR UPDATE` on that employee's
  existing rows first, so two concurrent inserts cannot both pass their own check.

The trigger is the correctness backstop; the service check produces a usable error message. **Do not ship
only the service check** — that is precisely the kind of rule that holds until the first bulk import.

**3. Array columns → a junction table (1 use).**
`tax_heads.withholding_direction text[]` becomes `tax_head_withholding_directions (tax_head_id, direction)`
with a composite primary key and a `CHECK` on the allowed values. Slightly more verbose, and it makes
"which heads apply on payments received" a normal join rather than a containment operator.

### D0.4 — Full-text search degrades, and the specs promise search on every list

This is the most consequential difference and it is easy to miss. Postgres trigram indexes match
**anywhere inside** a string; MySQL `FULLTEXT` matches **whole words**. The Filter & Export Convention
(RBAC §2.2) promises free-text search on every list screen, over both names *and* identifying codes, and
those two need different treatment on MySQL:

| What is being searched | Approach | Consequence |
|---|---|---|
| Names, descriptions, notes, messages | InnoDB `FULLTEXT` + `MATCH … AGAINST (:term IN BOOLEAN MODE)` | Works well. Note `innodb_ft_min_token_size` defaults to **3** — two-character terms return nothing until it is lowered and the index rebuilt |
| Document codes (`INV-2627-0138`, `PB-2026-0031`, `EMP-2026-0001`) | Ordinary B-tree index + `LIKE 'term%'` | **Prefix search is indexed and fast. Mid-string search is not** — `LIKE '%2627%'` cannot use an index and scans the table |

**What to do about the mid-string case**, because users *will* paste a fragment of an invoice number:
store a `search_key` generated column holding the code stripped of separators and upper-cased, index it,
and search it with a prefix `LIKE`. That covers "starts with" cheaply. If genuine mid-string matching on
codes turns out to be needed, that is the point to introduce a dedicated search index — not to bolt
`LIKE '%…%'` onto a growing table and discover it later.

Whichever is chosen, it must be implemented **once** in the shared list-query layer (BUILD-PROMPT §7), not
per screen, or ~51 list screens will each invent their own search semantics.

### Two smaller differences worth knowing before they surprise someone

- **`ON DELETE RESTRICT` works**, and is used throughout — but MySQL foreign keys are only enforced under
  InnoDB, which is why the engine is stated above rather than assumed.
- **`TEXT` cannot be indexed without a prefix length, so any indexed or `UNIQUE` column is `VARCHAR`.**
  This is not a style preference — `UNIQUE` on a `TEXT` column is a hard error in MySQL. Every such column
  in this schema (document codes, short codes, storage keys, reference numbers — 28 of them) is
  `VARCHAR(191)`. 191 rather than 255 is the conventional safe ceiling for a utf8mb4 index under the older
  767-byte limit, and costs nothing here. `TEXT` remains correct for genuinely unbounded prose that is never
  indexed: notes, descriptions, message bodies, addresses.
- **Index key length**: InnoDB with `DYNAMIC` row format caps an index key at 3072 bytes. A composite index
  over several `VARCHAR(191)` columns can still exceed it — check before adding one.

---

## Schema-wide decisions

### D1 — AUDIT MIXIN (applies to EVERY table above and below, listed once instead of 5x per table)

AUDIT MIXIN (applies to EVERY table above and below, listed once instead of 5x per table): id CHAR(36) PK (UUID generated in the application layer); created_at DATETIME(6) NOT NULL DEFAULT now(); updated_at DATETIME(6) NOT NULL DEFAULT now() (maintained by a shared BEFORE UPDATE trigger set_updated_at()); created_by uuid NOT NULL FK users(id); updated_by uuid NULL FK users(id). Implemented as a SQLAlchemy 2.x declarative mixin plus one Alembic helper so it can never be forgotten. users.created_by/updated_by are self-referential and nullable only for the bootstrap row. Where the spec names 'Created By' / 'Last Modified By' as a visible field (Asset, Invoice, Ticket, Customer, Opportunity, Project, Purchase Bill, Expense), that field IS the mixin column — not a duplicate.

### D2 — IMMUTABLE LOG EXCEPTION

IMMUTABLE LOG EXCEPTION: permission_change_log, email_send_log, work_item_comments, asset_assignment_history, ticket_assignment_history, payslip_reissues, leave_balance_adjustments and structure-history rows carry created_at/created_by only, with UPDATE and DELETE revoked at the role level. An audit trail you can edit is not an audit trail.

### D3 — MONEY AND HOURS

MONEY AND HOURS: every rupee figure is DECIMAL(14,2); every hour figure is DECIMAL(6,2); day counts that support half-days are DECIMAL(5,2) with a CHECK that (days*2) is an INT; percentage rates are DECIMAL(7,4) to survive 2-decimal rates without float drift. DOUBLE PRECISION / REAL appear nowhere in this schema. Quantities on line items are DECIMAL(14,3).

### D4 — SOFT DELETE POLICY

SOFT DELETE POLICY — three tiers, not one blanket flag. (1) NEVER hard-deleted once used: tax_heads, bank_accounts, expense_types, leave_types, all 21 sub-masters, email_templates, employees, assets, customers, vendors — these carry is_active (or a status enum) and deactivation removes them from dropdowns while every historical row keeps resolving to them. (2) Conditionally deletable: financial_years (only while reference_count = 0), holidays (only while used_in_processed_payroll = false), employee_documents (only by the employee, only while PENDING_VERIFICATION). (3) Genuinely deletable drafts: unposted line items on a Draft invoice/bill, unsubmitted timesheet rows. There is no global deleted_at column — a flag that means 'sometimes gone, sometimes not' across 130 tables is worse than three explicit rules.

### D5 — DEACTIVATION NEVER REWRITES HISTORY

DEACTIVATION NEVER REWRITES HISTORY: foreign keys to masters are plain FKs with ON DELETE RESTRICT. The 'active only' filtering happens in the dropdown query, never in the FK. A payment that went to a now-closed bank account still names that account.

### D6 — NUMBERING

NUMBERING — CONCURRENCY-SAFE ALLOCATION (the stated strategy): document codes are NOT AUTO_INCREMENT columns, because sequences cannot reset per financial year, cannot honour the starting-number immutability rule, and are non-transactional. Allocation is a single statement inside the same transaction as the document INSERT: `UPDATE document_number_sequences SET next_number = next_number + 1, last_issued_number = next_number, last_issued_at = now() WHERE code_type = $1 AND financial_year_id IS NOT DISTINCT FROM $2 RETURNING last_issued_number;` The row-level write lock serialises concurrent allocators for that (type, FY) pair only, so INV and PB never block each other. The rendered code ({PREFIX}-{FY_LABEL}-{zero-padded running}) is stored on the document itself, so later prefix changes are forward-only and never rewrite issued codes. A rolled-back transaction burns a number — accepted deliberately: a gap is harmless, a duplicate invoice number is not. Missing (code_type, FY) rows are created by `INSERT ... ON CONFLICT DO NOTHING` seeded from number_prefix_rules.starting_number, which is also what implements 'Resets Every FY = Yes'.

### D7 — FINANCIAL-YEAR LOCK

FINANCIAL-YEAR LOCK — ENFORCEMENT MECHANISM (this is the rule that overrides every role permission, so it lives in the database, not the API): a shared immutable function `fy_status_for(d date) RETURNS TEXT` resolves a date to its FY status. Every table holding a business date gets a BEFORE INSERT OR UPDATE OR DELETE trigger `enforce_fy_lock()` that raises when the row's governing date resolves to a LOCKED year — on both the OLD and NEW date so a record cannot be dragged out of a locked year either. Tables carry an explicit financial_year_id (stamped on insert from their governing date) so the check is an index lookup, not a range scan. The trigger is installed via a catalogue-driven Alembic loop over a registry list, so adding a dated table means adding one registry entry, and 'every record dated inside that year IN EVERY MODULE' is provably complete rather than remembered. Super Admin has no bypass; the trigger does not read the current role.

### D8 — FINANCIAL-YEAR DELETABILITY

FINANCIAL-YEAR DELETABILITY: the same registry drives financial_years.reference_count, incremented/decremented by an AFTER trigger on every FY-referencing table. Delete is offered only while the count is 0; once anything references it, Delete is disabled forever and Lock becomes the only remaining action.

### D9 — TAX ENGINE

TAX ENGINE — NOTHING IS HARDCODED. There is no PF column, no ESI column, no GST column, no regime flag anywhere in this schema. A tax is a row in tax_heads; its bands are rows in tax_head_slab_bands; its split is rows in tax_head_split_components; its relief is rows in tax_head_relief_rules. An empty tax_heads table is a valid, fully functional installation: invoices render with no tax lines, salary structures show Net Monthly = Gross Monthly, and My Tax Declarations shows an empty state. Every consumer resolves heads at render time with `WHERE is_active AND applies_from <= :doc_date AND (applies_until IS NULL OR applies_until >= :doc_date) AND scope = ANY(:scopes)`.

### D10 — TAX ARITHMETIC LOCK

TAX ARITHMETIC LOCK: tax_heads.is_arithmetic_locked is set true by an AFTER INSERT trigger on invoice_tax_lines, purchase_bill_tax_lines, payslip_statutory_lines, salary_structure_statutory_lines and tax_declaration_lines. A BEFORE UPDATE trigger on tax_heads (and on its three child tables) then rejects any change to rate_pct, cgst_rate_pct, sgst_rate_pct, fixed_amount, declaration_cap, slab_application, band figures and component shares — for every role including Super Admin. Only tax_name, short_code, print_label and notes stay editable. Rate changes go through the Applies Until + Duplicate route, with supersedes_tax_head_id preserving the version chain.

### D11 — REPRODUCIBILITY BY SNAPSHOT

REPRODUCIBILITY BY SNAPSHOT: every calculated tax line (invoice_tax_lines, purchase_bill_tax_lines, payslip_statutory_lines, salary_structure_statutory_lines) stores config_snapshot JSONB — the resolved rate/bands/components/relief actually used, plus the print label — alongside the tax_head_id. The FK answers 'which head', the snapshot answers 'what did it say that day'. This is the second half of the arithmetic lock and the reason an issued invoice or processed payslip stays reproducible even if a head is later retired.

### D12 — JSONB

JSONB — USED IN EXACTLY SIX PLACES, EACH JUSTIFIED, NOWHERE ELSE. (1) tax_heads.behaviour — the deliberately trimmed-out head attributes (ceilings, location/employment-type restrictions, include-in-CTC, show-on-payslip); genuinely open-ended and re-addable as data, not migration. (2) *_tax_lines.config_snapshot and payslip_statutory_lines.config_snapshot — a frozen copy of a variable-shaped configuration. (3) tax_head_split_components.condition_rule — a small comparison AST. (4) adhoc_payslip_adjustments.metadata and payslip_reissues.old_figures/new_figures — a whole figure set captured as one immutable blob. (5) email_templates.available_placeholders — per-trigger merge-field catalogue. (6) offer_letters.snapshot and salary_certificate_requests.figures_snapshot — point-in-time document contents. Everything else — statuses, amounts, dates, relationships — is a real typed column with a real constraint. JSONB is not used for anything that gets filtered, summed, or joined on.

### D13 — DERIVED FIELDS ARE NEVER TYPED

DERIVED FIELDS ARE NEVER TYPED. Implemented three ways by cost: (a) MySQL GENERATED ALWAYS AS ... STORED (supported since 5.7.6) where the expression is immutable and single-row — financial_years.end_date, work_week_policies.net_working_hours_per_day, leave_balances.remaining, invoice_line_items.line_total, purchase_bills.balance_due. (b) Trigger-maintained columns where the formula spans rows or conditional inputs — salary_structures.gross_monthly / net_monthly / annual_ctc (LTA is conditional on frequency), invoice roll-ups, attendance derived hours. (c) Plain views where the value is pure presentation and never filtered on: v_customer_360 (Total Invoiced / Received / Outstanding / Has Open Opportunities), v_vendor_usage (the Vendor Usage Row shape, a UNION of purchase bills and expenses), v_expense_statement (the Statement Export Row shape with its running balance), v_payroll_impact (the Payroll Impact Row, over monthly_hour_reconciliations), v_saturday_calendar (pattern resolved for all 52 Saturdays, overrides applied), v_financial_year_current. No derived value in this schema has a writable path from the API.

### D14 — TENANCY

TENANCY: single-tenant by design — Company Profile is an enforced singleton, so there is no tenant_id anywhere and no row-level tenant filter to forget. If multi-tenancy is ever needed, the migration is: add company_id to company_profile (dropping the singleton CHECK), add company_id to every root aggregate (employees, customers, vendors, invoices, assets, tickets, projects, purchase_bills, expense_claims, financial_years and all masters), extend every UNIQUE constraint listed above with company_id as the leading column, and enable RLS. Doing it later is a known, bounded, mechanical change; doing it now would add a dead column to 130 tables.

### D15 — ONE-ROW-AT-A-TIME SINGLETON PATTERN

ONE-ROW-AT-A-TIME SINGLETON PATTERN: company_profile and email_server_settings use `singleton_lock TINYINT(1) NOT NULL DEFAULT true UNIQUE CHECK (singleton_lock)`. Two rows are physically impossible; the record can be edited forever and never deleted.

### D16 — 'ONLY ONE X' RULES ARE PARTIAL UNIQUE INDEXES, not application checks

'ONLY ONE X' RULES ARE PARTIAL UNIQUE INDEXES, not application checks: one current financial year, one primary company address, one default bank account, one default tax scheme, one active company-wide work week policy, one active pay cycle, one primary customer contact, one current salary structure per employee, one active sprint per project. Each is `CREATE UNIQUE INDEX ... WHERE <flag>` so a race cannot produce two.

### D17 — WORK WEEK RESOLUTION ORDER (the query every attendance and payroll calculation runs)

WORK WEEK RESOLUTION ORDER (the query every attendance and payroll calculation runs): for an employee on a date, pick the most specific active policy whose effective_from <= date — SPECIFIC_EMPLOYEES, then DESIGNATION, then DEPARTMENT, then EMPLOYMENT_TYPE, then COMPANY_WIDE as the fallback. Then resolve required hours for the day: a dated saturday_overrides row wins outright; else a MANDATORY holiday with mandatory_holiday_overrides_saturday drops required hours to zero; else the Saturday pattern; else weekly-off; else net_working_hours_per_day. An OPTIONAL holiday never overrides — the day stays working and absence draws on leave balance.

### D18 — SCOPE COMPLETENESS

SCOPE COMPLETENESS: all 29 tables named in the brief are returned — 22 for Module 02 Employee and 7 for Module 05 Leave. attendance_records is ONE table serving both Employee 2.2 (Record Attendance) and Payroll 2.4 (Attendance Day Record), not two.

### D19 — THE EXIT GATE IS IN THE DATABASE, NOT THE APPLICATION

THE EXIT GATE IS IN THE DATABASE, NOT THE APPLICATION. exit_checklist_steps carries BOTH an ordinal (1-5) and an explicit gated_by_step_id self-FK, with CHECK ((gated_by_step_id IS NULL) = (ordinal = 1)). The wiring is: step 2 (return_all_assets) gated by step 1 (resignation_acceptance_letter); steps 3, 4 and 5 (final settlement / disable login / mark exited) ALL gated by step 2 — not chained to each other, because the spec permits them in any order once assets are back but none of them before. trg_exit_checklist_steps_enforce_gate refuses status -> 'done' while the gate is unmet, refuses step 1 without a linked_offer_letter_id, refuses step 2 with outstanding_asset_count > 0 (no partial exit), and refuses moving any step backwards out of 'done'. trg_exit_checklist_steps_cascade_unlock flips dependents from 'locked' to 'open'. So the leverage argument in 2.13 is structurally impossible to violate rather than merely discouraged.

### D20 — ATTENDANCE STORES ITS DERIVATION, NOT JUST ITS INPUT

ATTENDANCE STORES ITS DERIVATION, NOT JUST ITS INPUT. attendance_records holds gross_hours, break_hours, net_worked_hours (generated), required_hours, balance_hours (generated), the resolved day_status AND day_type, plus work_week_policy_id + policy_name_snapshot + net_hours_per_day_snapshot + grace_window_minutes_snapshot + half_day_threshold_hours_snapshot. The last three exist so the hour band a day fell into stays explainable after the policy is edited — the difference between 'the system decided' and 'here is the band'. saturday_ordinal, holiday_id and saturday_override_id record why day_type resolved as it did.

### D21 — NOTE ON A GENERATED-COLUMN LIMIT

NOTE ON A GENERATED-COLUMN LIMIT: MySQL, like Postgres, forbids a stored generated column referencing another generated column. attendance_records.balance_hours therefore repeats the (gross - break) expression rather than referencing net_worked_hours, and salary_structures.net_monthly / annual_ctc are trigger-maintained rather than generated (they also depend on trigger-maintained totals that span the statutory-line rows). Every derived column above is flagged as generated, trigger, or view/service.

### D22 — VIEW/SERVICE-LEVEL DERIVATIONS (deliberately not stored)

VIEW/SERVICE-LEVEL DERIVATIONS (deliberately not stored): announcement Active-vs-Expired (depends on CURRENT_DATE, so it can never be immutable); the document queue's 'waiting more than N days'; the approvals queue's 'pending more than N days'; onboarding 'Steps Completed / Oldest Incomplete Step / Days Since Joining'; the exit list's 'Steps Completed / Assets Outstanding'; Payroll 2.4's Monthly Summary rollup of attendance_records; and Leave Reports' Leave Liability headline (sum of Remaining + Carried Forward across active employees).

### D23 — ONLY-ONE RULES, ALL AS PARTIAL UNIQUE INDEXES, NEVER APPLICATION CHECKS

ONLY-ONE RULES, ALL AS PARTIAL UNIQUE INDEXES, NEVER APPLICATION CHECKS: one current salary structure per employee; one primary emergency contact; one primary nominee; one active insurance enrolment per employee+plan; one pending profile change request per employee+field(+head); one open resignation per employee; one acceptance letter per resignation; one current tax scheme election per employee+FY; one catch-all line per declaration; one committed carry-forward run per FY transition; one open compensatory request per shortfall date.

### D24 — btree_gist is NOT AVAILABLE (MySQL); overlap prevention is redesigned

This decision originally required the Postgres `btree_gist` extension for two `EXCLUDE` constraints — salary-structure period overlap and pay-cycle period overlap. **MySQL has neither `EXCLUDE` nor `btree_gist`.** Both rules are now enforced by a `BEFORE INSERT`/`BEFORE UPDATE` trigger that raises `SIGNAL SQLSTATE '45000'`, paired with a service-layer check holding `SELECT ... FOR UPDATE` on the affected rows inside the same transaction. See D0.2 — the pairing is required, not belt-and-braces: the trigger is the correctness backstop that catches bulk imports and manual SQL, the service check is what produces a usable error message.

### D25 — NO TAX IS NAMED ANYWHERE

NO TAX IS NAMED ANYWHERE. There is no PF, ESI, GST, TDS or regime column in any of these 29 tables. Statutory identity is employee_statutory_identifiers (one row per head that needs one, with the head's Employee Identifier Label snapshotted). Statutory pay lines are salary_structure_statutory_lines. Declarations are tax_declaration_lines. Scheme choice is employee_tax_scheme_elections. On a fresh install with no heads configured, all four are simply empty and net_monthly equals gross_monthly — the correct behaviour, not a broken screen.

### D26 — SNAPSHOT DISCIPLINE, applied to the four calculated-tax-line tables in this scope and beyo

SNAPSHOT DISCIPLINE, applied to the four calculated-tax-line tables in this scope and beyond. salary_structure_statutory_lines and tax_declaration_lines each snapshot the head's name, print label, type, rate/cap and computed base at calculation time. The same reasoning drove: leave_requests.paid_type_snapshot (a leave type flipped to Unpaid must not restate an old payslip), leave_balances' quota/carry-forward snapshots, employee_insurance_enrollments' plan snapshots, attendance_records' policy snapshots, compensatory_hour_requests' window/cap/treatment snapshots, and offer_letters' compensation snapshots. offer_letters deliberately references salary_structure_id rather than storing a JSONB copy of the disclosed statutory block — the letter and the later payslip then read the same snapshot rows and cannot disagree.

### D27 — JSONB APPEARS EXACTLY ONCE in this scope

JSONB APPEARS EXACTLY ONCE in this scope: leave_carry_forward_runs.filter_snapshot, which is on the permitted list (report filter snapshots). Nowhere else.

### D28 — FY LOCK applied to the genuinely FY-dated business records

FY LOCK applied to the genuinely FY-dated business records: attendance_records, leave_requests, leave_balances, leave_balance_adjustments, compensatory_hour_requests, tax_declarations, employee_tax_scheme_elections, salary_structures, offer_letters, resignations. Two deliberate exclusions with reasons: (1) employees carries code_financial_year_id for numbering provenance only and is NOT locked — an employee is a party record, and locking FY2026 must not freeze edits to someone hired that year; (2) leave_carry_forward_runs is locked against its TARGET year only, never its source, because the run is the very thing that must complete before the closing year is locked.

### D29 — TABLES OWNED ELSEWHERE that this scope references, all ON DELETE RESTRICT

TABLES OWNED ELSEWHERE that this scope references, all ON DELETE RESTRICT: users, financial_years, document_number_sequences, departments, designations, employment_types, company_addresses (Masters 3.6b — the Work Location / office FK), leave_types, holidays, work_week_policies, work_week_saturday_overrides, tax_heads, tax_schemes, insurance_plans, email_send_log, payslip_adhoc_adjustments (Payroll 2.1a), and the asset-assignment tables that feed exit_checklist_steps.outstanding_asset_count.

### D30 — ONE HANDOFF THE MERGE MUST CLOSE

ONE HANDOFF THE MERGE MUST CLOSE: employees.user_id is the only link to login state. The Account & Login tab's remaining fields — Set Role, Account Status (Enabled/Disabled), Must Change Password on Next Login, Last Login, the password hash and the temporary-password issue timestamp — belong on users (RBAC Module 14), and Extra Permissions belongs to that module's per-person override table logged through permission_change_log. Duplicating account state onto employees would give it two homes and two answers. If the RBAC schema does not carry role_id, is_enabled, must_change_password, last_login_at and temp_password_issued_at, that is a real gap in 2.2 — flagging it rather than silently absorbing those columns here.

### D31 — ONE SPEC INCONSISTENCY WORTH SURFACING, not resolved unilaterally

ONE SPEC INCONSISTENCY WORTH SURFACING, not resolved unilaterally: Masters 3.2 was deliberately trimmed on 2026-07-30 from 35 fields to 13, explicitly removing 'Requires an Employee Identifier + its Label', 'Per-Employee Opt-Out', 'Include in Cost to Company', 'Reduces Taxable Income', 'Requires Proof', 'Maximum Amount per Period' and the location/employment-type restrictions — while Employee 2.2 and 2.14 still require every one of those to render the Statutory Identifiers block, the Applicable toggles, Annual CTC, the declaration caps and the proof requirement. This schema reads them from tax_heads.behaviour (the permitted JSONB) and snapshots them at use, so both documents are satisfiable without re-adding columns to tax_heads. If the Masters owner prefers real columns instead, the snapshot columns here are unaffected — only the source of the copy changes.

### D32 — Two 2

Two 2.2 field-table entries are intentionally not columns, and both are documented on the rows above: 'Confirm Bank Account Number' is a form-only typo safeguard the spec itself says is not stored separately; and 'Reset Password' is a button, not a stored field (its effect lands on users.must_change_password plus an email_send_log row).

### D33 — biometric_enrollment_id is present on employees but nullable and unused

biometric_enrollment_id is present on employees but nullable and unused. 7.1 flags it as a decision deferred until hardware is chosen; adding the column now costs nothing and avoids a migration on a live employees table later, which is the whole point of that section.

### D34 — ENUM TYPES INTRODUCED (37)

ENUM TYPES INTRODUCED (37): asset_status, asset_assignment_action, assignment_source, asset_request_type, asset_request_status, depreciation_method, ticket_priority, ticket_status, ticket_entry_type, activity_type, opportunity_stage, opportunity_won_source, project_status, project_member_role, sprint_status, task_status, bug_status, bug_severity, work_item_priority, work_item_type, milestone_status, timesheet_status, timesheet_non_task_category, cms_module, screen_kind, permission_scope, permission_layer, field_visibility, toggle_kind, override_effect, permission_target_type, permission_change_effect, ui_theme, accent_preset. Enums rather than lookup tables wherever the spec fixes the value set in prose and a new value is a code change anyway; anything Super Admin edits (asset categories, ticket categories, customer status/source, service category) stays a Masters table with an ON DELETE RESTRICT FK.

### D35 — DERIVED FIELDS

DERIVED FIELDS — what was chosen where, per the never-typed rule. GENERATED ALWAYS ... STORED (single-row, immutable expression): tickets.first_response_hours, tickets.resolution_hours, customers.effective_display_name, customers.remitter_account_number_masked, opportunities.is_open. TRIGGER (spans rows): tickets.first_public_reply_at, customers.last_activity_at, opportunities.last_activity_at, projects.last_activity_at, milestones missed-status flip, all *_stamp_* timestamp columns. VIEW / SERVICE (spans tables or depends on the current date): every one listed in the next note.

### D36 — VIEWS REQUIRED (derived across tables

VIEWS REQUIRED (derived across tables — none of these values is ever stored). v_asset_current_value: straight-line depreciation as GREATEST(purchase_value - (purchase_value / useful_life_years * years_elapsed_since_purchase), 0), joined to financial_years for the 'As of' FY, returning NULL (rendered 'Not available') when purchase_value or useful_life_years is missing. It cannot be a generated column because it depends on the current date and on financial_years — this is the module's headline 'never store a depreciated value' rule. v_asset_maintenance_status: Completed / Overdue / Upcoming from next_due_date against today. v_asset_assignment_periods: adds the To Date column via LEAD(effective_date) OVER (PARTITION BY asset_id ORDER BY effective_date, performed_at). v_customer_financial_summary: Total Invoiced / Received / Outstanding for the Customer 360 persistent header and the Directory columns. v_milestone_progress: the '3/5 tasks done' rollup. v_timesheet_entry_sprint: sprint attribution for the Team Timesheet's Sprint filter, resolved through the task (non-task categories correctly return null). v_project_report_counts: tasks by status, bugs by severity, bugs by status — counts only, no charts, no trends, matching the decision that was narrowed rather than reversed. v_effective_permissions: the resolver that composes role_permissions + role_permission_actions + role_permission_fields + active user_permission_overrides into one answer per (user, screen, layer) — the override wins on any of the four layers.

### D37 — asset_assignment_history's To Date is DELIBERATELY NOT STORED, and this is the one place w

asset_assignment_history's To Date is DELIBERATELY NOT STORED, and this is the one place where a spec column has no column. The instructions make that table append-only, while the spec says To Date is 'filled in automatically when that assignment ends' — a later UPDATE. Storing it would require breaking immutability on the exact log that exists to be unbreakable. Resolution: store effective_date only and derive To Date in v_asset_assignment_periods with LEAD(). The history tab renders identically; the log stays genuinely append-only. Flagging this as the intended deviation rather than burying it.

### D38 — tasks and bugs use SOFT DELETE (is_active + deleted_at + deleted_by) even though the spec 

tasks and bugs use SOFT DELETE (is_active + deleted_at + deleted_by) even though the spec gives Manager and Super Admin a real Delete button with a confirm prompt. A hard delete would have to cascade into work_item_comments, which is on the immutable list — an append-only log cannot be destroyed by deleting its parent. Soft delete keeps both rules true: the Delete action behaves exactly as documented from the user's side, and the comment thread survives. Same reasoning drives project_members and labels being tier 1 with reference guards.

### D39 — tasks

tasks.assignee_employee_id and bugs.assignee_employee_id are NULLABLE, against the 2.4 Fields Table which marks Task Assignee required. The same module documents an 'Unassigned only' toggle on both the Task Board and the Bugs tracker; a NOT NULL column makes that filter permanently return nothing. Nullable column, required-in-the-form. Worth confirming which of the two the spec actually meant.

### D40 — FINANCIAL-YEAR LOCK applies to exactly ten tables in this scope

FINANCIAL-YEAR LOCK applies to exactly ten tables in this scope: assets, asset_maintenance_logs, asset_requests, tickets, customers, opportunities, projects, tasks, bugs, timesheet_entries — each with its own named trigger calling the shared fn_reject_if_fy_locked(). Child tables (attachments, activities, files, contacts, sprints, sub_tasks, comments, milestones, milestone_tasks, project_members, task_label_links) carry no financial_year_id: they are not themselves FY-dated business records and are reached through a parent that is. One consequence to accept knowingly: tasks and bugs carry the lock because they need document_number_sequences codes (which are keyed by FY), so locking an old financial year freezes editing on that year's boards. That is correct for a closed year, but it is a real operational effect and not an accident.

### D41 — DOCUMENT NUMBERING

DOCUMENT NUMBERING — six code types in this scope, all allocated from document_number_sequences keyed by (code_type, financial_year_id) with SELECT ... FOR UPDATE inside the creating transaction, never a Postgres SEQUENCE, and always stored as the FULL rendered code on the record: asset_code (assets.asset_tag, AST-2026-0001), ticket_number (tickets.ticket_number, TKT-2026-0001), customer_code (customers.customer_code, CUST-2026-0001), opportunity_code (opportunities.opportunity_code, OPP-2026-0001), project_code (projects.project_code, PRJ-2026-0001), plus two the specs imply without naming a prefix — task_number and bug_number, needed because the Task Board searches 'Task ID' and the Bugs tracker searches 'Bug ID'. Those two need prefix entries added to Company Profile's Number Prefixes table (Masters 3.6e); everything else is already set up there. The orphaned Quotation Number entry stays unused in Masters — nothing in this scope generates one, by design, since Quote was removed on 2026-07-30.

### D42 — NO TAX COLUMNS EXIST ANYWHERE IN THIS SCOPE, and none should

NO TAX COLUMNS EXIST ANYWHERE IN THIS SCOPE, and none should. Assets, tickets, customers, opportunities, projects and their children carry no tax head, no rate, no GST/TDS/PF/ESI/regime column, and no calculated tax lines — the snapshot-at-calculation rule applies to invoice_tax_lines, purchase_bill_tax_lines, payslip_statutory_lines and salary_structure_statutory_lines, all of which sit in another agent's scope. Opportunity used to read Masters → Taxes through its Quote tab; that dependency died with the Quote removal and was not reintroduced.

### D43 — JSONB APPEARS EXACTLY TWICE, both sanctioned

JSONB APPEARS EXACTLY TWICE, both sanctioned: permission_change_log.before_value and permission_change_log.after_value. Everywhere a JSONB blob would have been tempting it was resolved with typed columns instead — feature_toggles' parameters became threshold_amount DECIMAL(14,2) and threshold_days DECIMAL(5,2) rather than a config blob, and screen_sensitive_fields' masking became supports_mask + mask_pattern rather than a rules object.

### D44 — RBAC

RBAC — THE FOUR LAYERS ARE FOUR REAL TABLES, not four columns and not four flags. L1 screen visibility = role_permissions.is_visible. L2 per-action = role_permission_actions, one row per (role, screen, action), with the action vocabulary itself a real catalog (screen_actions) populated per screen from that screen's own module doc, never a generic CRUD list. L3 per-field show/mask/hide = role_permission_fields over the screen_sensitive_fields catalog, three-valued because masking is a distinct answer from hiding. L4 data scope all/team/own = role_permissions.data_scope, nullable so screens with no meaningful scope dimension show no control. All four are per (role, screen) through the role_permissions spine. user_permission_overrides sits above all four and can flip any one of them for one person, enforced by four partial unique indexes (one per layer) so a person can never hold two conflicting active overrides on the same target.

### D45 — THE 47 TOGGLES

THE 47 TOGGLES. Section 2.1 counts 46 module toggles; the 47th is 'Give HR Read-Only Access to the Permission Matrix' from Section 8, which is a real toggle even though it lives outside the compiled table. All 47 seed into feature_toggles, including the retired 'Show Salary Amount to Manager' row (is_retired = true, kept so a future team-level pay view reuses the name rather than minting a near-duplicate). Three ship ON: 'Require Manager Acknowledgment Before HR Processes Exit', 'Notify Employee When a Payslip Is Reissued', and — expressed as an OFF toggle with an ON-by-default effect — 'Hide Budget from Employee's Project View'. Renames must change toggle_name and never toggle_key: 'Allow Accountant to Edit Statutory Rates in Masters' → 'Allow Accountant to Manage Taxes' was the same toggle re-scoped, which is exactly why the key is separate from the label.

### D46 — user_appearance_settings is modelled as PERSISTED per user account, while RBAC 2

user_appearance_settings is modelled as PERSISTED per user account, while RBAC 2.3 says all three controls are 'held in memory for the session only and nothing is written to browser storage'. Those are not in conflict: the same section argues the setting must belong to the user account precisely so a shared workstation or a fresh browser opens at the right scale, and the session-only rule is about browser storage in the prototype. The table is the account-level home; a prototype build can simply not read it. Flagging in case the intent was genuinely no server-side persistence at all, in which case this table is seeded-empty rather than dropped, since the schema still needs somewhere for the documented default of 110%.

### D47 — CROSS-SCOPE FKs THIS SCHEMA DEPENDS ON, all ON DELETE RESTRICT and all owned by other agen

CROSS-SCOPE FKs THIS SCHEMA DEPENDS ON, all ON DELETE RESTRICT and all owned by other agents: users, employees, roles, financial_years, document_number_sequences, vendors, purchase_bills, bank_accounts, company_addresses, departments, asset_categories (Masters 3.17), ticket_categories (3.14), customer_statuses (3.15), customer_sources (3.16), service_categories (3.12). The roles table in particular is load-bearing here — role_permissions, feature_toggles.affected_role_id and permission_change_log.target_role_id all point at it, and the Role Directory's 'built for a 6th role' requirement is satisfied by it being a table rather than an enum.

### D48 — 'ONLY ONE X' RULES, ALL AS PARTIAL UNIQUE INDEXES, never application checks

'ONLY ONE X' RULES, ALL AS PARTIAL UNIQUE INDEXES, never application checks: one primary contact per customer; one primary photo per asset; one active sprint per project; one Project Lead per project; one first Public Reply per ticket; one active override per (user, screen) for visibility and for scope, and per (user, action) and (user, field); unique serial number only where one is provided. Two 'only one' rules are plain UNIQUE rather than partial because the rule is total: one role_permissions row per (role, screen), and one appearance-settings row per user.

### D49 — FILTER & EXPORT CONVENTION SUPPORT

FILTER & EXPORT CONVENTION SUPPORT. Every filter documented across the six modules has a column and an index behind it, including the ones that only exist as toggles: 'expiring in 90 days' (ix_assets_warranty_expiry), 'Overdue only' and 'Unassigned only' on tickets, tasks and bugs, 'overdue — past expected close, still open' and 'stale — no activity in N days' on opportunities, 'past End Date, not Completed' and 'no activity in N days' on projects, 'current sprint only', 'past Target Date, not Reached' on milestones, and 'submitted more than N days ago, still unapproved' on timesheets. The convention's exception (b)(2) — a filter disappearing with the field it filters on — is encoded as data in screen_sensitive_fields.hides_dependent_filter rather than left to each screen's implementation, so the Asset Directory's Purchase Value range filter follows its column automatically.

### D50 — TWO SPEC CONTRADICTIONS RESOLVED IN FAVOUR OF THE FEATURE, both flagged above rather than 

TWO SPEC CONTRADICTIONS RESOLVED IN FAVOUR OF THE FEATURE, both flagged above rather than silently decided: the required-Assignee vs. Unassigned-filter conflict on tasks, and the append-only vs. To-Date conflict on asset_assignment_history. A third was resolved in favour of the rule: Transfer is modelled purely as an administrative action written straight to asset_assignment_history, with no request row — asset_requests carries only repair, damage_report and return, matching Screen 2.6 exactly and Section 6.4's explicit resolution. If a 'request a transfer' flow is ever wanted it is a new enum value plus a workflow, not a schema restructure.

### D51 — AUDIT MIXIN assumed present on all 25 tables and not restated

AUDIT MIXIN assumed present on all 25 tables and not restated: id CHAR(36) PK (UUID generated in the application layer); created_at / updated_at DATETIME(6) NOT NULL DEFAULT now(); created_by / updated_by uuid REFERENCES users(id). The updated_at touch trigger is likewise assumed and not listed per table.

### D52 — DERIVED-FIELD CHOICES, as required

DERIVED-FIELD CHOICES, as required. GENERATED ALWAYS ... STORED (single-row, immutable): period_label on payroll_runs and payslips (month-name ARRAY subscript, since to_char is not immutable); working_days_effective; paid_days; credited_hours / balance_hours / hours_short / net_short_hours / required_hours on monthly_hour_reconciliations; total_deductions and net_pay on payroll_run_employees; has_unpaid_leave; signed_amount; net_pay_delta; line_total on both line-item tables; grand_total and balance_due on invoices; total_amount and balance_due on purchase_bills; is_locked on invoices; has_receipt / has_bill_attached / has_attachment; has_bank_details and bank_account_number_masked on vendors; is_manual_override on purchase_bill_tax_lines. TRIGGER (spans rows): every rollup total (subtotal, tax_amount, amount_paid, credit_note_total, employee_count, reissue_count, has_adhoc_adjustments, times_applied, vendor usage counters, effective_bank_account_id). VIEW/SERVICE (spans tables or depends on now()): invoice and purchase-bill overdue flags and ageing buckets (Current / 1-30 / 31-60 / 61-90 / 90+), the Invoice Dashboard widgets, the expense Summary-by-type and by-month figures, the bank-statement Export Statement running balance, and Vendor Usage itself (a UNION over purchase_bills + expense_claims + company_expenses, never a table).

### D53 — GENERATED-COLUMN CONSTRAINT

MySQL (like Postgres) forbids a generated column referencing another generated column, so invoices.balance_due and purchase_bills.balance_due are each recomputed from base columns rather than from grand_total / total_amount. Same reason balance_hours and net_short_hours on monthly_hour_reconciliations restate the required-hours expression.

### D54 — 'ONLY ONE X' RULES AS PARTIAL UNIQUE INDEXES, never application checks

'ONLY ONE X' RULES AS PARTIAL UNIQUE INDEXES, never application checks: ux_prempl_one_processed_per_employee_period (the already-processed skip is per employee+period, so a Draft never blocks and a late joiner can still be run); ux_expreimb_one_live_per_claim (one live reimbursement per claim); ux_compexp_recurring_period (one standing bill per type+vendor+month); ux_expclaims_linked_bill and ux_pbills_linked_claim (the expense<->purchase-bill link is one-to-one in both directions); ux_payslips_employee_period; ux_credit_notes / ux_invoices / ux_pbills number uniqueness.

### D55 — THE PAY-PERIOD REQUIREMENT, satisfied structurally

THE PAY-PERIOD REQUIREMENT, satisfied structurally: payslips and payroll_runs both carry pay_period_start, pay_period_end and salary_credit_date as NOT NULL, plus a snapshot of the four Pay Cycle fields that produced them. period_month/period_year exist ONLY as display labels and are explicitly not the basis of any date comparison — the 3.1b cutoff rule (an event dated after pay_period_end belongs to the NEXT period) is a pure date comparison against these columns, so a leave day on 27-07-2026 lands on the August payslip with nobody moving it by hand.

### D56 — THE INVOICE LOCK, modelled exactly

THE INVOICE LOCK, modelled exactly: is_locked is GENERATED ALWAYS AS (status = 'paid') STORED, and trg_invoices_lock_guard rejects any UPDATE touching a user-facing column once it is true, plus all DELETEs. Only the trigger-maintained rollups may still move (so an approved credit note can reduce effective outstanding without reopening the invoice). Child tables carry fn_reject_if_parent_invoice_locked(). Purchase Bill deliberately does NOT mirror this by default — its lock is conditional on the 'Lock Purchase Bill Once Fully Paid' flag, so is_locked there is a real column set by trigger, not a generated one.

### D57 — TAX ENGINE COMPLIANCE

TAX ENGINE COMPLIANCE: no PF/ESI/GST/TDS/regime column exists anywhere in these 25 tables. The four calculated-tax-line tables (invoice_tax_lines, purchase_bill_tax_lines, payslip_statutory_lines, salary_structure_statutory_lines — the last owned by the Employee module) each snapshot head name, print label, scope, method, rate/fixed amount and computed base, so a historical document reproduces after the head is edited or retired. cgst_rate_snapshot / sgst_rate_snapshot are snapshots of whatever shape the configured head happens to have (Masters offers those tax TYPES), not columns naming a tax this schema knows about. purchase_bill_tax_lines.tax_head_id is deliberately nullable — a directly-typed Tax Amount must be recordable before any head exists.

### D58 — JSONB IS USED NOWHERE IN THIS SCOPE

JSONB IS USED NOWHERE IN THIS SCOPE. Slab working, split-component detail, override reasons and reissue line diffs are all plain TEXT columns (calculation_note, line_change_summary) rather than JSON escape hatches, per the restriction.

### D59 — EXPENSE CLAIM_TYPE ROUTING

EXPENSE CLAIM_TYPE ROUTING: expense_claims.claim_type is snapshotted from expense_types.claim_type by trg_expclaims_snapshot_claim_type, never chosen separately by the submitter. A Company-Paid claim is routed by trigger into company_expenses (linked one-way via company_expenses.source_expense_claim_id, to avoid a circular FK) and never enters the reimbursement queue. Changing a type's Claim Type in Masters is non-retroactive by construction, because the value is snapshotted on the row.

### D60 — VENDOR BANKING

VENDOR BANKING: bank_account_name is the primary column and appears first everywhere (directory, Vendor Usage 'Paid Into', purchase_bill_payments snapshot); bank_account_number is stored raw but every list-facing read uses the generated bank_account_number_masked ('HDFC Bank ••••2201'), so a full account number never reaches a list screen or an export. purchase_bill_payments snapshots all four vendor bank fields at payment time so a historic payment still shows where it went after the vendor changes details.

### D61 — FK POLICY HELD THROUGHOUT

FK POLICY HELD THROUGHOUT: every FK into a master (tax_heads, expense_types, payment_modes, bank_accounts, hsn_sac_codes, service_categories, work_week_policies, financial_years, vendors, customers, departments, employment_types, tax_schemes, users) is ON DELETE RESTRICT. ON DELETE CASCADE appears only on genuine parent-child document lines (invoice_line_items, invoice_tax_lines, credit_note_line_items, purchase_bill_line_items, purchase_bill_tax_lines, payslip_*_lines, adhoc_adjustment_employees), which are tier-3 deletable while the parent is unlocked.

### D62 — SOFT-DELETE TIERS

SOFT-DELETE TIERS: Tier 1 (is_active + reference guard) — vendors only, guarded by has_usage_history and fn_vendor_reject_delete_when_used(). Tier 2 (status-driven, no deletion) — payroll_runs, payroll_run_employees, payslips, adhoc_payslip_adjustments, adhoc_adjustment_employees, salary_certificate_requests, monthly_hour_reconciliations, invoices, invoice_payments, credit_notes, expense_claims, expense_reimbursements, company_expenses, purchase_bills, purchase_bill_payments. Tier 3 (real DELETE while unreferenced) — the seven document line-item / tax-line tables, while their parent is unlocked.

### D63 — IMMUTABLE LOG in this scope

IMMUTABLE LOG in this scope: payslip_reissues only, enforced by trg_payslip_reissues_append_only -> fn_reject_update_delete(). Its reissue_number is allocated with SELECT ... FOR UPDATE on the parent payslip, the same pattern as document numbering.

### D64 — DOCUMENT NUMBERING

DOCUMENT NUMBERING: three code types are allocated here from document_number_sequences keyed by (code_type, financial_year_id) with SELECT ... FOR UPDATE inside the creating transaction — 'invoice' (INV-<FY>-00001, 5 digits), 'credit_note' (CN-<FY>-0001, 4 digits), 'purchase_bill' (PB-<FY>-0001, 4 digits). Each stores the FULL rendered code on the record. Payslips and expense claims deliberately have NO code: the spec states an expense is never shared outside the company and defines no payslip numbering convention.

### D65 — EXTENSION ASSUMED

EXTENSION ASSUMED: pg_trgm, for the GIN search indexes backing the free-TEXT searches the specs call out by name — most importantly the ad-hoc adjustment Label search, which is the only way to answer 'find every laptop advance recovery still running'.

### D66 — INFERRED CONSTRAINT WORTH FLAGGING AT GROOMING

INFERRED CONSTRAINT WORTH FLAGGING AT GROOMING: ux_pbills_vendor_bill_number (one vendor bill number per vendor) is not stated in the spec. It is a real data-integrity guard against recording the same supplier bill twice, but it will reject a vendor who legitimately reuses numbering across years — drop it to a plain index if that turns out to happen.

### D67 — OUT-OF-SCOPE DEPENDENCIES REFERENCED BY FK, owned by other modules

OUT-OF-SCOPE DEPENDENCIES REFERENCED BY FK, owned by other modules: users, employees, salary_structures, appointment_letters, appointment_letter_custom_terms, attendance_records, compensatory_requests, customers, opportunities, projects, financial_years, document_number_sequences, tax_heads, tax_schemes, tax_relief_rules, expense_types, payment_modes, bank_accounts, hsn_sac_codes, service_categories, departments, employment_types, work_week_policies, email_send_log.

### D68 — ONE SPEC CONFLICT RESOLVED, flagged rather than silently decided

ONE SPEC CONFLICT RESOLVED, flagged rather than silently decided: Invoice 2.3 says Bank Account 'stays editable including after the invoice is raised', while the lock statement says every field becomes read-only at Paid. The lock is stated more absolutely ('stated exactly'), so trg_invoices_lock_guard freezes bank_account_id too once Paid. If the intent was that the account alone stays editable post-lock, that trigger is the single place to relax it.

### D69 — ONE ACKNOWLEDGED GAP, carried forward from the specs rather than invented around

ONE ACKNOWLEDGED GAP, carried forward from the specs rather than invented around: purchase_bills has no withholding/deduction-at-source field. Masters removed that scope on 2026-07-30 and Purchase Bill 5 flags it as needing a field only if the company actually withholds from supplier payments. Adding it later means a deduction line reducing the payable amount, distinct from tax_amount which increases it — it would be a new purchase_bill_deduction_lines table plus a withheld_amount rollup, not a column bolted onto tax_amount.

---

## Table inventory

| Module | Tables |
|---|---|
| Platform | `users`, `stored_files`, `indian_states`, `document_number_sequences` |
| 14 RBAC | `roles`, `screens`, `screen_actions`, `screen_sensitive_fields`, `role_permissions`, `role_permission_actions`, `role_permission_fields`, `feature_toggles`, `user_permission_overrides`, `permission_change_log`, `user_appearance_settings` |
| 01 Masters | `number_prefix_rules`, `financial_years`, `tax_heads`, `tax_head_slab_bands`, `tax_head_split_components`, `tax_head_relief_rules`, `tax_schemes`, `expense_types`, `leave_types`, `holidays`, `company_profile`, `company_addresses`, `company_documents`, `bank_accounts`, `payment_modes`, `departments`, `designations`, `hsn_sac_codes`, `service_categories`, `units_of_measure`, `ticket_categories`, `customer_statuses`, `customer_sources`, `asset_categories`, `employment_types`, `insurance_plans`, `work_week_policies`, `work_week_policy_employees`, `saturday_overrides`, `pay_cycles`, `pay_periods`, `email_server_settings`, `email_templates`, `email_send_log` |
| 02-employee | `employees`, `employee_statutory_identifiers`, `employee_emergency_contacts`, `salary_structures`, `salary_structure_statutory_lines`, `employee_insurance_enrollments`, `insurance_dependents`, `insurance_nominees`, `employee_documents`, `profile_change_requests`, `attendance_records`, `announcements`, `announcement_targets`, `notifications`, `resignations`, `exit_checklist_steps`, `onboarding_checklist_items`, `employee_tax_scheme_elections`, `tax_declarations`, `tax_declaration_lines`, `tax_declaration_line_proofs`, `offer_letters`, `offer_letter_custom_terms` |
| 05-leave | `leave_requests`, `leave_balances`, `leave_balance_adjustments`, `leave_carry_forward_runs`, `leave_carry_forward_lines`, `compensatory_hour_requests` |
| 03 Asset Management | `assets`, `asset_attachments`, `asset_assignment_history`, `asset_maintenance_logs`, `asset_requests` |
| 04 Ticket | `tickets`, `ticket_conversation_entries`, `ticket_assignment_history` |
| 08 Customer | `customers`, `customer_contacts`, `customer_activities`, `customer_files` |
| 09 Opportunity | `opportunities`, `opportunity_activities`, `opportunity_files` |
| 10 Project | `projects`, `project_members`, `sprints`, `tasks`, `labels`, `task_label_links`, `sub_tasks`, `bugs`, `work_item_comments`, `milestones`, `milestone_tasks`, `timesheet_entries` |
| 06 Payroll | `payroll_runs`, `payroll_run_employees`, `payslips`, `payslip_earning_lines`, `payslip_statutory_lines`, `payslip_adjustment_lines`, `adhoc_payslip_adjustments`, `adhoc_adjustment_employees`, `payslip_reissues`, `salary_certificate_requests`, `monthly_hour_reconciliations` |
| 11 Invoice | `invoices`, `invoice_line_items`, `invoice_tax_lines`, `invoice_payments`, `credit_notes`, `credit_note_line_items` |
| 12 Expense | `expense_claims`, `expense_reimbursements`, `company_expenses` |
| 07 Vendor | `vendors` |
| 13 Purchase Bill | `purchase_bills`, `purchase_bill_line_items`, `purchase_bill_tax_lines`, `purchase_bill_payments` |

---

## Tables

### `users`  _(Platform)_

Login identity. Separate from employees so the bootstrap Super Admin and system/service accounts exist without an employee record, and so created_by/updated_by everywhere has one stable target.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK DEFAULT application-generated UUID |  |
| `employee_id` | CHAR(36) | FK employees(id), UNIQUE, NULL | Only FK direction between users and employees; employees has no user_id. |
| `email` | citext | NOT NULL UNIQUE | Login Email; mirrors employees.email, kept in sync by trigger. No separate username field. |
| `password_hash` | TEXT | NOT NULL |  |
| `role_id` | CHAR(36) | NOT NULL FK roles(id) |  |
| `is_enabled` | TINYINT(1) | NOT NULL DEFAULT true | Account Status (Enabled/Disabled). Set false on exit step 4. |
| `must_change_password` | TINYINT(1) | NOT NULL DEFAULT true | Set true on create-login and on Reset Password; flipped false on successful change. |
| `password_set_at` | DATETIME(6) | NULL |  |
| `last_login_at` | DATETIME(6) | NULL |  |
| `failed_login_count` | smallint | NOT NULL DEFAULT 0 |  |
| `locked_until` | DATETIME(6) | NULL |  |

**Indexes**
- UNIQUE (email)
- idx_users_role_id (role_id)
- idx_users_employee_id (employee_id)

### `roles`  _(14 RBAC)_

The fixed set of five roles. People Count and Override Count are derived, never stored.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `code` | VARCHAR(191) | NOT NULL UNIQUE CHECK (code IN ('SUPER_ADMIN','EMPLOYEE','MANAGER','ACCOUNTANT','HR')) |  |
| `name` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `description` | TEXT | NULL |  |
| `is_system` | TINYINT(1) | NOT NULL DEFAULT true | All five are system roles; no delete path. |

**Indexes**
- UNIQUE (code)

### `stored_files`  _(Platform)_

Single physical registry for every uploaded file across all modules; domain tables FK into it instead of storing blob metadata themselves.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `storage_key` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `original_file_name` | TEXT | NOT NULL |  |
| `mime_type` | TEXT | NOT NULL |  |
| `size_bytes` | BIGINT | NOT NULL CHECK (size_bytes > 0) |  |
| `checksum_sha256` | char(64) | NULL |  |
| `uploaded_by` | CHAR(36) | NOT NULL FK users(id) |  |
| `uploaded_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- UNIQUE (storage_key)
- idx_stored_files_uploaded_by (uploaded_by, uploaded_at DESC)

### `indian_states`  _(Platform)_

Reference list of Indian states/UTs backing every State dropdown (company addresses, vendor, customer).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `code` | VARCHAR(191) | NOT NULL UNIQUE | e.g. TN, KA, DL |
| `name` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `is_union_territory` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `gst_state_code` | char(2) | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (code)

### `number_prefix_rules`  _(01 Masters)_

Masters 3.6e. One fixed row per code type (INV, PB, CUST, AST, TKT, EMP, PRJ, OPP, CN, EXP...). Governs format only; issuance state lives in document_number_sequences.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `code_type` | VARCHAR(191) | NOT NULL UNIQUE CHECK (code_type IN ('INV','PB','CUST','AST','TKT','EMP','PRJ','OPP','CN','EXP','CMP','TSK','BUG')) |  |
| `label` | TEXT | NOT NULL |  |
| `prefix` | TEXT | NOT NULL CHECK (prefix ~ '^[A-Z]{2,6}$') |  |
| `include_fy_in_code` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `running_number_digits` | smallint | NOT NULL CHECK (running_number_digits BETWEEN 3 AND 6) |  |
| `starting_number` | INT | NOT NULL CHECK (starting_number >= 0) |  |
| `resets_every_fy` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `starting_number_locked` | TINYINT(1) | NOT NULL DEFAULT false | Flipped true by trigger on first allocation; a BEFORE UPDATE trigger then rejects any change to starting_number. |
| `first_generated_at` | DATETIME(6) | NULL |  |
| `generated_count` | INT | NOT NULL DEFAULT 0 | Feeds the 'this will affect N existing records' confirmation pop-up. |

**Indexes**
- UNIQUE (code_type)

### `document_number_sequences`  _(Platform)_

Concurrency-safe running-number allocator, keyed by code type + financial year. One row per (code_type, FY); non-FY-scoped types use a single NULL-FY row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `code_type` | TEXT | NOT NULL FK number_prefix_rules(code_type) ON UPDATE CASCADE |  |
| `financial_year_id` | CHAR(36) | NULL FK financial_years(id) |  |
| `next_number` | INT | NOT NULL | Seeded from number_prefix_rules.starting_number when the row is first created. |
| `last_issued_number` | INT | NULL |  |
| `last_issued_at` | DATETIME(6) | NULL |  |
| `prefix_snapshot` | TEXT | NULL | Prefix in force at last issue; documents keep their own rendered code so history is never rewritten. |

**Indexes**
- UNIQUE NULLS NOT DISTINCT (code_type, financial_year_id)

### `financial_years`  _(01 Masters)_

Masters 3.1. The spine of the whole system: every dated record resolves to one, and locking one freezes everything inside it.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `label` | VARCHAR(191) | NOT NULL UNIQUE | Derived as the calendar year the FY starts in ('2026'); trigger-maintained, never typed. |
| `start_date` | DATE | NOT NULL UNIQUE CHECK (EXTRACT(MONTH FROM start_date)=4 AND EXTRACT(DAY FROM start_date)=1) |  |
| `end_date` | DATE | NOT NULL GENERATED ALWAYS AS (((start_date + INTERVAL '1 year')::date - 1)) STORED | 31 March of the following year; not independently editable. |
| `status` | TEXT | NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED')) | One-way. Trigger rejects LOCKED -> OPEN. No unlock exists. |
| `is_current` | TINYINT(1) | NOT NULL DEFAULT false | System-managed from today's date by a scheduled job; never typed. |
| `locked_by` | CHAR(36) | NULL FK users(id) |  |
| `locked_on` | DATETIME(6) | NULL |  |
| `reference_count` | INT | NOT NULL DEFAULT 0 | Incremented by the FY-reference trigger; Delete is permitted only while this is 0. |

**Indexes**
- UNIQUE (label)
- **No MySQL equivalent (see D0.2)** — enforced by a BEFORE INSERT/UPDATE trigger plus a service-layer check in the same transaction
- UNIQUE (is_current) WHERE is_current -- only one current FY
- idx_fy_dates (start_date, end_date)

### `tax_heads`  _(01 Masters)_

Masters 3.2a. The entire tax engine. Models the SHAPE of a tax; names no tax. Every tax-bearing document and payslip line points here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `tax_name` | TEXT | NOT NULL |  |
| `short_code` | TEXT | NULL |  |
| `scope` | TEXT | NOT NULL CHECK (scope IN ('SALES_BILLING','PURCHASE','SALES_AND_PURCHASE','PAYROLL_EMPLOYEE_DEDUCTION','PAYROLL_EMPLOYER_CONTRIBUTION','PAYROLL_INCOME_TAX','EMPLOYEE_DECLARATION','WITHHOLDING_AT_SOURCE')) | Fixed list of **eight** attachment points (2026-07-31). `WITHHOLDING_AT_SOURCE` is one scope, not three — direction is `withholding_direction` below |
| `tax_type` | TEXT | NOT NULL CHECK (tax_type IN ('GST_IGST','GST_CGST_SGST','PERCENTAGE','FIXED_AMOUNT','SLAB','DECLARATION_CAP')) |  |
| `applies_from` | DATE | NOT NULL |  |
| `applies_until` | DATE | NULL CHECK (applies_until IS NULL OR applies_until >= applies_from) | Blank = still in force. Setting it retires the head forward only. |
| `rate_pct` | DECIMAL(7,4) | NULL CHECK (rate_pct IS NULL OR rate_pct >= 0) |  |
| `cgst_rate_pct` | DECIMAL(7,4) | NULL |  |
| `sgst_rate_pct` | DECIMAL(7,4) | NULL |  |
| `fixed_amount` | DECIMAL(14,2) | NULL |  |
| `declaration_cap` | DECIMAL(14,2) | NULL |  |
| `slab_application` | TEXT | NULL CHECK (slab_application IN ('PROGRESSIVE','FLAT_BY_BAND')) |  |
| `tax_scheme_id` | CHAR(36) | NULL FK tax_schemes(id) | Only meaningful on payroll/declaration scopes; NULL when no schemes exist at all. |
| `print_label` | TEXT | NULL | Resolved at render time as COALESCE(print_label, tax_name). |
| `notes` | TEXT | NULL | Absorbs registration number / accounting code detail per the 2026-07-30 field trim. |
| `behaviour` | JSON | NOT NULL DEFAULT '{}'::JSON | Open-ended head behaviour deliberately trimmed out of the form but needed by the engine: include_in_ctc, show_on_payslip, borne_by, max_amount_per_period, applicable_location_ids, applicable_employment_type_ids, requires_employee_identifier + label. Adding one back is a data change, not a migration. |
| `creates_onward_liability` | TINYINT(1) | NOT NULL DEFAULT false | **Added 2026-07-31 (C4). THE GATE, and it is valid on EVERY scope — not just the withholding one.** True means the amount this head calculates is money the company holds on somebody elses behalf and owes a third party. It is what puts a head into the Module 15 register, and it is how a PAYROLL head (PF, professional tax, salary TDS) joins the same register as a supplier withholding **without duplicating any machinery**. If no row anywhere has this true, the entire Tax & Compliance module is hidden |
| `remitted_to_authority` | TEXT | | Revealed by the gate. Free TEXT — who this is actually paid to. Groups the register and prints on the remittance. A label, never arithmetic, so it stays editable after the head locks |
| `remittance_period` | TEXT | CHECK (remittance_period IS NULL OR remittance_period IN ('PER_DOCUMENT','MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL')) | Required when the gate is true |
| `period_aligns_to` | TEXT | CHECK (period_aligns_to IS NULL OR period_aligns_to IN ('CALENDAR','FINANCIAL_YEAR','PAY_CYCLE')) | Required when the gate is true. **`PAY_CYCLE` reads Masters 3.20c (26th-25th by default)** and is the only correct choice for a payroll head — a payroll obligation period aligned to calendar months would disagree with the payslips that produced it |
| `deposit_due_days_after_period_end` | INT | CHECK (deposit_due_days_after_period_end IS NULL OR deposit_due_days_after_period_end >= 0) | Days, not a fixed calendar day, so it survives short months without a second rule. Drives due date, Due Soon badge and Overdue state |
| `liability_arises_on` | TEXT | CHECK (liability_arises_on IS NULL OR liability_arises_on IN ('SOURCE_DOCUMENT_DATE','PAYMENT_DATE')) | Which date decides an amounts period. **Must match how the authority keys the period.** Locked by trigger once the first remittance exists under this head |
| `authority_reference_label` | TEXT | | What this authority calls its receipt reference. Renders the label on Record Remittance — **this is why no jurisdictions paperwork vocabulary is hardcoded anywhere** |
| *(withholding_direction)* | **moved to `tax_head_withholding_directions`** | CHECK (withholding_direction IS NULL OR withholding_direction <@ ARRAY['ON_PAYMENTS_MADE','ON_PAYMENTS_RECEIVED']) | Withholding scope only; at least one element. Decides whether the head appears in Purchase Bill, in Invoice Record Payment, or both. **An array on one head rather than separate scopes**, because one statutory provision usually governs both directions |
| `default_calculated_on` | TEXT | CHECK (default_calculated_on IS NULL OR default_calculated_on IN ('SUBTOTAL','TOTAL')) | Withholding scope only. Pre-selects the base wherever the head is applied |
| `certificate_expected` | TINYINT(1) | NOT NULL DEFAULT false | Shown when direction includes ON_PAYMENTS_RECEIVED. Drives the certificate chase queue; when false a receipt reads *Not Expected* rather than *Awaiting* |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Never hard-deleted once used. |
| `is_arithmetic_locked` | TINYINT(1) | NOT NULL DEFAULT false | Set true on first use in any calculation; trigger then rejects changes to rates, amounts, caps, slab bands and split shares for everyone including Super Admin. |
| `first_used_at` | DATETIME(6) | NULL |  |
| `usage_count` | INT | NOT NULL DEFAULT 0 |  |
| `supersedes_tax_head_id` | CHAR(36) | NULL FK tax_heads(id) | Set when created via Duplicate for a rate change, so the version chain is traceable. |

**Indexes**
- UNIQUE (scope, lower(tax_name)) -- unique within a scope, not globally
- idx_tax_heads_inforce (scope, is_active, applies_from, applies_until)
- MySQL has no GIN. To index inside `behaviour` JSON, add a STORED generated column extracting the specific key that needs searching (`JSON_UNQUOTE(JSON_EXTRACT(behaviour, '$.key'))`) and index that. Do not index the whole document
- CHECK (tax_type <> 'GST_IGST' OR rate_pct IS NOT NULL)
- CHECK (tax_type <> 'PERCENTAGE' OR rate_pct IS NOT NULL)
- CHECK (tax_type <> 'GST_CGST_SGST' OR (cgst_rate_pct IS NOT NULL AND sgst_rate_pct = cgst_rate_pct))
- CHECK (tax_type <> 'FIXED_AMOUNT' OR fixed_amount IS NOT NULL)
- CHECK (tax_type <> 'DECLARATION_CAP' OR declaration_cap IS NOT NULL)
- CHECK (tax_type <> 'SLAB' OR slab_application IS NOT NULL)

**CHECK (gate completeness):** when `creates_onward_liability` is true, `remittance_period`, `period_aligns_to`
and `deposit_due_days_after_period_end` must all be non-null. A head that claims an onward obligation but
cannot say when it is due would appear in the register with no due date and silently never go overdue.

### `tax_head_slab_bands`  _(01 Masters)_

Masters 3.2b. Ordered bands for Slab-type heads. Inclusive bounds, no gaps, no overlaps, exactly one open-ended last band.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `tax_head_id` | CHAR(36) | NOT NULL FK tax_heads(id) ON DELETE CASCADE |  |
| `sequence_no` | smallint | NOT NULL CHECK (sequence_no > 0) |  |
| `band_from` | DECIMAL(14,2) | NOT NULL CHECK (band_from >= 0) |  |
| `band_to` | DECIMAL(14,2) | NULL CHECK (band_to IS NULL OR band_to >= band_from) | NULL = 'and above'. |
| `rate_or_amount` | DECIMAL(14,4) | NOT NULL CHECK (rate_or_amount >= 0) | Read as a % or a rupee figure depending on the parent head's slab_application/tax_type. |
| `band_label` | TEXT | NULL |  |

**Indexes**
- UNIQUE (tax_head_id, sequence_no)
- UNIQUE (tax_head_id) WHERE band_to IS NULL -- exactly one open band
- idx_slab_bands_head (tax_head_id, band_from)
- Contiguity (no gap, no overlap) and 'open band must be last' enforced by a deferred constraint trigger over the whole band set; the API also validates inline as bands are typed.

### `tax_head_split_components`  _(01 Masters)_

Masters 3.2c. Optional division of one head's computed amount into named components. Zero rows = a single undivided tax, the common case.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `tax_head_id` | CHAR(36) | NOT NULL FK tax_heads(id) ON DELETE CASCADE |  |
| `sequence_no` | smallint | NOT NULL |  |
| `component_name` | TEXT | NOT NULL |  |
| `share_pct` | DECIMAL(7,4) | NOT NULL CHECK (share_pct > 0 AND share_pct <= 100) |  |
| `applies_when` | TEXT | NOT NULL DEFAULT 'ALWAYS' CHECK (applies_when IN ('ALWAYS','CONDITIONAL')) |  |
| `condition_rule` | JSON | NULL | Simple comparison AST {field, op, value}; JSONB because the rule shape is genuinely open-ended. |

**Indexes**
- UNIQUE (tax_head_id, lower(component_name))
- UNIQUE (tax_head_id, sequence_no)
- Deferred constraint trigger: SUM(share_pct) = 100 exactly when any row exists for a head.

### `tax_head_relief_rules`  _(01 Masters)_

Masters 3.2. Relief/rebate rules on income-tax-scoped heads. Relief applied is always LESSER(relief_amount, computed tax) so it can never become a refund.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `tax_head_id` | CHAR(36) | NOT NULL FK tax_heads(id) ON DELETE CASCADE |  |
| `relief_name` | TEXT | NOT NULL |  |
| `applies_if_base_at_or_below` | DECIMAL(14,2) | NOT NULL CHECK (applies_if_base_at_or_below >= 0) |  |
| `relief_type` | TEXT | NOT NULL CHECK (relief_type IN ('REDUCE_BY_FIXED','REDUCE_TO_ZERO','CAP_AT_AMOUNT')) |  |
| `relief_amount` | DECIMAL(14,2) | NULL CHECK (relief_type = 'REDUCE_TO_ZERO' OR relief_amount IS NOT NULL) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (tax_head_id, lower(relief_name))
- Trigger: parent head scope must be PAYROLL_INCOME_TAX.

### `tax_schemes`  _(01 Masters)_

Masters 3.2d. Optional alternative tax regimes. Zero rows is a valid state and makes the whole concept vanish from the UI.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `scheme_name` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `description` | TEXT | NULL |  |
| `is_default` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `choice_window` | TEXT | NOT NULL CHECK (choice_window IN ('ONCE_PER_FY','ANY_TIME','FIXED_AT_JOINING')) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (is_default) WHERE is_default -- exactly one default

### `expense_types`  _(01 Masters)_

Masters 3.3. Drives expense routing: Reimbursable goes to the reimbursement queue, Company-Paid goes to Company Expenses and is raisable only by Super Admin/Accountant.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `short_code` | TEXT | NULL |  |
| `claim_type` | TEXT | NOT NULL CHECK (claim_type IN ('REIMBURSABLE','COMPANY_PAID')) |  |
| `is_recurring` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `default_bank_account_id` | CHAR(36) | NULL FK bank_accounts(id) | Only ACTIVE accounts are offered; the FK itself is not filtered so history survives deactivation. |
| `description` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `claim_type_changed_at` | DATETIME(6) | NULL |  |
| `previous_claim_type` | TEXT | NULL | Claim-type change is forward-only; existing claims keep claim_type_snapshot taken at their own creation. |
| `usage_count` | INT | NOT NULL DEFAULT 0 | Named in the forward-only change warning. |

**Indexes**
- UNIQUE (lower(name))
- idx_expense_types_active (is_active, claim_type)

### `leave_types`  _(01 Masters)_

Masters 3.4. Paid/Unpaid drives whether Payroll deducts. Quota 0 is valid (e.g. Work From Home).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `short_code` | TEXT | NULL |  |
| `is_paid` | TINYINT(1) | NOT NULL |  |
| `default_annual_quota_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (default_annual_quota_days >= 0) |  |
| `carry_forward_allowed` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `max_carry_forward_days` | DECIMAL(5,2) | NULL |  |
| `is_quota_tracked` | TINYINT(1) | NOT NULL DEFAULT true | false renders Remaining as the literal TEXT 'Not tracked'. |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))
- CHECK (NOT carry_forward_allowed OR (max_carry_forward_days IS NOT NULL AND max_carry_forward_days <= default_annual_quota_days))

### `holidays`  _(01 Masters)_

Masters 3.5. Mandatory holidays are excluded from working/payable days; Optional holidays draw on leave balance.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `holiday_date` | DATE | NOT NULL |  |
| `financial_year_id` | CHAR(36) | NOT NULL FK financial_years(id) |  |
| `holiday_type` | TEXT | NOT NULL CHECK (holiday_type IN ('MANDATORY','OPTIONAL')) |  |
| `recurring_every_year` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `used_in_processed_payroll` | TINYINT(1) | NOT NULL DEFAULT false | While false a Super Admin may hard-delete; once true it degrades to Active/Inactive only. |

**Indexes**
- UNIQUE (financial_year_id, holiday_date, lower(name))
- idx_holidays_date (holiday_date, is_active)
- Trigger: holiday_date must fall inside the linked FY's start_date..end_date.

### `company_profile`  _(01 Masters)_

Masters 3.6a. Singleton. Exactly one row, created at setup, editable forever, never deleted or deactivated.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `singleton_lock` | TINYINT(1) | NOT NULL DEFAULT true UNIQUE CHECK (singleton_lock) | Guarantees exactly one row. |
| `legal_name` | TEXT | NOT NULL |  |
| `cin` | TEXT | NOT NULL |  |
| `tan` | TEXT | NULL |  |
| `gstin` | TEXT | NULL |  |
| `pan` | char(10) | NOT NULL CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') |  |
| `company_type` | TEXT | NOT NULL |  |
| `year_of_incorporation` | smallint | NOT NULL CHECK (year_of_incorporation BETWEEN 1850 AND 2200) |  |
| `industry` | TEXT | NULL |  |
| `msme_registration_number` | TEXT | NULL |  |
| `phone` | char(10) | NOT NULL CHECK (phone ~ '^[0-9]{10}$') |  |
| `alternate_phone` | char(10) | NULL CHECK (alternate_phone ~ '^[0-9]{10}$') |  |
| `official_email` | citext | NOT NULL |  |
| `support_email` | citext | NULL |  |
| `website` | TEXT | NULL CHECK (website ~* '^https?://') |  |
| `logo_file_id` | CHAR(36) | NULL FK stored_files(id) |  |
| `letterhead_file_id` | CHAR(36) | NULL FK stored_files(id) |  |
| `invoice_template_file_id` | CHAR(36) | NULL FK stored_files(id) |  |
| `default_billing_tax_head_id` | CHAR(36) | NULL FK tax_heads(id) | Restricted at application level to sales/billing-scope heads. NULL is a valid, expected state on a fresh install. |

**Indexes**
- UNIQUE (singleton_lock)

### `company_addresses`  _(01 Masters)_

Masters 3.6b. Also the source for Asset 'Location / Branch'. Registered Address (Primary) on Company Profile is derived from the primary row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `address_type` | TEXT | NOT NULL CHECK (address_type IN ('REGISTERED_OFFICE','BRANCH_OFFICE','CORRESPONDENCE')) |  |
| `line1` | TEXT | NOT NULL |  |
| `line2` | TEXT | NULL |  |
| `city` | TEXT | NOT NULL |  |
| `state_id` | CHAR(36) | NOT NULL FK indian_states(id) |  |
| `pin_code` | char(6) | NOT NULL CHECK (pin_code ~ '^[0-9]{6}$') |  |
| `is_primary` | TINYINT(1) | NOT NULL DEFAULT false | Marking a new primary auto-unmarks the previous (trigger). |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (is_primary) WHERE is_primary
- idx_company_addresses_type (address_type, is_active)

### `company_documents`  _(01 Masters)_

Masters 3.6d. General / Financial / ROC document uploads, the latter two tagged by financial year.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `doc_group` | TEXT | NOT NULL CHECK (doc_group IN ('GENERAL','FINANCIAL','ROC')) |  |
| `file_id` | CHAR(36) | NOT NULL FK stored_files(id) |  |
| `financial_year_id` | CHAR(36) | NULL FK financial_years(id) CHECK (doc_group = 'GENERAL' OR financial_year_id IS NOT NULL) |  |
| `title` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- idx_company_documents (doc_group, financial_year_id)

### `bank_accounts`  _(01 Masters)_

Masters 3.7. Company bank accounts consumed by nine downstream screens. Only ACTIVE rows are offered in dropdowns; deactivation never rewrites history.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `nickname` | TEXT | NOT NULL |  |
| `bank_name` | TEXT | NOT NULL |  |
| `account_holder_name` | TEXT | NOT NULL |  |
| `account_number` | TEXT | NOT NULL CHECK (account_number ~ '^[0-9]{9,18}$') | Confirm Account Number is validated at the API boundary and never stored. |
| `account_type` | TEXT | NOT NULL CHECK (account_type IN ('CURRENT','SAVINGS')) |  |
| `ifsc` | char(11) | NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$') |  |
| `branch` | TEXT | NOT NULL |  |
| `upi_id` | TEXT | NULL |  |
| `upi_qr_file_id` | CHAR(36) | NULL FK stored_files(id) |  |
| `is_default` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Trigger blocks deactivating the default account until another default is chosen. |

**Indexes**
- UNIQUE (account_number, ifsc)
- UNIQUE (lower(nickname))
- UNIQUE (is_default) WHERE is_default
- idx_bank_accounts_active (is_active)

### `payment_modes`  _(01 Masters)_

Masters 3.8. Payment modes for invoice receipts, purchase-bill payments and reimbursements.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `requires_reference_number` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `departments`  _(01 Masters)_

Masters 3.9.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `code` | TEXT | NULL |  |
| `description` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))
- UNIQUE (lower(code)) WHERE code IS NOT NULL

### `designations`  _(01 Masters)_

Masters 3.10. Job titles, optionally tied to a department.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `department_id` | CHAR(36) | NULL FK departments(id) |  |
| `level_grade` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE NULLS NOT DISTINCT (lower(name), department_id)
- idx_designations_dept (department_id, is_active)

### `hsn_sac_codes`  _(01 Masters)_

Masters 3.11. Linked Tax is resolved LIVE from in-force sales/purchase-scope heads; a '- Custom -' row stores its own non-reusable rate.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `code` | TEXT | NOT NULL |  |
| `code_type` | TEXT | NOT NULL CHECK (code_type IN ('HSN','SAC')) |  |
| `description` | TEXT | NOT NULL |  |
| `linked_tax_head_id` | CHAR(36) | NULL FK tax_heads(id) | Never denormalises the rate; changing what a code charges means editing the TAX HEAD. |
| `is_custom` | TINYINT(1) | NOT NULL DEFAULT false CHECK (is_custom = (linked_tax_head_id IS NULL)) |  |
| `custom_gst_type` | TEXT | NULL CHECK (custom_gst_type IN ('GST_IGST','GST_CGST_SGST')) |  |
| `custom_gst_rate_pct` | DECIMAL(7,4) | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (code_type, code)
- CHECK (NOT is_custom OR (custom_gst_type IS NOT NULL AND custom_gst_rate_pct IS NOT NULL))

### `service_categories`  _(01 Masters)_

Masters 3.12. Used by Customer, Opportunity and Project.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `description` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `units_of_measure`  _(01 Masters)_

Masters 3.13. Offered on invoice and purchase-bill line items.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `ticket_categories`  _(01 Masters)_

Masters 3.14.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `description` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `customer_statuses`  _(01 Masters)_

Masters 3.15. The Customer Status dropdown is a master, not an enum.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `customer_sources`  _(01 Masters)_

Masters 3.16.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `asset_categories`  _(01 Masters)_

Masters 3.17.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `description` | TEXT | NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `employment_types`  _(01 Masters)_

Masters 3.18. Referenced by Employee and by Work Week Policy scoping.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `name` | TEXT | NOT NULL |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(name))

### `insurance_plans`  _(01 Masters)_

Masters 3.19. Company Contribution is a FLAT MONTHLY RUPEE AMOUNT per employee, not a percentage. Insurance is a named benefit line, never part of the statutory block.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `plan_name` | TEXT | NOT NULL |  |
| `plan_type` | TEXT | NOT NULL CHECK (plan_type IN ('HEALTH','LIFE','PERSONAL_ACCIDENT')) |  |
| `provider` | TEXT | NULL |  |
| `coverage_amount` | DECIMAL(14,2) | NOT NULL CHECK (coverage_amount > 0) |  |
| `company_contribution_monthly` | DECIMAL(14,2) | NOT NULL CHECK (company_contribution_monthly >= 0) |  |
| `employee_contribution_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (employee_contribution_monthly >= 0) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (lower(plan_name))
- idx_insurance_plans_type (plan_type, is_active)

### `work_week_policies`  _(01 Masters)_

Masters 3.20. The single source of Required Hours for every attendance day and every payroll hour comparison. Exactly one Company-wide policy may be active; a narrower policy always wins for the people it names.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `policy_name` | TEXT | NOT NULL |  |
| `applies_to` | TEXT | NOT NULL CHECK (applies_to IN ('COMPANY_WIDE','DEPARTMENT','DESIGNATION','EMPLOYMENT_TYPE','SPECIFIC_EMPLOYEES')) |  |
| `department_id` | CHAR(36) | NULL FK departments(id) |  |
| `designation_id` | CHAR(36) | NULL FK designations(id) |  |
| `employment_type_id` | CHAR(36) | NULL FK employment_types(id) |  |
| `effective_from` | DATE | NOT NULL | Policy changes are forward-only; a Processed period is never rewritten. |
| `gross_hours_per_day` | DECIMAL(6,2) | NOT NULL CHECK (gross_hours_per_day > 0 AND gross_hours_per_day <= 24) |  |
| `unpaid_break_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (unpaid_break_hours >= 0) |  |
| `net_working_hours_per_day` | DECIMAL(6,2) | GENERATED ALWAYS AS (gross_hours_per_day - unpaid_break_hours) STORED | THE only figure Payroll compares against. Derived, never typed. |
| `grace_window_minutes` | smallint | NOT NULL DEFAULT 0 CHECK (grace_window_minutes >= 0) | 0 switches grace off. |
| `half_day_threshold_hours` | DECIMAL(6,2) | NULL CHECK (half_day_threshold_hours >= 0) |  |
| `count_overtime_beyond_net` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `weekly_hour_target` | DECIMAL(6,2) | NOT NULL CHECK (weekly_hour_target > 0) | Excludes Saturdays. Payroll checks the monthly total. |
| `weekly_off_days` | TEXT | NOT NULL CHECK (weekly_off_days IN ('SUNDAY','SAT_SUN','SUN_ALT_SAT','ROTATIONAL_ONE','FRIDAY','NONE')) |  |
| `saturday_rule` | TEXT | NOT NULL CHECK (saturday_rule IN ('ODD_WORKING','EVEN_WORKING','ALL_WORKING','ALL_OFF','FIRST_ONLY','LAST_ONLY','CUSTOM')) |  |
| `working_saturday_hours_mode` | TEXT | NULL CHECK (working_saturday_hours_mode IN ('FULL','HALF','CUSTOM')) |  |
| `custom_saturday_hours` | DECIMAL(6,2) | NULL CHECK (working_saturday_hours_mode <> 'CUSTOM' OR custom_saturday_hours IS NOT NULL) |  |
| `mandatory_holiday_overrides_saturday` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `allow_compensatory_hours` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `compensation_window_days` | smallint | NULL CHECK (compensation_window_days >= 0) | 0 means the SAME PAYROLL PERIOD ONLY. |
| `make_up_day_chosen_by` | TEXT | NULL CHECK (make_up_day_chosen_by IN ('EMPLOYEE_WITH_APPROVAL','EMPLOYEE_NO_APPROVAL','MANAGER_ASSIGNS')) |  |
| `allow_makeup_on_week_off` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `allow_makeup_on_mandatory_holiday` | TINYINT(1) | NOT NULL DEFAULT false | OFF by default on purpose. |
| `max_comp_hours_per_month` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (max_comp_hours_per_month >= 0) | 0 removes the cap. |
| `uncompensated_shortfall_becomes` | TEXT | NOT NULL DEFAULT 'PRO_RATA_LOP' CHECK (uncompensated_shortfall_becomes IN ('PRO_RATA_LOP','ROUND_HALF_DAY','ROUND_FULL_DAY','LEAVE_THEN_LOP','IGNORE')) |  |
| `excess_hours_become` | TEXT | NULL CHECK (excess_hours_become IN ('COMP_CREDIT','COMP_OFF_LEAVE','PAID_OVERTIME','NOT_TRACKED')) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (applies_to) WHERE applies_to = 'COMPANY_WIDE' AND is_active
- UNIQUE (lower(policy_name))
- idx_wwp_resolution (applies_to, is_active, effective_from DESC)
- CHECK matching applies_to to exactly the right dimension FK being non-null
- Trigger: cannot deactivate the company-wide policy while it is the only active one.

### `work_week_policy_employees`  _(01 Masters)_

Association table for Work Week Policy 'Applies To = Specific Employees'.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `work_week_policy_id` | CHAR(36) | NOT NULL FK work_week_policies(id) ON DELETE CASCADE |  |
| `employee_id` | CHAR(36) | NOT NULL FK employees(id) |  |

**Indexes**
- UNIQUE (work_week_policy_id, employee_id)
- idx_wwpe_employee (employee_id)

### `saturday_overrides`  _(01 Masters)_

Masters 3.20. A dated exception that takes precedence over the Saturday pattern. Reason is mandatory and displays permanently on the Saturday Calendar.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `saturday_date` | DATE | NOT NULL CHECK (EXTRACT(DOW FROM saturday_date) = 6) |  |
| `financial_year_id` | CHAR(36) | NOT NULL FK financial_years(id) |  |
| `work_week_policy_id` | CHAR(36) | NULL FK work_week_policies(id) | NULL = applies to every policy. |
| `pattern_says` | TEXT | NULL | Derived snapshot of what the rule would have said; read-only. |
| `override_to` | TEXT | NOT NULL CHECK (override_to IN ('WORKING','WEEK_OFF')) |  |
| `hours_required` | DECIMAL(6,2) | NOT NULL CHECK (hours_required >= 0) |  |
| `reason` | TEXT | NOT NULL CHECK (length(btrim(reason)) > 0) |  |
| `notify_affected_employees` | TINYINT(1) | NOT NULL DEFAULT false |  |

**Indexes**
- UNIQUE NULLS NOT DISTINCT (saturday_date, work_week_policy_id)
- idx_sat_overrides_fy (financial_year_id, saturday_date)

### `pay_cycles`  _(01 Masters)_

Masters 3.21. Fixed Cycle (e.g. 26th->25th) or Calendar Month. End Day is the cutoff every downstream calculation reads; Salary Credit Day is separate and always later.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `cycle_type` | TEXT | NOT NULL CHECK (cycle_type IN ('FIXED_CYCLE','CALENDAR_MONTH')) |  |
| `start_day` | smallint | NULL CHECK (start_day BETWEEN 1 AND 31) | Day of the PREVIOUS month the period opens. Ignored for CALENDAR_MONTH. |
| `end_day` | smallint | NULL CHECK (end_day BETWEEN 1 AND 31) | Day of the CURRENT month it closes; the cutoff. |
| `salary_credit_day` | smallint | NOT NULL CHECK (salary_credit_day BETWEEN 1 AND 31) | Clamped to the real last day of a shorter month at resolution time. |
| `effective_from` | DATE | NOT NULL | Pay-cycle changes are forward-only. |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- UNIQUE (is_active) WHERE is_active
- CHECK (cycle_type = 'CALENDAR_MONTH' OR (start_day IS NOT NULL AND end_day IS NOT NULL))

### `pay_periods`  _(01 Masters)_

Materialised 'Resolved Periods' table. Every dated payroll input (attendance, leave, comp make-up, ad-hoc adjustment) is stamped with a pay_period_id by date alone, which is what makes the cutoff reconciliation rule automatic.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `pay_cycle_id` | CHAR(36) | NOT NULL FK pay_cycles(id) |  |
| `financial_year_id` | CHAR(36) | NOT NULL FK financial_years(id) |  |
| `period_year` | smallint | NOT NULL |  |
| `period_month` | smallint | NOT NULL CHECK (period_month BETWEEN 1 AND 12) |  |
| `period_start` | DATE | NOT NULL |  |
| `period_end` | DATE | NOT NULL CHECK (period_end >= period_start) |  |
| `salary_credit_date` | DATE | NOT NULL CHECK (salary_credit_date > period_end) |  |
| `is_closed` | TINYINT(1) | NOT NULL DEFAULT false |  |

**Indexes**
- UNIQUE (pay_cycle_id, period_year, period_month)
- **No MySQL equivalent (see D0.2)** — pay-cycle period overlap enforced by a BEFORE INSERT/UPDATE trigger plus a service-layer check
- idx_pay_periods_range (period_start, period_end)

### `email_server_settings`  _(01 Masters)_

Masters 3.22. Singleton, edit-only (no add/delete). 'Sending Enabled' off stops every outbound email without touching a template; in-app notifications are unaffected.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `singleton_lock` | TINYINT(1) | NOT NULL DEFAULT true UNIQUE CHECK (singleton_lock) |  |
| `sending_enabled` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `provider` | TEXT | NOT NULL CHECK (provider IN ('CUSTOM_SMTP','SENDGRID','SES','MAILGUN','POSTMARK')) |  |
| `smtp_host` | TEXT | NULL |  |
| `smtp_port` | INT | NULL CHECK (smtp_port BETWEEN 1 AND 65535) |  |
| `encryption` | TEXT | NULL CHECK (encryption IN ('STARTTLS','SSL_TLS','NONE')) |  |
| `username` | TEXT | NULL |  |
| `password_encrypted` | bytea | NULL | Encrypted at rest; never returned in full by any API. |
| `api_key_encrypted` | bytea | NULL | Same masking convention as every stored credential. |
| `credential_hint` | TEXT | NULL | Last 4 characters only, for the masked display. |
| `from_name` | TEXT | NOT NULL |  |
| `from_email` | citext | NOT NULL |  |
| `reply_to_email` | citext | NULL |  |

**Indexes**
- CHECK (provider <> 'CUSTOM_SMTP' OR (smtp_host IS NOT NULL AND smtp_port IS NOT NULL AND encryption IS NOT NULL))
- CHECK (provider = 'CUSTOM_SMTP' OR api_key_encrypted IS NOT NULL)

### `email_templates`  _(01 Masters)_

Masters 3.23. Rows are seeded from trigger points in owning modules and NEVER deleted. Enabled/Disabled silences only the email copy, never the in-app notification.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `template_key` | VARCHAR(191) | NOT NULL UNIQUE | Stable machine key; the visible Template Name and Triggered From chip are derived from the registry. |
| `template_name` | TEXT | NOT NULL |  |
| `triggered_from_module` | TEXT | NOT NULL |  |
| `triggered_from_screen` | TEXT | NULL |  |
| `is_enabled` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `subject` | TEXT | NOT NULL |  |
| `body` | TEXT | NOT NULL |  |
| `available_placeholders` | JSON | NOT NULL DEFAULT '[]'::JSON | Open-ended per-trigger merge-field catalogue: [{token, label, sample}]. Genuinely variable per template, so JSONB rather than a table. |

**Indexes**
- UNIQUE (template_key)
- GIN (available_placeholders)
- REVOKE DELETE on the table.

### `email_send_log`  _(01 Masters)_

Masters 3.23 'Recent Sends'. Append-only delivery log.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | CHAR(36) | PK |  |
| `email_template_id` | CHAR(36) | NULL FK email_templates(id) |  |
| `recipient_email` | citext | NOT NULL |  |
| `subject_snapshot` | TEXT | NOT NULL |  |
| `sent_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `delivery_status` | TEXT | NOT NULL CHECK (delivery_status IN ('QUEUED','DELIVERED','BOUNCED','FAILED')) |  |
| `provider_message_id` | TEXT | NULL |  |
| `error_detail` | TEXT | NULL |  |
| `related_record_type` | TEXT | NULL |  |
| `related_record_id` | CHAR(36) | NULL |  |

**Indexes**
- idx_email_log_sent (sent_at DESC)
- idx_email_log_recipient (recipient_email, sent_at DESC)
- idx_email_log_status (delivery_status, sent_at DESC)
- Append-only: no updated_at/updated_by; REVOKE UPDATE, DELETE.

### `employees`  _(02-employee)_

The HR master record for one staff member — personal, employment, bank/statutory identity, login linkage and lifecycle status. Every self-service screen and every other table in this scope hangs off it.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_code` | VARCHAR(191) | NOT NULL, UNIQUE | Full rendered code, e.g. 'EMP-2026-0001'. Allocated from document_number_sequences keyed (code_type='EMPLOYEE', financial_year_id) with SELECT ... FOR UPDATE inside the insert transaction. Never a Postgres SEQUENCE. |
| `code_financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Deliberately named code_* and deliberately NOT covered by fn_reject_if_fy_locked(). An employee is a party record, not an FY-dated business record — locking FY2026 must not freeze edits to a person hired in FY2026. This column exists only to record which sequence bucket produced employee_code. |
| `photo_storage_key` | TEXT | NULL | Object-store key. Directory falls back to initials when NULL. |
| `photo_file_name` | TEXT | NULL |  |
| `photo_mime_type` | TEXT | CHECK (photo_mime_type IS NULL OR photo_mime_type IN ('image/jpeg','image/png')) | JPG/PNG only per 2.2 Personal Details. |
| `photo_file_size_bytes` | BIGINT | CHECK (photo_file_size_bytes IS NULL OR photo_file_size_bytes > 0) |  |
| `first_name` | TEXT | NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 2 AND 50) |  |
| `last_name` | TEXT | CHECK (last_name IS NULL OR char_length(btrim(last_name)) <= 50) |  |
| `full_name` | TEXT | GENERATED ALWAYS AS (btrim(first_name \|\| ' ' \|\| coalesce(last_name,''))) STORED | DERIVED — generated column. Single-row, immutable expression. Drives Directory sort/search and every 'Employee Name' column across both modules. |
| `email` | TEXT | NOT NULL | Also the login identifier when a login is created (2.2 Account & Login: Login Email mirrors this, no separate username). Uniqueness enforced case-insensitively by ux_employees_email_lower. |
| `phone` | TEXT | CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$') | 10-digit Indian mobile. Directly editable by the employee from My Profile (2.3) — no approval path. |
| `date_of_birth` | DATE | CHECK (date_of_birth IS NULL OR date_of_birth < CURRENT_DATE) |  |
| `gender` | employee_gender | NULL | ENUM ('male','female','other','prefer_not_to_say'). |
| `current_address` | TEXT | NULL | Directly editable from My Profile (2.3). Assumption resolved in 2.2 — Address needed a home on Personal Details. |
| `department_id` | CHAR(36) | NOT NULL REFERENCES departments(id) ON DELETE RESTRICT | Active-only filtering happens in the dropdown query; deactivating a department never rewrites this record. |
| `designation_id` | CHAR(36) | NOT NULL REFERENCES designations(id) ON DELETE RESTRICT |  |
| `employment_type_id` | CHAR(36) | NOT NULL REFERENCES employment_types(id) ON DELETE RESTRICT | Masters 3.18. Also one of the dimensions a work_week_policy and a tax_head may be restricted to. |
| `joining_date` | DATE | NOT NULL | No 'not in the future' DB CHECK on purpose: 2.15 explicitly allows generating an Offer Letter against a record before the person joins, which requires a future joining_date. The form-level rule stays as written in 2.2. |
| `reporting_manager_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT, CHECK (reporting_manager_id IS NULL OR reporting_manager_id <> id) | Self-FK. Drives Manager scoping everywhere and the Leave/Compensatory-Hours routing rule (05 §2.2 step 1). Cycle prevention is trg_employees_reject_reporting_cycle, not a CHECK — it spans rows. |
| `work_location_address_id` | CHAR(36) | REFERENCES company_addresses(id) ON DELETE RESTRICT | Masters 3.6b (Company Profile → Addresses). Powers the Directory 'Work Location' filter, tax-head location restriction, and the office an attendance event came from. |
| `employment_status` | employee_status | NOT NULL DEFAULT 'active' | ENUM ('active','inactive','on_notice','exited'). Soft-delete tier 2 — status-driven lifecycle, employees are never deleted. Moving to 'exited' is gated by trg_employees_guard_exit_transition. |
| `exit_date` | DATE | CHECK (exit_date IS NULL OR exit_date >= joining_date) | Recorded by exit checklist step 5, defaulting to the Last Working Day fixed on the acceptance letter. |
| `bank_name` | TEXT | NULL |  |
| `bank_account_number` | TEXT | CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{6,20}$') | 'Confirm Bank Account Number' from 2.2 is a form-only typo safeguard and is deliberately not stored. |
| `bank_account_last4` | TEXT | GENERATED ALWAYS AS (right(bank_account_number,4)) STORED | DERIVED — generated column, for masked display in lists without reading the full number. |
| `bank_ifsc_code` | TEXT | CHECK (bank_ifsc_code IS NULL OR bank_ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$') | Exactly 11 chars, 4 letters + '0' + 6 alphanumeric. |
| `pan_number` | TEXT | CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') | Deliberately a named field, not a statutory-identifier row — a general identity document, not a per-tax registration (2.2). |
| `aadhaar_number` | TEXT | CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^[0-9]{12}$') | Same reasoning as PAN. Stored encrypted at rest; never rendered in full after save. |
| `aadhaar_last4` | TEXT | GENERATED ALWAYS AS (right(aadhaar_number,4)) STORED | DERIVED — generated column. Feeds the XXXX-XXXX-1234 masked display. |
| `user_id` | CHAR(36) | UNIQUE REFERENCES users(id) ON DELETE RESTRICT | NULL until Create Login is switched on. The login secret/role/enabled/must-change-password/last-login columns live on users (RBAC Module 14) — see notes; duplicating account state here would give it two homes. |
| `has_login` | TINYINT(1) | GENERATED ALWAYS AS (user_id IS NOT NULL) STORED NOT NULL | DERIVED — generated column. The 'Create Login' toggle read back. Onboarding step 2 auto-checks off this. |
| `login_created_at` | DATETIME(6) | NULL | HR-record fact, distinct from users.created_at: when this employee was granted access. |
| `login_removed_at` | DATETIME(6) | NULL | Set when login access is removed entirely (the stronger of the two confirmations in 2.2), as opposed to merely disabling users.is_enabled. |
| `welcome_email_sent_at` | DATETIME(6) | NULL | Onboarding step 7. The send itself is a row in email_send_log. |
| `welcome_email_sent_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `onboarding_completed_at` | DATETIME(6) | NULL | DERIVED — trigger (spans rows: set by trg_onboarding_checklist_items_rollup when all 7 items reach complete/skipped). Collapses the checklist out of HR's to-do view. |
| `biometric_enrollment_id` | VARCHAR(191) | UNIQUE NULLS NOT DISTINCT? no — UNIQUE (nulls distinct) | Planned-feature column flagged in 7.1. Nullable and unused today; present so the biometric feed drops in without a migration on a live employees table. |

**Indexes**
- ux_employees_code UNIQUE ON employees(employee_code)
- ux_employees_email_lower UNIQUE ON employees(lower(email))
- ux_employees_user UNIQUE ON employees(user_id) WHERE user_id IS NOT NULL
- ix_employees_department ON employees(department_id)
- ix_employees_designation ON employees(designation_id)
- ix_employees_employment_type ON employees(employment_type_id)
- ix_employees_status ON employees(employment_status)
- ix_employees_reporting_manager ON employees(reporting_manager_id) WHERE reporting_manager_id IS NOT NULL
- ix_employees_joining_date ON employees(joining_date DESC)
- ix_employees_work_location ON employees(work_location_address_id)
- ix_employees_active_directory ON employees(department_id, designation_id) WHERE employment_status IN ('active','on_notice')
- `ix_employees_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_employees_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_employees_set_updated_at BEFORE UPDATE — shared audit-mixin trigger
- trg_employees_allocate_code BEFORE INSERT — allocates employee_code from document_number_sequences for code_financial_year_id, FOR UPDATE
- trg_employees_reject_reporting_cycle BEFORE INSERT OR UPDATE OF reporting_manager_id — walks the chain and raises on any cycle (A→B→A); spans rows, so a trigger not a CHECK
- trg_employees_enforce_min_age BEFORE INSERT OR UPDATE — raises when joining_date < date_of_birth + 18 years (2.2 assumption)
- trg_employees_seed_onboarding_checklist AFTER INSERT — creates the 7 onboarding_checklist_items rows
- trg_employees_provision_leave_balances AFTER INSERT OR UPDATE OF employment_status — on first transition to 'active' inside a financial year, allocates prorated leave_balances for every Active leave type: (default_annual_quota / 12) * months remaining from joining_date, rounded to nearest half-day (05 §2.3 / §3.2)
- trg_employees_guard_exit_transition BEFORE UPDATE OF employment_status — refuses a move to 'exited' unless the employee's open resignation has its 'mark_exited' exit_checklist_step actionable (its gate satisfied)
- trg_employees_autocheck_onboarding AFTER UPDATE OF reporting_manager_id, user_id — flips onboarding steps 2 and 3 to complete

### `employee_statutory_identifiers`  _(02-employee)_

One TEXT identifier per employee per tax head that needs one — the generated 'Statutory Identifiers' block on Bank & Statutory that replaced the three named UAN/PF/ESI fields.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE CASCADE |  |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT | The head whose behaviour JSONB carries requires_employee_identifier = true. No tax is named anywhere in this table. |
| `identifier_label_snapshot` | TEXT | NOT NULL | SNAPSHOT of the head's Employee Identifier Label at capture time, so an old record still prints the label it was captured under after the head is renamed. |
| `identifier_value` | TEXT | NOT NULL CHECK (btrim(identifier_value) <> '') |  |
| `captured_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- ux_employee_statutory_identifiers UNIQUE ON employee_statutory_identifiers(employee_id, tax_head_id)
- ix_employee_statutory_identifiers_head ON employee_statutory_identifiers(tax_head_id)

**Triggers**
- trg_employee_statutory_identifiers_set_updated_at BEFORE UPDATE
- trg_employee_statutory_identifiers_snapshot_label BEFORE INSERT — copies the current label from tax_heads.behaviour so it can never be left blank

### `employee_emergency_contacts`  _(02-employee)_

Emergency Contact tab (2.2) / directly-editable group on My Profile (2.3). Modelled as a list with one primary rather than three columns on employees, so a second contact costs no migration.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE CASCADE |  |
| `contact_name` | TEXT | NOT NULL CHECK (btrim(contact_name) <> '') |  |
| `relationship` | emergency_contact_relationship | NULL | ENUM ('spouse','parent','sibling','friend','other') — the proposed option list in 2.2. |
| `contact_phone` | TEXT | CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9][0-9]{9}$') |  |
| `is_primary` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `display_order` | smallint | NOT NULL DEFAULT 1 |  |

**Indexes**
- ux_employee_emergency_contacts_primary UNIQUE ON employee_emergency_contacts(employee_id) WHERE is_primary
- ix_employee_emergency_contacts_employee ON employee_emergency_contacts(employee_id)

**Triggers**
- trg_employee_emergency_contacts_set_updated_at BEFORE UPDATE

### `salary_structures`  _(02-employee)_

One versioned compensation structure per employee per effective period — created and edited here (Employee 2.2), read by Payroll. Superseding a version closes the old one into Structure Change History rather than overwriting it.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY containing effective_from. Covered by fn_reject_if_fy_locked(). |
| `effective_from` | DATE | NOT NULL |  |
| `effective_to` | DATE | CHECK (effective_to IS NULL OR effective_to >= effective_from) | NULL = the current structure. Set automatically when the next version is inserted. |
| *(validity)* | **dropped — no MySQL range type** | DERIVED — generated column, purely so the EXCLUDE constraint below has something to index. |
| `is_current` | TINYINT(1) | GENERATED ALWAYS AS (effective_to IS NULL) STORED NOT NULL | DERIVED — generated column. Backs the partial unique index that enforces 'only one current structure per employee'. |
| `changed_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | The 'Changed By' column of Structure Change History. Kept distinct from the audit-mixin created_by: a later administrative correction to a row must not rewrite who set the compensation. |
| `change_note` | TEXT | NULL | Free TEXT — 'annual hike', 'promotion', 'correction'. |
| `basic_salary_monthly` | DECIMAL(14,2) | NOT NULL CHECK (basic_salary_monthly >= 0) |  |
| `dearness_allowance_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (dearness_allowance_monthly >= 0) | Exists even when set to 0 — the Code on Wages Basic+DA ≥ 50% check cannot be evaluated without it. |
| `hra_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (hra_monthly >= 0) |  |
| `lta_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (lta_amount >= 0) |  |
| `lta_payout_basis` | lta_payout_basis | NOT NULL DEFAULT 'monthly' | ENUM ('monthly','annual'). Decides whether LTA joins Gross Monthly or only Annual CTC. |
| `special_allowance_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (special_allowance_monthly >= 0) |  |
| `other_earnings_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (other_earnings_monthly >= 0) |  |
| `variable_pay_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (variable_pay_amount >= 0) |  |
| `variable_pay_frequency` | variable_pay_frequency | NOT NULL DEFAULT 'annual' | ENUM ('annual','quarterly'). |
| `gross_monthly` | DECIMAL(14,2) | GENERATED ALWAYS AS (basic_salary_monthly + dearness_allowance_monthly + hra_monthly + CASE WHEN lta_payout_basis = 'monthly' THEN lta_amount ELSE 0 END + special_allowance_monthly + other_earnings_monthly) STORED NOT NULL | DERIVED — generated column. Single-row, immutable. Variable pay is deliberately excluded, per 2.2. |
| `variable_pay_annualised` | DECIMAL(14,2) | GENERATED ALWAYS AS (variable_pay_amount * CASE WHEN variable_pay_frequency = 'quarterly' THEN 4 ELSE 1 END) STORED NOT NULL | DERIVED — generated column. |
| `insurance_employee_contribution_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (insurance_employee_contribution_monthly >= 0) | DERIVED — trigger (spans tables: summed from employee_insurance_enrollments active on effective_from). A named line, not a statutory line: a benefit premium, not a tax. |
| `insurance_employer_contribution_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (insurance_employer_contribution_monthly >= 0) | DERIVED — trigger (spans tables). Feeds Annual CTC only. |
| `total_employee_statutory_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger (spans rows: sum of applicable employee-borne salary_structure_statutory_lines). |
| `total_employer_statutory_ctc_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger (spans rows: employer-borne lines whose include_in_ctc snapshot is true). |
| `net_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger, NOT generated: it depends on the two trigger-maintained totals above and on gross_monthly, and Postgres forbids a generated column referencing another generated column. = gross_monthly − total_employee_statutory_monthly − insurance_employee_contribution_monthly. Income tax is never included here. |
| `annual_ctc` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger. = (gross_monthly × 12) + variable_pay_annualised + (total_employer_statutory_ctc_monthly × 12) + (insurance_employer_contribution_monthly × 12). |
| `basic_plus_da_share_pct` | DECIMAL(6,3) | NOT NULL DEFAULT 0 | DERIVED — trigger. ((basic + DA) × 12) / annual_ctc × 100. The figure the Code on Wages rule is judged on. |
| `is_wage_code_compliant` | TINYINT(1) | NOT NULL DEFAULT true | DERIVED — trigger. basic_plus_da_share_pct >= 50. |
| `wage_code_override_reason` | TEXT | CHECK (is_wage_code_compliant OR btrim(coalesce(wage_code_override_reason,'')) <> '') | Implements 'warn, and ideally block' as: a non-compliant split may only be saved with a stated reason, and the acknowledger is named below. Turning it into a hard block later is one CHECK change, not a redesign. |
| `wage_code_override_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `wage_code_override_at` | DATETIME(6) | NULL |  |

**Indexes**
- **No MySQL equivalent (see D0.2).** Overlap is prevented by `trg_salary_structures_no_overlap` (BEFORE INSERT/UPDATE, `SIGNAL SQLSTATE '45000'`) plus a service-layer check holding `SELECT ... FOR UPDATE` on that employee's rows in the same transaction. Both are required: the trigger is the backstop, the service check gives a usable error
- ux_salary_structures_current UNIQUE ON salary_structures(employee_id) WHERE effective_to IS NULL
- ix_salary_structures_employee_effective ON salary_structures(employee_id, effective_from DESC)
- ix_salary_structures_financial_year ON salary_structures(financial_year_id)

**Triggers**
- trg_salary_structures_set_updated_at BEFORE UPDATE
- trg_salary_structures_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_salary_structures_close_previous BEFORE INSERT — sets the prior current version's effective_to = NEW.effective_from - 1 day, so the EXCLUDE constraint is satisfied and the old version drops into Structure Change History instead of being overwritten
- trg_salary_structures_recompute_totals AFTER INSERT OR UPDATE — recomputes net_monthly, annual_ctc, basic_plus_da_share_pct, is_wage_code_compliant
- trg_salary_structures_pull_insurance BEFORE INSERT OR UPDATE OF effective_from — snapshots the two insurance contribution figures from active enrollments
- trg_salary_structures_autocheck_onboarding AFTER INSERT — completes onboarding step 5 (Link a Salary Structure)

### `salary_structure_statutory_lines`  _(02-employee)_

The generated Statutory Deductions & Contributions block — one row per tax head applying to this structure, each a full snapshot so a historical structure reproduces exactly after the head is edited or retired.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `salary_structure_id` | CHAR(36) | NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE |  |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT |  |
| `head_name_snapshot` | TEXT | NOT NULL | SNAPSHOT of Tax Name. |
| `print_label_snapshot` | TEXT | NOT NULL | SNAPSHOT of Print Label — what actually prints on the structure, the payslip and the appointment letter. |
| `scope_snapshot` | tax_scope | NOT NULL CHECK (scope_snapshot IN ('payroll_employee_deduction','payroll_employer_contribution')) | ENUM covering all seven Masters scopes; only the two payroll ones are legal here. |
| `tax_type_snapshot` | tax_type | NOT NULL | ENUM ('gst_igst','gst_cgst_sgst','percentage','fixed_amount','slab','declaration_cap'). SNAPSHOT of the method used. |
| `rate_snapshot` | DECIMAL(6,3) | CHECK (rate_snapshot IS NULL OR rate_snapshot >= 0) | Percentages are DECIMAL(6,3) throughout. |
| `fixed_amount_snapshot` | DECIMAL(14,2) | NULL |  |
| `slab_application_snapshot` | slab_application | NULL | ENUM ('progressive','flat_by_band') — only meaningful when tax_type_snapshot = 'slab'. |
| `computed_base_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | The base this head was applied to at calculation time — the other half of reproducibility. |
| `computed_amount_monthly` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `borne_by` | statutory_borne_by | NOT NULL | ENUM ('employee','employer'). Derived from scope at calculation and frozen. |
| `include_in_ctc_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | Decides whether an employer-borne line joins Annual CTC. |
| `per_employee_opt_out_allowed_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | Whether the Applicable toggle renders on this row at all. |
| `is_applicable` | TINYINT(1) | NOT NULL DEFAULT true | The surviving, generalized per-employee Applicable toggle. Editable by Super Admin AND Accountant — the one deliberate exception to Salary-Structure-is-Super-Admin-only. |
| `applicability_changed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `applicability_changed_at` | DATETIME(6) | NULL |  |
| `calculated_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `display_order` | smallint | NOT NULL DEFAULT 0 |  |

**Indexes**
- ux_salary_structure_statutory_lines UNIQUE ON salary_structure_statutory_lines(salary_structure_id, tax_head_id)
- ix_salary_structure_statutory_lines_head ON salary_structure_statutory_lines(tax_head_id)
- ix_salary_structure_statutory_lines_applicable ON salary_structure_statutory_lines(salary_structure_id) WHERE is_applicable

**Triggers**
- trg_salary_structure_statutory_lines_set_updated_at BEFORE UPDATE
- trg_salary_structure_statutory_lines_rollup AFTER INSERT OR UPDATE OR DELETE — recomputes the parent's total_employee_statutory_monthly, total_employer_statutory_ctc_monthly, net_monthly, annual_ctc
- trg_salary_structure_statutory_lines_guard_opt_out BEFORE UPDATE OF is_applicable — raises when per_employee_opt_out_allowed_snapshot is false

### `employee_insurance_enrollments`  _(02-employee)_

Enrolment of one employee into one company-provided Insurance Plan (Masters 3.19) — the Insurance & Benefits tab. An employee may hold several (e.g. Health and Life).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `insurance_plan_id` | CHAR(36) | NOT NULL REFERENCES insurance_plans(id) ON DELETE RESTRICT |  |
| `enrollment_date` | DATE | NOT NULL |  |
| `unenrolled_date` | DATE | CHECK (unenrolled_date IS NULL OR unenrolled_date >= enrollment_date) | Deactivating a plan in Masters never removes an existing coverage record — it only stops the plan being offered to new enrolments. |
| `plan_type_snapshot` | insurance_plan_type | NOT NULL | ENUM ('health','life','personal_accident'). SNAPSHOT — decides whether dependents or nominees are the valid children. |
| `plan_name_snapshot` | TEXT | NOT NULL |  |
| `coverage_amount_snapshot` | DECIMAL(14,2) | NOT NULL CHECK (coverage_amount_snapshot >= 0) |  |
| `company_contribution_monthly_snapshot` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (company_contribution_monthly_snapshot >= 0) | Flows into Annual CTC without being typed twice. |
| `employee_contribution_monthly_snapshot` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (employee_contribution_monthly_snapshot >= 0) | Flows into Net Monthly as a named deduction line. |
| `status` | insurance_enrollment_status | NOT NULL DEFAULT 'active' | ENUM ('active','ended'). Soft-delete tier 2. |

**Indexes**
- ux_employee_insurance_enrollments_active UNIQUE ON employee_insurance_enrollments(employee_id, insurance_plan_id) WHERE unenrolled_date IS NULL
- ix_employee_insurance_enrollments_employee ON employee_insurance_enrollments(employee_id)
- ix_employee_insurance_enrollments_plan ON employee_insurance_enrollments(insurance_plan_id)

**Triggers**
- trg_employee_insurance_enrollments_set_updated_at BEFORE UPDATE
- trg_employee_insurance_enrollments_snapshot_plan BEFORE INSERT — copies plan type, name, coverage and both contribution figures
- trg_employee_insurance_enrollments_resync_salary AFTER INSERT OR UPDATE — refreshes the current salary_structure's two insurance contribution columns and its derived totals

### `insurance_dependents`  _(02-employee)_

Dependents covered under a Health enrolment. Kept as a simple child list rather than a dependents master, since coverage is the only thing that depends on it.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_insurance_enrollment_id` | CHAR(36) | NOT NULL REFERENCES employee_insurance_enrollments(id) ON DELETE CASCADE |  |
| `dependent_name` | TEXT | NOT NULL CHECK (btrim(dependent_name) <> '') |  |
| `relationship` | dependent_relationship | NOT NULL | ENUM ('spouse','child','parent','parent_in_law','sibling','other'). |
| `display_order` | smallint | NOT NULL DEFAULT 0 |  |

**Indexes**
- ix_insurance_dependents_enrollment ON insurance_dependents(employee_insurance_enrollment_id)

**Triggers**
- trg_insurance_dependents_set_updated_at BEFORE UPDATE
- trg_insurance_dependents_guard_plan_type BEFORE INSERT OR UPDATE — raises unless the parent enrolment's plan_type_snapshot = 'health' (spans tables, so a trigger not a CHECK)

### `insurance_nominees`  _(02-employee)_

Nominee(s) on a Life or Personal Accident enrolment — a standard requirement for those plan types, and mandatory when one is held.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_insurance_enrollment_id` | CHAR(36) | NOT NULL REFERENCES employee_insurance_enrollments(id) ON DELETE CASCADE |  |
| `nominee_name` | TEXT | NOT NULL CHECK (btrim(nominee_name) <> '') |  |
| `relationship` | dependent_relationship | NOT NULL |  |
| `contact_phone` | TEXT | CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9][0-9]{9}$') |  |
| `is_primary` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- ux_insurance_nominees_primary UNIQUE ON insurance_nominees(employee_insurance_enrollment_id) WHERE is_primary
- ix_insurance_nominees_enrollment ON insurance_nominees(employee_insurance_enrollment_id)

**Triggers**
- trg_insurance_nominees_set_updated_at BEFORE UPDATE
- trg_insurance_nominees_guard_plan_type BEFORE INSERT OR UPDATE — raises unless the parent enrolment's plan_type_snapshot IN ('life','personal_accident')
- trg_insurance_enrollments_require_nominee AFTER INSERT ON employee_insurance_enrollments (deferred, per statement) — raises when a life/accident enrolment ends the transaction with no nominee row

### `employee_documents`  _(02-employee)_

The employee's own uploaded paperwork and its verification state — the same rows shown on My Documents (2.6), the Documents tab of the Master Record (2.2), and HR's cross-employee Verification Queue.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `document_type` | employee_document_type | NOT NULL | ENUM ('id_proof','educational_certificate','resume','offer_letter_copy','other'). More than one file may share a type. |
| `file_name` | TEXT | NOT NULL |  |
| `storage_key` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `mime_type` | TEXT | NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')) |  |
| `file_size_bytes` | BIGINT | NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880) | 5 MB ceiling, the file-size convention used across this CMS. |
| `note` | TEXT | NULL | Optional context supplied at upload, e.g. 'Degree certificate, page 2 of 2'. |
| `status` | document_verification_status | NOT NULL DEFAULT 'pending_verification' | ENUM ('pending_verification','verified','rejected'). |
| `uploaded_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `uploaded_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `verified_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `verified_at` | DATETIME(6) | NULL |  |
| `rejection_reason` | TEXT | CHECK (status <> 'rejected' OR btrim(coalesce(rejection_reason,'')) <> '') | Rejection requires a reason — the platform-wide default. |
| `source` | document_source | NOT NULL DEFAULT 'employee_upload' | ENUM ('employee_upload','hr_upload'). Keeps the employee-delete rule from being applied to a file HR filed. |

**Indexes**
- ix_employee_documents_employee_status ON employee_documents(employee_id, status)
- ix_employee_documents_queue ON employee_documents(uploaded_at) WHERE status = 'pending_verification'
- ix_employee_documents_type ON employee_documents(document_type)
- ix_employee_documents_verified_by ON employee_documents(verified_by)

**Triggers**
- trg_employee_documents_set_updated_at BEFORE UPDATE
- trg_employee_documents_delete_guard BEFORE DELETE — allows the real DELETE (soft-delete tier 3) only while status = 'pending_verification', or when the acting user holds HR/Super Admin rights; enforces 2.6's delete rule in the database rather than the UI
- trg_employee_documents_notify AFTER UPDATE OF status — writes a notifications row to the owning employee on verify/reject, carrying the rejection reason

### `profile_change_requests`  _(02-employee)_

An employee's requested change to an approval-gated field on My Profile, and HR's decision on it. The old value keeps displaying and staying in effect until approval.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `requested_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `field_key` | profile_change_field | NOT NULL | ENUM ('first_name','last_name','email','date_of_birth','gender','bank_name','bank_account_number','bank_ifsc_code','pan_number','aadhaar_number','statutory_identifier'). A fixed list because the approval-gated group is fixed; no tax is named — a statutory identifier change points at a head via the column below. |
| `target_tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT, CHECK ((field_key = 'statutory_identifier') = (target_tax_head_id IS NOT NULL)) |  |
| `old_value` | TEXT | NULL | Captured at request time so the decision screen shows what it was, even if the record moved for another reason. |
| `requested_value` | TEXT | NOT NULL CHECK (btrim(requested_value) <> '') |  |
| `employee_note` | TEXT | NULL |  |
| `status` | change_request_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','approved','rejected','cancelled'). 'cancelled' is the employee withdrawing it themselves. |
| `decided_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `decided_at` | DATETIME(6) | NULL |  |
| `decision_reason` | TEXT | CHECK (status <> 'rejected' OR btrim(coalesce(decision_reason,'')) <> '') |  |
| `applied_at` | DATETIME(6) | NULL | When the approved value was actually written onto employees / employee_statutory_identifiers. |

**Indexes**
- ux_profile_change_requests_one_pending UNIQUE ON profile_change_requests(employee_id, field_key, coalesce(target_tax_head_id, '00000000-0000-0000-0000-000000000000'::CHAR(36))) WHERE status = 'pending'
- ix_profile_change_requests_queue ON profile_change_requests(created_at) WHERE status = 'pending'
- ix_profile_change_requests_employee ON profile_change_requests(employee_id, created_at DESC)

**Triggers**
- trg_profile_change_requests_set_updated_at BEFORE UPDATE
- trg_profile_change_requests_immutable_after_decision BEFORE UPDATE OR DELETE — raises whenever OLD.status <> 'pending'; this is the append-only rule for this table (immutable after decision)
- trg_profile_change_requests_apply AFTER UPDATE OF status — on 'approved', writes the new value to the target column/row, stamps applied_at, and notifies the employee; on 'rejected', notifies with the reason

### `attendance_records`  _(02-employee)_

ONE row per employee per calendar date — the single Attendance Day Record shared by Employee 2.2 (Record Attendance) and Payroll 2.4 (Day-wise Log). Stores the times entered and every hour figure derived from them, plus the policy that produced them.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `attendance_date` | DATE | NOT NULL |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked() — a locked year's attendance can no longer be edited, which is what makes a processed payroll reproducible. |
| `work_week_policy_id` | CHAR(36) | NOT NULL REFERENCES work_week_policies(id) ON DELETE RESTRICT | WHICH policy produced this row's figures. With several policies in play, 'who is short' is meaningless without it (Payroll 2.4 filter). |
| `policy_name_snapshot` | TEXT | NOT NULL | SNAPSHOT so a renamed or superseded policy still explains an old day. |
| `day_type` | attendance_day_type | NOT NULL | DERIVED — trigger (spans tables: policy weekly-off + Saturday rule + holidays). ENUM ('working_day','working_saturday','weekly_off','mandatory_holiday','optional_holiday'). A Mandatory holiday overrides a working Saturday; an Optional one does not. |
| `saturday_ordinal` | smallint | CHECK (saturday_ordinal IS NULL OR saturday_ordinal BETWEEN 1 AND 5) | Which Saturday of the month, so the odd/even rule's decision is auditable on the row. |
| `holiday_id` | CHAR(36) | REFERENCES holidays(id) ON DELETE RESTRICT | Set when day_type resolved from the Holiday calendar. |
| `saturday_override_id` | CHAR(36) | REFERENCES work_week_saturday_overrides(id) ON DELETE RESTRICT | Set when a single-date override beat the pattern; the override's mandatory Reason is what explains the day. |
| `check_in_time` | time | NULL | The only pay-affecting values typed by hand on this form. NULL on a zero-required day with no attendance. |
| `check_out_time` | time | NULL |  |
| `spans_midnight` | TINYINT(1) | NOT NULL DEFAULT false | Lets check_out_time < check_in_time be a legitimate overnight stretch rather than a data error. |
| `gross_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (gross_hours >= 0) | DERIVED — trigger. Check-Out − Check-In, honouring spans_midnight. |
| `break_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (break_hours >= 0) | The unpaid break actually taken; defaulted from the policy but editable on the form. |
| `net_worked_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (gross_hours - break_hours) STORED NOT NULL | DERIVED — generated column. Single-row, immutable. This is the figure Payroll compares against, never gross. |
| `required_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (required_hours >= 0) | DERIVED — trigger (spans tables: net hours per day from the policy, halved/custom on a working Saturday, zero on a weekly off or Mandatory holiday). |
| `balance_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (gross_hours - break_hours - required_hours) STORED NOT NULL | DERIVED — generated column. Expression repeats net_worked_hours rather than referencing it, because Postgres forbids a generated column referencing another generated column. Negative = the day's shortfall. |
| `day_status` | attendance_day_status | NOT NULL DEFAULT 'not_required' | DERIVED — trigger. ENUM ('full_day','full_day_grace','half_day','absent','not_required'). Resolved by the policy's hour bands, not by whether someone turned up. |
| `net_hours_per_day_snapshot` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | SNAPSHOT of the band inputs, so the resolved status stays explainable after the policy is edited. |
| `grace_window_minutes_snapshot` | INT | NOT NULL DEFAULT 0 |  |
| `half_day_threshold_hours_snapshot` | DECIMAL(6,2) | NULL |  |
| `leave_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (leave_credit_hours >= 0) | DERIVED — trigger (spans tables: an approved leave_request covering this date × net hours per day). Approved leave is credited, not treated as absence. |
| `leave_request_id` | CHAR(36) | REFERENCES leave_requests(id) ON DELETE RESTRICT | Which approved request produced the credit. |
| `compensatory_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (compensatory_credit_hours >= 0) | DERIVED — trigger from approved compensatory_hour_requests. An 'of which' subset of worked hours on the make-up day, never an addition — counting them twice would silently overpay. |
| `is_compensatory_makeup_day` | TINYINT(1) | NOT NULL DEFAULT false | True on the day the employee chose to work the hours back. |
| `shortfall_cleared_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (shortfall_cleared_hours >= 0) | On a shortfall day: how much of it an approved request has cleared. A partial make-up clears only its own hours; the remainder still deducts. |
| `source` | attendance_source | NOT NULL DEFAULT 'manual_entry' | ENUM ('manual_entry','biometric_device','external_hr_system','mobile_checkin'). Turning Biometric from Coming Soon to live changes only this and recorded_by_*. |
| `recorded_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | NULL when a device wrote the row — precisely why 'Recorded By' was never modelled as a strict user reference. |
| `recorded_by_label` | TEXT | NOT NULL | What actually displays in the Recorded By column: a person's name today, 'Biometric — Chennai Office' later. |
| `recorded_by_device_id` | TEXT | NULL |  |
| `office_location_address_id` | CHAR(36) | REFERENCES company_addresses(id) ON DELETE RESTRICT | Which office the event came from — required once two locations feed one system. |
| `note` | TEXT | NULL | The Note column of Payroll's Day-wise Log. |

**Indexes**
- ux_attendance_records_employee_date UNIQUE ON attendance_records(employee_id, attendance_date)
- ix_attendance_records_date ON attendance_records(attendance_date)
- ix_attendance_records_employee_recent ON attendance_records(employee_id, attendance_date DESC)
- ix_attendance_records_policy ON attendance_records(work_week_policy_id)
- ix_attendance_records_financial_year ON attendance_records(financial_year_id)
- ix_attendance_records_shortfalls ON attendance_records(employee_id, attendance_date) WHERE balance_hours < 0
- ix_attendance_records_status ON attendance_records(day_status)

**Triggers**
- trg_attendance_records_set_updated_at BEFORE UPDATE
- trg_attendance_records_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_attendance_records_resolve_day BEFORE INSERT OR UPDATE — resolves the covering work_week_policy, snapshots it, resolves day_type (holiday > Saturday override > Saturday pattern > weekly off), computes gross_hours and required_hours, and lands day_status in an hour band
- trg_attendance_records_apply_comp_credit AFTER UPDATE OF compensatory_credit_hours — re-resolves day_status, lifting a Half Day back to Full Day once an approved make-up covers the shortfall

### `announcements`  _(02-employee)_

A company-wide or department-scoped announcement posted by HR/Super Admin, feeding the Announcements list and the Dashboard mini feed.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `title` | TEXT | NOT NULL CHECK (btrim(title) <> '') |  |
| `message` | TEXT | NOT NULL CHECK (btrim(message) <> '') |  |
| `target_scope` | announcement_target_scope | NOT NULL | ENUM ('all_employees','department'). 'department' requires at least one announcement_targets row. |
| `posted_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | The 'Posted By' filter on the full-page list. |
| `published_at` | DATETIME(6) | NULL |  |
| `expiry_date` | DATE | NULL | After which it stops showing on dashboards. NULL = never expires. |
| `status` | announcement_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','published','archived'). Soft-delete tier 2. Active-vs-Expired is NOT stored — it depends on CURRENT_DATE, so it is a view/service predicate (status='published' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), never a typed or generated column. |

**Indexes**
- ix_announcements_feed ON announcements(published_at DESC) WHERE status = 'published'
- ix_announcements_expiry ON announcements(expiry_date) WHERE status = 'published'
- ix_announcements_posted_by ON announcements(posted_by_user_id)
- `ix_announcements_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_announcements_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_announcements_set_updated_at BEFORE UPDATE
- trg_announcements_require_target BEFORE INSERT OR UPDATE OF status — raises when publishing a 'department'-scoped announcement with no announcement_targets row
- trg_announcements_fanout_notifications AFTER UPDATE OF status — on publish, writes one notifications row per employee in scope

### `announcement_targets`  _(02-employee)_

The departments a department-scoped announcement was posted to. A child table rather than a column so 'a specific Department' can become two without a migration.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `announcement_id` | CHAR(36) | NOT NULL REFERENCES announcements(id) ON DELETE CASCADE |  |
| `department_id` | CHAR(36) | NOT NULL REFERENCES departments(id) ON DELETE RESTRICT |  |

**Indexes**
- ux_announcement_targets UNIQUE ON announcement_targets(announcement_id, department_id)
- ix_announcement_targets_department ON announcement_targets(department_id)

**Triggers**
- trg_announcement_targets_set_updated_at BEFORE UPDATE

### `notifications`  _(02-employee)_

Per-user personal notifications generated by events across the system — the bell icon, its unread count, and the My Notifications list.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `recipient_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `notification_type` | notification_type | NOT NULL | ENUM ('leave','document','payslip','ticket','task','asset','profile_change','announcement','compensatory_hours','onboarding','exit','tax_declaration'). Backs the Type multi-select filter. |
| `title` | TEXT | NOT NULL |  |
| `body` | TEXT | NOT NULL |  |
| `source_module` | TEXT | NOT NULL | Which module raised it, e.g. '05-leave'. |
| `source_record_id` | CHAR(36) | NULL | Deliberately NOT a foreign key — a notification points at rows in a dozen tables and must survive whichever one it names. |
| `deep_link_path` | TEXT | NULL | Where clicking it navigates. |
| `is_read` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `read_at` | DATETIME(6) | CHECK ((read_at IS NULL) = (NOT is_read)) |  |
| `email_send_log_id` | CHAR(36) | REFERENCES email_send_log(id) ON DELETE RESTRICT | Set when the same event also went out by email, so the in-app and email halves of one notification are traceable to each other. |

**Indexes**
- ix_notifications_unread ON notifications(recipient_user_id, created_at DESC) WHERE NOT is_read
- ix_notifications_recipient ON notifications(recipient_user_id, created_at DESC)
- ix_notifications_type ON notifications(recipient_user_id, notification_type)

**Triggers**
- trg_notifications_set_updated_at BEFORE UPDATE
- trg_notifications_stamp_read BEFORE UPDATE OF is_read — sets/clears read_at so the CHECK above can never be violated by a partial update

### `resignations`  _(02-employee)_

One employee's resignation, from submission through Manager acknowledgment to the completed exit. Owns the Last Working Day and the final-settlement flag; the checklist steps hang off it.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `last_working_day` | DATE | NOT NULL | As stated by the employee. 'Must be after today' is validated at submit; not a CHECK, because the row must remain updatable after that date passes. |
| `reason` | TEXT | NULL |  |
| `submitted_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `submitted_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | Any of the 5 roles may raise their own. |
| `status` | resignation_status | NOT NULL DEFAULT 'submitted' | ENUM ('submitted','manager_acknowledged','hr_processing','withdrawn','completed'). Soft-delete tier 2. |
| `manager_acknowledgement_required` | TINYINT(1) | NOT NULL DEFAULT true | SNAPSHOT of the RBAC toggle 'Require Manager Acknowledgment Before HR Processes Exit' as it stood when this resignation was raised — so flipping the toggle later never retroactively unlocks or relocks a live exit. |
| `acknowledged_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `acknowledged_at` | DATETIME(6) | NULL |  |
| `acknowledgement_note` | TEXT | NULL |  |
| `exit_checklist_activated_at` | DATETIME(6) | NULL | When step 1 moved from locked to open. |
| `final_last_working_day` | DATE | NULL | The date fixed by the resignation acceptance letter — which is the whole reason the letter gates asset return. Defaults from last_working_day. |
| `final_settlement_status` | final_settlement_status | NOT NULL DEFAULT 'not_due' | ENUM ('not_due','due','paid'). The HR exit list's 'Final Settlement Status' column. The calculation itself belongs to Payroll/Expense; this only records that one is owed and whether it has been marked paid. |
| `final_settlement_marked_at` | DATETIME(6) | NULL |  |
| `final_settlement_paid_at` | DATETIME(6) | NULL |  |
| `completed_at` | DATETIME(6) | NULL |  |

**Indexes**
- ux_resignations_one_open UNIQUE ON resignations(employee_id) WHERE status IN ('submitted','manager_acknowledged','hr_processing')
- ix_resignations_status ON resignations(status)
- ix_resignations_last_working_day ON resignations(last_working_day)
- ix_resignations_employee ON resignations(employee_id, submitted_at DESC)

**Triggers**
- trg_resignations_set_updated_at BEFORE UPDATE
- trg_resignations_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_resignations_seed_exit_checklist AFTER INSERT — inserts the five exit_checklist_steps rows with their ordinals and gated_by_step_id wiring already set
- trg_resignations_activate_checklist AFTER UPDATE OF status — on 'manager_acknowledged' (or immediately when manager_acknowledgement_required is false), opens step 1 and notifies HR
- trg_resignations_set_employee_on_notice AFTER INSERT — moves employees.employment_status to 'on_notice'

### `exit_checklist_steps`  _(02-employee)_

The five HR exit steps for one resignation, with the sequencing lock modelled in the database: a self-FK gate plus an ordinal, so the order is a rule the schema enforces rather than a convention the UI hopes for.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `resignation_id` | CHAR(36) | NOT NULL REFERENCES resignations(id) ON DELETE CASCADE |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Denormalized from the parent so HR's cross-employee exit view and per-employee scoping never need the join; kept consistent by trigger. |
| `step_key` | exit_checklist_step_key | NOT NULL | ENUM ('resignation_acceptance_letter','return_all_assets','mark_final_settlement_due','disable_login','mark_exited'). |
| `ordinal` | smallint | NOT NULL CHECK (ordinal BETWEEN 1 AND 5) | 1 letter, 2 assets, 3 settlement, 4 disable login, 5 mark exited. |
| `gated_by_step_id` | CHAR(36) | REFERENCES exit_checklist_steps(id) ON DELETE RESTRICT, CHECK ((gated_by_step_id IS NULL) = (ordinal = 1)) | THE GATE, stored explicitly. Step 2 is gated by step 1. Steps 3, 4 and 5 are ALL gated by step 2 — not by each other — which is exactly the spec: everything after asset return may proceed in any order, but none of it may start before the assets are back. Only step 1 has a NULL gate. |
| `status` | exit_step_status | NOT NULL DEFAULT 'locked' | ENUM ('locked','open','done','not_applicable'). A step is 'locked' until its gate is done; it can never be set 'done' from 'locked'. |
| `outstanding_asset_count` | INT | NOT NULL DEFAULT 0 CHECK (outstanding_asset_count >= 0) | DERIVED — trigger (spans tables: assets assigned to this employee not yet Returned or Retired, from Asset Management). Only meaningful on the 'return_all_assets' step. There is no partial-exit state: the step completes only at zero. |
| `linked_offer_letter_id` | CHAR(36) | REFERENCES offer_letters(id) ON DELETE RESTRICT | On step 1: the generated resignation acceptance letter. Step 1 cannot be 'done' without it — the letter existing is what fixes the Last Working Day the asset deadline counts back from. |
| `completed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `completed_at` | DATETIME(6) | CHECK ((completed_at IS NULL) = (status <> 'done')) |  |
| `completion_note` | TEXT | NULL |  |
| `confirmation_acknowledged` | TINYINT(1) | NOT NULL DEFAULT false | Records that the confirm-before-you-go prompt was actually answered for the two irreversible-feeling steps (disable login, mark Exited). |

**Indexes**
- ux_exit_checklist_steps_key UNIQUE ON exit_checklist_steps(resignation_id, step_key)
- ux_exit_checklist_steps_ordinal UNIQUE ON exit_checklist_steps(resignation_id, ordinal)
- ix_exit_checklist_steps_gate ON exit_checklist_steps(gated_by_step_id)
- ix_exit_checklist_steps_open ON exit_checklist_steps(resignation_id, ordinal) WHERE status IN ('locked','open')
- ix_exit_checklist_steps_assets_outstanding ON exit_checklist_steps(employee_id) WHERE step_key = 'return_all_assets' AND outstanding_asset_count > 0

**Triggers**
- trg_exit_checklist_steps_set_updated_at BEFORE UPDATE
- trg_exit_checklist_steps_enforce_gate BEFORE UPDATE — the lock itself, and the reason this is not left to application code. It raises when: (a) status moves to 'open' or 'done' while gated_by_step_id's status is not 'done'; (b) step_key = 'resignation_acceptance_letter' is set 'done' with linked_offer_letter_id NULL; (c) step_key = 'return_all_assets' is set 'done' with outstanding_asset_count > 0; (d) any step is moved backwards out of 'done'
- trg_exit_checklist_steps_cascade_unlock AFTER UPDATE OF status — when a step reaches 'done', flips every step gated by it from 'locked' to 'open'. Completing step 2 therefore opens 3, 4 and 5 together
- trg_exit_checklist_steps_apply_effects AFTER UPDATE OF status — 'disable_login' done disables the linked users row; 'mark_exited' done sets employees.employment_status = 'exited' and employees.exit_date; 'mark_final_settlement_due' done stamps resignations.final_settlement_status = 'due'
- trg_exit_checklist_steps_complete_resignation AFTER UPDATE OF status — sets resignations.status = 'completed' once all five are done or not_applicable

### `onboarding_checklist_items`  _(02-employee)_

The seven onboarding steps for one new employee, most auto-checked when the linked action completes elsewhere. Unlike the exit checklist these are reminders, not gates — deliberately, since onboarding order is advisory.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE CASCADE |  |
| `step_key` | onboarding_step_key | NOT NULL | ENUM ('create_employee_record','create_login','assign_reporting_manager','setup_leave_balance','link_salary_structure','assign_starter_assets','send_welcome_email'). |
| `ordinal` | smallint | NOT NULL CHECK (ordinal BETWEEN 1 AND 7) |  |
| `status` | onboarding_step_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','complete','skipped'). 'skipped' exists for step 2 — an employee who deliberately gets no system access yet. |
| `is_auto_checked` | TINYINT(1) | NOT NULL DEFAULT true | False only for 'send_welcome_email', the one manually triggered step. |
| `completed_at` | DATETIME(6) | CHECK ((completed_at IS NULL) = (status = 'pending')) |  |
| `completed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `skipped_reason` | TEXT | CHECK (status <> 'skipped' OR btrim(coalesce(skipped_reason,'')) <> '') |  |
| `note` | TEXT | NULL | e.g. the 'flagged for Payroll to complete' note on the salary-structure step. |

**Indexes**
- ux_onboarding_checklist_items UNIQUE ON onboarding_checklist_items(employee_id, step_key)
- ix_onboarding_checklist_items_incomplete ON onboarding_checklist_items(employee_id, ordinal) WHERE status = 'pending'
- ix_onboarding_checklist_items_step_status ON onboarding_checklist_items(step_key, status)

**Triggers**
- trg_onboarding_checklist_items_set_updated_at BEFORE UPDATE
- trg_onboarding_checklist_items_stamp BEFORE UPDATE OF status — sets/clears completed_at
- trg_onboarding_checklist_items_rollup AFTER UPDATE OF status — sets employees.onboarding_completed_at once all seven are complete or skipped (spans rows, so a trigger)

### `employee_tax_scheme_elections`  _(02-employee)_

Which tax scheme an employee is assessed under for a financial year, and the history of that choice. Exists as its own table because a scheme change mid-year must not silently rewrite the declaration it was made against.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `tax_scheme_id` | CHAR(36) | NOT NULL REFERENCES tax_schemes(id) ON DELETE RESTRICT | Masters 3.2d. If no schemes exist, no row is ever created and the whole concept disappears from the interface. |
| `scheme_name_snapshot` | TEXT | NOT NULL |  |
| `choice_window_snapshot` | tax_scheme_choice_window | NOT NULL | ENUM ('once_per_financial_year','changeable_any_time','fixed_at_joining'). SNAPSHOT — when the employee was allowed to switch is judged against the rule in force at election time. |
| `was_default` | TINYINT(1) | NOT NULL DEFAULT false | True when the employee never actively chose and fell to the Is Default scheme. |
| `elected_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `elected_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `superseded_at` | DATETIME(6) | NULL |  |
| `superseded_by_election_id` | CHAR(36) | REFERENCES employee_tax_scheme_elections(id) ON DELETE RESTRICT |  |

**Indexes**
- ux_employee_tax_scheme_elections_current UNIQUE ON employee_tax_scheme_elections(employee_id, financial_year_id) WHERE superseded_at IS NULL
- ix_employee_tax_scheme_elections_scheme ON employee_tax_scheme_elections(tax_scheme_id)
- ix_employee_tax_scheme_elections_employee ON employee_tax_scheme_elections(employee_id, financial_year_id)

**Triggers**
- trg_employee_tax_scheme_elections_set_updated_at BEFORE UPDATE
- trg_employee_tax_scheme_elections_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_employee_tax_scheme_elections_supersede BEFORE INSERT — closes the prior current election and enforces the snapshotted choice window (raises on a second election in a year when the window is 'once_per_financial_year')

### `tax_declarations`  _(02-employee)_

One employee's declaration for one financial year — the header carrying scheme, status and totals. The screen it backs knows the name of no deduction.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `tax_scheme_election_id` | CHAR(36) | REFERENCES employee_tax_scheme_elections(id) ON DELETE RESTRICT | NULL when no schemes are configured at all — which is a real state, not a missing value. |
| `status` | tax_declaration_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','submitted','verified'). Payroll uses Submitted figures from the next run onward; Verified is an audit trail, deliberately not a blocking gate. |
| `submitted_at` | DATETIME(6) | CHECK ((submitted_at IS NULL) = (status = 'draft')) |  |
| `submitted_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `verified_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | HR or Accountant. |
| `verified_at` | DATETIME(6) | NULL |  |
| `verification_note` | TEXT | NULL |  |
| `total_declared_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger (spans rows: sum of all lines, including the catch-all). |
| `total_eligible_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger. Sum of amount_accepted_for_calculation across lines whose head reduces taxable income. Excludes the uncategorized catch-all, which never silently reduces tax. |
| `has_flagged_lines` | TINYINT(1) | NOT NULL DEFAULT false | DERIVED — trigger. Surfaces a declaration needing HR/Accountant attention in the verification list. |

**Indexes**
- ux_tax_declarations_employee_fy UNIQUE ON tax_declarations(employee_id, financial_year_id)
- ix_tax_declarations_status ON tax_declarations(financial_year_id, status)
- ix_tax_declarations_flagged ON tax_declarations(financial_year_id) WHERE has_flagged_lines

**Triggers**
- trg_tax_declarations_set_updated_at BEFORE UPDATE
- trg_tax_declarations_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_tax_declarations_submit_lock BEFORE UPDATE — once status leaves 'draft', refuses any change to tax_scheme_election_id and refuses a return to 'draft'; the paired line-level guard is trg_tax_declaration_lines_locked_after_submit

### `tax_declaration_lines`  _(02-employee)_

One declared amount per configured declaration head, plus the single fixed-name catch-all row. Every head attribute is snapshotted so a submitted declaration reproduces after the head is edited.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tax_declaration_id` | CHAR(36) | NOT NULL REFERENCES tax_declarations(id) ON DELETE CASCADE |  |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT, CHECK ((is_other_catch_all) = (tax_head_id IS NULL)) | NULL only on the catch-all row. |
| `is_other_catch_all` | TINYINT(1) | NOT NULL DEFAULT false | The 'Other Declared Deduction' row — the only field on this screen with a fixed name, present regardless of configuration. |
| `declaration_name_snapshot` | TEXT | NOT NULL | SNAPSHOT of the head's Tax Name, or the literal catch-all label. |
| `guidance_snapshot` | TEXT | NULL | SNAPSHOT of the head's Description, shown as helper TEXT — so an employee later re-reading their own declaration sees the guidance they actually declared against. |
| `declaration_cap_snapshot` | DECIMAL(14,2) | CHECK (declaration_cap_snapshot IS NULL OR declaration_cap_snapshot >= 0) |  |
| `requires_proof_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `reduces_taxable_income_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `amount_declared` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (amount_declared >= 0), CHECK (declaration_cap_snapshot IS NULL OR amount_declared <= declaration_cap_snapshot) | Exceeding the cap blocks Submit rather than silently trimming — enforced here as a CHECK, not a service rule. |
| `other_description` | TEXT | CHECK (NOT is_other_catch_all OR btrim(coalesce(other_description,'')) <> '') | Mandatory on the catch-all: an uncategorized amount is only accepted with a description against it. |
| `amount_accepted_for_calculation` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (amount_accepted_for_calculation >= 0) | What Payroll actually subtracts. Stays 0 on the catch-all until HR/Accountant categorizes it — the deliberately conservative assumption in 2.14. |
| `flagged_for_review` | TINYINT(1) | NOT NULL DEFAULT false | Set automatically on every catch-all row. |
| `verification_status` | declaration_line_verification_status | NOT NULL DEFAULT 'not_reviewed' | ENUM ('not_reviewed','proof_matches','proof_missing','rejected'). |
| `verification_note` | TEXT | NULL |  |
| `display_order` | smallint | NOT NULL DEFAULT 0 |  |

**Indexes**
- ux_tax_declaration_lines_head UNIQUE ON tax_declaration_lines(tax_declaration_id, tax_head_id) WHERE tax_head_id IS NOT NULL
- ux_tax_declaration_lines_one_catch_all UNIQUE ON tax_declaration_lines(tax_declaration_id) WHERE is_other_catch_all
- ix_tax_declaration_lines_declaration ON tax_declaration_lines(tax_declaration_id)
- ix_tax_declaration_lines_head ON tax_declaration_lines(tax_head_id)

**Triggers**
- trg_tax_declaration_lines_set_updated_at BEFORE UPDATE
- trg_tax_declaration_lines_locked_after_submit BEFORE INSERT OR UPDATE OR DELETE — refuses any change once the parent declaration has left 'draft', except to the verification_* columns and amount_accepted_for_calculation
- trg_tax_declaration_lines_require_proof BEFORE UPDATE — on submit, raises when requires_proof_snapshot is true and the line has no tax_declaration_line_proofs row
- trg_tax_declaration_lines_rollup AFTER INSERT OR UPDATE OR DELETE — recomputes the parent's two totals and has_flagged_lines

### `tax_declaration_line_proofs`  _(02-employee)_

Uploaded proof files backing one declared line. Multiple per line, mandatory where the head requires proof.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tax_declaration_line_id` | CHAR(36) | NOT NULL REFERENCES tax_declaration_lines(id) ON DELETE CASCADE |  |
| `file_name` | TEXT | NOT NULL |  |
| `storage_key` | VARCHAR(191) | NOT NULL UNIQUE |  |
| `mime_type` | TEXT | NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')) |  |
| `file_size_bytes` | BIGINT | NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880) | 5 MB each, matching the file-size convention used elsewhere. |
| `uploaded_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `uploaded_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |

**Indexes**
- ix_tax_declaration_line_proofs_line ON tax_declaration_line_proofs(tax_declaration_line_id)

**Triggers**
- trg_tax_declaration_line_proofs_set_updated_at BEFORE UPDATE
- trg_tax_declaration_line_proofs_locked_after_submit BEFORE INSERT OR DELETE — refuses changes once the grandparent declaration has left 'draft'

### `offer_letters`  _(02-employee)_

An HR-generated official letter for one employee — Offer, Appointment, or the resignation acceptance letter that gates the exit checklist. Snapshots everything it printed so the letter and the later payslip can never disagree.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Usable before the record is Active — an offer normally goes out before someone joins. |
| `letter_number` | VARCHAR(191) | NOT NULL UNIQUE | Full rendered code from document_number_sequences keyed (code_type, financial_year_id). |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `letter_type` | letter_type | NOT NULL | ENUM ('offer_letter','appointment_letter','resignation_acceptance_letter'). The third belongs here because 2.13 step 1 explicitly generates it 'using the letter screen'. |
| `resignation_id` | CHAR(36) | REFERENCES resignations(id) ON DELETE RESTRICT, CHECK ((letter_type = 'resignation_acceptance_letter') = (resignation_id IS NOT NULL)) |  |
| `designation_snapshot` | TEXT | NOT NULL |  |
| `department_snapshot` | TEXT | NOT NULL |  |
| `employment_type_snapshot` | TEXT | NOT NULL |  |
| `joining_date_snapshot` | DATE | NULL |  |
| `last_working_day_snapshot` | DATE | CHECK (letter_type <> 'resignation_acceptance_letter' OR last_working_day_snapshot IS NOT NULL) | This is the value that FIXES the Last Working Day — the fact the asset-return deadline counts back from, and the reason the letter gates it. |
| `salary_structure_id` | CHAR(36) | REFERENCES salary_structures(id) ON DELETE RESTRICT | The exact structure version the letter quoted. Its salary_structure_statutory_lines ARE the 'Statutory Components Disclosed' block — modelled as a reference rather than a JSONB blob, so the letter and the payslip read the same snapshot rows. |
| `basic_salary_snapshot` | DECIMAL(14,2) | NULL |  |
| `hra_snapshot` | DECIMAL(14,2) | NULL |  |
| `gross_monthly_snapshot` | DECIMAL(14,2) | NULL |  |
| `annual_ctc_snapshot` | DECIMAL(14,2) | NULL |  |
| `status` | letter_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','generated','sent'). Soft-delete tier 2. |
| `generated_at` | DATETIME(6) | NULL |  |
| `generated_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `pdf_storage_key` | TEXT | NULL |  |
| `pdf_file_name` | TEXT | NULL |  |
| `sent_at` | DATETIME(6) | NULL |  |
| `sent_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `sent_to_email` | TEXT | NULL |  |
| `email_send_log_id` | CHAR(36) | REFERENCES email_send_log(id) ON DELETE RESTRICT | 'Send to Employee' requires the same explicit-permission pattern as any other outbound message; the append-only send log is where that lands. |

**Indexes**
- ux_offer_letters_number UNIQUE ON offer_letters(letter_number)
- ux_offer_letters_one_acceptance UNIQUE ON offer_letters(resignation_id) WHERE letter_type = 'resignation_acceptance_letter'
- ix_offer_letters_employee_type ON offer_letters(employee_id, letter_type)
- ix_offer_letters_status ON offer_letters(status)

**Triggers**
- trg_offer_letters_set_updated_at BEFORE UPDATE
- trg_offer_letters_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_offer_letters_allocate_number BEFORE INSERT — allocates letter_number from document_number_sequences, FOR UPDATE
- trg_offer_letters_snapshot_compensation BEFORE INSERT — copies designation/department/employment type and the four compensation figures from the current salary_structure
- trg_offer_letters_queue_custom_terms AFTER UPDATE OF status — on 'generated', queues every offer_letter_custom_terms row as an ad-hoc payslip adjustment effective from the joining date
- trg_offer_letters_complete_exit_step AFTER UPDATE OF status — on a generated acceptance letter, links and completes exit_checklist_steps step 1, unlocking asset return

### `offer_letter_custom_terms`  _(02-employee)_

Per-hire negotiated terms on a letter — a signing bonus, relocation allowance, probation adjustment — each queued automatically as an ad-hoc payslip adjustment so nothing has to be re-entered in Payroll.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `offer_letter_id` | CHAR(36) | NOT NULL REFERENCES offer_letters(id) ON DELETE CASCADE |  |
| `label` | TEXT | NOT NULL CHECK (btrim(label) <> '') | The same Label that later prints on the payslip — deliberately, so the letter and the payslip name the same thing. |
| `adjustment_type` | adhoc_adjustment_type | NOT NULL | ENUM ('addition','subtraction'). Same field shape as Payroll's Ad-hoc Payslip Adjustments, on purpose. |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) |  |
| `is_recurring` | TINYINT(1) | NOT NULL DEFAULT false | A one-time term is spent by the first run that picks it up; a recurring one stays queued. |
| `is_taxable` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `effective_from` | DATE | NOT NULL | Defaults to the employee's joining date. If the record is not yet Active the queued adjustment simply waits. |
| `queued_adjustment_id` | CHAR(36) | REFERENCES payslip_adhoc_adjustments(id) ON DELETE RESTRICT | Owned by Payroll 2.1a. Populated by trg_offer_letters_queue_custom_terms; its presence is what makes the queueing verifiable rather than assumed. |
| `queued_at` | DATETIME(6) | NULL |  |
| `display_order` | smallint | NOT NULL DEFAULT 0 |  |

**Indexes**
- ix_offer_letter_custom_terms_letter ON offer_letter_custom_terms(offer_letter_id)
- ix_offer_letter_custom_terms_unqueued ON offer_letter_custom_terms(offer_letter_id) WHERE queued_adjustment_id IS NULL

**Triggers**
- trg_offer_letter_custom_terms_set_updated_at BEFORE UPDATE
- trg_offer_letter_custom_terms_lock_after_generate BEFORE INSERT OR UPDATE OR DELETE — refuses changes once the parent letter has left 'draft', since the term has by then been promised in writing and queued

### `leave_requests`  _(05-leave)_

One leave application, its routing, and its decision. The authoritative record behind My Leave (05 §2.1), the Approvals queue (05 §2.2) and Employee 2.4.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Always the logged-in person on the apply screen — the Employee field is read-only, which is what makes it 'my' leave. |
| `leave_type_id` | CHAR(36) | NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT | Masters 3.4. Deactivating a type never breaks history. |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `from_date` | DATE | NOT NULL |  |
| `to_date` | DATE | NOT NULL CHECK (to_date >= from_date) |  |
| `is_half_day` | TINYINT(1) | NOT NULL DEFAULT false, CHECK (NOT is_half_day OR from_date = to_date) |  |
| `half_day_session` | half_day_session | CHECK ((half_day_session IS NOT NULL) = is_half_day) | ENUM ('first_half','second_half'). |
| `days_requested` | DECIMAL(5,2) | NOT NULL CHECK (days_requested > 0 AND days_requested * 2 = floor(days_requested * 2)) | DERIVED — trigger (spans tables: working days between the dates, excluding weekly off days and Mandatory holidays per the covering work-week policy and the Holiday calendar, minus 0.5 for a half day). Half-day-capable day count, so DECIMAL(5,2) with the half-step CHECK. |
| `working_days_basis_policy_id` | CHAR(36) | NOT NULL REFERENCES work_week_policies(id) ON DELETE RESTRICT | WHICH policy decided which dates actually consumed a balance — the Saturday rule differs by policy, so the count is meaningless without it. |
| `reason` | TEXT | NOT NULL CHECK (btrim(reason) <> '') | Searchable — the free-TEXT search on both My Leave history and the Approvals queue covers this. |
| `paid_type_snapshot` | leave_paid_type | NOT NULL | ENUM ('paid','unpaid'). SNAPSHOT of the leave type's Paid/Unpaid at apply time — this is what Payroll deducts on, and re-reading a since-edited master would silently change an old payslip. |
| `status` | leave_request_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','approved','rejected','cancelled'). Soft-delete tier 2 — a request is never deleted. |
| `routed_to_role` | leave_routing_target | NOT NULL | ENUM ('reporting_manager','hr','super_admin'). The 'Routed To' column — HR's company-wide queue needs to show whose turn it normally is even though HR can act on anything. |
| `routed_to_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | The specific person for the reporting-manager case; NULL for a role-level queue. |
| `routing_reason` | TEXT | NOT NULL | Which branch of the routing rule fired — no reporting manager set, applicant is Manager/Accountant/HR, HR unavailable, applicant is the only active HR user. Stored so a routing decision is auditable rather than reconstructed. |
| `applied_at` | DATETIME(6) | NOT NULL DEFAULT now() | Backs the 'pending more than N days' toggle — the failure mode this queue actually has. |
| `actioned_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | The 'Actioned By' / 'Approved By' column. |
| `actioned_at` | DATETIME(6) | NULL | The 'Date Actioned' column. |
| `decision_reason` | TEXT | CHECK (status <> 'rejected' OR btrim(coalesce(decision_reason,'')) <> '') | Rejection reason is required, not optional — flipped system-wide. |
| `cancelled_at` | DATETIME(6) | NULL |  |
| `cancelled_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | Only the applicant, and only while still Pending. |
| `reassigned_from_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | HR's standing override includes reassigning a request; this records where it came from. |
| `reassigned_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `reassigned_at` | DATETIME(6) | NULL |  |
| `hr_co_approval_required` | TINYINT(1) | NOT NULL DEFAULT false | SNAPSHOT of the 'Require HR Co-Approval for Leave Longer Than X Days' RBAC toggle and its threshold as they stood at apply time. |
| `hr_co_approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `hr_co_approved_at` | DATETIME(6) | NULL |  |

**Indexes**
- **No MySQL equivalent (see D0.2)** — overlapping pending leave for one employee is blocked by a BEFORE INSERT/UPDATE trigger plus a service-layer check
- ix_leave_requests_queue ON leave_requests(routed_to_user_id, applied_at) WHERE status = 'pending'
- ix_leave_requests_pending_role ON leave_requests(routed_to_role, applied_at) WHERE status = 'pending'
- ix_leave_requests_employee_dates ON leave_requests(employee_id, from_date DESC)
- ix_leave_requests_type ON leave_requests(leave_type_id, status)
- ix_leave_requests_financial_year ON leave_requests(financial_year_id, status)
- ix_leave_requests_actioned_by ON leave_requests(actioned_by)

**Triggers**
- trg_leave_requests_set_updated_at BEFORE UPDATE
- trg_leave_requests_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_leave_requests_compute_days BEFORE INSERT OR UPDATE OF from_date, to_date, is_half_day — resolves the covering policy and computes days_requested from working days minus Mandatory holidays
- trg_leave_requests_block_insufficient_balance BEFORE INSERT — the hard block: raises with the exact shortfall ('You have 2 days remaining for Casual Leave, but requested 4') when days_requested > remaining_days. Skipped entirely for a leave type whose quota is 0 (Remaining shows 'Not tracked'). There is no submit-anyway path, so this lives in the database
- trg_leave_requests_route BEFORE INSERT — applies the routing rule and fills routed_to_role, routed_to_user_id and routing_reason
- trg_leave_requests_block_self_approval BEFORE UPDATE OF status — raises when actioned_by belongs to the applicant
- trg_leave_requests_sync_balance AFTER INSERT OR UPDATE OF status — moves days between leave_balances.pending_days and taken_days; a cancel or reject returns them to Remaining immediately, since they were only ever held in Pending
- trg_leave_requests_credit_attendance AFTER UPDATE OF status — on approve, writes leave_credit_hours onto each covered attendance_records row
- trg_leave_requests_notify AFTER UPDATE OF status — in-app + email to the applicant on approve/reject, carrying the reason

### `leave_balances`  _(05-leave)_

One balance row per employee per leave type per financial year — the five-column balance panel that is the first thing anyone sees in this module.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `leave_type_id` | CHAR(36) | NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `allowed_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (allowed_days >= 0 AND allowed_days * 2 = floor(allowed_days * 2)) | This year's fresh quota, prorated on joining: (default quota / 12) × months remaining from joining_date, rounded to the nearest half-day. |
| `carried_forward_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (carried_forward_days >= 0 AND carried_forward_days * 2 = floor(carried_forward_days * 2)) | Written only by a committed carry-forward run — nobody types this in. |
| `adjustment_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (adjustment_days * 2 = floor(adjustment_days * 2)) | DERIVED — trigger (spans rows: net sum of leave_balance_adjustments). May be negative. Kept as its own column rather than folded into allowed_days so the panel can always explain where a number came from. |
| `taken_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (taken_days >= 0 AND taken_days * 2 = floor(taken_days * 2)) | DERIVED — trigger. Every Approved request for this type, whether the dates are past or still upcoming — the explicit definition in 05 §7.1. |
| `pending_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (pending_days >= 0 AND pending_days * 2 = floor(pending_days * 2)) | DERIVED — trigger. Days held by requests still awaiting a decision; never deducted from Taken. |
| `remaining_days` | DECIMAL(5,2) | GENERATED ALWAYS AS (allowed_days + carried_forward_days + adjustment_days - taken_days - pending_days) STORED NOT NULL | DERIVED — generated column. Single-row, immutable. The one figure the hard block is judged against. |
| `is_quota_tracked` | TINYINT(1) | NOT NULL DEFAULT true | False when the type's Default Annual Quota is 0 (e.g. WFH). Remaining then displays 'Not tracked' and the balance check does not apply — a real state, not a zero. |
| `default_annual_quota_snapshot` | DECIMAL(5,2) | NOT NULL DEFAULT 0 | SNAPSHOT at allocation time, so changing the master mid-year never silently restates a granted balance. |
| `carry_forward_allowed_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `max_carry_forward_days_snapshot` | DECIMAL(5,2) | CHECK (max_carry_forward_days_snapshot IS NULL OR max_carry_forward_days_snapshot >= 0) |  |
| `prorated_from_date` | DATE | NULL | The joining date the proration ran from; NULL for a full-year allocation. |
| `proration_months` | DECIMAL(6,3) | CHECK (proration_months IS NULL OR proration_months >= 0) | Months remaining in the FY used by the formula — stored so a disputed first-year balance can be re-derived exactly. |

**Indexes**
- ux_leave_balances UNIQUE ON leave_balances(employee_id, leave_type_id, financial_year_id)
- ix_leave_balances_fy_type ON leave_balances(financial_year_id, leave_type_id)
- ix_leave_balances_negative ON leave_balances(financial_year_id) WHERE remaining_days < 0
- ix_leave_balances_employee ON leave_balances(employee_id, financial_year_id)

**Triggers**
- trg_leave_balances_set_updated_at BEFORE UPDATE
- trg_leave_balances_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_leave_balances_complete_onboarding AFTER INSERT — marks onboarding step 4 (Set up this year's leave balance) complete for the employee

### `leave_balance_adjustments`  _(05-leave)_

The append-only Adjustment History behind every manual correction, carry-forward credit and onboarding proration. An adjustment log that can be edited is not an audit trail.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `leave_balance_id` | CHAR(36) | NOT NULL REFERENCES leave_balances(id) ON DELETE RESTRICT |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Denormalized from the balance so the history list's Employee / Leave Type / Adjusted By / date-range filters index directly. |
| `leave_type_id` | CHAR(36) | NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `adjustment_days` | DECIMAL(5,2) | NOT NULL CHECK (adjustment_days <> 0 AND adjustment_days * 2 = floor(adjustment_days * 2)) | Positive grants, negative corrects an over-grant. Zero is meaningless and rejected. |
| `adjustment_direction` | TEXT | GENERATED ALWAYS AS (CASE WHEN adjustment_days > 0 THEN 'increase' ELSE 'decrease' END) STORED NOT NULL | DERIVED — generated column. Exists purely so the positive/negative filter on Adjustment History is an index scan rather than an expression scan. |
| `reason` | TEXT | NOT NULL CHECK (btrim(reason) <> '') | Required on every adjustment, without exception. |
| `source` | leave_adjustment_source | NOT NULL DEFAULT 'manual_correction' | ENUM ('manual_correction','carry_forward_run','onboarding_proration','system'). Lets HR's history screen show only the human corrections without losing the machine ones. |
| `leave_carry_forward_line_id` | CHAR(36) | REFERENCES leave_carry_forward_lines(id) ON DELETE RESTRICT, CHECK ((source = 'carry_forward_run') = (leave_carry_forward_line_id IS NOT NULL)) |  |
| `adjusted_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | The 'Adjusted By' column — an adjustment log that cannot be filtered by who made it is not much of an audit trail. |
| `adjusted_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `balance_before` | DECIMAL(5,2) | NOT NULL | Remaining immediately before the adjustment — makes each row self-explaining without replaying the whole log. |
| `balance_after` | DECIMAL(5,2) | NOT NULL |  |
| `notification_sent_at` | DATETIME(6) | NULL | The employee is notified that an adjustment was made, with the reason, for transparency (05 §3.4). |

**Indexes**
- ix_leave_balance_adjustments_employee ON leave_balance_adjustments(employee_id, adjusted_at DESC)
- ix_leave_balance_adjustments_balance ON leave_balance_adjustments(leave_balance_id)
- ix_leave_balance_adjustments_adjusted_by ON leave_balance_adjustments(adjusted_by, adjusted_at DESC)
- ix_leave_balance_adjustments_type ON leave_balance_adjustments(leave_type_id)
- ix_leave_balance_adjustments_direction ON leave_balance_adjustments(adjustment_direction, adjusted_at DESC)

**Triggers**
- trg_leave_balance_adjustments_append_only BEFORE UPDATE OR DELETE — raises unconditionally. This table is on the immutable-logs list
- trg_leave_balance_adjustments_fy_lock BEFORE INSERT — EXECUTE fn_reject_if_fy_locked()
- trg_leave_balance_adjustments_apply AFTER INSERT — recomputes leave_balances.adjustment_days and stamps balance_before/balance_after
- trg_leave_balance_adjustments_notify AFTER INSERT — notifies the employee with the reason

### `leave_carry_forward_runs`  _(05-leave)_

One year-end carry-forward execution for a financial-year transition — a deliberate, previewed, once-only action, not a background recalculation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `from_financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `to_financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT, CHECK (to_financial_year_id <> from_financial_year_id) |  |
| `status` | carry_forward_run_status | NOT NULL DEFAULT 'preview' | ENUM ('preview','committed','cancelled'). The preview step exists because running this twice or on the wrong year would be hard to undo cleanly. Soft-delete tier 2. |
| `previewed_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `previewed_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `committed_at` | DATETIME(6) | CHECK ((committed_at IS NULL) = (status <> 'committed')) |  |
| `committed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `cancelled_at` | DATETIME(6) | NULL |  |
| `employee_count` | INT | NOT NULL DEFAULT 0 | DERIVED — trigger (spans rows: distinct employees across lines). |
| `line_count` | INT | NOT NULL DEFAULT 0 | DERIVED — trigger. |
| `total_days_carried` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger. |
| `total_days_lapsed` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger. What the caps dropped — the figure nobody thinks to ask for until someone disputes a balance. |
| `filter_snapshot` | JSON | NULL | JSONB, and one of the permitted uses: the report/preview filter set the run was scoped by, so a committed run can be explained later. |

**Indexes**
- ux_leave_carry_forward_runs_one_committed UNIQUE ON leave_carry_forward_runs(from_financial_year_id, to_financial_year_id) WHERE status = 'committed' — the 'only one committed run per transition' rule as a partial unique index, which is what actually makes running it twice impossible
- ix_leave_carry_forward_runs_status ON leave_carry_forward_runs(status, previewed_at DESC)
- ix_leave_carry_forward_runs_to_fy ON leave_carry_forward_runs(to_financial_year_id)

**Triggers**
- trg_leave_carry_forward_runs_set_updated_at BEFORE UPDATE
- trg_leave_carry_forward_runs_fy_lock BEFORE INSERT OR UPDATE — EXECUTE fn_reject_if_fy_locked() against to_financial_year_id ONLY. Deliberately not the source year: this run is the very thing that must be completed before the closing year is locked, so locking it against its own source would make the feature unrunnable
- trg_leave_carry_forward_runs_commit AFTER UPDATE OF status — on 'committed', writes each line's days into the target leave_balances.carried_forward_days and records a matching leave_balance_adjustments row with source = 'carry_forward_run'
- trg_leave_carry_forward_runs_immutable_after_commit BEFORE UPDATE — refuses any change once status = 'committed'

### `leave_carry_forward_lines`  _(05-leave)_

The per-employee, per-leave-type detail of a carry-forward run — the preview table, and afterwards the permanent record of what carried and what lapsed.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `leave_carry_forward_run_id` | CHAR(36) | NOT NULL REFERENCES leave_carry_forward_runs(id) ON DELETE CASCADE |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `leave_type_id` | CHAR(36) | NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT |  |
| `source_leave_balance_id` | CHAR(36) | NOT NULL REFERENCES leave_balances(id) ON DELETE RESTRICT |  |
| `target_leave_balance_id` | CHAR(36) | REFERENCES leave_balances(id) ON DELETE RESTRICT | Populated on commit — the next year's balance row the days landed in. NULL while the run is still a preview. |
| `remaining_days_at_run` | DECIMAL(5,2) | NOT NULL CHECK (remaining_days_at_run * 2 = floor(remaining_days_at_run * 2)) | SNAPSHOT of the closing Remaining at preview time. |
| `carry_forward_allowed_snapshot` | TINYINT(1) | NOT NULL | SNAPSHOT of the leave type's Carry Forward Allowed as it stood at the run. |
| `max_carry_forward_days_snapshot` | DECIMAL(5,2) | CHECK (max_carry_forward_days_snapshot IS NULL OR max_carry_forward_days_snapshot >= 0) |  |
| `days_carried_forward` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (days_carried_forward >= 0 AND days_carried_forward <= remaining_days_at_run AND days_carried_forward * 2 = floor(days_carried_forward * 2)) | Remaining, capped at Max Carry Forward Days. |
| `days_lapsed` | DECIMAL(5,2) | GENERATED ALWAYS AS (remaining_days_at_run - days_carried_forward) STORED NOT NULL | DERIVED — generated column. Anything above the cap, dropped. |

**Indexes**
- ux_leave_carry_forward_lines UNIQUE ON leave_carry_forward_lines(leave_carry_forward_run_id, employee_id, leave_type_id)
- ix_leave_carry_forward_lines_employee ON leave_carry_forward_lines(employee_id)
- ix_leave_carry_forward_lines_run ON leave_carry_forward_lines(leave_carry_forward_run_id)

**Triggers**
- trg_leave_carry_forward_lines_set_updated_at BEFORE UPDATE
- trg_leave_carry_forward_lines_rollup AFTER INSERT OR UPDATE OR DELETE — recomputes the parent run's four totals
- trg_leave_carry_forward_lines_lock_after_commit BEFORE INSERT OR UPDATE OR DELETE — refuses changes once the parent run is committed

### `compensatory_hour_requests`  _(05-leave)_

A request to make up a specific dated hour shortfall on a day the employee chooses — the screen that keeps a bad afternoon from becoming a pay cut. Deliberately distinct from the Comp Off leave type: hours owed first and worked afterwards, never a banked day.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `request_number` | VARCHAR(191) | NOT NULL UNIQUE | The 'Request #' column. Full rendered code from document_number_sequences keyed (code_type, financial_year_id). |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Locked to the logged-in person — you can only compensate your own hours. |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Covered by fn_reject_if_fy_locked(). |
| `shortfall_attendance_record_id` | CHAR(36) | NOT NULL REFERENCES attendance_records(id) ON DELETE RESTRICT | The Shortfall Date dropdown offers only dates that genuinely recorded a shortfall — modelling it as an FK to the actual attendance row is what makes 'a shortfall cannot be invented to earn credit' structural. |
| `shortfall_date` | DATE | NOT NULL | Denormalized from the attendance row for filtering and display; kept consistent by trigger. |
| `hours_short` | DECIMAL(6,2) | NOT NULL CHECK (hours_short > 0) | DERIVED — trigger. Required Hours − Net Worked Hours on that date. The ceiling on what may be claimed. |
| `day_status_at_request` | attendance_day_status | NOT NULL | SNAPSHOT of what the day currently counts as. Approval lifts a Half Day back to Full Day. |
| `shortfall_reason` | TEXT | NOT NULL CHECK (btrim(shortfall_reason) <> '') | The approver sees this when deciding. |
| `make_up_date` | DATE | NOT NULL CHECK (make_up_date >= shortfall_date) | THE EMPLOYEE'S CHOICE. Validated against the window, the cap and the permitted day types. |
| `make_up_day_type` | attendance_day_type | NOT NULL | DERIVED — trigger, resolved from the work-week policy. A non-working Saturday is permitted where the policy allows it; a Mandatory holiday is refused. |
| `work_week_policy_id` | CHAR(36) | NOT NULL REFERENCES work_week_policies(id) ON DELETE RESTRICT | The policy every rule below was judged against. |
| `hours_to_work` | DECIMAL(6,2) | NOT NULL CHECK (hours_to_work >= hours_short) | Must be at least Hours Short. Anything beyond closes the shortfall; it is explicitly not banked as extra credit. |
| `planned_check_in_time` | time | NULL |  |
| `planned_check_out_time` | time | NULL |  |
| `planned_break_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (planned_break_hours >= 0) | A break is only deducted if the planned stretch runs past six hours. |
| `compensation_window_days_snapshot` | INT | NOT NULL CHECK (compensation_window_days_snapshot >= 0) | SNAPSHOT of the policy's Compensation Window. 0 means the same payroll period only. |
| `window_last_permissible_date` | DATE | NOT NULL, CHECK (make_up_date <= window_last_permissible_date) | DERIVED — trigger. A date past the window is refused outright, with this exact date stated back to the employee. |
| `max_comp_hours_per_month_snapshot` | DECIMAL(6,2) | CHECK (max_comp_hours_per_month_snapshot IS NULL OR max_comp_hours_per_month_snapshot >= 0) | SNAPSHOT of Max Compensatory Hours per Month. NULL / 0 removes the cap. |
| `month_hours_used_at_submit` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | DERIVED — trigger (spans rows). What the monthly cap check was evaluated against, kept so a later refusal is explainable. |
| `allow_makeup_on_week_off_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `allow_makeup_on_mandatory_holiday_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `estimated_payroll_impact` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED — trigger. 'Payroll Impact if Rejected', shown up front so nobody is surprised by their payslip. Computed via the policy's Uncompensated Shortfall Becomes setting. |
| `uncompensated_shortfall_becomes_snapshot` | uncompensated_shortfall_treatment | NOT NULL | ENUM ('pro_rata_loss_of_pay','round_nearest_half_day','round_up_full_day','deduct_from_leave_then_lop','ignore'). SNAPSHOT — the treatment promised at request time is the one applied if it is later rejected. |
| `status` | comp_hour_request_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','approved','rejected','cancelled','expired'). 'expired' is the window closing before a decision — which converts to Loss of Pay exactly as a rejection does. Soft-delete tier 2. |
| `routed_to_role` | leave_routing_target | NOT NULL | Same routing rule as leave, reused rather than reinvented. |
| `routed_to_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `routing_reason` | TEXT | NOT NULL |  |
| `actioned_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | The 'Approved By' column. |
| `actioned_at` | DATETIME(6) | NULL |  |
| `decision_reason` | TEXT | CHECK (status <> 'rejected' OR btrim(coalesce(decision_reason,'')) <> '') | Rejection requires a reason, per the platform-wide default. |
| `makeup_attendance_record_id` | CHAR(36) | REFERENCES attendance_records(id) ON DELETE RESTRICT | The attendance row for the day actually worked. |
| `hours_actually_worked` | DECIMAL(6,2) | CHECK (hours_actually_worked IS NULL OR hours_actually_worked >= 0) | The 'Hours Made Up' column, read back from that attendance row. |
| `hours_credited` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (hours_credited >= 0) | DERIVED — trigger. What was actually credited against this specific shortfall — never more than hours_short, so the same hours can never clear two days. |
| `residual_shortfall_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (residual_shortfall_hours >= 0) | DERIVED — trigger. A partial make-up clears only its own hours; this is the remainder that still deducts, stated explicitly rather than implied away. |

**Indexes**
- ux_comp_hour_requests_number UNIQUE ON compensatory_hour_requests(request_number)
- ux_comp_hour_requests_one_open_per_shortfall UNIQUE ON compensatory_hour_requests(shortfall_attendance_record_id) WHERE status IN ('pending','approved') — one live claim per shortfall date, as a partial unique index
- ix_comp_hour_requests_queue ON compensatory_hour_requests(routed_to_user_id, created_at) WHERE status = 'pending'
- ix_comp_hour_requests_employee ON compensatory_hour_requests(employee_id, shortfall_date DESC)
- ix_comp_hour_requests_makeup_date ON compensatory_hour_requests(make_up_date)
- ix_comp_hour_requests_window_expiry ON compensatory_hour_requests(window_last_permissible_date) WHERE status = 'pending'
- ix_comp_hour_requests_financial_year ON compensatory_hour_requests(financial_year_id, status)

**Triggers**
- trg_comp_hour_requests_set_updated_at BEFORE UPDATE
- trg_comp_hour_requests_fy_lock BEFORE INSERT OR UPDATE OR DELETE — EXECUTE fn_reject_if_fy_locked()
- trg_comp_hour_requests_allocate_number BEFORE INSERT — allocates request_number from document_number_sequences, FOR UPDATE
- trg_comp_hour_requests_derive BEFORE INSERT — resolves the policy, snapshots the window/cap/permitted-day settings, derives hours_short, day_status_at_request, make_up_day_type, window_last_permissible_date and estimated_payroll_impact
- trg_comp_hour_requests_validate BEFORE INSERT OR UPDATE — raises when the make-up date is outside the window (stating the last permissible date), over the monthly cap, on a week off the policy does not permit, or on a Mandatory holiday the policy does not permit
- trg_comp_hour_requests_route BEFORE INSERT — applies the leave routing rule
- trg_comp_hour_requests_block_self_approval BEFORE UPDATE OF status
- trg_comp_hour_requests_credit_shortfall AFTER UPDATE OF status — on approve, writes compensatory_credit_hours and shortfall_cleared_hours onto the two attendance_records rows, re-resolves the shortfall day's status, and computes residual_shortfall_hours
- trg_comp_hour_requests_notify AFTER UPDATE OF status — notifies the applicant, with the reason on reject

### `assets`  _(03 Asset Management)_

One company-owned physical asset (IT, furniture, fixtures, ID cards) from purchase to retirement — identity, purchase/financial data, current condition, current holder. Straight-line depreciation is NOT stored here; only its inputs are.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_tag` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. AST-2026-0001. Allocated from document_number_sequences (code_type='asset_code', financial_year_id) with SELECT ... FOR UPDATE inside the creating transaction. Never a Postgres SEQUENCE. |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock trigger applies. |
| `asset_name` | TEXT | NOT NULL CHECK (char_length(asset_name) BETWEEN 2 AND 100) |  |
| `asset_category_id` | CHAR(36) | NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT | Masters 3.17. Active-only filtering happens in the dropdown query. |
| `serial_number` | TEXT | CHECK (serial_number IS NULL OR char_length(serial_number) > 0) | Unique only when provided — partial unique index, not a column constraint. |
| `order_date` | DATE | CHECK (order_date IS NULL OR purchase_date IS NULL OR order_date <= purchase_date) | Date the PO was placed; distinct from purchase_date (2.2). |
| `purchase_date` | DATE | NOT NULL CHECK (purchase_date <= current_date) |  |
| `purchase_value` | DECIMAL(14,2) | CHECK (purchase_value IS NULL OR purchase_value > 0) | Optional exactly as the brief gives it; Current Value reads 'Not available' when null. |
| `useful_life_years` | DECIMAL(6,2) | CHECK (useful_life_years IS NULL OR useful_life_years > 0) plus table CHECK (purchase_value IS NULL OR useful_life_years IS NOT NULL) | Conditionally required: depreciation input. Fractional years permitted. |
| `depreciation_method` | depreciation_method (enum: straight_line, written_down_value) | NOT NULL DEFAULT 'straight_line' | Only straight_line is offered today; the enum carries the second value so adding WDV is a formula change, not a schema rebuild. |
| `vendor_id` | CHAR(36) | REFERENCES vendors(id) ON DELETE RESTRICT |  |
| `purchase_bill_id` | CHAR(36) | REFERENCES purchase_bills(id) ON DELETE RESTRICT | The purchase record behind the asset (Module Overview). |
| `warranty_expiry` | DATE | CHECK (warranty_expiry IS NULL OR purchase_date IS NULL OR warranty_expiry > purchase_date) |  |
| `location_address_id` | CHAR(36) | REFERENCES company_addresses(id) ON DELETE RESTRICT | Location/Branch sourced from Company Profile → Addresses (Masters 3.6b), per 2.2's recommendation — no new master. |
| `department_id` | CHAR(36) | REFERENCES departments(id) ON DELETE RESTRICT | Directory and Reports both filter by Department; Transfer can move an asset between departments (2.3). |
| `status` | asset_status (enum: in_use, in_store, under_repair, retired_disposed) | NOT NULL DEFAULT 'in_store' | Soft-delete tier 2 — status-driven lifecycle, assets are never deleted. |
| `assigned_to_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Settable at creation only; afterwards writable solely by the Assign/Transfer/Unassign path (trigger-guarded) so Assignment History is never bypassed. |
| `notes` | TEXT |  |  |
| `retired_date` | DATE | CHECK ((status = 'retired_disposed') = (retired_date IS NOT NULL)) | Set automatically when status becomes retired_disposed, from Details, Reports, or Reclaim on Exit (7.8). |
| `retired_reason` | TEXT | CHECK (status <> 'retired_disposed' OR retired_reason IS NOT NULL) | Required reason on the Not working/damaged path in Reclaim on Exit (2.8). |

**Indexes**
- CREATE UNIQUE INDEX uq_assets_asset_tag ON assets(asset_tag)
- CREATE UNIQUE INDEX uq_assets_serial_number ON assets(lower(serial_number)) WHERE serial_number IS NOT NULL — 'unique if provided' as a PARTIAL UNIQUE INDEX
- CREATE UNIQUE INDEX uq_assets_open_assignment_employee ON assets(id) WHERE assigned_to_employee_id IS NOT NULL AND status = 'in_use'
- CREATE INDEX ix_assets_status ON assets(status)
- CREATE INDEX ix_assets_category ON assets(asset_category_id)
- CREATE INDEX ix_assets_assigned_to ON assets(assigned_to_employee_id) WHERE assigned_to_employee_id IS NOT NULL
- CREATE INDEX ix_assets_location ON assets(location_address_id)
- CREATE INDEX ix_assets_department ON assets(department_id)
- CREATE INDEX ix_assets_purchase_date ON assets(purchase_date)
- CREATE INDEX ix_assets_order_date ON assets(order_date)
- CREATE INDEX ix_assets_warranty_expiry ON assets(warranty_expiry) WHERE warranty_expiry IS NOT NULL — powers the 'expiring in 90 days' preset
- CREATE INDEX ix_assets_financial_year ON assets(financial_year_id)
- CREATE INDEX ix_assets_vendor ON assets(vendor_id)

**Triggers**
- trg_assets_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_assets_set_updated_at — BEFORE UPDATE, maintains updated_at/updated_by
- trg_assets_guard_assignment_fields — BEFORE UPDATE: rejects any change to status or assigned_to_employee_id unless the transaction has set the assignment-action flag (i.e. an asset_assignment_history row is being written in the same transaction). This is what makes 2.2's 'locked after creation' rule real.
- trg_assets_stamp_retirement — BEFORE UPDATE: sets retired_date = current_date when status transitions to retired_disposed
- trg_assets_seed_first_assignment — AFTER INSERT: when assigned_to_employee_id is set at creation, writes the first asset_assignment_history row (action='assigned') and forces status='in_use'

### `asset_attachments`  _(03 Asset Management)_

Invoice copies, photos and similar files hung off one asset (2.2, Attachments).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_id` | CHAR(36) | NOT NULL REFERENCES assets(id) ON DELETE CASCADE |  |
| `file_name` | TEXT | NOT NULL |  |
| `storage_path` | TEXT | NOT NULL |  |
| `mime_type` | TEXT | NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')) | PDF/JPG/PNG per 2.2. |
| `file_size_bytes` | BIGINT | NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880) | 5 MB cap, matching the Employee module. |
| `is_primary_photo` | TINYINT(1) | NOT NULL DEFAULT false | Drives the record-header thumbnail (2.2). |

**Indexes**
- CREATE INDEX ix_asset_attachments_asset ON asset_attachments(asset_id)
- CREATE UNIQUE INDEX uq_asset_primary_photo ON asset_attachments(asset_id) WHERE is_primary_photo — 'only one primary photo per asset' as a partial unique index

**Triggers**
- trg_asset_attachments_set_updated_at — BEFORE UPDATE

### `asset_assignment_history`  _(03 Asset Management)_

IMMUTABLE append-only log of every Assign / Transfer / Unassign / reclaim action on an asset (2.3, 2.8). The permanent answer to 'who held this, when, and who moved it'.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_id` | CHAR(36) | NOT NULL REFERENCES assets(id) ON DELETE RESTRICT |  |
| `action` | asset_assignment_action (enum: assigned, transferred, unassigned, retired_on_reclaim) | NOT NULL | retired_on_reclaim is the Reclaim on Exit 'Not working / damaged' branch (2.8); the working-condition branch writes 'unassigned'. |
| `employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | The holder this row concerns — the new holder for assigned/transferred, the returning holder for unassigned/retired_on_reclaim. Null only for a store-to-store move. |
| `from_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Previous holder, populated on transferred/unassigned. |
| `from_department_id` | CHAR(36) | REFERENCES departments(id) ON DELETE RESTRICT |  |
| `to_department_id` | CHAR(36) | REFERENCES departments(id) ON DELETE RESTRICT |  |
| `from_location_address_id` | CHAR(36) | REFERENCES company_addresses(id) ON DELETE RESTRICT |  |
| `to_location_address_id` | CHAR(36) | REFERENCES company_addresses(id) ON DELETE RESTRICT | 2.3: Transfer can move an asset between employee, department, or location. |
| `effective_date` | DATE | NOT NULL | The 'From Date' column of the history tab. 'To Date' is NOT stored — see note on derivation. |
| `reason` | TEXT | CHECK (action <> 'transferred' OR reason IS NOT NULL) AND CHECK (action <> 'retired_on_reclaim' OR reason IS NOT NULL) | Required for Transfer (2.3) and for the damaged-retirement branch (2.8). |
| `status_before` | asset_status | NOT NULL | Snapshot so the log reproduces the asset's state at the time, independent of later edits. |
| `status_after` | asset_status | NOT NULL |  |
| `performed_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | The 'Performed By' column. |
| `performed_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `source` | assignment_source (enum: asset_creation, manual_action, asset_request_approval, reclaim_on_exit) | NOT NULL DEFAULT 'manual_action' |  |
| `source_asset_request_id` | CHAR(36) | REFERENCES asset_requests(id) ON DELETE RESTRICT | Set when the row came from approving a Return request (2.6). |

**Indexes**
- CREATE INDEX ix_asset_assignment_history_asset ON asset_assignment_history(asset_id, effective_date DESC, performed_at DESC)
- CREATE INDEX ix_asset_assignment_history_employee ON asset_assignment_history(employee_id) WHERE employee_id IS NOT NULL — powers Reclaim on Exit's 'Assigned Date' lookup
- CREATE INDEX ix_asset_assignment_history_performed_by ON asset_assignment_history(performed_by)
- CREATE INDEX ix_asset_assignment_history_action ON asset_assignment_history(action)

**Triggers**
- trg_asset_assignment_history_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only)
- trg_asset_assignment_history_apply_to_asset — AFTER INSERT: sets the assignment-action flag and writes assets.status / assets.assigned_to_employee_id, the only sanctioned path for those two columns

### `asset_maintenance_logs`  _(03 Asset Management)_

Everything done to service or repair an asset (2.4) — per-asset tab and the company-wide maintenance list are the same rows, differently scoped.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_id` | CHAR(36) | NOT NULL REFERENCES assets(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Carries a rupee cost — FY-lock trigger applies. |
| `service_date` | DATE | NOT NULL CHECK (service_date <= current_date) | The 'Date' field; cannot be in the future. |
| `description` | TEXT | NOT NULL |  |
| `cost` | DECIMAL(14,2) | CHECK (cost IS NULL OR cost > 0) |  |
| `next_due_date` | DATE | CHECK (next_due_date IS NULL OR next_due_date > service_date) | Drives the Completed/Overdue/Upcoming derivation and the 'due soon' report window. |
| `serviced_by_vendor_id` | CHAR(36) | REFERENCES vendors(id) ON DELETE RESTRICT | Company-wide list filters on Serviced By / Vendor (2.4). |
| `is_system_generated` | TINYINT(1) | NOT NULL DEFAULT false | True for entries auto-created by an approved Repair/Damage request; shown marked as system-generated (2.4). |
| `source_asset_request_id` | CHAR(36) | REFERENCES asset_requests(id) ON DELETE RESTRICT, CHECK (is_system_generated = (source_asset_request_id IS NOT NULL)) |  |

**Indexes**
- CREATE INDEX ix_asset_maintenance_logs_asset ON asset_maintenance_logs(asset_id, service_date DESC)
- CREATE INDEX ix_asset_maintenance_logs_next_due ON asset_maintenance_logs(next_due_date) WHERE next_due_date IS NOT NULL
- CREATE INDEX ix_asset_maintenance_logs_service_date ON asset_maintenance_logs(service_date)
- CREATE INDEX ix_asset_maintenance_logs_vendor ON asset_maintenance_logs(serviced_by_vendor_id)
- CREATE INDEX ix_asset_maintenance_logs_fy ON asset_maintenance_logs(financial_year_id)

**Triggers**
- trg_asset_maintenance_logs_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_asset_maintenance_logs_set_updated_at — BEFORE UPDATE

### `asset_requests`  _(03 Asset Management)_

Repair / Damage Report / Return requests raised by an employee from the Employee module's My Assets screen, reviewed in the Asset Requests approval queue (2.6).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_id` | CHAR(36) | NOT NULL REFERENCES assets(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock trigger applies. |
| `requester_employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `request_type` | asset_request_type (enum: repair, damage_report, return) | NOT NULL | Exactly the three types 2.6 defines — Transfer is deliberately NOT a request type (2.3, 6.4). |
| `description` | TEXT | NOT NULL | The employee's original wording; copied into the auto-created maintenance log on approval. |
| `raised_date` | DATE | NOT NULL DEFAULT current_date |  |
| `status` | asset_request_status (enum: pending, approved, rejected, completed) | NOT NULL DEFAULT 'pending' | Tier 2 status-driven lifecycle; requests are never deleted. |
| `approver_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | Reporting Manager or Super Admin; the queue filters by Approver. |
| `decided_at` | DATETIME(6) | CHECK ((status IN ('approved','rejected')) = (decided_at IS NOT NULL)) |  |
| `decision_reason` | TEXT | CHECK (status <> 'rejected' OR decision_reason IS NOT NULL) | Rejection requires a short reason, shown back to the employee (2.6, and the CMS-wide rejection-reason rule). |
| `resulting_maintenance_log_id` | CHAR(36) | REFERENCES asset_maintenance_logs(id) ON DELETE RESTRICT | Set on approving Repair or Damage Report. |
| `resulting_assignment_history_id` | CHAR(36) | REFERENCES asset_assignment_history(id) ON DELETE RESTRICT | Set on approving a Return. |

**Indexes**
- CREATE INDEX ix_asset_requests_status ON asset_requests(status)
- CREATE INDEX ix_asset_requests_requester ON asset_requests(requester_employee_id)
- CREATE INDEX ix_asset_requests_asset ON asset_requests(asset_id)
- CREATE INDEX ix_asset_requests_raised_date ON asset_requests(raised_date)
- CREATE INDEX ix_asset_requests_type ON asset_requests(request_type)
- CREATE INDEX ix_asset_requests_approver ON asset_requests(approver_user_id)
- CREATE INDEX ix_asset_requests_pending ON asset_requests(asset_id) WHERE status = 'pending'

**Triggers**
- trg_asset_requests_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_asset_requests_apply_decision — AFTER UPDATE OF status: on approve, Return writes an asset_assignment_history 'unassigned' row; Repair and Damage Report set the asset to under_repair and insert a system-generated asset_maintenance_logs row (date = today, description copied, cost/next_due left null). Reject changes nothing on the asset. Spans tables, so a trigger rather than a generated column.
- trg_asset_requests_set_updated_at — BEFORE UPDATE

### `tickets`  _(04 Ticket)_

One customer support ticket — the record behind the Ticket List, Detail/Conversation screen, and Support Reports (Module 4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `ticket_number` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. TKT-2026-0001, from document_number_sequences (code_type='ticket_number', financial_year_id) allocated FOR UPDATE in the creating transaction. |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock trigger applies. |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `customer_contact_id` | CHAR(36) | REFERENCES customer_contacts(id) ON DELETE RESTRICT | Which Contact person at that company the ticket is with (Module Overview, Section 5). |
| `ticket_category_id` | CHAR(36) | REFERENCES ticket_categories(id) ON DELETE RESTRICT | Masters 3.14. |
| `subject` | TEXT | NOT NULL CHECK (char_length(subject) BETWEEN 5 AND 150) |  |
| `priority` | ticket_priority (enum: low, medium, high, urgent) | NOT NULL DEFAULT 'medium' |  |
| `status` | ticket_status (enum: open, in_progress, resolved, closed) | NOT NULL DEFAULT 'open' | Tier 2 status-driven lifecycle. |
| `description` | TEXT | NOT NULL |  |
| `assigned_to_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Nullable — the list shows 'Unassigned' and filters on an 'Unassigned only' toggle. |
| `linked_project_id` | CHAR(36) | REFERENCES projects(id) ON DELETE RESTRICT | Dropdown filtered to the selected Customer's projects; clearing it removes the link without touching either record. |
| `raised_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | 'Raised By' filter (2.1). |
| `raised_at` | DATETIME(6) | NOT NULL DEFAULT now() | The Raised Date column and the baseline for both duration figures. |
| `due_date` | DATE |  | Backs the Due Date range filter and the 'Overdue only' toggle (2.1). |
| `first_public_reply_at` | DATETIME(6) |  | Set once, by trigger, on the first Public Reply. Spans rows, so a trigger — never typed in. |
| `first_response_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (round((extract(epoch FROM (first_public_reply_at - raised_at)) / 3600)::numeric, 2)) STORED | DERIVED — single-row, immutable expression, so a generated column. Null until the first Public Reply, exactly as the column spec requires. |
| `resolved_at` | DATETIME(6) |  | Stamped by trigger when status reaches resolved. |
| `closed_at` | DATETIME(6) |  | Stamped by trigger when status reaches closed. |
| `resolution_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (round((extract(epoch FROM (coalesce(closed_at, resolved_at) - raised_at)) / 3600)::numeric, 2)) STORED | DERIVED — generated column; feeds Support Reports' average resolve time. |
| `satisfaction_rating` | smallint | CHECK (satisfaction_rating IS NULL OR satisfaction_rating BETWEEN 1 AND 5), CHECK (satisfaction_rating IS NULL OR status = 'closed') | 1-5, recorded manually at close by whoever closes it; optional unless the 'Require Satisfaction Rating on Close' toggle is on. |
| `is_archived` | TINYINT(1) | NOT NULL DEFAULT false | Backs Super Admin's 'show closed and archived' toggle (2.1). |

**Indexes**
- CREATE UNIQUE INDEX uq_tickets_ticket_number ON tickets(ticket_number)
- CREATE INDEX ix_tickets_status ON tickets(status)
- CREATE INDEX ix_tickets_priority ON tickets(priority)
- CREATE INDEX ix_tickets_customer ON tickets(customer_id)
- CREATE INDEX ix_tickets_assigned_to ON tickets(assigned_to_employee_id)
- CREATE INDEX ix_tickets_unassigned ON tickets(raised_at DESC) WHERE assigned_to_employee_id IS NULL — 'Unassigned only' toggle
- CREATE INDEX ix_tickets_open_due ON tickets(due_date) WHERE status IN ('open','in_progress') — 'Overdue only' toggle
- CREATE INDEX ix_tickets_raised_at ON tickets(raised_at DESC)
- CREATE INDEX ix_tickets_category ON tickets(ticket_category_id)
- CREATE INDEX ix_tickets_project ON tickets(linked_project_id) WHERE linked_project_id IS NOT NULL — the reverse 'Linked Tickets' lookup from a Project
- CREATE INDEX ix_tickets_fy ON tickets(financial_year_id)
- CREATE INDEX ix_tickets_rating ON tickets(satisfaction_rating) WHERE satisfaction_rating IS NOT NULL

**Triggers**
- trg_tickets_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_tickets_stamp_status_timestamps — BEFORE UPDATE OF status: sets resolved_at / closed_at once each; refuses to unset them
- trg_tickets_require_rating_on_close — BEFORE UPDATE OF status: blocks the move to closed when feature_toggles 'ticket.require_satisfaction_rating_on_close' is on and satisfaction_rating is null
- trg_tickets_set_updated_at — BEFORE UPDATE

### `ticket_conversation_entries`  _(04 Ticket)_

The chronological thread on a ticket — Public Replies to the customer and Internal Notes, each optionally carrying one attachment (2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `ticket_id` | CHAR(36) | NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT |  |
| `entry_type` | ticket_entry_type (enum: public_reply, internal_note) | NOT NULL DEFAULT 'public_reply' | The one field the UI must make hard to mis-set; only public_reply is ever emailed. |
| `content` | TEXT | NOT NULL |  |
| `author_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `posted_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `attachment_file_name` | TEXT |  |  |
| `attachment_storage_path` | TEXT | CHECK ((attachment_storage_path IS NULL) = (attachment_file_name IS NULL)) |  |
| `attachment_mime_type` | TEXT | CHECK (attachment_mime_type IS NULL OR attachment_mime_type IN ('application/pdf','image/jpeg','image/png')) |  |
| `attachment_size_bytes` | BIGINT | CHECK (attachment_size_bytes IS NULL OR (attachment_size_bytes > 0 AND attachment_size_bytes <= 5242880)) | 5 MB cap, matching the rest of the CMS. |
| `is_first_public_reply` | TINYINT(1) | NOT NULL DEFAULT false | Set by trigger, never by the caller; exists so the 'only one first public reply' rule can be a partial unique index rather than an application check. |

**Indexes**
- CREATE INDEX ix_ticket_entries_ticket ON ticket_conversation_entries(ticket_id, posted_at)
- CREATE INDEX ix_ticket_entries_author ON ticket_conversation_entries(author_user_id)
- CREATE INDEX ix_ticket_entries_type ON ticket_conversation_entries(ticket_id, entry_type)
- CREATE UNIQUE INDEX uq_ticket_first_public_reply ON ticket_conversation_entries(ticket_id) WHERE is_first_public_reply — partial unique index, not an application check

**Triggers**
- trg_ticket_entries_capture_first_response — BEFORE INSERT: on the first public_reply for a ticket, sets is_first_public_reply, writes tickets.first_public_reply_at, and moves status open → in_progress (2.3's stated auto-transition). Spans rows and tables, so a trigger.
- trg_ticket_entries_set_updated_at — BEFORE UPDATE

### `ticket_assignment_history`  _(04 Ticket)_

IMMUTABLE append-only record of every assign/reassign on a ticket (2.4) — Previous Assignee, New Assignee, Changed By, Date, Note.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `ticket_id` | CHAR(36) | NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT |  |
| `previous_assignee_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Null on the first assignment. |
| `new_assignee_employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `note` | TEXT |  | e.g. 'Reassigning — I'm on leave next week'. |
| `changed_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `changed_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `is_initial_assignment` | TINYINT(1) | NOT NULL DEFAULT false | True when Assigned To was set at ticket creation — 2.2 states that has the same effect as using Assign. |

**Indexes**
- CREATE INDEX ix_ticket_assignment_history_ticket ON ticket_assignment_history(ticket_id, changed_at DESC)
- CREATE INDEX ix_ticket_assignment_history_new_assignee ON ticket_assignment_history(new_assignee_employee_id)
- CREATE INDEX ix_ticket_assignment_history_changed_by ON ticket_assignment_history(changed_by)

**Triggers**
- trg_ticket_assignment_history_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only)
- trg_ticket_assignment_history_apply_to_ticket — AFTER INSERT: writes tickets.assigned_to_employee_id, making this log the only path by which a ticket changes hands

### `customers`  _(08 Customer)_

One B2B client company — the CRM core record behind the Customer Directory, Add/Edit Customer, and the Customer 360 header (Module 8).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `customer_code` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. CUST-2026-0001, from document_number_sequences (code_type='customer_code', financial_year_id). |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock trigger applies. |
| `company_name` | TEXT | NOT NULL CHECK (char_length(company_name) BETWEEN 2 AND 200) |  |
| `display_name` | TEXT |  | Optional short name; left null when not given. |
| `effective_display_name` | TEXT | GENERATED ALWAYS AS (coalesce(display_name, company_name)) STORED | DERIVED — 'defaults to Company Name if left blank' as a generated column (single-row, immutable), so lists never re-implement the fallback. |
| `gstin` | TEXT | CHECK (gstin IS NULL OR (gstin = upper(gstin) AND gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$')) | Exactly 15 chars, auto-uppercased. |
| `pan` | TEXT | CHECK (pan IS NULL OR (pan = upper(pan) AND pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')) |  |
| `customer_status_id` | CHAR(36) | NOT NULL REFERENCES customer_statuses(id) ON DELETE RESTRICT | Masters 3.15 (Prospect / Active / Inactive). Tier 2 lifecycle — customers are never deleted; 'show inactive' is a filter, not a resurrection. |
| `customer_source_id` | CHAR(36) | REFERENCES customer_sources(id) ON DELETE RESTRICT | Masters 3.16 — removed 2026-07-30, restored 2026-07-31. Shown as a chip on the Directory. |
| `service_category_id` | CHAR(36) | REFERENCES service_categories(id) ON DELETE RESTRICT | Masters 3.12; Directory filters on it. |
| `website` | TEXT | CHECK (website IS NULL OR website ~* '^https?://') |  |
| `notes` | TEXT |  |  |
| `mobile_number` | TEXT | CHECK (mobile_number IS NULL OR mobile_number ~ '^[6-9][0-9]{9}$') |  |
| `email` | TEXT | CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') |  |
| `address` | TEXT |  |  |
| `city` | TEXT |  | Directory filters on City/State. |
| `state` | TEXT |  |  |
| `pincode` | TEXT | CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$') | A numeric identifier, not a figure — left-aligned as TEXT per the column-alignment convention. |
| `owner_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | The staff member responsible for the account; the Directory's Owner filter and the 'Restrict Manager to Only Their Own Customers' toggle both key on it. |
| `remitter_bank_account_name` | TEXT |  | Added 2026-07-31 — the name this customer remits FROM. What an unidentified bank-statement credit is matched against. Reconciliation aid only; nothing in this CMS debits it. |
| `remitter_bank_name` | TEXT |  | Renders the 'HDFC ••••9021' prefix. |
| `remitter_account_number` | TEXT | CHECK (remitter_account_number IS NULL OR remitter_account_number ~ '^[0-9]{6,20}$') | Held in full; exposure is a Layer 3 field-visibility decision (screen_sensitive_fields), not a storage decision. |
| `remitter_account_number_masked` | TEXT | GENERATED ALWAYS AS (CASE WHEN remitter_account_number IS NULL THEN NULL ELSE '••••' \|\| right(remitter_account_number, 4) END) STORED | DERIVED — the last-four display form as a generated column; masked value keeps the same column alignment as the value it replaces. |
| `collected_into_bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Added 2026-07-31 — which Meshrd account this customer's payments normally land in. Withheld from Manager as a Layer 3 field, not by removing the column. |
| `last_activity_at` | DATETIME(6) |  | DERIVED across rows by trigger from customer_activities — backs the Directory's Last Activity date-range filter. A trigger, not a generated column, because it spans rows. |

**Indexes**
- CREATE UNIQUE INDEX uq_customers_customer_code ON customers(customer_code)
- CREATE UNIQUE INDEX uq_customers_gstin ON customers(gstin) WHERE gstin IS NOT NULL
- CREATE INDEX ix_customers_company_name ON customers(lower(company_name))
- CREATE INDEX ix_customers_status ON customers(customer_status_id)
- CREATE INDEX ix_customers_owner ON customers(owner_employee_id)
- CREATE INDEX ix_customers_source ON customers(customer_source_id)
- CREATE INDEX ix_customers_service_category ON customers(service_category_id)
- CREATE INDEX ix_customers_city_state ON customers(state, city)
- CREATE INDEX ix_customers_last_activity ON customers(last_activity_at DESC NULLS LAST)
- CREATE INDEX ix_customers_fy ON customers(financial_year_id)
- `ix_customers_search` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_customers_search (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_customers_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_customers_set_updated_at — BEFORE UPDATE
- trg_customers_win_promotes_status — AFTER UPDATE on opportunities (declared here for clarity): when a linked opportunity reaches Won, moves a Prospect customer to Active (3.4)

### `customer_contacts`  _(08 Customer)_

The individual people at a client company — Customer 360's Contacts tab (2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `name` | TEXT | NOT NULL |  |
| `designation` | TEXT |  | e.g. 'Procurement Manager'. |
| `email` | TEXT | CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') |  |
| `phone` | TEXT | CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$') |  |
| `is_primary` | TINYINT(1) | NOT NULL DEFAULT false | Only one per customer — enforced as a partial unique index. Deleting the primary leaves the customer with none; there is deliberately no automatic promotion. |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 soft delete with a reference guard: a contact referenced by a ticket or an activity is deactivated, never hard-deleted; an unreferenced one is genuinely deletable. |

**Indexes**
- CREATE INDEX ix_customer_contacts_customer ON customer_contacts(customer_id) WHERE is_active
- CREATE UNIQUE INDEX uq_customer_primary_contact ON customer_contacts(customer_id) WHERE is_primary AND is_active — 'only one Primary per customer' as a partial unique index
- CREATE INDEX ix_customer_contacts_name ON customer_contacts(lower(name))

**Triggers**
- trg_customer_contacts_demote_previous_primary — BEFORE INSERT OR UPDATE OF is_primary: clears is_primary on the customer's other contacts, so marking a new one un-marks the previous without the insert tripping the unique index
- trg_customer_contacts_set_updated_at — BEFORE UPDATE

### `customer_activities`  _(08 Customer)_

IMMUTABLE chronological timeline of calls, emails, meetings and notes logged against a customer (Customer 360, Activities tab).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `activity_type` | activity_type (enum: call, email, meeting, note) | NOT NULL |  |
| `activity_date` | DATE | NOT NULL DEFAULT current_date | Defaults to today, deliberately backdatable to log something that already happened. |
| `description` | TEXT | NOT NULL |  |
| `related_contact_id` | CHAR(36) | REFERENCES customer_contacts(id) ON DELETE RESTRICT | Which person at the company the activity was with. |
| `logged_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | The 'Logged By' line — auto-filled, not editable. |
| `logged_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE INDEX ix_customer_activities_customer ON customer_activities(customer_id, activity_date DESC, logged_at DESC) — the timeline's own ordering
- CREATE INDEX ix_customer_activities_type ON customer_activities(activity_type)
- CREATE INDEX ix_customer_activities_logged_by ON customer_activities(logged_by_user_id)
- CREATE INDEX ix_customer_activities_contact ON customer_activities(related_contact_id)

**Triggers**
- trg_customer_activities_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only)
- trg_customer_activities_touch_last_activity — AFTER INSERT: maintains customers.last_activity_at

### `customer_files`  _(08 Customer)_

Contracts, agreements and similar documents uploaded against a customer (Customer 360, Files tab).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `file_name` | TEXT | NOT NULL |  |
| `storage_path` | TEXT | NOT NULL |  |
| `mime_type` | TEXT | NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document')) | PDF/JPG/PNG/DOCX per 2.3. |
| `file_size_bytes` | BIGINT | NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880) | The 'Size' column; 5 MB cap. |

**Indexes**
- CREATE INDEX ix_customer_files_customer ON customer_files(customer_id, created_at DESC)
- CREATE INDEX ix_customer_files_uploaded_by ON customer_files(created_by)

**Triggers**
- trg_customer_files_set_updated_at — BEFORE UPDATE

### `opportunities`  _(09 Opportunity)_

One possible deal against an existing customer — the record behind the Pipeline's table and stage-summary views and the Opportunity Record (Module 9). Carries no line items: Quote was removed entirely on 2026-07-30.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `opportunity_code` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. OPP-2026-0001, from document_number_sequences (code_type='opportunity_code', financial_year_id). |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | The Pipeline filters on Financial Year directly; FY-lock trigger applies. |
| `title` | TEXT | NOT NULL CHECK (char_length(title) > 0) |  |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `value_amount` | DECIMAL(14,2) | CHECK (value_amount IS NULL OR value_amount > 0) | The deal value; summed for the per-stage ₹ totals, which must reflect the filtered set. |
| `stage` | opportunity_stage (enum: prospecting, qualifying, proposal, won, lost) | NOT NULL DEFAULT 'prospecting' | Tier 2 status-driven lifecycle. |
| `probability_percent` | DECIMAL(6,3) | CHECK (probability_percent IS NULL OR probability_percent BETWEEN 0 AND 100) | Auto-suggested on stage change (10/30/60/100/0) by trigger, then freely editable — a starting point, not a lock. |
| `expected_close_date` | DATE |  |  |
| `description` | TEXT |  |  |
| `owner_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | The salesperson; the Owner filter and 'Restrict Manager to Only Their Own Opportunities' both key on it. |
| `service_category_id` | CHAR(36) | REFERENCES service_categories(id) ON DELETE RESTRICT | Masters 3.12; added to the Pipeline filter set in the current revision. |
| `lost_reason` | TEXT | CHECK (stage <> 'lost' OR lost_reason IS NOT NULL) | The required Lost reason, enforced at the row rather than only in the immediate UI prompt — so drag-and-drop into Lost cannot bypass it either. |
| `lost_at` | DATETIME(6) | CHECK ((stage = 'lost') = (lost_at IS NOT NULL)) |  |
| `won_at` | DATETIME(6) | CHECK ((stage = 'won') = (won_at IS NOT NULL)) |  |
| `won_source` | opportunity_won_source (enum: direct, project_creation) | CHECK ((stage = 'won') = (won_source IS NOT NULL)) | Records which of 3.3's two paths set it Won — a direct user action here, or the automatic side effect of Project creation. Needed so this module never assumes Path A. |
| `is_open` | TINYINT(1) | GENERATED ALWAYS AS (stage NOT IN ('won','lost')) STORED | DERIVED — generated column (single-row, immutable). Backs Customer Directory's 'has open opportunities' toggle and excludes closed deals from active pipeline totals. |
| `last_activity_at` | DATETIME(6) |  | DERIVED across rows by trigger from opportunity_activities — the 'stale — no activity in N days' toggle measures against it. |

**Indexes**
- CREATE UNIQUE INDEX uq_opportunities_code ON opportunities(opportunity_code)
- CREATE INDEX ix_opportunities_customer ON opportunities(customer_id)
- CREATE INDEX ix_opportunities_stage ON opportunities(stage)
- CREATE INDEX ix_opportunities_owner ON opportunities(owner_employee_id)
- CREATE INDEX ix_opportunities_expected_close ON opportunities(expected_close_date)
- CREATE INDEX ix_opportunities_overdue_open ON opportunities(expected_close_date) WHERE is_open — 'past expected close, still open' toggle
- CREATE INDEX ix_opportunities_stale ON opportunities(last_activity_at NULLS FIRST) WHERE is_open
- CREATE INDEX ix_opportunities_value ON opportunities(value_amount)
- CREATE INDEX ix_opportunities_fy ON opportunities(financial_year_id)
- CREATE INDEX ix_opportunities_service_category ON opportunities(service_category_id)

**Triggers**
- trg_opportunities_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_opportunities_stage_transition — BEFORE UPDATE OF stage: stamps won_at/lost_at, sets won_source, and auto-fills probability_percent to the stage's suggested value when the caller has not supplied one
- trg_opportunities_won_promotes_customer — AFTER UPDATE OF stage: moves a Prospect customer to Active (Customer 3.4). Spans tables, so a trigger.
- trg_opportunities_set_updated_at — BEFORE UPDATE

### `opportunity_activities`  _(09 Opportunity)_

IMMUTABLE chronological timeline of calls, emails, meetings and notes on one deal (2.3, Activities tab) — same shape as customer_activities by design.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `opportunity_id` | CHAR(36) | NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT |  |
| `activity_type` | activity_type (enum: call, email, meeting, note) | NOT NULL |  |
| `activity_date` | DATE | NOT NULL DEFAULT current_date | Defaults to today, backdatable. |
| `description` | TEXT | NOT NULL |  |
| `related_contact_id` | CHAR(36) | REFERENCES customer_contacts(id) ON DELETE RESTRICT | Drawn from the linked Customer's contacts — the dropdown query restricts to that customer; the FK does not. |
| `logged_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `logged_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE INDEX ix_opportunity_activities_opportunity ON opportunity_activities(opportunity_id, activity_date DESC, logged_at DESC)
- CREATE INDEX ix_opportunity_activities_type ON opportunity_activities(activity_type)
- CREATE INDEX ix_opportunity_activities_logged_by ON opportunity_activities(logged_by_user_id)

**Triggers**
- trg_opportunity_activities_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only)
- trg_opportunity_activities_touch_last_activity — AFTER INSERT: maintains opportunities.last_activity_at, which is what makes the 'stale' filter measurable

### `opportunity_files`  _(09 Opportunity)_

Proposals, pricing worksheets, discovery notes and similar documents against a deal (2.3, Files tab).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `opportunity_id` | CHAR(36) | NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT |  |
| `file_name` | TEXT | NOT NULL |  |
| `storage_path` | TEXT | NOT NULL |  |
| `mime_type` | TEXT | NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document')) |  |
| `file_size_bytes` | BIGINT | NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880) |  |

**Indexes**
- CREATE INDEX ix_opportunity_files_opportunity ON opportunity_files(opportunity_id, created_at DESC)
- CREATE INDEX ix_opportunity_files_uploaded_by ON opportunity_files(created_by)

**Triggers**
- trg_opportunity_files_set_updated_at — BEFORE UPDATE

### `projects`  _(10 Project)_

One delivery project for a customer — the record behind the Project Directory and the parent of the board, sprints, bugs, milestones and timesheets (Module 10).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_code` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. PRJ-2026-0001, from document_number_sequences (code_type='project_code', financial_year_id). |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | The Directory filters on Financial Year; FY-lock trigger applies. |
| `project_name` | TEXT | NOT NULL CHECK (char_length(project_name) BETWEEN 2 AND 150) |  |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `opportunity_id` | CHAR(36) | REFERENCES opportunities(id) ON DELETE RESTRICT | Optional origin. Selecting one triggers Path B of the Won trigger; leaving it blank skips that entirely. |
| `status` | project_status (enum: not_started, in_progress, on_hold, completed) | NOT NULL DEFAULT 'not_started' | Tier 2 status-driven lifecycle. |
| `start_date` | DATE |  |  |
| `end_date` | DATE | CHECK (end_date IS NULL OR start_date IS NULL OR end_date > start_date) |  |
| `budget_amount` | DECIMAL(14,2) | CHECK (budget_amount IS NULL OR budget_amount > 0) | Visible to Employee by default; the 'Hide Budget from Employee's Project View' toggle is a Layer 3 field rule over this column, not a second column. |
| `description` | TEXT |  |  |
| `project_lead_employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | Deliberately named Project Lead, not Manager — a per-project designation unrelated to the system-wide Manager role. Any employee of any role can hold it, and it is who approves timesheets. |
| `service_category_id` | CHAR(36) | REFERENCES service_categories(id) ON DELETE RESTRICT | Masters 3.12; added to the Directory filter set. |
| `is_archived` | TINYINT(1) | NOT NULL DEFAULT false | Backs Super Admin's 'show archived/closed projects' toggle. |
| `last_activity_at` | DATETIME(6) |  | DERIVED across rows by trigger from tasks, bugs and work_item_comments — the Directory's 'no activity in N days' toggle measures against it. |

**Indexes**
- CREATE UNIQUE INDEX uq_projects_project_code ON projects(project_code)
- CREATE INDEX ix_projects_customer ON projects(customer_id)
- CREATE INDEX ix_projects_status ON projects(status)
- CREATE INDEX ix_projects_lead ON projects(project_lead_employee_id)
- CREATE INDEX ix_projects_opportunity ON projects(opportunity_id) WHERE opportunity_id IS NOT NULL
- CREATE INDEX ix_projects_start_date ON projects(start_date)
- CREATE INDEX ix_projects_end_date ON projects(end_date)
- CREATE INDEX ix_projects_overdue ON projects(end_date) WHERE status <> 'completed' — 'past End Date, not Completed' toggle
- CREATE INDEX ix_projects_stale ON projects(last_activity_at NULLS FIRST) WHERE status IN ('not_started','in_progress','on_hold')
- CREATE INDEX ix_projects_fy ON projects(financial_year_id)
- CREATE INDEX ix_projects_budget ON projects(budget_amount)

**Triggers**
- trg_projects_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_projects_win_linked_opportunity — AFTER INSERT OR UPDATE OF opportunity_id: implements Path B (Opportunity 3.3) — if the linked opportunity is not already Won, sets it to Won with won_source='project_creation'. Spans tables, so a trigger.
- trg_projects_sync_lead_membership — AFTER INSERT OR UPDATE OF project_lead_employee_id: keeps exactly one project_members row at role_on_project='lead' in step with this column
- trg_projects_set_updated_at — BEFORE UPDATE

### `project_members`  _(10 Project)_

Who is staffed on a project — the Project Lead plus Members (2.2). Also the set the Assignee dropdowns on Task Detail and Bugs are drawn from, and what the Directory's Team Member filter searches.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `role_on_project` | project_member_role (enum: lead, member) | NOT NULL DEFAULT 'member' | Exactly one lead per project — a partial unique index, not an application check. |
| `added_on` | DATE | NOT NULL DEFAULT current_date |  |
| `removed_on` | DATE | CHECK (removed_on IS NULL OR removed_on >= added_on) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true, CHECK (is_active = (removed_on IS NULL)) | Tier 1 soft delete with a reference guard — a member with tasks, comments or timesheet entries is deactivated, never removed, so historical assignment survives destaffing. |

**Indexes**
- CREATE UNIQUE INDEX uq_project_members_project_employee ON project_members(project_id, employee_id)
- CREATE UNIQUE INDEX uq_project_one_lead ON project_members(project_id) WHERE role_on_project = 'lead' AND is_active — 'only one Project Lead' as a partial unique index
- CREATE INDEX ix_project_members_employee ON project_members(employee_id) WHERE is_active — the Employee-scoped Directory and the Team Member filter
- CREATE INDEX ix_project_members_project ON project_members(project_id) WHERE is_active

**Triggers**
- trg_project_members_set_updated_at — BEFORE UPDATE
- trg_project_members_guard_references — BEFORE DELETE: blocks a hard delete when the member has tasks, bugs, comments or timesheet entries on that project, forcing the soft-delete path

### `sprints`  _(10 Project)_

Short work cycles within a project (2.5) — a planning lens over the same tasks, not a second place tasks live.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `name` | TEXT | NOT NULL |  |
| `start_date` | DATE | NOT NULL |  |
| `end_date` | DATE | NOT NULL CHECK (end_date > start_date) |  |
| `status` | sprint_status (enum: planned, active, completed) | NOT NULL DEFAULT 'active' | Start Sprint creates the row at active; planned exists for sprints laid out ahead. Tier 2 lifecycle. |
| `completed_at` | DATETIME(6) | CHECK ((status = 'completed') = (completed_at IS NOT NULL)) |  |

**Indexes**
- CREATE UNIQUE INDEX uq_sprints_project_name ON sprints(project_id, lower(name))
- CREATE UNIQUE INDEX uq_sprints_one_active_per_project ON sprints(project_id) WHERE status = 'active' — backs the 'current sprint only' toggle as a partial unique index
- CREATE INDEX ix_sprints_project_dates ON sprints(project_id, start_date DESC)
- CREATE INDEX ix_sprints_status ON sprints(status)

**Triggers**
- trg_sprints_complete_returns_tasks — AFTER UPDATE OF status to 'completed': every linked task not at status 'done' returns to 'backlog' and has sprint_id cleared, carrying unfinished work forward (2.5)
- trg_sprints_set_updated_at — BEFORE UPDATE

### `tasks`  _(10 Project)_

One card on the Kanban board (2.3) and the record behind Task Detail (2.4). The board's five columns are this table's status values.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `task_number` | VARCHAR(191) | NOT NULL UNIQUE | The searchable 'Task ID'. FULL rendered code from document_number_sequences (code_type='task_number', financial_year_id), allocated FOR UPDATE in the creating transaction. |
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Required by the numbering rule and covered by the FY-lock trigger like every other FY-dated record. |
| `title` | TEXT | NOT NULL CHECK (char_length(title) > 0) |  |
| `description` | TEXT |  |  |
| `assignee_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Nullable — see notes: the Fields Table marks Assignee required while the board carries an 'Unassigned only' filter, and an unsatisfiable filter is the worse outcome. Required-ness is enforced in the form, not the column. |
| `due_date` | DATE |  |  |
| `status` | task_status (enum: backlog, to_do, in_progress, in_review, done) | NOT NULL DEFAULT 'backlog' | Board column and Status dropdown are the same field — neither is the 'real' one. |
| `priority` | work_item_priority (enum: low, medium, high, urgent) | NOT NULL DEFAULT 'medium' | Not in the 2.4 Fields Table but required by the Task Board and Project Report filter sets. |
| `sprint_id` | CHAR(36) | REFERENCES sprints(id) ON DELETE RESTRICT | Optional sprint membership; cleared automatically when a sprint completes with the task unfinished. |
| `completed_at` | DATETIME(6) | CHECK ((status = 'done') = (completed_at IS NOT NULL)) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 soft delete. The Manager/Super-Admin Delete action sets this false rather than removing the row, because work_item_comments is append-only and a hard delete would have to destroy an immutable log. |
| `deleted_at` | DATETIME(6) | CHECK (is_active = (deleted_at IS NULL)) |  |
| `deleted_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)) |  |

**Indexes**
- CREATE UNIQUE INDEX uq_tasks_task_number ON tasks(task_number)
- CREATE INDEX ix_tasks_project_status ON tasks(project_id, status) WHERE is_active — the board, and each column's filtered count
- CREATE INDEX ix_tasks_assignee ON tasks(assignee_employee_id) WHERE is_active
- CREATE INDEX ix_tasks_unassigned ON tasks(project_id) WHERE assignee_employee_id IS NULL AND is_active — 'Unassigned only' toggle
- CREATE INDEX ix_tasks_overdue ON tasks(due_date) WHERE status <> 'done' AND is_active — 'Overdue only' toggle
- CREATE INDEX ix_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL
- CREATE INDEX ix_tasks_priority ON tasks(priority)
- CREATE INDEX ix_tasks_created_by ON tasks(created_by)
- CREATE INDEX ix_tasks_created_at ON tasks(created_at)
- CREATE INDEX ix_tasks_fy ON tasks(financial_year_id)

**Triggers**
- trg_tasks_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_tasks_stamp_completion — BEFORE UPDATE OF status: sets/clears completed_at on entering or leaving 'done'
- trg_tasks_touch_project_activity — AFTER INSERT OR UPDATE: maintains projects.last_activity_at
- trg_tasks_set_updated_at — BEFORE UPDATE

### `labels`  _(10 Project)_

The Label/Tag vocabulary the Task Board filters on — project-scoped, or global when project_id is null.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_id` | CHAR(36) | REFERENCES projects(id) ON DELETE RESTRICT | Null means a global label available on every board. |
| `name` | TEXT | NOT NULL CHECK (char_length(name) > 0) |  |
| `color_hex` | TEXT | NOT NULL DEFAULT '#6B7280' CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$') |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 — a label already applied to a task is deactivated, never deleted; deactivation never rewrites the tasks it is on. Active-only filtering happens in the picker query. |

**Indexes**
- CREATE UNIQUE INDEX uq_labels_project_name ON labels(project_id, lower(name)) WHERE project_id IS NOT NULL
- CREATE UNIQUE INDEX uq_labels_global_name ON labels(lower(name)) WHERE project_id IS NULL
- CREATE INDEX ix_labels_project ON labels(project_id) WHERE is_active

**Triggers**
- trg_labels_set_updated_at — BEFORE UPDATE
- trg_labels_guard_deactivation — BEFORE DELETE: blocks a hard delete once the label is referenced by task_label_links, forcing the is_active path

### `task_label_links`  _(10 Project)_

Which labels are on which task — the join behind the board's Label/Tag filter.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `task_id` | CHAR(36) | NOT NULL REFERENCES tasks(id) ON DELETE CASCADE | Genuinely deletable (tier 3): unlabelling a task is a real DELETE. |
| `label_id` | CHAR(36) | NOT NULL REFERENCES labels(id) ON DELETE RESTRICT | RESTRICT — the label is a masters-style list; removing it from history is never how it gets retired. |

**Indexes**
- CREATE UNIQUE INDEX uq_task_label_links ON task_label_links(task_id, label_id)
- CREATE INDEX ix_task_label_links_label ON task_label_links(label_id)

**Triggers**
- trg_task_label_links_set_updated_at — BEFORE UPDATE

### `sub_tasks`  _(10 Project)_

The simple checklist inside one task (2.4) — TEXT plus a checked/unchecked toggle per line.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `task_id` | CHAR(36) | NOT NULL REFERENCES tasks(id) ON DELETE CASCADE |  |
| `title` | TEXT | NOT NULL CHECK (char_length(title) > 0) |  |
| `is_done` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `completed_at` | DATETIME(6) | CHECK (is_done = (completed_at IS NOT NULL)) |  |
| `completed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((completed_at IS NULL) = (completed_by IS NULL)) |  |
| `sort_order` | INT | NOT NULL DEFAULT 0 | Checklist order as shown; a count, so right-aligned if ever displayed. |

**Indexes**
- CREATE INDEX ix_sub_tasks_task ON sub_tasks(task_id, sort_order)
- CREATE INDEX ix_sub_tasks_open ON sub_tasks(task_id) WHERE NOT is_done

**Triggers**
- trg_sub_tasks_stamp_completion — BEFORE UPDATE OF is_done: sets/clears completed_at and completed_by
- trg_sub_tasks_set_updated_at — BEFORE UPDATE

### `bugs`  _(10 Project)_

A reported issue on a project — a separate tracker from tasks (2.6), kept visually and structurally distinct.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `bug_number` | VARCHAR(191) | NOT NULL UNIQUE | The searchable 'Bug ID'. FULL rendered code from document_number_sequences (code_type='bug_number', financial_year_id). |
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock trigger applies. |
| `title` | TEXT | NOT NULL CHECK (char_length(title) > 0) |  |
| `description` | TEXT |  |  |
| `severity` | bug_severity (enum: low, medium, high, critical) | NOT NULL | The colored badge that keeps a bug board from ever looking like a task board; multi-select filtering on it is the tracker's most-used control. |
| `status` | bug_status (enum: open, in_progress, fixed, closed) | NOT NULL DEFAULT 'open' | Flagged in the spec itself as a reasonable default rather than a confirmed requirement — an enum, so changing the set is a migration, not a rewrite. |
| `assignee_employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT | Nullable — 'Unassigned only' is a documented filter. |
| `due_date` | DATE |  |  |
| `reported_by_employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | The 'Reported By' filter. |
| `sprint_id` | CHAR(36) | REFERENCES sprints(id) ON DELETE RESTRICT | Project Report filters tasks and bugs together by Sprint, so bugs carry the dimension too. |
| `fixed_at` | DATETIME(6) |  |  |
| `closed_at` | DATETIME(6) | CHECK ((status = 'closed') = (closed_at IS NOT NULL)) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 soft delete, same reasoning as tasks — the Delete action must not destroy append-only comments. |
| `deleted_at` | DATETIME(6) | CHECK (is_active = (deleted_at IS NULL)) |  |
| `deleted_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)) |  |

**Indexes**
- CREATE UNIQUE INDEX uq_bugs_bug_number ON bugs(bug_number)
- CREATE INDEX ix_bugs_project_status ON bugs(project_id, status) WHERE is_active
- CREATE INDEX ix_bugs_severity ON bugs(severity) WHERE is_active
- CREATE INDEX ix_bugs_assignee ON bugs(assignee_employee_id) WHERE is_active
- CREATE INDEX ix_bugs_unassigned ON bugs(project_id) WHERE assignee_employee_id IS NULL AND is_active
- CREATE INDEX ix_bugs_overdue ON bugs(due_date) WHERE status NOT IN ('fixed','closed') AND is_active
- CREATE INDEX ix_bugs_reported_by ON bugs(reported_by_employee_id)
- CREATE INDEX ix_bugs_sprint ON bugs(sprint_id) WHERE sprint_id IS NOT NULL
- CREATE INDEX ix_bugs_created_at ON bugs(created_at)
- CREATE INDEX ix_bugs_fy ON bugs(financial_year_id)

**Triggers**
- trg_bugs_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_bugs_stamp_status_timestamps — BEFORE UPDATE OF status: sets fixed_at / closed_at
- trg_bugs_touch_project_activity — AFTER INSERT OR UPDATE: maintains projects.last_activity_at
- trg_bugs_set_updated_at — BEFORE UPDATE

### `work_item_comments`  _(10 Project)_

IMMUTABLE comment thread shared by tasks and bugs (2.4, 2.6) — 'never deleted or edited once posted, only added to', which is exactly the append-only rule.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `work_item_type` | work_item_type (enum: task, bug) | NOT NULL |  |
| `task_id` | CHAR(36) | REFERENCES tasks(id) ON DELETE RESTRICT |  |
| `bug_id` | CHAR(36) | REFERENCES bugs(id) ON DELETE RESTRICT | Table CHECK: ((work_item_type='task' AND task_id IS NOT NULL AND bug_id IS NULL) OR (work_item_type='bug' AND bug_id IS NOT NULL AND task_id IS NULL)). Two real FKs rather than a type/id pair with no referential integrity. |
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT | Denormalised from the parent so project-scoped reads and the last_activity_at rollup never need a join through two possible parents. |
| `author_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `body` | TEXT | NOT NULL CHECK (char_length(body) > 0) |  |
| `posted_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE INDEX ix_work_item_comments_task ON work_item_comments(task_id, posted_at) WHERE task_id IS NOT NULL
- CREATE INDEX ix_work_item_comments_bug ON work_item_comments(bug_id, posted_at) WHERE bug_id IS NOT NULL
- CREATE INDEX ix_work_item_comments_project ON work_item_comments(project_id, posted_at DESC)
- CREATE INDEX ix_work_item_comments_author ON work_item_comments(author_user_id)

**Triggers**
- trg_work_item_comments_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only)
- trg_work_item_comments_touch_project_activity — AFTER INSERT: maintains projects.last_activity_at
- trg_work_item_comments_denormalise_project — BEFORE INSERT: fills project_id from the parent task or bug so the caller cannot set it inconsistently

### `milestones`  _(10 Project)_

Key dates and deliverables within a project (2.8) — a higher-level view than individual tasks.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `name` | TEXT | NOT NULL CHECK (char_length(name) > 0) |  |
| `target_date` | DATE | NOT NULL |  |
| `description` | TEXT |  |  |
| `status` | milestone_status (enum: upcoming, reached, missed) | NOT NULL DEFAULT 'upcoming' | Reached is set manually — deliberately NOT inferred from linked-task completion, since a milestone can be reached for reasons beyond 'all tasks done'. Missed is set automatically once target_date passes while still upcoming. |
| `reached_on` | DATE | CHECK ((status = 'reached') = (reached_on IS NOT NULL)) |  |
| `marked_reached_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((reached_on IS NULL) = (marked_reached_by IS NULL)) |  |

**Indexes**
- CREATE UNIQUE INDEX uq_milestones_project_name ON milestones(project_id, lower(name))
- CREATE INDEX ix_milestones_project_target ON milestones(project_id, target_date) — the list's default sort
- CREATE INDEX ix_milestones_status ON milestones(status)
- CREATE INDEX ix_milestones_overdue ON milestones(target_date) WHERE status = 'upcoming' — 'past Target Date, not Reached' toggle

**Triggers**
- trg_milestones_mark_missed — BEFORE INSERT/UPDATE plus a nightly job calling the same function: flips upcoming → missed once target_date is past. Depends on the current date, so it cannot be a generated column.
- trg_milestones_set_updated_at — BEFORE UPDATE

### `milestone_tasks`  _(10 Project)_

Which of a project's tasks a milestone is measured by — the join behind the '3/5 tasks done' rollup.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `milestone_id` | CHAR(36) | NOT NULL REFERENCES milestones(id) ON DELETE CASCADE |  |
| `task_id` | CHAR(36) | NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT | RESTRICT: a task counted toward a milestone is soft-deleted, never removed out from under the rollup. |

**Indexes**
- CREATE UNIQUE INDEX uq_milestone_tasks ON milestone_tasks(milestone_id, task_id)
- CREATE INDEX ix_milestone_tasks_task ON milestone_tasks(task_id)

**Triggers**
- trg_milestone_tasks_same_project — BEFORE INSERT OR UPDATE: rejects a task belonging to a different project than the milestone
- trg_milestone_tasks_set_updated_at — BEFORE UPDATE

### `timesheet_entries`  _(10 Project)_

Hours logged per person per day against a task or a non-task category (2.8) — project effort tracking, and the Approved-hours input Payroll's hour-basis calculation reads.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `project_id` | CHAR(36) | NOT NULL REFERENCES projects(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Feeds payroll, so unambiguously an FY-dated business record; FY-lock trigger applies. |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | The 'Person' field — read-only, auto-set to the logged-in team member. |
| `entry_date` | DATE | NOT NULL CHECK (entry_date <= current_date) | Cannot be in the future. |
| `task_id` | CHAR(36) | REFERENCES tasks(id) ON DELETE RESTRICT |  |
| `non_task_category` | timesheet_non_task_category (enum: bench_free_time, internal_meeting, training_learning, admin_overhead, other) | CHECK ((task_id IS NOT NULL) <> (non_task_category IS NOT NULL)) | Exactly one of task or category. The five categories exist so non-task time is honest and visible; downstream, Approved hours count identically either way. |
| `hours` | DECIMAL(6,2) | NOT NULL CHECK (hours > 0 AND hours <= 24) | Hard cap at 24 per entry; the >12 plausibility warning is a UI soft check, deliberately not a constraint. |
| `notes` | TEXT |  |  |
| `approval_status` | timesheet_status (enum: draft, submitted, approved) | NOT NULL DEFAULT 'submitted' | Only approved hours count toward Payroll's hour-basis input — the same principle Leave uses for Taken. |
| `submitted_at` | DATETIME(6) | CHECK ((approval_status IN ('submitted','approved')) = (submitted_at IS NOT NULL)) | Backs the 'submitted more than N days ago, still unapproved' toggle. |
| `approved_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | Project Lead, Manager or Super Admin. |
| `approved_at` | DATETIME(6) | CHECK ((approval_status = 'approved') = (approved_at IS NOT NULL)), CHECK ((approved_at IS NULL) = (approved_by_user_id IS NULL)) |  |

**Indexes**
- CREATE INDEX ix_timesheet_entries_employee_date ON timesheet_entries(employee_id, entry_date DESC) — My Timesheet and the weekly running total
- CREATE INDEX ix_timesheet_entries_project_date ON timesheet_entries(project_id, entry_date DESC) — Team Timesheet
- CREATE INDEX ix_timesheet_entries_approval ON timesheet_entries(approval_status)
- CREATE INDEX ix_timesheet_entries_aging ON timesheet_entries(submitted_at) WHERE approval_status = 'submitted' — the ageing-unapproved toggle, which has a real payroll consequence
- CREATE INDEX ix_timesheet_entries_task ON timesheet_entries(task_id) WHERE task_id IS NOT NULL
- CREATE INDEX ix_timesheet_entries_category ON timesheet_entries(non_task_category) WHERE non_task_category IS NOT NULL
- CREATE INDEX ix_timesheet_entries_payroll ON timesheet_entries(employee_id, entry_date) WHERE approval_status = 'approved' — the Payroll read path
- CREATE INDEX ix_timesheet_entries_fy ON timesheet_entries(financial_year_id)

**Triggers**
- trg_timesheet_entries_fy_lock — BEFORE INSERT/UPDATE/DELETE EXECUTE fn_reject_if_fy_locked()
- trg_timesheet_entries_stamp_workflow — BEFORE UPDATE OF approval_status: stamps submitted_at / approved_at / approved_by_user_id and refuses a backwards move out of approved without an explicit reopen
- trg_timesheet_entries_task_belongs_to_project — BEFORE INSERT OR UPDATE: rejects a task from a different project
- trg_timesheet_entries_set_updated_at — BEFORE UPDATE

### `screens`  _(14 RBAC)_

The Screen Inventory (Section 3) as data — every screen in all 13 functional modules plus Settings, roughly 81 rows. This is what Layer 1 attaches to and what the Role Permission Matrix is built around.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `screen_key` | VARCHAR(191) | NOT NULL UNIQUE | Stable machine key, e.g. 'asset.directory', 'customer.360.invoices'. Never renamed — display names change, keys do not, so permission rows survive relabelling. |
| `module_key` | cms_module (enum: masters, employee, asset_management, ticket, leave, payroll, vendor, customer, opportunity, project, invoice, expense, purchase_bill, rbac, settings) | NOT NULL | The Matrix's collapsible sections, in this order. RBAC's own screens are present but never configurable — Super Admin has unconditional access. |
| `screen_name` | TEXT | NOT NULL |  |
| `parent_screen_id` | CHAR(36) | REFERENCES screens(id) ON DELETE RESTRICT | Customer 360's eight tabs, Masters' sub-masters, and Taxes/Work Week/Email Configuration's tabs hang off their parent record screen. |
| `screen_kind` | screen_kind (enum: list, record, tab, form, report, dashboard, queue, log) | NOT NULL |  |
| `is_list_screen` | TINYINT(1) | NOT NULL DEFAULT false | Drives the Filter & Export Convention (2.2). Kept an explicit editorial flag rather than derived from screen_kind, because 'shows more than one record' includes list-bearing tabs on record screens. |
| `is_self_service` | TINYINT(1) | NOT NULL DEFAULT false | My Leave, My Payslips, My Assets and the rest — these are list screens too, which was the change 2.2(a) had to state plainly. |
| `supports_scope` | TINYINT(1) | NOT NULL DEFAULT false | Whether Layer 4 means anything here. Financial Year is company-wide and singular, so its row is false and the Matrix simply shows no scope selector. |
| `default_scope` | permission_scope (enum: all, team, own) | CHECK (supports_scope OR default_scope IS NULL) |  |
| `sidebar_group` | TEXT |  | Navigation position, deliberately allowed to diverge from module_key — 'Leave & Payroll' is one nav entry over two modules; My Tickets sits under Ticket, My Projects & Tasks under Project. Not a Layer 1 concern. |
| `sidebar_sort_order` | INT | NOT NULL DEFAULT 0 |  |
| `description` | TEXT |  |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 — a retired screen (Team Leave Calendar, Quote) is deactivated, keeping its historical permission rows and change-log references intact. |

**Indexes**
- CREATE UNIQUE INDEX uq_screens_screen_key ON screens(screen_key)
- CREATE INDEX ix_screens_module ON screens(module_key, sidebar_sort_order)
- CREATE INDEX ix_screens_parent ON screens(parent_screen_id) WHERE parent_screen_id IS NOT NULL
- CREATE INDEX ix_screens_list ON screens(module_key) WHERE is_list_screen AND is_active
- `ix_screens_search` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_screens_search (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_screens_set_updated_at — BEFORE UPDATE
- trg_screens_guard_deactivation — BEFORE DELETE: blocks hard delete once role_permissions or permission_change_log reference the screen

### `screen_actions`  _(14 RBAC)_

Layer 2's catalog — the real, per-screen action list pulled from each module's own documentation (Reply / Add Internal Note / Change Status / Reassign on a ticket; Approve / Reject on an approval queue). There is deliberately no universal action list.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `screen_id` | CHAR(36) | NOT NULL REFERENCES screens(id) ON DELETE RESTRICT |  |
| `action_key` | TEXT | NOT NULL | e.g. 'reply', 'add_internal_note', 'change_status', 'reassign', 'approve', 'reject', 'assign', 'transfer', 'unassign', 'mark_retired', 'start_sprint', 'complete_sprint', 'delete'. |
| `action_name` | TEXT | NOT NULL |  |
| `is_super_admin_only` | TINYINT(1) | NOT NULL DEFAULT false | For actions that are never toggle-able for any other role — Delete/Deactivate on the Asset Master Record is the stated example. |
| `is_destructive` | TINYINT(1) | NOT NULL DEFAULT false | Drives the confirm-before-you-go prompt (Mark Retired/Disposed, Delete Task/Bug, Complete Sprint). |
| `sort_order` | INT | NOT NULL DEFAULT 0 |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 — referenced by role_permission_actions, user_permission_overrides and the change log. |

**Indexes**
- CREATE UNIQUE INDEX uq_screen_actions_screen_key ON screen_actions(screen_id, action_key)
- CREATE INDEX ix_screen_actions_screen ON screen_actions(screen_id, sort_order) WHERE is_active
- CREATE INDEX ix_screen_actions_super_admin_only ON screen_actions(screen_id) WHERE is_super_admin_only

**Triggers**
- trg_screen_actions_set_updated_at — BEFORE UPDATE
- trg_screen_actions_block_super_admin_only_grant — BEFORE INSERT OR UPDATE on role_permission_actions (declared with this catalog): refuses to allow a super-admin-only action for any other role, so the rule cannot be defeated from the Matrix

### `screen_sensitive_fields`  _(14 RBAC)_

Layer 3's catalog — the specific fields that can be shown, masked, or hidden per role independently of whether the screen itself is visible (Purchase Value, Current Value, Budget, Collected Into, bank details, adjustment labels).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `screen_id` | CHAR(36) | NOT NULL REFERENCES screens(id) ON DELETE RESTRICT |  |
| `field_key` | TEXT | NOT NULL | e.g. 'purchase_value', 'current_value', 'project_budget', 'collected_into_bank_account', 'customer_account_number'. |
| `field_label` | TEXT | NOT NULL |  |
| `default_visibility` | field_visibility (enum: show, mask, hide) | NOT NULL DEFAULT 'show' |  |
| `supports_mask` | TINYINT(1) | NOT NULL DEFAULT false | Not every field has a meaningful masked form; an amount is shown or hidden, an account number masks to last four. |
| `mask_pattern` | TEXT | CHECK (supports_mask OR mask_pattern IS NULL) | e.g. '••••{last4}'. A masked value keeps the alignment of the value it replaces (2.2 c-i, point 4), so masking never shifts a table's layout for one role. |
| `hides_dependent_filter` | TINYINT(1) | NOT NULL DEFAULT true | Encodes exception (b)(2): when the field is hidden from a role, its range/value filter goes with it. Purchase Value on the Asset Directory is the convention's own worked example. |
| `related_feature_toggle_id` | CHAR(36) | REFERENCES feature_toggles(id) ON DELETE RESTRICT | Ties the field to its named toggle, e.g. 'Show Purchase Value to Manager' — so the Matrix renders one control, not two that can disagree. |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- CREATE UNIQUE INDEX uq_screen_sensitive_fields ON screen_sensitive_fields(screen_id, field_key)
- CREATE INDEX ix_screen_sensitive_fields_screen ON screen_sensitive_fields(screen_id) WHERE is_active
- CREATE INDEX ix_screen_sensitive_fields_toggle ON screen_sensitive_fields(related_feature_toggle_id)

**Triggers**
- trg_screen_sensitive_fields_set_updated_at — BEFORE UPDATE

### `role_permissions`  _(14 RBAC)_

LAYER 1 and LAYER 4 as one real row per (role, screen): whether the screen exists at all for that role, and what slice of data it shows. The spine the other two layers hang off.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `role_id` | CHAR(36) | NOT NULL REFERENCES roles(id) ON DELETE RESTRICT | Five roles today — Super Admin, Employee, Manager, Accountant, HR — and the model takes a sixth without restructuring, which is the whole point of keeping this a table rather than code. |
| `screen_id` | CHAR(36) | NOT NULL REFERENCES screens(id) ON DELETE RESTRICT |  |
| `is_visible` | TINYINT(1) | NOT NULL DEFAULT false | LAYER 1. Hidden means absent from navigation and unreachable by URL — not greyed out, not an access-denied page. Defaults closed. |
| `data_scope` | permission_scope (enum: all, team, own) | CHECK (data_scope IS NULL OR is_visible) | LAYER 4. Null where the screen has no meaningful scope dimension, so the Matrix shows no selector rather than forcing one. Applied BEFORE any filter, which is what makes universal filter and export access safe. |
| `scope_note` | TEXT |  | Where a module defines a bespoke scope meaning — e.g. Employee on Customer 360 scoped to customers tied to their assigned projects (workflow 5.2), which is a Team/Own-equivalent for a module with no personal ownership concept for that role. |
| `is_role_default` | TINYINT(1) | NOT NULL DEFAULT true | Distinguishes a seeded documented default from a Super Admin edit, so the UI can show 'differs from the shipped default' alongside 'differs from role default'. |

**Indexes**
- CREATE UNIQUE INDEX uq_role_permissions_role_screen ON role_permissions(role_id, screen_id) — exactly one row per (role, screen)
- CREATE INDEX ix_role_permissions_screen ON role_permissions(screen_id)
- CREATE INDEX ix_role_permissions_visible ON role_permissions(role_id) WHERE is_visible — the nav build for a role
- CREATE INDEX ix_role_permissions_scope ON role_permissions(data_scope) WHERE data_scope IS NOT NULL

**Triggers**
- trg_role_permissions_log_change — AFTER INSERT OR UPDATE: writes permission_change_log with before/after payloads, target_type='role'
- trg_role_permissions_warn_active_users — BEFORE UPDATE OF is_visible to false: raises a catchable notice carrying the count of users in that role who used the screen recently, so the UI can warn before saving rather than removing it silently
- trg_role_permissions_set_updated_at — BEFORE UPDATE

### `role_permission_actions`  _(14 RBAC)_

LAYER 2 as real rows — which of a screen's documented actions this role may perform, only meaningful while the parent screen is Visible.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `role_permission_id` | CHAR(36) | NOT NULL REFERENCES role_permissions(id) ON DELETE CASCADE | CASCADE is correct here and only here: these rows have no meaning apart from their (role, screen) parent, and the audit trail lives in permission_change_log, not in the row. |
| `screen_action_id` | CHAR(36) | NOT NULL REFERENCES screen_actions(id) ON DELETE RESTRICT |  |
| `is_allowed` | TINYINT(1) | NOT NULL DEFAULT false |  |

**Indexes**
- CREATE UNIQUE INDEX uq_role_permission_actions ON role_permission_actions(role_permission_id, screen_action_id)
- CREATE INDEX ix_role_permission_actions_action ON role_permission_actions(screen_action_id) — answers 'which roles can Reassign?' across the whole CMS
- CREATE INDEX ix_role_permission_actions_allowed ON role_permission_actions(role_permission_id) WHERE is_allowed

**Triggers**
- trg_role_permission_actions_same_screen — BEFORE INSERT OR UPDATE: rejects a screen_action belonging to a different screen than the parent role_permission
- trg_role_permission_actions_log_change — AFTER INSERT OR UPDATE: writes permission_change_log, permission_layer='action'
- trg_role_permission_actions_set_updated_at — BEFORE UPDATE

### `role_permission_fields`  _(14 RBAC)_

LAYER 3 as real rows — show / mask / hide per (role, screen, sensitive field), independent of whether the screen itself is visible.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `role_permission_id` | CHAR(36) | NOT NULL REFERENCES role_permissions(id) ON DELETE CASCADE |  |
| `screen_sensitive_field_id` | CHAR(36) | NOT NULL REFERENCES screen_sensitive_fields(id) ON DELETE RESTRICT |  |
| `visibility` | field_visibility (enum: show, mask, hide) | NOT NULL DEFAULT 'hide' | Three states, not a TINYINT(1) — 'HDFC ••••9021' is a different answer from both the full number and no column at all. |

**Indexes**
- CREATE UNIQUE INDEX uq_role_permission_fields ON role_permission_fields(role_permission_id, screen_sensitive_field_id)
- CREATE INDEX ix_role_permission_fields_field ON role_permission_fields(screen_sensitive_field_id) — 'who can see Purchase Value?' in one query
- CREATE INDEX ix_role_permission_fields_hidden ON role_permission_fields(role_permission_id) WHERE visibility <> 'show'

**Triggers**
- trg_role_permission_fields_same_screen — BEFORE INSERT OR UPDATE: rejects a sensitive field belonging to a different screen than the parent role_permission
- trg_role_permission_fields_reject_unsupported_mask — BEFORE INSERT OR UPDATE: rejects visibility='mask' where the field's supports_mask is false
- trg_role_permission_fields_log_change — AFTER INSERT OR UPDATE: writes permission_change_log, permission_layer='field'
- trg_role_permission_fields_set_updated_at — BEFORE UPDATE

### `feature_toggles`  _(14 RBAC)_

The 47 named RBAC toggles compiled in Section 2.1 (46 module toggles plus 'Give HR Read-Only Access to the Permission Matrix'), each with its default state, its module, and the screen it attaches to. Retired toggles are kept as rows, not deleted.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `toggle_key` | VARCHAR(191) | NOT NULL UNIQUE | e.g. 'asset.show_purchase_value_to_manager', 'ticket.allow_staff_to_view_full_open_queue', 'project.hide_budget_from_employee'. Stable across renames — 'Allow Accountant to Edit Statutory Rates in Masters' was renamed to 'Allow Accountant to Manage Taxes' without becoming a new toggle. |
| `toggle_name` | TEXT | NOT NULL | The exact display name used in Section 2.1 and in each module's own 'Nothing Here Is Hardcoded' section. |
| `module_key` | cms_module | NOT NULL |  |
| `screen_id` | CHAR(36) | REFERENCES screens(id) ON DELETE RESTRICT | 'Every one of them needs a home on the Role Permission Matrix, under its module's collapsible section, attached to the specific screen it affects.' |
| `affected_role_id` | CHAR(36) | REFERENCES roles(id) ON DELETE RESTRICT | Which role the toggle is about — Manager for 'Show Purchase Value to Manager', HR for 'Allow HR to Edit Core Info'. Null for the workflow rules that apply to everyone ('Require Satisfaction Rating on Close'). |
| `toggle_kind` | toggle_kind (enum: field_visibility, action_grant, scope_widen, workflow_rule) | NOT NULL | Says which layer the toggle actually operates on, so the Matrix renders it in the right place instead of as a free-floating switch. |
| `effect_description` | TEXT | NOT NULL | The 'Effect When Turned On' column, verbatim. |
| `default_state` | TINYINT(1) | NOT NULL DEFAULT false | The documented default. Three ship ON — 'Require Manager Acknowledgment Before HR Processes Exit', 'Notify Employee When a Payslip Is Reissued', and the Budget-shown default expressed as 'Hide Budget from Employee' = OFF. |
| `current_state` | TINYINT(1) | NOT NULL DEFAULT false | What is live now. Seeded equal to default_state. |
| `threshold_amount` | DECIMAL(14,2) | CHECK (threshold_amount IS NULL OR threshold_amount >= 0) | Typed parameter for 'Set an Auto-Approval Threshold' (e.g. ₹500). A typed column rather than a JSONB config blob — JSONB is not an escape hatch. |
| `threshold_days` | DECIMAL(5,2) | CHECK (threshold_days IS NULL OR (threshold_days > 0 AND threshold_days * 2 = floor(threshold_days * 2))) | Typed parameter for 'Require HR Co-Approval for Leave Longer Than X Days' — a day count supporting half-days. |
| `is_retired` | TINYINT(1) | NOT NULL DEFAULT false | 'Show Salary Amount to Manager' is retired but kept as a struck-through row so a future team-level pay view reuses the same setting name. |
| `retired_reason` | TEXT | CHECK (is_retired = (retired_reason IS NOT NULL)) |  |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true |  |

**Indexes**
- CREATE UNIQUE INDEX uq_feature_toggles_key ON feature_toggles(toggle_key)
- CREATE INDEX ix_feature_toggles_module ON feature_toggles(module_key) WHERE NOT is_retired
- CREATE INDEX ix_feature_toggles_screen ON feature_toggles(screen_id)
- CREATE INDEX ix_feature_toggles_role ON feature_toggles(affected_role_id)
- CREATE INDEX ix_feature_toggles_changed ON feature_toggles(module_key) WHERE current_state <> default_state — 'what has been changed from shipped defaults?'

**Triggers**
- trg_feature_toggles_log_change — AFTER UPDATE OF current_state: writes permission_change_log with before/after payloads
- trg_feature_toggles_block_retired_flip — BEFORE UPDATE: rejects a current_state change on a retired toggle
- trg_feature_toggles_set_updated_at — BEFORE UPDATE

### `user_permission_overrides`  _(14 RBAC)_

The override layer sitting on top of all four — one specific person granted or revoked one specific permission, without touching the setting for anyone else who shares their role. Can flip visibility, one action, one field, or scope.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | One person at a time — overrides are individual by definition, so there is no bulk target. |
| `screen_id` | CHAR(36) | NOT NULL REFERENCES screens(id) ON DELETE RESTRICT |  |
| `permission_layer` | permission_layer (enum: visibility, action, field, scope) | NOT NULL | Which of the four this override operates on. A table CHECK enforces that exactly the right value column and target FK are populated for the chosen layer and all others are null. |
| `screen_action_id` | CHAR(36) | REFERENCES screen_actions(id) ON DELETE RESTRICT, CHECK ((permission_layer = 'action') = (screen_action_id IS NOT NULL)) |  |
| `screen_sensitive_field_id` | CHAR(36) | REFERENCES screen_sensitive_fields(id) ON DELETE RESTRICT, CHECK ((permission_layer = 'field') = (screen_sensitive_field_id IS NOT NULL)) |  |
| `override_is_visible` | TINYINT(1) | CHECK ((permission_layer = 'visibility') = (override_is_visible IS NOT NULL)) |  |
| `override_action_allowed` | TINYINT(1) | CHECK ((permission_layer = 'action') = (override_action_allowed IS NOT NULL)) |  |
| `override_field_visibility` | field_visibility | CHECK ((permission_layer = 'field') = (override_field_visibility IS NOT NULL)) |  |
| `override_scope` | permission_scope | CHECK ((permission_layer = 'scope') = (override_scope IS NOT NULL)) |  |
| `effect` | override_effect (enum: grant, revoke) | NOT NULL | Whether this adds something the role default lacks or removes something it has — the Grant/Revoke column on the Active Overrides list and on the company-wide view. |
| `reason` | TEXT |  | Why this person, e.g. the Manager who also handles asset budgeting getting Purchase Value. |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | Tier 1 — 'Remove Override' deactivates. The row survives so the periodic access review can read 'everything granted to this person, ever', which is the stated purpose of that list. |
| `revoked_at` | DATETIME(6) | CHECK (is_active = (revoked_at IS NULL)) |  |
| `revoked_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)) |  |

**Indexes**
- CREATE UNIQUE INDEX uq_user_override_visibility ON user_permission_overrides(user_id, screen_id) WHERE permission_layer = 'visibility' AND is_active
- CREATE UNIQUE INDEX uq_user_override_scope ON user_permission_overrides(user_id, screen_id) WHERE permission_layer = 'scope' AND is_active
- CREATE UNIQUE INDEX uq_user_override_action ON user_permission_overrides(user_id, screen_action_id) WHERE permission_layer = 'action' AND is_active
- CREATE UNIQUE INDEX uq_user_override_field ON user_permission_overrides(user_id, screen_sensitive_field_id) WHERE permission_layer = 'field' AND is_active — four partial unique indexes, one per layer, so 'only one active override per target' is never an application check
- CREATE INDEX ix_user_overrides_user ON user_permission_overrides(user_id) WHERE is_active
- CREATE INDEX ix_user_overrides_screen ON user_permission_overrides(screen_id) — the company-wide view: 'who has an override on Salary Structure?'
- CREATE INDEX ix_user_overrides_layer ON user_permission_overrides(permission_layer)
- CREATE INDEX ix_user_overrides_created ON user_permission_overrides(created_at DESC)
- CREATE INDEX ix_user_overrides_created_by ON user_permission_overrides(created_by)

**Triggers**
- trg_user_permission_overrides_log_change — AFTER INSERT OR UPDATE: writes permission_change_log with target_type='user' and before/after payloads, covering both grant and removal
- trg_user_permission_overrides_same_screen — BEFORE INSERT OR UPDATE: rejects an action or field belonging to a different screen than screen_id
- trg_user_permission_overrides_reject_rbac_screens — BEFORE INSERT: refuses an override targeting an RBAC-module screen, since that module cannot be selectively opened for one person (Section 8)
- trg_user_permission_overrides_set_updated_at — BEFORE UPDATE

### `permission_change_log`  _(14 RBAC)_

IMMUTABLE audit trail of every permission change made anywhere in this module — role defaults, individual overrides, and toggle flips. Who, when, before, after. The one screen where filtering is the whole point.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `changed_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `changed_by_user_id` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `target_type` | permission_target_type (enum: role, user) | NOT NULL |  |
| `target_role_id` | CHAR(36) | REFERENCES roles(id) ON DELETE RESTRICT, CHECK ((target_type = 'role') = (target_role_id IS NOT NULL)) |  |
| `target_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT, CHECK ((target_type = 'user') = (target_user_id IS NOT NULL)) |  |
| `target_name_snapshot` | TEXT | NOT NULL | SNAPSHOT of the role or person name as it read at the time, so a later rename never rewrites history. |
| `module_key` | cms_module | NOT NULL |  |
| `screen_id` | CHAR(36) | REFERENCES screens(id) ON DELETE RESTRICT |  |
| `screen_name_snapshot` | TEXT | NOT NULL | SNAPSHOT — same reason. A renamed or retired screen must still read correctly in an export handed to an auditor. |
| `permission_layer` | permission_layer (enum: visibility, action, field, scope) | NOT NULL |  |
| `permission_label_snapshot` | TEXT | NOT NULL | SNAPSHOT of the action name, field label, or toggle name at the time of the change. |
| `change_effect` | permission_change_effect (enum: grant, revoke, modify) | NOT NULL | The Grant vs. Revoke filter, plus 'modify' for a scope or visibility value that moved without being a clean grant or revoke. |
| `before_value` | JSON |  | JSONB is explicitly sanctioned here. The before payload of whatever changed — one of the few genuinely open-ended shapes in the schema, because it spans four structurally different layers. |
| `after_value` | JSON | NOT NULL |  |
| `role_permission_id` | CHAR(36) | REFERENCES role_permissions(id) ON DELETE RESTRICT |  |
| `user_permission_override_id` | CHAR(36) | REFERENCES user_permission_overrides(id) ON DELETE RESTRICT |  |
| `feature_toggle_id` | CHAR(36) | REFERENCES feature_toggles(id) ON DELETE RESTRICT | Set when the change was a toggle flip rather than a matrix or override edit. |

**Indexes**
- CREATE INDEX ix_permission_change_log_changed_at ON permission_change_log(changed_at DESC) — the default view
- CREATE INDEX ix_permission_change_log_changed_by ON permission_change_log(changed_by_user_id)
- CREATE INDEX ix_permission_change_log_target_user ON permission_change_log(target_user_id) WHERE target_user_id IS NOT NULL
- CREATE INDEX ix_permission_change_log_target_role ON permission_change_log(target_role_id) WHERE target_role_id IS NOT NULL
- CREATE INDEX ix_permission_change_log_module_screen ON permission_change_log(module_key, screen_id) — 'who granted access to salary data, and when'
- CREATE INDEX ix_permission_change_log_layer_effect ON permission_change_log(permission_layer, change_effect)
- No GIN equivalent. `after_value` is an audit payload read by primary key, not searched — leave it unindexed rather than adding generated columns for keys nobody queries
- CREATE INDEX ix_permission_change_log_toggle ON permission_change_log(feature_toggle_id)

**Triggers**
- trg_permission_change_log_immutable — BEFORE UPDATE OR DELETE: RAISE EXCEPTION (append-only). This is the table an auditor is handed, so it is the one that must never be editable.
- trg_permission_change_log_require_snapshots — BEFORE INSERT: rejects a row whose target/screen/permission snapshots are absent, since a log that resolves names by FK at read time is not an audit trail

### `user_appearance_settings`  _(14 RBAC)_

Per-user shell preferences from the Settings → Appearance tab (2.3) — theme, accent (preset or custom hex), and display scale. Not part of any functional module; it configures the shell those modules are drawn inside.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | CHAR(36) | NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT | Exactly one row per user — a plain UNIQUE, not a partial index, because the rule is total rather than conditional. |
| `theme` | ui_theme (enum: light, dark, match_system) | NOT NULL DEFAULT 'light' | Applies instantly across every screen; match_system reads the OS preference. |
| `accent_preset` | accent_preset (enum: blue, purple, green, amber, rose, teal, custom) | NOT NULL DEFAULT 'blue' | Six hand-tuned swatches plus the custom escape. |
| `accent_custom_hex` | TEXT | CHECK (accent_custom_hex IS NULL OR accent_custom_hex ~ '^#[0-9A-Fa-f]{6}$'), CHECK ((accent_preset = 'custom') = (accent_custom_hex IS NOT NULL)) | Added 2026-07-31. ONE colour is stored, never four: the hover shade, subtle fill and hairline are derived per theme by mixing toward white on Light and toward the dark canvas on Dark. Derived in the service layer because the ramp differs per theme and is presentation, not data. |
| `display_scale_percent` | DECIMAL(6,3) | NOT NULL DEFAULT 110 CHECK (display_scale_percent BETWEEN 80 AND 200) | Added 2026-07-31. A percentage, so DECIMAL(6,3) per the type rule. Presets 90/100/110/125/150 plus a free 80-200 slider; 110 is the default because that is the scale the prototype was reviewed and signed off at. Held on the account, not in browser storage, so a shared workstation or a fresh browser still opens at the size that person works in. |

**Indexes**
- CREATE UNIQUE INDEX uq_user_appearance_settings_user ON user_appearance_settings(user_id)

**Triggers**
- trg_user_appearance_settings_set_updated_at — BEFORE UPDATE
- trg_user_appearance_settings_clear_custom_hex — BEFORE UPDATE: nulls accent_custom_hex when accent_preset moves off 'custom', so a stale custom colour can never resurface when the user later switches back

### `payroll_runs`  _(06 Payroll)_

One monthly payroll calculation for a selected Month/Year, resolved against the configured Pay Cycle into an actual date range. Draft = calculated and recalculable, no payslips; Processed = confirmed, payslips generated and locked. Snapshots the pay-cycle configuration so a change to the cycle never rewrites a period already run (Payroll 2.1, 3.1b).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-lock carrier |
| `period_month` | smallint | NOT NULL CHECK (period_month BETWEEN 1 AND 12) | The label month picked on screen, NOT the date range |
| `period_year` | smallint | NOT NULL CHECK (period_year BETWEEN 2000 AND 2200) |  |
| `period_label` | TEXT | GENERATED ALWAYS AS ((ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'])[period_month] \|\| ' ' \|\| period_year::TEXT) STORED | DERIVED: single-row immutable expression -> GENERATED STORED. Array subscript is immutable, to_char is not. |
| `pay_period_start` | DATE | NOT NULL | Pay Period Covers, from Masters 3.20c. Default cycle: July 2026 -> 2026-06-26 |
| `pay_period_end` | DATE | NOT NULL CHECK (pay_period_end > pay_period_start) | The cutoff. Any dated event after this defers to the next period (3.1b) |
| `salary_credit_date` | DATE | NOT NULL CHECK (salary_credit_date >= pay_period_end) | When the bank transfer lands; always later than the cutoff |
| `pay_cycle_type_snapshot` | pay_cycle_type | NOT NULL | ENUM ('fixed_cycle','calendar_month'). Snapshot so a later cycle edit cannot move a run already made |
| `pay_cycle_start_day_snapshot` | smallint | CHECK (pay_cycle_start_day_snapshot BETWEEN 1 AND 31) |  |
| `pay_cycle_end_day_snapshot` | smallint | CHECK (pay_cycle_end_day_snapshot BETWEEN 1 AND 31) |  |
| `salary_credit_day_snapshot` | smallint | NOT NULL CHECK (salary_credit_day_snapshot BETWEEN 1 AND 31) | Clamped to the real last day of a short month when resolved into salary_credit_date |
| `total_days_in_period` | DECIMAL(5,2) | NOT NULL CHECK (total_days_in_period * 2 = floor(total_days_in_period * 2)) | Denominator of the unpaid-leave pro-rata formula |
| `working_days_auto` | DECIMAL(5,2) | NOT NULL CHECK (working_days_auto * 2 = floor(working_days_auto * 2)) | Calendar minus weekends minus Mandatory holidays, plus working Saturdays |
| `working_days_override` | DECIMAL(5,2) | CHECK (working_days_override IS NULL OR working_days_override * 2 = floor(working_days_override * 2)) | Editable override for an informal company day off or a regional office variation |
| `working_days_effective` | DECIMAL(5,2) | GENERATED ALWAYS AS (COALESCE(working_days_override, working_days_auto)) STORED | DERIVED: single-row -> GENERATED STORED |
| `employee_selection_mode` | payroll_selection_mode | NOT NULL | ENUM ('all_active','specific_employees') |
| `status` | payroll_run_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','processed'). Tier 2 soft delete: status-driven, no row deletion once processed |
| `employee_count` | INT | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payroll_run_employees |
| `total_gross` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger |
| `total_employee_deductions` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger |
| `total_employer_contributions` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger; never reduces net pay |
| `total_net` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger |
| `work_week_policy_note` | TEXT |  | Header-strip derivation TEXT, e.g. '22 weekdays + 2 working Saturdays = 24 x 8.00 = 192 required hours' |
| `run_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | Payroll History column 'Run By' |
| `run_on` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `processed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `processed_at` | DATETIME(6) |  |  |
| `discarded_at` | DATETIME(6) |  | A Draft may be discarded freely; Processed never |
| `notes` | TEXT |  |  |

**Indexes**
- CREATE INDEX ix_payroll_runs_period ON payroll_runs (period_year DESC, period_month DESC)
- CREATE INDEX ix_payroll_runs_fy_status ON payroll_runs (financial_year_id, status)
- CREATE INDEX ix_payroll_runs_run_by ON payroll_runs (run_by, run_on DESC)
- CREATE INDEX ix_payroll_runs_window ON payroll_runs (pay_period_start, pay_period_end)
- CREATE INDEX ix_payroll_runs_credit_date ON payroll_runs (salary_credit_date)

**Triggers**
- trg_payroll_runs_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_payroll_runs_no_edit_when_processed BEFORE UPDATE -> fn_payroll_run_reject_edit_when_processed() (only status/processed_* transitions and rollup columns may move)
- trg_payroll_runs_rollup AFTER INSERT OR UPDATE OR DELETE ON payroll_run_employees -> fn_payroll_run_recalc_totals() (maintains employee_count and the four money rollups)

### `payroll_run_employees`  _(06 Payroll)_

One employee's calculated line inside a run — the Preview table row, and the record that enforces the per-employee already-Processed skip. Holds the day figures, the hour figures handed over from monthly_hour_reconciliations, and every subtotal that composes Net Pay (Payroll 2.1 steps 1-8).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payroll_run_id` | CHAR(36) | NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `period_month` | smallint | NOT NULL CHECK (period_month BETWEEN 1 AND 12) | DERIVED across tables -> trigger copies from payroll_runs. Denormalised solely to carry the partial unique index below |
| `period_year` | smallint | NOT NULL | Same; trigger-maintained from payroll_runs |
| `status` | payroll_run_status | NOT NULL DEFAULT 'draft' | Follows the parent run; 'processed' is what triggers the double-processing guard |
| `inclusion_status` | payroll_inclusion_status | NOT NULL DEFAULT 'included' | ENUM ('included','skipped_already_processed','excluded_not_active','excluded_no_salary_structure') |
| `skip_reason` | TEXT |  | Plain-language reason surfaced on the Preview table |
| `salary_structure_id` | CHAR(36) | REFERENCES salary_structures(id) ON DELETE RESTRICT | The structure version in force on pay_period_end |
| `work_week_policy_id` | CHAR(36) | REFERENCES work_week_policies(id) ON DELETE RESTRICT |  |
| `monthly_hour_reconciliation_id` | CHAR(36) | REFERENCES monthly_hour_reconciliations(id) ON DELETE RESTRICT | The hour-basis handoff from Payroll 2.4 |
| `tax_scheme_id` | CHAR(36) | REFERENCES tax_schemes(id) ON DELETE RESTRICT | NULL when no schemes are configured — the whole concept then disappears |
| `gross_monthly_snapshot` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Structure's Gross Monthly at calculation time |
| `gross_pay` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Gross actually earned this period after pro-rata |
| `total_days_in_period` | DECIMAL(5,2) | NOT NULL CHECK (total_days_in_period * 2 = floor(total_days_in_period * 2)) |  |
| `working_days` | DECIMAL(5,2) | NOT NULL CHECK (working_days * 2 = floor(working_days * 2)) |  |
| `present_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (present_days * 2 = floor(present_days * 2)) |  |
| `paid_leave_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (paid_leave_days * 2 = floor(paid_leave_days * 2)) | Approved leave counts as present |
| `unpaid_leave_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (unpaid_leave_days * 2 = floor(unpaid_leave_days * 2)) |  |
| `paid_days` | DECIMAL(5,2) | GENERATED ALWAYS AS (present_days + paid_leave_days) STORED | DERIVED: single-row -> GENERATED STORED |
| `lop_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (lop_days * 2 = floor(lop_days * 2)) | From unmet hours, net of approved compensation |
| `required_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `worked_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `comp_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | 'of which Comp' — a SUBSET of worked_hours, never added to it |
| `leave_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `credited_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (worked_hours + leave_credit_hours) STORED | DERIVED: single-row -> GENERATED STORED. Comp deliberately excluded to prevent double-counting |
| `balance_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (worked_hours + leave_credit_hours - required_hours) STORED | DERIVED: single-row -> GENERATED STORED (cannot reference credited_hours, itself generated) |
| `comp_pending_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | Suspends, does not cancel, the deduction |
| `net_short_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `unpaid_leave_deduction` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | (Gross Pay / Total Days in Period) x Unpaid Leave Days |
| `lop_deduction` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Unmet hours converted per Uncompensated Shortfall Becomes |
| `uncompensated_shortfall_rule_snapshot` | shortfall_conversion_rule |  | ENUM ('pro_rata_per_hour','round_nearest_half_day','round_up_full_day','deduct_leave_then_lop','ignore') |
| `total_earnings` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_earning_lines |
| `total_employee_statutory` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_statutory_lines where borne_by='employee' |
| `total_employer_statutory` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger; feeds CTC, never net pay |
| `income_tax_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | This period's share; zero and unprinted if no income-tax head is configured |
| `insurance_employee_contribution` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | A benefit, not a tax — stays a named line |
| `insurance_employer_contribution` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `adhoc_addition_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_adjustment_lines |
| `adhoc_subtraction_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger |
| `total_deductions` | DECIMAL(14,2) | GENERATED ALWAYS AS (total_employee_statutory + income_tax_amount + insurance_employee_contribution + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total) STORED | DERIVED: single-row over already-materialised columns -> GENERATED STORED |
| `net_pay` | DECIMAL(14,2) | GENERATED ALWAYS AS (total_earnings + adhoc_addition_total - (total_employee_statutory + income_tax_amount + insurance_employee_contribution + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total)) STORED | DERIVED: single-row -> GENERATED STORED |
| `annualised_taxable_income` | DECIMAL(14,2) |  | Income-tax working, step 6a-6b |
| `annual_tax_computed` | DECIMAL(14,2) |  |  |
| `annual_relief_applied` | DECIMAL(14,2) |  |  |
| `remaining_payroll_months` | smallint | CHECK (remaining_payroll_months BETWEEN 0 AND 12) | Divisor for step 6e |
| `calculated_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `recalculated_count` | INT | NOT NULL DEFAULT 0 | A Draft may be recalculated freely |

**Indexes**
- CREATE UNIQUE INDEX ux_prempl_one_processed_per_employee_period ON payroll_run_employees (employee_id, period_year, period_month) WHERE status = 'processed'
- CREATE UNIQUE INDEX ux_prempl_run_employee ON payroll_run_employees (payroll_run_id, employee_id)
- CREATE INDEX ix_prempl_employee_period ON payroll_run_employees (employee_id, period_year DESC, period_month DESC)
- CREATE INDEX ix_prempl_run_status ON payroll_run_employees (payroll_run_id, inclusion_status)
- CREATE INDEX ix_prempl_net_pay ON payroll_run_employees (net_pay)
- CREATE INDEX ix_prempl_recon ON payroll_run_employees (monthly_hour_reconciliation_id)

**Triggers**
- trg_prempl_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_prempl_denorm_period BEFORE INSERT OR UPDATE -> fn_prempl_copy_period_from_run() (fills period_month/period_year for the partial unique index)
- trg_prempl_rollup_totals AFTER INSERT OR UPDATE OR DELETE ON payslip_earning_lines / payslip_statutory_lines / payslip_adjustment_lines -> fn_prempl_recalc_line_totals()
- trg_prempl_propagate_to_run AFTER INSERT OR UPDATE OR DELETE -> fn_payroll_run_recalc_totals()

### `payslips`  _(06 Payroll)_

The issued payslip for one employee for one PAY PERIOD. Keyed to the resolved 26th-25th window and the salary credit date, never to a calendar month — period_month/period_year are labels only. Visible to the employee only once its run reaches Processed (Payroll 2.2, 2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payroll_run_id` | CHAR(36) | NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT |  |
| `payroll_run_employee_id` | CHAR(36) | NOT NULL REFERENCES payroll_run_employees(id) ON DELETE RESTRICT |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `pay_period_start` | DATE | NOT NULL | CRITICAL: the payslip's real period. Default cycle July 2026 -> 2026-06-26 |
| `pay_period_end` | DATE | NOT NULL CHECK (pay_period_end > pay_period_start) | CRITICAL: the cutoff printed on the payslip header |
| `salary_credit_date` | DATE | NOT NULL CHECK (salary_credit_date >= pay_period_end) | CRITICAL: shown on the payslip header, always later than the cutoff |
| `pay_cycle_type_snapshot` | pay_cycle_type | NOT NULL |  |
| `pay_cycle_start_day_snapshot` | smallint |  |  |
| `pay_cycle_end_day_snapshot` | smallint |  |  |
| `salary_credit_day_snapshot` | smallint | NOT NULL |  |
| `period_month` | smallint | NOT NULL CHECK (period_month BETWEEN 1 AND 12) | Display label only — never the basis of any date comparison |
| `period_year` | smallint | NOT NULL |  |
| `period_label` | TEXT | GENERATED ALWAYS AS ((ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'])[period_month] \|\| ' ' \|\| period_year::TEXT) STORED | DERIVED: single-row -> GENERATED STORED. Search on My Payslips covers this |
| `employee_code_snapshot` | TEXT | NOT NULL | Search on the Accountant/HR view covers name and code |
| `employee_name_snapshot` | TEXT | NOT NULL |  |
| `designation_snapshot` | TEXT |  |  |
| `department_id` | CHAR(36) | REFERENCES departments(id) ON DELETE RESTRICT | Kept as an FK for the Department filter; name snapshotted alongside |
| `department_snapshot` | TEXT |  |  |
| `employment_type_id` | CHAR(36) | REFERENCES employment_types(id) ON DELETE RESTRICT |  |
| `employment_type_snapshot` | TEXT |  |  |
| `joining_date_snapshot` | DATE |  |  |
| `employee_bank_name_snapshot` | TEXT |  |  |
| `employee_bank_account_masked_snapshot` | TEXT |  | Last four digits only |
| `gross_pay` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `total_earnings` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_earning_lines |
| `total_deductions` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from statutory + adjustment lines + leave/LOP |
| `net_pay` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger; mirrors payroll_run_employees.net_pay and is re-stamped on reissue |
| `unpaid_leave_deduction` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `lop_deduction` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `income_tax_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `insurance_employee_contribution` | DECIMAL(14,2) | NOT NULL DEFAULT 0 |  |
| `paid_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (paid_days * 2 = floor(paid_days * 2)) |  |
| `unpaid_leave_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (unpaid_leave_days * 2 = floor(unpaid_leave_days * 2)) |  |
| `lop_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (lop_days * 2 = floor(lop_days * 2)) |  |
| `has_unpaid_leave` | TINYINT(1) | GENERATED ALWAYS AS (unpaid_leave_days > 0 OR lop_days > 0) STORED | DERIVED: single-row -> GENERATED STORED. Backs the 'has unpaid leave' filter (2.3) |
| `has_adhoc_adjustments` | TINYINT(1) | NOT NULL DEFAULT false | DERIVED across rows -> trigger from payslip_adjustment_lines. Backs the 'has ad-hoc adjustments' filter |
| `status` | payslip_status | NOT NULL DEFAULT 'processed' | ENUM ('processed','reissued'). Tier 2: no deletion, corrections go through payslip_reissues |
| `reissue_count` | INT | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_reissues |
| `last_reissued_at` | DATETIME(6) |  | DERIVED across rows -> trigger |
| `generated_at` | DATETIME(6) | NOT NULL DEFAULT now() | 'Date Processed' column on My Payslips |
| `generated_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `employee_notified_at` | DATETIME(6) |  |  |
| `notification_email_send_log_id` | CHAR(36) | REFERENCES email_send_log(id) ON DELETE RESTRICT | 'Payslip Available' template, Masters 3.21 |
| `pdf_file_path` | TEXT |  | Rendered on the Company Profile letterhead |

**Indexes**
- CREATE UNIQUE INDEX ux_payslips_run_employee ON payslips (payroll_run_employee_id)
- CREATE UNIQUE INDEX ux_payslips_employee_period ON payslips (employee_id, period_year, period_month)
- CREATE INDEX ix_payslips_employee_recent ON payslips (employee_id, pay_period_end DESC)
- CREATE INDEX ix_payslips_fy_status ON payslips (financial_year_id, status)
- CREATE INDEX ix_payslips_department ON payslips (department_id, period_year, period_month)
- CREATE INDEX ix_payslips_net_pay ON payslips (net_pay)
- CREATE INDEX ix_payslips_flags ON payslips (has_adhoc_adjustments, has_unpaid_leave) WHERE has_adhoc_adjustments OR has_unpaid_leave
- CREATE INDEX ix_payslips_credit_date ON payslips (salary_credit_date)

**Triggers**
- trg_payslips_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_payslips_no_delete BEFORE DELETE -> fn_reject_delete() (a processed payslip is never removed)
- trg_payslips_rollup AFTER INSERT OR UPDATE OR DELETE ON payslip_earning_lines / payslip_statutory_lines / payslip_adjustment_lines -> fn_payslip_recalc_totals() (also maintains has_adhoc_adjustments)
- trg_payslips_reissue_stamp AFTER INSERT ON payslip_reissues -> fn_payslip_apply_reissue() (sets status='reissued', reissue_count, last_reissued_at)

### `payslip_earning_lines`  _(06 Payroll)_

The Earnings half of the payslip breakup — one printed line per salary component and per ad-hoc addition, each carrying the label the employee actually sees (Payroll 2.2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payslip_id` | CHAR(36) | NOT NULL REFERENCES payslips(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) | Print order |
| `component_type` | payslip_earning_component | NOT NULL | ENUM ('basic','dearness_allowance','hra','lta','special_allowance','other_earnings','variable_pay','insurance_benefit','adhoc_addition','arrear','other'). Earnings are named in the spec; only taxes are forbidden from being named |
| `label` | TEXT | NOT NULL | Printed label. For an ad-hoc line this is the actual free-TEXT Label ('Diwali Bonus'), not a generic 'Adjustment' |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount >= 0) |  |
| `is_taxable` | TINYINT(1) | NOT NULL DEFAULT true | Feeds the income-tax base; no effect when no income-tax head exists |
| `source` | payslip_line_source | NOT NULL | ENUM ('salary_structure','adhoc_adjustment','insurance','system') |
| `adhoc_payslip_adjustment_id` | CHAR(36) | REFERENCES adhoc_payslip_adjustments(id) ON DELETE RESTRICT | Set only when source='adhoc_adjustment' |
| `show_on_payslip` | TINYINT(1) | NOT NULL DEFAULT true | Calculated but unprinted lines are still stored |

**Indexes**
- CREATE UNIQUE INDEX ux_earning_lines_seq ON payslip_earning_lines (payslip_id, sequence)
- CREATE INDEX ix_earning_lines_payslip ON payslip_earning_lines (payslip_id)
- CREATE INDEX ix_earning_lines_adhoc ON payslip_earning_lines (adhoc_payslip_adjustment_id) WHERE adhoc_payslip_adjustment_id IS NOT NULL

**Triggers**
- trg_earning_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_payslip_recalc_totals()

### `payslip_statutory_lines`  _(06 Payroll)_

Every calculated tax line on a payslip — employee deduction, employer contribution, or income tax. SNAPSHOTS the head's name, print label, method, rate and computed base at calculation time, so a two-year-old payslip still reproduces exactly after the head is retired. Nothing here names any specific tax.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payslip_id` | CHAR(36) | NOT NULL REFERENCES payslips(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT | Traceability back to the configured head; the snapshots below make the line self-contained |
| `head_name_snapshot` | TEXT | NOT NULL | SNAPSHOT — head's Tax Name at calculation time |
| `print_label_snapshot` | TEXT | NOT NULL | SNAPSHOT — what actually prints on the payslip line |
| `scope_snapshot` | tax_scope | NOT NULL CHECK (scope_snapshot IN ('payroll_employee_deduction','payroll_employer_contribution','payroll_income_tax')) | SNAPSHOT of the head's Scope |
| `tax_type_snapshot` | tax_type | NOT NULL | SNAPSHOT — ENUM ('gst_igst','gst_cgst_sgst','percentage','fixed_amount','slab','declaration_cap') |
| `rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT — percentage form |
| `fixed_amount_snapshot` | DECIMAL(14,2) |  | SNAPSHOT — flat form |
| `slab_application_snapshot` | slab_application |  | SNAPSHOT — ENUM ('progressive','flat_by_band') |
| `computed_base` | DECIMAL(14,2) | NOT NULL | SNAPSHOT of the base the head was applied to |
| `computed_amount` | DECIMAL(14,2) | NOT NULL CHECK (computed_amount >= 0) |  |
| `calculation_note` | TEXT |  | Human-readable working — slab-by-slab bands, ceiling/cap applied, rounding rule. Deliberately TEXT, not JSON: JSON is reserved to the listed open-ended cases |
| `borne_by` | tax_borne_by | NOT NULL | ENUM ('employee','employer'). Employer lines never reduce net pay |
| `reduces_taxable_income_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `include_in_ctc_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `show_on_payslip_snapshot` | TINYINT(1) | NOT NULL DEFAULT true | False = calculated but not printed (accrued employer-side items) |
| `per_employee_applicable_snapshot` | TINYINT(1) | NOT NULL DEFAULT true | The Salary Structure Applicable toggle as it stood |
| `tax_scheme_id` | CHAR(36) | REFERENCES tax_schemes(id) ON DELETE RESTRICT |  |
| `tax_scheme_name_snapshot` | TEXT |  |  |
| `parent_line_id` | CHAR(36) | REFERENCES payslip_statutory_lines(id) ON DELETE CASCADE | Set on a split-component child row |
| `component_name_snapshot` | TEXT |  | SNAPSHOT of a Split Component's name |
| `component_share_pct_snapshot` | DECIMAL(6,3) | CHECK (component_share_pct_snapshot IS NULL OR (component_share_pct_snapshot > 0 AND component_share_pct_snapshot <= 100)) |  |
| `annual_taxable_income` | DECIMAL(14,2) |  | Income-tax lines only — step 6a/6b result |
| `annual_declared_reductions` | DECIMAL(14,2) |  | Sum of Submitted declarations whose head reduces taxable income |
| `annual_tax_before_relief` | DECIMAL(14,2) |  |  |
| `relief_rule_id` | CHAR(36) | REFERENCES tax_relief_rules(id) ON DELETE RESTRICT |  |
| `relief_name_snapshot` | TEXT |  |  |
| `relief_amount_applied` | DECIMAL(14,2) | CHECK (relief_amount_applied IS NULL OR relief_amount_applied >= 0) | Never exceeds the tax itself — relief can reach zero, never below |
| `remaining_payroll_months` | smallint |  | Divisor used to spread the annual figure |

**Indexes**
- CREATE UNIQUE INDEX ux_stat_lines_seq ON payslip_statutory_lines (payslip_id, sequence)
- CREATE UNIQUE INDEX ux_stat_lines_head_component ON payslip_statutory_lines (payslip_id, tax_head_id, COALESCE(component_name_snapshot, '')) 
- CREATE INDEX ix_stat_lines_payslip_borne ON payslip_statutory_lines (payslip_id, borne_by)
- CREATE INDEX ix_stat_lines_head ON payslip_statutory_lines (tax_head_id)
- CREATE INDEX ix_stat_lines_scope ON payslip_statutory_lines (scope_snapshot)
- CREATE INDEX ix_stat_lines_parent ON payslip_statutory_lines (parent_line_id) WHERE parent_line_id IS NOT NULL

**Triggers**
- trg_stat_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_payslip_recalc_totals()
- trg_stat_lines_lock_head AFTER INSERT -> fn_tax_head_mark_used() (locks the head's numeric fields once used in a calculation)

### `payslip_adjustment_lines`  _(06 Payroll)_

The ad-hoc additions and subtractions actually applied to one payslip, each snapshotting the Label so the employee sees 'Diwali Bonus' or 'Laptop Advance Recovery' rather than a generic entry (Payroll 2.1a).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payslip_id` | CHAR(36) | NOT NULL REFERENCES payslips(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `adhoc_payslip_adjustment_id` | CHAR(36) | NOT NULL REFERENCES adhoc_payslip_adjustments(id) ON DELETE RESTRICT |  |
| `adhoc_adjustment_employee_id` | CHAR(36) | NOT NULL REFERENCES adhoc_adjustment_employees(id) ON DELETE RESTRICT |  |
| `label_snapshot` | TEXT | NOT NULL | SNAPSHOT — editing the adjustment later never rewrites an issued payslip |
| `adjustment_type` | adhoc_adjustment_type | NOT NULL | ENUM ('addition','subtraction') |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) | Always positive; adjustment_type carries the sign |
| `signed_amount` | DECIMAL(14,2) | GENERATED ALWAYS AS (CASE WHEN adjustment_type = 'addition' THEN amount ELSE -amount END) STORED | DERIVED: single-row -> GENERATED STORED |
| `applies_to_component` | adhoc_applies_to | NOT NULL DEFAULT 'gross' | ENUM ('gross','net') — step 8: added to Gross or Net depending on how it was configured |
| `is_taxable_snapshot` | TINYINT(1) | NOT NULL DEFAULT true |  |
| `is_recurring_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `note_snapshot` | TEXT |  | Internal reason, never printed to the employee |

**Indexes**
- CREATE UNIQUE INDEX ux_adj_lines_seq ON payslip_adjustment_lines (payslip_id, sequence)
- CREATE UNIQUE INDEX ux_adj_lines_once_per_payslip ON payslip_adjustment_lines (payslip_id, adhoc_adjustment_employee_id)
- CREATE INDEX ix_adj_lines_adjustment ON payslip_adjustment_lines (adhoc_payslip_adjustment_id)

**Triggers**
- trg_adj_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_payslip_recalc_totals() (also flips payslips.has_adhoc_adjustments)
- trg_adj_lines_consume AFTER INSERT -> fn_adhoc_mark_applied() (a one-time adjustment is spent; a recurring one stays queued and increments times_applied)

### `adhoc_payslip_adjustments`  _(06 Payroll)_

A one-off or recurring custom payslip line defined by Accountant or Super Admin, or queued automatically from an Offer & Appointment Letter Custom Term. Not for permanent hikes — those are a new Salary Structure (Payroll 2.1a).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Resolved from effective_from |
| `applies_to_mode` | adhoc_applies_to_mode | NOT NULL | ENUM ('single_employee','multiple_employees','all_active_employees') |
| `employee_id` | CHAR(36) | REFERENCES employees(id) ON DELETE RESTRICT CHECK ((applies_to_mode = 'single_employee') = (employee_id IS NOT NULL)) | Populated only in single-employee mode; the other modes expand into adhoc_adjustment_employees |
| `label` | TEXT | NOT NULL CHECK (length(btrim(label)) > 0) | Free TEXT; free-TEXT search on this column is the only way to find every running advance recovery |
| `adjustment_type` | adhoc_adjustment_type | NOT NULL |  |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) |  |
| `is_taxable` | TINYINT(1) | NOT NULL DEFAULT true | Human decision each time; default Yes per spec |
| `is_recurring` | TINYINT(1) | NOT NULL DEFAULT false | Yes = every run from this one forward until removed; No = the next run only |
| `applies_to_component` | adhoc_applies_to | NOT NULL DEFAULT 'gross' |  |
| `note` | TEXT |  | Internal context, e.g. approval reference |
| `effective_from` | DATE | NOT NULL DEFAULT CURRENT_DATE | For letter-sourced terms this is the employee's Joining Date |
| `effective_until` | DATE | CHECK (effective_until IS NULL OR effective_until >= effective_from) |  |
| `source` | adhoc_adjustment_source | NOT NULL DEFAULT 'manual' | ENUM ('manual','appointment_letter') |
| `appointment_letter_id` | CHAR(36) | REFERENCES appointment_letters(id) ON DELETE RESTRICT |  |
| `appointment_letter_custom_term_id` | CHAR(36) | REFERENCES appointment_letter_custom_terms(id) ON DELETE RESTRICT |  |
| `status` | adhoc_adjustment_status | NOT NULL DEFAULT 'active' | ENUM ('active','consumed','removed'). Tier 2: removal stops future runs and never touches an already-Processed payslip |
| `removed_at` | DATETIME(6) |  |  |
| `removed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `removal_reason` | TEXT |  |  |
| `target_employee_count` | INT | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from adhoc_adjustment_employees |
| `applied_employee_count` | INT | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger |

**Indexes**
- CREATE INDEX ix_adhoc_employee_status ON adhoc_payslip_adjustments (employee_id, status) WHERE employee_id IS NOT NULL
- CREATE INDEX ix_adhoc_status_recurring ON adhoc_payslip_adjustments (status, is_recurring)
- CREATE INDEX ix_adhoc_effective ON adhoc_payslip_adjustments (effective_from, effective_until)
- CREATE INDEX ix_adhoc_created_by ON adhoc_payslip_adjustments (created_by, created_at DESC)
- CREATE INDEX ix_adhoc_amount ON adhoc_payslip_adjustments (amount)
- `ix_adhoc_label_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_adhoc_label_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour
- CREATE INDEX ix_adhoc_letter ON adhoc_payslip_adjustments (appointment_letter_id) WHERE appointment_letter_id IS NOT NULL

**Triggers**
- trg_adhoc_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_adhoc_expand_targets AFTER INSERT -> fn_adhoc_expand_to_employees() (materialises adhoc_adjustment_employees for multiple/all-active modes)
- trg_adhoc_no_edit_once_applied BEFORE UPDATE -> fn_adhoc_reject_edit_after_application() (label/type/amount frozen once any payslip line exists; correction goes through Reissue)
- trg_adhoc_rollup AFTER INSERT OR UPDATE OR DELETE ON adhoc_adjustment_employees -> fn_adhoc_recalc_counts()

### `adhoc_adjustment_employees`  _(06 Payroll)_

The per-employee assignment of an ad-hoc adjustment, and the ledger of whether it has been consumed. One row per adjustment x employee; a recurring adjustment keeps one row and increments times_applied on every run it reaches.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `adhoc_payslip_adjustment_id` | CHAR(36) | NOT NULL REFERENCES adhoc_payslip_adjustments(id) ON DELETE CASCADE |  |
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `status` | adhoc_target_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','applied','cancelled'). A recurring adjustment returns to 'pending' after each run until removed |
| `times_applied` | INT | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from payslip_adjustment_lines |
| `total_applied_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger. Answers 'how much of this advance is recovered so far' |
| `first_applied_on` | DATE |  |  |
| `last_applied_on` | DATE |  |  |
| `last_applied_period_month` | smallint | CHECK (last_applied_period_month IS NULL OR last_applied_period_month BETWEEN 1 AND 12) |  |
| `last_applied_period_year` | smallint |  |  |
| `last_applied_payslip_id` | CHAR(36) | REFERENCES payslips(id) ON DELETE RESTRICT |  |
| `last_applied_payroll_run_id` | CHAR(36) | REFERENCES payroll_runs(id) ON DELETE RESTRICT |  |
| `cancelled_at` | DATETIME(6) |  |  |
| `cancelled_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |

**Indexes**
- CREATE UNIQUE INDEX ux_adhoc_target ON adhoc_adjustment_employees (adhoc_payslip_adjustment_id, employee_id)
- CREATE INDEX ix_adhoc_target_pending ON adhoc_adjustment_employees (employee_id, status) WHERE status = 'pending'
- CREATE INDEX ix_adhoc_target_last_period ON adhoc_adjustment_employees (last_applied_period_year, last_applied_period_month)

**Triggers**
- trg_adhoc_target_rollup AFTER INSERT OR UPDATE OR DELETE ON payslip_adjustment_lines -> fn_adhoc_target_recalc() (times_applied, total_applied_amount, last_applied_*)
- trg_adhoc_target_propagate AFTER INSERT OR UPDATE OR DELETE -> fn_adhoc_recalc_counts()

### `payslip_reissues`  _(06 Payroll)_

IMMUTABLE append-only correction history on a payslip — Date, Reissued By, Reason, and the old figures alongside the new ones. The same accountability pattern as asset and ticket assignment history (Payroll 2.3, 3.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `payslip_id` | CHAR(36) | NOT NULL REFERENCES payslips(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `reissue_number` | INT | NOT NULL CHECK (reissue_number > 0) | 1-based sequence per payslip |
| `reason` | TEXT | NOT NULL CHECK (length(btrim(reason)) > 0) | Required whichever route is taken |
| `reissue_method` | reissue_method | NOT NULL | ENUM ('recalculated','manual_adjustment') |
| `old_gross_pay` | DECIMAL(14,2) | NOT NULL |  |
| `new_gross_pay` | DECIMAL(14,2) | NOT NULL |  |
| `old_total_earnings` | DECIMAL(14,2) | NOT NULL |  |
| `new_total_earnings` | DECIMAL(14,2) | NOT NULL |  |
| `old_total_deductions` | DECIMAL(14,2) | NOT NULL |  |
| `new_total_deductions` | DECIMAL(14,2) | NOT NULL |  |
| `old_net_pay` | DECIMAL(14,2) | NOT NULL |  |
| `new_net_pay` | DECIMAL(14,2) | NOT NULL |  |
| `net_pay_delta` | DECIMAL(14,2) | GENERATED ALWAYS AS (new_net_pay - old_net_pay) STORED | DERIVED: single-row -> GENERATED STORED |
| `old_income_tax_amount` | DECIMAL(14,2) |  |  |
| `new_income_tax_amount` | DECIMAL(14,2) |  |  |
| `old_paid_days` | DECIMAL(5,2) | CHECK (old_paid_days IS NULL OR old_paid_days * 2 = floor(old_paid_days * 2)) |  |
| `new_paid_days` | DECIMAL(5,2) | CHECK (new_paid_days IS NULL OR new_paid_days * 2 = floor(new_paid_days * 2)) |  |
| `old_lop_days` | DECIMAL(5,2) | CHECK (old_lop_days IS NULL OR old_lop_days * 2 = floor(old_lop_days * 2)) |  |
| `new_lop_days` | DECIMAL(5,2) | CHECK (new_lop_days IS NULL OR new_lop_days * 2 = floor(new_lop_days * 2)) |  |
| `old_adhoc_net_total` | DECIMAL(14,2) |  |  |
| `new_adhoc_net_total` | DECIMAL(14,2) |  |  |
| `line_change_summary` | TEXT |  | Plain-language list of which lines moved. Text, not JSON — JSON is reserved to the listed cases |
| `reissued_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `reissued_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `approval_required` | TINYINT(1) | NOT NULL DEFAULT false | Snapshot of the 'Require Super Admin Approval to Reissue a Payslip' flag as it stood |
| `approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT CHECK (NOT approval_required OR approved_by IS NOT NULL) |  |
| `approved_at` | DATETIME(6) |  |  |
| `employee_notified` | TINYINT(1) | NOT NULL DEFAULT true | Snapshot of 'Notify Employee When a Payslip Is Reissued' |
| `notified_at` | DATETIME(6) |  |  |
| `notification_email_send_log_id` | CHAR(36) | REFERENCES email_send_log(id) ON DELETE RESTRICT | 'Payslip Reissued' template, Masters 3.21 |

**Indexes**
- CREATE UNIQUE INDEX ux_payslip_reissues_seq ON payslip_reissues (payslip_id, reissue_number)
- CREATE INDEX ix_payslip_reissues_payslip ON payslip_reissues (payslip_id, reissued_at DESC)
- CREATE INDEX ix_payslip_reissues_by ON payslip_reissues (reissued_by, reissued_at DESC)
- CREATE INDEX ix_payslip_reissues_pending_approval ON payslip_reissues (approval_required) WHERE approval_required AND approved_at IS NULL

**Triggers**
- trg_payslip_reissues_append_only BEFORE UPDATE OR DELETE -> fn_reject_update_delete() (IMMUTABLE LOG)
- trg_payslip_reissues_fy_lock BEFORE INSERT -> fn_reject_if_fy_locked()
- trg_payslip_reissues_number BEFORE INSERT -> fn_payslip_reissue_next_number() (SELECT ... FOR UPDATE on the parent payslip)
- trg_payslip_reissues_apply AFTER INSERT -> fn_payslip_apply_reissue()

### `salary_certificate_requests`  _(06 Payroll)_

An on-demand formal letter confirming employment and salary, with an optional Purpose. Not a monthly record — generated whenever asked, from the Employee record, Company Profile and the current Salary Structure (Payroll 2.2, 3.2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `requested_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | Every role may request their own |
| `requested_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `purpose` | TEXT |  | Optional and non-blocking — blank produces a general-purpose certificate |
| `salary_structure_id` | CHAR(36) | REFERENCES salary_structures(id) ON DELETE RESTRICT |  |
| `employee_name_snapshot` | TEXT | NOT NULL |  |
| `employee_code_snapshot` | TEXT | NOT NULL |  |
| `designation_snapshot` | TEXT |  |  |
| `department_snapshot` | TEXT |  |  |
| `joining_date_snapshot` | DATE |  |  |
| `employment_type_snapshot` | TEXT |  |  |
| `basic_salary_snapshot` | DECIMAL(14,2) |  |  |
| `gross_monthly_snapshot` | DECIMAL(14,2) |  |  |
| `net_monthly_snapshot` | DECIMAL(14,2) |  |  |
| `annual_ctc_snapshot` | DECIMAL(14,2) |  |  |
| `company_name_snapshot` | TEXT |  | From Company Profile, Masters 3.6a/e — the letterhead the certificate was issued under |
| `company_address_snapshot` | TEXT |  |  |
| `status` | salary_certificate_status | NOT NULL DEFAULT 'generated' | ENUM ('requested','generated','failed'). Tier 2 |
| `generated_at` | DATETIME(6) |  |  |
| `pdf_file_path` | TEXT |  |  |

**Indexes**
- CREATE INDEX ix_salcert_employee ON salary_certificate_requests (employee_id, requested_at DESC)
- CREATE INDEX ix_salcert_fy_status ON salary_certificate_requests (financial_year_id, status)

**Triggers**
- trg_salcert_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_salcert_snapshot BEFORE INSERT -> fn_salcert_capture_snapshots() (freezes employee, structure and company-profile figures at request time)

### `monthly_hour_reconciliations`  _(06 Payroll)_

One row per employee per pay period reconciling Required Hours against what the company actually got, and handing the surviving shortfall to Run Payroll as a deduction. Hours are the unit of account; days are display only (Payroll 2.4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `period_month` | smallint | NOT NULL CHECK (period_month BETWEEN 1 AND 12) | Label only |
| `period_year` | smallint | NOT NULL |  |
| `pay_period_start` | DATE | NOT NULL | The real window, same cutoff rule as the payroll run |
| `pay_period_end` | DATE | NOT NULL CHECK (pay_period_end > pay_period_start) |  |
| `work_week_policy_id` | CHAR(36) | NOT NULL REFERENCES work_week_policies(id) ON DELETE RESTRICT |  |
| `policy_name_snapshot` | TEXT | NOT NULL | 'who is short' is meaningless without the target they were measured against |
| `gross_hours_per_day_snapshot` | DECIMAL(6,2) | NOT NULL |  |
| `unpaid_break_hours_snapshot` | DECIMAL(6,2) | NOT NULL |  |
| `net_hours_per_day_snapshot` | DECIMAL(6,2) | NOT NULL CHECK (net_hours_per_day_snapshot > 0) | The only figure payroll compares against |
| `grace_window_minutes_snapshot` | smallint | NOT NULL DEFAULT 0 |  |
| `half_day_threshold_hours_snapshot` | DECIMAL(6,2) |  |  |
| `saturday_rule_snapshot` | saturday_rule | NOT NULL | ENUM ('odd_working','even_working','all_working','all_off','first_only','last_only','custom') |
| `weekday_count` | smallint | NOT NULL DEFAULT 0 | Header strip: '22 weekdays + 2 working Saturdays = 24 working days' |
| `working_saturdays_count` | smallint | NOT NULL DEFAULT 0 |  |
| `mandatory_holidays_count` | smallint | NOT NULL DEFAULT 0 | A Mandatory holiday overrides a working Saturday |
| `working_days` | DECIMAL(5,2) | NOT NULL CHECK (working_days * 2 = floor(working_days * 2)) |  |
| `required_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (working_days * net_hours_per_day_snapshot) STORED | DERIVED: single-row -> GENERATED STORED |
| `worked_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | (Check-Out - Check-In) minus the unpaid break, summed across the period |
| `comp_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 CHECK (comp_credit_hours <= worked_hours) | 'of which Comp' — an approved-compensatory SUBSET of worked_hours, never an addition |
| `leave_credit_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | Approved leave days x net hours per day |
| `credited_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (worked_hours + leave_credit_hours) STORED | DERIVED: single-row -> GENERATED STORED |
| `balance_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (worked_hours + leave_credit_hours - (working_days * net_hours_per_day_snapshot)) STORED | DERIVED: single-row -> GENERATED STORED. Negative is a shortfall |
| `hours_short` | DECIMAL(6,2) | GENERATED ALWAYS AS (GREATEST((working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours), 0)) STORED | DERIVED: single-row -> GENERATED STORED |
| `comp_pending_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 | A pending compensatory request SUSPENDS the deduction; it does not cancel it |
| `comp_approved_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `comp_rejected_hours` | DECIMAL(6,2) | NOT NULL DEFAULT 0 |  |
| `net_short_hours` | DECIMAL(6,2) | GENERATED ALWAYS AS (GREATEST(GREATEST((working_days * net_hours_per_day_snapshot) - (worked_hours + leave_credit_hours), 0) - comp_pending_hours, 0)) STORED | DERIVED: single-row -> GENERATED STORED. What actually converts if nothing is made up |
| `payable_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (payable_days * 2 = floor(payable_days * 2)) |  |
| `lop_days` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (lop_days * 2 = floor(lop_days * 2)) |  |
| `lop_days_net_of_pending` | DECIMAL(5,2) | NOT NULL DEFAULT 0 CHECK (lop_days_net_of_pending * 2 = floor(lop_days_net_of_pending * 2)) | Payroll Impact tab column |
| `estimated_deduction` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Shown to the employee before it reaches a payslip — nothing is deducted silently |
| `uncompensated_shortfall_rule_snapshot` | shortfall_conversion_rule | NOT NULL |  |
| `excess_hours_rule_snapshot` | excess_hours_rule |  | ENUM ('comp_credit_expiring','comp_off_balance','paid_overtime','not_tracked') |
| `status` | hour_reconciliation_status | NOT NULL DEFAULT 'met' | ENUM ('met','short_compensable','short_payroll_impact'). Compensable = within one day's net hours |
| `next_step_note` | TEXT |  | Plainly-worded next step per person on the Payroll Impact tab |
| `recorded_by_source` | attendance_source | NOT NULL DEFAULT 'manual_entry' | ENUM ('manual_entry','biometric_device','external_hr_system','mobile_geofenced'). Deliberately NOT a strict user reference — a device or system can be the source |
| `recorded_by_user_id` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | Populated only when recorded_by_source='manual_entry' |
| `consumed_by_payroll_run_employee_id` | CHAR(36) | REFERENCES payroll_run_employees(id) ON DELETE RESTRICT | Set when Run Payroll picks the figures up |
| `is_locked` | TINYINT(1) | NOT NULL DEFAULT false | True once the period is Processed; a later policy change never rewrites it |

**Indexes**
- CREATE UNIQUE INDEX ux_hourrecon_employee_period ON monthly_hour_reconciliations (employee_id, period_year, period_month)
- CREATE INDEX ix_hourrecon_period_status ON monthly_hour_reconciliations (period_year, period_month, status)
- CREATE INDEX ix_hourrecon_policy ON monthly_hour_reconciliations (work_week_policy_id)
- CREATE INDEX ix_hourrecon_impact ON monthly_hour_reconciliations (status) WHERE status = 'short_payroll_impact'
- CREATE INDEX ix_hourrecon_window ON monthly_hour_reconciliations (pay_period_start, pay_period_end)
- CREATE INDEX ix_hourrecon_consumed ON monthly_hour_reconciliations (consumed_by_payroll_run_employee_id) WHERE consumed_by_payroll_run_employee_id IS NOT NULL

**Triggers**
- trg_hourrecon_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_hourrecon_no_edit_when_locked BEFORE UPDATE OR DELETE -> fn_reject_if_locked()
- trg_hourrecon_resolve_status BEFORE INSERT OR UPDATE -> fn_hourrecon_resolve_status() (met / short_compensable / short_payroll_impact, from net_short_hours against one day's net hours)
- trg_hourrecon_recalc_from_attendance AFTER INSERT OR UPDATE OR DELETE ON attendance_records / compensatory_requests -> fn_hourrecon_recalc() (spans rows and tables)

### `invoices`  _(11 Invoice)_

A bill raised to a Customer, from scratch or from a won Opportunity/Project. Draft -> Sent -> Part-Paid -> Paid; reaching Paid LOCKS every field permanently and corrections move to a Credit Note (Invoice 2.3, 3.4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_number` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. INV-2026-00001. Allocated from document_number_sequences (code_type='invoice', financial_year_id) with SELECT ... FOR UPDATE inside the creating transaction. Never a Postgres SEQUENCE |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | Read-only, auto-set from invoice_date |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `opportunity_id` | CHAR(36) | REFERENCES opportunities(id) ON DELETE RESTRICT | Optional tag, filtered to the selected customer's opportunities |
| `project_id` | CHAR(36) | REFERENCES projects(id) ON DELETE RESTRICT |  |
| `created_from` | invoice_origin | NOT NULL DEFAULT 'blank' | ENUM ('blank','opportunity','project') |
| `invoice_date` | DATE | NOT NULL DEFAULT CURRENT_DATE |  |
| `due_date` | DATE | CHECK (due_date IS NULL OR due_date >= invoice_date) | Optional — but an invoice with no due date can never appear in the Overdue filter |
| `reference` | TEXT |  | Search on the list covers Invoice Number, Customer Name and Reference |
| `notes` | TEXT |  |  |
| `customer_name_snapshot` | TEXT | NOT NULL |  |
| `customer_address_snapshot` | TEXT |  | Read-only, auto-filled at creation; no per-invoice override by design |
| `customer_gstin_snapshot` | TEXT |  |  |
| `service_category_id` | CHAR(36) | REFERENCES service_categories(id) ON DELETE RESTRICT | Masters 3.12 — backs the Service Category filter |
| `bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Meshrd's own account, printed on the invoice and used as the DEFAULT (never a lock) on Record Payment. Optional; unset prints no account |
| `subtotal` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from invoice_line_items |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | Sales/Billing (or Sales & Purchase) scope heads in force on invoice_date. NULL is correct when no billing tax is configured — the dropdown is hidden entirely |
| `tax_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from invoice_tax_lines. Applies once to the Subtotal, not per line item |
| `grand_total` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount) STORED | DERIVED: single-row -> GENERATED STORED |
| `amount_paid` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from invoice_payments |
| `credit_note_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from APPROVED credit_notes only |
| `balance_due` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount - credit_note_total - amount_paid - withheld_total) STORED | DERIVED: single-row -> GENERATED STORED. **Nets off customer withholding as well as credit notes (2026-07-31)** - otherwise a withheld invoice never reaches zero. Cannot reference grand_total (Postgres forbids generated-on-generated), so recomputed from base columns |
| `withheld_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (withheld_total >= 0) | **Added 2026-07-31 (C2/C3).** DERIVED across rows -> trigger from invoice_payments.withheld_amount. What CUSTOMERS held back. An asset (claimable credit), never a reduction of the claim |
| `claim_amount` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount - credit_note_total) STORED | DERIVED. **Grand Total less approved Credit Notes.** This — not Grand Total — is what Status and Balance compare against |
| `settled_amount` | DECIMAL(14,2) | GENERATED ALWAYS AS (amount_received + withheld_total) STORED | DERIVED. Cash received PLUS customer withholding. What has come off the customer's obligation |
| `status` | invoice_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','sent','part_paid','paid'). Tier 2 — no deletion once numbered |
| `sent_at` | DATETIME(6) |  |  |
| `sent_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `paid_at` | DATETIME(6) |  | Set when the final payment clears the balance |
| `is_locked` | TINYINT(1) | GENERATED ALWAYS AS (status = 'paid') STORED | DERIVED: single-row -> GENERATED STORED. THE LOCK ON PAID, modelled exactly — enforced by trg_invoices_lock_guard below |
| `second_approval_required` | TINYINT(1) | NOT NULL DEFAULT false | Snapshot of 'Require Second Approval Before an Invoice Locks as Paid' |
| `second_approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT CHECK (NOT second_approval_required OR status <> 'paid' OR second_approved_by IS NOT NULL) |  |
| `second_approved_at` | DATETIME(6) |  |  |
| `pdf_file_path` | TEXT |  | Rendered from the invoice template in Company Profile, Masters 3.6d |

**Indexes**
- CREATE UNIQUE INDEX ux_invoices_number ON invoices (invoice_number)
- CREATE INDEX ix_invoices_customer_status ON invoices (customer_id, status)
- CREATE INDEX ix_invoices_fy_date ON invoices (financial_year_id, invoice_date DESC)
- CREATE INDEX ix_invoices_overdue ON invoices (due_date) WHERE status IN ('sent','part_paid') AND due_date IS NOT NULL
- CREATE INDEX ix_invoices_balance ON invoices (balance_due) WHERE balance_due > 0
- CREATE INDEX ix_invoices_grand_total ON invoices (grand_total)
- CREATE INDEX ix_invoices_tax_head ON invoices (tax_head_id) WHERE tax_head_id IS NOT NULL
- CREATE INDEX ix_invoices_bank_account ON invoices (bank_account_id)
- CREATE INDEX ix_invoices_service_category ON invoices (service_category_id)
- CREATE INDEX ix_invoices_created_by ON invoices (created_by, created_at DESC)
- `ix_invoices_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_invoices_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_invoices_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_invoices_allocate_number BEFORE INSERT -> fn_allocate_document_number('invoice') (document_number_sequences, FOR UPDATE)
- trg_invoices_lock_guard BEFORE UPDATE OR DELETE -> fn_invoice_reject_edit_when_locked() (once OLD.is_locked, only the trigger-maintained rollup columns amount_paid/credit_note_total/tax_amount/subtotal may move; every user-facing field is read-only and the row is never deleted)
- trg_invoices_rollup_lines AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items / invoice_tax_lines -> fn_invoice_recalc_totals()
- trg_invoices_rollup_payments AFTER INSERT OR UPDATE OR DELETE ON invoice_payments -> fn_invoice_apply_payment() (maintains amount_paid, moves status Sent -> Part-Paid -> Paid, stamps paid_at)
- trg_invoices_rollup_credit_notes AFTER INSERT OR UPDATE OR DELETE ON credit_notes -> fn_invoice_recalc_credit_total() (approved credit notes only; reduces effective outstanding WITHOUT reopening the locked invoice)

**Withholding on receipts (C2/C3) — the status rule.** An invoice reaches `paid` when
`amount_received + withheld_total = claim_amount`, **not** when `amount_received = grand_total`.
A 1,00,000 invoice settled by a 90,000 receipt with 10,000 withheld by the customer is fully settled.
The naive comparison leaves every withheld invoice permanently `part_paid`, overstating receivables and
keeping it in every ageing bucket forever — the mirror of the payables failure documented on
`purchase_bills`. Note `claim_amount` carries the Credit Note term: comparing against `grand_total`
alone would strand any credit-noted invoice short of Paid by the credited amount.

### `invoice_line_items`  _(11 Invoice)_

Repeatable billed rows on an invoice, with HSN/SAC at line level so one invoice can mix items needing different codes (Invoice 2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_id` | CHAR(36) | NOT NULL REFERENCES invoices(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `description` | TEXT | NOT NULL CHECK (length(btrim(description)) > 0) |  |
| `hsn_code_id` | CHAR(36) | REFERENCES hsn_sac_codes(id) ON DELETE RESTRICT | Masters 3.11, optional |
| `hsn_code_snapshot` | TEXT |  | SNAPSHOT of the code string as printed |
| `quantity` | DECIMAL(14,2) | NOT NULL CHECK (quantity > 0) |  |
| `rate` | DECIMAL(14,2) | NOT NULL CHECK (rate > 0) |  |
| `line_total` | DECIMAL(14,2) | GENERATED ALWAYS AS (quantity * rate) STORED | DERIVED: single-row -> GENERATED STORED |
| `credited_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from approved credit_note_line_items |

**Indexes**
- CREATE UNIQUE INDEX ux_invoice_lines_seq ON invoice_line_items (invoice_id, sequence)
- CREATE INDEX ix_invoice_lines_invoice ON invoice_line_items (invoice_id)
- CREATE INDEX ix_invoice_lines_hsn ON invoice_line_items (hsn_code_id) WHERE hsn_code_id IS NOT NULL

**Triggers**
- trg_invoice_lines_locked_parent BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_parent_invoice_locked()
- trg_invoice_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_invoice_recalc_totals()

### `invoice_tax_lines`  _(11 Invoice)_

The calculated tax on an invoice — one row per head, plus one child row per Split Component so the invoice prints each part under its own name. SNAPSHOTS name, print label, method, rate and computed base, so a historical invoice reproduces exactly after the head is edited or retired.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_id` | CHAR(36) | NOT NULL REFERENCES invoices(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT |  |
| `head_name_snapshot` | TEXT | NOT NULL | SNAPSHOT |
| `print_label_snapshot` | TEXT | NOT NULL | SNAPSHOT — what prints on the invoice line |
| `scope_snapshot` | tax_scope | NOT NULL CHECK (scope_snapshot IN ('sales_billing','sales_billing_and_purchase')) | SNAPSHOT |
| `tax_type_snapshot` | tax_type | NOT NULL | SNAPSHOT of the method |
| `rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `cgst_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT — carried only because the head's own type may be that shape; this module names no tax itself |
| `sgst_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `fixed_amount_snapshot` | DECIMAL(14,2) |  | SNAPSHOT |
| `computed_base` | DECIMAL(14,2) | NOT NULL | SNAPSHOT of the base — the invoice Subtotal at calculation time |
| `computed_amount` | DECIMAL(14,2) | NOT NULL CHECK (computed_amount >= 0) |  |
| `calculation_note` | TEXT |  | Working shown on the document; TEXT, not JSON |
| `parent_line_id` | CHAR(36) | REFERENCES invoice_tax_lines(id) ON DELETE CASCADE | Set on a split-component child row |
| `component_name_snapshot` | TEXT |  | SNAPSHOT of the Split Component name |
| `component_share_pct_snapshot` | DECIMAL(6,3) | CHECK (component_share_pct_snapshot IS NULL OR (component_share_pct_snapshot > 0 AND component_share_pct_snapshot <= 100)) |  |

**Indexes**
- CREATE UNIQUE INDEX ux_invoice_tax_seq ON invoice_tax_lines (invoice_id, sequence)
- CREATE INDEX ix_invoice_tax_head ON invoice_tax_lines (tax_head_id)
- CREATE INDEX ix_invoice_tax_parent ON invoice_tax_lines (parent_line_id) WHERE parent_line_id IS NOT NULL

**Triggers**
- trg_invoice_tax_locked_parent BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_parent_invoice_locked()
- trg_invoice_tax_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_invoice_recalc_totals()
- trg_invoice_tax_lock_head AFTER INSERT -> fn_tax_head_mark_used()

### `invoice_payments`  _(11 Invoice)_

Money actually received against a specific invoice. The ONLY place a payment mode is recorded (the invoice-creation copy was removed 2026-07-31). Multiple partials are supported until the balance clears (Invoice 2.4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `invoice_id` | CHAR(36) | NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) | Cannot exceed Balance Due — overpayment blocked outright by trigger (spans rows) |
| `balance_due_at_entry` | DECIMAL(14,2) | NOT NULL | The read-only figure shown on screen when the payment was recorded |
| `payment_mode_id` | CHAR(36) | NOT NULL REFERENCES payment_modes(id) ON DELETE RESTRICT | Full Masters 3.8 list, not a hardcoded four |
| `received_into_bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Defaults to the invoice's account and STAYS EDITABLE — customers do pay into a different account. Optional ('Not recorded'). This is what bank reconciliation matches on |
| `payment_date` | DATE | NOT NULL |  |
| `reference` | TEXT |  | Transaction ID or cheque number |
| `status` | payment_record_status | NOT NULL DEFAULT 'recorded' | ENUM ('recorded','reversed'). Tier 2 — a recorded receipt is never deleted |
| `reversed_at` | DATETIME(6) |  |  |
| `reversed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `reversal_reason` | TEXT |  |  |
| `recorded_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `recorded_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE INDEX ix_invpay_invoice ON invoice_payments (invoice_id, payment_date DESC)
- CREATE INDEX ix_invpay_date ON invoice_payments (payment_date DESC)
- CREATE INDEX ix_invpay_mode ON invoice_payments (payment_mode_id)
- CREATE INDEX ix_invpay_bank_account ON invoice_payments (received_into_bank_account_id)
- CREATE INDEX ix_invpay_fy ON invoice_payments (financial_year_id)

**Triggers**
- trg_invpay_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_invpay_no_overpay BEFORE INSERT OR UPDATE -> fn_invoice_payment_reject_overpay() (spans rows: amount must not exceed the live balance)
- trg_invpay_status_guard BEFORE INSERT -> fn_invoice_payment_require_sent() (only Sent or Part-Paid invoices accept a payment; never Draft)
- trg_invpay_apply AFTER INSERT OR UPDATE OR DELETE -> fn_invoice_apply_payment()

### `credit_notes`  _(11 Invoice)_

A separate, linked document that reduces what a customer owes on a locked invoice, without reopening or editing it. Draft -> Pending Approval -> Approved, with Super Admin approval required regardless of who raised it (Invoice 2.5, 3.6).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `credit_note_number` | VARCHAR(191) | NOT NULL UNIQUE | FULL rendered code, e.g. CN-2026-0001 — its own series, never reusing the invoice number. From document_number_sequences (code_type='credit_note', financial_year_id), FOR UPDATE |
| `invoice_id` | CHAR(36) | NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT | 'Original Invoice' — read-only, pre-filled |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `invoice_number_snapshot` | TEXT | NOT NULL | Search covers Credit Note Number, Original Invoice Number and Customer Name |
| `customer_name_snapshot` | TEXT | NOT NULL |  |
| `credit_note_date` | DATE | NOT NULL DEFAULT CURRENT_DATE |  |
| `reason` | credit_note_reason | NOT NULL | ENUM ('billing_error','customer_dispute','goods_or_service_not_delivered','other') |
| `reason_detail` | TEXT | NOT NULL CHECK (length(btrim(reason_detail)) > 0) |  |
| `credit_amount` | DECIMAL(14,2) | NOT NULL CHECK (credit_amount > 0) | Cannot exceed the original invoice's Grand Total — enforced by trigger (spans tables) |
| `status` | credit_note_status | NOT NULL DEFAULT 'draft' | ENUM ('draft','pending_approval','approved'). Tier 2 |
| `raised_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT | 'Raised By' column on the list |
| `submitted_at` | DATETIME(6) |  |  |
| `approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT CHECK (status <> 'approved' OR approved_by IS NOT NULL) | Super Admin only |
| `approved_at` | DATETIME(6) |  |  |
| `applied_to_invoice_at` | DATETIME(6) |  | When the invoice's effective outstanding was reduced |
| `pdf_file_path` | TEXT |  | Same letterhead treatment as an invoice |

**Indexes**
- CREATE UNIQUE INDEX ux_credit_notes_number ON credit_notes (credit_note_number)
- CREATE INDEX ix_credit_notes_invoice ON credit_notes (invoice_id)
- CREATE INDEX ix_credit_notes_customer_status ON credit_notes (customer_id, status)
- CREATE INDEX ix_credit_notes_pending ON credit_notes (status) WHERE status = 'pending_approval'
- CREATE INDEX ix_credit_notes_date ON credit_notes (credit_note_date DESC)
- CREATE INDEX ix_credit_notes_amount ON credit_notes (credit_amount)
- CREATE INDEX ix_credit_notes_raised_approved ON credit_notes (raised_by, approved_by)
- `ix_credit_notes_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_credit_notes_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_credit_notes_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_credit_notes_allocate_number BEFORE INSERT -> fn_allocate_document_number('credit_note')
- trg_credit_notes_cap BEFORE INSERT OR UPDATE -> fn_credit_note_reject_over_invoice_total() (spans tables)
- trg_credit_notes_source_guard BEFORE INSERT -> fn_credit_note_require_paid_or_part_paid() (raised only from a Paid or Part-Paid invoice)
- trg_credit_notes_frozen_after_approval BEFORE UPDATE OR DELETE -> fn_reject_edit_after_approval()
- trg_credit_notes_apply AFTER INSERT OR UPDATE -> fn_invoice_recalc_credit_total() (approved only; the invoice itself stays locked and unchanged)

### `credit_note_line_items`  _(11 Invoice)_

Optional per-line detail on a partial credit, tied to specific line items of the original invoice. A whole-invoice credit skips these and uses credit_amount directly (Invoice 2.5).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `credit_note_id` | CHAR(36) | NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE |  |
| `invoice_line_item_id` | CHAR(36) | NOT NULL REFERENCES invoice_line_items(id) ON DELETE RESTRICT |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `description_snapshot` | TEXT | NOT NULL | SNAPSHOT from the locked invoice line |
| `quantity_snapshot` | DECIMAL(14,2) | NOT NULL |  |
| `rate_snapshot` | DECIMAL(14,2) | NOT NULL |  |
| `line_total_snapshot` | DECIMAL(14,2) | NOT NULL |  |
| `credited_amount` | DECIMAL(14,2) | NOT NULL CHECK (credited_amount > 0) CHECK (credited_amount <= line_total_snapshot) |  |

**Indexes**
- CREATE UNIQUE INDEX ux_cn_lines_once ON credit_note_line_items (credit_note_id, invoice_line_item_id)
- CREATE UNIQUE INDEX ux_cn_lines_seq ON credit_note_line_items (credit_note_id, sequence)
- CREATE INDEX ix_cn_lines_invoice_line ON credit_note_line_items (invoice_line_item_id)

**Triggers**
- trg_cn_lines_frozen_after_approval BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_edit_after_approval()
- trg_cn_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_invoice_line_recalc_credited() (maintains invoice_line_items.credited_amount)

### `expense_claims`  _(12 Expense)_

A staff-filed expense with a receipt, carrying claim_type snapshotted from the Expense Type's Claim Type in Masters 3.3. Reimbursable enters the reimbursement queue and ends in a payout; Company-Paid skips it entirely and is routed to company_expenses. Optional two-way link to a purchase bill (Expense 2.1-2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `employee_id` | CHAR(36) | NOT NULL REFERENCES employees(id) ON DELETE RESTRICT | The claimant; every role files identically |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `expense_type_id` | CHAR(36) | NOT NULL REFERENCES expense_types(id) ON DELETE RESTRICT | Active types only in the dropdown; deactivation never rewrites this row |
| `claim_type` | expense_claim_type | NOT NULL | ENUM ('reimbursable','company_paid'). DRIVEN BY expense_types.claim_type and snapshotted at insert by trigger — changing the type's Claim Type later re-routes future expenses only, never retroactively |
| `expense_type_name_snapshot` | TEXT | NOT NULL |  |
| `expense_type_short_code_snapshot` | TEXT |  | Used on the bank-statement export |
| `is_recurring_type_snapshot` | TINYINT(1) | NOT NULL DEFAULT false |  |
| `vendor_id` | CHAR(36) | REFERENCES vendors(id) ON DELETE RESTRICT | Optional; may be created inline via the Add New Vendor modal |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) | The FULL total the claimant paid, tax INCLUDED — tax is a component, never added on top |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | Purchase-scope heads in force on expense_date. Field hidden entirely when none is configured |
| `tax_amount` | DECIMAL(14,2) | CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)) | A component OF amount — the CHECK is what stops a reimbursement being inflated |
| `tax_head_name_snapshot` | TEXT |  | SNAPSHOT |
| `tax_print_label_snapshot` | TEXT |  | SNAPSHOT |
| `tax_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `tax_type_snapshot` | tax_type |  | SNAPSHOT of the method |
| `expense_date` | DATE | NOT NULL | Cannot be in the future — trigger, since now() is not immutable in a CHECK |
| `linked_purchase_bill_id` | CHAR(36) | REFERENCES purchase_bills(id) ON DELETE RESTRICT | OPTIONAL TWO-WAY LINK. Linked, the claim and the supplier's own bill settle as a single amount; unlinked, the company pays both. Either side may make the link and both records show it |
| `description` | TEXT | NOT NULL CHECK (length(btrim(description)) > 0) | REQUIRED (changed from optional) — it is the approver's line and the bank-statement export line |
| `receipt_file_path` | TEXT |  | Image or PDF; not required to submit |
| `receipt_uploaded_at` | DATETIME(6) |  |  |
| `has_receipt` | TINYINT(1) | GENERATED ALWAYS AS (receipt_file_path IS NOT NULL) STORED | DERIVED: single-row -> GENERATED STORED. Backs the 'has receipt attached' filter that the Require-a-Receipt toggle had nothing to act on before |
| `bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Meshrd's own account. Stays blank until Reimbursed — a blank account on an Approved row is the visible marker that money has not moved. Maintained by trigger from expense_reimbursements |
| `status` | expense_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','approved','reimbursed','rejected'). Tier 2 — never set by the submitter; defaults to pending on save |
| `submitted_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |
| `approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT | Accountant, with Super Admin as fallback |
| `approved_at` | DATETIME(6) |  |  |
| `rejected_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `rejected_at` | DATETIME(6) |  |  |
| `rejection_reason` | TEXT | CHECK (status <> 'rejected' OR length(btrim(coalesce(rejection_reason,''))) > 0) | REQUIRED on reject (flipped from optional) |
| `auto_approved` | TINYINT(1) | NOT NULL DEFAULT false | 'Set an Auto-Approval Threshold' toggle |
| `auto_approval_threshold_snapshot` | DECIMAL(14,2) |  |  |
| `receipt_required_at_approval_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | Snapshot of 'Require a Receipt Before Approval' as it stood |
| `reimbursed_at` | DATETIME(6) |  | DERIVED across rows -> trigger from expense_reimbursements |
| `outcome_notified_at` | DATETIME(6) |  |  |

**Indexes**
- CREATE INDEX ix_expclaims_employee_status ON expense_claims (employee_id, status, expense_date DESC)
- CREATE INDEX ix_expclaims_pending_queue ON expense_claims (submitted_at) WHERE status = 'pending'
- CREATE INDEX ix_expclaims_awaiting_reimbursement ON expense_claims (approved_at) WHERE status = 'approved'
- CREATE INDEX ix_expclaims_type_fy ON expense_claims (expense_type_id, financial_year_id)
- CREATE INDEX ix_expclaims_claim_type ON expense_claims (claim_type, status)
- CREATE INDEX ix_expclaims_vendor ON expense_claims (vendor_id) WHERE vendor_id IS NOT NULL
- CREATE INDEX ix_expclaims_bank_account ON expense_claims (bank_account_id)
- CREATE INDEX ix_expclaims_amount ON expense_claims (amount)
- CREATE INDEX ix_expclaims_has_receipt ON expense_claims (has_receipt)
- CREATE UNIQUE INDEX ux_expclaims_linked_bill ON expense_claims (linked_purchase_bill_id) WHERE linked_purchase_bill_id IS NOT NULL
- CREATE INDEX ix_expclaims_approved_by ON expense_claims (approved_by, approved_at DESC)
- `ix_expclaims_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_expclaims_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_expclaims_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_expclaims_snapshot_claim_type BEFORE INSERT -> fn_expense_snapshot_type() (copies claim_type, name, short code and Recurring from expense_types; also enforces that Company-Paid types are raisable only by Super Admin/Accountant)
- trg_expclaims_no_future_date BEFORE INSERT OR UPDATE -> fn_reject_future_date(expense_date)
- trg_expclaims_route_company_paid AFTER INSERT -> fn_route_company_paid_expense() (a claim_type='company_paid' row creates its company_expenses counterpart and never enters the reimbursement queue)
- trg_expclaims_two_way_link AFTER INSERT OR UPDATE -> fn_sync_expense_purchase_bill_link() (populates purchase_bills.linked_expense_claim_id from this side)
- trg_expclaims_apply_reimbursement AFTER INSERT OR UPDATE OR DELETE ON expense_reimbursements -> fn_expense_apply_reimbursement() (sets status='reimbursed', bank_account_id, reimbursed_at)

### `expense_reimbursements`  _(12 Expense)_

The manual confirmation that a real payout happened against an Approved claim — the ONE screen where an expense's bank account is actually set. This module tracks that reimbursement occurred; it never initiates payment (Expense 2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `expense_claim_id` | CHAR(36) | NOT NULL REFERENCES expense_claims(id) ON DELETE RESTRICT |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `reimbursed_date` | DATE | NOT NULL DEFAULT CURRENT_DATE |  |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) | Defaults to the claim amount |
| `payment_mode_id` | CHAR(36) | NOT NULL REFERENCES payment_modes(id) ON DELETE RESTRICT | Masters 3.8 |
| `reimbursed_from_bank_account_id` | CHAR(36) | NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT | REQUIRED — a real reimbursement has to leave a real account, and this is what the bank-statement export reconciles against |
| `reference` | TEXT |  | Transaction ID |
| `status` | payment_record_status | NOT NULL DEFAULT 'recorded' | ENUM ('recorded','reversed'). Tier 2 |
| `reversed_at` | DATETIME(6) |  |  |
| `reversed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `reversal_reason` | TEXT |  |  |
| `auto_marked_via_payroll` | TINYINT(1) | NOT NULL DEFAULT false | 'Auto-Mark as Reimbursed When Paid via Payroll' toggle — OFF by default |
| `payslip_id` | CHAR(36) | REFERENCES payslips(id) ON DELETE RESTRICT CHECK (NOT auto_marked_via_payroll OR payslip_id IS NOT NULL) | The payslip the claim was bundled into, when that route is used |
| `reimbursed_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `reimbursed_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE UNIQUE INDEX ux_expreimb_one_live_per_claim ON expense_reimbursements (expense_claim_id) WHERE status = 'recorded'
- CREATE INDEX ix_expreimb_date ON expense_reimbursements (reimbursed_date DESC)
- CREATE INDEX ix_expreimb_bank_account ON expense_reimbursements (reimbursed_from_bank_account_id, reimbursed_date)
- CREATE INDEX ix_expreimb_mode ON expense_reimbursements (payment_mode_id)
- CREATE INDEX ix_expreimb_payslip ON expense_reimbursements (payslip_id) WHERE payslip_id IS NOT NULL

**Triggers**
- trg_expreimb_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_expreimb_require_approved BEFORE INSERT -> fn_expense_require_approved_reimbursable() (only an Approved, claim_type='reimbursable' claim may be reimbursed)
- trg_expreimb_apply AFTER INSERT OR UPDATE OR DELETE -> fn_expense_apply_reimbursement()

### `company_expenses`  _(12 Expense)_

Meshrd's own running bills — internet, electricity, rent, telephone, hosting. The company itself was billed, so there is no claimant, no approval queue and no reimbursement. A row reaches here entirely from its Expense Type's Claim Type = Company-Paid (Expense 2.4).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `expense_type_id` | CHAR(36) | NOT NULL REFERENCES expense_types(id) ON DELETE RESTRICT | Company-Paid types only — enforced by trigger against expense_types.claim_type |
| `claim_type_snapshot` | expense_claim_type | NOT NULL DEFAULT 'company_paid' CHECK (claim_type_snapshot = 'company_paid') | Structural, not a matter of attention — this is what keeps an office rent payment out of the reimbursement queue |
| `expense_type_name_snapshot` | TEXT | NOT NULL |  |
| `expense_type_short_code_snapshot` | TEXT |  |  |
| `is_recurring_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | From the type's Recurring toggle. Changes no approval behaviour; it lets Accounts filter expected bills apart and makes a month where an expected bill never arrived visible as an absence |
| `vendor_id` | CHAR(36) | REFERENCES vendors(id) ON DELETE RESTRICT | The supplier who issued the bill — usually present here, unlike on a staff claim |
| `linked_purchase_bill_id` | CHAR(36) | REFERENCES purchase_bills(id) ON DELETE RESTRICT | Where the supplier also raised a formal bill for the same spend |
| `source_expense_claim_id` | CHAR(36) | REFERENCES expense_claims(id) ON DELETE RESTRICT | Set when the row was routed here from a Company-Paid type filed on the Add Expense form. One-way link; avoids a circular FK |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) |  |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | Purchase-scope, optional |
| `tax_amount` | DECIMAL(14,2) | CHECK (tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)) | A component of amount, same rule as a claim |
| `tax_head_name_snapshot` | TEXT |  | SNAPSHOT |
| `tax_print_label_snapshot` | TEXT |  | SNAPSHOT |
| `tax_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `paid_from_bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Optional while Pending, required once Paid (trigger) — this IS the payment record, there is no reimbursement step behind it |
| `payment_mode_id` | CHAR(36) | REFERENCES payment_modes(id) ON DELETE RESTRICT |  |
| `payment_reference` | TEXT |  |  |
| `paid_on` | DATE | CHECK (paid_on IS NULL OR paid_on >= expense_date) |  |
| `expense_date` | DATE | NOT NULL | Cannot be in the future — trigger |
| `billing_period_month` | smallint | CHECK (billing_period_month IS NULL OR billing_period_month BETWEEN 1 AND 12) | For a standing monthly bill; backs the Period filter and the missing-bill check |
| `billing_period_year` | smallint |  |  |
| `description` | TEXT |  |  |
| `bill_file_path` | TEXT |  | 'Bill Attached' — the supplier's invoice, the audit source document |
| `bill_uploaded_at` | DATETIME(6) |  |  |
| `has_bill_attached` | TINYINT(1) | GENERATED ALWAYS AS (bill_file_path IS NOT NULL) STORED | DERIVED: single-row -> GENERATED STORED |
| `status` | company_expense_status | NOT NULL DEFAULT 'pending' | ENUM ('pending','paid','cancelled'). Tier 2 — no approval queue exists for these |
| `cancelled_at` | DATETIME(6) |  |  |
| `cancelled_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `cancellation_reason` | TEXT |  |  |

**Indexes**
- CREATE UNIQUE INDEX ux_compexp_source_claim ON company_expenses (source_expense_claim_id) WHERE source_expense_claim_id IS NOT NULL
- CREATE UNIQUE INDEX ux_compexp_recurring_period ON company_expenses (expense_type_id, vendor_id, billing_period_year, billing_period_month) WHERE is_recurring_snapshot AND status <> 'cancelled'
- CREATE INDEX ix_compexp_type_status ON company_expenses (expense_type_id, status)
- CREATE INDEX ix_compexp_vendor ON company_expenses (vendor_id) WHERE vendor_id IS NOT NULL
- CREATE INDEX ix_compexp_bank_account ON company_expenses (paid_from_bank_account_id, expense_date)
- CREATE INDEX ix_compexp_date ON company_expenses (expense_date DESC)
- CREATE INDEX ix_compexp_fy ON company_expenses (financial_year_id, status)
- CREATE INDEX ix_compexp_linked_bill ON company_expenses (linked_purchase_bill_id) WHERE linked_purchase_bill_id IS NOT NULL
- CREATE INDEX ix_compexp_recurring_expected ON company_expenses (is_recurring_snapshot, billing_period_year, billing_period_month) WHERE is_recurring_snapshot

**Triggers**
- trg_compexp_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_compexp_type_guard BEFORE INSERT OR UPDATE -> fn_company_expense_require_company_paid_type() (rejects a Reimbursable type outright)
- trg_compexp_snapshot BEFORE INSERT -> fn_company_expense_snapshot_type() (name, short code, Recurring, Default Bank Account pre-select)
- trg_compexp_no_future_date BEFORE INSERT OR UPDATE -> fn_reject_future_date(expense_date)
- trg_compexp_require_account_when_paid BEFORE UPDATE -> fn_company_expense_require_account_on_paid()

### `vendors`  _(07 Vendor)_

The supplier master list — who Meshrd buys from. Standalone, with no Masters dependency. Bank Account NAME is the primary banking field (the thing a person actually verifies before releasing a payment); the number is secondary and shown masked (Vendor 2.1, 2.2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `vendor_name` | TEXT | NOT NULL CHECK (length(btrim(vendor_name)) BETWEEN 2 AND 150) |  |
| `vendor_category` | TEXT |  | Vendor Category or Type, where one is recorded — backs that filter |
| `gstin` | TEXT | CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$') | Exactly 15 chars, auto-uppercased. Withheld from Manager unless the bank/GST flag is on |
| `pan` | TEXT | CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') | Exactly 10 chars, auto-uppercased |
| `contact_email` | TEXT | CHECK (contact_email IS NULL OR contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') |  |
| `contact_phone` | TEXT | CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9][0-9]{9}$') | 10-digit Indian mobile |
| `payment_terms_days` | INT | NOT NULL DEFAULT 30 CHECK (payment_terms_days > 0) | Shown as '30 days'. Defaults to 30 so Purchase Bill has something to calculate a due date from |
| `address_street` | TEXT |  |  |
| `address_city` | TEXT |  |  |
| `address_state` | TEXT |  | Indian states/UTs dropdown; no Masters sub-master exists for it, so plain TEXT validated in the UI list |
| `address_pin_code` | TEXT | CHECK (address_pin_code IS NULL OR address_pin_code ~ '^[0-9]{6}$') |  |
| `bank_account_name` | TEXT |  | PRIMARY banking field — the name ON the account, e.g. 'Chola Technologies Pvt Ltd'. A name that does not match the vendor is the clearest sign of a changed detail, a typo, or a fraudulent payee |
| `bank_name` | TEXT |  | The bank the account is held at, e.g. 'HDFC Bank' |
| `bank_account_number` | TEXT | CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{6,20}$') | The VENDOR's own account, for Meshrd to pay them — entirely separate from the Masters Bank Account sub-master, which holds only Meshrd's own accounts |
| `bank_account_number_masked` | TEXT | GENERATED ALWAYS AS (CASE WHEN bank_account_number IS NULL THEN NULL ELSE COALESCE(bank_name \|\| ' ', '') \|\| '••••' \|\| right(bank_account_number, 4) END) STORED | DERIVED: single-row immutable -> GENERATED STORED. Renders 'HDFC Bank ••••2201' — the secondary column, shown on list screens so a full account number never appears in a list or an export |
| `ifsc_code` | TEXT | CHECK (ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[0-9A-Z]{6}$') | Exactly 11 chars; without it a Bill Payment could not be routed by NEFT/RTGS |
| `has_bank_details` | TINYINT(1) | GENERATED ALWAYS AS (bank_account_name IS NOT NULL OR bank_account_number IS NOT NULL) STORED | DERIVED: single-row -> GENERATED STORED. Backs the 'has bank details on file' filter, which is hidden from Manager whenever the bank/GST flag is off |
| `is_active` | TINYINT(1) | NOT NULL DEFAULT true | TIER 1 soft delete: never hard-deleted once used. Deactivating hides it from new Purchase Bill/Expense pickers while every past record keeps pointing at it |
| `deactivated_at` | DATETIME(6) |  |  |
| `deactivated_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `deactivation_reason` | TEXT |  |  |
| `approval_status` | vendor_approval_status | NOT NULL DEFAULT 'approved' | ENUM ('approved','pending_approval'). 'Require Approval to Add a New Vendor' — OFF by default; ON is a common safeguard against fake-vendor fraud |
| `approved_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `approved_at` | DATETIME(6) |  |  |
| `created_inline` | TINYINT(1) | NOT NULL DEFAULT false | True when added from the lightweight '+ Add New Vendor' modal on a Purchase Bill or Expense — the rest of the record gets completed later |
| `purchase_bill_count` | INT | NOT NULL DEFAULT 0 | DERIVED across tables -> trigger |
| `expense_count` | INT | NOT NULL DEFAULT 0 | DERIVED across tables -> trigger (expense_claims + company_expenses) |
| `has_usage_history` | TINYINT(1) | NOT NULL DEFAULT false | DERIVED across tables -> trigger. THE REFERENCE GUARD: true hides the Delete button entirely and permits Deactivate only |
| `outstanding_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across tables -> trigger from unpaid/part-paid purchase_bills. Backs the 'has outstanding bills' filter — 'who do we owe' |
| `total_spend` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across tables -> trigger. Held here for filtering only; Vendor Usage itself stays a list with no totals or charts, by design |

**Indexes**
- CREATE INDEX ix_vendors_name ON vendors (lower(vendor_name))
- CREATE INDEX ix_vendors_active ON vendors (is_active)
- CREATE INDEX ix_vendors_gstin ON vendors (gstin) WHERE gstin IS NOT NULL
- CREATE INDEX ix_vendors_city_state ON vendors (address_state, address_city)
- CREATE INDEX ix_vendors_payment_terms ON vendors (payment_terms_days)
- CREATE INDEX ix_vendors_has_bank ON vendors (has_bank_details)
- CREATE INDEX ix_vendors_outstanding ON vendors (outstanding_amount) WHERE outstanding_amount > 0
- CREATE INDEX ix_vendors_pending_approval ON vendors (approval_status) WHERE approval_status = 'pending_approval'
- CREATE INDEX ix_vendors_created_on ON vendors (created_at DESC)
- `ix_vendors_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_vendors_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_vendors_uppercase BEFORE INSERT OR UPDATE -> fn_vendor_uppercase_tax_ids() (auto-uppercases gstin, pan, ifsc_code)
- trg_vendors_default_payment_terms BEFORE INSERT -> fn_vendor_default_payment_terms() (30 when left blank)
- trg_vendors_block_delete_when_used BEFORE DELETE -> fn_vendor_reject_delete_when_used() (REFERENCE GUARD — a vendor with any usage can only be deactivated; overridable only by the 'Allow Hard Delete of a Vendor' flag)
- trg_vendors_recalc_usage AFTER INSERT OR UPDATE OR DELETE ON purchase_bills / expense_claims / company_expenses -> fn_vendor_recalc_usage() (maintains the five rollup columns; spans tables)

### `purchase_bills`  _(13 Purchase Bill)_

A bill received from a supplier — money going out. Starts at Unpaid (no Draft/Sent stage, it is already a real document). Carries BOTH the internal PB code and the vendor's own bill number, plus an optional two-way link to a staff expense claim (Purchase Bill 2.1-2.2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `purchase_bill_code` | VARCHAR(191) | NOT NULL UNIQUE | INTERNAL ID — the FULL rendered code, e.g. PB-2026-0001. From document_number_sequences (code_type='purchase_bill', financial_year_id), FOR UPDATE inside the creating transaction. Meshrd's own reference, never seen by the vendor |
| `vendor_bill_number` | TEXT | NOT NULL CHECK (length(btrim(vendor_bill_number)) > 0) | THE VENDOR'S OWN number, printed on their document, manually entered and required. Nothing to do with the internal code above |
| `vendor_id` | CHAR(36) | NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT | Active-only filtering happens in the dropdown query, never by breaking history |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `vendor_name_snapshot` | TEXT | NOT NULL | Search covers internal ID, vendor bill number and supplier name |
| `vendor_gstin_snapshot` | TEXT |  |  |
| `bill_date` | DATE | NOT NULL | Cannot be in the future — it is the date on a document that already exists (trigger) |
| `due_date` | DATE | CHECK (due_date IS NULL OR due_date > bill_date) | Defaulted from the vendor's Payment Terms (days) when left blank |
| `payment_terms_days_snapshot` | INT | CHECK (payment_terms_days_snapshot IS NULL OR payment_terms_days_snapshot > 0) |  |
| `notes` | TEXT |  |  |
| `attachment_file_path` | TEXT |  | Scan or photo of the actual vendor bill — the audit source document. Important, not hard-blocking by default |
| `attachment_uploaded_at` | DATETIME(6) |  |  |
| `has_attachment` | TINYINT(1) | GENERATED ALWAYS AS (attachment_file_path IS NOT NULL) STORED | DERIVED: single-row -> GENERATED STORED. Backs the 'Require Attachment Before Marking a Bill Paid' toggle |
| `bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Which of Meshrd's own accounts this bill is expected to be paid from; carried as the DEFAULT on Record Payment, where it stays editable |
| `effective_bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | DERIVED across rows -> trigger. The list column: the account named on the bill, or the account a payment was ACTUALLY made from once one exists — the figure that matters for reconciliation |
| `linked_expense_claim_id` | CHAR(36) | REFERENCES expense_claims(id) ON DELETE RESTRICT | OPTIONAL TWO-WAY LINK to the staff claim covering the same spend. Unlinked, the company pays the supplier AND reimburses the employee. Either side may make the link; both records show it |
| `subtotal` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from purchase_bill_line_items |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | Purchase-scope heads in force on bill_date. Optional — a bill can be recorded correctly before any head is configured at all |
| `tax_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (tax_amount >= 0) | Auto-filled from the head OR typed directly. The direct override stays available even after picking a head, because the vendor's own figure may not land on a configured rate (rounding) |
| `tax_amount_is_manual_override` | TINYINT(1) | NOT NULL DEFAULT false | True when the accountant overrode the calculated figure to match the vendor's document |
| `total_amount` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount) STORED | DERIVED: single-row -> GENERATED STORED. **The vendor's claim — withholding never reduces it** |
| `withholding_tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | **Added 2026-07-31 (A276).** Withholding-scope head, in force on bill_date. NULL when none applies. The whole group is hidden in the UI when no withholding-scope head is configured |
| `withholding_calculated_on` | TEXT | CHECK (withholding_calculated_on IS NULL OR withholding_calculated_on IN ('SUBTOTAL','TOTAL')) | Required once a head is selected; UI defaults to `SUBTOTAL`. The two bases produce materially different figures, so it is stored rather than assumed |
| `withholding_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0 AND withholding_amount <= subtotal + tax_amount) | Auto-filled from the head against the chosen base, editable for the same reason `tax_amount` is. Capped at Total by CHECK |
| `withholding_amount_is_manual_override` | TINYINT(1) | NOT NULL DEFAULT false | Mirrors `tax_amount_is_manual_override` |
| `withholding_head_name_snapshot` | TEXT |  | SNAPSHOT of the head's name/label at calculation time, so a historical bill reproduces exactly after the head is edited — same rule as every other calculated tax line |
| `withholding_rate_snapshot` | DECIMAL(7,4) |  | SNAPSHOT |
| `amount_payable_to_vendor` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount - withholding_amount) STORED | DERIVED: single-row -> GENERATED STORED. **What actually leaves the bank, and the ceiling for every payment against this bill** |
| `amount_paid` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from purchase_bill_payments |
| `balance_due` | DECIMAL(14,2) | GENERATED ALWAYS AS (subtotal + tax_amount - withholding_amount - amount_paid) STORED | DERIVED: single-row -> GENERATED STORED (cannot reference the generated columns above, so the expression is restated). **Measured against Amount Payable to Vendor, not Total** — otherwise every withheld bill strands at Part-Paid forever and payables are permanently overstated |
| `status` | purchase_bill_status | NOT NULL DEFAULT 'unpaid' | ENUM ('unpaid','part_paid','paid'). No Draft or Sent stage. Tier 2 — inferred set, flagged as such in the spec |
| `paid_at` | DATETIME(6) |  |  |
| `lock_on_paid_enabled_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | Snapshot of 'Lock Purchase Bill Once Fully Paid' — OFF by default, unlike Invoice which always locks |
| `is_locked` | TINYINT(1) | NOT NULL DEFAULT false CHECK (NOT is_locked OR status = 'paid') | NOT generated, because locking here is conditional on an RBAC flag rather than on status alone; set by trigger when the flag is on and the bill reaches Paid |
| `attachment_required_before_payment_snapshot` | TINYINT(1) | NOT NULL DEFAULT false | Snapshot of 'Require Attachment Before Marking a Bill Paid' |

**Indexes**
- CREATE UNIQUE INDEX ux_pbills_code ON purchase_bills (purchase_bill_code)
- CREATE UNIQUE INDEX ux_pbills_vendor_bill_number ON purchase_bills (vendor_id, lower(btrim(vendor_bill_number)))
- CREATE UNIQUE INDEX ux_pbills_linked_claim ON purchase_bills (linked_expense_claim_id) WHERE linked_expense_claim_id IS NOT NULL
- CREATE INDEX ix_pbills_vendor_status ON purchase_bills (vendor_id, status)
- CREATE INDEX ix_pbills_fy_billdate ON purchase_bills (financial_year_id, bill_date DESC)
- CREATE INDEX ix_pbills_overdue ON purchase_bills (due_date) WHERE status IN ('unpaid','part_paid') AND due_date IS NOT NULL
- CREATE INDEX ix_pbills_balance ON purchase_bills (balance_due) WHERE balance_due > 0
- CREATE INDEX ix_pbills_total ON purchase_bills (total_amount)
- CREATE INDEX ix_pbills_bank_account ON purchase_bills (effective_bank_account_id)
- CREATE INDEX ix_pbills_created_by ON purchase_bills (created_by, created_at DESC)
- CREATE INDEX ix_pbills_tax_head ON purchase_bills (tax_head_id) WHERE tax_head_id IS NOT NULL
- `ix_pbills_search_trgm` — **MySQL: InnoDB `FULLTEXT`**, not GIN. `FULLTEXT KEY ix_pbills_search_trgm (…the same columns…)`, queried with `MATCH(…) AGAINST (:term IN BOOLEAN MODE)`. See D0.4 for what this changes about search behaviour

**Triggers**
- trg_pbills_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_pbills_allocate_code BEFORE INSERT -> fn_allocate_document_number('purchase_bill')
- trg_pbills_no_future_bill_date BEFORE INSERT OR UPDATE -> fn_reject_future_date(bill_date)
- trg_pbills_default_due_date BEFORE INSERT -> fn_pbill_due_date_from_payment_terms()
- trg_pbills_lock_guard BEFORE UPDATE OR DELETE -> fn_pbill_reject_edit_when_locked() (active only when lock_on_paid_enabled_snapshot is true)
- trg_pbills_rollup_lines AFTER INSERT OR UPDATE OR DELETE ON purchase_bill_line_items / purchase_bill_tax_lines -> fn_pbill_recalc_totals()
- trg_pbills_apply_payment AFTER INSERT OR UPDATE OR DELETE ON purchase_bill_payments -> fn_pbill_apply_payment() (maintains amount_paid, moves status Unpaid -> Part-Paid -> Paid, stamps paid_at, and updates effective_bank_account_id to the account actually paid from)
- trg_pbills_two_way_link AFTER INSERT OR UPDATE -> fn_sync_expense_purchase_bill_link() (populates expense_claims.linked_purchase_bill_id from this side)

**Withholding (A276) — the status rule that is easy to get wrong.** A bill reaches `paid` when `amount_paid + withholding_amount = total_amount`, **not** when `amount_paid = total_amount`. A ₹1,00,000 bill with ₹10,000 withheld is fully settled on a ₹90,000 payment — the supplier is owed nothing further. The trigger that maintains `status` must use the former comparison; the naive version leaves every withheld bill permanently `part_paid`. Vendor Usage (Module 7 §2.3) still reports the **gross** `total_amount`, because that view is about what a supplier was billed, not what net cash reached them.

### `purchase_bill_line_items`  _(13 Purchase Bill)_

Repeatable rows on a supplier bill, with HSN/SAC at line level — which matters here for input tax credit as well as record-keeping (Purchase Bill 2.2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `purchase_bill_id` | CHAR(36) | NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `description` | TEXT | NOT NULL CHECK (length(btrim(description)) > 0) |  |
| `hsn_code_id` | CHAR(36) | REFERENCES hsn_sac_codes(id) ON DELETE RESTRICT | Masters 3.11, optional |
| `hsn_code_snapshot` | TEXT |  | SNAPSHOT of the code as recorded |
| `quantity` | DECIMAL(14,2) | NOT NULL CHECK (quantity > 0) |  |
| `rate` | DECIMAL(14,2) | NOT NULL CHECK (rate > 0) |  |
| `line_total` | DECIMAL(14,2) | GENERATED ALWAYS AS (quantity * rate) STORED | DERIVED: single-row -> GENERATED STORED; recalculates live on screen as figures are typed |

**Indexes**
- CREATE UNIQUE INDEX ux_pbill_lines_seq ON purchase_bill_line_items (purchase_bill_id, sequence)
- CREATE INDEX ix_pbill_lines_bill ON purchase_bill_line_items (purchase_bill_id)
- CREATE INDEX ix_pbill_lines_hsn ON purchase_bill_line_items (hsn_code_id) WHERE hsn_code_id IS NOT NULL

**Triggers**
- trg_pbill_lines_locked_parent BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_parent_bill_locked()
- trg_pbill_lines_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_pbill_recalc_totals()

### `purchase_bill_tax_lines`  _(13 Purchase Bill)_

The tax recorded on a supplier bill — one row per head plus a child row per Split Component. SNAPSHOTS name, print label, method, rate and computed base at calculation time, and records whether the figure was overridden to match the vendor's own document.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `purchase_bill_id` | CHAR(36) | NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE |  |
| `sequence` | smallint | NOT NULL CHECK (sequence > 0) |  |
| `tax_head_id` | CHAR(36) | REFERENCES tax_heads(id) ON DELETE RESTRICT | NULLABLE here specifically — a directly-typed Tax Amount produces a line with no head, which is how a bill is recorded before any head is configured |
| `head_name_snapshot` | TEXT |  | SNAPSHOT |
| `print_label_snapshot` | TEXT |  | SNAPSHOT |
| `scope_snapshot` | tax_scope | CHECK (scope_snapshot IS NULL OR scope_snapshot IN ('purchase','sales_billing_and_purchase')) | SNAPSHOT |
| `tax_type_snapshot` | tax_type |  | SNAPSHOT of the method |
| `rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `cgst_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `sgst_rate_snapshot` | DECIMAL(6,3) |  | SNAPSHOT |
| `fixed_amount_snapshot` | DECIMAL(14,2) |  | SNAPSHOT |
| `computed_base` | DECIMAL(14,2) | NOT NULL | SNAPSHOT of the base — the bill Subtotal at calculation time |
| `computed_amount` | DECIMAL(14,2) | NOT NULL CHECK (computed_amount >= 0) | What the head produced before any override |
| `entered_amount` | DECIMAL(14,2) | NOT NULL CHECK (entered_amount >= 0) | What is actually carried into purchase_bills.tax_amount — equals computed_amount unless overridden |
| `is_manual_override` | TINYINT(1) | GENERATED ALWAYS AS (entered_amount <> computed_amount) STORED | DERIVED: single-row -> GENERATED STORED |
| `calculation_note` | TEXT |  | Working, plus the reason for any override; TEXT, not JSON |
| `parent_line_id` | CHAR(36) | REFERENCES purchase_bill_tax_lines(id) ON DELETE CASCADE |  |
| `component_name_snapshot` | TEXT |  | SNAPSHOT of the Split Component name |
| `component_share_pct_snapshot` | DECIMAL(6,3) | CHECK (component_share_pct_snapshot IS NULL OR (component_share_pct_snapshot > 0 AND component_share_pct_snapshot <= 100)) |  |

**Indexes**
- CREATE UNIQUE INDEX ux_pbill_tax_seq ON purchase_bill_tax_lines (purchase_bill_id, sequence)
- CREATE INDEX ix_pbill_tax_head ON purchase_bill_tax_lines (tax_head_id) WHERE tax_head_id IS NOT NULL
- CREATE INDEX ix_pbill_tax_parent ON purchase_bill_tax_lines (parent_line_id) WHERE parent_line_id IS NOT NULL

**Triggers**
- trg_pbill_tax_locked_parent BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_parent_bill_locked()
- trg_pbill_tax_rollup AFTER INSERT OR UPDATE OR DELETE -> fn_pbill_recalc_totals()
- trg_pbill_tax_lock_head AFTER INSERT -> fn_tax_head_mark_used() (only when tax_head_id IS NOT NULL)

### `purchase_bill_payments`  _(13 Purchase Bill)_

A payment Meshrd made against a supplier bill. Records the Meshrd account it left from and SNAPSHOTS the vendor's account it went into, so a historic payment still shows where it actually went after the vendor later changes their details (Purchase Bill 2.3; feeds Vendor Usage 2.3).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `purchase_bill_id` | CHAR(36) | NOT NULL REFERENCES purchase_bills(id) ON DELETE RESTRICT |  |
| `vendor_id` | CHAR(36) | NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT | Denormalised from the bill so Vendor Usage reads without a join through purchase_bills |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT |  |
| `amount` | DECIMAL(14,2) | NOT NULL CHECK (amount > 0) | Cannot exceed Balance Due — overpayment blocked outright by trigger, matching Invoice |
| `balance_due_at_entry` | DECIMAL(14,2) | NOT NULL | The read-only figure shown when the payment was recorded |
| `payment_mode_id` | CHAR(36) | NOT NULL REFERENCES payment_modes(id) ON DELETE RESTRICT | Full Masters 3.8 list |
| `paid_from_bank_account_id` | CHAR(36) | REFERENCES bank_accounts(id) ON DELETE RESTRICT | Which Meshrd account the money actually left. Defaults to the account named on the bill and STAYS EDITABLE. This is what fills the 'Paid From' column on Vendor Usage |
| `paid_into_account_name_snapshot` | TEXT |  | SNAPSHOT of the vendor's Bank Account NAME at payment time — read-only on the screen on purpose: a payment screen is the wrong place to change a supplier's account details. This is the evidence the money went to the right party at the time |
| `paid_into_bank_name_snapshot` | TEXT |  | SNAPSHOT |
| `paid_into_account_number_masked_snapshot` | TEXT |  | SNAPSHOT of the masked number — named first, numbered second |
| `paid_into_ifsc_snapshot` | TEXT |  | SNAPSHOT |
| `payment_date` | DATE | NOT NULL |  |
| `reference` | TEXT |  | Transaction ID or cheque number |
| `status` | payment_record_status | NOT NULL DEFAULT 'recorded' | ENUM ('recorded','reversed'). Tier 2 |
| `reversed_at` | DATETIME(6) |  |  |
| `reversed_by` | CHAR(36) | REFERENCES users(id) ON DELETE RESTRICT |  |
| `reversal_reason` | TEXT |  |  |
| `recorded_by` | CHAR(36) | NOT NULL REFERENCES users(id) ON DELETE RESTRICT |  |
| `recorded_at` | DATETIME(6) | NOT NULL DEFAULT now() |  |

**Indexes**
- CREATE INDEX ix_pbillpay_bill ON purchase_bill_payments (purchase_bill_id, payment_date DESC)
- CREATE INDEX ix_pbillpay_vendor ON purchase_bill_payments (vendor_id, payment_date DESC)
- CREATE INDEX ix_pbillpay_bank_account ON purchase_bill_payments (paid_from_bank_account_id, payment_date)
- CREATE INDEX ix_pbillpay_mode ON purchase_bill_payments (payment_mode_id)
- CREATE INDEX ix_pbillpay_fy ON purchase_bill_payments (financial_year_id)

**Triggers**
- trg_pbillpay_fy_lock BEFORE INSERT OR UPDATE OR DELETE -> fn_reject_if_fy_locked()
- trg_pbillpay_no_overpay BEFORE INSERT OR UPDATE -> fn_pbill_payment_reject_overpay() (spans rows)
- trg_pbillpay_status_guard BEFORE INSERT -> fn_pbill_payment_require_unpaid_or_part_paid() (never against an already-Paid bill)
- trg_pbillpay_require_attachment BEFORE INSERT -> fn_pbill_payment_require_attachment() (active only when the bill's attachment_required_before_payment_snapshot is true)
- trg_pbillpay_snapshot_vendor_account BEFORE INSERT -> fn_pbill_payment_snapshot_vendor_bank() (freezes the four paid_into_* fields from the vendor record)
- trg_pbillpay_apply AFTER INSERT OR UPDATE OR DELETE -> fn_pbill_apply_payment()

---

## Tax & Compliance (Module 13 §8) — added 2026-07-31

Two registers that are **never netted against each other**: the payable side is a liability owed to an
authority, the receivable side an asset claimable back. Separate tables, separate totals, by design.

### `withholding_remittance_periods`  _(13 §8.2)_

One row per (tax head x remittance period). Materialised rather than computed on the fly, because the period a withheld amount belongs to depends on the head's Anchored On setting, which locks after the first remittance.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT | Withholding-scope head |
| `period_label` | TEXT | NOT NULL | e.g. "Jul 2026" |
| `period_from` | DATE | NOT NULL |  |
| `period_to` | DATE | NOT NULL CHECK (period_to >= period_from) |  |
| `financial_year_id` | CHAR(36) | NOT NULL REFERENCES financial_years(id) ON DELETE RESTRICT | FY-locked |
| `due_date` | DATE | NOT NULL | period_to + head.remittance_due_days. Stored so a later policy change never rewrites a historical due DATE |
| `withheld_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from withholding_lines |
| `remitted_total` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> trigger from withholding_remittances, net of reversals |
| `outstanding` | DECIMAL(14,2) | GENERATED ALWAYS AS (withheld_total - remitted_total) STORED | DERIVED |
| `status` | TEXT | NOT NULL CHECK (status IN ('open','due_soon','overdue','part_remitted','remitted')) | Precedence: remitted -> overdue -> due_soon -> part_remitted -> open. A partly-remitted overdue period reads **overdue**, because that is the fact needing action |

**Indexes:** `UNIQUE (tax_head_id, period_from)`; `(due_date) WHERE outstanding > 0`.

### `withholding_lines`  _(13 §8.2b)_

One row per withheld amount, from either direction. The single source both registers aggregate from — built with a nullable source per direction so a THIRD source (payroll) can be added without restructuring.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `direction` | TEXT | NOT NULL CHECK (direction IN ('payable','receivable')) | payable = the company withheld and owes it onward (from a **vendor** OR an **employee**); receivable = a customer withheld from the company |
| `source` | TEXT | NOT NULL CHECK (source IN ('VENDOR','EMPLOYEE','CUSTOMER')) | **Added 2026-07-31 (C4).** Which of the three flows produced this line. Surfaced as a column on the register so a reader never has to infer whose money a figure represents |
| `purchase_bill_id` | CHAR(36) | REFERENCES purchase_bills(id) ON DELETE RESTRICT | Set when direction = payable |
| `invoice_payment_id` | CHAR(36) | REFERENCES invoice_payments(id) ON DELETE RESTRICT | Set when direction = receivable |
| `payslip_statutory_line_id` | CHAR(36) | REFERENCES payslip_statutory_lines(id) ON DELETE RESTRICT | **Added 2026-07-31 (C4).** Set when source = EMPLOYEE — salary TDS, PF, professional tax. This is the third source, and the reason the register moved out of Purchase Bill into its own module |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT |  |
| `period_id` | CHAR(36) | REFERENCES withholding_remittance_periods(id) ON DELETE RESTRICT | NULL while the anchoring date has not occurred yet — surfaced as an explicit "Unassigned" bucket, never silently dropped from the register |
| `calculated_on` | TEXT | NOT NULL CHECK (calculated_on IN ('SUBTOTAL','TOTAL')) |  |
| `withheld_amount` | DECIMAL(14,2) | NOT NULL CHECK (withheld_amount >= 0) |  |
| `head_name_snapshot` | TEXT | NOT NULL | SNAPSHOT at calculation time |
| `rate_snapshot` | DECIMAL(7,4) |  | SNAPSHOT |
| `remitted_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Payable side only. Part-allocation permitted, so an odd remittance figure can never force an untrue allocation |
| `certificate_id` | CHAR(36) | REFERENCES withholding_certificates(id) ON DELETE RESTRICT | Receivable side only |
| `credit_claimed_at` | DATE |  | Receivable side only. Only a certified line may be claimed |

**CHECK:** exactly one of `purchase_bill_id` / `invoice_payment_id` / `payslip_statutory_line_id` is non-null, and it must agree with `source` (VENDOR -> purchase bill, CUSTOMER -> invoice payment, EMPLOYEE -> payslip line).

### `withholding_remittances`  _(13 §8.3)_

One row per remittance actually handed to the authority. Immutable after save.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `remittance_code` | VARCHAR(191) | NOT NULL UNIQUE | From document_number_sequences |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT |  |
| `period_id` | CHAR(36) | NOT NULL REFERENCES withholding_remittance_periods(id) ON DELETE RESTRICT |  |
| `amount_remitted` | DECIMAL(14,2) | NOT NULL CHECK (amount_remitted <> 0) | Negative on a reversal |
| `paid_on` | DATE | NOT NULL CHECK (paid_on <= CURRENT_DATE) |  |
| `bank_account_id` | CHAR(36) | NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT |  |
| `payment_mode_id` | CHAR(36) | NOT NULL REFERENCES payment_modes(id) ON DELETE RESTRICT |  |
| `authority_reference` | TEXT | NOT NULL | Labelled at render time from the head's Authority Reference Label. **No jurisdiction vocabulary is hardcoded** |
| `attachment_file_path` | TEXT |  | The audit source document |
| `reverses_remittance_id` | CHAR(36) | REFERENCES withholding_remittances(id) ON DELETE RESTRICT | Set on a reversal; the original is never edited or deleted |
| `reversal_reason` | TEXT |  | Required when reverses_remittance_id is set |

**IMMUTABLE** — append-only, UPDATE/DELETE revoked. A wrong remittance is corrected by a negative-signed reversal referencing the original, the same principle a Credit Note applies to a locked invoice.

### `withholding_certificates`  _(13 §8.5)_

One row per certificate a customer issues evidencing what they withheld. Receivable side only.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `certificate_reference` | TEXT | NOT NULL | Unique per customer |
| `customer_id` | CHAR(36) | NOT NULL REFERENCES customers(id) ON DELETE RESTRICT |  |
| `certificate_date` | DATE | NOT NULL CHECK (certificate_date <= CURRENT_DATE) |  |
| `covered_from` | DATE | NOT NULL |  |
| `covered_to` | DATE | NOT NULL CHECK (covered_to >= covered_from) | Often a quarter, not a month |
| `tax_head_id` | CHAR(36) | NOT NULL REFERENCES tax_heads(id) ON DELETE RESTRICT |  |
| `stated_amount` | DECIMAL(14,2) | NOT NULL CHECK (stated_amount >= 0) | What the certificate itself says |
| `matched_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | DERIVED across rows -> sum of linked withholding_lines |
| `variance` | DECIMAL(14,2) | GENERATED ALWAYS AS (stated_amount - matched_amount) STORED | DERIVED |
| `status` | TEXT | NOT NULL CHECK (status IN ('matched','variance','voided')) |  |
| `attachment_file_path` | TEXT |  | The evidence the credit rests on |
| `void_reason` | TEXT |  | Required when status = voided; Super Admin only |

**The certified amount is what may be claimed, not our recorded figure** — the authority accepts the certificate, not an internal record. A non-zero `variance` is surfaced for investigation and never auto-corrected in either direction.

**UNIQUE:** `withholding_certificates (customer_id, certificate_reference)`.

