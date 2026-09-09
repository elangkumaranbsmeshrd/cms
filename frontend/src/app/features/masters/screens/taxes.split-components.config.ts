import { ArrayFieldConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';

// §6a — moved out of taxes.form.config.ts's own arrayFields into its own
// screen (masters.taxes.split in the prototype).
const config: ArrayFieldConfig<TaxHeadRow> = {
  key: 'split_components',
  // Applies When / Condition (§3.2c; app-forms.js 'm.tax.split':432-440).
  // condition_rule can't bind the same direct way `applies_when` does — it's
  // a JSON column, and ArrayColumnConfig only knows how to point a column at
  // one plain string/number/boolean/date, with no per-column transform. So
  // `condition_text` is the column actually bound (free text — matches the
  // prototype's own "simple comparison, not a rule builder" scope), and
  // TaxHeadChildScreenComponent mirrors it to and from condition_rule on
  // either side of the request — see CONDITION_TEXT_COLUMN there.
  //
  // The previous shape defined condition_rule as a live getter on the object
  // emptyItem() returned. That worked for a row typed in this session and
  // ONLY for one: a row LOADED from the head's GET response carries a plain
  // condition_rule and no condition_text at all, so an existing conditional
  // component rendered its Condition cell EMPTY and re-saved the old rule
  // whatever was typed over it — confirmed live before this fix. The mirror
  // now runs over every row, loaded or new, which is why the getter is gone.
  label: 'Split Components — optional on any method; shares must sum to 100.',
  columns: [
    { key: 'sequence_no', label: 'Sequence #', type: 'number' },
    { key: 'component_name', label: 'Component Name' },
    { key: 'share_pct', label: 'Share of Total (%)', type: 'number' },
    {
      key: 'applies_when',
      label: 'Applies When',
      type: 'select',
      staticOptions: [
        { value: 'ALWAYS', label: 'Always' },
        { value: 'CONDITIONAL', label: 'Only when a condition is met' },
      ],
    },
    { key: 'condition_text', label: 'Condition (required when Applies When is conditional)' },
  ],
  emptyItem: () => ({
    sequence_no: 1,
    component_name: '',
    share_pct: 0,
    applies_when: 'ALWAYS',
    condition_text: '',
    condition_rule: null,
  }),
};

export default config;
