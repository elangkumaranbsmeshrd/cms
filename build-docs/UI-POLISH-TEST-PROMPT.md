# Meshrd CMS — Complete UI Test & Polish Prompt

**Goal: every button, every field, every control — present, working, correctly styled, correctly labelled,
consistent across all 168 screens and all 5 roles. No missing controls, no dead controls, no unstyled
elements, no inconsistency.**

---

## 0. THE RULE THAT OVERRIDES EVERYTHING ELSE

**The prototype is authoritative for VISUAL DESIGN ONLY. The `.md` specs are authoritative for CONTENT.**

The prototype was built with hardcoded demo data and hardcoded role behaviour. **It shows HR-only fields on
an Employee's screen, and other role leakage of the same kind.** It is a design mockup, not a permission
model. Copying its field visibility would build permission bugs on purpose.

| Question | Ask | Never ask |
|---|---|---|
| What does a button look like? Where does it sit? | **Prototype** | — |
| Spacing, colour, radius, shadow, font, icon | **Prototype** | — |
| Which fields exist on this screen? | **`.md` spec (Fields Table)** | ~~Prototype~~ |
| **Which role sees which field?** | **`.md` spec §6 + `app-rbac.js` POLICY/FIELDS tables** | ~~Prototype's rendered output~~ |
| Field label, hint, mandatory flag, validation | **`.md` spec** | ~~Prototype~~ |
| Which actions exist, and who can perform them | **`.md` spec §6** | ~~Prototype~~ |

**Concretely: if the prototype renders a Salary Structure field while signed in as Employee, that is a
prototype defect, not a requirement.** Build what the spec says; borrow only how it looks.

---

## 1. Confirmed defects — found by inspection, fix these first

### 1a. `.formbar` is used but never defined — an unstyled component in production

`frontend/src/app/features/masters/screens/holidays-import.component.ts` uses `class="formbar"`.
**No built CSS file defines `.formbar`** — it exists in `prototype/app.css` and was never ported.
Result: that screen's button bar renders with **no styling at all**.

**This is the highest-value class of bug in this document**, because it is invisible in code review and
obvious to a user. Find every instance:

```bash
# every class used in templates
grep -rhoE 'class="[^"]+"' frontend/src/app --include=*.ts \
  | sed 's/class="//;s/"//' | tr ' ' '\n' | sort -u > /tmp/used.txt
# every class defined in styles
grep -rhoE '^\.[a-z][a-z0-9_-]*' frontend/src/styles/*.css | sed 's/^\.//' | sort -u > /tmp/defined.txt
# used but never defined
comm -23 /tmp/used.txt /tmp/defined.txt
```

**Every line that command prints is an unstyled element.** Fix by porting the rule from `prototype/app.css`.

### 1b. Prototype CSS classes never ported

Present in `prototype/app.css`, absent from `frontend/src/styles/`:

`.formbar` · `.row-actions` · `.field-lock` · `.form-grid` · `.kbd` · `.soon` · `.unread` · `.ocard` ·
`.pcol-head` · `.pipe` · `.login-modules` · `.login-role` · `.login-roles`

Some are genuinely unused today and can stay unported — but **check each one against the screen that would
need it** before dismissing it. Specifically:

- **`.row-actions`** — the container for Edit/Deactivate buttons on every table row. If row actions render
  without it, they are unaligned on every list screen in the app.
- **`.field-lock`** — the lock indicator on derived/read-only fields. The spec requires derived values to
  render read-only **with a lock affordance and a hint**; without this class there is no lock affordance.
- **`.kbd`** — the `Ctrl K` hint in the global search box.
- **`.unread`** — the unread state on notifications.
- **`.soon`** — "Coming Soon" styling (Attendance §2.5, Biometric).

### 1c. Design tokens — verified healthy, do not rewrite

35 tokens in the prototype, 37 in the build (it added `--font-sans`, `--font-mono`). **The token layer is
correct and complete.** Do not "fix" it. Every polish fix below must use these tokens — **no raw hex, no
raw px for spacing, no hardcoded font stacks anywhere in a component.**

