import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatMoney } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { BANK_ACCOUNT_REF, PAYMENT_MODE_REF, PurchaseBillPaymentCreateBody, PurchaseBillRow } from '../purchase-bill.api';

const SCREEN = 'purchase_bill.list';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Minimal shape read off GET /vendors/{id} (backend/app/schemas/vendor.py's
// VendorOut) — just enough for the read-only "Paid Into (Vendor's Account)"
// field below (prototype/data.js's billpayment form, l: "Paid Into (Vendor's
// Account)", ro:1, e.g. "HDFC ••••2201"). bank_account_number_masked is a
// DB-computed column already shaped exactly like that example ("<bank name>
// ••••<last 4>" — models/vendor.py's own Computed(...) expression), so no
// client-side formatting is needed. Declared locally rather than importing
// VendorRow from the vendor feature folder, to keep this module's own
// changes scoped to features/purchase-bill/ per this pass's own constraints.
interface VendorBankSnapshot {
  readonly bank_account_number_masked?: string | null;
  readonly has_bank_details: boolean;
}

/** §2.3 Record Payment — bespoke, no shape fits (a small standalone routed
 * form reading its parent bill first, same convention
 * invoice.record-payment.component.ts uses for the identical "load one
 * parent record, then a small form against it" situation). Reached only
 * from Purchase Bill's own Record Payment action
 * (purchase-bill.document.config.ts), visible only while Status is not Paid.
 *
 * The route guard only checks purchase_bill.list's own VISIBILITY — not this
 * specific 'record_payment' action — so canRecordPayment() re-checks it
 * independently here, same as invoice.record-payment.component.ts's own
 * canRecordPayment().
 *
 * Unlike Invoice's own payment form, PurchaseBillPaymentCreate carries no
 * withholding fields at all (schemas/finance.py) — withholding on a
 * Purchase Bill is fixed at bill Create/Edit time, never re-entered at
 * payment time — so the editable part of this form is genuinely simpler:
 * Amount / Mode / Paid From / Date / Reference, nothing else. "Paid Into"
 * (the vendor's own bank details) is never an INPUT here — it's resolved
 * and snapshotted entirely server-side onto the created payment record
 * (record_payment's own paid_into_*_snapshot columns,
 * api/v1/purchase_bills.py), so nothing here can change it. It IS shown,
 * read-only, matching prototype/data.js's own billpayment form (l: "Paid
 * Into (Vendor's Account)", ro:1, lock: 'From the vendor record') — fetched
 * live from GET /vendors/{vendor_id} purely for display, since the vendor's
 * bank details aren't already on the bill/PurchaseBillRow itself.
 */
@Component({
  selector: 'app-purchase-bill-record-payment',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Record Payment <span class="spec-ref">§2.3</span></h1>
        @if (bill(); as b) {
          <p class="page-sub">{{ b.purchase_bill_code }} — {{ b.vendor_name_snapshot }}</p>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this purchase bill</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else if (!canRecordPayment()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to record payments.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (bill(); as b) {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-body grid g-2">
          <div class="field">
            <div class="cell-sub">Balance Due</div>
            <div class="cell-strong">{{ formatMoney(b.balance_due) }}</div>
          </div>
          @if (b.withholding_amount > 0) {
            <div class="field">
              <div class="cell-sub">Withheld on this Bill</div>
              <div>{{ formatMoney(b.withholding_amount) }}</div>
            </div>
          }
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label>Amount <span class="req">*</span></label>
              <input class="input" type="number" step="0.01" [(ngModel)]="form['amount']" />
              <div class="hint">Cannot exceed the balance due of {{ formatMoney(b.balance_due) }}.</div>
            </div>
            <div class="field">
              <label>Mode <span class="req">*</span></label>
              <select class="input" [(ngModel)]="form['payment_mode_id']">
                <option [ngValue]="null">—</option>
                @for (opt of paymentModeOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label>Paid From (Meshrd Account)</label>
              <select class="input" [(ngModel)]="form['paid_from_bank_account_id']">
                <option [ngValue]="null">—</option>
                @for (opt of bankAccountOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Defaults to the bill's own bank account when left as shown.</div>
            </div>
            <div class="field">
              <label>Paid Into (Vendor's Account)</label>
              <div class="readonly-value">{{ paidIntoDisplay() }}</div>
              <div class="hint">The vendor's own bank account, from Vendor → Bank Details. Change it there, not here.</div>
            </div>
            <div class="field">
              <label>Date <span class="req">*</span></label>
              <input class="input" type="date" [(ngModel)]="form['payment_date']" />
            </div>
            <div class="field span-2">
              <label>Reference</label>
              <input class="input" type="text" placeholder="Optional" [(ngModel)]="form['reference']" />
            </div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
          <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Recording…' : 'Record Payment' }}
          </button>
        </div>
      </div>
      }
    }
  `,
})
export class PurchaseBillRecordPaymentComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);

  protected readonly formatMoney = formatMoney;

  private readonly billId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly bill = signal<PurchaseBillRow | null>(null);
  // Fetched separately (GET /vendors/{vendor_id}) purely to display "Paid
  // Into (Vendor's Account)" below — PurchaseBillRow itself carries no
  // vendor banking fields. null while loading/on fetch failure; the display
  // getter degrades to an em dash rather than blocking the payment form on
  // it, since this is informational only and never part of the POST body.
  protected readonly vendor = signal<VendorBankSnapshot | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  // Plain mutable object, not a signal — [(ngModel)] needs a real assignable
  // target; bracket notation throughout the template, never dot notation
  // (ng build's template checker rejects `form.key` on Record<string, unknown>).
  protected form: Record<string, unknown> = {
    amount: null,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_mode_id: null,
    paid_from_bank_account_id: null,
    reference: '',
  };

  constructor() {
    if (!this.billId) {
      this.loadError.set('No purchase bill id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<PurchaseBillRow>(`${environment.apiBaseUrl}/purchase-bills/${this.billId}`).subscribe({
      next: (row) => {
        this.bill.set(row);
        // Pre-fills the visible default rather than leaving the select blank
        // and relying on the server's own fallback (record_payment's own
        // `body.paid_from_bank_account_id or bill.bank_account_id`,
        // api/v1/purchase_bills.py) — effective_bank_account_id already
        // carries that exact fallback (the latest payment's own account, or
        // the bill's own bank_account_id — see PurchaseBillRow's own doc
        // comment), so it alone is the right default to show; bank_account_id
        // is only a defensive second fallback in case effective_bank_account_id
        // itself ever comes back unset.
        this.form['paid_from_bank_account_id'] = row.effective_bank_account_id ?? row.bank_account_id ?? null;
        this.isLoading.set(false);
        // Best-effort — a failed/forbidden vendor lookup just leaves the
        // "Paid Into" field showing "Not on file" (paidIntoDisplay() below),
        // it never blocks recording the payment itself.
        this.http.get<VendorBankSnapshot>(`${environment.apiBaseUrl}/vendors/${row.vendor_id}`).subscribe({
          next: (v) => this.vendor.set(v),
          error: () => this.vendor.set(null),
        });
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this purchase bill.');
        this.isLoading.set(false);
      },
    });
  }

  protected canRecordPayment(): boolean {
    return this.policy.can(SCREEN, 'record_payment');
  }

  protected paymentModeOptions() {
    return this.refData.options(PAYMENT_MODE_REF) ?? [];
  }

  protected bankAccountOptions() {
    return this.refData.options(BANK_ACCOUNT_REF) ?? [];
  }

  // bank_account_number_masked already prints "<bank> ••••<last 4>" —
  // matching prototype/data.js's own example value verbatim ("HDFC ••••2201").
  protected paidIntoDisplay(): string {
    const v = this.vendor();
    if (!v) return '—';
    if (!v.has_bank_details || !v.bank_account_number_masked) return 'Not on file';
    return v.bank_account_number_masked;
  }

  protected save(): void {
    const bill = this.bill();
    if (!bill) return;
    const missing: string[] = [];
    if (!this.form['amount'] || num(this.form['amount']) <= 0) missing.push('Amount');
    if (!this.form['payment_mode_id']) missing.push('Mode');
    if (!this.form['payment_date']) missing.push('Date');
    if (missing.length) {
      this.saveError.set(`Required: ${missing.join(', ')}.`);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (String(this.form['payment_date']) > today) {
      this.saveError.set('Date cannot be in the future.');
      return;
    }
    // §2.3's own client-side check — the server enforces the identical rule
    // (record_payment's own 422, api/v1/purchase_bills.py: "Amount cannot
    // exceed the balance due of {bill.balance_due}"), this just surfaces it
    // before a round trip.
    if (num(this.form['amount']) > num(bill.balance_due)) {
      this.saveError.set(`Amount cannot exceed the balance due of ${formatMoney(bill.balance_due)}.`);
      return;
    }

    const body: PurchaseBillPaymentCreateBody = {
      amount: num(this.form['amount']),
      payment_mode_id: this.form['payment_mode_id'] as string,
      paid_from_bank_account_id: (this.form['paid_from_bank_account_id'] as string) || null,
      payment_date: String(this.form['payment_date']),
      reference: (this.form['reference'] as string)?.trim() || null,
    };

    this.saving.set(true);
    this.saveError.set(null);
    this.http.post(`${environment.apiBaseUrl}/purchase-bills/${this.billId}/payments`, body).subscribe({
      next: () => this.router.navigate(['/purchase-bills', this.billId]),
      error: (err) => {
        this.saving.set(false);
        // Surfaced as-is — e.g. the double-payment guard's own message
        // (finance_link_guard.check_purchase_bill_payment_guard, fired when
        // the bill's linked Expense Claim already has a live reimbursement)
        // or the bill-status 409 (record_payment's own, api/v1/purchase_bills.py)
        // — not duplicated client-side beyond the basic checks above.
        this.saveError.set(err?.error?.detail ?? 'Could not record this payment.');
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/purchase-bills', this.billId]);
  }
}
