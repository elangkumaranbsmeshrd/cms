import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { formatMoney } from '../../../shared/screens/cell-format';

const SCREEN = 'employee.offer_letters';

interface CustomTermRow {
  readonly id: string;
  readonly label: string;
  readonly adjustment_type: string;
  readonly amount: string;
}
interface OfferLetterRow {
  readonly id: string;
  readonly letter_number: string;
  readonly letter_type: string;
  readonly status: string;
  // §2.15's "Letter" section — "Pulled read-only from Employment Details" —
  // and "Compensation Summary" — "From Salary Structure". OfferLetterOut
  // (schemas/employee.py) already snapshots all of these at creation time;
  // only annual_ctc_snapshot was actually being read here before.
  readonly designation_snapshot: string | null;
  readonly department_snapshot: string | null;
  readonly employment_type_snapshot: string | null;
  readonly joining_date_snapshot: string | null;
  readonly basic_salary_snapshot: string | null;
  readonly hra_snapshot: string | null;
  readonly gross_monthly_snapshot: string | null;
  readonly annual_ctc_snapshot: string | null;
  readonly generated_at: string | null;
  readonly sent_at: string | null;
  // Set once Generate has run (employee_lifecycle.py's generate_offer_letter),
  // resolved through the generic /files/{id} blob endpoint — the real
  // equivalent of §2.15's Preview/Generate PDF actions.
  readonly pdf_file_id: string | null;
  readonly custom_terms: readonly CustomTermRow[];
}

const LETTER_TYPE_OPTIONS = [
  { value: 'OFFER_LETTER', label: 'Offer Letter' },
  { value: 'APPOINTMENT_LETTER', label: 'Appointment Letter' },
  { value: 'RESIGNATION_ACCEPTANCE_LETTER', label: 'Resignation Acceptance Letter' },
];

/** §2.15 Offer & Appointment Letter (employee.offer_letters — Accountant +
 * SA only, "Not a typo: HR does not get this screen" per the backend's
 * own comment). Bespoke: no single-record GET exists at all (list-by-
 * employee only), no PUT (immutable after Generate), Custom Terms is a
 * live sub-resource POST rather than an inline array submitted with the
 * rest of a form — none of that fits the 'document' shape's whole-record
 * load/save model (that shape assumes a real loadEndpoint + saveEndpoint,
 * neither of which exists here). Closer to the Salary Structure precedent
 * (versioned-by-creation, narrow sub-actions with their own RBAC verbs).
 *
 * Known, code-acknowledged gap: Custom Terms don't yet auto-create a
 * linked Ad-hoc Payslip Adjustment in Payroll — a negotiated term still
 * needs a second, manual entry there too (employee_lifecycle.py's own
 * comment says as much).
 */
