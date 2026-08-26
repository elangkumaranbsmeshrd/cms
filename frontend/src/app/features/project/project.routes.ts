import { Routes } from '@angular/router';

import { screenAccessGuard } from '../../core/rbac/screen-access.guard';
import { screenRoute } from '../../shared/screens/screen-route';

/** §4 Routing. Only ONE of these is sidebar-reachable (project.directory at
 * /projects — see nav-registry.ts's own SCREEN_ROUTES, not edited here per
 * this module's hard boundary) — every route below it is reached only by
 * in-app navigation (a row click, a card click, a header button), the exact
 * same class of thing asset.routes.ts's own asset-reports/assets/reclaim/
 * :employeeId already are.
 *
 * Beyond the brief's own literal 5-route sketch (list / new / record /
 * tasks/:taskId / bugs/:bugId), this module ended up needing 4 more, all for
 * the same reason: BoardScreenConfig's own "+Add New" button ONLY navigates
 * (board-screen.component.ts's openCreate(), no inline-create capability at
 * all), and RowActionDef/SecondaryActionDef both fire-and-go with no prompt
 * step — so any create/picker flow that couldn't be satisfied by a plain
 * request needed a real route of its own:
 *   - projects/:id/edit         — Edit Project (see project.form.component
 *     .ts's own doc for why this isn't inline on the record host instead)
 *   - projects/:id/tasks/new    — the Task Board's own "+Add Task" button
 *   - projects/:id/bugs/new     — the Bugs board's own "+Report Bug" button
 *   - projects/:id/sprints/:sprintId/tasks — "Update Sprint"'s task picker
 *
 * Static segments are ordered before their same-depth dynamic sibling
 * (`tasks/new` before `tasks/:taskId`, `bugs/new` before `bugs/:bugId`,
 * `projects/new` before `projects/:id`) — screen-route.ts's own documented
 * reason: pathMatch:'full' still means the FIRST array match wins, and a
 * static leaf otherwise prefix-collides with a sibling :param route at the
 * same depth (confirmed live per that file's own regression note).
 */
export const projectRoutes: Routes = [
  screenRoute('project.directory', 'projects', () => import('./screens/project.directory.list.config')),
  {
    path: 'projects/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.directory')],
    data: { screenId: 'project.directory', screenPath: 'projects/new' },
    loadComponent: () => import('./screens/project.form.component').then((m) => m.ProjectFormComponent),
  },
  {
    path: 'projects/:id/edit',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.directory')],
    data: { screenId: 'project.directory', screenPath: 'projects/:id/edit' },
    loadComponent: () => import('./screens/project.form.component').then((m) => m.ProjectFormComponent),
  },
  {
    path: 'projects/:id',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.directory')],
    data: { screenId: 'project.directory', screenPath: 'projects/:id' },
    loadComponent: () => import('./screens/project.record.component').then((m) => m.ProjectRecordComponent),
  },
  {
    path: 'projects/:id/tasks/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.board')],
    data: { screenId: 'project.board', screenPath: 'projects/:id/tasks/new' },
    loadComponent: () => import('./screens/project.task-detail.component').then((m) => m.ProjectTaskDetailComponent),
  },
  {
    path: 'projects/:id/tasks/:taskId',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.board')],
    data: { screenId: 'project.board', screenPath: 'projects/:id/tasks/:taskId' },
    loadComponent: () => import('./screens/project.task-detail.component').then((m) => m.ProjectTaskDetailComponent),
  },
  {
    path: 'projects/:id/bugs/new',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.board')],
    data: { screenId: 'project.board', screenPath: 'projects/:id/bugs/new' },
    loadComponent: () => import('./screens/project.bug-detail.component').then((m) => m.ProjectBugDetailComponent),
  },
  {
    path: 'projects/:id/bugs/:bugId',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.board')],
    data: { screenId: 'project.board', screenPath: 'projects/:id/bugs/:bugId' },
    loadComponent: () => import('./screens/project.bug-detail.component').then((m) => m.ProjectBugDetailComponent),
  },
  {
    path: 'projects/:id/sprints/:sprintId/tasks',
    pathMatch: 'full',
    canMatch: [screenAccessGuard('project.sprints')],
    data: { screenId: 'project.sprints', screenPath: 'projects/:id/sprints/:sprintId/tasks' },
    loadComponent: () => import('./screens/project.sprint-tasks.component').then((m) => m.ProjectSprintTasksComponent),
  },
];
