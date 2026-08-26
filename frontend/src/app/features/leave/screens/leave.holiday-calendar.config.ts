import { CalendarEventTypeOption, CalendarScreenConfig } from '../../../shared/screens/screen.types';
import { HolidayRow } from '../../masters/masters.api';

const HOLIDAY_TYPE_OPTIONS: readonly CalendarEventTypeOption[] = [
  { value: 'MANDATORY', label: 'Mandatory', badgeClass: 'b-danger' },
  { value: 'OPTIONAL', label: 'Optional', badgeClass: 'b-outline' },
];

// §2.4 Company Holiday Calendar — "sourced entirely from Masters → Holidays
// ... identical filter set, not editable here" (CalendarScreenConfig's own
// doc comment). No dedicated leave.* screen key exists for this mirror — it
// gates on masters.holidays directly, which is deliberately seeded
// view-only for Accountant/HR/Employee (backend/app/seed.py) so every role
// that can reach Leave can also read this. `editable` stays unset (falsy),
// so this instance never shows Add/Bulk Import regardless of what any role
// holds on masters.holidays — same read-only mirror the type's own doc
// comment describes.
const config: CalendarScreenConfig<HolidayRow> = {
  shape: 'calendar',
  id: 'masters.holidays',
  title: 'Company Holiday Calendar',
  specRef: '§2.4',
  recordNoun: 'holiday',
  description: 'The same company holiday calendar as Masters → Holidays, viewed from Leave.',
  endpoint: '/masters/holidays',
  date: (row) => row.holiday_date,
  name: (row) => row.name,
  type: (row) => row.holiday_type,
  typeOptions: HOLIDAY_TYPE_OPTIONS,
  // §2.4: R.calendar's page head always carries Export PDF/Export Excel
  // (app-screens.js:449, unconditional — unlike Add/Bulk Import which are
  // gated on `editable`). GET /masters/holidays is one of the "15 simple
  // sub-masters" masters_lookup.py's generic factory serves, which gets
  // ?format=pdf|excel for free (confirmed against holidays.calendar.config.ts,
  // the Masters mirror of this exact same endpoint) — this mirror had been
  // left without it.
  exportable: true,
  emptyText: 'No holidays configured.',
  readOnlyNote: 'Read-only here for every role. Holidays are configured from Masters → Holidays.',
};

export default config;
