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
  emptyRow: () => ({ ...emptyCompanyProfileRow(), logo_file_id: null, letterhead_file_id: null, invoice_template_file_id: null }),
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
    {
      // §3.6d's fourth upload section, "Invoice Template | File Upload
      // (single) | The layout file the Invoice module uses to generate invoice
      // PDFs" — the one named field of that table that has a real column
      // (company_profile.invoice_template_file_id, 0002_masters.py) rather
      // than living in the deferred `company_documents` table. It was
      // unreachable until now because CompanyProfileWrite never carried it;
      // it does now, so Invoice §2.3's "the invoice template set in Company
      // Profile" finally points at something a Super Admin can set.
      //
      // No `uploadPurpose` rule of its own in files.py, so it falls to
      // _DEFAULT_RULE there (PDF / JPEG / PNG / DOCX / XLSX, 10MB) — wider
      // than the letterhead's, which is right for a layout file.
      key: 'invoice_template_file_id',
      label: 'Invoice Template',
      type: 'file',
      uploadPurpose: 'company_invoice_template',
      fileAccept: 'application/pdf,image/jpeg,image/png',
      span: 2,
      hint: 'Optional, single file. The layout the Invoice module\'s Download uses when generating an invoice PDF — the same letterhead treatment every other generated document gets.',
    },
  ],
};

export default config;
