import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CREDIT_NOTE_REASON_OPTIONS, CREDIT_NOTE_STATUS_OPTIONS, CUSTOMER_PICKER_REF, CreditNoteRow, USER_REF } from '../invoice.api';

// No dedicated "distinct raisers/approvers" endpoint, same optionsFromRows
// technique as Bugs' own Reported By (project.bugs.board.config.ts) — the
// picker's options derive from whichever rows are already on screen. Not
// superAdminOnly — both are ordinary, always-visible business columns on
// this screen (see the columns array below), not the RBAC §2.2(e)
// Created-By/Last-Modified-By audit-trail baseline pair.
function raisedByOptions(rows: readonly CreditNoteRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.raised_by && !seen.has(row.raised_by)) seen.set(row.raised_by, { value: row.raised_by, label: refData.label(USER_REF, row.raised_by) });
  }
  return [...seen.values()];
}

function approvedByOptions(rows: readonly CreditNoteRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.approved_by && !seen.has(row.approved_by)) seen.set(row.approved_by, { value: row.approved_by, label: refData.label(USER_REF, row.approved_by) });
  }
  return [...seen.values()];
}

// §2.5 Credit Note List — GET /credit-notes. `search` now a real server
// param (matches Invoice Number, Credit Note Number, Customer Name) — §2.5's
// own "Deferred" note listed it alongside Credit Amount range/Raised By/
// Approved By, all reversed here since none needed schema work, only the
// query-param wiring. No createRoute either — Credit Notes are only ever
// raised from an existing invoice's own Raise Credit Note action
// (invoice.document.config.ts), never a list "+Add".
const config: ListScreenConfig<CreditNoteRow> = {
  shape: 'list',
  id: 'credit_note.list',
  title: 'Credit Notes',
  specRef: '§2.5',
  description: 'Every credit note this role can see, live from the real backend.',
  endpoint: '/credit-notes',
  exportable: true,
  searchParam: 'search',
  searchFields: ['credit_note_number', 'invoice_number_snapshot', 'customer_name_snapshot'],
  includeInactiveParam: false,
  recordNoun: 'credit note',
  rowId: (row) => row.id,
  rowRoute: (row) => ['/credit-notes', row.id],
  // §2.5's own column order (data.js: no, inv, cust, reason, amt, status, by,
  // appr, date) — Raised By / Approved By were missing entirely before (both
  // real fields, CreditNoteOut.raised_by/.approved_by, just raw User ids
  // needing USER_REF to show a name instead of a uuid).
  columns: [
    // Prototype: 'mono cell-accent' (data.js) on both id-shaped columns —
    // type 'code' supplies the mono half automatically, cellClass supplies
    // the accent half (components.css's .cell-accent rule).
    { key: 'credit_note_number', header: 'Credit Note Number', type: 'code', cellClass: 'cell-accent' },
    { key: 'invoice_number_snapshot', header: 'Original Invoice', type: 'code' },
    { key: 'customer_name_snapshot', header: 'Customer', cellClass: 'cell-strong' },
    { key: 'reason', header: 'Reason', type: 'status', staticOptions: CREDIT_NOTE_REASON_OPTIONS },
    { key: 'credit_amount', header: 'Credit Amount', type: 'money' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: CREDIT_NOTE_STATUS_OPTIONS },
    { key: 'raised_by', header: 'Raised By', ref: USER_REF },
    { key: 'approved_by', header: 'Approved By', ref: USER_REF },
    { key: 'credit_note_date', header: 'Date', type: 'date' },
  ],
  filters: [
    {
      key: 'customer_id',
      label: 'Customer',
      kind: 'select',
      transport: 'server',
      optionsRef: CUSTOMER_PICKER_REF,
      allLabel: 'All Customers',
    },
    { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', options: CREDIT_NOTE_STATUS_OPTIONS },
    // Single-value, unlike Status above — the real endpoint takes exactly one
    // `reason` (api/v1/credit_notes.py), not a list, despite sitting next to a
    // multi-value status param.
    { key: 'reason', label: 'Reason', kind: 'select', transport: 'server', options: CREDIT_NOTE_REASON_OPTIONS, allLabel: 'All Reasons' },
    // param:'date' -> date_from/date_to — plain `date`, NOT `credit_note_date`
    // (confirmed against list_credit_notes' own Query param names).
    { key: 'credit_note_date', label: 'Credit Note Date', kind: 'daterange', transport: 'server', param: 'date' },
    { key: 'credit_amount', label: 'Credit Amount', kind: 'numberrange', transport: 'server' },
    // Both of these are people pickers and the chrome shows only allLabel
    // inside the <select> (f.label is a title tooltip), so each names its own
    // role — a shared 'Anyone' made the two adjacent dropdowns read alike.
    { key: 'raised_by', label: 'Raised By', kind: 'select', transport: 'server', allLabel: 'Raised by Anyone', optionsFromRows: raisedByOptions },
    { key: 'approved_by', label: 'Approved By', kind: 'select', transport: 'server', allLabel: 'Approved by Anyone', optionsFromRows: approvedByOptions },
  ],
  defaultPageSize: 25,
  emptyText: 'No credit notes yet.',
};

export default config;
