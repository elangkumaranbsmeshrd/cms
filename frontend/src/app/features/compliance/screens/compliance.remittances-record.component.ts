import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import {
  BankAccountOption,
  OBLIGATION_STATUS_OPTIONS,
  ObligationPeriodRow,
  PaymentModeOption,
  RemittanceEligibleDocumentRow,
  RemittanceRow,
  TaxHeadLookup,
} from '../compliance.api';

interface DocRow extends RemittanceEligibleDocumentRow {
  checked: boolean;
  amount: number;
}

/** §2.5 Record Remittance — bespoke: derived read-only fields (Withheld in
 * Period / Already Remitted, both summed from the documents-in-period
 * fetch), a checkbox-plus-per-row-amount picker that must sum exactly to
 * Amount Remitted, and a dynamically-labelled Authority Reference field
 * (the label text itself comes from the tax head, not a fixed string) —
 * none of this fits FormScreenConfig's flat field list.
 *
 * Reached from Obligations' own row click, pre-scoped via 3 route params
 * (taxHeadId/periodFrom/periodTo) rather than an `input.required<string>()`
 * — read via ActivatedRoute.snapshot in ngOnInit, the same pattern every
 * other bespoke route in this codebase uses for its own :id
 * (tax-head-child-screen.component.ts, leave.comp-hours-apply.component.ts),
 * which sidesteps the signal-input "not set until after the constructor"
 * lifecycle gotcha entirely rather than needing to work around it.
 */
