import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';

const FY_REF = { endpoint: '/masters/financial-years', labelKey: 'label' };

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
    } @else {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Upload File</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div>
              <div class="cell-sub" style="margin-bottom: 2px;">Financial Year *</div>
              <select class="input" [(ngModel)]="financialYearId">
                <option [ngValue]="null">—</option>
                @for (opt of fyOptions(); track opt.id) {
                  <option [ngValue]="opt.id">{{ opt.label }}</option>
                }
              </select>
              <div class="cell-sub" style="margin-top: 4px;">All imported holidays will be linked to this financial year. Dates outside the year range will be rejected.</div>
            </div>
            <div>
              <div class="cell-sub" style="margin-bottom: 2px;">Holiday Type *</div>
              <select class="input" [(ngModel)]="typeChoice" (ngModelChange)="reparse()">
                <option value="MANDATORY">Mandatory</option>
                <option value="OPTIONAL">Optional</option>
                <option value="MIXED">Mixed — use Type column in file</option>
              </select>
              <div class="cell-sub" style="margin-top: 4px;">Choose Mandatory or Optional to apply one type to all rows. Choose Mixed to read the Type column from your file.</div>
            </div>
            <div>
              <div class="cell-sub" style="margin-bottom: 2px;">File *</div>
              <input class="input" type="file" accept=".csv,text/csv" (change)="onFileSelected($any($event.target).files)" />
              <div class="cell-sub" style="margin-top: 4px;">Accepted format: .csv — maximum 500 rows per import. (.xlsx/.xls not yet supported — see the note in this screen's source.)</div>
            </div>
            <div>
              <div class="cell-sub" style="margin-bottom: 2px;">Skip Duplicates</div>
              <label style="display: inline-flex; align-items: center; gap: 6px;">
                <input type="checkbox" [(ngModel)]="skipDuplicates" />
                Yes — skip any date already in the calendar (recommended)
              </label>
              <div class="cell-sub" style="margin-top: 4px;">If off, importing a date that already exists overwrites the existing holiday's name, type and recurring flag.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Expected CSV Format</h3></div>
        <div class="card-body">
          <div class="grid g-2">
            <div>
              <div class="cell-sub">Required columns</div>
              <div>Holiday Name, Date</div>
              <div class="cell-sub" style="margin-top: 4px;">Column headers must match exactly (case-insensitive)</div>
            </div>
            <div>
              <div class="cell-sub">Optional columns</div>
              <div>Type, Recurring</div>
              <div class="cell-sub" style="margin-top: 4px;">Type values: Mandatory or Optional. Recurring values: Yes or No</div>
            </div>
            <div>
              <div class="cell-sub">Date format</div>
              <div>dd-mm-yyyy</div>
              <div class="cell-sub" style="margin-top: 4px;">Example: 15-08-2026 for Independence Day</div>
            </div>
          </div>
          <div style="margin-top: 12px;">
            <div class="cell-sub" style="margin-bottom: 4px;">Sample CSV</div>
            <pre class="mono" style="background: var(--surface-2, #f5f5f5); padding: 10px; border-radius: var(--r-md); font-size: 12px; overflow-x: auto;">Holiday Name,Date,Type,Recurring
Republic Day,26-01-2027,Mandatory,Yes
Holi,14-03-2027,Mandatory,No
Good Friday,03-04-2027,Optional,No</pre>
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
          </div>
          <div class="card-body table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Holiday Name</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Recurring</th>
                </tr>
              </thead>
              <tbody>
                @for (row of parsedRows().slice(0, 10); track row.displayDate + row.name) {
                  <tr>
                    <td class="cell-strong">{{ row.name }}</td>
                    <td class="mono">{{ row.displayDate }}</td>
                    <td>{{ row.holiday_type === 'MANDATORY' ? 'Mandatory' : 'Optional' }}</td>
                    <td>{{ row.recurring_every_year ? 'Yes' : 'No' }}</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (parsedRows().length > 10) {
              <p class="cell-sub" style="margin: 8px 0 0;">…and {{ parsedRows().length - 10 }} more row(s).</p>
            }
          </div>
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

  protected readonly parsedRows = signal<ParsedRow[]>([]);
  protected readonly parseErrors = signal<string[]>([]);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly result = signal<ImportResult | null>(null);
  private rawText: string | null = null;

  protected fyOptions(): { id: string; label: string }[] {
    return this.refData.options(FY_REF) ?? [];
  }

  protected canSubmit(): boolean {
    return !!this.financialYearId && this.parsedRows().length > 0 && this.parseErrors().length === 0;
  }

  protected onFileSelected(files: FileList | null): void {
    const file = files?.[0];
    this.result.set(null);
    this.submitError.set(null);
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
        },
        error: (err) => {
          this.submitting.set(false);
          this.submitError.set(err?.error?.detail ?? 'Import failed.');
        },
      });
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
