import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatMoney } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import {
  BANK_ACCOUNT_REF,
  InvoicePaymentCreateBody,
  InvoicePaymentRow,
  InvoiceRow,
  PAYMENT_MODE_REF,
  TAX_REF,
  WITHHOLDING_CALCULATED_ON_OPTIONS,
} from '../invoice.api';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

const SCREEN = 'invoice.list';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** §2.4 Record Payment — bespoke, no shape fits (a small standalone routed
 * form reading its parent invoice first, same convention
 * ticket.reassign.component.ts uses for the identical "load one parent
 * record, then a small form against it" situation). Reached only from
 * Invoice's own Record Payment action (invoice.document.config.ts), visible
 * only while Status is Sent or Part-Paid.
 */
@Component({
  selector: 'app-invoice-record-payment',
  standalone: true,
  imports: [FormsModule, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Record Payment <span class="spec-ref">§2.4</span></h1>
        @if (invoice(); as inv) {
          <p class="page-sub">{{ inv.invoice_number }} — {{ inv.customer_name_snapshot }}</p>
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
        <p><b>Couldn't load this invoice</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else if (!canRecordPayment()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to record payments.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (invoice(); as inv) {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }

      @if (payments().length) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Payment History</h3></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount Received</th>
                  <th>Withheld</th>
                  <th>Status</th>
                  <th>Reference</th>
                  @if (canRecordPayment()) {
                    <th style="text-align: right;">Actions</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (p of payments(); track p.id) {
                  <tr>
                    <td class="mono">{{ p.payment_date }}</td>
                    <td>{{ formatMoney(p.amount_received) }}</td>
                    <td>{{ p.withheld_amount > 0 ? formatMoney(p.withheld_amount) : '—' }}</td>
                    <td>
                      <span class="badge-s {{ p.status === 'REVERSED' ? 'b-danger' : 'b-ok' }}">{{ p.status === 'REVERSED' ? 'Reversed' : 'Recorded' }}</span>
                    </td>
                    <td>{{ p.reference || '—' }}</td>
                    @if (canRecordPayment()) {
                      <td style="text-align: right; white-space: nowrap;">
                        @if (p.status === 'RECORDED' && canReverse()) {
                          <button class="btn sm ghost" type="button" [disabled]="reversingId() === p.id" (click)="reversePayment(p)">
                            {{ reversingId() === p.id ? 'Reversing…' : 'Reverse' }}
                          </button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-body grid g-2">
          <div class="field">
            <div class="cell-sub">Balance Due</div>
            <div class="cell-strong">{{ formatMoney(inv.balance_due) }}</div>
          </div>
          @if (inv.withheld_total > 0) {
            <div class="field">
              <div class="cell-sub">Withheld So Far</div>
              <div>{{ formatMoney(inv.withheld_total) }}</div>
            </div>
          }
          <div class="field">
            <div class="cell-sub">Amount Settled (this payment)</div>
            <div class="cell-strong">{{ formatMoney(amountSettled()) }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label>Amount Received <span class="req">*</span></label>
              <input class="input" type="number" step="0.01" [(ngModel)]="form['amount_received']" />
            </div>
            <div class="field">
              <label>Payment Date <span class="req">*</span></label>
              <input class="input" type="date" [(ngModel)]="form['payment_date']" />
            </div>
            <div class="field">
              <label>Payment Mode <span class="req">*</span></label>
              <select class="input" [(ngModel)]="form['payment_mode_id']">
                <option [ngValue]="null">—</option>
                @for (opt of paymentModeOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label>Received Into Bank Account</label>
              <select class="input" [(ngModel)]="form['received_into_bank_account_id']">
                <option [ngValue]="null">—</option>
                @for (opt of bankAccountOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Defaults to the invoice's own bank account when left as shown.</div>
            </div>
            <div class="field">
              <label>Customer Withheld Tax Head</label>
              <select class="input" [(ngModel)]="form['customer_withheld_tax_head_id']">
                <option [ngValue]="null">—</option>
                @for (opt of taxHeadOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">Only where the customer has withheld tax at source before paying.</div>
            </div>
            @if (form['customer_withheld_tax_head_id']) {
              <div class="field">
                <label>Withholding Calculated On</label>
                <select class="input" [(ngModel)]="form['withholding_calculated_on']">
                  <option [ngValue]="null">Defaults to Subtotal</option>
                  @for (opt of WITHHOLDING_OPTIONS; track opt.value) {
                    <option [ngValue]="opt.value">{{ opt.label }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label>Withheld Amount</label>
                <input class="input" type="number" step="0.01" [(ngModel)]="form['withheld_amount']" />
              </div>
            }
            <div class="field span-2">
              <label>Reference</label>
              <input class="input" type="text" placeholder="Transaction ID or cheque number" [(ngModel)]="form['reference']" />
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
export class InvoiceRecordPaymentComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);

  protected readonly formatMoney = formatMoney;
  protected readonly WITHHOLDING_OPTIONS = WITHHOLDING_CALCULATED_ON_OPTIONS;

  private readonly invoiceId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly invoice = signal<InvoiceRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  // Payment History — GET /invoices/{id}/payments existed backend-only
  // (§2.4: "A payment-history read... is also built") with nowhere on the
  // frontend that showed it. Surfaced here since Reverse (below) is
  // meaningless without a way to see and pick which payment to undo.
  protected readonly payments = signal<readonly InvoicePaymentRow[]>([]);
  protected readonly reversingId = signal<string | null>(null);

  // Plain mutable object, not a signal — [(ngModel)] needs a real assignable
  // target; bracket notation throughout the template, never dot notation
  // (ng build's template checker rejects `form.key` on Record<string, unknown>).
  protected form: Record<string, unknown> = {
    amount_received: null,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_mode_id: null,
    received_into_bank_account_id: null,
    customer_withheld_tax_head_id: null,
    withholding_calculated_on: null,
    withheld_amount: null,
    reference: '',
  };

  constructor() {
    if (!this.invoiceId) {
      this.loadError.set('No invoice id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<InvoiceRow>(`${environment.apiBaseUrl}/invoices/${this.invoiceId}`).subscribe({
      next: (row) => {
        this.invoice.set(row);
        // Pre-fills the visible default rather than leaving the select blank
        // and relying on the server's own fallback (record_payment's own
        // `body.received_into_bank_account_id or invoice.bank_account_id`,
        // api/v1/invoices.py) — the point being that the default is SHOWN,
        // not silently applied.
        this.form['received_into_bank_account_id'] = row.bank_account_id;
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this invoice.');
        this.isLoading.set(false);
      },
    });
    this.loadPayments();
  }

  private loadPayments(): void {
    this.http.get<InvoicePaymentRow[]>(`${environment.apiBaseUrl}/invoices/${this.invoiceId}/payments`).subscribe({
      next: (rows) => this.payments.set(rows ?? []),
      error: () => this.payments.set([]),
    });
  }

  protected canRecordPayment(): boolean {
    return this.policy.can(SCREEN, 'record_payment');
  }

  // Reversal is gated on the SAME 'record_payment' action as recording one
  // — same actor who can log a payment can undo a mistaken one (invoices.py
  // reverse_payment's own require_screen), not a separate RBAC action.
  protected canReverse(): boolean {
    return this.canRecordPayment();
  }

  protected reversePayment(payment: InvoicePaymentRow): void {
    const reason = window.prompt('Reason for reversing this payment?');
    if (reason === null) return;
    if (!reason.trim()) {
      this.saveError.set('A reason is required to reverse a payment.');
      return;
    }
    this.reversingId.set(payment.id);
    this.saveError.set(null);
    this.http.post(`${environment.apiBaseUrl}/invoices/${this.invoiceId}/payments/${payment.id}/reverse`, { reason: reason.trim() }).subscribe({
      next: () => {
        this.reversingId.set(null);
        this.loadPayments();
        this.http.get<InvoiceRow>(`${environment.apiBaseUrl}/invoices/${this.invoiceId}`).subscribe((row) => this.invoice.set(row));
      },
      error: (err) => {
        this.reversingId.set(null);
        this.saveError.set(err?.error?.detail ?? 'Could not reverse this payment.');
      },
    });
  }

  protected paymentModeOptions() {
    return this.refData.options(PAYMENT_MODE_REF) ?? [];
  }

  protected bankAccountOptions() {
    return this.refData.options(BANK_ACCOUNT_REF) ?? [];
  }

  protected taxHeadOptions() {
    // The server is the authority on whether a chosen head actually scopes
    // WITHHOLDING_AT_SOURCE (record_payment's own validate_head_usable call,
    // api/v1/invoices.py) — this shows the same full /masters/taxes list the
    // Invoice document's own Tax Head field uses rather than guessing at a
    // client-side scope filter the generic lookup response has no field for.
    return this.refData.options(TAX_REF) ?? [];
  }

  protected amountSettled(): number {
    return num(this.form['amount_received']) + num(this.form['withheld_amount']);
  }

  protected save(): void {
    const missing: string[] = [];
    if (!this.form['amount_received'] || num(this.form['amount_received']) <= 0) missing.push('Amount Received');
    if (!this.form['payment_mode_id']) missing.push('Payment Mode');
    if (!this.form['payment_date']) missing.push('Payment Date');
    if (missing.length) {
      this.saveError.set(`Required: ${missing.join(', ')}.`);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (String(this.form['payment_date']) > today) {
      this.saveError.set('Payment Date cannot be in the future.');
      return;
    }

    const body: InvoicePaymentCreateBody = {
      amount_received: num(this.form['amount_received']),
      customer_withheld_tax_head_id: (this.form['customer_withheld_tax_head_id'] as string) || null,
      withholding_calculated_on: (this.form['withholding_calculated_on'] as string) || null,
      withheld_amount: this.form['withheld_amount'] ? num(this.form['withheld_amount']) : null,
      payment_mode_id: this.form['payment_mode_id'] as string,
      received_into_bank_account_id: (this.form['received_into_bank_account_id'] as string) || null,
      payment_date: String(this.form['payment_date']),
      reference: (this.form['reference'] as string)?.trim() || null,
    };

    this.saving.set(true);
    this.saveError.set(null);
    this.http.post(`${environment.apiBaseUrl}/invoices/${this.invoiceId}/payments`, body).subscribe({
      next: () => this.router.navigate(['/invoices', this.invoiceId]),
      error: (err) => {
        this.saving.set(false);
        // Surfaced as-is — e.g. "Amount cannot exceed the balance due of
        // 4200.00" (record_payment's own 422, api/v1/invoices.py) — not
        // duplicated client-side beyond the basic required-field checks above.
        this.saveError.set(err?.error?.detail ?? 'Could not record this payment.');
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/invoices', this.invoiceId]);
  }
}
