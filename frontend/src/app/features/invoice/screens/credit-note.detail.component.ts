import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { badgeClass, formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { IconComponent } from '../../../shared/ui/icon.component';
import { CREDIT_NOTE_REASON_OPTIONS, CREDIT_NOTE_STATUS_OPTIONS, CreditNoteRow, CreditNoteWriteBody, InvoiceRow } from '../invoice.api';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

const SCREEN = 'credit_note.list';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optionLabel(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? humanizeEnum(value);
}

/** §2.5 Credit Note create/detail — bespoke, no shape fits: "Line Items
 * Affected" is a multi-select whose OPTIONS are the parent invoice's own
 * currently-loaded line_items array, a dynamic per-record option source
 * nothing in FieldConfig supports (`ref` sources from a fixed Masters
 * endpoint; staticOptions/checkgroup are fixed at config-authoring time).
 *
 * One component backs two routes, same create-vs-edit duality as
 * ticket.form.component.ts but branching on WHICH route param is present
 * rather than whether one is:
 *   - invoices/:invoiceId/credit-note — CREATE, reached from the Invoice
 *     document's own Raise Credit Note action.
 *   - credit-notes/:id — VIEW an existing one (editable while still Draft,
 *     read-only once Pending Approval/Approved), reached from the Credit
 *     Note List's rowRoute.
 */
@Component({
  selector: 'app-credit-note-detail',
  standalone: true,
  imports: [FormsModule, IconComponent, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          {{ isCreateMode ? 'Raise Credit Note' : (creditNote()?.credit_note_number ?? 'Credit Note') }}
          <span class="spec-ref">§2.5</span>
          @if (creditNote(); as cn) {
            <span class="badge-s {{ badgeCls(cn.status) }}">{{ optionLabel(STATUS_OPTIONS, cn.status) }}</span>
          }
        </h1>
        @if (invoice(); as inv) {
          <p class="page-sub">Against Invoice {{ inv.invoice_number }} — {{ inv.customer_name_snapshot }}</p>
        }
      </div>
      <div class="page-actions">
        @if (!isCreateMode && creditNote()) {
          <button class="btn" type="button" [disabled]="downloading()" (click)="downloadPdf()">
            <app-icon name="download" [size]="14" />{{ downloading() ? 'Downloading…' : 'Download PDF' }}
          </button>
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
        <p><b>Couldn't load this credit note</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else if (isCreateMode && !canRaise()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>You don't have permission to raise credit notes.</b></p>
        <p class="hint"><span class="clear" role="button" (click)="cancel()">Go back</span></p>
      </div>
    } @else {
      @if (invoice(); as inv) {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Original Invoice</h3>
        </div>
        <div class="card-body grid g-2">
          <div class="field">
            <div class="cell-sub">Grand Total</div>
            <div class="cell-strong">{{ formatMoney(inv.grand_total) }}</div>
          </div>
          <div class="field">
            <div class="cell-sub">Already Credited</div>
            <div>{{ formatMoney(inv.credit_note_total) }}</div>
          </div>
          <div class="field">
            <div class="cell-sub">Remaining Creditable</div>
            <div class="cell-strong">{{ formatMoney(remainingCreditable()) }}</div>
          </div>
        </div>
      </div>

      @if (isEditable()) {
        <div class="card">
          <div class="card-body">
            <div class="grid g-2">
              <div class="field">
                <label>Reason <span class="req">*</span></label>
                <select class="input" [(ngModel)]="form['reason']">
                  <option [ngValue]="null">—</option>
                  @for (opt of REASON_OPTIONS; track opt.value) {
                    <option [ngValue]="opt.value">{{ opt.label }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label>Credit Amount <span class="req">*</span></label>
                <input class="input" type="number" step="0.01" [(ngModel)]="form['credit_amount']" />
                <div class="hint">Up to {{ formatMoney(remainingCreditable()) }} remaining creditable.</div>
              </div>
              <div class="field span-2">
                <label>Reason Detail <span class="req">*</span></label>
                <textarea class="input" rows="3" [(ngModel)]="form['reason_detail']"></textarea>
              </div>
            </div>

            <div class="form-section-head">
              <h4>Line Items Affected</h4>
              <span class="note">Optional — leave all unchecked if this credit doesn't map to specific lines.</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px;">
              @for (li of inv.line_items; track li.id) {
                <label style="display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer;">
                  <input type="checkbox" [checked]="isLineSelected(li.id)" (change)="toggleLine(li.id)" />
                  <span>{{ li.description }}</span>
                  <span class="cell-sub mono" style="margin-left: auto;">{{ formatMoney(li.line_total) }}</span>
                </label>
              }
              @if (!inv.line_items.length) {
                <p class="hint" style="margin: 0;">This invoice has no line items.</p>
              }
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            @if (!isCreateMode) {
              <button class="btn" type="button" [disabled]="saving()" (click)="submitForApproval()">Submit for Approval</button>
            }
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save Draft' }}
            </button>
          </div>
        </div>
      } @else {
        <div class="card">
          <div class="card-head">
            <h3>Credit Note Details</h3>
          </div>
          <div class="card-body">
            <div class="grid g-2">
              <div class="field">
                <div class="cell-sub">Reason</div>
                <div>{{ optionLabel(REASON_OPTIONS, creditNote()!.reason) }}</div>
              </div>
              <div class="field">
                <div class="cell-sub">Credit Amount</div>
                <div class="cell-strong">{{ formatMoney(creditNote()!.credit_amount) }}</div>
              </div>
              <div class="field span-2">
                <div class="cell-sub">Reason Detail</div>
                <div style="white-space: pre-wrap;">{{ creditNote()!.reason_detail }}</div>
              </div>
            </div>
            @if (creditNote()!.line_items.length) {
              <div class="form-section-head">
                <h4>Line Items Affected</h4>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th class="r">Line Total</th>
                      <th class="r">Credited</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (li of creditNote()!.line_items; track li.id) {
                      <tr>
                        <td>{{ li.description_snapshot }}</td>
                        <td class="mono r">{{ formatMoney(li.line_total_snapshot) }}</td>
                        <td class="mono r cell-strong">{{ formatMoney(li.credited_amount) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" (click)="cancel()">Back</button>
            @if (creditNote()!.status === 'PENDING_APPROVAL' && canApprove()) {
              <button class="btn primary" type="button" [disabled]="saving()" (click)="approve()">
                {{ saving() ? 'Approving…' : 'Approve' }}
              </button>
            }
          </div>
        </div>
      }
      }
    }
  `,
})
export class CreditNoteDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly policy = inject(PolicyStore);

  protected readonly formatMoney = formatMoney;
  protected readonly optionLabel = optionLabel;
  protected readonly REASON_OPTIONS = CREDIT_NOTE_REASON_OPTIONS;
  protected readonly STATUS_OPTIONS = CREDIT_NOTE_STATUS_OPTIONS;

  private readonly invoiceIdParam = this.route.snapshot.paramMap.get('invoiceId');
  private readonly creditNoteIdParam = this.route.snapshot.paramMap.get('id');
  /** Branches on WHICH route param is present — invoices/:invoiceId/credit-note
   * (create) vs credit-notes/:id (view/edit an existing one). */
  protected readonly isCreateMode = !!this.invoiceIdParam;

  protected readonly invoice = signal<InvoiceRow | null>(null);
  protected readonly creditNote = signal<CreditNoteRow | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly downloading = signal(false);

  private readonly selectedLineIds = new Set<string>();

  protected form: Record<string, unknown> = {
    reason: null,
    reason_detail: '',
    credit_amount: null,
  };

  constructor() {
    if (this.isCreateMode) {
      this.loadInvoice(this.invoiceIdParam!);
      return;
    }
    if (!this.creditNoteIdParam) {
      this.loadError.set('No credit note id in the URL.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<CreditNoteRow>(`${environment.apiBaseUrl}/credit-notes/${this.creditNoteIdParam}`).subscribe({
      next: (row) => {
        this.creditNote.set(row);
        this.form = { reason: row.reason, reason_detail: row.reason_detail, credit_amount: row.credit_amount };
        for (const li of row.line_items) this.selectedLineIds.add(li.invoice_line_item_id);
        this.loadInvoice(row.invoice_id);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this credit note.');
        this.isLoading.set(false);
      },
    });
  }

  private loadInvoice(invoiceId: string): void {
    this.http.get<InvoiceRow>(`${environment.apiBaseUrl}/invoices/${invoiceId}`).subscribe({
      next: (row) => {
        this.invoice.set(row);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the original invoice.');
        this.isLoading.set(false);
      },
    });
  }

  protected canRaise(): boolean {
    return this.policy.can(SCREEN, 'raise');
  }

  protected canApprove(): boolean {
    return this.policy.can(SCREEN, 'approve');
  }

  /** Editable = a brand-new one being raised, or an existing Draft this role
   * can still raise/revise (§2.5's own two-button "Save Draft, then Submit
   * for Approval" workflow) — Pending Approval/Approved are always read-only
   * here regardless of role, matching the module's "no correction after the
   * fact, reverse and redo" rule (credit_notes.py's own update_credit_note
   * 409s once Submitted, this mirrors that at the UI too). */
  protected isEditable(): boolean {
    if (!this.canRaise()) return false;
    if (this.isCreateMode) return true;
    return this.creditNote()?.status === 'DRAFT';
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected remainingCreditable(): number {
    const inv = this.invoice();
    if (!inv) return 0;
    // credit_note_total only increments on APPROVAL (approve_credit_note,
    // api/v1/credit_notes.py) — a Draft's own credit_amount was never added
    // to it, so this figure is already correct for both create AND
    // edit-existing-Draft modes without needing to "add back" this row's
    // own amount.
    return num(inv.grand_total) - num(inv.credit_note_total);
  }

  protected isLineSelected(id: string): boolean {
    return this.selectedLineIds.has(id);
  }

  protected toggleLine(id: string): void {
    if (this.selectedLineIds.has(id)) this.selectedLineIds.delete(id);
    else this.selectedLineIds.add(id);
  }

  protected save(): void {
    const inv = this.invoice();
    if (!inv) return;
    const reasonDetail = String(this.form['reason_detail'] ?? '').trim();
    const missing: string[] = [];
    if (!this.form['reason']) missing.push('Reason');
    if (!reasonDetail) missing.push('Reason Detail');
    if (!this.form['credit_amount'] || num(this.form['credit_amount']) <= 0) missing.push('Credit Amount');
    if (missing.length) {
      this.saveError.set(`Required: ${missing.join(', ')}.`);
      return;
    }
    const amount = num(this.form['credit_amount']);
    const cap = this.remainingCreditable();
    if (amount > cap) {
      this.saveError.set(`Credit Amount cannot exceed the remaining creditable amount of ${formatMoney(cap)}.`);
      return;
    }

    const body: CreditNoteWriteBody = {
      invoice_id: inv.id,
      reason: this.form['reason'] as string,
      reason_detail: reasonDetail,
      credit_amount: amount,
      line_items_affected: [...this.selectedLineIds],
    };

    this.saving.set(true);
    this.saveError.set(null);
    const req$ = this.isCreateMode
      ? this.http.post<CreditNoteRow>(`${environment.apiBaseUrl}/credit-notes`, body)
      : this.http.put<CreditNoteRow>(`${environment.apiBaseUrl}/credit-notes/${this.creditNoteIdParam}`, body);
    req$.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.router.navigate(['/credit-notes', row.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.detail ?? 'Could not save this credit note.');
      },
    });
  }

  protected submitForApproval(): void {
    if (this.isCreateMode || !this.creditNoteIdParam) return;
    if (!window.confirm('Submit this Credit Note for approval? It cannot be edited after this.')) return;
    this.saving.set(true);
    this.actionError.set(null);
    this.http.post<CreditNoteRow>(`${environment.apiBaseUrl}/credit-notes/${this.creditNoteIdParam}/submit`, {}).subscribe({
      next: (row) => {
        this.saving.set(false);
        this.creditNote.set(row);
      },
      error: (err) => {
        this.saving.set(false);
        this.actionError.set(err?.error?.detail ?? 'Could not submit this credit note.');
      },
    });
  }

  protected approve(): void {
    if (!this.creditNoteIdParam) return;
    if (!window.confirm('Approve this Credit Note? This applies it to the invoice and cannot be undone.')) return;
    this.saving.set(true);
    this.actionError.set(null);
    this.http.post<CreditNoteRow>(`${environment.apiBaseUrl}/credit-notes/${this.creditNoteIdParam}/approve`, {}).subscribe({
      next: (row) => {
        this.saving.set(false);
        this.creditNote.set(row);
      },
      error: (err) => {
        this.saving.set(false);
        this.actionError.set(err?.error?.detail ?? 'Could not approve this credit note.');
      },
    });
  }

  // Same auth-and-blob mechanism as list-screen.component.ts's exportAs() —
  // Bearer auth is header-only, a plain <a href>/window.open would hit the
  // API unauthenticated.
  protected downloadPdf(): void {
    if (this.downloading() || !this.creditNoteIdParam) return;
    this.downloading.set(true);
    this.actionError.set(null);
    this.http
      .get(`${environment.apiBaseUrl}/credit-notes/${this.creditNoteIdParam}/pdf`, { responseType: 'blob', observe: 'response' })
      .subscribe({
        next: (res) => {
          this.downloading.set(false);
          const blob = res.body;
          if (!blob) return;
          const disposition = res.headers.get('Content-Disposition') ?? '';
          const match = /filename="?([^";]+)"?/.exec(disposition);
          const filename = match?.[1] ?? `${this.creditNote()?.credit_note_number ?? 'credit-note'}.pdf`;
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(objectUrl);
        },
        error: async (err) => {
          this.downloading.set(false);
          const blob = err?.error;
          if (blob instanceof Blob) {
            try {
              const parsed = JSON.parse(await blob.text());
              this.actionError.set(typeof parsed?.detail === 'string' ? parsed.detail : 'That download failed.');
              return;
            } catch {
              // not JSON — fall through
            }
          }
          this.actionError.set('That download failed.');
        },
      });
  }

  protected cancel(): void {
    if (this.isCreateMode) this.router.navigate(['/invoices', this.invoiceIdParam]);
    else this.router.navigate(['/credit-notes']);
  }
}
