// Invariant 8: money aligns LEFT, numeric/count/qty/%/ageing aligns RIGHT.
// Ported directly from the prototype's own U.moneyAlign() (app-core.js) —
// same regex, same left-align decision — "enforced in one place, not per
// screen" per RBAC §2.2c-i. Changing the house rule is a one-line change
// here, not a hunt through every screen config.
import { ColumnDef } from './screen.types';

const MONEY_LABEL = /amount|total|value|salary|net pay|gross|balance|cost|price|rate|budget|payable|receivable|deduction|earning|reimburse/i;

export function isMoneyColumn<T>(col: ColumnDef<T>): boolean {
  return col.type === 'money' || (!col.type && MONEY_LABEL.test(col.header));
}

export function columnAlignClass<T>(col: ColumnDef<T>): 'money' | 'r' | '' {
  if (isMoneyColumn(col)) return 'money';
  if (col.type === 'number') return 'r';
  return '';
}
