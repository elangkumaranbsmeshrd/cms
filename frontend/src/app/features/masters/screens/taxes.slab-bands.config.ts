import { ArrayFieldConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';

// §6a — moved out of taxes.form.config.ts's own arrayFields into its own
// screen (masters.taxes.slab in the prototype), reached from a "Slab Bands"
// button on an existing Tax Head's edit page (tax-head-child-screen.
// component.ts). Same shape verbatim as before the move — this relocation
// changes where it's edited, not what it edits.
const config: ArrayFieldConfig<TaxHeadRow> = {
  key: 'slab_bands',
  label: 'Slab Bands — Slab method only. Contiguous, with exactly one open-ended "and above" band, last in sequence.',
  columns: [
    { key: 'sequence_no', label: 'Sequence #', type: 'number' },
    // The '₹' baked into this label (and Rate/Amount's, below) is a literal
    // — the same currency gap documented in cell-format.ts/taxes.list.
    // config.ts: Company Profile has no currency_code field to read from yet.
    { key: 'band_from', label: 'Band From (₹)', type: 'number' },
    { key: 'band_to', label: 'Band To (blank = and above)', type: 'number' },
    { key: 'rate_or_amount', label: 'Rate (%) or Amount (₹)', type: 'number' },
    { key: 'band_label', label: 'Band Label (optional)' },
  ],
  emptyItem: () => ({ sequence_no: 1, band_from: 0, band_to: null, rate_or_amount: 0, band_label: null }),
};

export default config;
