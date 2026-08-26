import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatDate, formatMoney } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CertificateRow, CreditClaimRow } from '../compliance.api';

const CUSTOMER_REF = { endpoint: '/customers/picker', labelKey: 'company_name' } as const;

/** §2.9 Mark Credit Claimed — bespoke. No `GET /{id}` exists for a
 * certificate at all (only list/create/void/claim) — the established
 * no-GET-by-id idiom (FormScreenConfig's own documented approach): fetch
 * the full list, find the row by id client-side. Safe even on a direct URL
 * refresh, since the Certificates list screen makes the identical fetch.
 *
 * CertificateOut carries no "already claimed" boolean at all — a claim is a
 * separate `credit_claims` row with no pointer back onto the certificate
 * itself, so this screen genuinely cannot know in advance whether a claim
 * already exists. A VOIDED certificate is blocked outright (that fact IS
 * visible on the loaded row); an already-claimed ACTIVE one is discovered
 * only by attempting to submit, at which point the backend's real 409
 * ("This certificate has already been claimed") surfaces through the normal
 * save-error banner below — the same "let the real error surface" reasoning
 * this module's Reverse/Void actions already use for their own un-hideable
 * already-done rows.
 */
@Component({
  selector: 'app-compliance-certificate-claim',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Mark Credit Claimed<span class="spec-ref">§2.9</span></h1>
        <p class="page-sub">Close the loop once the credit has been taken in one of the company's own filings.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card"><div class="empty"><p>Loading…</p></div></div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this certificate</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      <!-- Nested, not an @else-if with an "as" binding — "as" is only
           legal on a PRIMARY @if, never on an @else if. -->
      @if (cert(); as c) {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Certificate</h3></div>
        <div class="card-body grid g-4">
          <div><div class="cell-sub">Certificate Reference</div><div class="cell-strong mono">{{ c.certificate_reference }}</div></div>
          <div><div class="cell-sub">Customer</div><div class="cell-strong">{{ customerName(c.customer_id) }}</div></div>
          <div><div class="cell-sub">Certificate Date</div><div class="cell-strong mono">{{ formatDate(c.certificate_date) }}</div></div>
          <div><div class="cell-sub">Tax Head</div><div class="cell-strong">{{ c.tax_head_name_snapshot }}</div></div>
          <div><div class="cell-sub">Status</div><div class="cell-strong">{{ c.status }}</div></div>
          <div><div class="cell-sub">Amount Claimable</div><div class="cell-strong mono">{{ formatMoney(c.amount_on_certificate) }}</div></div>
        </div>
        <!-- §2.9's own "Receipts" field (app-forms.js:348) — only a
             certified receipt can be claimed, so naming which ones this
             certificate actually covers is the evidence behind the claim. -->
        <div class="card-body" style="border-top: 1px solid var(--hairline);">
          <div class="cell-sub">Receipts</div>
          <div class="cell-strong">{{ receiptsCoveredSummary(c) }}</div>
        </div>
      </div>

      @if (c.status === 'VOIDED') {
        <div class="rbac-note danger">
          This certificate was voided{{ c.void_reason ? ' (' + c.void_reason + ')' : '' }} and cannot be claimed.
        </div>
        <div class="card" style="margin-top: 16px;">
          <div class="card-foot"><button class="btn ghost" type="button" (click)="cancel()">Close</button></div>
        </div>
      } @else {
        @if (saveError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
        }
        @if (!canClaim()) {
          <div class="rbac-note warn" style="margin-bottom: 16px;">
            You have view-only access to this screen — marking a credit claimed is not available to your role.
          </div>
        }
        <div class="card">
          <div class="card-body">
            <div class="grid g-2">
              <div class="field">
                <label>Amount Claimable</label>
                <div class="readonly-value mono">{{ formatMoney(c.amount_on_certificate) }}</div>
                <div class="hint">Always the certified figure — never editable here.</div>
              </div>
              <div class="field">
                <label>Claim Date <span class="req" aria-hidden="true">*</span></label>
                <input class="input" type="date" [(ngModel)]="form['claim_date']" [disabled]="!canClaim()" />
                <div class="hint">Cannot be in the future.</div>
              </div>
              <div class="field">
                <label>Claimed In (Period / Return) <span class="req" aria-hidden="true">*</span></label>
                <input class="input" type="text" placeholder="e.g. Q2 FY2026-27 return" [(ngModel)]="form['claimed_in']" [disabled]="!canClaim()" />
                <div class="hint">Which of the company's own filings this credit was taken in.</div>
              </div>
              <div class="field">
                <label>Claim Reference</label>
                <input class="input" type="text" [(ngModel)]="form['claim_reference']" [disabled]="!canClaim()" />
                <div class="hint">Optional — the handle back into the filing.</div>
              </div>
              <div class="field span-2">
                <label>Notes</label>
                <textarea class="input" rows="2" [(ngModel)]="form['notes']" [disabled]="!canClaim()"></textarea>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving() || !canClaim()" (click)="submit()">
              {{ saving() ? 'Marking Claimed…' : 'Mark Claimed' }}
            </button>
          </div>
        </div>
      }
      }
    }
  `,
})
export class ComplianceCertificateClaimComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly cert = signal<CertificateRow | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected form: Record<string, unknown> = {
    claim_date: new Date().toISOString().slice(0, 10),
    claimed_in: '',
    claim_reference: '',
    notes: '',
  };

  private certificateId = '';

  ngOnInit(): void {
    this.certificateId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.certificateId) {
      this.loadError.set('No certificate id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<CertificateRow[]>(`${environment.apiBaseUrl}/compliance/certificates`).subscribe({
      next: (rows) => {
        const row = rows.find((r) => r.id === this.certificateId) ?? null;
        if (!row) this.loadError.set('This certificate could not be found.');
        else this.cert.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this certificate.');
        this.isLoading.set(false);
      },
    });
  }

  protected canClaim(): boolean {
    return this.policy.can('compliance.certificates', 'claim');
  }

  protected customerName(id: string): string {
    return this.refData.label(CUSTOMER_REF, id);
  }

  // Same "invoice (amount)" join the Certificates list's own Receipts
  // Covered column renders (compliance.certificates.list.config.ts) — kept
  // identical rather than inventing a second format for the same data.
  protected receiptsCoveredSummary(c: CertificateRow): string {
    return c.receipts_covered.length ? c.receipts_covered.map((r) => `${r.invoice_number} (${this.formatMoney(r.amount)})`).join(', ') : '—';
  }

  protected formatMoney(v: number | string): string {
    return formatMoney(v);
  }
  protected formatDate(v: string): string {
    return formatDate(v);
  }

  protected submit(): void {
    if (!this.canClaim()) return;
    const c = this.cert();
    if (!c) return;
    const f = this.form;
    if (!String(f['claimed_in'] ?? '').trim() || !f['claim_date']) {
      this.saveError.set('Claimed In and Claim Date are both required.');
      return;
    }
    if (String(f['claim_date']) > new Date().toISOString().slice(0, 10)) {
      this.saveError.set('Claim Date cannot be in the future.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const body = {
      claimed_in: f['claimed_in'],
      claim_reference: f['claim_reference'] || null,
      claim_date: f['claim_date'],
      notes: f['notes'] || null,
    };
    this.http.post<CreditClaimRow>(`${environment.apiBaseUrl}/compliance/certificates/${c.id}/claim`, body).subscribe({
      next: () => this.router.navigate(['/compliance/certificates']),
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.saveError.set(
          typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to mark this credit claimed.',
        );
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(['/compliance/certificates']);
  }
}
