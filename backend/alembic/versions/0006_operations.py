"""Phase 5 — Operations (09-opportunity, 10-project, 04-ticket,
03-asset-management modules). 23 tables — the largest phase so far.

CUSTOMER already exists (pulled forward into Phase 4) — this phase only adds
the FOUR modules BUILD-PROMPT's phase table actually scoped to Phase 5:
Opportunity, Project, Ticket, Asset Management.

CROSS-MODULE WIRING THIS PHASE MUST CLOSE (flagged explicitly in the source
docs, not invented here):
  - Opportunity §3.3 "Won trigger, both directions" — Path A: a direct Stage
    change to Won on the Opportunity itself. Path B: creating a Project with
    an Opportunity selected auto-sets that Opportunity to Won as a side
    effect, if it isn't already. Both paths must call the same underlying
    "mark this Opportunity Won" logic (app/services/opportunity_engine.py),
    not two independently-written copies.
  - Ticket §3.3 / Project's own record — a ticket's optional Linked Project
    is visible from the ticket side; nothing in Project's own spec asks for
    a reverse "Linked Tickets" widget, so none is built (a documented,
    one-way link, matching the doc's own "Assumption... once the Project
    module is documented" framing — it never came back the other way).
  - Employee module's My Tickets (§2.7)/My Projects & Tasks (§2.8)/My Assets
    (§2.9) are self-service VIEWS over these same tables — built in this
    phase's router layer, not new tables of their own.

TWO "recalculated automatically over time" FEATURES WITH NO BATCH/CRON
INFRASTRUCTURE IN THIS CODEBASE (same class of problem MonthlyHourReconciliation
solved in Phase 3 — lazy materialization on read, not a scheduled job):
  - Asset depreciation (§2.5): "recalculated automatically at the start of
    each financial year" is implemented as a PURE, LIVE calculation
    (app/services/asset_engine.py) run every time Current Value is read —
    there is no stored current_value column at all, so it can never go
    stale between FY boundaries. "As of" in the response is always simply
    today's Financial Year.
  - Milestone auto-Missed (§2.8): "Missed is set automatically if Target
    Date passes while Status is still Upcoming" is materialized lazily —
    the milestones list/get endpoints flip and persist an overdue Upcoming
    row to Missed the moment it's read, the same lazy-materialization
    pattern this project already established for hour reconciliation.

A DOCUMENTED SPEC INCONSISTENCY, NOT BUILT: Asset Requests' Status is
"Pending / Approved / Rejected" everywhere the actual approve/reject ACTIONS
are defined (§2.6's own Row Actions), but two FILTER-LIST mentions elsewhere
in the same module (§2.6's filters, Employee §2.9's My Requests history) also
name a fourth value, "Completed," with no defined transition into it anywhere
in the document. Treated as the same class of cross-document staleness this
project has repeatedly found and flagged (not silently built) — `asset_requests.status`
stays a 3-value CHECK (PENDING/APPROVED/REJECTED).

Same MySQL dialect discipline as every prior phase (VARCHAR+CHECK instead of
native ENUM, RESTRICT instead of CASCADE on any FK a same-table generated
column depends on — none of this phase's tables have one, so this doesn't
bite here). Comment/conversation-thread tables (task_comments, bug_comments,
ticket_entries, and the two assignment-history logs) are genuinely
append-only per their own specs ("never deleted or edited once posted") —
modeled with a reduced column set (id/fk/author/content/created_at, no
updated_at/updated_by), the same pattern PermissionChangeLog already uses,
rather than the full AuditMixin shape that would misleadingly imply they can
be edited.

ARCHITECTURAL DEVIATION FROM ARCH-1, same split as every prior phase: no
rollup triggers. Vendor Usage was already the reference precedent from
Phase 4; here the equivalents (milestone "N/M tasks done" progress, project
timesheet totals, ticket first-response/resolve-time durations) are computed
live by services, not maintained as stored/triggered columns.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-01
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ============================================================ opportunities
    op.execute("""
        CREATE TABLE opportunities (
            id                  CHAR(36)      NOT NULL PRIMARY KEY,
            opportunity_code    VARCHAR(191)  NOT NULL,
            financial_year_id  CHAR(36)      NOT NULL,
            title               VARCHAR(200)  NOT NULL,
            customer_id         CHAR(36)      NOT NULL,
            value               DECIMAL(14,2) NULL,
            stage               VARCHAR(20)   NOT NULL DEFAULT 'PROSPECTING',
            probability_pct     DECIMAL(5,2)  NULL,
            expected_close_date DATE          NULL,
            description         TEXT          NULL,
            owner_id            CHAR(36)      NULL,
            -- Required the instant Stage becomes Lost (§3.2) — a real DB
            -- CHECK, not just an app-layer prompt, so the rule holds on
            -- every future write too, not only the one the UI intercepted.
            lost_reason         TEXT          NULL,
            -- What the Pipeline's "stale — no activity in N days" filter
            -- (§2.1) actually measures — bumped by the activity-log service
            -- every time a row is added to opportunity_activities below.
            last_activity_at    DATETIME(6)   NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_opps_code (opportunity_code),
            KEY ix_opps_customer (customer_id),
            KEY ix_opps_owner (owner_id),
            KEY ix_opps_stage (stage),
            FULLTEXT KEY ix_opps_search (title),
            CONSTRAINT ck_opps_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
            CONSTRAINT ck_opps_stage CHECK (stage IN ('PROSPECTING','QUALIFYING','PROPOSAL','WON','LOST')),
            CONSTRAINT ck_opps_value CHECK (value IS NULL OR value > 0),
            CONSTRAINT ck_opps_probability CHECK (probability_pct IS NULL OR (probability_pct BETWEEN 0 AND 100)),
            CONSTRAINT ck_opps_lost_reason CHECK (stage <> 'LOST' OR (lost_reason IS NOT NULL AND CHAR_LENGTH(TRIM(lost_reason)) > 0)),
            CONSTRAINT fk_opps_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_opps_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_opps_owner FOREIGN KEY (owner_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_opps_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_opps_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ==================================================== opportunity_activities
    op.execute("""
        CREATE TABLE opportunity_activities (
            id                 CHAR(36)     NOT NULL PRIMARY KEY,
            opportunity_id     CHAR(36)     NOT NULL,
            activity_type      VARCHAR(10)  NOT NULL,
            activity_date      DATE         NOT NULL,
            description        TEXT         NOT NULL,
            related_contact_id CHAR(36)     NULL,
            logged_by          CHAR(36)     NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_oppact_opportunity (opportunity_id),
            CONSTRAINT ck_oppact_type CHECK (activity_type IN ('CALL','EMAIL','MEETING','NOTE')),
            CONSTRAINT ck_oppact_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT fk_oppact_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
            CONSTRAINT fk_oppact_contact FOREIGN KEY (related_contact_id) REFERENCES customer_contacts(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oppact_logged_by FOREIGN KEY (logged_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oppact_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oppact_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ========================================================= opportunity_files
    op.execute("""
        CREATE TABLE opportunity_files (
            id             CHAR(36) NOT NULL PRIMARY KEY,
            opportunity_id CHAR(36) NOT NULL,
            stored_file_id CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_oppfiles_opportunity (opportunity_id),
            CONSTRAINT fk_oppfiles_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
            CONSTRAINT fk_oppfiles_file FOREIGN KEY (stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oppfiles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_oppfiles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ================================================================= projects
    op.execute("""
        CREATE TABLE projects (
            id                CHAR(36)      NOT NULL PRIMARY KEY,
            project_code      VARCHAR(191)  NOT NULL,
            financial_year_id CHAR(36)      NOT NULL,
            project_name      VARCHAR(150)  NOT NULL,
            customer_id       CHAR(36)      NOT NULL,
            opportunity_id    CHAR(36)      NULL,
            status            VARCHAR(15)   NOT NULL DEFAULT 'NOT_STARTED',
            start_date        DATE          NULL,
            end_date          DATE          NULL,
            budget            DECIMAL(14,2) NULL,
            description       TEXT          NULL,
            -- "Project Lead," deliberately not "Manager" (§2.2) — avoids
            -- confusion with the system-wide Manager ROLE; any employee of
            -- any role can lead a project.
            project_lead_id   CHAR(36)      NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_projects_code (project_code),
            KEY ix_projects_customer (customer_id),
            KEY ix_projects_lead (project_lead_id),
            FULLTEXT KEY ix_projects_search (project_name),
            CONSTRAINT ck_projects_name CHECK (CHAR_LENGTH(TRIM(project_name)) BETWEEN 2 AND 150),
            CONSTRAINT ck_projects_status CHECK (status IN ('NOT_STARTED','IN_PROGRESS','ON_HOLD','COMPLETED')),
            CONSTRAINT ck_projects_dates CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
            CONSTRAINT ck_projects_budget CHECK (budget IS NULL OR budget > 0),
            CONSTRAINT fk_projects_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projects_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projects_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projects_lead FOREIGN KEY (project_lead_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =========================================================== project_members
    op.execute("""
        CREATE TABLE project_members (
            id          CHAR(36) NOT NULL PRIMARY KEY,
            project_id  CHAR(36) NOT NULL,
            employee_id CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            UNIQUE KEY ux_projmembers_pair (project_id, employee_id),
            KEY ix_projmembers_employee (employee_id),
            CONSTRAINT fk_projmembers_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_projmembers_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_projmembers_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ================================================================== sprints
    # Created before `tasks` — tasks.sprint_id needs this table to exist
    # first, and sprints has no dependency the other direction (no circular
    # FK problem here, unlike Phase 4's Purchase-Bill<->Expense-Claim case).
    op.execute("""
        CREATE TABLE sprints (
            id         CHAR(36)     NOT NULL PRIMARY KEY,
            project_id CHAR(36)     NOT NULL,
            name       VARCHAR(150) NOT NULL,
            start_date DATE         NOT NULL,
            end_date   DATE         NOT NULL,
            -- §2.5: "Start Sprint... creates the sprint at Status = Active"
            -- — there is no separate "schedule a future sprint as Planned"
            -- step documented, so PLANNED exists in the enum for schema
            -- completeness but every sprint this app creates starts Active.
            status     VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_sprints_project (project_id),
            FULLTEXT KEY ix_sprints_search (name),
            CONSTRAINT ck_sprints_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
            CONSTRAINT ck_sprints_status CHECK (status IN ('PLANNED','ACTIVE','COMPLETED')),
            CONSTRAINT ck_sprints_dates CHECK (end_date >= start_date),
            CONSTRAINT fk_sprints_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_sprints_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_sprints_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ==================================================================== tasks
    op.execute("""
        CREATE TABLE tasks (
            id          CHAR(36)     NOT NULL PRIMARY KEY,
            project_id  CHAR(36)     NOT NULL,
            title       VARCHAR(200) NOT NULL,
            description TEXT         NULL,
            assignee_id CHAR(36)     NOT NULL,
            due_date    DATE         NULL,
            status      VARCHAR(15)  NOT NULL DEFAULT 'BACKLOG',
            -- Referenced by Task Board's own filter list (§2.3: "Priority
            -- (multi-select)") but never actually defined as a field on
            -- Task Detail's own Fields Table (§2.4) — a real spec gap.
            -- Reuses Ticket's established Low/Medium/High/Urgent set rather
            -- than inventing a third distinct priority vocabulary in the
            -- same codebase. Nullable — never a required field anywhere.
            priority    VARCHAR(10)  NULL,
            sprint_id   CHAR(36)     NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_tasks_project (project_id),
            KEY ix_tasks_assignee (assignee_id),
            KEY ix_tasks_sprint (sprint_id),
            KEY ix_tasks_status (status),
            FULLTEXT KEY ix_tasks_search (title),
            CONSTRAINT ck_tasks_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
            CONSTRAINT ck_tasks_status CHECK (status IN ('BACKLOG','TODO','IN_PROGRESS','IN_REVIEW','DONE')),
            CONSTRAINT ck_tasks_priority CHECK (priority IS NULL OR priority IN ('LOW','MEDIUM','HIGH','URGENT')),
            CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tasks_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tasks_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================ task_comments
    # Append-only "Thread" (§2.4, verbatim: "never deleted or edited once
    # posted, only added to") — reduced column set, same pattern as
    # PermissionChangeLog, not full AuditMixin (which would misleadingly
    # imply these rows can be updated).
    op.execute("""
        CREATE TABLE task_comments (
            id         CHAR(36) NOT NULL PRIMARY KEY,
            task_id    CHAR(36) NOT NULL,
            author_id  CHAR(36) NOT NULL,
            content    TEXT     NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_taskcomments_task (task_id),
            CONSTRAINT ck_taskcomments_content CHECK (CHAR_LENGTH(TRIM(content)) > 0),
            CONSTRAINT fk_taskcomments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            CONSTRAINT fk_taskcomments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =========================================================== task_subtasks
    op.execute("""
        CREATE TABLE task_subtasks (
            id         CHAR(36)     NOT NULL PRIMARY KEY,
            task_id    CHAR(36)     NOT NULL,
            text       VARCHAR(255) NOT NULL,
            is_checked TINYINT(1)   NOT NULL DEFAULT 0,
            sequence   INT          NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_tasksubtasks_task (task_id),
            CONSTRAINT ck_tasksubtasks_text CHECK (CHAR_LENGTH(TRIM(text)) > 0),
            CONSTRAINT fk_tasksubtasks_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            CONSTRAINT fk_tasksubtasks_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tasksubtasks_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ==================================================================== bugs
    op.execute("""
        CREATE TABLE bugs (
            id          CHAR(36)     NOT NULL PRIMARY KEY,
            project_id  CHAR(36)     NOT NULL,
            title       VARCHAR(200) NOT NULL,
            description TEXT         NULL,
            severity    VARCHAR(10)  NOT NULL,
            status      VARCHAR(15)  NOT NULL DEFAULT 'OPEN',
            assignee_id CHAR(36)     NULL,
            due_date    DATE         NULL,
            reported_by CHAR(36)     NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_bugs_project (project_id),
            KEY ix_bugs_assignee (assignee_id),
            FULLTEXT KEY ix_bugs_search (title, description),
            CONSTRAINT ck_bugs_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
            CONSTRAINT ck_bugs_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
            CONSTRAINT ck_bugs_status CHECK (status IN ('OPEN','IN_PROGRESS','FIXED','CLOSED')),
            CONSTRAINT fk_bugs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_bugs_assignee FOREIGN KEY (assignee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_bugs_reported_by FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_bugs_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_bugs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================= bug_comments
    op.execute("""
        CREATE TABLE bug_comments (
            id         CHAR(36) NOT NULL PRIMARY KEY,
            bug_id     CHAR(36) NOT NULL,
            author_id  CHAR(36) NOT NULL,
            content    TEXT     NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_bugcomments_bug (bug_id),
            CONSTRAINT ck_bugcomments_content CHECK (CHAR_LENGTH(TRIM(content)) > 0),
            CONSTRAINT fk_bugcomments_bug FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE,
            CONSTRAINT fk_bugcomments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =============================================================== milestones
    op.execute("""
        CREATE TABLE milestones (
            id             CHAR(36)     NOT NULL PRIMARY KEY,
            project_id     CHAR(36)     NOT NULL,
            milestone_name VARCHAR(150) NOT NULL,
            target_date    DATE         NOT NULL,
            description    TEXT         NULL,
            status         VARCHAR(10)  NOT NULL DEFAULT 'UPCOMING',
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_milestones_project (project_id),
            FULLTEXT KEY ix_milestones_search (milestone_name),
            CONSTRAINT ck_milestones_name CHECK (CHAR_LENGTH(TRIM(milestone_name)) > 0),
            CONSTRAINT ck_milestones_status CHECK (status IN ('UPCOMING','REACHED','MISSED')),
            CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_milestones_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_milestones_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =========================================================== milestone_tasks
    op.execute("""
        CREATE TABLE milestone_tasks (
            id           CHAR(36) NOT NULL PRIMARY KEY,
            milestone_id CHAR(36) NOT NULL,
            task_id      CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            UNIQUE KEY ux_milestonetasks_pair (milestone_id, task_id),
            KEY ix_milestonetasks_task (task_id),
            CONSTRAINT fk_milestonetasks_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
            CONSTRAINT fk_milestonetasks_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            CONSTRAINT fk_milestonetasks_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =========================================================== timesheet_entries
    op.execute("""
        CREATE TABLE timesheet_entries (
            id          CHAR(36)     NOT NULL PRIMARY KEY,
            project_id  CHAR(36)     NOT NULL,
            employee_id CHAR(36)     NOT NULL,
            entry_date  DATE         NOT NULL,
            -- Exactly one of task_id/category is set (§2.8, added 2026-07-30:
            -- "hours don't always belong to a task, and the form shouldn't
            -- force one") — enforced below, not left to application discipline.
            task_id     CHAR(36)     NULL,
            category    VARCHAR(20)  NULL,
            hours       DECIMAL(4,2) NOT NULL,
            notes       VARCHAR(500) NULL,
            -- Draft -> Submitted -> Approved (APPENDIX-B line 396). A Draft
            -- entry is the employee's own recalculable/discardable working
            -- copy, not yet visible in Team Timesheet's approval queue.
            status      VARCHAR(10)  NOT NULL DEFAULT 'SUBMITTED',
            -- Stamped when status first reaches SUBMITTED — backs the
            -- "submitted more than N days ago, still unapproved" toggle
            -- (§2.8, added this revision).
            submitted_at DATETIME(6) NULL,
            approved_by CHAR(36)     NULL,
            approved_at DATETIME(6)  NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_timesheet_project (project_id),
            KEY ix_timesheet_employee (employee_id),
            KEY ix_timesheet_task (task_id),
            KEY ix_timesheet_submitted_at (submitted_at),
            -- A184: hard cap 24/entry; the "soft warning above 12" is a
            -- UI-only plausibility nudge, never a block, so it isn't a CHECK.
            CONSTRAINT ck_timesheet_hours CHECK (hours > 0 AND hours <= 24),
            CONSTRAINT ck_timesheet_status CHECK (status IN ('DRAFT','SUBMITTED','APPROVED')),
            CONSTRAINT ck_timesheet_category CHECK (category IS NULL OR category IN ('BENCH','INTERNAL_MEETING','TRAINING','ADMIN_OVERHEAD','OTHER')),
            CONSTRAINT ck_timesheet_task_xor_category CHECK ((task_id IS NULL) <> (category IS NULL)),
            CONSTRAINT fk_timesheet_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
            CONSTRAINT fk_timesheet_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_timesheet_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE RESTRICT,
            CONSTRAINT fk_timesheet_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_timesheet_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_timesheet_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ================================================================== tickets
    op.execute("""
        CREATE TABLE tickets (
            id                  CHAR(36)      NOT NULL PRIMARY KEY,
            ticket_number       VARCHAR(191)  NOT NULL,
            financial_year_id  CHAR(36)      NOT NULL,
            customer_id         CHAR(36)      NOT NULL,
            category_id         CHAR(36)      NULL,
            subject             VARCHAR(150)  NOT NULL,
            priority            VARCHAR(10)   NOT NULL DEFAULT 'MEDIUM',
            description         TEXT          NOT NULL,
            assigned_to         CHAR(36)      NULL,
            linked_project_id   CHAR(36)      NULL,
            status              VARCHAR(15)   NOT NULL DEFAULT 'OPEN',
            raised_by           CHAR(36)      NOT NULL,
            raised_date         DATE          NOT NULL,
            -- Backs the Due Date range filter and "Overdue only" toggle
            -- (§2.1) — matches ARCH-1's tickets.due_date exactly.
            due_date            DATE          NULL,
            first_response_at   DATETIME(6)   NULL,
            resolved_at         DATETIME(6)   NULL,
            closed_at           DATETIME(6)   NULL,
            satisfaction_rating INT           NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_tickets_number (ticket_number),
            KEY ix_tickets_customer (customer_id),
            KEY ix_tickets_assigned (assigned_to),
            KEY ix_tickets_status (status),
            KEY ix_tickets_due (due_date),
            FULLTEXT KEY ix_tickets_search (subject),
            CONSTRAINT ck_tickets_subject CHECK (CHAR_LENGTH(TRIM(subject)) BETWEEN 5 AND 150),
            CONSTRAINT ck_tickets_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
            CONSTRAINT ck_tickets_status CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
            CONSTRAINT ck_tickets_rating CHECK (satisfaction_rating IS NULL OR satisfaction_rating BETWEEN 1 AND 5),
            CONSTRAINT fk_tickets_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_category FOREIGN KEY (category_id) REFERENCES ticket_categories(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_assigned FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_project FOREIGN KEY (linked_project_id) REFERENCES projects(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_raised_by FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tickets_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================================= ticket_entries
    # Append-only conversation thread (§2.3) — Public Reply / Internal Note.
    op.execute("""
        CREATE TABLE ticket_entries (
            id                        CHAR(36)    NOT NULL PRIMARY KEY,
            ticket_id                 CHAR(36)    NOT NULL,
            entry_type                VARCHAR(15) NOT NULL,
            content                   TEXT        NOT NULL,
            author_id                 CHAR(36)    NOT NULL,
            attachment_stored_file_id CHAR(36)    NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_ticketentries_ticket (ticket_id),
            CONSTRAINT ck_ticketentries_type CHECK (entry_type IN ('PUBLIC_REPLY','INTERNAL_NOTE')),
            CONSTRAINT ck_ticketentries_content CHECK (CHAR_LENGTH(TRIM(content)) > 0),
            CONSTRAINT fk_ticketentries_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            CONSTRAINT fk_ticketentries_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_ticketentries_file FOREIGN KEY (attachment_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================== ticket_assignment_history
    op.execute("""
        CREATE TABLE ticket_assignment_history (
            id                    CHAR(36)     NOT NULL PRIMARY KEY,
            ticket_id             CHAR(36)     NOT NULL,
            previous_assignee_id  CHAR(36)     NULL,
            new_assignee_id       CHAR(36)     NOT NULL,
            changed_by            CHAR(36)     NOT NULL,
            changed_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            note                  VARCHAR(500) NULL,
            KEY ix_tkasshist_ticket (ticket_id),
            CONSTRAINT fk_tkasshist_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            CONSTRAINT fk_tkasshist_prev FOREIGN KEY (previous_assignee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tkasshist_new FOREIGN KEY (new_assignee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_tkasshist_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ==================================================================== assets
    # No stored current_value/depreciation-as-of column — see the module
    # docstring above (asset_engine.py computes it live on every read).
    op.execute("""
        CREATE TABLE assets (
            id                   CHAR(36)      NOT NULL PRIMARY KEY,
            asset_tag            VARCHAR(191)  NOT NULL,
            financial_year_id   CHAR(36)      NOT NULL,
            name                 VARCHAR(100)  NOT NULL,
            category_id          CHAR(36)      NOT NULL,
            serial_number        VARCHAR(191)  NULL,
            order_date           DATE          NULL,
            purchase_date        DATE          NOT NULL,
            purchase_value       DECIMAL(14,2) NULL,
            useful_life_years    INT           NULL,
            vendor_id            CHAR(36)      NULL,
            warranty_expiry      DATE          NULL,
            location_address_id  CHAR(36)      NULL,
            -- Directory/Reports filter set names Department separately from
            -- Location (§2.1) — matches ARCH-1's assets.department_id.
            department_id        CHAR(36)      NULL,
            status               VARCHAR(20)   NOT NULL DEFAULT 'IN_STORE',
            assigned_to          CHAR(36)      NULL,
            depreciation_method  VARCHAR(20)   NOT NULL DEFAULT 'STRAIGHT_LINE',
            notes                TEXT          NULL,
            retired_date         DATE          NULL,
            retirement_reason    TEXT          NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            UNIQUE KEY ux_assets_tag (asset_tag),
            UNIQUE KEY ux_assets_serial (serial_number),
            KEY ix_assets_category (category_id),
            KEY ix_assets_assigned (assigned_to),
            KEY ix_assets_status (status),
            KEY ix_assets_department (department_id),
            FULLTEXT KEY ix_assets_search (name, serial_number),
            CONSTRAINT ck_assets_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 2 AND 100),
            CONSTRAINT ck_assets_status CHECK (status IN ('IN_USE','IN_STORE','UNDER_REPAIR','RETIRED_DISPOSED')),
            CONSTRAINT ck_assets_dep_method CHECK (depreciation_method IN ('STRAIGHT_LINE')),
            CONSTRAINT ck_assets_purchase_value CHECK (purchase_value IS NULL OR purchase_value > 0),
            CONSTRAINT ck_assets_useful_life CHECK (useful_life_years IS NULL OR useful_life_years > 0),
            -- A136: Useful Life is conditionally required — whenever
            -- Purchase Value is filled in, Useful Life must be too, since
            -- Straight Line depreciation can't be computed without both.
            CONSTRAINT ck_assets_useful_life_required CHECK (purchase_value IS NULL OR useful_life_years IS NOT NULL),
            CONSTRAINT ck_assets_order_before_purchase CHECK (order_date IS NULL OR order_date <= purchase_date),
            CONSTRAINT ck_assets_warranty_after_purchase CHECK (warranty_expiry IS NULL OR warranty_expiry > purchase_date),
            CONSTRAINT fk_assets_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_category FOREIGN KEY (category_id) REFERENCES asset_categories(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_location FOREIGN KEY (location_address_id) REFERENCES company_addresses(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_assigned FOREIGN KEY (assigned_to) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assets_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =============================================================== asset_requests
    # Created before asset_maintenance_log, which references it (an approved
    # Repair/Damage request auto-creates a maintenance entry, §2.6).
    op.execute("""
        CREATE TABLE asset_requests (
            id                    CHAR(36)    NOT NULL PRIMARY KEY,
            asset_id              CHAR(36)    NOT NULL,
            employee_id           CHAR(36)    NOT NULL,
            request_type          VARCHAR(15) NOT NULL,
            description           TEXT        NOT NULL,
            photo_stored_file_id  CHAR(36)    NULL,
            status                VARCHAR(10) NOT NULL DEFAULT 'PENDING',
            approved_by           CHAR(36)    NULL,
            approved_at           DATETIME(6) NULL,
            rejection_reason      TEXT        NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_assetreq_asset (asset_id),
            KEY ix_assetreq_employee (employee_id),
            CONSTRAINT ck_assetreq_type CHECK (request_type IN ('REPAIR','DAMAGE_REPORT','RETURN')),
            CONSTRAINT ck_assetreq_status CHECK (status IN ('PENDING','APPROVED','REJECTED')),
            CONSTRAINT ck_assetreq_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT fk_assetreq_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetreq_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetreq_file FOREIGN KEY (photo_stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetreq_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetreq_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetreq_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ========================================================= asset_maintenance_log
    op.execute("""
        CREATE TABLE asset_maintenance_log (
            id                  CHAR(36)      NOT NULL PRIMARY KEY,
            asset_id            CHAR(36)      NOT NULL,
            log_date            DATE          NOT NULL,
            description         TEXT          NOT NULL,
            cost                DECIMAL(14,2) NULL,
            next_due_date       DATE          NULL,
            -- Company-wide Maintenance list's "Serviced By/Vendor" filter
            -- (§2.4) — matches ARCH-1's asset_maintenance_logs.serviced_by_vendor_id.
            -- Independent of the asset's own Vendor (who it was purchased
            -- from can differ from who serviced it).
            serviced_by_vendor_id CHAR(36)    NULL,
            is_system_generated TINYINT(1)    NOT NULL DEFAULT 0,
            source_request_id   CHAR(36)      NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_assetmaint_asset (asset_id),
            KEY ix_assetmaint_vendor (serviced_by_vendor_id),
            CONSTRAINT ck_assetmaint_desc CHECK (CHAR_LENGTH(TRIM(description)) > 0),
            CONSTRAINT ck_assetmaint_cost CHECK (cost IS NULL OR cost > 0),
            CONSTRAINT ck_assetmaint_next_due CHECK (next_due_date IS NULL OR next_due_date > log_date),
            CONSTRAINT fk_assetmaint_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
            CONSTRAINT fk_assetmaint_vendor FOREIGN KEY (serviced_by_vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetmaint_request FOREIGN KEY (source_request_id) REFERENCES asset_requests(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetmaint_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetmaint_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ===================================================== asset_assignment_history
    op.execute("""
        CREATE TABLE asset_assignment_history (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            asset_id     CHAR(36)     NOT NULL,
            employee_id  CHAR(36)     NOT NULL,
            from_date    DATE         NOT NULL,
            to_date      DATE         NULL,
            action       VARCHAR(15)  NOT NULL,
            performed_by CHAR(36)     NOT NULL,
            reason       VARCHAR(500) NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            KEY ix_assethist_asset (asset_id),
            KEY ix_assethist_employee (employee_id),
            CONSTRAINT ck_assethist_action CHECK (action IN ('ASSIGNED','TRANSFERRED','UNASSIGNED')),
            CONSTRAINT fk_assethist_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
            CONSTRAINT fk_assethist_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assethist_performed_by FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # =================================================================== asset_files
    op.execute("""
        CREATE TABLE asset_files (
            id             CHAR(36) NOT NULL PRIMARY KEY,
            asset_id       CHAR(36) NOT NULL,
            stored_file_id CHAR(36) NOT NULL,
            created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by CHAR(36) NULL,
            updated_by CHAR(36) NULL,
            KEY ix_assetfiles_asset (asset_id),
            CONSTRAINT fk_assetfiles_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
            CONSTRAINT fk_assetfiles_file FOREIGN KEY (stored_file_id) REFERENCES stored_files(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetfiles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_assetfiles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)

    # ============================================== FY-lock triggers (4 tables)
    # Only the 4 tables that carry their own financial_year_id — every other
    # table in this migration is a child row whose FY lock is enforced
    # through its parent's own write (identical reasoning to Phase 4).
    for table in ("opportunities", "projects", "tickets", "assets"):
        for event in ("INSERT", "UPDATE"):
            op.execute(f"""
                CREATE TRIGGER trg_{table}_fy_lock_{event.lower()}
                BEFORE {event} ON {table}
                FOR EACH ROW
                BEGIN
                    IF (SELECT status FROM financial_years WHERE id = NEW.financial_year_id) = 'locked' THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Financial Year is locked';
                    END IF;
                END
            """)


def downgrade() -> None:
    for table in ("opportunities", "projects", "tickets", "assets"):
        for event in ("insert", "update"):
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_fy_lock_{event};")

    # Children before parents.
    for table in (
        "asset_files",
        "asset_assignment_history",
        "asset_maintenance_log",
        "asset_requests",
        "assets",
        "ticket_assignment_history",
        "ticket_entries",
        "tickets",
        "timesheet_entries",
        "milestone_tasks",
        "milestones",
        "bug_comments",
        "bugs",
        "task_subtasks",
        "task_comments",
        "tasks",
        "sprints",
        "project_members",
        "projects",
        "opportunity_files",
        "opportunity_activities",
        "opportunities",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table};")
