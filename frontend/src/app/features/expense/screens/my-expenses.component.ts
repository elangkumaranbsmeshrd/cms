import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, badgeClass, formatDate, formatMoney } from '../../../shared/screens/cell-format';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { BankAccountOption, ExpenseClaimRow, ExpenseTypeOption, PurchaseBillOption, TaxHeadOption, VendorOption } from '../expense.api';

const SCREEN = 'expense.my_expenses';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  // §6.1 "Allow Manager to Approve Their Team's Expenses" — the claimant's
  // own view of the same intermediate step Expense Approvals shows.
  { value: 'MGR_APPROVED', label: 'Manager Approved' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REIMBURSED', label: 'Reimbursed' },
];

interface FinancialYearOption {
  readonly id: string;
  readonly label: string;
}

/** §2.1 My Expenses (expense.my_expenses) — own history table + inline Add
 * Expense form + two SEPARATE hand-rolled exports, bespoke on the same
 * class as my-leave.component.ts (its direct template per this module's
 * build brief): a history table, a signal-based toggle-shown inline form, a
 * Status filter, and its own export buttons, none of which fit any generic
 * shape (no GET-by-id endpoint exists anywhere on this resource, ruling out
 * 'record'/'document').
 *
 * §2.2's own note carried over from the RBAC registry: expense.my_expenses
 * registers ZERO actions (`actions=()`), so "+ Add Expense" is gated on
 * canOpen(SCREEN) alone — canOpen+can('edit') or any other action name would
 * evaluate false for every role, including Super Admin, and hide the button
 * permanently.
 */
