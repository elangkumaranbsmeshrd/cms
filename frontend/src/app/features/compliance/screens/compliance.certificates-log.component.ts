import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatDate, formatMoney } from '../../../shared/screens/cell-format';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { CertificateRow, CreditRow, CustomerPickerOption, TaxHeadLookup } from '../compliance.api';

interface ReceiptRow extends CreditRow {
  checked: boolean;
  amount: number;
}

/** §2.8 Log Withholding Certificate — bespoke: the Receipts Covered picker
 * (multi-select with a per-row certifiable amount) has no dedicated
 * "eligible receipts for this customer" endpoint — built off
 * `GET /compliance/credits?customer_id=X&status=AWAITING_CERTIFICATE`,
 * re-fetched whenever the customer selection changes, which is Credits'
 * (§2.6) own real source of "which receipts still need a certificate" and a
 * reasonable construction from an existing endpoint, not a fabricated one.
 *
 * Per-row cap: each receipt's `withheld` figure IS its full outstanding-to-
 * certify amount for every row this fetch can return, with one documented
 * exception — a receipt whose certificate was VOIDED also reads
 * AWAITING_CERTIFICATE again (credits_engine.py), and the backend's own
 * cross-certificate cap (masters_taxes.py / api/v1/compliance.py's
 * log_certificate) sums CertificateReceipt rows regardless of the parent
 * certificate's status, so a previously-voided certificate's own certified
 * amount can still count against the new cap server-side. `withheld` is
 * therefore used here as the best available client-side hint (correct in
 * the overwhelming common case), not asserted as an absolute guarantee —
 * the real cap is enforced server-side regardless, and a rejected amount
 * surfaces through the normal save-error banner, matching this whole
 * module's "advisory client-side check, API stays authority" convention.
 */
