import { ListScreenConfig, TabbedScreenConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';
import baseTaxList from './taxes.list.config';
import taxSchemes from './tax-schemes.list.config';

// Masters §3.2 as the prototype renders it (app-screens2.js RECORDS.taxes):
// one record whose tabs group the heads by where they attach — Billing,
// Purchase, Payroll — rather than a single flat list with a Scope dropdown.
// The grouping IS the screen's organising idea: someone opening Taxes is
// almost always asking "what applies to invoices?", not "show me everything".
//
// Every tab reuses the SAME list config (columns, filters, row actions, export)
// and differs only by `rowFilter` and its labels, so a change to how a tax head
// is displayed lands on all four tabs at once and none can drift.
//
// NOTHING here names a real-world tax. §3.2 is emphatic that the system has no
// opinion about which taxes exist; the tabs are named after the ATTACHMENT
// POINT (a scope the database itself defines), never after a levy.

const BILLING = ['SALES_BILLING', 'SALES_AND_PURCHASE'];
const PURCHASE = ['PURCHASE', 'SALES_AND_PURCHASE'];
const PAYROLL = [
  'PAYROLL_EMPLOYEE_DEDUCTION',
  'PAYROLL_EMPLOYER_CONTRIBUTION',
  'PAYROLL_INCOME_TAX',
  'EMPLOYEE_DECLARATION',
];

/** A scoped view of the tax list. Drops the Scope filter AND the Scope
 * column, both of which would be redundant inside a tab that has already
 * fixed the scope — exactly what the prototype's own per-tab taxTable()
 * shows (app-screens2.js:613-621: Tax Name, Type, Rate, Applies From,
 * Status — no Scope column, since which tab you're on already says that). */
function scopedTab(
  opts: { scopes: string[]; title: string; createLabel: string; description: string; emptyText: string },
): ListScreenConfig<TaxHeadRow> {
  return {
    ...baseTaxList,
    title: opts.title,
    description: opts.description,
    createLabel: opts.createLabel,
    emptyText: opts.emptyText,
    rowFilter: (row) => opts.scopes.includes(row.scope),
    filters: (baseTaxList.filters ?? []).filter((f) => f.key !== 'scope'),
    columns: (baseTaxList.columns ?? []).filter((c) => c.key !== 'scope'),
  };
}

const billing = scopedTab({
  scopes: BILLING,
  title: 'Billing Taxes',
  createLabel: 'Add Billing Tax',
  description: 'These appear in the tax dropdown on an Invoice or Quote line item.',
  emptyText: 'No billing-scoped tax heads configured yet.',
});

const purchase = scopedTab({
  scopes: PURCHASE,
  title: 'Purchase Taxes',
  createLabel: 'Add Purchase Tax',
  description: 'These appear on a Purchase Bill and on Expense line items.',
  emptyText: 'No purchase-scoped tax heads configured yet.',
});

const payroll = scopedTab({
  scopes: PAYROLL,
  title: 'Payroll Taxes',
  createLabel: 'Add Payroll Tax',
  description:
    'These apply to salary runs — employee deductions, employer contributions, income tax and employee declarations. Slab bands, split components and relief rules are edited on the head itself.',
  emptyText: 'No payroll-scoped tax heads configured yet.',
});

// Not in the prototype: WITHHOLDING_AT_SOURCE was added to the spec on
// 2026-07-31, after the prototype was written. It is a real scope with real
// DB-level validation (a head needs at least one Withholding Direction), and
// it belongs to neither billing nor payroll — tax is deducted from a payment
// rather than added to a document — so it gets its own tab instead of being
// dropped for not appearing in an older mock.
const withholding = scopedTab({
  scopes: ['WITHHOLDING_AT_SOURCE'],
  title: 'Withholding',
  createLabel: 'Add Withholding Tax',
  description:
    'Deducted from a payment rather than added to a document. Each head declares which side of a payment it applies to, and feeds the Tax & Compliance register.',
  emptyText: 'No withholding-scoped tax heads configured yet.',
});

// The prototype's "Where Used" tab. Its full per-module reference map has no
// endpoint (§3.2's own Implementation status: "only usage_count and
// first_used_at exist per head; no per-module reference map endpoint"), so this
// shows the part that IS real — which heads have been used, how many times, and
// whether that has locked their arithmetic. That is the question the tab exists
// to answer before a rate change.
const whereUsed: ListScreenConfig<TaxHeadRow> = {
  ...baseTaxList,
  title: 'Where Used',
  description:
    'A tax head locks once it has been used in a calculation — change it by setting Applies Until and duplicating it with a later Applies From, never by editing the numbers underneath a document that already used them.',
  emptyText: 'No tax head has been used in a calculation yet.',
  rowFilter: (row) => (row.usage_count ?? 0) > 0,
  filters: (baseTaxList.filters ?? []).filter((f) => f.key !== 'scope'),
  // No create button here: this tab is a read of existing usage, not a place
  // to add a head.
  createRoute: undefined,
  columns: [
    { key: 'tax_name', header: 'Tax', cellClass: 'cell-strong' },
    { key: 'short_code', header: 'Short Code', type: 'code' },
    { key: 'usage_count', header: 'Records', type: 'number' },
    { key: 'is_arithmetic_locked', header: 'Locked', type: 'status' },
    { key: 'applies_from', header: 'Applies From', type: 'date' },
    { key: 'applies_until', header: 'Applies Until', type: 'date' },
  ],
};

// BUILT — §6b. The prototype's 4th tab, "Tax Schemes" (app-screens2.js:
// 650-654, k:'schemes', D.masters.taxSchemes) — a genuinely different
// resource (/masters/tax-schemes, masters_tax_schemes.py) from the other
// five tabs, all of which scope the SAME tax-heads endpoint. Positioned
// between Withholding and Where Used, matching the prototype's own tab
// order; Withholding stays where it already was (A276, approved after the
// prototype froze — an unrelated later addition, not reordered by this).
const config: TabbedScreenConfig<TaxHeadRow[]> = {
  shape: 'tabbed',
  id: 'masters.taxes',
  title: 'Taxes',
  specRef: '§3.2',
  description:
    'One dynamic list where Super Admin defines every tax this company actually applies. Nothing is pre-set and no tax is named anywhere in the specification.',
  headerEndpoint: '/masters/taxes',
  header: {
    avatar: () => '%',
    recId: () => 'Masters §3.2',
    name: () => 'Taxes',
    meta: (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const active = list.filter((r) => r.is_active).length;
      const locked = list.filter((r) => r.is_arithmetic_locked).length;
      return [
        `${active} active ${active === 1 ? 'head' : 'heads'}`,
        `${list.length} total`,
        locked ? `${locked} locked by use` : '',
      ];
    },
    badge: (rows) => (Array.isArray(rows) && rows.some((r) => r.is_active) ? 'Active' : 'Draft'),
  },
  tabs: [
    { key: 'billing', label: 'Billing Taxes', config: billing },
    { key: 'purchase', label: 'Purchase Taxes', config: purchase },
    { key: 'payroll', label: 'Payroll Taxes', config: payroll },
    { key: 'withholding', label: 'Withholding', config: withholding },
    { key: 'schemes', label: 'Tax Schemes', config: taxSchemes },
    { key: 'used', label: 'Where Used', config: whereUsed, hideCount: true },
  ],
};

export default config;
