import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { INVOICE_STATUS_OPTIONS, InvoiceRow } from '../../invoice/invoice.api';
import { INVOICE_LIST_FILTERS } from '../../invoice/screens/invoice.list.config';

/** §2.3 Customer 360, Tab: Invoices — "This tab is served by the Invoice
 * module's own list endpoint filtered by customer_id, which carries that
 * module's filters and export... Clicking a row opens that Invoice's full
 * record." Filters/export mirror invoice.list.config.ts's own canonical set
 * (minus customer_id itself — every row here is already this one customer)
 * — imports the SAME array the Invoice List table uses rather than a
 * hand-copy, so a filter added there later (this array already grew once,
 * from 4 to 13) can never silently stop showing up here too, matching the
 * Project/Opportunity tabs' own established pattern. Column set stays
 * exactly §2.3's own stated 5 (Invoice Number/Date/Amount/Status/Balance) —
 * the canonical screen's own Ageing *column* is a richer view than this tab
 * claims to be; the Ageing *filter* is still real and ported below, since
 * filtering doesn't require also adding that column.
 *
 * Per §2.3's own correction: Total Invoiced/Received/Outstanding in the
 * record's persistent header are STORED rollup columns, not a sum of this
 * tab — this list is independent of those figures, not their source.
 */
export function buildCustomerInvoicesListConfig(customerId: string): ListScreenConfig<InvoiceRow> {
  return {
    shape: 'list',
    id: 'invoice.list',
    title: 'Invoices',
    specRef: '§2.3',
    recordNoun: 'invoice',
    description: 'Invoices raised to this customer. Read-only here — open the Invoice module to edit.',
    endpoint: `/invoices?customer_id=${customerId}`,
    exportable: true,
    searchParam: 'search',
    searchFields: ['invoice_number', 'reference'],
    includeInactiveParam: false,
    rowId: (row) => row.id,
    rowRoute: (row) => ['/invoices', row.id],
    filters: INVOICE_LIST_FILTERS.filter((f) => f.key !== 'customer_id'),
    columns: [
      { key: 'invoice_number', header: 'Invoice Number', type: 'code' },
      { key: 'invoice_date', header: 'Date', type: 'date' },
      { key: 'grand_total', header: 'Amount', type: 'money' },
      { key: 'status', header: 'Status', type: 'status', staticOptions: INVOICE_STATUS_OPTIONS },
      { key: 'balance_due', header: 'Balance', type: 'money' },
    ],
    defaultPageSize: 25,
    emptyText: 'No invoices yet.',
  };
}
