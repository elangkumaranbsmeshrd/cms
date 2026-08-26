import { TabbedScreenConfig } from '../../../shared/screens/screen.types';
import { CompanyProfileRow } from '../masters.api';

import companyProfileForm from './company-profile.singleton.config';
import companyProfileDocuments from './company-profile.documents.singleton.config';
import companyAddresses from './company-addresses.list.config';
import numberPrefixRules from './number-prefix-rules.list.config';
import bankAccounts from './bank-accounts.list.config';

// Masters §3.6 as the prototype renders it (app-screens2.js RECORDS.company):
// one record with an identity card and tabs, NOT a flat form with
// "Addresses →" / "Number Prefix Rules →" / "Bank Accounts →" buttons that
// navigate away and hide how many child rows exist.
//
// Each tab body is the real screen config for that sub-resource, so Addresses
// keeps its own filters, export, row actions and validation — this file only
// decides where they appear, never what they are.
//
// QUEUED / NOT BUILT — the prototype's page-level actions (app-screens2.js:740:
// Super Admin gets ['Save', 'Export PDF'], the view-only Manager gets
// ['Export PDF'] alone) have no home in this shape. TabbedScreenConfig
// (shared/screens/screen.types.ts:406-416) carries no actions/pageActions
// field at all — unlike ListScreenConfig's `secondaryActions`
// (screen.types.ts:177-180) — so neither button renders here. The same gap
// exists on every other tabbed screen (taxes, email-configuration, work-week),
// not unique to Company Profile, but this is the screen this audit round is
// scoped to.
//
// Save is the smaller half of it: General Info is its own 'singleton' config
// with createEndpoint/updateEndpoint (company-profile.singleton.config.ts:
// 48-49), so a page-level Save would only ever resubmit what that tab already
// saves itself — a convenience button, not a missing capability.
//
// Export PDF is the real gap: a whole-profile PDF a view-only Manager could
// pull, with no substitute anywhere in the tabbed shape. It can't be wired up
// even once `pageActions` exists on TabbedScreenConfig, because
// masters_company_profile.py defines no PDF/export route at all (its only
// routes are GET/POST/PUT on the profile record and its addresses /
// number-prefix-rules sub-resources) — needs a new backend export endpoint
// too. Worth noting for scoping that work: in the prototype itself the button
// isn't wired to real PDF generation either — it has no `go` handler
// (app-screens2.js:740), so R.record's action renderer (app-screens2.js:807)
// falls back to a `data-toast` "Export PDF — recorded." click, same as any
// other unimplemented prototype action. There's a real label to build
// towards, not a working reference implementation to copy.
const config: TabbedScreenConfig<CompanyProfileRow> = {
  shape: 'tabbed',
  id: 'masters.company_profile',
  title: 'Company Profile',
  specRef: '§3.6',
  description: "Your organization's own official details, addresses, bank info and numbering rules. Manager is view-only.",
  // The header reads the same singleton the General Info tab edits, so the
  // name/CIN/GSTIN in the card are the live saved values.
  headerEndpoint: '/masters/company-profile',
  header: {
    avatar: (row) => (row?.legal_name ?? 'Company').trim().charAt(0).toUpperCase(),
    recId: () => 'Masters §3.6',
    // Before the profile has ever been saved the GET returns null; the card
    // says so rather than rendering an empty identity.
    name: (row) => row?.legal_name || 'Company profile not set up yet',
    meta: (row) => [
      row?.cin ? `CIN ${row.cin}` : '',
      row?.gstin ? `GSTIN ${row.gstin}` : '',
      row?.industry ?? '',
    ],
    badge: (row) => (row ? 'Active' : 'Draft'),
  },
  // Tab order matches the prototype's own (app-screens2.js:672-787): General
  // Info · Addresses · Bank Details · Documents · Number Prefixes. Documents
  // (§5) was the one tab of the five with no Angular screen at all.
  tabs: [
    { key: 'general', label: 'General Info', config: companyProfileForm },
    { key: 'addresses', label: 'Addresses', config: companyAddresses },
    { key: 'bank', label: 'Bank Details', config: bankAccounts },
    { key: 'documents', label: 'Documents', config: companyProfileDocuments },
    { key: 'prefixes', label: 'Number Prefixes', config: numberPrefixRules },
  ],
};

export default config;
