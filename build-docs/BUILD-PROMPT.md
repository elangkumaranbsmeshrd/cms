# Meshrd CMS — End-to-End Build Directive

**Status:** Approved for full development. Prototype phase closed 2026-07-31.
**Audience:** the engineering team and/or the AI agent building this system.
**This document is the entry point.** Read it fully before writing a line of code.

---

## 0. Mission

Build the **Meshrd Company Management System** — a single internal web application covering 15 business
modules, ~205 documented screens, 5 roles, and a fully dynamic configuration layer — as a production system.

This is **not a greenfield design exercise.** The system has already been specified in complete detail and
proven end-to-end as a clickable prototype. Your job is to re-platform a validated design onto a real stack
with a real database, real authorization, and real persistence. Almost every design question you are about
to ask has already been answered — in writing — by the documents listed below. **Find the answer before
inventing one.**

---

## 1. Inputs, and the source-of-truth hierarchy

When two sources disagree, the one higher in this list wins. Do not silently resolve a conflict — surface it.

| Rank | Source | What it is authoritative for |
|---|---|---|
| 1 | **`01-…` … `15-…-module.md`** (15 files, ~660 KB) | Every screen, every field, every workflow, every role rule. **The specification.** Module 15 (Tax & Compliance) was added 2026-07-31; the original 14 are not renumbered |
| 2 | **`build-docs/APPENDIX-A-approved-decisions.md`** (285 items) | Decisions the client has explicitly approved. See §2. |
| 3 | **`build-docs/APPENDIX-B-business-rules.md`** (603 rules) | Formulas, cutoffs, sequencing locks, status transitions. |
| 4 | **This document** | Stack, architecture, conventions, phasing, definition of done. |
| 5 | **`build-docs/ARCH-1` … `ARCH-3`** | Concrete schema/backend/frontend/deployment designs. Follow unless the spec contradicts them. |
| 6 | **`prototype/`** (working, `?v=49`) + **`ARCH-0-prototype-inventory.md`** | Interaction design, screen shapes, design tokens, and the RBAC policy tables in their validated form. |

**The prototype is a reference, not a codebase.** Do not port its JavaScript. Do port its *decisions*: the
screen registry, the RBAC policy tables, the eight repeating screen shapes, and the design tokens. Its
`app-rbac.js` POLICY/ACTIONS/TOGGLES tables are a working authorization matrix — transcribe them as seed data.

---

## 2. The 285 approved decisions — do not skip, do not re-litigate

Every module document ends in an **"Assumptions & Points to Confirm"** section. Across the 15 documents there
are **285 such items**. As of 2026-07-31 the client has **approved all of them**.

They are consolidated, renumbered `A001`–`A285`, and restated as imperative build requirements in
**`APPENDIX-A-approved-decisions.md`**.

**Treat every item as a signed-off requirement.** These are not open questions, not suggestions, and not
"nice to have". Several of them are the *only* place a specific behaviour is defined — for example:

- **A115** fixes the unpaid-leave formula exactly: `(Gross Pay ÷ Total Days in Month) × Unpaid Leave Days`.
- **A116** fixes payroll re-run skipping at **employee+month** granularity, not whole-month — and states that
  a Draft run must *not* trigger the skip, only Processed.
- **A002** states there is **no unlock action for a locked Financial Year anywhere in this version**.
- **A009** requires a "Confirm Account Number" field that must match but **must not be stored**.

Skipping the appendix means silently dropping ~285 requirements. Work through it module by module and treat
each item as an acceptance criterion.

**Three kinds of item live in there — read the flag, not just the text:**

- **Positive requirements** — build this, this way. The majority.
- **Negative requirements** — *do not* build a thing, deliberately. These matter as much as the positive
  ones, because a well-meaning developer will otherwise add them back. Examples: **A002** (no FY unlock),
  **A026** (do not recreate the four deleted statutory sub-masters), **A201** (Expense gets no auto-generated
  code — it is an internal claim, never shared outside the company), **A044** (Recent Sends is a
  troubleshooting log, not a volume report).
- **Historical context** — 49 items marked `_[resolved-historical]_` and 17 marked `_[superseded]_`. These
  record decisions already settled during grooming. They are **not new work**; they exist so you understand
  why something is the way it is and don't "fix" it back.

**Two items moved after this appendix was first compiled — read §4a before relying on either:**

