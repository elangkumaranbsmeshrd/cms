import { TabbedScreenConfig } from '../../../shared/screens/screen.types';

import myProjects from './my-projects.list.config';
import myTasksBugs from './my-tasks-bugs.list.config';
import myTimesheets from './my-timesheets.list.config';

/** §2.8 My Projects & Tasks — My Projects / My Tasks & Bugs / Timesheets /
 * Milestones, as tabs on one screen (the prototype's own shape for this
 * screen). Timesheets is real, not "Coming Soon" as the original module
 * doc says (see my-timesheets.list.config.ts's own note) — Milestones
 * genuinely has no self-scoped endpoint anywhere (project-scoped only),
 * so that one stays a static placeholder.
 *
 * On the recurring "these two tabs are missing their Coming Soon badge"
 * report: §2.8's sentence about it ("both are planned features … with a
 * 'Coming Soon' badge in place of content") was overtaken by approved
 * decision A174 — "BUILD Milestones and Timesheets in full — do NOT leave
 * them as 'Coming Soon' placeholders", restated in 10-project-module.md §7.
 * Timesheets was built to that direction and is live on /timesheets/me, so
 * badging it now would be a regression, not a fix. Milestones was built too
 * — but project-scoped only (GET /projects/{id}/milestones), which leaves
 * this employee-facing, cross-project tab with nothing to read. That single
 * tab is therefore the only one where §2.8's placeholder wording still
 * describes reality, and it says so below in its own body, which is where
 * the spec puts the marker ("in place of content"). Rendering it as a real
 * badge — the `badge-s b-outline` span the Attendance tab uses for the
 * Biometric "Coming Soon" — would need a badge slot in FieldGridComponent
 * or the tab bar, both of which live in shared/screens and are outside this
 * screen's reach.
 */
const config: TabbedScreenConfig = {
  shape: 'tabbed',
  id: 'employee.my_projects_tasks',
  title: 'My Projects & Tasks',
  specRef: '§2.8',
  tabs: [
    { key: 'projects', label: 'My Projects', config: myProjects },
    { key: 'tasks', label: 'My Tasks & Bugs', config: myTasksBugs },
    { key: 'timesheets', label: 'Timesheets', config: myTimesheets },
    {
      kind: 'static',
      key: 'milestones',
      label: 'Milestones',
      sections: [
        {
          title: 'Milestones',
          fields: [
            // "Coming Soon" stands alone as this tab's status rather than
            // opening a run-on sentence, so the placeholder marker §2.8 asks
            // for is the first thing read here, with the reasoning under it
            // instead of wrapped around it.
            { key: 'status', label: 'Status', compute: () => 'Coming Soon' },
            {
              key: 'why',
              label: 'Why this tab is empty',
              span: 2,
              compute: () =>
                'Milestones exist only against a single project (GET /projects/{id}/milestones) — there is no self-scoped "my milestones" feed spanning every project you are on, so there is nothing this screen could honestly list yet.',
            },
            {
              key: 'where',
              label: 'Where milestones live today',
              span: 2,
              // The path forward this tab can actually offer: not a create
              // affordance (milestone management is Manager/Super Admin, per
              // project.milestones' own `manage` action), just where the
              // built feature is. Deliberately worded as where it lives
              // rather than "open it", since project.milestones is 'none' for
              // HR and Accountant and that tab will not be there for them.
              compute: () => "On the project's own record, in the Project module — each project's Milestones tab carries that project's key dates and their status.",
            },
          ],
        },
      ],
    },
  ],
};

export default config;
