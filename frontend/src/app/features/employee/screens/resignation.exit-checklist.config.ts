import { ChecklistScreenConfig } from '../../../shared/screens/screen.types';

interface ExitChecklistStepRow {
  readonly id: string;
  readonly resignation_id: string;
  readonly employee_id: string;
  readonly step_key: string;
  readonly ordinal: number;
  readonly gated_by_step_id: string | null;
  readonly status: string; // LOCKED | OPEN | DONE
  readonly outstanding_asset_count: number;
  readonly completion_note: string | null;
}

function titleCase(key: string): string {
  return key.replace(/_/g, ' ').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** §2.13 Offboarding's exit checklist — GET /resignations/{resignation_id}
 * /exit-checklist, a bare array (same shape situation as Onboarding's own
 * config: no subject/employee info in the response, so the header stays
 * generic). Gated: `gated_by_step_id` names the step that must be Done
 * first — real, not advisory (asset return stays locked until the
 * resignation letter exists). HR/SA-only to complete
 * (toggleScreenAction: 'process_exit'); Employee/Manager see it read-only.
 *
 * `completion_note`/`confirmation_acknowledged` (2 of 5 steps want the
 * confirm flag) aren't captured — same "generic toggle, one POST, empty
 * body" limitation emp.onboarding.checklist.config.ts already documents.
 */
const config: ChecklistScreenConfig<readonly ExitChecklistStepRow[], ExitChecklistStepRow> = {
  shape: 'checklist',
  id: 'employee.offboarding',
  title: 'Exit Checklist',
  specRef: '§2.13',
  endpoint: (id) => `/resignations/${id}/exit-checklist`,
  header: {
    name: () => 'Exit Checklist',
  },
  groups: [{ key: 'steps', items: (row) => row }],
  item: {
    // gated_by_step_id reads as a reference to another step ROW's own id
    // (a UUID, the usual FK shape in this backend), not its step_key — the
    // identity accessor must match that space or `gate` can never resolve
    // against `doneIds()` and every gated step stays permanently blocked.
    id: (item) => item.id,
    title: (item) => titleCase(item.step_key),
    description: (item) => (item.outstanding_asset_count > 0 ? `${item.outstanding_asset_count} asset(s) still outstanding.` : ''),
    done: (item) => item.status === 'DONE',
    gate: (item) => item.gated_by_step_id,
    // Wires this step to the Asset Management module's own Reclaim on Exit
    // screen (asset.reclaim, standalone route assets/reclaim/:employeeId) —
    // left unset until that module existed. Renders an "Open" button
    // (checklist-screen.component.ts) once this step is OPEN, i.e. not
    // locked and not already done.
    route: (item) => (item.step_key === 'RETURN_ALL_ASSETS' ? ['/assets', 'reclaim', item.employee_id] : null),
  },
  toggleEndpoint: (_row, item) => (item.status === 'OPEN' ? `/exit-checklist-steps/${item.id}/complete` : null),
  toggleScreenAction: 'process_exit',
  itemNoun: 'step',
};

export default config;
