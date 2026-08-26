import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { HolidayRow } from '../masters.api';

const FY_REF = { endpoint: '/masters/financial-years', labelKey: 'label' };
const HOLIDAY_TYPE_OPTIONS = [
  { value: 'MANDATORY', label: 'Mandatory' },
  { value: 'OPTIONAL', label: 'Optional' },
];

const config: FormScreenConfig<HolidayRow> = {
  shape: 'form',
  id: 'masters.holidays',
  title: 'Holiday',
  listEndpoint: '/masters/holidays',
  createEndpoint: '/masters/holidays',
  updateEndpoint: (id) => `/masters/holidays/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/holidays'],
  emptyRow: () => ({ name: '', holiday_date: '', financial_year_id: '', holiday_type: 'MANDATORY', recurring_every_year: false, is_active: true }),
  // §3b built Status as `createOnly` (masters_lookup.py's
  // create_only_fields) — settable only when adding a new holiday. Once a
  // row exists, this factory-built lookup has no Deactivate/Activate row
  // action wired on the Holidays calendar (its own shape has no rowActions
  // hook — see holidays.calendar.config.ts), so a holiday's Status is
  // effectively fixed at creation today; that's a pre-existing gap this
  // pass doesn't extend, only documents.
  //
  // Masters §4.3 audit fix moved masters.holidays off a ListScreenConfig
  // onto CalendarScreenConfig (holidays.calendar.config.ts), matching the
  // prototype's actual `type: 'calendar'` (data.js:1526). That shape has no
  // rowActions hook at all (only rowRoute, for click-to-edit) and Deactivate/
  // Delete are gone with it — restoring exact prototype parity, since
  // R.calendar (app-screens.js:444-465) never offered them either.
  //
  // QUEUED (unrelated, unresolved by that move) — masters_lookup.py's factory
  // still has no reverse of POST /{id}/deactivate, so a deactivated holiday
  // can never come back via this UI even though 'm.holidays' (prototype
  // app-forms.js:67-77) carries a Status toggle defaulting to Active.
  // customer-sources, customer-statuses, service-categories, ticket-categories
  // and units-of-measure already carry an Activate row action pointed at
  // POST /{id}/activate ahead of the backend adding it (inert/404 until it
  // does) — Holidays has nowhere to put the equivalent button until either
  // the calendar shape grows an actions hook of its own, or this gap is
  // revisited alongside that shape's next change.
  fields: [
    {
      key: 'name',
      label: 'Holiday Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Independence Day',
    },
    {
      // The range check is a real database trigger (alembic 0002_masters.py),
      // not advice — a date outside the linked year comes back as a 409 with
      // its own message, so the hint warns rather than duplicating the rule.
      key: 'holiday_date',
      label: 'Date',
      type: 'date',
      required: true,
      hint: 'Must fall inside the linked Financial Year date range',
    },
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      type: 'select',
      required: true,
      ref: FY_REF,
      hint: 'From Masters → Financial Year. Ties the holiday to a specific year, for reporting and for scoping bulk imports.',
    },
    {
      key: 'holiday_type',
      label: 'Type',
      type: 'select',
      required: true,
      staticOptions: HOLIDAY_TYPE_OPTIONS,
      hint: 'Mandatory = compulsory company-wide day off, excluded from working-day counts and overriding a working Saturday. Optional = the employee may choose to take it, drawn from their leave balance.',
    },
    {
      key: 'recurring_every_year',
      label: 'Recurring Every Year',
      type: 'checkbox',
      hint: "Convenience flag for your own reference — it does not automatically create next year's entry in this version.",
    },
    {
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: 'Defaults to Active. Uncheck to create this holiday already inactive. No screen currently offers a way to change it after creation (see this file\'s own header comment).',
    },
  ],
};

export default config;
