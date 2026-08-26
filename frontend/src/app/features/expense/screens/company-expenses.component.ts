import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate, formatMoney } from '../../../shared/screens/cell-format';
import { buildDatePresets, CUSTOM_PRESET, DatePreset, FinancialYearLike, resolveRange, withinRange } from '../../../shared/screens/date-presets';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { BankAccountOption, CompanyExpenseRow, ExpenseTypeOption, PaymentModeOption, PurchaseBillOption, TaxHeadOption, VendorOption } from '../expense.api';

const SCREEN = 'expense.company';

// Verbatim ck_compexp_status (DB CHECK constraint) — NOT the ExpenseClaim
// status set (no REIMBURSED state exists on this resource at all, per this
// module's build brief).
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** §2.4 Company Expenses (expense.company) — its own screen, deliberately
 * never a filter on All Expenses/Summary (Appendix B, verbatim). Bespoke on
 * the same "list + inline Add form" class as My Expenses, plus an inline Pay
 * dialog and a Cancel action — all three (create/pay/cancel) share the one
 * 'edit' RBAC action this screen registers (app/rbac/registry/screens.py),
 * so all three are gated on the same policy.can(SCREEN, 'edit') check.
 *
 * CompanyExpenseOut carries no expense_type/vendor name snapshot (unlike
 * ExpenseClaimOut) — both are resolved here from the same Masters/Vendor
 * fetches the Add form's own pickers already need.
 */
