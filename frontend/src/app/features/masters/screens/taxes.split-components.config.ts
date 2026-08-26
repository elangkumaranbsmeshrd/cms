import { ArrayFieldConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';

// §6a — moved out of taxes.form.config.ts's own arrayFields into its own
// screen (masters.taxes.split in the prototype). Same shape and the same
// condition_rule-derived-from-condition_text getter as before the move —
// see the comment on emptyItem() below, carried over unchanged.
const config: ArrayFieldConfig<TaxHeadRow> = {
  key: 'split_components',
  // Applies When / Condition (§3.2c; app-forms.js 'm.tax.split':432-440).
  // condition_rule can't bind the same direct way `applies_when` does — it's
  // a JSON column, and ArrayColumnConfig only knows how to point a column at
  // one plain string/number/boolean/date, with no per-column transform. So
  // `condition_text` is the column actually bound (free text — matches the
  // prototype's own "simple comparison, not a rule builder" scope), and
  // condition_rule is a live getter defined on each row created below: it
  // reads condition_text back out wrapped as {description: …} or null.
  //
  // KNOWN GAP (carried over from before this move): a row LOADED from the
  // existing head's GET response has a real, plain condition_rule property
  // rather than this getter, so typing a new Condition into an EXISTING
  // conditional split component and saving keeps the old condition_rule even
  // though every other column on that row saves correctly. Needs the getter
  // defined for every loaded row, not only emptyItem() — still out of scope
  // here; flagged, not fixed.
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
  emptyItem: () => {
    const item: Record<string, unknown> = {
      sequence_no: 1,
      component_name: '',
      share_pct: 0,
      applies_when: 'ALWAYS',
      condition_text: '',
    };
    Object.defineProperty(item, 'condition_rule', {
      enumerable: true,
      get: () => {
        const text = String(item['condition_text'] ?? '').trim();
        return text ? { description: text } : null;
      },
    });
    return item;
  },
};

export default config;
