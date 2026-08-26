import { SingletonFormConfig } from '../../../shared/screens/screen.types';
import { CompanyProfileRow } from '../masters.api';

import { emptyCompanyProfileRow } from './company-profile.singleton.config';

// §5 — the prototype's 4th tab (app-screens2.js:672-787), missing from the
// build entirely. Company letterhead template and logo (§3.6d) — every
// generated PDF in the system (invoice, payslip, offer letter, credit note,
// asset card; pdf_engine.company_logo_bytes() is the one place all of them
// read it from) depends on what's uploaded here.
//
// A separate SingletonFormConfig from General Info rather than two more
// fields bolted onto it, matching the prototype's own tab split — both point
// at the same /masters/company-profile resource (whichever one is saved
// last wins for the fields it carries, same as any two forms over one
// record would; General Info and Documents never edit the same field, so
// this never actually conflicts in practice) and share the identical empty
// defaults (emptyCompanyProfileRow) so opening Documents before General Info
// has ever been filled in fails the same validation a blank General Info
// Save would, not a different, more confusing one.
const config: SingletonFormConfig<CompanyProfileRow> = {
  shape: 'singleton',
  id: 'masters.company_profile',
  title: 'Documents',
  loadEndpoint: '/masters/company-profile',
  createEndpoint: '/masters/company-profile',
  updateEndpoint: '/masters/company-profile',
  emptyRow: () => ({ ...emptyCompanyProfileRow(), logo_file_id: null, letterhead_file_id: null }),
  fields: [
    {
      key: 'logo_file_id',
      label: 'Company Logo',
      type: 'file',
      uploadPurpose: 'company_logo',
      fileAccept: 'image/jpeg,image/png',
      span: 2,
      hint: 'JPEG or PNG, up to 2MB. Printed in the header of every generated invoice, payslip, offer letter and other official document',
    },
    {
      key: 'letterhead_file_id',
      label: 'Letterhead Template',
      type: 'file',
      uploadPurpose: 'company_letterhead',
      fileAccept: 'image/jpeg,image/png,application/pdf',
      span: 2,
      hint: 'JPEG, PNG or PDF, up to 5MB. The letterhead treatment (contact details, footer, formatting) generated documents use alongside the Logo above',
    },
  ],
};

export default config;
