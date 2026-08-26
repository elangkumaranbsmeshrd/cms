import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate, formatMoney } from '../../../shared/screens/cell-format';
import { buildDatePresets, CUSTOM_PRESET, DatePreset, FinancialYearLike, resolveRange } from '../../../shared/screens/date-presets';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import { BankAccountOption, EmployeeOption, ExpenseClaimRow, ExpenseSummary, ExpenseTypeOption, PaymentModeOption, VendorOption } from '../expense.api';

// approved_by is a raw platform User id (not an Employee id) — resolved via
// the cross-cutting GET /users, same USER_REF convention my-leave.component.ts/
// my-assets.component.ts/asset.requests.list.config.ts already use for the
// identical field shape.
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  // §6.1 "Allow Manager to Approve Their Team's Expenses" intermediate step.
  { value: 'MGR_APPROVED', label: 'Manager Approved' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REIMBURSED', label: 'Reimbursed' },
];

interface DepartmentOption {
  readonly id: string;
  readonly name: string;
}

/** §2.3 All Expenses / Summary (expense.all_expenses) — bespoke for two
 * independent reasons (this module's own build brief): (a) Mark as
 * Reimbursed needs a real 3-field form, more than RowActionDef's single
 * synchronous window.prompt can express; (b) GET /expenses/summary is a
 * second, structurally distinct data source with NO query params of its own
 * (expenses.py's expense_summary() takes none at all) — wiring it through a
 * shared filter bar would misrepresent the figures as filter-following when
 * the real endpoint always ignores every filter. Rendered as its own
 * always-unfiltered block instead, with a plain hand-rolled filterable table
 * underneath for the list half.
 */
