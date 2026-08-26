import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { CompanyAddressRow } from '../masters.api';

const STATE_REF = { endpoint: '/masters/company-profile/indian-states' };
// Matches the real DB CHECK constraint exactly (ck_company_addresses_type,
// alembic/versions/0002_masters.py) — confirmed live after the first guess
// (REGISTERED/BILLING/BRANCH/WAREHOUSE) was rejected.
//
// QUEUED / NOT FIXED — §6 "nothing hardcoded" gap, same shape as Customer
// Status/Source (masters_lookup.py) but not yet given the same treatment.
// Address Type is a pure classification label — nothing in
// masters_company_profile.py branches on its value, only is_primary/
// is_active drive behaviour there — so there is no functional reason it
// couldn't be a Masters lookup instead of a fixed three-value list. It isn't
// one today because:
//   - masters_lookup.py's generic factory (`build_lookup_router`) serves
//     exactly 15 named sub-masters (see its own docstring) — Address Type is
//     not among them and has no `company_address_types` table to read.
//   - The constraint lives as a DB CHECK on company_addresses.address_type
//     (ck_company_addresses_type), not a nullable FK — turning this into a
//     real lookup means a migration (new lookup table + seed the three
//     existing values + swap the CHECK for a FK), a new
//     GET/POST/deactivate route (either the 16th entry in masters_lookup.py
//     or a bespoke pair like Bank Account's), and a schema change to
//     CompanyAddressWrite/CompanyAddressOut — none of which exists yet.
// Until that lands, this stays a hardcoded array duplicated here and in
// company-addresses.list.config.ts, both kept verbatim in sync with the CHECK.
const ADDRESS_TYPE_OPTIONS = [
  { value: 'REGISTERED_OFFICE', label: 'Registered Office' },
  { value: 'BRANCH_OFFICE', label: 'Branch Office' },
  { value: 'CORRESPONDENCE', label: 'Correspondence' },
];

// MASTER-BUILD-PROMPT.md §4.2: company-addresses was one of four Masters
// forms with no updateEndpoint, named alongside financial-years as a defect
// to fix regardless of what the prototype's own UI offers here (nothing — no
// Edit action, no clickable row, app-screens2.js:706-709). Edit now goes
// through masters_company_profile.py's update_address; Set Primary and
// Deactivate stay the two row actions for those specific lifecycle changes.
const config: FormScreenConfig<CompanyAddressRow> = {
  shape: 'form',
  id: 'masters.company_profile',
  title: 'Company Address',
  listEndpoint: '/masters/company-profile/addresses',
  createEndpoint: '/masters/company-profile/addresses',
  updateEndpoint: (id) => `/masters/company-profile/addresses/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/company-profile/addresses'],
  // 'REGISTERED_OFFICE', not the 'REGISTERED' this seeded before: that value
  // is not in ck_company_addresses_type, so the pre-filled default was
  // rejected by the database on any save that left the dropdown untouched.
  emptyRow: () => ({ address_type: 'REGISTERED_OFFICE', line1: '', line2: null, city: '', state_id: '', pin_code: '' }),
  fields: [
    { key: 'address_type', label: 'Address Type', type: 'select', staticOptions: ADDRESS_TYPE_OPTIONS, required: true },
    { key: 'line1', label: 'Address Line 1', required: true, span: 2, placeholder: 'e.g. No. 14, Habibullah Road, T. Nagar' },
    { key: 'line2', label: 'Address Line 2', span: 2 },
    { key: 'city', label: 'City', required: true, placeholder: 'e.g. Chennai' },
    {
      key: 'state_id',
      label: 'State',
      type: 'select',
      ref: STATE_REF,
      required: true,
      hint: 'Indian states / UTs, from the seeded indian_states reference table',
    },
    {
      key: 'pin_code',
      label: 'PIN Code',
      required: true,
      placeholder: '600017',
      hint: 'Exactly 6 digits',
      // Mirrors ck_company_addresses_pin (REGEXP '^[0-9]{6}$') — advisory, the
      // DB constraint stays the authority.
      pattern: { re: /^[0-9]{6}$/, message: 'PIN Code must be exactly 6 digits' },
    },
  ],
  // The prototype's "Mark as Primary" toggle is deliberately absent: add_address
  // hardcodes is_primary=False and CompanyAddressWrite carries no such field, so
  // a toggle here would silently do nothing. Primary is set afterwards with the
  // list screen's own Set Primary action, which is the endpoint that performs
  // §3.6b's un-mark-the-previous-one swap.
};

export default config;