- **A276** (withholding tax on vendor payments) was the one item still flagged as deferred. It has since
  been confirmed in use, specified, and built in both directions. See §4a/C2.
- **A019** (exactly seven tax scopes; do not build withholding) is **superseded** by A276 — the two
  contradicted each other. See §4a/C3 for the resolution and for the part of A019 that still binds.

Every other item stands as written.

---

## 3. Stack — locked, not up for discussion

| Layer | Technology | Notes |
|---|---|---|
| Frontend | **Angular** (latest, standalone components + signals) | TypeScript `strict`. No NgRx — see `ARCH-3` §2. |
| Backend | **FastAPI** (Python 3.12) | SQLAlchemy 2.x async, Alembic, Pydantic v2. |
| Database | **MySQL 8.0.16+ / MariaDB 10.5+** | InnoDB, utf8mb4. See §5 and `ARCH-1` D0. |
| Email | **Mailgun** | Driven by the Email Configuration master, not by env vars alone. See §9. |
| Hosting | **DigitalOcean droplet** (single) | nginx + gunicorn/uvicorn + MySQL co-located. See §12. |
| File storage | **Local filesystem on the droplet** | Content-addressed, served only through an authorizing endpoint. See §10. |

**Deliberate consequences of a single droplet**, which you must design for rather than discover:
- MySQL shares CPU and RAM with the app. Size accordingly (`ARCH-3` §9.1) and set an explicit exit
  criterion for moving to DigitalOcean Managed MySQL.
- Local file storage means **backups must cover both the database and the file tree**, and the droplet is a
  single point of failure. Automate both backups from day one, encrypted, off-box.
- No horizontal scaling. Background work runs on the same box — keep it out of the request path anyway.

---

## 4. The twelve invariants

If any of these is violated, the build is wrong regardless of how much works. They come directly from the
specifications, which state each of them emphatically and repeatedly.

1. **No statutory item is ever hardcoded.** There is no PF column, no ESI column, no professional-tax
   column, no income-tax-slab table, no regime flag — anywhere in the schema or the code. A tax is a row in
   `tax_heads` describing *behaviour*: scope, calculation method, rate/amount, slab bands, split components,
   effective dating. Four sub-masters were deliberately deleted to make this true, because **nobody has
   confirmed which statutory items this company is actually liable for.** Reintroducing any named statutory
   item as a column or table is a regression.

   **One deliberate exception, decided 2026-07-31 and now unambiguous in the spec:** `Tax Type` includes
   `GST — IGST` and `GST — CGST + SGST` as built-in structural options with their own rate fields, because
   interstate-vs-intrastate is the most frequent decision on that screen and shouldn't require understanding
   component splits. Naming those two types assumes no rate, no threshold and no liability. See §4a/C1.

2. **The API is the authority on permissions.** The prototype enforced RBAC client-side; that is UX only.
   Every one of the four layers must be enforced server-side, on every endpoint. See §6.

3. **Derived values are never typed in.** Any figure the spec describes as computed — net hours, current
   asset value, leave remaining, invoice balance, gross/net pay — is rendered read-only and calculated,
   never accepted from the client.

4. **A locked Financial Year freezes everything dated inside it, for everyone — including Super Admin.**
   Enforced in the database, not only the API. There is no unlock (**A002**).

5. **Role scope is applied before filters, always.** Filters narrow what a role can already see and never
   widen it. This is what makes universal filter access safe (RBAC §2.2).

6. **Every list screen carries the same baseline filter set, and export returns exactly the filtered set**
   with a header block naming the filters applied. One implementation, inherited by ~51 list screens.

7. **Money is `DECIMAL(14,2)`. Hours are `DECIMAL(6,2)`.** Never `FLOAT`/`DOUBLE`. Half-day counts are
   `DECIMAL(5,2)` with a `CHECK` that they land on a half. **MySQL 8.0.16+ is the floor** — earlier versions
   parse `CHECK` and silently ignore it, and this schema leans on them heavily.

8. **Money reads left-aligned; non-money figures read right-aligned.** Enforced in exactly one place in the
   frontend, not per table (RBAC §2.2 c-i). Counts, hours, percentages and ageing stay right.

9. **Masters records are never hard-deleted once referenced.** Active/Inactive only. Deactivation removes an
   option from future dropdowns and never rewrites history.

