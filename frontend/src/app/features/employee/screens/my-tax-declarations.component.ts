import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { formatMoney } from '../../../shared/screens/cell-format';

const SCREEN = 'employee.tax_declarations';

interface TaxSchemeOption {
  readonly id: string;
  readonly scheme_name: string;
}
interface SchemeElectionRow {
  readonly id: string;
  readonly scheme_name_snapshot: string;
  readonly elected_at: string;
  readonly superseded_at: string | null;
}
interface DeclarationProofRow {
  readonly id: string;
  readonly file_id: string;
}
interface DeclarationLineRow {
  readonly id: string;
  readonly declaration_name_snapshot: string;
  readonly guidance_snapshot: string | null;
  readonly declaration_cap_snapshot: string | null;
  readonly requires_proof_snapshot: boolean;
  readonly amount_declared: string;
  readonly amount_accepted_for_calculation: string;
  readonly flagged_for_review: boolean;
  readonly verification_status: string;
  readonly verification_note: string | null;
  readonly proofs: readonly DeclarationProofRow[];
}
interface DeclarationRow {
  readonly id: string;
  readonly status: string;
  readonly total_declared_amount: string;
  readonly total_eligible_amount: string;
  readonly has_flagged_lines: boolean;
  readonly lines: readonly DeclarationLineRow[];
}

