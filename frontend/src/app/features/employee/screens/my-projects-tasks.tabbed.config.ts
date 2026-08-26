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
            {
              key: 'status',
              label: 'Status',
              compute: () => 'Coming Soon — no self-scoped "my milestones" endpoint exists yet (milestones are project-scoped only).',
            },
          ],
        },
      ],
    },
  ],
};

export default config;