---

## 2. BUTTONS — complete test spec

### 2a. Every button must satisfy all of these

| # | Check | Fail condition |
|---|---|---|
| 1 | **Exists** where the spec says | Spec lists an action; no button renders |
| 2 | **Does something** | Click produces no navigation, no request, no dialog, no state change |
| 3 | **Correct label** — matches the spec's wording exactly | "Add" where spec says "+ Add Financial Year" |
| 4 | **Correct variant** — primary / secondary / ghost / danger | Two primaries competing on one screen |
| 5 | **Correct position** — per §3 layout order | Page action in the filter bar, or vice-versa |
| 6 | **Icon** where the prototype has one, same icon, same size | Missing or mismatched icon |
| 7 | **Disabled state** styled and explained | Greyed with no tooltip reason |
| 8 | **Loading state** on any async action | Double-submit possible |
| 9 | **RBAC-gated** per spec §6 | Visible to a role that must not have it |
| 10 | **Delete never visible** to non-Super-Admin | Any delete control for other roles |
| 11 | **Destructive → confirm dialog** naming the consequence | Immediate action, or a bare "Are you sure?" |
| 12 | **Keyboard reachable**, visible focus ring, Enter/Space activates | Tab skips it, or no focus indicator |
| 13 | **Hover / active / focus** states all defined | No visual feedback |
| 14 | **Not duplicated** | The export-pair bug: same action twice on one screen |

### 2b. Buttons that must exist on specific screen types

- **Every list screen:** `+ Add <Noun>` (primary) · Export PDF · Export Excel · **exactly one export pair**
- **Every row (where spec allows):** Edit · Deactivate/Delete (Super Admin only)
- **Every form:** Save (primary) · Cancel (**must navigate back, not toast**) · Back
- **Every record screen:** Edit · Save/Cancel while editing · Back · breadcrumbs
- **Every tabbed screen:** each tab's own action inside that tab, **below its content** — never in the page header
- **Topbar:** sidebar collapse · notifications bell (+ unread count) · theme toggle · role/profile menu
- **Empty states:** the action that resolves the emptiness ("Add the first tax head")

### 2c. Automated button sweep

For every screen × every role:
```
1. Enumerate every <button> and clickable control
2. Assert each has: non-empty accessible name, correct variant class, enabled or disabled-with-reason
3. Click each non-destructive one → assert SOMETHING happened
   (URL change | network request | dialog | toast | DOM change)
4. Assert zero console errors
5. Assert no duplicate accessible names within one screen region
```
**A control that does nothing is a bug, not a placeholder.** Either wire it or remove it.

---

## 3. TEXT FIELDS & FORM CONTROLS — complete test spec

### 3a. Every field, every type

| # | Check |
|---|---|
| 1 | **Exists** — every row of the spec's Fields Table is a **rendered field**. A hint or prose mention does **not** count |
| 2 | **Label** exactly as the spec words it |
| 3 | **Mandatory marker** (`*`) matches the spec's Y/N |
| 4 | **Correct input type** — number/date/select/toggle/textarea/file, not everything as text |
| 5 | **Placeholder** present and useful; never a duplicate of the label |
| 6 | **Hint text** where the spec carries a rule (e.g. *"Starting Number locks once any code has been generated"*) |
| 7 | **Validation fires** — required, min/max, pattern, length |
| 8 | **Error message** is specific and sits next to the field, not a page-level blob |
| 9 | **Derived/read-only fields** render read-only **with a lock affordance and a hint explaining the derivation** (`.field-lock`) |
| 10 | **Conditional fields** (`visibleWhen`) appear and disappear correctly on every branch |
| 11 | **Dropdown options** match the spec's `opts` list exactly — none dropped |
| 12 | **Dropdowns fed from Masters** are live, never hardcoded |
| 13 | **Field-level RBAC** — hidden / read-only / masked per role, per the spec (**not per the prototype**) |
| 14 | **Tab order** follows visual order |
| 15 | **Label linked to input** (`for`/`id`) so clicking the label focuses it |
| 16 | **Autocomplete** correct on login/email/password |