@Component({
  selector: 'app-company-expenses',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Company Expenses</h1>
        <p class="page-sub">Company-paid expenses — never routed through the reimbursement queue.</p>
      </div>
      <div class="page-actions">
        @if (canEdit() && !showForm()) {
          <button class="btn sm primary" type="button" (click)="startForm()">+ Add Company Expense</button>
        }
        <!-- §2.4's own action bar is just these two buttons side by side —
             see my-expenses.component.ts's identical toggle-button comment
             for why this opens the card below rather than exporting
             immediately (the real endpoint needs a date range). -->
        <button class="btn sm ghost" type="button" (click)="showStatementCard.set(!showStatementCard())">
          <app-icon name="download" [size]="14" />Export Statement
        </button>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (showForm()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Add Company Expense</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Expense Type</div>
                <select class="input" [(ngModel)]="form['expense_type_id']">
                  <option [value]="null">—</option>
                  @for (t of companyPaidTypes(); track t.id) {
                    <option [value]="t.id">{{ t.name }}</option>
                  }
                </select>
              </div>
              <!-- §2.1's own field table (shared by the Company Expenses
                   entry point too): "Claim Type, ro, carried from the Type."
                   Always reads Company-Paid here since companyPaidTypes()
                   only offers that claim_type — kept for field-table parity. -->
              <div>
                <div class="cell-sub">Claim Type</div>
                <div class="cell-strong">{{ selectedClaimTypeLabel() }}</div>
              </div>
              @if (canSeeVendor()) {
                <div>
                  <div class="cell-sub">Vendor</div>
                  <select class="input" [(ngModel)]="form['vendor_id']">
                    <option [value]="null">—</option>
                    @for (v of vendors(); track v.id) {
                      <option [value]="v.id">{{ v.vendor_name }}</option>
                    }
                  </select>
                </div>
              }
              <div>
                <div class="cell-sub">Amount</div>
                <input class="input" type="number" step="0.01" min="0" [(ngModel)]="form['amount']" />
              </div>
              <!-- §2.1 field order (data.js x.add, shared by this entry
                   point too), verbatim: Type, Claim Type, Vendor, Amount,
                   Tax, Tax Amount, Date, Linked Purchase Bill, Description,
                   Receipt. Paid On / Paid From Bank Account / Payment Mode /
                   Payment Reference are deliberately NOT on this form — the
                   backend always creates a company expense as PENDING
                   regardless of what's submitted here (pay_company_expense
                   is the one place that transition happens), so asking for
                   them at creation only duplicated the Pay dialog below with
                   no effect. -->
              @if (filteredTaxHeads().length) {
                <div>
                  <div class="cell-sub">Tax Head</div>
                  <select class="input" [(ngModel)]="form['tax_head_id']">
                    <option [value]="null">—</option>
                    @for (t of filteredTaxHeads(); track t.id) {
                      <option [value]="t.id">{{ t.tax_name }}</option>
                    }
                  </select>
                </div>
              }
              <div>
                <div class="cell-sub">Tax Amount</div>
                <input class="input" type="number" step="0.01" min="0" [(ngModel)]="form['tax_amount']" placeholder="Optional" />
              </div>
              <div>
                <div class="cell-sub">Expense Date</div>
                <input class="input" type="date" [max]="today" [(ngModel)]="form['expense_date']" />
              </div>
              @if (canSeePurchaseBill()) {
                <div>
                  <div class="cell-sub">Linked Purchase Bill</div>
                  <select class="input" [(ngModel)]="form['linked_purchase_bill_id']">
                    <option [value]="null">—</option>
                    @for (b of purchaseBills(); track b.id) {
                      <option [value]="b.id">{{ b.purchase_bill_code }}</option>
                    }
                  </select>
                </div>
              }
              <!-- Billing Period Month/Year: real CompanyExpenseCreate
                   fields with no equivalent anywhere else on this form or
                   the Pay dialog — kept, ties to §2.4's own "Recurring marks
                   the bills expected every month" description. Not in the
                   prototype's x.add field list (which has no billing-period
                   concept at all), flagged in the build report. -->
              <div>
                <div class="cell-sub">Billing Period Month</div>
                <input class="input" type="number" min="1" max="12" [(ngModel)]="form['billing_period_month']" placeholder="Optional, 1–12" />
              </div>
              <div>
                <div class="cell-sub">Billing Period Year</div>
                <input class="input" type="number" [(ngModel)]="form['billing_period_year']" placeholder="Optional" />
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Description</div>
                <textarea class="input" rows="2" [(ngModel)]="form['description']" placeholder="Optional"></textarea>
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Bill Attached</div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event)" />
                <p class="hint" style="margin: 4px 0 0;">PDF, JPEG or PNG, up to 5 MB. Optional.</p>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="showForm.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submitForm()">
              {{ submitting() ? 'Submitting…' : 'Submit' }}
            </button>
          </div>
        </div>
      }

      @if (payingRow(); as row) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Pay — {{ typeLabel(row.expense_type_id) }}, {{ formatMoney(row.amount) }}</h3></div>
          <div class="card-body">
            @if (payError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ payError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Paid From Bank Account</div>
                <select class="input" [(ngModel)]="payForm['paid_from_bank_account_id']">
                  <option [value]="null">—</option>
                  @for (b of activeBankAccounts(); track b.id) {
                    <option [value]="b.id">{{ b.label }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Payment Mode</div>
                <select class="input" [(ngModel)]="payForm['payment_mode_id']">
                  <option [value]="null">—</option>
                  @for (m of paymentModes(); track m.id) {
                    <option [value]="m.id">{{ m.label }}</option>
                  }
                </select>
              </div>
              <div><div class="cell-sub">Payment Reference</div><input class="input" [(ngModel)]="payForm['payment_reference']" placeholder="Optional" /></div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="paying()" (click)="cancelPay()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="paying()" (click)="submitPay()">{{ paying() ? 'Saving…' : 'Record Payment' }}</button>
          </div>
        </div>
      }

      @if (showStatementCard()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Export Statement</h3></div>
          <div class="card-body">
            <p class="hint" style="margin: 0 0 10px;">Bank-statement style export — Date, Description, Bank Account, Reference, Debit, Running Balance — covering only Paid expenses in the range below.</p>
            <div class="filter-row">
              <div><div class="cell-sub">From</div><input class="input sm" type="date" [(ngModel)]="statementFrom" /></div>
              <div><div class="cell-sub">To</div><input class="input sm" type="date" [(ngModel)]="statementTo" /></div>
              <button class="btn sm ghost" type="button" [disabled]="!!statementExporting()" (click)="exportStatement('pdf')">
                {{ statementExporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
              </button>
              <button class="btn sm ghost" type="button" [disabled]="!!statementExporting()" (click)="exportStatement('excel')">
                {{ statementExporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
              </button>
            </div>
            @if (statementError()) {
              <div class="form-error" style="margin: 10px 0 0;">{{ statementError() }}</div>
            }
          </div>
        </div>
      }

      <div class="card">
        <div class="card-head">
          <h3>Company Expenses</h3>
        </div>
        <div class="card-body" style="padding-bottom: 0;">
          <div class="filter-row" style="flex-wrap: wrap;">
            <select class="input sm" [(ngModel)]="expenseTypeFilter" (ngModelChange)="load()">
              <option value="">All Expense Types</option>
              @for (t of companyPaidTypes(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            <select class="input sm" multiple [(ngModel)]="statusFilter" (ngModelChange)="load()" title="Ctrl/Cmd-click to select multiple statuses">
              @for (s of STATUS_OPTIONS; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
            @if (canSeeVendor()) {
              <select class="input sm" [(ngModel)]="vendorFilter" (ngModelChange)="load()">
                <option value="">All Vendors</option>
                @for (v of vendors(); track v.id) {
                  <option [value]="v.id">{{ v.vendor_name }}</option>
                }
              </select>
            }
            <!-- Bank Account (Paid From) — real ?paid_from_bank_account_id=
                 param on GET /company-expenses now (expenses.py's
                 list_company_expenses), closing §2.4's own "Deferred: Bank
                 Account and Period" gap for the Bank Account half. -->
            <select class="input sm" [(ngModel)]="bankAccountFilter" (ngModelChange)="load()" title="Bank Account">
              <option value="">All Accounts</option>
              @for (b of bankAccounts(); track b.id) {
                <option [value]="b.id">{{ b.label }}</option>
              }
            </select>
            <!-- "Period" here (expense Date range) stays client-side — the
                 endpoint has no date_from/date_to params, unlike GET
                 /expenses. Same buildDatePresets()/withinRange() machinery
                 ListScreenComponent's own 'daterange' filter kind uses. This
                 is a DIFFERENT dimension from the Billing Period filter just
                 below: this filters when the expense was dated, that filters
                 which recurring bill-month a row represents — §2.4's own
                 "Recurring... so a month where an expected bill never
                 arrived is visible as an absence" reasoning needs the latter
                 specifically, not this one. -->
            <select class="input sm" [title]="'Period (Expense Date)'" [(ngModel)]="periodPreset" (ngModelChange)="onPeriodPresetChange()">
              <option value="">All Dates</option>
              @for (p of presets(); track p.value) {
                <option [value]="p.value">{{ p.label }}</option>
              }
            </select>
            @if (periodPreset === CUSTOM_PRESET) {
              <input class="input sm" type="date" [(ngModel)]="periodFrom" title="From" />
              <input class="input sm" type="date" [(ngModel)]="periodTo" title="To" />
            }
            <!-- Billing Period (Month/Year) — the filter §2.4's own text
                 actually names as deferred: "the billing-period columns
                 exist on every row, so the Period filter is an additive
                 parameter when picked up." Real ?billing_period_month=/
                 ?billing_period_year= params, server-side. -->
            <input class="input sm" type="number" min="1" max="12" [(ngModel)]="billingPeriodMonthFilter" (ngModelChange)="load()" placeholder="Billing Month" style="width: 110px;" title="Billing Period Month" />
            <input class="input sm" type="number" [(ngModel)]="billingPeriodYearFilter" (ngModelChange)="load()" placeholder="Billing Year" style="width: 110px;" title="Billing Period Year" />
            <input class="input sm" [(ngModel)]="search" (keyup.enter)="load()" (blur)="load()" placeholder="Search description… (Enter to search)" />
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportList('pdf')">
              {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
            </button>
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportList('excel')">
              {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
            </button>
          </div>
        </div>
        @if (actionError()) {
          <div class="form-error" style="margin: 14px;">{{ actionError() }}</div>
        }
        @if (exportError()) {
          <div class="form-error" style="margin: 14px;">{{ exportError() }}</div>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Vendor</th>
                <th>Linked Purchase Bill</th>
                <th class="r">Amount</th>
                <th>Paid From (Bank Account)</th>
                <th>Date</th>
                <th>Paid On</th>
                <th>Bill Attached</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of filteredExpenses(); track r.id) {
                <tr>
                  <td class="cell-strong">{{ typeLabel(r.expense_type_id) }}</td>
                  <td>{{ vendorLabel(r.vendor_id) }}</td>
                  <td class="mono">{{ purchaseBillLabel(r.linked_purchase_bill_id) }}</td>
                  <td class="mono r">{{ formatMoney(r.amount) }}</td>
                  <td>{{ bankAccountName(r.paid_from_bank_account_id) }}</td>
                  <td class="mono">{{ formatDate(r.expense_date) }}</td>
                  <td class="mono">{{ r.paid_on ? formatDate(r.paid_on) : EM_DASH }}</td>
                  <td>
                    @if (r.has_bill_attached) {
                      <button class="btn sm ghost" type="button" (click)="viewBill(r)">View Bill</button>
                    } @else {
                      {{ EM_DASH }}
                    }
                  </td>
                  <td><span class="badge-s {{ badgeClass(r.status) }}">{{ statusLabel(r.status) }}</span></td>
                  <td style="white-space: nowrap;">
                    @if (r.status === 'PENDING' && canEdit()) {
                      <button class="btn sm ghost" type="button" (click)="startPay(r)">Pay</button>
                      <button class="btn sm ghost" type="button" (click)="cancelExpense(r)">Cancel</button>
                    }
                  </td>
                </tr>
              }
              @if (!filteredExpenses().length) {
                <tr><td colspan="10" class="cell-sub">No company expenses match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class CompanyExpensesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly fileUpload = inject(FileUploadService);

  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;
  protected readonly EM_DASH = EM_DASH;
  protected readonly CUSTOM_PRESET = CUSTOM_PRESET;
  protected readonly formatMoney = formatMoney;
  protected readonly formatDate = formatDate;
  protected readonly badgeClass = badgeClass;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly isLoading = signal(true);
  protected readonly expenses = signal<readonly CompanyExpenseRow[]>([]);
  protected readonly expenseTypes = signal<readonly ExpenseTypeOption[]>([]);
  protected readonly vendors = signal<readonly VendorOption[]>([]);
  protected readonly purchaseBills = signal<readonly PurchaseBillOption[]>([]);
  protected readonly taxHeads = signal<readonly TaxHeadOption[]>([]);
  protected readonly bankAccounts = signal<readonly BankAccountOption[]>([]);
  protected readonly paymentModes = signal<readonly PaymentModeOption[]>([]);
  // §2.2c financial-year presets, fetched once for the Period filter below —
  // same buildDatePresets() source ListScreenComponent's own 'daterange'
  // filter kind reads, just wired by hand since this is a bespoke component.
  protected readonly financialYears = signal<readonly FinancialYearLike[]>([]);

  protected statusFilter: string[] = [];
  protected expenseTypeFilter = '';
  protected vendorFilter = '';
  protected search = '';
  protected bankAccountFilter = '';
  protected billingPeriodMonthFilter = '';
  protected billingPeriodYearFilter = '';
  // Period (expense Date range): still client-side — see the filter-row's
  // own comment for why (GET /company-expenses has no date_from/date_to).
  protected periodPreset = '';
  protected periodFrom = '';
  protected periodTo = '';

  protected readonly showForm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};
  protected selectedFile: File | null = null;

  protected readonly payingRow = signal<CompanyExpenseRow | null>(null);
  protected payForm: Record<string, unknown> = {};
  protected readonly paying = signal(false);
  protected readonly payError = signal<string | null>(null);

  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  // §2.4's own action bar toggle for the Export Statement card below — see
  // the page-actions button's own comment.
  protected readonly showStatementCard = signal(false);
  protected statementFrom = '';
  protected statementTo = '';
  protected readonly statementExporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly statementError = signal<string | null>(null);

  ngOnInit(): void {
    // Unfiltered — companyPaidTypes()/vendorLabel()'s own lookups need to
    // resolve EVERY row this screen might show, including one referencing a
    // since-deactivated type; is_active is applied only in the picker/filter
    // views below.
    // /options, not the gated masters.expense_types screen — that screen is
    // Manager/Super-Admin only (seed.py), so Accountant 404'd here and this
    // picker was empty for the role that owns this screen. claim_type rides
    // along deliberately (masters_lookup.py's options_extra_fields): the
    // read-only Claim Type field renders it, so a server-side filter could
    // not have supplied it.
    this.http
      .get<{ id: string; label: string; is_active: boolean; claim_type: string }[]>(
        `${environment.apiBaseUrl}/masters/expense-types/options`,
      )
      .subscribe({
        next: (rows) =>
          this.expenseTypes.set(
            rows.map((r) => ({ id: r.id, name: r.label, claim_type: r.claim_type, is_active: r.is_active })),
          ),
        error: () => this.expenseTypes.set([]),
      });
    // /options with scope + in-force window applied SERVER-side: this picker
    // only renders a head's name, so rate_pct, the cgst/sgst split,
    // fixed_amount and slab bands stay structurally unreachable here.
    this.http
      .get<{ id: string; label: string; is_active: boolean }[]>(
        `${environment.apiBaseUrl}/masters/taxes/options`,
        { params: { scope: ['PURCHASE', 'SALES_AND_PURCHASE'], in_force_on: this.today } },
      )
      .subscribe({
        next: (rows) => this.taxHeads.set(rows.map((r) => ({ id: r.id, tax_name: r.label, is_active: r.is_active }))),
        error: () => this.taxHeads.set([]),
      });
    // /options, not the gated masters.bank_accounts/payment_modes screens
    // (2026-08-11 RBAC audit fix) — Accountant, this screen's primary role
    // besides Super Admin, no longer holds standalone `view` on either.
    // include_inactive=true on bank accounts to keep resolving a since-
    // deactivated account on an older expense (unchanged from before).
    this.http.get<BankAccountOption[]>(`${environment.apiBaseUrl}/masters/bank-accounts/options?include_inactive=true`).subscribe({
      next: (rows) => this.bankAccounts.set(rows),
      error: () => this.bankAccounts.set([]),
    });
    this.http.get<PaymentModeOption[]>(`${environment.apiBaseUrl}/masters/payment-modes/options`).subscribe({
      next: (rows) => this.paymentModes.set(rows),
      error: () => this.paymentModes.set([]),
    });
    if (this.canSeeVendor()) {
      this.http.get<VendorOption[]>(`${environment.apiBaseUrl}/vendors?is_active=true`).subscribe({
        next: (rows) => this.vendors.set(rows),
        error: () => this.vendors.set([]),
      });
    }
    if (this.canSeePurchaseBill()) {
      this.http.get<PurchaseBillOption[]>(`${environment.apiBaseUrl}/purchase-bills`).subscribe({
        next: (rows) => this.purchaseBills.set(rows),
        error: () => this.purchaseBills.set([]),
      });
    }
    // For the Period filter's presets — a role that can't see Financial
    // Years just falls back to the calendar-only presets (buildDatePresets
    // degrades gracefully on an empty array), same as ListScreenComponent's
    // own 'daterange' filter kind.
    this.http.get<FinancialYearLike[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows ?? []),
      error: () => this.financialYears.set([]),
    });
    this.load();
  }

  // Create/Pay/Cancel share the one 'edit' action expense.company registers
  // — no split between them at the RBAC layer (this module's build brief).
  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected canSeeVendor(): boolean {
    return this.policy.canOpen('vendor.directory');
  }

  protected canSeePurchaseBill(): boolean {
    return this.policy.canOpen('purchase_bill.list');
  }

  protected companyPaidTypes(): readonly ExpenseTypeOption[] {
    return this.expenseTypes().filter((t) => t.is_active && t.claim_type === 'COMPANY_PAID');
  }

  // §2.1's own Claim Type field — read-only, carried from the selected
  // Expense Type's own claim_type (never chosen separately).
  protected selectedClaimTypeLabel(): string {
    const id = this.form['expense_type_id'] as string | null;
    if (!id) return EM_DASH;
    const t = this.expenseTypes().find((x) => x.id === id);
    if (!t) return EM_DASH;
    return t.claim_type === 'COMPANY_PAID' ? 'Company-Paid' : 'Reimbursable';
  }

  protected filteredTaxHeads(): readonly TaxHeadOption[] {
    const today = this.today;
    return this.taxHeads();
  }

  protected activeBankAccounts(): readonly BankAccountOption[] {
    return this.bankAccounts().filter((b) => b.is_active);
  }

  protected typeLabel(id: string): string {
    const t = this.expenseTypes().find((x) => x.id === id);
    return t ? t.name : id.slice(0, 8);
  }

  protected vendorLabel(id: string | null): string {
    if (!id) return EM_DASH;
    const v = this.vendors().find((x) => x.id === id);
    return v ? v.vendor_name : id.slice(0, 8);
  }

  // §2.4's own column table names "Linked Purchase Bill" — resolved from the
  // same purchaseBills() the Add form's own picker fetches (real
  // purchase_bill_code, not a truncated id) rather than a second endpoint.
  // Empty (never fetched at all) for a role that can't see purchase_bill.list
  // — falls back to the truncated id, same as elsewhere in this module.
  protected purchaseBillLabel(id: string | null): string {
    if (!id) return EM_DASH;
    const b = this.purchaseBills().find((x) => x.id === id);
    return b ? b.purchase_bill_code : id.slice(0, 8);
  }

  protected bankAccountName(id: string | null): string {
    if (!id) return EM_DASH;
    const b = this.bankAccounts().find((x) => x.id === id);
    return b ? b.label : id.slice(0, 8);
  }

  protected statusLabel(v: string): string {
    return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  protected presets(): readonly DatePreset[] {
    return buildDatePresets(this.financialYears());
  }

  protected onPeriodPresetChange(): void {
    if (this.periodPreset !== CUSTOM_PRESET) {
      this.periodFrom = '';
      this.periodTo = '';
    }
  }

  private effectiveDateRange(): { from: string | null; to: string | null } {
    if (!this.periodPreset) return { from: null, to: null };
    return resolveRange({ preset: this.periodPreset, from: this.periodFrom || null, to: this.periodTo || null }, this.presets());
  }

  // Period (expense Date range) layered client-side on top of the server-
  // filtered expenses() — see the filter-row's own comment for why. Export
  // (both buttons) follows every OTHER filter on this bar, unchanged by this one.
  protected filteredExpenses(): readonly CompanyExpenseRow[] {
    const range = this.effectiveDateRange();
    return this.expenses().filter((r) => withinRange(r.expense_date, range.from, range.to));
  }

  // Shared by load() and exportList() — keeps the list and its export in
  // agreement by construction.
  private listParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const s of this.statusFilter) params.append('status', s);
    if (this.expenseTypeFilter) params.set('expense_type_id', this.expenseTypeFilter);
    if (this.vendorFilter) params.set('vendor_id', this.vendorFilter);
    if (this.bankAccountFilter) params.set('paid_from_bank_account_id', this.bankAccountFilter);
    if (this.billingPeriodMonthFilter) params.set('billing_period_month', this.billingPeriodMonthFilter);
    if (this.billingPeriodYearFilter) params.set('billing_period_year', this.billingPeriodYearFilter);
    if (this.search) params.set('search', this.search);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.listParams().toString();
    this.http.get<CompanyExpenseRow[]>(`${environment.apiBaseUrl}/company-expenses${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.expenses.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startForm(): void {
    this.form = {
      expense_type_id: null,
      vendor_id: null,
      linked_purchase_bill_id: null,
      amount: null,
      tax_head_id: null,
      tax_amount: null,
      expense_date: this.today,
      billing_period_month: null,
      billing_period_year: null,
      description: '',
    };
    this.selectedFile = null;
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  protected submitForm(): void {
    const f = this.form;
    if (!f['expense_type_id'] || !f['amount'] || !f['expense_date']) {
      this.formError.set('Expense Type, Amount, and Expense Date are all required.');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    if (this.selectedFile) {
      this.fileUpload.upload(this.selectedFile, 'expense_receipt').subscribe({
        next: (uploaded) => this.postExpense(uploaded.id),
        error: (err) => {
          this.submitting.set(false);
          this.formError.set(err?.error?.detail ?? 'Failed to upload the attached bill.');
        },
      });
    } else {
      this.postExpense(null);
    }
  }

  private postExpense(billFileId: string | null): void {
    const f = this.form;
    const body = {
      expense_type_id: f['expense_type_id'],
      vendor_id: f['vendor_id'] || null,
      linked_purchase_bill_id: f['linked_purchase_bill_id'] || null,
      amount: f['amount'],
      tax_head_id: f['tax_head_id'] || null,
      tax_amount: f['tax_amount'] || null,
      expense_date: f['expense_date'],
      billing_period_month: f['billing_period_month'] || null,
      billing_period_year: f['billing_period_year'] || null,
      description: f['description'] || null,
      bill_stored_file_id: billFileId,
    };
    this.http.post(`${environment.apiBaseUrl}/company-expenses`, body).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showForm.set(false);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        const detail = err?.error?.detail;
        this.formError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to submit.');
      },
    });
  }

  protected viewBill(r: CompanyExpenseRow): void {
    if (!r.bill_stored_file_id) return;
    this.actionError.set(null);
    this.fileUpload.fetch(r.bill_stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Could not open that bill.'),
    });
  }

  protected startPay(row: CompanyExpenseRow): void {
    this.payForm = { paid_from_bank_account_id: null, payment_mode_id: null, payment_reference: '' };
    this.payError.set(null);
    this.payingRow.set(row);
  }

  protected cancelPay(): void {
    this.payingRow.set(null);
  }

  // §0.3 of this module's build brief, explicit: /company-expenses/{id}/pay
  // takes QUERY PARAMS, not a JSON body (pay_company_expense's own signature
  // has no `body:` parameter at all) — an empty-object POST body here would
  // 422 if this were built the usual way.
  protected submitPay(): void {
    const row = this.payingRow();
    if (!row) return;
    const f = this.payForm;
    if (!f['paid_from_bank_account_id'] || !f['payment_mode_id']) {
      this.payError.set('Paid From Bank Account and Payment Mode are both required.');
      return;
    }
    this.paying.set(true);
    this.payError.set(null);
    const params = new URLSearchParams();
    params.set('paid_from_bank_account_id', String(f['paid_from_bank_account_id']));
    params.set('payment_mode_id', String(f['payment_mode_id']));
    if (f['payment_reference']) params.set('payment_reference', String(f['payment_reference']));
    this.http.post(`${environment.apiBaseUrl}/company-expenses/${row.id}/pay?${params.toString()}`, {}).subscribe({
      next: () => {
        this.paying.set(false);
        this.payingRow.set(null);
        this.load();
      },
      error: (err) => {
        this.paying.set(false);
        this.payError.set(err?.error?.detail ?? 'Failed to record this payment.');
      },
    });
  }

  // Same query-param treatment as Pay above (cancel_company_expense also
  // takes no body) — the reason parameter is optional, so it's only ever
  // appended when the user actually typed one (never sending the literal
  // string "null").
  protected cancelExpense(row: CompanyExpenseRow): void {
    if (!window.confirm('Cancel this company expense?')) return;
    const reason = window.prompt('Reason for cancelling (optional):', '');
    this.actionError.set(null);
    const qs = reason ? `?cancellation_reason=${encodeURIComponent(reason)}` : '';
    this.http.post(`${environment.apiBaseUrl}/company-expenses/${row.id}/cancel${qs}`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to cancel this expense.'),
    });
  }

  protected exportList(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.listParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/company-expenses?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Company Expenses.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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

  protected exportStatement(format: 'pdf' | 'excel'): void {
    if (this.statementExporting()) return;
    this.statementExporting.set(format);
    this.statementError.set(null);
    const params = new URLSearchParams();
    if (this.statementFrom) params.set('date_from', this.statementFrom);
    if (this.statementTo) params.set('date_to', this.statementTo);
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/company-expenses/export-statement?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.statementExporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Company Expense Statement.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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
        this.statementExporting.set(null);
        this.statementError.set('Failed to export.');
      },
    });
  }
}