10. **Historical documents reproduce exactly.** Every calculated tax line snapshots the head's name, label,
    rate and computed base at calculation time. Editing a tax head must never change a payslip already issued.

11. **Sequenced workflows are gated in data, not in prose.** The exit checklist is the reference case:
    resignation letter → return **all** assets → only then settlement / disable login / mark Exited. The gate
    is modelled and enforced; it is not a UI suggestion.

12. **Disabling an email template silences the email only.** The in-app notification for that same event
    still fires. Email delivery and event notification are separate concerns.

---

## 4a. Spec conflicts — all three resolved 2026-07-31

Three contradictions were found: two while generating the schema, a third while building the fix for the
second. All have been decided by the client and written back into the module documents. **None blocks a
phase.** Recorded here because the resolutions are load-bearing and a future reader will otherwise re-open
them.

### C1 — GST stays a built-in Tax Type ✅ RESOLVED

Masters §3.2 previously stated two incompatible things 28 lines apart: its **Fields Table** defined
`GST — IGST` and `GST — CGST + SGST` as Tax Types with their own CGST/SGST rate fields, while its **Split
Components** section claimed those named fields had been *replaced* and the spec no longer needed to know
the words CGST, SGST or IGST.

**Decision: the Fields Table wins. GST stays built in.** Setting up 18% intrastate GST means choosing
`GST — CGST + SGST` and entering 9 and 9 — it does not require understanding component splits. Invoice and
HSN/SAC both depend on the interstate-vs-intrastate distinction being explicit, and the prototype has always
worked this way.

**Split Components remain**, as the general mechanism for any *other* tax carrying one headline rate that
must be reported as separately-named parts. They are optional on any head, and they are not how GST is
configured. The stale "why this replaces" paragraph in `01-masters-module.md` §3.2 has been rewritten to say
exactly this.

`ARCH-1`'s `tax_heads.cgst_rate_pct` / `sgst_rate_pct` / `tax_type IN ('GST_IGST','GST_CGST_SGST', …)` are
therefore **correct as generated** — build them as they stand.

The narrower principle that still holds absolutely, and is what Invariant 1 actually protects: **which
statutory items this company is liable for is never hardcoded.** Two structural GST types on a dropdown
assume no rate, no threshold and no liability. Income Tax Slabs, PF & ESI Rates, Professional Tax Slabs and
Old Regime Deduction Limits were deleted as sub-masters for that reason and must not return.

### C4 — Payroll TDS brought in scope; register promoted to Module 15 ✅ RESOLVED

Decided 2026-07-31, hours after C2. The client confirmed the company **also deducts tax from salaries** —
which is the exact condition both dissenting design judges named as flipping the placement decision.

**What changed:**

- The withholding register was promoted out of Purchase Bill §8 into its own module,
  **`15-tax-compliance-module.md`**. Its §1.1 records the five-point test it passes and Daily Task did not:
  it owns a document nothing else can (a remittance), its counterparty is a **fourth party** this CMS models
  nowhere else (a tax authority, owed money that came from vendors, employees *and* customers at once), two
  modules independently declined to host it, its deadline is legal rather than commercial, and **it has an
  off switch**.
- **The three withholding scopes collapsed back to one** — `Withholding / Deduction at Source` — with
  direction as a *field* on the head. The same statutory provision usually governs both directions; three
  scopes forced either duplicate records or a third scope that existed only to say "both".
- **A new gate, `Creates an Onward Liability`, is available on EVERY scope.** This is the load-bearing idea:
  a payroll deduction is the same "held on someone's behalf, owed onward" pattern as a supplier withholding,
  so a payroll head simply turns the toggle on and joins the same register. No machinery is duplicated inside
  Payroll.
- **Payroll obligation periods align to the Pay Cycle (26th–25th), not calendar months** — set per head via
  *Period Aligns To*. A payroll period on calendar months would disagree with the payslips that produced it.
- **The whole module is hidden** unless at least one head has the gate on — the same convention Tax Schemes
  already uses. A company that holds nobody's money pays zero screens for this.

**Still deliberately out of scope** (Module 15 §7): interest/penalty computation on a late remittance,
filing returns or integrating with any authority's systems, employee-facing annual tax certificates (an
obligation to *issue*, which belongs with Payroll's document generation), and the company's own income-tax
liability.

### C3 — A019 vs A276: the appendix contradicted itself ✅ RESOLVED

