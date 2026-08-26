import { ChecklistScreenConfig } from '../../../shared/screens/screen.types';

interface OnboardingItemRow {
  readonly id: string;
  readonly employee_id: string;
  readonly step_key: string;
  readonly ordinal: number;
  readonly status: string; // PENDING | COMPLETE | SKIPPED
  readonly is_auto_checked: boolean;
  readonly note: string | null;
}

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** §2.12 Onboarding (employee.onboarding, HR/SA only — mode 'none' for
 * every other role, confirmed in seed.py). GET /employees/{id}/onboarding
 * returns a BARE ARRAY (no wrapping employee/subject object) —
 * ChecklistScreenComponent's `row` therefore IS that array itself, which
 * carries no name/photo to show in the identity header. Left generic
 * ("Onboarding Checklist") rather than fabricated; the host record's own
 * page header (this is a tab on emp.record.config.ts) already names the
 * employee above it.
 *
 * "Skip" (POST /onboarding-items/{id}/skip, requires skipped_reason) has
 * no matching control here — ChecklistScreenConfig models exactly one
 * toggle action per item, and 5 of 7 real onboarding steps are
 * is_auto_checked anyway (no manual action at all). Complete is real and
 * wired; Skip is a deliberate, narrow, documented gap for this pass.
 */
const config: ChecklistScreenConfig<readonly OnboardingItemRow[], OnboardingItemRow> = {
  shape: 'checklist',
  id: 'employee.onboarding',
  title: 'Onboarding Checklist',
  specRef: '§2.12',
  endpoint: (id) => `/employees/${id}/onboarding`,
  header: {
    name: () => 'Onboarding Checklist',
  },
  groups: [{ key: 'steps', items: (row) => row }],
  item: {
    id: (item) => item.id,
    title: (item) => titleCase(item.step_key),
    description: (item) => (item.is_auto_checked ? 'Checked automatically when the linked action happens elsewhere in the system.' : ''),
    done: (item) => item.status === 'COMPLETE' || item.status === 'SKIPPED',
  },
  toggleEndpoint: (_row, item) => (item.status === 'PENDING' && !item.is_auto_checked ? `/onboarding-items/${item.id}/complete` : null),
  // "Send Welcome Email" (POST /employees/{id}/send-welcome-email) needs
  // THIS employee's id in its URL — SecondaryActionDef.endpoint is a fixed
  // string, no way to interpolate one, so it lives on the Account & Login
  // tab's `actions` instead (emp.record.config.ts), which already supports
  // a per-record dynamic endpoint via RecordActionDef.
  itemNoun: 'step',
};

export default config;
