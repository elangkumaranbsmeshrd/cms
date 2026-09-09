import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { HolidayRow } from '../masters.api';

const FY_REF = { endpoint: '/masters/financial-years/options', labelKey: 'label' };

/** Shown in the "Expected CSV Format" card AND handed to the Download Sample
 * CSV button, so the file a user downloads can never drift from the format
 * the page documents. Rows lifted from the prototype's own sample
 * (app-forms.js:60). */
const SAMPLE_CSV = `Holiday Name,Date,Type,Recurring
Republic Day,26-01-2027,Mandatory,Yes
Holi,14-03-2027,Mandatory,No
Good Friday,03-04-2027,Optional,No
Independence Day,15-08-2027,Mandatory,Yes
Gandhi Jayanti,02-10-2027,Mandatory,Yes
Diwali,20-10-2027,Mandatory,No
Christmas,25-12-2026,Optional,Yes`;

type HolidayTypeChoice = 'MANDATORY' | 'OPTIONAL' | 'MIXED';

interface ParsedRow {
  name: string;
  holiday_date: string; // ISO yyyy-mm-dd
  holiday_type: 'MANDATORY' | 'OPTIONAL';
  recurring_every_year: boolean;
  displayDate: string; // dd-mm-yyyy, as the file had it
}

interface ImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
}

/** Masters §3.5's Bulk Import Holidays screen (prototype form 'm.holidays.import',
 * app-forms.js:47-61) — a bespoke screen, not a config-driven shape, because
 * none of the 14 generic shapes handle "parse an uploaded file client-side"
 * (see MASTERS-COMPLETION-PROMPT.md §2). Routed directly in masters.routes.ts
 * rather than through screenRoute()/ScreenHostComponent, for the same reason.
 *
 * Being routed directly is also why this file re-implements two things
 * ScreenHostComponent would otherwise have supplied: the RBAC gate on the
 * 'import' action (masters.routes.ts's canMatch only checks that the screen is
 * OPENABLE, and masters.holidays is openable read-only by all five roles —
 * seed.py SCREEN_PERMISSIONS), and the house form markup
 * (.field > label + .input + .hint, and the .toggle switch), which the form
 * shapes get from form-screen.component.ts. Both were missing: every control
 * here rendered with a .cell-sub caption instead of a real <label>, which left
 * it both visually unlike every other form in the app and unnamed to a screen
 * reader.
 *
 * CSV only for now — not .xlsx/.xls. The obvious library (SheetJS's `xlsx`)
 * ships two unpatched high-severity vulnerabilities (prototype pollution,
 * ReDoS — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) in every version on the
 * public npm registry; SheetJS only publishes fixed builds via their own CDN
 * now. Parsing untrusted uploaded files with a vulnerable parser is exactly
 * the wrong place to accept that risk, so this ships a hand-rolled CSV
 * parser and no xlsx dependency. Add .xlsx/.xls support later via SheetJS's
 * CDN tarball or an alternative maintained library (e.g. exceljs) — a
 * decision worth its own sign-off, not one to make silently.
 */