Found 2026-07-31 while building C2. **Two approved decisions directly contradicted each other**, and the
build docs shipped both as consistent:

- **A019** — "Build exactly SEVEN Scope options. Do NOT build *Withholding / Deduction at Source on
  Payments*."
- **A276** — "The tax master *has* a Withholding scope… if the company withholds, a field is required."

A276 was written before the 2026-07-30 scope removal and never updated. The Purchase Bill withholding field
built on 2026-07-31 therefore pointed at a scope that **did not exist in Masters**.

**Resolved in favour of A276, using A019's own escape clause:** *"a genuinely new **attachment point** may
become an eighth option; a new **tax** never may."* Withholding is an attachment point — money deducted
*from a payment* and owed onward to a third party who is neither the customer, the supplier, nor the
employee. It is not a tax. Masters §3.2 now carries **ten** scopes: the original seven plus *Withholding —
On Payments Made*, *On Receipts Collected*, and *On Payments & Receipts*.

**What still binds from A019, and must not be undone:** do not recreate Income Tax Slabs, PF & ESI Rates,
Professional Tax Slabs or Old Regime Deduction Limits as sub-masters; keep *Sales / Billing & Purchase*.
No rate, threshold or named statutory item appears in the Scope list.

**The lesson, worth carrying into the build:** the appendix is 285 items written across many sittings, and
at least one pair contradicted. When an item asserts that something *exists*, verify it against the live
spec before building on it — A276's claim was simply out of date.

### C2 — Withholding tax: confirmed in use, now specified and built ✅ RESOLVED

**A276.** The tax master had a `Withholding / Deduction at Source on Payments` scope with nowhere to apply
it. **The company has confirmed it does withhold from supplier payments.** Purchase Bill §2.2 now specifies
four fields — Withholding Tax, Withholding Calculated On, Withholding Amount, and the derived Amount Payable
to Vendor — and §2.3 specifies the payment behaviour. Implemented in the prototype at `?v=46`.

**The four rules, because getting the direction wrong misstates both what the supplier is owed and what the
company owes the authority:**

1. **Withholding is deducted from the payment, never added to the bill.** Total is the vendor's claim and
   does not change. This is the *opposite* of how Tax Amount behaves.
2. **A payment can never exceed Amount Payable to Vendor** (Total − Withholding), not Total.
3. **The bill reaches Paid when `payments + withholding = Total`.** Comparing payments to Total alone would
   strand every withheld bill at Part-Paid forever and permanently overstate payables.
4. **The withheld amount is a liability to the authority, not to the vendor.** Vendor Usage shows the gross
   billed figure; the net paid figure lives on the payment record.

**Superseded within the day — remittance tracking IS built.** The client then confirmed payroll withholding
is also in scope, which is the condition both dissenting judges named as flipping the design. The register
was promoted out of Purchase Bill into **Module 15 — Tax & Compliance** (`15-tax-compliance-module.md`),
carrying all three sources: vendor withholding, payroll deductions, and customer-side credits. Masters gained
a **Creates an Onward Liability** gate available on *every* scope — which is how a payroll head joins the
same register without duplicating any machinery — and the three withholding scopes collapsed back to **one**
with a Direction field. See §4a/C4.

---

## 5. Data layer

Full schema in **`ARCH-1-database-schema.md`** — ~88 tables. Conventions, applied everywhere:

- **Audit mixin on every table:** `id uuid PK DEFAULT gen_random_uuid()`, `created_at`, `updated_at`,
  `created_by`, `updated_by`.
- **Immutable logs** (append-only, enforced by trigger): permission changes, email sends, asset assignment
  history, ticket assignment history, payslip reissues, leave balance adjustments, customer/opportunity
  activities, work-item comments.
- **Three deletion tiers, not one blanket flag:** never-deleted-once-used (masters) → `is_active` + reference
  guard; status-driven lifecycle → status column, no deletion; genuinely deletable while unreferenced → real
  `DELETE`.
- **Foreign keys to masters are `ON DELETE RESTRICT`.** "Active only" is a dropdown query concern.
- **Document numbering is not an AUTO_INCREMENT.** It cannot reset per financial year or honour the
  starting-number immutability rule. Use
  `document_number_sequences` keyed by `(code_type, financial_year_id)`, allocated `SELECT … FOR UPDATE`
  inside the creating transaction. Store the full rendered code on the record.
  Format and per-type config live in Masters §3.6e and are **editable by Super Admin** — prefix, digit count,
  whether the FY is included, and whether the series resets each year. `Starting Number` becomes immutable
  once any code of that type exists.