@Component({
  selector: 'app-compliance-certificate-log',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Log Withholding Certificate<span class="spec-ref">§2.8</span></h1>
        <p class="page-sub">Log a certificate the company already received externally — this does not generate one.</p>
      </div>
    </div>

    @if (saveError()) {
      <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
    }

    @if (!canLog()) {
      <div class="rbac-note warn" style="margin-bottom: 16px;">
        You have view-only access to this screen — logging a certificate is not available to your role.
      </div>
    }

    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body">
        <div class="grid g-2">
          <div class="field">
            <label>Customer <span class="req" aria-hidden="true">*</span></label>
            <select class="input" [(ngModel)]="form['customer_id']" [disabled]="!canLog()" (ngModelChange)="onCustomerChange()">
              <option [ngValue]="null">—</option>
              @for (c of customers(); track c.id) {
                <option [ngValue]="c.id">{{ c.company_name }}</option>
              }
            </select>
            <div class="hint">Who issued the certificate.</div>
          </div>
          <div class="field">
            <label>Certificate Reference <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="text" [(ngModel)]="form['certificate_reference']" [disabled]="!canLog()" />
            <div class="hint">The number printed on the customer's certificate. Must be unique for this customer.</div>
          </div>
          <div class="field">
            <label>Certificate Date <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="date" [(ngModel)]="form['certificate_date']" [disabled]="!canLog()" />
            <div class="hint">Cannot be in the future.</div>
          </div>
          <div class="field">
            <label>Tax Head <span class="req" aria-hidden="true">*</span></label>
            <select class="input" [(ngModel)]="form['tax_head_id']" [disabled]="!canLog()">
              <option [ngValue]="null">—</option>
              @for (h of taxHeads(); track h.id) {
                <option [ngValue]="h.id">{{ h.tax_name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label>Covered From <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="date" [(ngModel)]="form['covered_from']" [disabled]="!canLog()" />
            <div class="hint">The period the certificate covers — often a quarter, not a month.</div>
          </div>
          <div class="field">
            <label>Covered To <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="date" [(ngModel)]="form['covered_to']" [disabled]="!canLog()" />
            <div class="hint">Must be on or after Covered From.</div>
          </div>
          <div class="field">
            <label>Amount on Certificate <span class="req" aria-hidden="true">*</span></label>
            <input class="input" type="number" step="0.01" min="0" [(ngModel)]="form['amount_on_certificate']" [disabled]="!canLog()" />
            <div class="hint">What the certificate itself states.</div>
          </div>
          <div class="field">
            <label>Attachment</label>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              @if (attachmentFileName) {
                <span class="badge-s b-ok">{{ attachmentFileName }}</span>
                <button class="btn sm ghost" type="button" (click)="clearAttachment()" [disabled]="!canLog()">Remove</button>
              } @else {
                <span class="cell-sub">No file uploaded.</span>
              }
              <label class="btn sm ghost" for="cert-attachment" style="cursor: pointer; margin: 0;">
                {{ uploadingAttachment() ? 'Uploading…' : attachmentFileName ? 'Replace' : 'Upload' }}
              </label>
              <input id="cert-attachment" type="file" style="display: none;" [disabled]="!canLog() || uploadingAttachment()" (change)="onAttachmentSelected($event)" />
            </div>
            <div class="hint">The evidence the credit rests on.</div>
            @if (uploadError()) {
              <div class="hint" style="color: var(--danger);">{{ uploadError() }}</div>
            }
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 16px;">
      <div class="card-head">
        <h3>Receipts Covered</h3>
        <span class="sub">Every receipt still Awaiting Certificate for this customer. Ticking one computes Amount Matched; a difference from the stated figure surfaces as Variance rather than being silently absorbed.</span>
      </div>
      <div class="card-body table-wrap">
        @if (!form['customer_id']) {
          <p class="cell-sub">Pick a Customer to see their receipts awaiting a certificate.</p>
        } @else if (receiptsLoading()) {
          <p class="cell-sub">Loading…</p>
        } @else if (!receipts().length) {
          <p class="cell-sub">No receipts are currently awaiting a certificate for this customer.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Invoice Number</th>
                <th>Payment Date</th>
                <th class="money">Withheld</th>
                <th class="money">Amount to Certify</th>
              </tr>
            </thead>
            <tbody>
              @for (row of receipts(); track row.invoice_payment_id) {
                <tr>
                  <td><input type="checkbox" [checked]="row.checked" [disabled]="!canLog()" (change)="toggleReceipt(row)" /></td>
                  <td class="cell-strong mono">{{ row.invoice_number }}</td>
                  <td class="mono">{{ formatDate(row.payment_date) }}</td>
                  <td class="money mono">{{ formatMoney(row.withheld) }}</td>
                  <td class="money">
                    <input
                      class="input"
                      type="number"
                      step="0.01"
                      min="0"
                      [max]="row.withheld"
                      style="max-width: 130px;"
                      [(ngModel)]="row.amount"
                      [disabled]="!canLog() || !row.checked"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      <div class="card-foot">
        <span>Amount Matched: <b class="mono">{{ formatMoney(receiptsTotal()) }}</b></span>
        <span style="margin-left: auto;" [style.color]="variance() === 0 ? 'var(--success)' : 'var(--warning)'">
          Variance: <b class="mono">{{ formatMoney(variance()) }}</b>
        </span>
      </div>
    </div>

    <div class="card">
      <div class="card-foot">
        <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
        <button class="btn primary" type="button" [disabled]="saving() || !canLog()" (click)="submit()">
          {{ saving() ? 'Logging…' : 'Log Certificate' }}
        </button>
      </div>
    </div>
  `,
})
export class ComplianceCertificateLogComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly policy = inject(PolicyStore);

  protected readonly customers = signal<readonly CustomerPickerOption[]>([]);
  protected readonly taxHeads = signal<readonly TaxHeadLookup[]>([]);
  protected readonly receipts = signal<ReceiptRow[]>([]);
  protected readonly receiptsLoading = signal(false);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected form: Record<string, unknown> = {
    customer_id: null,
    certificate_reference: '',
    certificate_date: new Date().toISOString().slice(0, 10),
    tax_head_id: null,
    covered_from: '',
    covered_to: '',
    amount_on_certificate: 0,
  };
  protected attachmentFileId: string | null = null;
  protected attachmentFileName: string | null = null;
  protected readonly uploadingAttachment = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<CustomerPickerOption[]>(`${environment.apiBaseUrl}/customers/picker`).subscribe({
      next: (rows) => this.customers.set(rows),
      error: () => this.customers.set([]),
    });
    this.http.get<TaxHeadLookup[]>(`${environment.apiBaseUrl}/masters/taxes`).subscribe({
      next: (rows) => this.taxHeads.set(rows),
      error: () => this.taxHeads.set([]),
    });
  }

  protected canLog(): boolean {
    return this.policy.can('compliance.certificates', 'log');
  }

  protected onCustomerChange(): void {
    this.receipts.set([]);
    const customerId = this.form['customer_id'];
    if (!customerId) return;
    this.receiptsLoading.set(true);
    this.http
      .get<CreditRow[]>(`${environment.apiBaseUrl}/compliance/credits`, { params: { customer_id: String(customerId), status: 'AWAITING_CERTIFICATE' } })
      .subscribe({
        next: (rows) => {
          this.receipts.set(rows.map((r) => ({ ...r, checked: false, amount: Number(r.withheld) })));
          this.receiptsLoading.set(false);
        },
        error: () => {
          this.receipts.set([]);
          this.receiptsLoading.set(false);
        },
      });
  }

  protected toggleReceipt(row: ReceiptRow): void {
    row.checked = !row.checked;
    if (row.checked && !row.amount) row.amount = Number(row.withheld);
    this.receipts.update((rows) => [...rows]);
  }

  protected receiptsTotal(): number {
    return this.round2(
      this.receipts()
        .filter((r) => r.checked)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    );
  }
  protected variance(): number {
    return this.round2(this.amountOnCertificate() - this.receiptsTotal());
  }
  protected amountOnCertificate(): number {
    return Number(this.form['amount_on_certificate']) || 0;
  }
  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  protected formatMoney(v: number | string): string {
    return formatMoney(v);
  }
  protected formatDate(v: string): string {
    return formatDate(v);
  }

  protected onAttachmentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingAttachment.set(true);
    this.uploadError.set(null);
    this.fileUpload.upload(file, 'generic').subscribe({
      next: (res) => {
        this.uploadingAttachment.set(false);
        this.attachmentFileId = res.id;
        this.attachmentFileName = res.original_filename;
      },
      error: (err) => {
        this.uploadingAttachment.set(false);
        this.uploadError.set(err?.error?.detail ?? 'That file could not be uploaded.');
      },
    });
  }
  protected clearAttachment(): void {
    this.attachmentFileId = null;
    this.attachmentFileName = null;
  }

  protected submit(): void {
    if (!this.canLog()) return;
    const f = this.form;
    if (!f['customer_id'] || !String(f['certificate_reference'] ?? '').trim() || !f['certificate_date'] || !f['tax_head_id'] || !f['covered_from'] || !f['covered_to']) {
      this.saveError.set('Customer, Certificate Reference, Certificate Date, Tax Head, Covered From, and Covered To are all required.');
      return;
    }
    if (this.amountOnCertificate() <= 0) {
      this.saveError.set('Amount on Certificate must be greater than zero.');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (String(f['certificate_date']) > today) {
      this.saveError.set('Certificate Date cannot be in the future.');
      return;
    }
    if (String(f['covered_to']) < String(f['covered_from'])) {
      this.saveError.set('Covered To cannot be before Covered From.');
      return;
    }

    const receiptsCovered = this.receipts()
      .filter((r) => r.checked && Number(r.amount) > 0)
      .map((r) => ({ invoice_payment_id: r.invoice_payment_id, amount: Number(r.amount) }));

    this.saving.set(true);
    this.saveError.set(null);
    const body = {
      customer_id: f['customer_id'],
      certificate_reference: f['certificate_reference'],
      certificate_date: f['certificate_date'],
      covered_from: f['covered_from'],
      covered_to: f['covered_to'],
      tax_head_id: f['tax_head_id'],
      amount_on_certificate: this.amountOnCertificate(),
      receipts_covered: receiptsCovered,
      attachment_file_id: this.attachmentFileId,
    };
    this.http.post<CertificateRow>(`${environment.apiBaseUrl}/compliance/certificates`, body).subscribe({
      next: () => this.router.navigate(['/compliance/certificates']),
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.saveError.set(
          typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to log this certificate.',
        );
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/compliance/certificates']);
  }
}