@Component({
  selector: 'app-my-expenses',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Expenses</h1>
        <p class="page-sub">Your submitted expense claims and their reimbursement status.</p>
      </div>
      <div class="page-actions">
        @if (canAdd() && !showForm()) {
          <button class="btn sm primary" type="button" (click)="startForm()">+ Add Expense</button>
        }
        <!-- §2.1's own action bar (data.js) is just these two buttons —
             "+ Add Expense" and "Export Statement" side by side. The real
             bank-statement export needs a date range the prototype's mock
             never had to model, so this toggles the card below rather than
             firing immediately — placement now matches, the real inputs stay. -->
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
          <div class="card-head"><h3>Add Expense</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Expense Type</div>
                <select class="input" [(ngModel)]="form['expense_type_id']">
                  <option [value]="null">—</option>
                  @for (t of addFormExpenseTypes(); track t.id) {
                    <option [value]="t.id">{{ t.name }}</option>
                  }
                </select>
              </div>
              <!-- §2.1's own field table: "Claim Type, ro, carried from the
                   Type — never chosen separately." Derived from
                   ExpenseTypeOption.claim_type, already fetched for the
                   dropdown above; no separate endpoint needed. -->
              <div>
                <div class="cell-sub">Claim Type</div>
                <div class="cell-strong">{{ selectedClaimTypeLabel() }}</div>
              </div>
              <div>
                <div class="cell-sub">Vendor</div>
                <select class="input" [(ngModel)]="form['vendor_id']">
                  <option [value]="null">—</option>
                  @for (v of vendors(); track v.id) {
                    <option [value]="v.id">{{ v.vendor_name }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">Amount</div>
                <input class="input" type="number" step="0.01" min="0" [(ngModel)]="form['amount']" />
              </div>
              <!-- §2.1 field order (data.js x.add), verbatim: Type, Claim
                   Type, Vendor, Amount, Tax, Tax Amount, Date, Linked
                   Purchase Bill, Description, Receipt — Tax/Tax Amount sit
                   BEFORE Date, not after. -->
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
              <div style="grid-column: span 2;">
                <div class="cell-sub">Description</div>
                <textarea class="input" rows="2" [(ngModel)]="form['description']"></textarea>
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Receipt</div>
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

      @if (showStatementCard()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Export Statement</h3></div>
          <div class="card-body">
            <p class="hint" style="margin: 0 0 10px;">Bank-statement style export — Date, Description, Bank Account, Reference, Debit, Running Balance — covering only Reimbursed claims in the range below, so a claim history can be reconciled line-by-line against the real account statement.</p>
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
          <h3>Expense History</h3>
          <div class="filter-row" style="flex-wrap: wrap;">
            <!-- addFormExpenseTypes(), not reimbursableTypes() — Super Admin/
                 Accountant's OWN history can include a Company-Paid claim
                 they submitted themselves (create_expense_claim sets
                 employee_id: own_id on that branch too), so the filter
                 needs to offer the same set the Add form itself does. -->
            <select class="input sm" [(ngModel)]="expenseTypeFilter" (ngModelChange)="load()">
              <option value="">All Expense Types</option>
              @for (t of addFormExpenseTypes(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            <select class="input sm" multiple [(ngModel)]="statusFilter" (ngModelChange)="load()" title="Ctrl/Cmd-click to select multiple statuses">
              @for (s of STATUS_OPTIONS; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
            <select class="input sm" [(ngModel)]="vendorFilter" (ngModelChange)="load()" title="Vendor">
              <option value="">All Vendors</option>
              @for (v of vendors(); track v.id) {
                <option [value]="v.id">{{ v.vendor_name }}</option>
              }
            </select>
            <select class="input sm" [(ngModel)]="bankAccountFilter" (ngModelChange)="load()" title="Bank Account">
              <option value="">All Accounts</option>
              @for (b of bankAccounts(); track b.id) {
                <option [value]="b.id">{{ b.label }}</option>
              }
            </select>
            <select class="input sm" [(ngModel)]="financialYearFilter" (ngModelChange)="load()" title="Financial Year">
              <option value="">All Financial Years</option>
              @for (fy of financialYears(); track fy.id) {
                <option [value]="fy.id">{{ fy.label }}</option>
              }
            </select>
            <select class="input sm" [(ngModel)]="hasReceiptFilter" (ngModelChange)="load()" title="Has Receipt">
              <option value="">Receipt — Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <input class="input sm" type="date" [(ngModel)]="dateFromFilter" (ngModelChange)="load()" [max]="today" title="Expense Date from" />
            <input class="input sm" type="date" [(ngModel)]="dateToFilter" (ngModelChange)="load()" [max]="today" title="Expense Date to" />
            <input class="input sm" type="number" min="0" step="0.01" [(ngModel)]="amountMinFilter" (ngModelChange)="load()" placeholder="Min Amount" style="width: 110px;" />
            <input class="input sm" type="number" min="0" step="0.01" [(ngModel)]="amountMaxFilter" (ngModelChange)="load()" placeholder="Max Amount" style="width: 110px;" />
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
                <th>Description</th>
                <th>Linked Purchase Bill</th>
                <th class="r">Amount</th>
                <th>Bank Account</th>
                <th>Date</th>
                <th>Receipt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (c of claims(); track c.id) {
                <tr>
                  <td class="cell-strong">{{ c.expense_type_name_snapshot }}</td>
                  <td>{{ vendorLabel(c.vendor_id) }}</td>
                  <td>{{ c.description }}</td>
                  <td class="mono">{{ purchaseBillLabel(c.linked_purchase_bill_id) }}</td>
                  <td class="mono r">{{ formatMoney(c.amount) }}</td>
                  <td>{{ bankAccountName(c.bank_account_id) }}</td>
                  <td class="mono">{{ formatDate(c.expense_date) }}</td>
                  <td>
                    @if (c.has_receipt) {
                      <button class="btn sm ghost" type="button" (click)="viewReceipt(c)">View Receipt</button>
                    } @else {
                      {{ EM_DASH }}
                    }
                  </td>
                  <td><span class="badge-s {{ badgeClass(c.status) }}">{{ statusLabel(c.status) }}</span></td>
                </tr>
              }
              @if (!claims().length) {
                <tr><td colspan="9" class="cell-sub">No expense claims match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class MyExpensesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly session = inject(SessionStore);
  private readonly fileUpload = inject(FileUploadService);

  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;
  protected readonly EM_DASH = EM_DASH;
  protected readonly formatMoney = formatMoney;
  protected readonly formatDate = formatDate;
  protected readonly badgeClass = badgeClass;
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly isLoading = signal(true);
  protected readonly claims = signal<readonly ExpenseClaimRow[]>([]);
  protected readonly expenseTypes = signal<readonly ExpenseTypeOption[]>([]);
  protected readonly vendors = signal<readonly VendorOption[]>([]);
  protected readonly purchaseBills = signal<readonly PurchaseBillOption[]>([]);
  protected readonly taxHeads = signal<readonly TaxHeadOption[]>([]);
  protected readonly bankAccounts = signal<readonly BankAccountOption[]>([]);
  protected readonly financialYears = signal<readonly FinancialYearOption[]>([]);

  protected statusFilter: string[] = [];
  protected expenseTypeFilter = '';
  protected vendorFilter = '';
  protected bankAccountFilter = '';
  protected financialYearFilter = '';
  protected hasReceiptFilter = '';
  protected dateFromFilter = '';
  protected dateToFilter = '';
  protected amountMinFilter = '';
  protected amountMaxFilter = '';

  protected readonly showForm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};
  protected selectedFile: File | null = null;

  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  // §2.1's own action bar toggle for the Export Statement card below — see
  // the page-actions button's own comment.
  protected readonly showStatementCard = signal(false);
  protected statementFrom = '';
  protected statementTo = '';
  protected readonly statementExporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly statementError = signal<string | null>(null);

  ngOnInit(): void {
    // Unfiltered — is_active is applied only where a picker/filter view
    // needs it (addFormExpenseTypes()), never at fetch time, so a claim
    // referencing a since-deactivated type still resolves
    // to its real name via expense_type_name_snapshot (which needs no
    // lookup at all — kept unfiltered here purely for the picker helpers).
    // /options, not the gated masters.expense_types screen — that screen is
    // Manager/Super-Admin only (seed.py), so Accountant and HR 404'd here and
    // the picker was simply empty for two of the roles that use this screen
    // most. claim_type rides along deliberately (masters_lookup.py's
    // options_extra_fields): §2.1's read-only Claim Type field renders it, so
    // a server-side filter could not have supplied it.
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
    // /options, not the gated masters.bank_accounts screen (2026-08-11 RBAC
    // audit fix) — Employee never had standalone `view` on that screen
    // either, so this was silently always empty before. include_inactive=
    // true so a Reimbursed claim's own bank account still resolves even if
    // that account has since been deactivated; activeBankAccounts() below is
    // the client-filtered view a future Pay/Reimburse-style picker would use.
    this.http.get<BankAccountOption[]>(`${environment.apiBaseUrl}/masters/bank-accounts/options?include_inactive=true`).subscribe({
      next: (rows) => this.bankAccounts.set(rows),
      error: () => this.bankAccounts.set([]),
    });
    // /options with the scope + in-force window applied SERVER-side. The
    // picker only ever renders a head's name, so scope/applies_from/
    // applies_until never need to cross the wire — which keeps rate_pct, the
    // cgst/sgst split, fixed_amount and slab bands structurally unreachable
    // through this route. The server also owns "today", which is the more
    // authoritative clock for an in-force test than the browser's.
    this.http
      .get<{ id: string; label: string; is_active: boolean }[]>(
        `${environment.apiBaseUrl}/masters/taxes/options`,
        { params: { scope: ['PURCHASE', 'SALES_AND_PURCHASE'], in_force_on: this.today } },
      )
      .subscribe({
        next: (rows) => this.taxHeads.set(rows.map((r) => ({ id: r.id, tax_name: r.label, is_active: r.is_active }))),
        error: () => this.taxHeads.set([]),
      });
    // /options, not the gated vendor.directory screen — same 2026-08-11 RBAC
    // audit fix as Bank Account/Payment Mode/HSN's own picker endpoints.
    // vendor.directory is 'none' for HR/Employee (seed.py), but Vendor is an
    // optional field on THIS screen's own shared baseline — "nobody's access
    // to their own expenses should ever be narrower than a plain Employee's"
    // (§6) — so gating the picker on the full directory permission silently
    // broke it for exactly those 2 roles. vendors.py's list_vendor_options
    // returns {id, label, is_active}; mapped onto VendorOption's existing
    // {id, vendor_name} shape here so vendorLabel()/the template below need
    // no changes.
    this.http.get<{ id: string; label: string; is_active: boolean }[]>(`${environment.apiBaseUrl}/vendors/options`).subscribe({
      next: (rows) => this.vendors.set(rows.map((r) => ({ id: r.id, vendor_name: r.label }))),
      error: () => this.vendors.set([]),
    });
    if (this.canSeePurchaseBill()) {
      this.http.get<PurchaseBillOption[]>(`${environment.apiBaseUrl}/purchase-bills`).subscribe({
        next: (rows) => this.purchaseBills.set(rows),
        error: () => this.purchaseBills.set([]),
      });
    }
    this.http.get<FinancialYearOption[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows),
      error: () => this.financialYears.set([]),
    });
    this.load();
  }

  protected canAdd(): boolean {
    return this.policy.canOpen(SCREEN);
  }

  // Same gap, Purchase Bill (purchase_bill.list) is 'none' for Manager/HR/Employee.
  protected canSeePurchaseBill(): boolean {
    return this.policy.canOpen('purchase_bill.list');
  }

  // §2.1 field table, verbatim (also enforced server-side in create_expense_
  // claim): Company-Paid types are offered only to Super Admin/Accountant,
  // even from this own-scoped screen.
  protected addFormExpenseTypes(): readonly ExpenseTypeOption[] {
    const privileged = this.session.role() === 'SUPER_ADMIN' || this.session.role() === 'ACCOUNTANT';
    return this.expenseTypes().filter((t) => t.is_active && (t.claim_type === 'REIMBURSABLE' || privileged));
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

  /** Scope and the in-force window are now applied by the server (see the
   * /options fetch above), so nothing is left to filter here. */
  protected filteredTaxHeads(): readonly TaxHeadOption[] {
    return this.taxHeads();
  }

  protected vendorLabel(id: string | null): string {
    if (!id) return EM_DASH;
    const v = this.vendors().find((x) => x.id === id);
    return v ? v.vendor_name : id.slice(0, 8);
  }

  // §2.1: linked_purchase_bill_id has no name/code denormalized onto
  // ExpenseClaimOut at all — the truncated id is the honest stand-in here
  // (same treatment emp.documents.list.config.ts's own fileLabel() gives
  // file_id), distinct from the Add form's own picker, which CAN show
  // purchase_bill_code because it's built from a fresh, purpose-fetched list.
  protected purchaseBillLabel(id: string | null): string {
    return id ? id.slice(0, 8) : EM_DASH;
  }

  protected bankAccountName(id: string | null): string {
    if (!id) return EM_DASH;
    const b = this.bankAccounts().find((x) => x.id === id);
    return b ? b.label : id.slice(0, 8);
  }

  protected statusLabel(v: string): string {
    return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  // Shared by load() and exportList() — keeps the list and its export in
  // agreement by construction, same reasoning as create-list-store.ts's own
  // serverParams(). All ten now round-trip to GET /expenses/me for real
  // (expenses.py's list_my_expenses).
  private listParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const s of this.statusFilter) params.append('status', s);
    if (this.expenseTypeFilter) params.set('expense_type_id', this.expenseTypeFilter);
    if (this.vendorFilter) params.set('vendor_id', this.vendorFilter);
    if (this.bankAccountFilter) params.set('bank_account_id', this.bankAccountFilter);
    if (this.financialYearFilter) params.set('financial_year_id', this.financialYearFilter);
    if (this.hasReceiptFilter) params.set('has_receipt', this.hasReceiptFilter);
    if (this.dateFromFilter) params.set('date_from', this.dateFromFilter);
    if (this.dateToFilter) params.set('date_to', this.dateToFilter);
    if (this.amountMinFilter) params.set('amount_min', this.amountMinFilter);
    if (this.amountMaxFilter) params.set('amount_max', this.amountMaxFilter);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.listParams().toString();
    this.http.get<ExpenseClaimRow[]>(`${environment.apiBaseUrl}/expenses/me${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.claims.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startForm(): void {
    this.form = {
      expense_type_id: null,
      vendor_id: null,
      amount: null,
      tax_head_id: null,
      tax_amount: null,
      expense_date: this.today,
      linked_purchase_bill_id: null,
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
    if (!f['expense_type_id'] || !f['amount'] || !f['expense_date'] || !f['description']) {
      this.formError.set('Expense Type, Amount, Expense Date, and Description are all required.');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    if (this.selectedFile) {
      this.fileUpload.upload(this.selectedFile, 'expense_receipt').subscribe({
        next: (uploaded) => this.postClaim(uploaded.id),
        error: (err) => {
          this.submitting.set(false);
          this.formError.set(err?.error?.detail ?? 'Failed to upload the receipt.');
        },
      });
    } else {
      this.postClaim(null);
    }
  }

  private postClaim(receiptFileId: string | null): void {
    const f = this.form;
    const body = {
      expense_type_id: f['expense_type_id'],
      vendor_id: f['vendor_id'] || null,
      amount: f['amount'],
      tax_head_id: f['tax_head_id'] || null,
      tax_amount: f['tax_amount'] || null,
      expense_date: f['expense_date'],
      linked_purchase_bill_id: f['linked_purchase_bill_id'] || null,
      description: f['description'],
      receipt_stored_file_id: receiptFileId,
    };
    this.http.post(`${environment.apiBaseUrl}/expenses`, body).subscribe({
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

  protected viewReceipt(c: ExpenseClaimRow): void {
    if (!c.receipt_stored_file_id) return;
    this.actionError.set(null);
    this.fileUpload.fetch(c.receipt_stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Could not open that receipt.'),
    });
  }

  protected exportList(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.listParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/expenses/me?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `My Expenses.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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
    const url = `${environment.apiBaseUrl}/expenses/export-statement?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.statementExporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `My Expense Statement.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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