- **`JSON` columns in six places only**, each justified: tax head behaviour, ad-hoc adjustment metadata, email
  template placeholder sets, permission-change before/after payloads, report filter snapshots, appearance
  settings. Not an escape hatch.
- **"Only one X" rules stay database-enforced** — one current FY, one primary address, one default bank
  account. MySQL has no partial indexes, so each uses a **stored generated column that is the key when the
  condition holds and `NULL` otherwise**, with a plain `UNIQUE` on it (`ARCH-1` D0.1). Still the database, not
  application code.
- **Single-tenant by design.** Company Profile is an enforced singleton; there is no `tenant_id` to forget.
- **Two things MySQL cannot do declaratively, and both are load-bearing:** overlapping-period prevention
  (salary structures, pay cycles, pending leave) needs a trigger *plus* a service-layer `SELECT … FOR UPDATE`
  check — see `ARCH-1` D0.2; and trigram search does not exist, so list-screen search splits into `FULLTEXT`
  for prose and indexed prefix `LIKE` for document codes — see `ARCH-1` D0.4. **Implement search once in the
  shared list layer**, or 51 screens will each invent their own semantics.

---

## 6. RBAC — the backbone, and the highest-risk part of this build

Module 14 defines **four layers**. All four are real, all four are server-enforced, and each is independently
configurable per `(role, screen)` with per-user overrides on top.

| Layer | Controls | Enforcement |
|---|---|---|
| **L1** Screen visibility | Is this screen visible at all | Route guard (UX) + endpoint dependency (authority). Hidden means *absent* — no greyed menu item, no reachable URL. |
| **L2** Action permission | Which actions on a visible screen | Per-action check before the handler runs. |
| **L3** Field sensitivity | show / mask / hide, per field | Applied during response serialization, so a renderer that forgets cannot leak. |
| **L4** Data scope | all / team / own | Injected into the query **before** any filter. |

**Plus the override layer:** Super Admin can grant or revoke one permission for one person without changing
their role for anyone else — across all four layers.

Required implementation properties:

- **Policy is data; the screen registry is code.** Screens, actions and sensitive fields are declared in code
  (so they can be typo-checked and exhaustively tested); who may do what is rows in the database.
- **One resolved `PermissionSet` per user**, cached against an epoch that busts on any permission change.
- **A test that asserts no repository method can run unscoped.** Layer 4 is the layer that silently leaks
  other people's data; a forgotten scope must fail a test, not reach production.
- **An exhaustive matrix test**: every (role × screen) pair renders and returns exactly the expected access
  mode. The prototype has this at 28 assertions and 400 render checks — the real system should have it at
  full cardinality.
- **`permission_change_log` is immutable** and records who, when, before, after.
- **~47 named feature toggles** with their spec-defined defaults, seeded (RBAC §2.1).

Seed the whole thing from the prototype's `app-rbac.js` — POLICY, ACTIONS, FIELDS and TOGGLES are already a
validated matrix covering all 161 built screens.

---

## 7. The shared list contract

~51 screens are lists. Build the contract **once**; every list inherits it.