@Component({
  selector: 'app-holidays-import',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Bulk Import Holidays <span class="spec-ref">§3.5</span></h1>
        <p class="page-sub">Upload a CSV file to add multiple holidays at once. Duplicates — a date already in the calendar — are skipped with a warning by default.</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" (click)="back()">Cancel</button>
      </div>
    </div>

    <!-- result() first because Angular allows the "as" alias only on a chain's
         PRIMARY @if. Harmless as an ordering: result() is only ever set by a
         successful POST, which a role without the import grant can never
         reach. -->
    @if (result(); as r) {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-body">
          <p style="margin: 0 0 4px;"><b>Import complete.</b></p>
          <p style="margin: 0;">{{ r.imported }} imported, {{ r.skipped }} skipped as duplicates, {{ r.overwritten }} overwritten.</p>
          <div class="page-actions" style="margin-top: 12px;">
            <button class="btn primary" type="button" (click)="back()">Back to Calendar</button>
          </div>
        </div>
      </div>
    } @else if (!canImport()) {
      <!-- §3.0 Role Access: bulk import is Super Admin + Manager only, and the
           Bulk Import button on the calendar is already gated on the same
           'import' action. This is the deep-link path — HR, Accountant and
           Employee can OPEN masters.holidays (read-only), so the route guard
           lets them in and only this check stops them being shown a live form
           whose Import button the API would then 403. -->
      <div class="card">
        <div class="card-body">
          <div class="rbac-note">
            <div>
              You have view-only access to the Holidays calendar, so you cannot bulk import holidays.
              Importing is available to Super Admin and Manager only (Masters §3.5).
            </div>
          </div>
          <div class="page-actions" style="margin-top: 12px;">
            <button class="btn primary" type="button" (click)="back()">Back to Calendar</button>
          </div>
        </div>
      </div>
    } @else {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Upload File</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label for="hi-fy">Financial Year <span class="req" aria-hidden="true">*</span></label>
              <select
                id="hi-fy"
                class="input"
                aria-label="Financial Year"
                aria-required="true"
                [(ngModel)]="financialYearId"
              >
                <option [ngValue]="null">—</option>
                @for (opt of fyOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">All imported holidays will be linked to this financial year. Dates outside the year range will be rejected.</div>
            </div>

            <div class="field">
              <label for="hi-type">Holiday Type <span class="req" aria-hidden="true">*</span></label>
              <select
                id="hi-type"
                class="input"
                aria-label="Holiday Type"
                aria-required="true"
                [(ngModel)]="typeChoice"
                (ngModelChange)="reparse()"
              >
                <option value="MANDATORY">Mandatory</option>
                <option value="OPTIONAL">Optional</option>
                <option value="MIXED">Mixed — use Type column in file</option>
              </select>
              <div class="hint">Choose Mandatory or Optional to apply one type to all rows. Choose Mixed to read the Type column from your file.</div>
            </div>

            <div class="field">
              <!-- Same hidden-native-input + labelled-button shape
                   form-screen.component.ts uses for its own 'file' fields: a
                   raw <input type="file"> carries browser-drawn chrome that
                   .input cannot style, so it never matches the controls beside
                   it. aria-label is set explicitly for the same reason it is on
                   every control there — two <label for>s legally point at this
                   input, and the announced name should be exactly "File". -->
              <label for="hi-file">File <span class="req" aria-hidden="true">*</span></label>
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                @if (fileName(); as fn) {
                  <span class="badge-s b-ok">{{ fn }}</span>
                } @else {
                  <span class="cell-sub">No file chosen.</span>
                }
                <!-- .btn, not .btn.ghost (which form-screen's own file field
                     uses): ghost is transparent on both background and border,
                     which reads as bold text rather than a control. On that
                     screen the field is one of twenty and the upload is
                     optional; here it is the single action the whole screen
                     depends on, so it has to look pressable. -->
                <label class="btn sm" for="hi-file" style="cursor: pointer; margin: 0;">{{ fileName() ? 'Replace file' : 'Choose CSV' }}</label>
                <input
                  id="hi-file"
                  type="file"
                  aria-label="File"
                  style="display: none;"
                  accept=".csv,text/csv"
                  (change)="onFileSelected($any($event.target).files)"
                />
              </div>
              <div class="hint">Accepted format: .csv — maximum 500 rows per import. (.xlsx/.xls not yet supported — see the note in this screen's source.)</div>
            </div>

            <div class="field">
              <!-- A <span> is not labelable, so the <label> above carries no
                   for-attribute and names this through aria-labelledby
                   instead — the same reasoning (and the same keyboard
                   handlers) as form-screen.component.ts's own checkbox shape. -->
              <label id="hi-skip-label">Skip Duplicates</label>
              <span
                class="toggle"
                role="switch"
                tabindex="0"
                [attr.aria-checked]="skipDuplicates"
                aria-labelledby="hi-skip-label"
                [class.on]="skipDuplicates"
                (click)="skipDuplicates = !skipDuplicates"
                (keydown.enter)="skipDuplicates = !skipDuplicates"
                (keydown.space)="$event.preventDefault(); skipDuplicates = !skipDuplicates"
              >
                <span class="track"></span>
                <span class="tl">Yes — skip any date already in the calendar (recommended)</span>
              </span>
              <div class="hint">If off, importing a date that already exists overwrites the existing holiday's name, type and recurring flag.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>Expected CSV Format</h3>
          <div class="right">
            <button class="btn sm ghost" type="button" (click)="downloadSample()">Download Sample CSV</button>
          </div>
        </div>
        <div class="card-body">
          <div class="grid g-2">
            <div class="field">
              <label>Required columns</label>
              <div class="readonly-value">Holiday Name, Date</div>
              <div class="hint">Column headers must match exactly (case-insensitive)</div>
            </div>
            <div class="field">
              <label>Optional columns</label>
              <div class="readonly-value">Type, Recurring</div>
              <div class="hint">Type values: Mandatory or Optional. Recurring values: Yes or No</div>
            </div>
            <div class="field">
              <label>Date format</label>
              <div class="readonly-value mono">dd-mm-yyyy</div>
              <div class="hint">Example: 15-08-2026 for Independence Day</div>
            </div>
            <div class="field span-2">
              <label>Sample CSV</label>
              <!-- var(--surface-2) does not exist in tokens.css, so this block
                   used to fall through to a hardcoded #f5f5f5 — light grey
                   under light text in dark mode. Real tokens only. -->
              <pre
                class="mono"
                style="background: var(--surface-sunk); color: var(--text-primary); border: 1px solid var(--hairline); padding: 10px; border-radius: var(--r-md); font-size: 12px; overflow-x: auto; margin: 0;"
              >{{ sampleCsv }}</pre>
              <div class="hint">Copy this format into a spreadsheet and save as .csv — one holiday per row, no blank rows between them.</div>
            </div>
          </div>
        </div>
      </div>

      @if (parseErrors().length) {
        <div class="form-error" style="margin: 0 0 16px;">
          <b>{{ parseErrors().length }} problem(s) in the file:</b>
          <ul style="margin: 6px 0 0; padding-left: 18px;">
            @for (e of parseErrors(); track e) {
              <li>{{ e }}</li>
            }
          </ul>
        </div>
      }

      @if (parsedRows().length) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head">
            <h3>Preview — {{ parsedRows().length }} row(s) ready</h3>
            <span class="sub">{{ summaryLine() }}</span>
          </div>
          <div class="card-body flush">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holiday Name</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Recurring</th>
                    <th>Against the calendar</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of previewRows(); track row.displayDate + row.name) {
                    <tr>
                      <td class="cell-strong">{{ row.name }}</td>
                      <td class="mono">{{ row.displayDate }}</td>
                      <td>{{ row.holiday_type === 'MANDATORY' ? 'Mandatory' : 'Optional' }}</td>
                      <td>{{ row.recurring_every_year ? 'Yes' : 'No' }}</td>
                      <td>
                        @if (isDuplicate(row)) {
                          <span class="badge-s b-warn">{{ skipDuplicates ? 'Duplicate — will be skipped' : 'Duplicate — will be overwritten' }}</span>
                        } @else {
                          <span class="badge-s b-ok">New</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          @if (parsedRows().length > previewRows().length) {
            <div class="card-foot">
              <span class="hint">Showing the first {{ previewRows().length }} of {{ parsedRows().length }} row(s). The counts above cover all of them.</span>
            </div>
          }
        </div>
      }

      @if (submitError()) {
        <div class="form-error" style="margin: 0 0 16px;">{{ submitError() }}</div>
      }

      <div class="formbar">
        <div class="formbar-note">Review the preview above before importing — this cannot be bulk-undone.</div>
        <div class="formbar-actions">
          <button class="btn" type="button" (click)="back()">Cancel</button>
          <button
            class="btn primary"
            type="button"
            [disabled]="!canSubmit() || submitting()"
            (click)="submit()"
          >
            {{ submitting() ? 'Importing…' : 'Import ' + parsedRows().length + ' Holiday(s)' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class HolidaysImportComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected financialYearId: string | null = null;
  protected typeChoice: HolidayTypeChoice = 'MANDATORY';
  protected skipDuplicates = true;
  protected readonly sampleCsv = SAMPLE_CSV;

  protected readonly parsedRows = signal<ParsedRow[]>([]);
  protected readonly parseErrors = signal<string[]>([]);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly fileName = signal<string | null>(null);
  /** `${financial_year_id}|${yyyy-mm-dd}` for every holiday already in the
   * calendar — §3.5's "flags any duplicate dates found against the existing
   * list", which this screen previously never checked (it only caught a date
   * repeated twice inside the uploaded file). Keyed exactly the way
   * masters_simple.py's import endpoint keys its own duplicate check, so the
   * preview and the server agree on what a duplicate is. */
  private readonly existingKeys = signal<ReadonlySet<string>>(new Set<string>());
  private rawText: string | null = null;

  constructor() {
    // include_inactive: the server's duplicate check spans every holiday in
    // the year regardless of status, so a preview that only looked at Active
    // rows would under-report and promise an import the server then skips.
    if (this.canImport()) {
      this.http.get<HolidayRow[]>(`${environment.apiBaseUrl}/masters/holidays?include_inactive=true`).subscribe({
        next: (rows) =>
          this.existingKeys.set(new Set((rows ?? []).map((h) => `${h.financial_year_id}|${String(h.holiday_date).slice(0, 10)}`))),
        // Degrade to "no duplicates known" rather than blocking the import —
        // the server still enforces skip/overwrite either way.
        error: () => this.existingKeys.set(new Set<string>()),
      });
    }
  }

  /** §3.5 Role Access: "Super Admin: full CRUD (add, edit, bulk import,
   * delete/deactivate). Manager: add, edit, and bulk import only." Gated on
   * the same 'import' RBAC action the endpoint itself requires
   * (masters_simple.py's require_screen("masters.holidays", action="import")),
   * so this can never drift from what the API allows. */
  protected canImport(): boolean {
    return this.policy.can('masters.holidays', 'import');
  }

  protected fyOptions(): { id: string; label: string }[] {
    return this.refData.options(FY_REF) ?? [];
  }

  protected canSubmit(): boolean {
    return !!this.financialYearId && this.parsedRows().length > 0 && this.parseErrors().length === 0;
  }

  /** Capped preview — the summary counts below always cover the whole file. */
  protected previewRows(): ParsedRow[] {
    return this.parsedRows().slice(0, 10);
  }

  protected isDuplicate(row: ParsedRow): boolean {
    const fy = this.financialYearId;
    return !!fy && this.existingKeys().has(`${fy}|${row.holiday_date}`);
  }

  protected duplicateRows(): ParsedRow[] {
    return this.parsedRows().filter((r) => this.isDuplicate(r));
  }

  protected summaryLine(): string {
    if (!this.financialYearId) return 'Choose a financial year to check these dates against the existing calendar.';
    const dupes = this.duplicateRows().length;
    const total = this.parsedRows().length;
    if (!dupes) return `${total} new — no duplicate dates in this financial year.`;
    return `${total - dupes} new, ${dupes} duplicate date(s) — ${this.skipDuplicates ? 'skipped' : 'overwritten'}.`;
  }

  protected onFileSelected(files: FileList | null): void {
    const file = files?.[0];
    this.result.set(null);
    this.submitError.set(null);
    this.fileName.set(file?.name ?? null);
    if (!file) {
      this.rawText = null;
      this.parsedRows.set([]);
      this.parseErrors.set([]);
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      this.parsedRows.set([]);
      this.parseErrors.set(['Only .csv files are accepted in this version — see the File hint above.']);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.rawText = String(reader.result ?? '');
      this.reparse();
    };
    reader.onerror = () => this.parseErrors.set(['Could not read that file.']);
    reader.readAsText(file);
  }

  /** Re-run parsing when Holiday Type changes too — Mixed mode reads a Type
   * column the fixed modes ignore, so switching modes changes what counts
   * as a valid row without the user having to re-select the file. */
  protected reparse(): void {
    if (this.rawText !== null) this.parseCsv(this.rawText);
  }

  /** The sample the "Expected CSV Format" card already prints, as a file —
   * the prototype's own second button on this form (app-forms.js:64,
   * "Download Sample CSV"). */
  protected downloadSample(): void {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'holidays-sample.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  private parseCsv(text: string): void {
    const lines = splitCsvLines(text).filter((l) => l.some((cell) => cell.trim() !== ''));
    if (lines.length === 0) {
      this.parsedRows.set([]);
      this.parseErrors.set(['The file is empty.']);
      return;
    }

    const header = lines[0].map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf('holiday name');
    const dateIdx = header.indexOf('date');
    const typeIdx = header.indexOf('type');
    const recurringIdx = header.indexOf('recurring');

    const errors: string[] = [];
    if (nameIdx === -1) errors.push('Missing required column "Holiday Name".');
    if (dateIdx === -1) errors.push('Missing required column "Date".');
    if (this.typeChoice === 'MIXED' && typeIdx === -1) {
      errors.push('Holiday Type is set to Mixed, but the file has no "Type" column.');
    }
    if (errors.length) {
      this.parsedRows.set([]);
      this.parseErrors.set(errors);
      return;
    }

    const dataLines = lines.slice(1);
    if (dataLines.length > 500) {
      errors.push(`The file has ${dataLines.length} rows — the maximum is 500 per import.`);
    }

    const rows: ParsedRow[] = [];
    const seenInFile = new Set<string>();
    dataLines.slice(0, 500).forEach((cells, i) => {
      const rowNum = i + 2; // 1-indexed, plus the header row
      const name = (cells[nameIdx] ?? '').trim();
      const dateRaw = (cells[dateIdx] ?? '').trim();
      if (!name) {
        errors.push(`Row ${rowNum}: Holiday Name is blank.`);
        return;
      }
      const iso = parseDdMmYyyy(dateRaw);
      if (!iso) {
        errors.push(`Row ${rowNum}: "${dateRaw}" is not a valid dd-mm-yyyy date.`);
        return;
      }
      let type: 'MANDATORY' | 'OPTIONAL';
      if (this.typeChoice === 'MIXED') {
        const raw = (cells[typeIdx] ?? '').trim().toLowerCase();
        if (raw === 'mandatory') type = 'MANDATORY';
        else if (raw === 'optional') type = 'OPTIONAL';
        else {
          errors.push(`Row ${rowNum}: Type column must be "Mandatory" or "Optional", found "${cells[typeIdx] ?? ''}".`);
          return;
        }
      } else {
        type = this.typeChoice;
      }
      const recurringRaw = recurringIdx === -1 ? '' : (cells[recurringIdx] ?? '').trim().toLowerCase();
      const recurring = recurringRaw === 'yes';

      if (seenInFile.has(iso)) {
        errors.push(`Row ${rowNum}: ${dateRaw} appears more than once in this file.`);
        return;
      }
      seenInFile.add(iso);

      rows.push({ name, holiday_date: iso, holiday_type: type, recurring_every_year: recurring, displayDate: dateRaw });
    });

    this.parsedRows.set(rows);
    this.parseErrors.set(errors);
  }

  protected submit(): void {
    const fyId = this.financialYearId;
    if (!fyId || !this.canSubmit()) return;

    // §3.5: "Before an import is confirmed, a summary pop-up shows how many
    // holidays will be added and flags any duplicate dates found against the
    // existing list." The preview table shows this per-row; this is the
    // confirmation step the spec asks for, and it is the last point at which
    // Skip Duplicates can still be changed.
    if (!window.confirm(this.confirmMessage())) return;

    this.submitting.set(true);
    this.submitError.set(null);
    const body = this.parsedRows().map((r) => ({
      name: r.name,
      holiday_date: r.holiday_date,
      financial_year_id: fyId,
      holiday_type: r.holiday_type,
      recurring_every_year: r.recurring_every_year,
    }));
    this.http
      .post<ImportResult>(`${environment.apiBaseUrl}/masters/holidays/import?skip_duplicates=${this.skipDuplicates}`, body)
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.result.set(res);
          // The calendar changed under us — refresh the duplicate set so a
          // second import in the same visit is checked against reality.
          this.http.get<HolidayRow[]>(`${environment.apiBaseUrl}/masters/holidays?include_inactive=true`).subscribe({
            next: (rows) =>
              this.existingKeys.set(new Set((rows ?? []).map((h) => `${h.financial_year_id}|${String(h.holiday_date).slice(0, 10)}`))),
            error: () => undefined,
          });
        },
        error: (err) => {
          this.submitting.set(false);
          this.submitError.set(err?.error?.detail ?? 'Import failed.');
        },
      });
  }

  private confirmMessage(): string {
    const total = this.parsedRows().length;
    const dupes = this.duplicateRows();
    const fyLabel = this.fyOptions().find((o) => o.id === this.financialYearId)?.label ?? 'the selected financial year';
    const lines = [`${total - dupes.length} holiday(s) will be added to ${fyLabel}.`];
    if (dupes.length) {
      // Naming the actual dates matters more than the count — "3 duplicates"
      // is not something a user can check against their own file.
      const shown = dupes.slice(0, 8).map((d) => d.displayDate).join(', ');
      const more = dupes.length > 8 ? `, and ${dupes.length - 8} more` : '';
      lines.push(
        `${dupes.length} date(s) are already in this calendar: ${shown}${more}.`,
        this.skipDuplicates
          ? 'Skip Duplicates is ON, so these rows will be left exactly as they are.'
          : "Skip Duplicates is OFF, so these existing holidays' name, type and recurring flag will be OVERWRITTEN.",
      );
    } else {
      lines.push('No duplicate dates were found against the existing calendar.');
    }
    lines.push('Import now?');
    return lines.join('\n\n');
  }

  protected back(): void {
    this.router.navigate(['/masters/holidays']);
  }
}

/** Minimal RFC-4180-shaped CSV line splitter — handles quoted fields,
 * embedded commas inside quotes, and "" as an escaped quote. Deliberately
 * hand-rolled rather than a dependency: this is the one thing a CSV library
 * would buy here, and the format this screen accepts (per the spec's own
 * sample) is simple enough not to need one. */
function splitCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseDdMmYyyy(value: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject an impossible date (e.g. 31-02-2026) rather than silently
  // rolling it into the next month, the same discipline this codebase's
  // other date arithmetic (financial-years.form.config.ts) already uses.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}
