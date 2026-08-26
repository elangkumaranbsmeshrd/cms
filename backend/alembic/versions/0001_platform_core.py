"""platform core: users, roles, RBAC tables, financial year, numbering

Hand-written raw DDL (not autogenerate) so it matches ARCH-1 exactly,
including the MySQL-specific constructs autogenerate cannot produce:
generated-column uniqueness tricks (D0.1), overlap-prevention triggers (D0.2),
and the immutable-log trigger pattern (D3). See ARCH-1-database-schema.md D0
for the reasoning behind every non-obvious choice below.

Revision ID: 0001
Revises:
Create Date: 2026-08-01
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------------------------------------------------------------- roles
    op.execute("""
        CREATE TABLE roles (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            code         VARCHAR(20)  NOT NULL,
            name         VARCHAR(50)  NOT NULL,
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_roles_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ---------------------------------------------------------------- users
    # created_by/updated_by are self-referential; MySQL allows a FK on a
    # column referencing the table being created, in the same CREATE TABLE,
    # because the PK it references is already defined earlier in the
    # statement. Verified against a live MySQL 8.4 container (ARCH-1 D0 was
    # a design, not yet an executed one — this migration is what proves it).
    op.execute("""
        CREATE TABLE users (
            id                    CHAR(36)      NOT NULL PRIMARY KEY,
            email                 VARCHAR(191)  NOT NULL,
            password_hash         VARCHAR(255)  NOT NULL,
            full_name             VARCHAR(191)  NOT NULL,
            role_id               CHAR(36)      NOT NULL,
            is_enabled            TINYINT(1)    NOT NULL DEFAULT 1,
            must_change_password  TINYINT(1)    NOT NULL DEFAULT 0,
            last_login_at         DATETIME(6)   NULL,
            created_at            DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at            DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by            CHAR(36)      NULL,
            updated_by            CHAR(36)      NULL,
            UNIQUE KEY ux_users_email (email),
            CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("ALTER TABLE roles ADD CONSTRAINT fk_roles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;")
    op.execute("ALTER TABLE roles ADD CONSTRAINT fk_roles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT;")

    # --------------------------------------------------------- stored_files
    op.execute("""
        CREATE TABLE stored_files (
            id                 CHAR(36)      NOT NULL PRIMARY KEY,
            storage_key        VARCHAR(191)  NOT NULL,
            original_filename  VARCHAR(255)  NOT NULL,
            mime_type          VARCHAR(127)  NOT NULL,
            size_bytes         BIGINT        NOT NULL,
            content_hash       CHAR(64)      NOT NULL,
            uploaded_by        CHAR(36)      NULL,
            created_at         DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at         DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by         CHAR(36)      NULL,
            updated_by         CHAR(36)      NULL,
            UNIQUE KEY ux_stored_files_storage_key (storage_key),
            KEY ix_stored_files_content_hash (content_hash),
            CONSTRAINT fk_stored_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_stored_files_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_stored_files_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # -------------------------------------------------------- indian_states
    op.execute("""
        CREATE TABLE indian_states (
            id              CHAR(36)     NOT NULL PRIMARY KEY,
            name            VARCHAR(100) NOT NULL,
            code            VARCHAR(10)  NOT NULL,
            gst_state_code  VARCHAR(2)   NOT NULL,
            UNIQUE KEY ux_indian_states_name (name),
            UNIQUE KEY ux_indian_states_code (code),
            UNIQUE KEY ux_indian_states_gst_code (gst_state_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ----------------------------------------------------- financial_years
    # is_current uniqueness: the ARCH-1 D0.1 generated-column trick.
    # current_guard is CHAR(36) := id when is_current=1, else NULL; a plain
    # UNIQUE on a column that is NULL on every non-current row enforces
    # "at most one current FY" without a partial index, which MySQL lacks.
    op.execute("""
        CREATE TABLE financial_years (
            id                CHAR(36)     NOT NULL PRIMARY KEY,
            label             VARCHAR(20)  NOT NULL,
            start_date        DATE         NOT NULL,
            end_date          DATE         NOT NULL,
            status            VARCHAR(10)  NOT NULL DEFAULT 'open',
            locked_at         DATETIME(6)  NULL,
            locked_by         CHAR(36)     NULL,
            reference_count   INT          NOT NULL DEFAULT 0,
            is_current        TINYINT(1)   NOT NULL DEFAULT 0,
            -- BUG FOUND AND FIXED 2026-08-01 by running this against real MySQL:
            -- the guard's true-branch MUST be a CONSTANT for a GLOBAL singleton
            -- rule. Using `id` here was wrong — id is already unique per row,
            -- so the "UNIQUE KEY" below silently never fired; two rows both
            -- flagged is_current=1 inserted without error. Verified by testing.
            -- (ARCH-1 D0.1's own worked example uses company_id, a GROUPING
            -- key, correctly — that pattern only applies to a per-group rule.
            -- A global rule with no grouping key needs a literal constant.)
            current_guard     TINYINT      GENERATED ALWAYS AS (IF(is_current = 1, 1, NULL)) STORED,
            created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by        CHAR(36)     NULL,
            updated_by        CHAR(36)     NULL,
            UNIQUE KEY ux_fy_label (label),
            UNIQUE KEY ux_fy_one_current (current_guard),
            CONSTRAINT fk_fy_locked_by FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_fy_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_fy_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_fy_status CHECK (status IN ('open', 'locked'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # A002 / Invariant 4: locking is one-way, and a locked FY is frozen for
    # EVERYONE including Super Admin. The API already refuses to unlock
    # (financial_years.py has no unlock route at all), but that is app-layer
    # convention, not a guarantee. This trigger is the actual guarantee: even
    # a direct SQL UPDATE cannot flip status back to 'open' once locked.
    op.execute("""
        CREATE TRIGGER trg_fy_reject_unlock
        BEFORE UPDATE ON financial_years
        FOR EACH ROW
        BEGIN
            IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Financial Year is locked and cannot be unlocked (A002)';
            END IF;
        END
    """)

    # ------------------------------------------------- document_number_sequences
    op.execute("""
        CREATE TABLE document_number_sequences (
            id                   CHAR(36)     NOT NULL PRIMARY KEY,
            code_type            VARCHAR(30)  NOT NULL,
            financial_year_id    CHAR(36)     NULL,
            prefix               VARCHAR(10)  NOT NULL,
            digits               INT          NOT NULL DEFAULT 4,
            next_number          INT          NOT NULL DEFAULT 1,
            last_issued_number   INT          NULL,
            last_issued_at       DATETIME(6)  NULL,
            created_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at           DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by           CHAR(36)     NULL,
            updated_by           CHAR(36)     NULL,
            UNIQUE KEY ux_docseq_type_fy (code_type, financial_year_id),
            CONSTRAINT fk_docseq_fy FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
            CONSTRAINT fk_docseq_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_docseq_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------------------- screens
    op.execute("""
        CREATE TABLE screens (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            screen_key   VARCHAR(60)  NOT NULL,
            module_key   VARCHAR(30)  NOT NULL,
            label        VARCHAR(120) NOT NULL,
            has_scope    TINYINT(1)   NOT NULL DEFAULT 1,
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_screens_key (screen_key),
            CONSTRAINT fk_screens_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_screens_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------------- screen_actions
    op.execute("""
        CREATE TABLE screen_actions (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            screen_id    CHAR(36)     NOT NULL,
            action_key   VARCHAR(60)  NOT NULL,
            label        VARCHAR(120) NOT NULL,
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_screen_actions (screen_id, action_key),
            CONSTRAINT fk_screen_actions_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_screen_actions_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_screen_actions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ----------------------------------------------- screen_sensitive_fields
    op.execute("""
        CREATE TABLE screen_sensitive_fields (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            screen_id    CHAR(36)     NOT NULL,
            field_key    VARCHAR(60)  NOT NULL,
            label        VARCHAR(120) NOT NULL,
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_screen_fields (screen_id, field_key),
            CONSTRAINT fk_screen_fields_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_screen_fields_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_screen_fields_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------------ role_permissions
    op.execute("""
        CREATE TABLE role_permissions (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            role_id      CHAR(36)     NOT NULL,
            screen_id    CHAR(36)     NOT NULL,
            mode         VARCHAR(12)  NOT NULL DEFAULT 'none',
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_role_perm (role_id, screen_id),
            CONSTRAINT fk_role_perm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_role_perm_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_role_perm_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_role_perm_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_role_perm_mode CHECK (mode IN ('none','full','view','view_team','own','team'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ----------------------------------------------- role_permission_actions
    op.execute("""
        CREATE TABLE role_permission_actions (
            id           CHAR(36)     NOT NULL PRIMARY KEY,
            role_id      CHAR(36)     NOT NULL,
            screen_id    CHAR(36)     NOT NULL,
            action_key   VARCHAR(60)  NOT NULL,
            allowed      TINYINT(1)   NOT NULL DEFAULT 0,
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by   CHAR(36)     NULL,
            updated_by   CHAR(36)     NULL,
            UNIQUE KEY ux_role_perm_action (role_id, screen_id, action_key),
            CONSTRAINT fk_rpa_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpa_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpa_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpa_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------ role_permission_fields
    op.execute("""
        CREATE TABLE role_permission_fields (
            id            CHAR(36)     NOT NULL PRIMARY KEY,
            role_id       CHAR(36)     NOT NULL,
            screen_id     CHAR(36)     NOT NULL,
            field_key     VARCHAR(60)  NOT NULL,
            mode          VARCHAR(6)   NOT NULL DEFAULT 'show',
            mask_reason   VARCHAR(255) NULL,
            created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by    CHAR(36)     NULL,
            updated_by    CHAR(36)     NULL,
            UNIQUE KEY ux_role_perm_field (role_id, screen_id, field_key),
            CONSTRAINT fk_rpf_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpf_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpf_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_rpf_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_rpf_mode CHECK (mode IN ('show','mask','hide'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ----------------------------------------------------- feature_toggles
    op.execute("""
        CREATE TABLE feature_toggles (
            id                CHAR(36)     NOT NULL PRIMARY KEY,
            toggle_key        VARCHAR(80)  NOT NULL,
            module_key        VARCHAR(30)  NOT NULL,
            label             VARCHAR(200) NOT NULL,
            enabled           TINYINT(1)   NOT NULL,
            default_enabled   TINYINT(1)   NOT NULL,
            created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by        CHAR(36)     NULL,
            updated_by        CHAR(36)     NULL,
            UNIQUE KEY ux_feature_toggles_key (toggle_key),
            CONSTRAINT fk_toggles_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_toggles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------ user_permission_overrides
    op.execute("""
        CREATE TABLE user_permission_overrides (
            id                CHAR(36)     NOT NULL PRIMARY KEY,
            user_id           CHAR(36)     NOT NULL,
            screen_id         CHAR(36)     NOT NULL,
            layer             VARCHAR(2)   NOT NULL,
            action_key        VARCHAR(60)  NULL,
            field_key         VARCHAR(60)  NULL,
            override_value    VARCHAR(20)  NOT NULL,
            reason            VARCHAR(255) NOT NULL,
            granted_by        CHAR(36)     NOT NULL,
            created_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by        CHAR(36)     NULL,
            updated_by        CHAR(36)     NULL,
            KEY ix_upo_user_screen (user_id, screen_id),
            CONSTRAINT fk_upo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_upo_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT,
            CONSTRAINT fk_upo_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_upo_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_upo_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_upo_layer CHECK (layer IN ('L1','L2','L3','L4'))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)

    # ------------------------------------------------- permission_change_log
    # IMMUTABLE (ARCH-1 D3): append-only. UPDATE/DELETE are revoked at the
    # grant level in production; here (dev/CI) the same guarantee is a
    # trigger, so the property is provable without depending on which MySQL
    # user role the application connects as.
    op.execute("""
        CREATE TABLE permission_change_log (
            id                CHAR(36)     NOT NULL PRIMARY KEY,
            changed_at        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            changed_by        CHAR(36)     NOT NULL,
            target_role_id    CHAR(36)     NULL,
            target_user_id    CHAR(36)     NULL,
            screen_id         CHAR(36)     NULL,
            layer             VARCHAR(2)   NOT NULL,
            before_value      JSON         NULL,
            after_value       JSON         NULL,
            CONSTRAINT fk_pcl_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcl_role FOREIGN KEY (target_role_id) REFERENCES roles(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcl_user FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_pcl_screen FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)
    op.execute("""
        CREATE TRIGGER trg_pcl_reject_update
        BEFORE UPDATE ON permission_change_log
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permission_change_log is immutable — no updates';
        END
    """)
    op.execute("""
        CREATE TRIGGER trg_pcl_reject_delete
        BEFORE DELETE ON permission_change_log
        FOR EACH ROW
        BEGIN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permission_change_log is immutable — no deletes';
        END
    """)

    # ------------------------------------------------ user_appearance_settings
    op.execute("""
        CREATE TABLE user_appearance_settings (
            id              CHAR(36)     NOT NULL PRIMARY KEY,
            user_id         CHAR(36)     NOT NULL,
            theme           VARCHAR(10)  NOT NULL DEFAULT 'light',
            accent_preset   VARCHAR(20)  NULL,
            accent_hex      CHAR(7)      NULL,
            display_scale   INT          NOT NULL DEFAULT 110,
            created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            created_by      CHAR(36)     NULL,
            updated_by      CHAR(36)     NULL,
            UNIQUE KEY ux_uas_user (user_id),
            CONSTRAINT fk_uas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_uas_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT fk_uas_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT ck_uas_scale CHECK (display_scale BETWEEN 80 AND 200)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    """)


def downgrade() -> None:
    for table in [
        "user_appearance_settings",
        "permission_change_log",
        "user_permission_overrides",
        "feature_toggles",
        "role_permission_fields",
        "role_permission_actions",
        "role_permissions",
        "screen_sensitive_fields",
        "screen_actions",
        "screens",
        "document_number_sequences",
        "financial_years",
        "indian_states",
        "stored_files",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {table};")
    op.execute("ALTER TABLE roles DROP FOREIGN KEY fk_roles_created_by;")
    op.execute("ALTER TABLE roles DROP FOREIGN KEY fk_roles_updated_by;")
    op.execute("DROP TABLE IF EXISTS users;")
    op.execute("DROP TABLE IF EXISTS roles;")