### 3b. Input-type-specific

- **Number** — no letters accepted · min/max enforced · **money to 2 decimals** · negative rejected where invalid · thousands grouping on display
- **Date** — picker opens · min/max enforced · **dd-mm-yyyy display** · invalid date rejected · FY-range validation where required
- **Select** — placeholder option · options from live data · disabled when its source list is empty · searchable if long
- **Toggle/checkbox** — the prototype uses **toggles**, and the build substituted **checkboxes** on Tax Head's *Creates an Onward Liability* and *Certificate Expected*. **This is a real defect:** a checkbox is far less noticeable, and in Tax Head it hides six fields behind it. Audit every boolean control against the prototype's control type
- **Textarea** — resizable, sensible default rows, max length shown
- **File upload** — accepted types stated · size limit stated and enforced · filename shown after selection · remove/replace possible · upload progress
- **Multi-select / checkgroup** — Tax Head's *Withholding Direction* is a **checkgroup**, at least one required

### 3c. Cross-field behaviour

- Dirty-state guard before navigating away
- Cancel discards and returns to origin **with the list's filters intact**
- Save shows success, then navigates somewhere sensible — never leaves the user on the form wondering
- Double-submit prevented
- Server validation errors map back to the specific field
- **Round-trip: save → reopen → every value still there** (the Tax Head child-row bug)

---

## 4. TABLES / LISTS

- Column set and order per spec — **`Code` and `Used` columns are missing from ~11 Masters screens; see the Masters prompt**
- Header alignment matches cell alignment
- **Money right-aligned; codes/dates in mono; identifying column `cell-strong`; links `cell-accent`**
- Sort indicators on sortable columns; sort actually sorts
- Row hover state; clickable rows show a pointer
- **Actions column always last, right-aligned**
- Row action target beats row-click target
- Pagination: page size, current page, total count, disabled arrows at the ends
- **Result count always visible** ("Showing 24 of 312")
- Empty state **names the filters that caused it** and offers Clear all
- Long text truncates with ellipsis + full value on hover; **no layout break**
- Horizontal scroll contained in the table, never the page

---

## 5. LAYOUT, SPACING & VISUAL POLISH

### 5a. Page composition — every screen, in this order
`page-head` (title left + `§ref` + read-only badge; actions right) → `rec-head` (identity card, actions
right, summary tiles) → `tabs` (with count badges) → `filterbar` (search left · filters · **export right**;
chips below) → content cards → `formbar` (note left, buttons right).

### 5b. Consistency sweep — the things that look sloppy
- Identical elements have identical spacing on every screen
- Card padding uniform; section gaps uniform
- **All spacing from the token scale — no ad-hoc `margin: 13px`**
- Border radius consistent (`--r-sm`)
- Shadows only from `--shadow-sm/md/lg`
- **Every colour from a token — zero raw hex in components**
- Font sizes from a defined scale; **tabular numerals on every figure**
- Icon sizes consistent (14px in buttons, 13px in compact)
- Vertical rhythm: no orphaned single-item rows in a grid

### 5c. Responsive
Test at **1280 / 1440 / 1920**, plus tablet.
- No horizontal page scroll at any width
- No text clipping or overlap
- Tables scroll inside their own container
- Sidebar collapse works and content reflows
- Modals fit on screen; long modals scroll internally
- Filter bar wraps sensibly rather than overflowing

### 5d. Theme
**Every screen in light AND dark.**
- No unreadable contrast in either
- No hardcoded white/black backgrounds
- Badges, charts, borders, shadows all adapt
- Theme persists across navigation and reload
- **No flash of wrong theme on load**

### 5e. States — every async surface
Loading (skeleton or spinner, never a blank screen) · Empty (message + resolving action) · Error (what
failed + retry) · Success (confirmation) · Partial (some data + a warning).

---