@Component({
  selector: 'app-all-expenses',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <!-- §2.3's own pageHead actions (data.js R.expsummary): Export PDF / Export
         Excel sit at the TOP of the page, not buried in the table's own
         filter-row — matches prototype placement exactly. -->
    <div class="page-head">
      <div>
        <h1 class="page-title">All Expenses / Summary</h1>
        <p class="page-sub">Every reimbursable expense claim across the company, with spend summaries.</p>
      </div>
      <div class="page-actions">
        <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportList('pdf')">
          {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
        </button>
        <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportList('excel')">
          {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
        </button>
      </div>
    </div>
    @if (exportError()) {
      <div class="form-error" style="margin: 0 0 16px;">{{ exportError() }}</div>
    }

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <!-- §2.3's own 4-tile KPI row (data.js R.expsummary) — Committed Spend
           and Actually Reimbursed come straight off GET /expenses/summary;
           Awaiting Approval and Missing Receipts aren't in that endpoint's
           response at all (it only rolls up Approved+Reimbursed), so they're
           computed client-side off a second, deliberately unfiltered GET
           /expenses fetch (kpiClaims below) — same client-side reduction the
           prototype's own rows.filter(r => r.status === 'Pending')/
           rows.filter(r => r.rcpt === 'No') does over its mock data, just
           against the real backend now. Kept unfiltered (not claims(), which
           tracks the filter bar) so all four tiles stay consistent with each
           other regardless of what the table below is currently filtered to. -->
      <div class="grid g-kpi" style="margin-bottom: 16px;">
        <div class="kpi" style="--tone: var(--accent); --tone-bg: var(--accent-subtle);">
          <div class="kpi-top"><div class="kpi-ico"><app-icon name="rupee" [size]="14" /></div><div class="kpi-label">Committed Spend</div></div>
          <div class="kpi-val num">{{ summary() ? formatMoney(summary()!.total_spend) : '…' }}</div>
          <div class="kpi-foot"><span>Approved + Reimbursed — money committed to</span></div>
        </div>
        <div class="kpi" style="--tone: var(--success); --tone-bg: var(--success-bg);">
          <div class="kpi-top"><div class="kpi-ico"><app-icon name="check" [size]="14" /></div><div class="kpi-label">Actually Reimbursed</div></div>
          <div class="kpi-val num">{{ summary() ? formatMoney(summary()!.total_reimbursed) : '…' }}</div>
          <div class="kpi-foot"><span>Money that has really left the account</span></div>
        </div>
        <div class="kpi" style="--tone: var(--warning); --tone-bg: var(--warning-bg);">
          <div class="kpi-top"><div class="kpi-ico"><app-icon name="clock" [size]="14" /></div><div class="kpi-label">Awaiting Approval</div></div>
          <div class="kpi-val num">{{ awaitingApprovalCount() }}<small> claims</small></div>
          <div class="kpi-foot"><span>{{ awaitingApprovalAmount() }}</span></div>
        </div>
        <div class="kpi" style="--tone: var(--danger); --tone-bg: var(--danger-bg);">
          <div class="kpi-top"><div class="kpi-ico"><app-icon name="alert" [size]="14" /></div><div class="kpi-label">Missing Receipts</div></div>
          <div class="kpi-val num">{{ missingReceiptsCount() }}<small> claims</small></div>
          <div class="kpi-foot"><span>The filter this queue most needed</span></div>
        </div>
      </div>

      <div class="grid g-2" style="margin-bottom: 16px;">
        <div class="card">
          <div class="card-head"><h3>Spend by Expense Type</h3><span class="sub">Simple totals, not a full analytics dashboard</span></div>
          <div class="card-body">
            @if (summary(); as s) {
              @for (row of s.by_expense_type; track row.expense_type) {
                <div class="meter-row" style="--tone: var(--accent);">
                  <div class="meter-name">{{ row.expense_type }}</div>
                  <div class="meter"><i [style.width]="meterWidth(row.amount, s.by_expense_type)"></i></div>
                  <div class="meter-val"><b>{{ formatMoney(row.amount) }}</b></div>
                </div>
              }
              @if (!s.by_expense_type.length) {
                <p class="cell-sub">No spend recorded yet.</p>
              }
            }
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Spend by Month</h3><span class="sub">Simple totals, not a full analytics dashboard</span></div>
          <div class="card-body">
            @if (summary(); as s) {
              @for (row of s.by_month; track row.month) {
                <div class="meter-row" style="--tone: var(--info);">
                  <div class="meter-name">{{ row.month }}</div>
                  <div class="meter"><i [style.width]="meterWidth(row.amount, s.by_month)"></i></div>
                  <div class="meter-val"><b>{{ formatMoney(row.amount) }}</b></div>
                </div>
              }
              @if (!s.by_month.length) {
                <p class="cell-sub">No spend recorded yet.</p>
              }
            }
          </div>
        </div>
      </div>

      @if (reimbursingRow(); as row) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Mark as Reimbursed — {{ row.expense_type_name_snapshot }}, {{ formatMoney(row.amount) }}</h3></div>
          <div class="card-body">
            @if (reimburseError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ reimburseError() }}</div>
            }
            <div class="grid g-2">
              <!-- §2.3's own field table: "Approved By, ro, carried from the
                   approval record." approved_by is a raw platform User id —
                   resolved via USER_REF/RefDataService, same as every other
                   User-id field in this codebase (see this file's own
                   header comment). -->
              <div><div class="cell-sub">Approved By</div><div class="cell-strong">{{ approverLabel(row) }}</div></div>
              <!-- Every control in this card carries an explicit aria-label. The
                   visible caption above each one is a <div class="cell-sub">,
                   not a <label for> — a div names nothing in the accessibility
                   tree no matter how label-like it looks, so each of these
                   announced as a bare unnamed combo box / edit field. Same
                   defect the filter row below had, and the same fix (see its
                   comment); these escaped the axe sweep's count only because the
                   whole card is behind reimbursingRow(), which an automated
                   crawl never opens. The aria-label text repeats the cell-sub
                   verbatim so the announced name and the visible caption cannot
                   drift. aria-required marks the three fields submitReimburse()
                   actually rejects, so a screen-reader user hears the
                   requirement before submitting rather than only in the error
                   banner afterwards. -->
              <div><div class="cell-sub">Reimbursed Date</div><input class="input" type="date" aria-label="Reimbursed Date" aria-required="true" [max]="today" [(ngModel)]="reimburseForm['reimbursed_date']" /></div>
              <div>
                <div class="cell-sub">Payment Mode</div>
                <select class="input" aria-label="Payment Mode" aria-required="true" [(ngModel)]="reimburseForm['payment_mode_id']">
                  <option [value]="null">—</option>
                  @for (m of paymentModes(); track m.id) {
                    <option [value]="m.id">{{ m.label }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Reimbursed From Bank Account</div>
                <select class="input" aria-label="Reimbursed From Bank Account" aria-required="true" [(ngModel)]="reimburseForm['reimbursed_from_bank_account_id']">
                  <option [value]="null">—</option>
                  @for (b of activeBankAccounts(); track b.id) {
                    <option [value]="b.id">{{ b.label }}</option>
                  }
                </select>
              </div>
              <div><div class="cell-sub">Reference</div><input class="input" aria-label="Reference" [(ngModel)]="reimburseForm['reference']" placeholder="Optional" /></div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="reimbursing()" (click)="cancelReimburse()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="reimbursing()" (click)="submitReimburse()">
              {{ reimbursing() ? 'Saving…' : 'Mark as Reimbursed' }}
            </button>
          </div>
        </div>
      }

      <div class="card">
        <div class="card-head">
          <h3>All Expenses</h3>
        </div>
        <div class="card-body" style="padding-bottom: 0;">
          <!-- Every control in this filter row carries an explicit aria-label.
               This bar is label-less by design — the dimension name lives in
               the "All Expense Types" option or in a tooltip — so before this
               the axe sweep flagged the three title-less selects as [critical]
               select-name, the titled ones as [serious] label-title-only and
               the amount/pending/search boxes as placeholder-only on
               /expenses/all. A title is a tooltip, not a label: it never
               surfaces on touch, it vanishes on keyboard focus, and screen
               readers announce it only as a last resort; a placeholder is worse
               still, since it disappears the moment the user types. See
               list-screen.component.ts's filter-bar comment (and
               form-screen.component.ts's own [attr.aria-label]) for the full
               reasoning. The titles and placeholders stay. -->
          <div class="filter-row" style="flex-wrap: wrap;">
            <!-- This title is a usage HINT, not the field's name — it was never
                 a candidate label even in principle, which is why "Status" has
                 to come from aria-label rather than from reusing the tooltip
                 the way the Department and Bank Account selects below do. -->
            <select class="input sm" multiple aria-label="Status" [(ngModel)]="statusFilter" (ngModelChange)="load()" title="Ctrl/Cmd-click to select multiple statuses">
              @for (s of STATUS_OPTIONS; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
            <select class="input sm" aria-label="Expense Type" [(ngModel)]="expenseTypeFilter" (ngModelChange)="load()">
              <option value="">All Expense Types</option>
              @for (t of expenseTypes(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            <select class="input sm" aria-label="Employee" [(ngModel)]="employeeFilter" (ngModelChange)="load()">
              <option value="">All Employees</option>
              @for (e of employees(); track e.id) {
                <option [value]="e.id">{{ employeeDisplayName(e) }}</option>
              }
            </select>
            <select class="input sm" aria-label="Department" [(ngModel)]="departmentFilter" (ngModelChange)="load()" title="Department">
              <option value="">All Departments</option>
              @for (d of departments(); track d.id) {
                <option [value]="d.id">{{ d.name }}</option>
              }
            </select>
            @if (canSeeVendor()) {
              <select class="input sm" aria-label="Vendor" [(ngModel)]="vendorFilter" (ngModelChange)="load()">
                <option value="">All Vendors</option>
                @for (v of vendors(); track v.id) {
                  <option [value]="v.id">{{ v.vendor_name }}</option>
                }
              </select>
            }
            <select class="input sm" aria-label="Bank Account" [(ngModel)]="bankAccountFilter" (ngModelChange)="load()" title="Bank Account">
              <option value="">All Accounts</option>
              @for (b of bankAccounts(); track b.id) {
                <option [value]="b.id">{{ b.label }}</option>
              }
            </select>
            <select class="input sm" aria-label="Financial Year" [(ngModel)]="financialYearFilter" (ngModelChange)="load()" title="Financial Year">
              <option value="">All Financial Years</option>
              @for (fy of financialYears(); track fy.id) {
                <option [value]="fy.id">{{ fy.label ?? fy.id }}</option>
              }
            </select>
            <select class="input sm" aria-label="Approved By" [(ngModel)]="approvedByFilter" (ngModelChange)="load()" title="Approved By">
              <option value="">Approved By — Any</option>
              @for (u of approverOptions(); track u.id) {
                <option [value]="u.id">{{ u.label }}</option>
              }
            </select>
            <!-- Period: GET /expenses genuinely takes date_from/date_to, so
                 this resolves through the real server params (dateFrom/
                 dateTo) rather than filtering client-side — same
                 buildDatePresets()/resolveRange() financial-year-aware
                 machinery ListScreenComponent's own 'daterange' filter kind
                 uses, wired by hand since this is a bespoke component. -->
            <select class="input sm" aria-label="Period" [(ngModel)]="periodPreset" (ngModelChange)="onPeriodPresetChange()" title="Period">
              <option value="">All Dates</option>
              @for (p of presets(); track p.value) {
                <option [value]="p.value">{{ p.label }}</option>
              }
            </select>
            @if (periodPreset === CUSTOM_PRESET) {
              <!-- "Period from"/"Period to", not the bare "From"/"To" the
                   tooltips say: this same row carries a second date pair
                   (Approved from / Approved to) and both are on screen at once
                   whenever Period is Custom, so a name of just "From" would be
                   announced against two different ranges with nothing to tell
                   them apart. -->
              <input class="input sm" type="date" aria-label="Period from" [(ngModel)]="dateFrom" (ngModelChange)="load()" title="From" />
              <input class="input sm" type="date" aria-label="Period to" [(ngModel)]="dateTo" (ngModelChange)="load()" title="To" />
            }
            <select class="input sm" aria-label="Has Receipt" [(ngModel)]="hasReceiptFilter" (ngModelChange)="load()" title="Has Receipt">
              <option value="">Receipt — Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <input class="input sm" type="number" min="0" step="0.01" aria-label="Min Amount" [(ngModel)]="amountMinFilter" (ngModelChange)="load()" placeholder="Min Amount" style="width: 110px;" />
            <input class="input sm" type="number" min="0" step="0.01" aria-label="Max Amount" [(ngModel)]="amountMaxFilter" (ngModelChange)="load()" placeholder="Max Amount" style="width: 110px;" />
            <input class="input sm" type="date" aria-label="Approved from" [(ngModel)]="approvedFrom" (ngModelChange)="load()" title="Approved from" />
            <input class="input sm" type="date" aria-label="Approved to" [(ngModel)]="approvedTo" (ngModelChange)="load()" title="Approved to" />
            <!-- Named "Minimum days pending" rather than echoing the
                 placeholder: "Pending ≥ N days" is a formula with a stand-in
                 letter in it, and a screen reader reads it out as one — "greater
                 than or equal to N" names nothing. The placeholder stays for
                 sighted users, who read it as the shorthand it is. -->
            <input class="input sm" type="number" min="0" step="1" aria-label="Minimum days pending" [(ngModel)]="pendingDaysFilter" (ngModelChange)="load()" placeholder="Pending ≥ N days" style="width: 130px;" />
            <!-- Named "Search description or type" rather than echoing the whole
                 placeholder: "(Enter to search)" is an instruction about how to
                 use the box, and an accessible name should be what the box IS. -->
            <input class="input sm" aria-label="Search description or type" [(ngModel)]="search" (keyup.enter)="load()" (blur)="load()" placeholder="Search description, type… (Enter to search)" />
          </div>
        </div>
        @if (actionError()) {
          <div class="form-error" style="margin: 14px;">{{ actionError() }}</div>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Vendor</th>
                <th class="r">Amount</th>
                <th>Date</th>
                <th>Receipt</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of claims(); track c.id) {
                <tr>
                  <td class="cell-strong">{{ employeeName(c.employee_id) }}</td>
                  <td>{{ c.expense_type_name_snapshot }}</td>
                  <td>{{ vendorLabel(c.vendor_id) }}</td>
                  <td class="mono r">{{ formatMoney(c.amount) }}</td>
                  <td class="mono">{{ formatDate(c.expense_date) }}</td>
                  <td>
                    @if (c.has_receipt) {
                      <button class="btn sm ghost" type="button" (click)="viewReceipt(c)">View Receipt</button>
                    } @else {
                      {{ EM_DASH }}
                    }
                  </td>
                  <td><span class="badge-s {{ badgeClass(c.status) }}">{{ statusLabel(c.status) }}</span></td>
                  <td>
                    @if (c.status === 'APPROVED' && canMarkReimbursed()) {
                      <button class="btn sm ghost" type="button" (click)="startReimburse(c)">Mark as Reimbursed</button>
                    }
                  </td>
                </tr>
              }
              @if (!claims().length) {
                <tr><td colspan="8" class="cell-sub">No expense claims match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AllExpensesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly refData = inject(RefDataService);
  private readonly fileUpload = inject(FileUploadService);

  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;
  protected readonly EM_DASH = EM_DASH;
  protected readonly CUSTOM_PRESET = CUSTOM_PRESET;
  protected readonly formatMoney = formatMoney;
  protected readonly formatDate = formatDate;
  protected readonly badgeClass = badgeClass;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly isLoading = signal(true);
  protected readonly summary = signal<ExpenseSummary | null>(null);
  protected readonly claims = signal<readonly ExpenseClaimRow[]>([]);
  protected readonly employees = signal<readonly EmployeeOption[]>([]);
  protected readonly expenseTypes = signal<readonly ExpenseTypeOption[]>([]);
  protected readonly vendors = signal<readonly VendorOption[]>([]);
  protected readonly paymentModes = signal<readonly PaymentModeOption[]>([]);
  protected readonly bankAccounts = signal<readonly BankAccountOption[]>([]);
  protected readonly departments = signal<readonly DepartmentOption[]>([]);
  // §2.2c financial-year presets for the Period filter below — same source
  // ListScreenComponent's own 'daterange' filter kind reads, ALSO reused
  // as the options list for the separate Financial Year equality filter
  // (financialYearFilter) — same list, two different uses.
  protected readonly financialYears = signal<readonly FinancialYearLike[]>([]);
  // Deliberately unfiltered — backs the Awaiting Approval / Missing Receipts
  // KPI tiles only, see the KPI grid's own header comment for why.
  protected readonly kpiClaims = signal<readonly ExpenseClaimRow[]>([]);

  protected employeeFilter = '';
  protected departmentFilter = '';
  protected statusFilter: string[] = [];
  protected expenseTypeFilter = '';
  protected vendorFilter = '';
  protected bankAccountFilter = '';
  protected financialYearFilter = '';
  protected approvedByFilter = '';
  protected approvedFrom = '';
  protected approvedTo = '';
  protected amountMinFilter = '';
  protected amountMaxFilter = '';
  protected pendingDaysFilter = '';
  protected dateFrom = '';
  protected dateTo = '';
  protected periodPreset = '';
  protected search = '';
  protected hasReceiptFilter = '';

  protected readonly reimbursingRow = signal<ExpenseClaimRow | null>(null);
  protected reimburseForm: Record<string, unknown> = {};
  protected readonly reimbursing = signal(false);
  protected readonly reimburseError = signal<string | null>(null);

  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<EmployeeOption[]>(`${environment.apiBaseUrl}/employees`).subscribe({
      next: (rows) => this.employees.set(rows),
      error: () => this.employees.set([]),
    });
    // §2 of this module's build brief: this screen's own default is
    // REIMBURSABLE-only — matches what GET /expenses itself is hardcoded to
    // return regardless of what's asked for (expenses.py's list_all_
    // expenses: `.where(ExpenseClaim.claim_type == "REIMBURSABLE")`), so a
    // Company-Paid type would only ever be a dead-end filter option.
    // /options, not the gated masters.expense_types screen (Manager/Super
    // Admin only in seed.py). claim_type rides along deliberately — this
    // screen filters on it, and the same payload feeds the picker helpers.
    this.http
      .get<{ id: string; label: string; is_active: boolean; claim_type: string }[]>(
        `${environment.apiBaseUrl}/masters/expense-types/options`,
      )
      .subscribe({
        next: (rows) =>
          this.expenseTypes.set(
            rows
              .filter((t) => t.is_active && t.claim_type === 'REIMBURSABLE')
              .map((r) => ({ id: r.id, name: r.label, claim_type: r.claim_type, is_active: r.is_active })),
          ),
        error: () => this.expenseTypes.set([]),
      });
    // /options, not the gated masters.bank_accounts/payment_modes screens
    // (2026-08-11 RBAC audit fix) — same reasoning as company-expenses.component.ts.
    this.http.get<PaymentModeOption[]>(`${environment.apiBaseUrl}/masters/payment-modes/options`).subscribe({
      next: (rows) => this.paymentModes.set(rows),
      error: () => this.paymentModes.set([]),
    });
    this.http.get<BankAccountOption[]>(`${environment.apiBaseUrl}/masters/bank-accounts/options?include_inactive=true`).subscribe({
      next: (rows) => this.bankAccounts.set(rows),
      error: () => this.bankAccounts.set([]),
    });
    if (this.canSeeVendor()) {
      this.http.get<VendorOption[]>(`${environment.apiBaseUrl}/vendors?is_active=true`).subscribe({
        next: (rows) => this.vendors.set(rows),
        error: () => this.vendors.set([]),
      });
    }
    // /options, not the gated masters.departments screen (2026-08 RBAC audit
    // fix) — Department is Super-Admin-only (seed.py), so this Department
    // filter was silently always empty for Accountant, this screen's primary
    // role. Returns {id, label, is_active}; mapped onto DepartmentOption's
    // existing {id, name} shape so the template below needs no change.
    this.http.get<{ id: string; label: string }[]>(`${environment.apiBaseUrl}/masters/departments/options`).subscribe({
      next: (rows) => this.departments.set(rows.map((r) => ({ id: r.id, name: r.label }))),
      error: () => this.departments.set([]),
    });
    // For the Period filter's presets — degrades to calendar-only presets on
    // a 403/empty response, same as ListScreenComponent's own daterange kind.
    this.http.get<FinancialYearLike[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows ?? []),
      error: () => this.financialYears.set([]),
    });
    // Deliberately unfiltered fetch, separate from load()'s own filtered
    // claims() — see kpiClaims' own declaration for why.
    this.http.get<ExpenseClaimRow[]>(`${environment.apiBaseUrl}/expenses`).subscribe({
      next: (rows) => this.kpiClaims.set(rows),
      error: () => this.kpiClaims.set([]),
    });
    this.loadSummary();
    this.load();
  }

  protected canSeeVendor(): boolean {
    return this.policy.canOpen('vendor.directory');
  }

  protected canMarkReimbursed(): boolean {
    return this.policy.can('expense.all_expenses', 'mark_reimbursed');
  }

  protected presets(): readonly DatePreset[] {
    return buildDatePresets(this.financialYears());
  }

  protected onPeriodPresetChange(): void {
    if (this.periodPreset === CUSTOM_PRESET) return; // leave dateFrom/dateTo for manual entry
    if (!this.periodPreset) {
      this.dateFrom = '';
      this.dateTo = '';
    } else {
      const range = resolveRange({ preset: this.periodPreset, from: null, to: null }, this.presets());
      this.dateFrom = range.from ?? '';
      this.dateTo = range.to ?? '';
    }
    this.load();
  }

  // §2.3's own KPI tiles (data.js R.expsummary), computed off the
  // deliberately unfiltered kpiClaims() — see that signal's own comment.
  protected awaitingApprovalCount(): number {
    return this.kpiClaims().filter((c) => c.status === 'PENDING').length;
  }

  protected awaitingApprovalAmount(): string {
    const total = this.kpiClaims()
      .filter((c) => c.status === 'PENDING')
      .reduce((sum, c) => sum + Number(c.amount), 0);
    return formatMoney(total);
  }

  protected missingReceiptsCount(): number {
    return this.kpiClaims().filter((c) => !c.has_receipt).length;
  }

  protected meterWidth(amount: string, rows: readonly { amount: string }[]): string {
    const max = rows.reduce((m, r) => Math.max(m, Number(r.amount)), 0) || 1;
    return `${Math.round((Number(amount) / max) * 100)}%`;
  }

  // approved_by is a raw platform User id — resolved via USER_REF/RefDataService.
  protected approverLabel(row: ExpenseClaimRow): string {
    if (!row.approved_by) return EM_DASH;
    const name = this.refData.label(USER_REF, row.approved_by);
    return row.approved_at ? `${name} · ${formatDate(row.approved_at)}` : name;
  }

  // Approved By's own option list — every platform user, same tolerance
  // this codebase already accepts for a filter dropdown slightly broader
  // than the realistic value set (approved_by is in practice only ever
  // Accountant/Super Admin, but there's no cheap way to pre-filter /users
  // by role from here, and picking an off-role user is harmless: it just
  // always yields zero rows, the same "disclosed, low-stakes" precedent
  // expense.approvals.list.config.ts's own Claim Type/Bank Account filters
  // already document).
  protected approverOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(USER_REF) ?? [];
  }

  protected viewReceipt(c: ExpenseClaimRow): void {
    if (!c.receipt_stored_file_id) return;
    this.actionError.set(null);
    this.fileUpload.fetch(c.receipt_stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Could not open that receipt.'),
    });
  }

  // Read-only display only — masters_bank_accounts.py has no server
  // is_active filter, so bankAccounts() itself stays unfiltered (kept
  // available for a future read-only label use); this is the client-
  // filtered view the Reimburse dialog's own picker uses.
  protected activeBankAccounts(): readonly BankAccountOption[] {
    return this.bankAccounts().filter((b) => b.is_active);
  }

  protected employeeDisplayName(e: EmployeeOption): string {
    return `${e.first_name} ${e.last_name ?? ''}`.trim();
  }

  protected employeeName(id: string): string {
    const e = this.employees().find((x) => x.id === id);
    return e ? this.employeeDisplayName(e) : id.slice(0, 8);
  }

  protected vendorLabel(id: string | null): string {
    if (!id) return EM_DASH;
    const v = this.vendors().find((x) => x.id === id);
    return v ? v.vendor_name : id.slice(0, 8);
  }

  protected statusLabel(v: string): string {
    return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  protected loadSummary(): void {
    this.http.get<ExpenseSummary>(`${environment.apiBaseUrl}/expenses/summary`).subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
  }

  // Shared by load() and exportList() — keeps the list and its export in
  // agreement by construction. All of these now round-trip to GET /expenses
  // for real (expenses.py's list_all_expenses).
  private listParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.employeeFilter) params.set('employee_id', this.employeeFilter);
    if (this.departmentFilter) params.set('department_id', this.departmentFilter);
    for (const s of this.statusFilter) params.append('status', s);
    if (this.expenseTypeFilter) params.set('expense_type_id', this.expenseTypeFilter);
    if (this.vendorFilter) params.set('vendor_id', this.vendorFilter);
    if (this.bankAccountFilter) params.set('bank_account_id', this.bankAccountFilter);
    if (this.financialYearFilter) params.set('financial_year_id', this.financialYearFilter);
    if (this.approvedByFilter) params.set('approved_by', this.approvedByFilter);
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);
    if (this.approvedFrom) params.set('approved_from', this.approvedFrom);
    if (this.approvedTo) params.set('approved_to', this.approvedTo);
    if (this.amountMinFilter) params.set('amount_min', this.amountMinFilter);
    if (this.amountMaxFilter) params.set('amount_max', this.amountMaxFilter);
    if (this.hasReceiptFilter) params.set('has_receipt', this.hasReceiptFilter);
    if (this.pendingDaysFilter) params.set('pending_days', this.pendingDaysFilter);
    if (this.search) params.set('search', this.search);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.listParams().toString();
    this.http.get<ExpenseClaimRow[]>(`${environment.apiBaseUrl}/expenses${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.claims.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startReimburse(row: ExpenseClaimRow): void {
    this.reimburseForm = { reimbursed_date: this.today, payment_mode_id: null, reimbursed_from_bank_account_id: null, reference: '' };
    this.reimburseError.set(null);
    this.reimbursingRow.set(row);
  }

  protected cancelReimburse(): void {
    this.reimbursingRow.set(null);
  }

  protected submitReimburse(): void {
    const row = this.reimbursingRow();
    if (!row) return;
    const f = this.reimburseForm;
    if (!f['reimbursed_date'] || !f['payment_mode_id'] || !f['reimbursed_from_bank_account_id']) {
      this.reimburseError.set('Reimbursed Date, Payment Mode, and Bank Account are all required.');
      return;
    }
    this.reimbursing.set(true);
    this.reimburseError.set(null);
    const body = {
      reimbursed_date: f['reimbursed_date'],
      payment_mode_id: f['payment_mode_id'],
      reimbursed_from_bank_account_id: f['reimbursed_from_bank_account_id'],
      reference: f['reference'] || null,
    };
    this.http.post(`${environment.apiBaseUrl}/expenses/${row.id}/mark-reimbursed`, body).subscribe({
      next: () => {
        this.reimbursing.set(false);
        this.reimbursingRow.set(null);
        this.load();
        this.loadSummary();
      },
      error: (err) => {
        this.reimbursing.set(false);
        this.reimburseError.set(err?.error?.detail ?? 'Failed to mark this claim as reimbursed.');
      },
    });
  }

  // Not asked for explicitly by this screen's own section of the module's
  // build brief — added anyway since GET /expenses genuinely accepts
  // ?format=pdf|excel (confirmed against expenses.py's list_all_expenses)
  // and every other list-shaped view in this module gets the same pair of
  // buttons (RBAC §2.2f's baseline). Flagged in the build report as a
  // judgment call in case the brief's silence here was deliberate.
  protected exportList(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.listParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/expenses?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `All Expenses.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: () => {
        this.exporting.set(null);
        this.exportError.set('Failed to export.');
      },
    });
  }
}