Baseline filters on every list (unless the dimension genuinely doesn't exist): free-text search over that
screen's identifying fields; date range with financial-year presets read from Masters; multi-select status;
owner/assigned-to/created-by; active/inactive defaulting to active with an explicit "include inactive".

Fixed application order — **scope → filters → search → sort → paginate**. Scope is never optional.

Response envelope carries rows, total, applied-filter description, and the page window. Empty results must
state *which filters caused it* — "No records found" alone is not acceptable on a filtered screen.

Export returns **exactly** the filtered set, in the same column visibility the requesting role sees, with a
header block naming the filters, the result count, who exported, and when. A Manager who cannot see Purchase
Value exports without Purchase Value — the export inherits masking automatically, it does not re-derive it.

---

## 8. The two calculation engines

These carry the financial correctness of the system. Build them as isolated, heavily unit-tested services
with no HTTP or ORM coupling, then wire them in.

### 8.1 Tax engine
Driven entirely by configured heads. Inputs: a base amount, a date, a scope, an employee/document context.
Behaviour comes from the head — percentage / fixed / slab / split — plus effective dating. Must support slab
bands, split components, and reproduce a historical calculation exactly from the snapshot stored on the line.
**No named tax may appear in this code.**

### 8.2 Payroll engine (hour-basis)
Reads Work Week & Hours policies to derive Required Hours; reads attendance to derive Worked Hours; converts
uncompensated shortfall to Loss of Pay per the configured rule.

The **pay cycle is not the calendar month** — default 26th→25th, configurable. Anything dated after the cycle's
End Day rolls into the *next* period and is never lost. Salary Credit Day is a separate field from End Day and
is always later (clamped to a real last-day for short months). The worked example in Payroll §3.1b —
a paid leave on 27-07-2026 landing on the August payslip, not July's — is a required test case.

---

## 9. Email — Mailgun, driven by Masters

Masters §3.21 defines an **Email Configuration** sub-master with two distinct halves:

- **Server Settings** — one record (provider, host/port/encryption or API key, credentials, From Name/Email,
  Reply-To, plus a master *Sending Enabled* switch). Super Admin only; credentials never displayed once saved.
- **Email Templates** — a real list, one row per trigger (16 seeded), each independently switchable with an
  editable subject and body supporting per-trigger placeholders.

Requirements: render placeholders safely (never `str.format` on user-supplied templates — a crafted template
must not be able to reach object internals); log every send to `email_send_log`; and honour Invariant 12 —
**a disabled template stops the email, never the in-app notification.**

Mailgun is the transport behind the "Provider" setting, not a hardcoded client scattered through the modules.

---

## 10. Files and documents

- **Storage:** content-addressed blobs on the droplet's local filesystem, referenced by an `attachments`
  table. Validate type and size on upload; deduplicate by hash.
- **Serving:** never expose the file tree. Every download goes through an endpoint that re-checks
  authorization for that specific record. An asset photo is only visible to someone who may see the asset.
- **Backups cover the file tree as well as the database.** Local storage on a single droplet makes this
  non-optional.
- **PDF generation** (invoices, payslips, credit notes, salary certificates, offer/appointment letters) runs
  as a background job using the Company Profile letterhead and templates, not inline in a request.

---

## 11. Frontend

Full design in **`ARCH-3`**. The essentials:

- **Eight repeating screen shapes** carry almost all ~196 screens: list-with-filters, form,
  record-with-tabs, board, report, calendar, document, payslip. Build each as a config-driven component —
  the prototype proved this works and `ARCH-3` §3 gives the TypeScript interfaces.
- **State:** Angular signals plus three root stores (session/permissions, masters cache, UI preferences).
  No NgRx — the justification is in `ARCH-3` §2 and the shape of this app doesn't earn it.
- **Client RBAC is UX only.** Route guards for L1, structural directives for L2/L3. Say so in the code
  comments so nobody mistakes it for security.
- **Design system:** carry over the prototype's tokens — IBM Plex Sans/Mono, graphite sidebar, hairline
  rules, 13px base, dense tables, light+dark. Preserve the two runtime settings that already exist:
  the accent system (6 presets **plus a free colour picker** that derives a four-colour ramp from one hex,
  re-derived per theme) and **display scale** (80–200%, default 110%).
- **Money alignment lives in exactly one place** (Invariant 8). It drifted three times during prototyping
  precisely because it was per-column; do not repeat that.

---

## 12. Deployment — single DigitalOcean droplet

Full runbook in **`ARCH-3` §9**. Non-obvious points that will bite otherwise:

- **`preload_app` must stay `False` in gunicorn.** With it `True`, `systemctl reload` re-forks workers from
  the already-loaded parent and your new code is silently never picked up — the deploy appears to succeed and
  changes nothing.
- nginx serves the Angular build and reverse-proxies FastAPI; assets pre-compressed at build time.
- TLS via certbot, with the renewal timer **verified before** enabling HSTS.
- MySQL on the droplet, with a written exit criterion for moving to DigitalOcean Managed MySQL.
- Encrypted, off-box, automated backups of **both** the database and the file tree, with a restore drill.
- Deploy script must be idempotent, atomic, and self-rolling-back.

---

## 13. Phased delivery

Each phase has an acceptance gate. Do not start the next phase until the gate passes.

| Phase | Scope | Gate |
|---|---|---|
| **0 — Foundation** | Auth, users, roles, the four-layer RBAC engine, financial years, numbering, audit mixin, migrations, CI | The exhaustive (role × screen) matrix test passes; the "no unscoped query" test passes; a locked FY genuinely blocks a write at the database level |
| **1 — Masters** | All 21 sub-masters incl. the dynamic tax engine, Work Week & Hours + Pay Cycle, Company Profile, Email Configuration | Tax engine unit tests green incl. slabs, splits, effective dating and historical reproduction; no named tax exists anywhere in the codebase |
| **2 — Employee + Leave** | Employee master, salary structure, attendance, documents, onboarding/offboarding, leave + compensatory hours | Exit checklist gating enforced in data; leave working-day math matches the Saturday pattern and mandatory holidays |
| **3 — Payroll** | Hour-basis engine, runs, payslips, ad-hoc adjustments, reissue, salary certificates | The 27-07-2026 carryover case passes; **A115** formula is the only unpaid-leave formula in the codebase; **A116** skip granularity verified |
| **4 — Finance** | Invoice, Credit Note, Purchase Bill, Expense (incl. Company Expenses), Vendor | Invoice locks on Paid; expense ↔ purchase-bill link prevents double payment; bank-statement export reconciles |
| **5 — Operations** | Customer, Opportunity, Project, Ticket, Asset Management | Straight-line depreciation derived not stored; asset reclaim feeds the exit checklist |
| **6 — Cross-cutting** | PDF generation, Mailgun wiring, notifications, dashboards, reports, exports everywhere | Every list exports the filtered set with masking intact |
| **7 — Hardening** | Backups + restore drill, monitoring, logs, load check, security review, UAT | Restore from backup verified on a clean droplet |

---

## 14. Definition of done, per module

A module is not done until **all** of these hold:

1. Every screen in its spec exists and renders for every role that should see it.
2. Every field in every Fields Table is present, with the stated type, mandatory flag and validation.
   Derived fields render read-only. *A field described only in a hint or a paragraph does not count as built.*
3. Its workflows execute end-to-end, including the failure and rejection paths.
4. Its RBAC rows are seeded; the matrix test covers it; field masking verified for every restricted role.
5. Its list screens carry the baseline filters and export the filtered set with masking intact.
6. Every applicable item in **Appendix A** is implemented, and every rule in **Appendix B** for that module
   has a test or an explicit note explaining why it needs none.
7. Its calculation logic has unit tests at the boundary values, not just the happy path.
8. Its spec `.md` file has been updated if the build revealed anything the spec got wrong. **The 14 module
   documents are living documents and remain the source of truth after launch, not just during it.**

---

## 15. Traps this project has already fallen into

Learn these for free rather than rediscovering them.

- **A checker that never reports a problem proves nothing.** During prototyping, two separate verification
  scripts reported "clean" while the defect they were built to catch was plainly present — once from a regex
  that silently skipped a whole class of markup, once from a shared `/g` regex leaking `lastIndex` between
  calls. Every quality gate you build must first be shown to *fail* on a known-bad input.
- **Sequential find-and-replace during renumbering double-shifts.** Renumbering spec sections with two
  passes (`3.17→3.18`, then `3.18→3.19`) re-shifts what the first pass produced. Use context-anchored edits.
- **Removing a field is not the same as removing it from a menu.** "Remove X from Masters" was once read as
  "remove X entirely", deleting both the sub-master and the field it fed — and leaving a header still
  referencing the now-missing field, silently rendering `undefined`. When removing anything, grep every
  *read* of it, not just its definition.
- **A "dynamic-looking" field that stores a hardcoded string is a dead end.** Several fields (HSN linked tax,
  default billing tax) looked configured but held generic labels pointing at nothing. If a field claims to
  reference a master, it must hold a real foreign key.
- **A masked identifier answers nothing on its own.** Showing `HDFC ••••2201` without the account *name* gives
  a human nothing to verify against. Name first, number second.
- **Declarative config defaults to permissive.** A table row-action with no `roles` array showed to every
  role — including Employees seeing an "Approve" button. Any new declarative permission surface needs an
  explicit deny-by-default.

---

## 16. Where to start

1. Read this document, then `APPENDIX-A`, then `14-rbac-module.md` in full. RBAC shapes everything else.
2. Stand up the repo, CI, migrations, and the Phase 0 foundation.
3. Build the RBAC matrix test **before** the screens it will police.
4. Then Masters, because every other module reads from it.

Ask before inventing. The answer is almost certainly already written down.