const VERIFICATION_OPTIONS = [
  { value: 'NOT_REVIEWED', label: 'Not Reviewed' },
  { value: 'PROOF_MATCHES', label: 'Proof Matches' },
  { value: 'PROOF_MISSING', label: 'Proof Missing' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** §2.14 My Tax Declarations (employee.tax_declarations, tax_declarations.py
 * — a separate router from compliance.py's company-level Module 15). No
 * /me alias anywhere here, same own-id-resolution pattern as My Documents.
 * Bespoke: dynamic per-Masters-tax-head line rendering has no generic
 * shape to reuse (FormScreenConfig.fields is authored once, not built
 * from a live declaration response), plus per-line proof upload and a
 * conditional scheme-election step.
 */
@Component({
  selector: 'app-my-tax-declarations',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Tax Declarations</h1>
        <p class="page-sub">Declare investments and expenses that reduce your taxable income.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Tax Scheme</h3></div>
        <div class="card-body">
          @if (currentSchemeName()) {
            <p style="margin: 0;">Current election: <b>{{ currentSchemeName() }}</b></p>
          } @else {
            <p class="hint" style="margin: 0 0 10px;">No tax scheme elected yet for this financial year.</p>
          }
          @if (!currentSchemeName() || canElectAgain()) {
            <!-- This picker had no name of any kind — not even a title to fall
                 back on — so axe flagged it [critical] select-name and a screen
                 reader announced a bare combo box. The card's own "Tax Scheme"
                 heading names it for a sighted user but associates nothing, so
                 that heading's text becomes the control's aria-label, the way
                 form-screen.component.ts puts the plain field.label on the
                 control itself. -->
            <div class="filter-row" style="margin-top: 10px;">
              <select class="input" style="width: auto;" aria-label="Tax Scheme" [(ngModel)]="selectedSchemeId">
                @for (s of schemes(); track s.id) {
                  <option [value]="s.id">{{ s.scheme_name }}</option>
                }
              </select>
              <button class="btn sm ghost" type="button" (click)="electScheme()">Elect Scheme</button>
            </div>
          }
        </div>
      </div>

      @if (!declaration()) {
        <div class="card">
          <div class="card-body">
            <p class="hint" style="margin: 0 0 10px;">No declaration started for this financial year yet.</p>
            <button class="btn sm primary" type="button" (click)="createDeclaration()">Start Declaration</button>
          </div>
        </div>
      } @else {
      @if (declaration(); as d) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head">
            <h3>Declaration — <span class="badge-s b-info">{{ d.status }}</span></h3>
            @if (d.status === 'DRAFT') {
              <button class="btn sm primary" type="button" (click)="submitDeclaration()">Submit</button>
            }
            @if (canVerify() && d.status === 'SUBMITTED') {
              <button class="btn sm ghost" type="button" (click)="verifyDeclaration()">Mark Declaration Verified</button>
            }
          </div>
          <div class="card-body">
            <div class="grid g-2" style="margin-bottom: 16px;">
              <div><div class="cell-sub">Total Declared</div><div class="cell-strong">{{ formatMoney(d.total_declared_amount) }}</div></div>
              <div><div class="cell-sub">Total Eligible</div><div class="cell-strong">{{ formatMoney(d.total_eligible_amount) }}</div></div>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Declaration</th>
                    <th class="r">Cap</th>
                    <th class="r">Amount Declared</th>
                    <th class="r">Accepted</th>
                    <th>Verification</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <!-- The two editable cells below are named per ROW, not just
                       per column. A <th> names a cell only for a sighted reader
                       scanning down the column, and no <label for> can be added
                       inside a grid of repeated rows without colliding ids — so
                       both controls were unnamed. Folding the row's own
                       declaration name into the label is what makes the name
                       useful rather than merely present: a screen reader user
                       arrowing through a dozen identical "Amount Declared"
                       boxes cannot tell which tax head they are typing into.
                       Same [attr.aria-label] mechanism form-screen.component.ts
                       uses for its own repeated array-table rows. -->
                  @for (l of d.lines; track l.id) {
                    <tr>
                      <td>
                        <div class="cell-strong">{{ l.declaration_name_snapshot }}</div>
                        <!-- §2.14's own Guidance column: "The head's Description
                             — shown as helper text under the field, so the
                             employee knows what qualifies without asking HR."
                             It arrives on every line as guidance_snapshot and
                             was being dropped on the floor: the value was in
                             the response, nothing rendered it. Sits under the
                             declaration's name rather than under the amount
                             box because in a table that is the only cell wide
                             enough to read a sentence in. -->
                        @if (l.guidance_snapshot) {
                          <div class="hint" style="margin-top: 2px;">{{ l.guidance_snapshot }}</div>
                        }
                      </td>
                      <td class="mono r">{{ l.declaration_cap_snapshot ? formatMoney(l.declaration_cap_snapshot) : '—' }}</td>
                      <td class="r">
                        @if (d.status === 'DRAFT') {
                          <input class="input" type="number" style="width: 120px; text-align: right;" [attr.aria-label]="'Amount Declared — ' + l.declaration_name_snapshot" [(ngModel)]="lineAmounts[l.id]" />
                        } @else {
                          {{ formatMoney(l.amount_declared) }}
                        }
                      </td>
                      <td class="mono r">{{ formatMoney(l.amount_accepted_for_calculation) }}</td>
                      <td>
                        @if (canVerify()) {
                          <select class="input" style="width: auto;" [attr.aria-label]="'Verification — ' + l.declaration_name_snapshot" [(ngModel)]="lineVerification[l.id]" (ngModelChange)="verifyLine(l)">
                            @for (v of VERIFICATION_OPTIONS; track v.value) {
                              <option [value]="v.value">{{ v.label }}</option>
                            }
                          </select>
                        } @else {
                          <!-- Was printing the raw column value — NOT_REVIEWED,
                               PROOF_MATCHES — to everyone who cannot verify.
                               VERIFICATION_OPTIONS already holds the readable
                               label the verifier's own dropdown shows. -->
                          <span class="badge-s" [class.b-success]="l.verification_status === 'PROOF_MATCHES'" [class.b-danger]="l.verification_status === 'REJECTED' || l.verification_status === 'PROOF_MISSING'">{{ verificationLabel(l.verification_status) }}</span>
                        }
                      </td>
                      <td style="white-space: nowrap;">
                        @if (d.status === 'DRAFT') {
                          <button class="btn sm ghost" type="button" (click)="saveLine(l)">Save</button>
                        }
                        <!-- §2.14: proof is "Mandatory if the head has
                             Requires Proof / Reference set to Yes, OPTIONAL
                             OTHERWISE" — so the control belongs on every line,
                             including the fixed "Other Declared Deduction"
                             catch-all, which the same section describes as
                             "Amount + Description + optional proof". It used to
                             render only on requires-proof lines, leaving an
                             employee with a receipt for anything else nowhere
                             to put it. Hidden once submitted, since the
                             declaration is locked for the financial year (the
                             backend rejects a late proof anyway).
                             The wrapping <label> names this input, but every
                             row would name it identically — the row's own
                             declaration name is what makes the name usable to
                             a screen reader arrowing down the column. -->
                        @if (d.status === 'DRAFT') {
                          <label class="btn sm ghost" style="cursor: pointer;">
                            Upload Proof
                            <input type="file" multiple style="display: none;" [attr.aria-label]="proofLabel(l)" (change)="uploadProof(l, $event)" />
                          </label>
                        }
                        <!-- Nothing on screen said whether a proof had landed:
                             the upload posted and the row looked identical
                             afterwards. -->
                        @if (proofCount(l)) {
                          <span class="badge-s b-success" style="margin-left: 6px;">{{ proofCount(l) }} attached</span>
                        } @else if (l.requires_proof_snapshot) {
                          <span class="badge-s b-warn" style="margin-left: 6px;">Proof required</span>
                        }
                      </td>
                    </tr>
                  }
                  @if (!d.lines.length) {
                    <tr><td colspan="6" class="cell-sub">No applicable declaration lines — nothing is configured for declaration-scope tax heads yet.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
      }
    }
  `,
})
export class MyTaxDeclarationsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly formatMoney = formatMoney;
  protected readonly VERIFICATION_OPTIONS = VERIFICATION_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly actionError = signal<string | null>(null);
  private employeeId = '';

  protected readonly schemes = signal<readonly TaxSchemeOption[]>([]);
  protected readonly elections = signal<readonly SchemeElectionRow[]>([]);
  protected readonly declaration = signal<DeclarationRow | null>(null);
  protected selectedSchemeId: string | null = null;
  protected lineAmounts: Record<string, unknown> = {};
  protected lineVerification: Record<string, string> = {};

  ngOnInit(): void {
    this.http.get<{ id: string }>(`${environment.apiBaseUrl}/employees/me`).subscribe({
      next: (me) => {
        this.employeeId = me.id;
        this.load();
      },
      error: () => this.isLoading.set(false),
    });
    // /options, not the gated masters.taxes screen (2026-08 RBAC audit fix) —
    // this screen is open to all five roles, but `masters.taxes` is
    // Accountant-view and nothing at all for Manager/HR/Employee (seed.py), so
    // the scheme picker 404'd for exactly the people who elect a scheme.
    // masters_tax_schemes.py's list_tax_scheme_options returns
    // {id, label, is_active}; mapped onto TaxSchemeOption's existing
    // {id, scheme_name} shape here so the template below needs no change —
    // same shape-mapping pattern my-expenses.component.ts uses for
    // /vendors/options.
    this.http.get<{ id: string; label: string }[]>(`${environment.apiBaseUrl}/masters/tax-schemes/options`).subscribe({
      next: (rows) => this.schemes.set(rows.map((r) => ({ id: r.id, scheme_name: r.label }))),
      error: () => this.schemes.set([]),
    });
  }

  protected canVerify(): boolean {
    return this.policy.can(SCREEN, 'verify');
  }

  protected canElectAgain(): boolean {
    // ONCE_PER_FY schemes reject a second election (409) — the button
    // stays visible regardless; the server's own error surfaces if this
    // employee's scheme doesn't allow changing it.
    return true;
  }

  protected currentSchemeName(): string | null {
    const active = this.elections().find((e) => !e.superseded_at);
    return active?.scheme_name_snapshot ?? null;
  }

  private load(): void {
    this.isLoading.set(true);
    this.http.get<SchemeElectionRow[]>(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-scheme-elections`).subscribe({
      next: (rows) => this.elections.set(rows),
      error: () => this.elections.set([]),
    });
    this.http.get<DeclarationRow>(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-declarations/current`).subscribe({
      next: (d) => {
        this.declaration.set(d);
        this.lineAmounts = Object.fromEntries(d.lines.map((l) => [l.id, l.amount_declared]));
        this.lineVerification = Object.fromEntries(d.lines.map((l) => [l.id, l.verification_status]));
        this.isLoading.set(false);
      },
      error: () => {
        this.declaration.set(null);
        this.isLoading.set(false);
      },
    });
  }

  protected electScheme(): void {
    if (!this.selectedSchemeId) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-scheme-elections`, { tax_scheme_id: this.selectedSchemeId }).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to elect this scheme.'),
    });
  }

  protected createDeclaration(): void {
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-declarations`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to start a declaration.'),
    });
  }

  protected saveLine(line: DeclarationLineRow): void {
    this.actionError.set(null);
    const body = { amount_declared: this.lineAmounts[line.id] ?? 0 };
    this.http.put(`${environment.apiBaseUrl}/tax-declaration-lines/${line.id}`, body).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to save this line.'),
    });
  }

  /** Read through a helper, not `line.proofs.length` in the template: the
   * field is new on TaxDeclarationLineOut, and a backend process older than
   * this bundle answers without it — which would throw inside the template and
   * blank the whole screen rather than just showing no badge. */
  protected verificationLabel(value: string): string {
    return VERIFICATION_OPTIONS.find((v) => v.value === value)?.label ?? value;
  }

  protected proofCount(line: DeclarationLineRow): number {
    return line.proofs?.length ?? 0;
  }

  protected proofLabel(line: DeclarationLineRow): string {
    const which = `Upload Proof — ${line.declaration_name_snapshot}`;
    return line.requires_proof_snapshot ? `${which} (required)` : which;
  }

  /** §2.14 words this field "File upload (multiple)", so the input takes a
   * multi-selection and each file is uploaded then attached in turn. The input
   * is cleared afterwards so picking the same file again still fires a change
   * event (a browser doesn't re-fire on an identical value). */
  protected uploadProof(line: DeclarationLineRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.actionError.set(null);
    // Reload once, after the last file settles either way — a failure part
    // way through still has to repaint, or the proofs that DID attach stay
    // invisible behind the error banner.
    let remaining = files.length;
    const settle = () => {
      remaining -= 1;
      if (remaining === 0) this.load();
    };
    for (const file of files) {
      this.fileUpload.upload(file, 'generic').subscribe({
        next: (uploaded) => {
          this.http.post(`${environment.apiBaseUrl}/tax-declaration-lines/${line.id}/proofs?file_id=${uploaded.id}`, {}).subscribe({
            next: () => settle(),
            error: (err) => {
              this.actionError.set(err?.error?.detail ?? 'Failed to attach this proof.');
              settle();
            },
          });
        },
        error: (err) => {
          this.actionError.set(err?.error?.detail ?? 'Failed to upload this file.');
          settle();
        },
      });
    }
  }

  protected submitDeclaration(): void {
    if (!window.confirm('Submit this declaration? You will not be able to edit amounts after submitting.')) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-declarations/current/submit`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to submit.'),
    });
  }

  protected verifyLine(line: DeclarationLineRow): void {
    const status = this.lineVerification[line.id];
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/tax-declaration-lines/${line.id}/verify`, { verification_status: status }).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to update verification.'),
    });
  }

  protected verifyDeclaration(): void {
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/employees/${this.employeeId}/tax-declarations/current/verify`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to verify — every line may need review first.'),
    });
  }
}