@Component({
  selector: 'app-compliance-remittance-record',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Record Remittance<span class="spec-ref">§2.5</span></h1>
        <p class="page-sub">Confirm the amount deposited with the authority and exactly which withheld documents it covers.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this period</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Period</h3></div>
        <div class="card-body grid g-4">
          <div><div class="cell-sub">Tax Head</div><div class="cell-strong">{{ taxHead?.tax_name ?? taxHeadId }}</div></div>
          <div><div class="cell-sub">Remitted To</div><div class="cell-strong">{{ taxHead?.remitted_to_authority ?? '—' }}</div></div>
          <div><div class="cell-sub">Period</div><div class="cell-strong">{{ formatDate(periodFrom) }} to {{ formatDate(periodTo) }}</div></div>
          <div><div class="cell-sub">Withheld in this Period</div><div class="cell-strong mono">{{ formatMoney(withheldInPeriod()) }}</div></div>
          <div><div class="cell-sub">Already Remitted</div><div class="cell-strong mono">{{ formatMoney(alreadyRemitted()) }}</div></div>
          <div><div class="cell-sub">Due Date</div><div class="cell-strong mono">{{ periodDueDate ? formatDate(periodDueDate) : '—' }}</div></div>
          <div><div class="cell-sub">Status</div><div>
            @if (periodStatus) {
              <span class="badge-s {{ statusBadge() }}">{{ statusLabel() }}</span>
            } @else { <span class="cell-strong">—</span> }
          </div></div>
        </div>
      </div>

      @if (!canRecord()) {
        <div class="rbac-note warn" style="margin-bottom: 16px;">
          You have view-only access to this screen — recording a remittance is not available to your role.
        </div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Remittance Details</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label>Amount Remitted <span class="req" aria-hidden="true">*</span></label>
              <input class="input" type="number" step="0.01" min="0" [(ngModel)]="form['amount_remitted']" [disabled]="!canRecord()" />
              <div class="hint">Defaults to the full outstanding figure. A part-remittance is allowed — the period then reads Part-Remitted and stays open for the balance.</div>
            </div>
            <div class="field">
              <label>Paid On <span class="req" aria-hidden="true">*</span></label>
              <input class="input" type="date" [(ngModel)]="form['paid_on']" [disabled]="!canRecord()" />
              <div class="hint">Cannot be in the future.{{ periodDueDate ? ' The due date for this period is ' + formatDate(periodDueDate) + '.' : '' }}</div>
            </div>
            <div class="field">
              <label>Paid From (Bank Account) <span class="req" aria-hidden="true">*</span></label>
              <select class="input" [(ngModel)]="form['paid_from_bank_account_id']" [disabled]="!canRecord()">
                <option [ngValue]="null">—</option>
                @for (b of bankAccounts; track b.id) {
                  <option [ngValue]="b.id">{{ b.label }}</option>
                }
              </select>
              @if (!bankAccounts.length) {
                <div class="hint">No active bank accounts available to this role.</div>
              } @else {
                <div class="hint">Which Meshrd account the money left from.</div>
              }
            </div>
            <div class="field">
              <label>Payment Mode <span class="req" aria-hidden="true">*</span></label>
              <select class="input" [(ngModel)]="form['payment_mode_id']" [disabled]="!canRecord()">
                <option [ngValue]="null">—</option>
                @for (m of paymentModes; track m.id) {
                  <option [ngValue]="m.id">{{ m.label }}</option>
                }
              </select>
              @if (!paymentModes.length) {
                <div class="hint">No payment modes available to this role.</div>
              } @else {
                <div class="hint">From Masters → Payment Mode.</div>
              }
            </div>
            <div class="field">
              <label>{{ authorityReferenceLabel() }} <span class="req" aria-hidden="true">*</span></label>
              <input class="input" type="text" [(ngModel)]="form['authority_reference']" [disabled]="!canRecord()" />
              <div class="hint">The reference on the authority's receipt — labelled from this tax head's own configured Authority Reference Label, not a fixed name.</div>
            </div>
            <div class="field">
              <label>Receipt Attachment</label>
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                @if (receiptFileName) {
                  <span class="badge-s b-ok">{{ receiptFileName }}</span>
                  <button class="btn sm ghost" type="button" (click)="clearReceipt()" [disabled]="!canRecord()">Remove</button>
                } @else {
                  <span class="cell-sub">No file uploaded.</span>
                }
                <label class="btn sm ghost" for="receipt-file" style="cursor: pointer; margin: 0;">
                  {{ uploadingReceipt() ? 'Uploading…' : receiptFileName ? 'Replace' : 'Upload' }}
                </label>
                <input id="receipt-file" type="file" style="display: none;" [disabled]="!canRecord() || uploadingReceipt()" (change)="onReceiptSelected($event)" />
              </div>
              <div class="hint">The audit source document for this remittance.</div>
              @if (uploadError()) {
                <div class="hint" style="color: var(--danger);">{{ uploadError() }}</div>
              }
            </div>
            <div class="field span-2">
              <label>Notes</label>
              <textarea class="input" rows="2" [(ngModel)]="form['notes']" [disabled]="!canRecord()"></textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Documents Covered</h3>
          <span class="sub">Ticked by you, never inferred — the ticked total must equal Amount Remitted exactly.</span>
        </div>
        <div class="card-body table-wrap">
          @if (!docs().length) {
            <p class="cell-sub">No documents in this period have any withheld amount outstanding.</p>
          } @else {
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Document</th>
                  <th>Counterparty</th>
                  <th class="money">Withheld</th>
                  <th class="money">Already Allocated</th>
                  <th class="money">Outstanding</th>
                  <th class="money">Amount to Allocate</th>
                </tr>
              </thead>
              <tbody>
                @for (row of docs(); track row.source_type + row.source_id) {
                  <tr>
                    <td><input type="checkbox" [checked]="row.checked" [disabled]="!canRecord()" (change)="toggleDoc(row)" /></td>
                    <td class="cell-strong">{{ row.document_label }}</td>
                    <td>{{ row.counterparty }}</td>
                    <td class="money mono">{{ formatMoney(row.withheld_amount) }}</td>
                    <td class="money mono">{{ formatMoney(row.already_allocated) }}</td>
                    <td class="money mono">{{ formatMoney(row.outstanding) }}</td>
                    <td class="money">
                      <input
                        class="input"
                        type="number"
                        step="0.01"
                        min="0"
                        style="max-width: 130px;"
                        [(ngModel)]="row.amount"
                        [disabled]="!canRecord() || !row.checked"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
        <div class="card-foot">
          <span>Ticked Total: <b class="mono">{{ formatMoney(tickedTotal()) }}</b></span>
          <span style="margin-left: auto;" [style.color]="totalsMatch() ? 'var(--success)' : 'var(--danger)'">
            {{ totalsMatch() ? 'Matches Amount Remitted' : 'Must equal Amount Remitted (' + formatMoney(amountRemitted()) + ')' }}
          </span>
        </div>
      </div>

      <div class="card">
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
          <button class="btn primary" type="button" [disabled]="saving() || !canRecord()" (click)="submit()">
            {{ saving() ? 'Recording…' : 'Record Remittance' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class ComplianceRemittanceRecordComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected taxHeadId = '';
  protected periodFrom = '';
  protected periodTo = '';
  protected taxHead: TaxHeadLookup | null = null;
  // §2.5's Paid On hint names this period's own due date, and the prototype
  // implicitly carries a Status too (the period row this form was reached
  // from). Neither is returned by documents-in-period — resolved from the
  // same real /compliance/obligations register the Obligations list itself
  // reads (§2.2), filtered to this tax head and matched on the two period
  // bounds already in the URL, rather than fabricated.
  protected periodDueDate: string | null = null;
  protected periodStatus: string | null = null;
  protected readonly docs = signal<DocRow[]>([]);
  protected bankAccounts: readonly BankAccountOption[] = [];
  protected paymentModes: readonly PaymentModeOption[] = [];

  protected form: Record<string, unknown> = {
    amount_remitted: 0,
    paid_on: new Date().toISOString().slice(0, 10),
    paid_from_bank_account_id: null,
    payment_mode_id: null,
    authority_reference: '',
    notes: '',
  };
  protected receiptFileId: string | null = null;
  protected receiptFileName: string | null = null;
  protected readonly uploadingReceipt = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  ngOnInit(): void {
    this.taxHeadId = this.route.snapshot.paramMap.get('taxHeadId') ?? '';
    this.periodFrom = this.route.snapshot.paramMap.get('periodFrom') ?? '';
    this.periodTo = this.route.snapshot.paramMap.get('periodTo') ?? '';
    if (!this.taxHeadId || !this.periodFrom || !this.periodTo) {
      this.loadError.set('This link is missing a tax head or period.');
      this.isLoading.set(false);
      return;
    }

    // Masters §3.2/§3.7/§3.8 lookups — each degrades to an empty list on a
    // 403/error rather than failing the whole screen. FIXED 2026-08-11 (RBAC
    // audit): bank-accounts/payment-modes now hit the `/options` routes
    // (masters_lookup.py's label_field / masters_bank_accounts.py's own),
    // not the gated Masters screen endpoints — Accountant (this module's
    // primary user) no longer 404s or gets an empty list here.
    this.http.get<TaxHeadLookup[]>(`${environment.apiBaseUrl}/masters/taxes`).subscribe({
      next: (rows) => (this.taxHead = rows.find((r) => r.id === this.taxHeadId) ?? null),
      error: () => (this.taxHead = null),
    });
    this.http.get<BankAccountOption[]>(`${environment.apiBaseUrl}/masters/bank-accounts/options`).subscribe({
      // /options already filters to Active-only server-side — no client-side filter needed.
      next: (rows) => (this.bankAccounts = rows),
      error: () => (this.bankAccounts = []),
    });
    this.http.get<PaymentModeOption[]>(`${environment.apiBaseUrl}/masters/payment-modes/options`).subscribe({
      next: (rows) => (this.paymentModes = rows),
      error: () => (this.paymentModes = []),
    });
    this.http.get<ObligationPeriodRow[]>(`${environment.apiBaseUrl}/compliance/obligations`, { params: { tax_head_id: this.taxHeadId } }).subscribe({
      next: (rows) => {
        const match = rows.find((r) => r.period_from === this.periodFrom && r.period_to === this.periodTo);
        this.periodDueDate = match?.due_date ?? null;
        this.periodStatus = match?.status ?? null;
      },
      // Advisory display only (the hint text and the Status cell) — never
      // blocks the form itself, same degrade-quietly posture as the bank
      // account / payment mode lookups just above.
      error: () => {
        this.periodDueDate = null;
        this.periodStatus = null;
      },
    });

    const params = { tax_head_id: this.taxHeadId, period_from: this.periodFrom, period_to: this.periodTo };
    this.http.get<RemittanceEligibleDocumentRow[]>(`${environment.apiBaseUrl}/compliance/remittances/documents-in-period`, { params }).subscribe({
      next: (rows) => {
        // Pre-ticked at each document's own outstanding figure — a visible,
        // fully adjustable DEFAULT (matching "Amount Remitted defaults to
        // the full outstanding figure", §2.5), not a silent inference: the
        // operator sees every row ticked and can un-tick or retype any of
        // them before Submit, which is the actual confirming action.
        const docRows: DocRow[] = rows.map((r) => ({ ...r, checked: Number(r.outstanding) > 0, amount: Number(r.outstanding) }));
        this.docs.set(docRows);
        this.form['amount_remitted'] = this.round2(docRows.filter((d) => d.checked).reduce((s, d) => s + d.amount, 0));
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the eligible documents for this period.');
        this.isLoading.set(false);
      },
    });
  }

  protected canRecord(): boolean {
    return this.policy.can('compliance.remittances', 'record');
  }

  protected withheldInPeriod(): number {
    return this.round2(this.docs().reduce((s, d) => s + Number(d.withheld_amount), 0));
  }
  protected alreadyRemitted(): number {
    return this.round2(this.docs().reduce((s, d) => s + Number(d.already_allocated), 0));
  }
  protected tickedTotal(): number {
    return this.round2(
      this.docs()
        .filter((d) => d.checked)
        .reduce((s, d) => s + (Number(d.amount) || 0), 0),
    );
  }
  protected amountRemitted(): number {
    return Number(this.form['amount_remitted']) || 0;
  }
  protected totalsMatch(): boolean {
    return this.tickedTotal() === this.round2(this.amountRemitted());
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

  protected toggleDoc(row: DocRow): void {
    row.checked = !row.checked;
    if (row.checked && !row.amount) row.amount = Number(row.outstanding);
    this.docs.update((rows) => [...rows]);
  }

  protected authorityReferenceLabel(): string {
    return this.taxHead?.authority_reference_label || 'Authority Reference';
  }

  protected statusBadge(): string {
    return OBLIGATION_STATUS_OPTIONS.find((o) => o.value === this.periodStatus)?.badgeClass ?? 'b-neutral';
  }
  protected statusLabel(): string {
    return OBLIGATION_STATUS_OPTIONS.find((o) => o.value === this.periodStatus)?.label ?? humanizeEnum(this.periodStatus ?? '');
  }

  protected onReceiptSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingReceipt.set(true);
    this.uploadError.set(null);
    // No dedicated upload purpose is registered for a remittance receipt —
    // 'generic' is files.py's own fallback rule (per this build's brief).
    this.fileUpload.upload(file, 'generic').subscribe({
      next: (res) => {
        this.uploadingReceipt.set(false);
        this.receiptFileId = res.id;
        this.receiptFileName = res.original_filename;
      },
      error: (err) => {
        this.uploadingReceipt.set(false);
        this.uploadError.set(err?.error?.detail ?? 'That file could not be uploaded.');
      },
    });
  }

  protected clearReceipt(): void {
    this.receiptFileId = null;
    this.receiptFileName = null;
  }

  protected submit(): void {
    if (!this.canRecord()) return;
    const f = this.form;
    if (!f['paid_on'] || !f['paid_from_bank_account_id'] || !f['payment_mode_id'] || !String(f['authority_reference'] ?? '').trim()) {
      this.saveError.set('Paid On, Paid From Bank Account, Payment Mode, and Authority Reference are all required.');
      return;
    }
    if (this.amountRemitted() <= 0) {
      this.saveError.set('Amount Remitted must be greater than zero.');
      return;
    }
    if (String(f['paid_on']) > new Date().toISOString().slice(0, 10)) {
      this.saveError.set('Paid On cannot be in the future.');
      return;
    }
    const documentsCovered = this.docs()
      .filter((d) => d.checked && Number(d.amount) > 0)
      .map((d) => ({ source_type: d.source_type, source_id: d.source_id, amount: Number(d.amount) }));
    if (!documentsCovered.length) {
      this.saveError.set('Tick at least one document to cover with this remittance.');
      return;
    }
    if (!this.totalsMatch()) {
      this.saveError.set(
        `Documents Covered must sum to exactly Amount Remitted (ticked total ${this.formatMoney(this.tickedTotal())} vs Amount Remitted ${this.formatMoney(this.amountRemitted())}).`,
      );
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const body = {
      tax_head_id: this.taxHeadId,
      period_from: this.periodFrom,
      period_to: this.periodTo,
      amount_remitted: this.amountRemitted(),
      paid_on: f['paid_on'],
      paid_from_bank_account_id: f['paid_from_bank_account_id'],
      payment_mode_id: f['payment_mode_id'],
      authority_reference: f['authority_reference'],
      receipt_file_id: this.receiptFileId,
      notes: f['notes'] || null,
      documents_covered: documentsCovered,
    };
    this.http.post<RemittanceRow>(`${environment.apiBaseUrl}/compliance/remittances`, body).subscribe({
      next: () => this.router.navigate(['/compliance/remittances']),
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.saveError.set(
          typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to record this remittance.',
        );
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/compliance/obligations']);
  }
}
