import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { TicketCategoryRow } from '../masters.api';

// Labels, required markers, placeholders and hints are the prototype's own
// (app-forms.js 'm.ticketcategories'). Its Status toggle is §3b's
// `createOnly` field — settable only when adding a new category
// (masters_lookup.py's create_only_fields). Once a row exists, Status only
// moves through the list screen's Super-Admin-only Deactivate/Activate row
// action (§4a).
const config: FormScreenConfig<TicketCategoryRow> = {
  shape: 'form',
  id: 'masters.ticket_categories',
  title: 'Ticket Category',
  listEndpoint: '/masters/ticket-categories',
  createEndpoint: '/masters/ticket-categories',
  updateEndpoint: (id) => `/masters/ticket-categories/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/ticket-categories'],
  emptyRow: () => ({ name: '', code: null, description: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Category Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Technical Issue, Billing Query, Feature Request',
      // ticket_categories.name is unique in the schema; a clash surfaces as a
      // 409 from the API rather than a check here.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique in the schema.
      key: 'code',
      label: 'Code',
      hint: 'Optional short code, shown on the list and usable in exports. Must be unique if set.',
    },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: "Defaults to Active. Uncheck to create this category already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