## 6. TEXT & COPY

- Sentence case consistently (or Title Case — pick one, apply everywhere)
- **Labels match the spec's wording exactly**
- No dev placeholders: "Lorem", "TODO", "test", "asdf", "foo"
- No raw enum values leaking to the user (`PAYROLL_EMPLOYEE_DEDUCTION` → "Payroll — Employee Deduction")
- No untranslated keys, no `undefined`/`null`/`NaN` rendered
- Error messages say what to do, not just what failed
- Confirm dialogs name the specific consequence
- **Company name from Company Profile — the string "Meshrd" must not appear in any component**
- Currency symbol and date format from settings, not literals

---

## 7. ACCESSIBILITY (required for "enterprise-grade")

- `@axe-core/playwright` on every screen → **zero critical/serious violations**
- Every interactive element keyboard-reachable, in logical order, with a **visible focus ring**
- Every icon-only button has an accessible name
- Every input has a linked label
- Colour is never the only signal (status badges carry text, not just colour)
- Modals trap focus and restore it on close; Escape closes
- Errors announced to screen readers (`aria-live`)
- Contrast ≥ 4.5:1 for text, 3:1 for UI boundaries — **in both themes**

---

## 8. AUTOMATED IMPLEMENTATION

**Location:** `tests/ui/`

```
tests/ui/
  unstyled-classes.spec.ts   # §1a — used-but-undefined CSS classes. Fails the build.
  buttons.spec.ts            # §2c sweep, every screen × every role
  fields.spec.ts             # §3, every form
  tables.spec.ts             # §4, every list
  layout.spec.ts             # §5a-b composition order + token compliance
  responsive.spec.ts         # §5c at 4 widths
  theme.spec.ts              # §5d light + dark
  states.spec.ts             # §5e
  copy.spec.ts               # §6 forbidden strings, raw enums, "Meshrd"
  a11y.spec.ts               # §7 axe on every screen
  visual.spec.ts             # screenshot baselines, both themes
```

**Static checks that need no browser** (fastest wins — run these first):
- Used-but-undefined CSS classes (§1a)
- Raw hex colours in any component file
- The literal string `Meshrd` in any component
- Hardcoded `px` spacing outside the token file
- `<input>` without a linked `<label>`
- `<button>` with no text and no `aria-label`

**Visual regression:** capture a baseline per screen per theme once the polish pass is done; any later diff
fails CI. This is what stops polish from silently regressing.

---

## 9. ORDER OF WORK

1. **§1a static sweep** — find every unstyled element. Cheapest, highest impact, no browser needed
2. **Port the missing CSS classes** from `prototype/app.css`
3. **§2c button sweep** — get the list of missing and dead buttons
4. **§3 field audit** — against **the `.md` specs**, module by module
5. **Fix the toggle-vs-checkbox substitutions**
6. **§4 tables**, **§5 layout/theme/responsive**
7. **§6 copy**, **§7 accessibility**
8. **Lock in visual regression baselines**

---

## 10. DEFINITION OF DONE

- [ ] Zero used-but-undefined CSS classes across the app
- [ ] Every button in every spec exists, works, is correctly styled, and is RBAC-gated per the **spec**
- [ ] Every field in every spec's Fields Table is a **rendered field** with correct type, label, validation, and hint
- [ ] Every boolean control matches the prototype's control type (toggle vs checkbox)
- [ ] Zero dead controls — every control does something or is disabled with a stated reason
- [ ] Zero raw hex, zero hardcoded spacing, zero `Meshrd` literals in components
- [ ] Every screen passes in light and dark, at 1280/1440/1920
- [ ] Zero critical/serious axe violations on any screen
- [ ] Full keyboard operation without a mouse
- [ ] Visual regression baselines captured and passing
- [ ] **Field visibility verified against the `.md` specs and RBAC tables — never against the prototype's rendered output**

---

**Last reminder, because it is the one that would do real damage:** the prototype leaks role-restricted
fields. Use it for pixels. Use the specs for permissions.