@Component({
  selector: 'app-emp-offer-letters',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Letters</h3>
          @if (canEdit() && !showCreate()) {
            <button class="btn sm ghost" type="button" (click)="startCreate()">+ Generate Letter</button>
          }
        </div>
        <div class="card-body">
          @for (l of letters(); track l.id) {
            <div class="card" style="margin-bottom: 10px;">
              <div class="card-body">
                <div class="grid g-2" style="margin-bottom: 8px;">
                  <div><div class="cell-sub">Letter Number</div><div class="mono cell-strong">{{ l.letter_number }}</div></div>
                  <div><div class="cell-sub">Type</div><div>{{ typeLabel(l.letter_type) }}</div></div>
                  <div><div class="cell-sub">Status</div><div><span class="badge-s b-info">{{ l.status }}</span></div></div>
                  <div><div class="cell-sub">Joining Date</div><div class="mono">{{ l.joining_date_snapshot ?? '—' }}</div></div>
                  <div><div class="cell-sub">Designation</div><div>{{ l.designation_snapshot ?? '—' }}</div></div>
                  <div><div class="cell-sub">Department</div><div>{{ l.department_snapshot ?? '—' }}</div></div>
                  <div><div class="cell-sub">Employment Type</div><div>{{ l.employment_type_snapshot ?? '—' }}</div></div>
                </div>

                <div class="cell-sub" style="margin-bottom: 4px;">Compensation Summary</div>
                <div class="grid g-2" style="margin-bottom: 10px;">
                  <div><div class="cell-sub">Basic Salary (Monthly)</div><div>{{ l.basic_salary_snapshot ? formatMoney(l.basic_salary_snapshot) : '—' }}</div></div>
                  <div><div class="cell-sub">HRA (Monthly)</div><div>{{ l.hra_snapshot ? formatMoney(l.hra_snapshot) : '—' }}</div></div>
                  <div><div class="cell-sub">Gross Monthly</div><div>{{ l.gross_monthly_snapshot ? formatMoney(l.gross_monthly_snapshot) : '—' }}</div></div>
                  <div><div class="cell-sub">Annual CTC</div><div class="cell-strong">{{ l.annual_ctc_snapshot ? formatMoney(l.annual_ctc_snapshot) : '—' }}</div></div>
                </div>
                @if (l.custom_terms.length) {
                  <div class="cell-sub" style="margin-bottom: 4px;">Custom Terms</div>
                  <ul style="margin: 0 0 8px; padding-left: 18px;">
                    @for (t of l.custom_terms; track t.id) {
                      <li>{{ t.label }} — {{ t.adjustment_type === 'ADDITION' ? '+' : '−' }}{{ formatMoney(t.amount) }}</li>
                    }
                  </ul>
                }
                <div class="filter-row">
                  @if (canEdit() && l.status === 'DRAFT') {
                    <button class="btn sm ghost" type="button" (click)="addCustomTerm(l)">+ Add Custom Term</button>
                  }
                  @if (policy.can(SCREEN, 'generate') && l.status === 'DRAFT') {
                    <button class="btn sm ghost" type="button" (click)="generate(l)">Generate</button>
                  }
                  @if (policy.can(SCREEN, 'send') && l.status === 'GENERATED') {
                    <button class="btn sm ghost" type="button" (click)="send(l)">Send</button>
                  }
                  @if (l.pdf_file_id) {
                    <button class="btn sm ghost" type="button" [disabled]="downloadingId() === l.id" (click)="downloadPdf(l)">
                      {{ downloadingId() === l.id ? 'Opening…' : 'View PDF' }}
                    </button>
                  }
                </div>
              </div>
            </div>
          }
          @if (!letters().length) {
            <p class="hint" style="margin: 0;">No letters generated yet.</p>
          }
        </div>
      </div>

      @if (showCreate()) {
        <div class="card">
          <div class="card-head"><h3>Generate Letter</h3></div>
          <div class="card-body">
            @if (createError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ createError() }}</div>
            }
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Letter Type</div>
                <select class="input" [(ngModel)]="createForm['letter_type']">
                  @for (t of LETTER_TYPE_OPTIONS; track t.value) {
                    <option [value]="t.value">{{ t.label }}</option>
                  }
                </select>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="showCreate.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="createLetter()">
              {{ saving() ? 'Creating…' : 'Create Draft' }}
            </button>
          </div>
        </div>
      }
    }
  `,
})
export class EmpOfferLettersComponent implements OnInit {
  readonly employeeId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly policy = inject(PolicyStore);
  protected readonly formatMoney = formatMoney;
  protected readonly LETTER_TYPE_OPTIONS = LETTER_TYPE_OPTIONS;
  protected readonly SCREEN = SCREEN;

  protected readonly isLoading = signal(true);
  protected readonly letters = signal<readonly OfferLetterRow[]>([]);
  protected readonly actionError = signal<string | null>(null);
  protected readonly downloadingId = signal<string | null>(null);

  protected readonly showCreate = signal(false);
  protected readonly saving = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected createForm: Record<string, unknown> = {};

  ngOnInit(): void {
    this.load();
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected typeLabel(v: string): string {
    return LETTER_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<OfferLetterRow[]>(`${environment.apiBaseUrl}/employees/${this.employeeId()}/offer-letters`).subscribe({
      next: (rows) => {
        this.letters.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startCreate(): void {
    this.createForm = { letter_type: 'OFFER_LETTER' };
    this.createError.set(null);
    this.showCreate.set(true);
  }

  protected createLetter(): void {
    this.saving.set(true);
    this.createError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId()}/offer-letters`, this.createForm).subscribe({
      next: () => {
        this.saving.set(false);
        this.showCreate.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.createError.set(err?.error?.detail ?? 'Failed to create this letter.');
      },
    });
  }

  protected addCustomTerm(letter: OfferLetterRow): void {
    const label = window.prompt('Term label (e.g. "Joining Bonus")?');
    if (!label) return;
    const amountStr = window.prompt('Amount?', '0');
    const amount = Number(amountStr);
    if (!amountStr || Number.isNaN(amount)) return;
    const isAddition = window.confirm('Is this an ADDITION to pay? (Cancel = subtraction)');
    this.actionError.set(null);
    this.http
      .post(`${environment.apiBaseUrl}/offer-letters/${letter.id}/custom-terms`, {
        label,
        adjustment_type: isAddition ? 'ADDITION' : 'SUBTRACTION',
        amount,
        is_recurring: false,
        is_taxable: true,
        effective_from: new Date().toISOString().slice(0, 10),
        display_order: letter.custom_terms.length,
      })
      .subscribe({
        next: () => this.load(),
        error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to add this term.'),
      });
  }

  protected generate(letter: OfferLetterRow): void {
    if (!window.confirm('Generate this letter? It locks the custom terms and cannot be edited afterward.')) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/offer-letters/${letter.id}/generate`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to generate.'),
    });
  }

  protected send(letter: OfferLetterRow): void {
    if (!window.confirm('Send this letter to the employee now?')) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/offer-letters/${letter.id}/send`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to send.'),
    });
  }

  // §2.15's Preview/Generate PDF actions, real equivalent: once Generate has
  // run, pdf_file_id points at the actual rendered PDF (employee_lifecycle.py's
  // generate_offer_letter) — opened through the same generic, authenticated
  // /files/{id} blob endpoint payslip-screen.component.ts already uses for
  // its own "Download PDF".
  protected downloadPdf(letter: OfferLetterRow): void {
    if (!letter.pdf_file_id) return;
    this.actionError.set(null);
    this.downloadingId.set(letter.id);
    this.fileUpload.fetch(letter.pdf_file_id).subscribe({
      next: (blob) => {
        this.downloadingId.set(null);
        this.fileUpload.openBlob(blob);
      },
      error: (err) => {
        this.downloadingId.set(null);
        this.actionError.set(err?.error?.detail ?? 'Failed to open this PDF.');
      },
    });
  }
}
