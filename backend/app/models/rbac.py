"""The four-layer RBAC backbone (RBAC module §2, ARCH-2 §3).

Policy is DATA here; the screen registry (which screens/actions/fields exist)
is CODE, in app/rbac/registry/screens.py — see ARCH-2 §3.1. This file only
holds the tables that store who-may-do-what, not what screens exist.

  L1 screen visibility   -> RolePermission.mode ('none' means invisible)
  L2 action permission   -> RolePermissionAction
  L3 field sensitivity   -> RolePermissionField
  L4 data scope          -> RolePermission.mode carries scope too
                            ('full'/'view' = all, 'own', 'team', 'view_team')

Plus the override layer (UserPermissionOverride) and the immutable audit
trail (PermissionChangeLog).
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin, _now


class Role(Base, AuditMixin):
    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # SUPER_ADMIN, EMPLOYEE, ...
    name: Mapped[str] = mapped_column(String(50), nullable=False)


class Screen(Base, AuditMixin):
    """Mirrors the CODE registry (app/rbac/registry/screens.py) as a queryable
    table, so the Role Permission Matrix (RBAC §4.2) and the Screen Inventory
    (RBAC §3) can be built from one join instead of hardcoding the list twice.
    Seeded from the registry at startup/migration, never hand-edited.
    """

    __tablename__ = "screens"

    screen_key: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)  # 'masters.financial_year'
    module_key: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    has_scope: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ScreenAction(Base, AuditMixin):
    __tablename__ = "screen_actions"

    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    action_key: Mapped[str] = mapped_column(String(60), nullable=False)  # 'approve', 'lock', ...
    label: Mapped[str] = mapped_column(String(120), nullable=False)


class ScreenSensitiveField(Base, AuditMixin):
    __tablename__ = "screen_sensitive_fields"

    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    field_key: Mapped[str] = mapped_column(String(60), nullable=False)  # 'purchase_value', 'salary', ...
    label: Mapped[str] = mapped_column(String(120), nullable=False)


class RolePermission(Base, AuditMixin):
    """Layer 1 (visibility) + Layer 4 (scope) for one (role, screen) pair.
    Absence of a row means 'none' — invisible — the safe default.
    """

    __tablename__ = "role_permissions"

    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("roles.id"), nullable=False)
    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(12), nullable=False, default="none")
    # 'full' | 'view' | 'view_team' | 'own' | 'team' | 'none'


class RolePermissionAction(Base, AuditMixin):
    """Layer 2. Explicit allow/deny per (role, screen, action). An action with
    no row here and no 'roles' restriction defaults to allowed on a visible
    screen — EXCEPT this table lets us override that to deny, which is how
    the Timesheets 'Approve' bug (prototype session) gets fixed at the schema
    level instead of relying on every screen definition remembering to ask.
    """

    __tablename__ = "role_permission_actions"

    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("roles.id"), nullable=False)
    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    action_key: Mapped[str] = mapped_column(String(60), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RolePermissionField(Base, AuditMixin):
    """Layer 3. show / mask / hide per (role, screen, field)."""

    __tablename__ = "role_permission_fields"

    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("roles.id"), nullable=False)
    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    field_key: Mapped[str] = mapped_column(String(60), nullable=False)
    mode: Mapped[str] = mapped_column(String(6), nullable=False, default="show")  # show | mask | hide
    mask_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)


class FeatureToggle(Base, AuditMixin):
    """The ~47 named toggles from RBAC §2.1, e.g. 'Allow Manager to Approve
    Their Team's Expenses'. Keyed by a stable code, not the display label, so
    renaming a toggle's wording never breaks a stored reference to it.
    """

    __tablename__ = "feature_toggles"

    toggle_key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    module_key: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    default_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Expense §6.1 "Set an Auto-Approval Threshold" is the first toggle that
    # needs a companion number, not just on/off — most toggles never set
    # this. Platform-wide (not Expense-only) so the same admin Toggles panel
    # that edits every other toggle can edit this too.
    numeric_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)


class UserPermissionOverride(Base, AuditMixin):
    """Super Admin granting/revoking ONE permission for ONE person, across any
    of the four layers, without touching the role default for anyone else.
    layer in {'L1','L2','L3','L4'}; action_key/field_key only apply to L2/L3.
    """

    __tablename__ = "user_permission_overrides"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    screen_id: Mapped[str] = mapped_column(String(36), ForeignKey("screens.id"), nullable=False)
    layer: Mapped[str] = mapped_column(String(2), nullable=False)
    action_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    field_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    override_value: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    granted_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)


class PermissionChangeLog(Base):
    """IMMUTABLE. Append-only — no update/delete path exists in the service
    layer, and the real MySQL migration revokes UPDATE/DELETE at the grant
    level (ARCH-1 D3).
    """

    __tablename__ = "permission_change_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    changed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    target_role_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("roles.id"), nullable=True)
    target_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    screen_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("screens.id"), nullable=True)
    layer: Mapped[str] = mapped_column(String(2), nullable=False)
    before_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class UserAppearanceSetting(Base, AuditMixin):
    __tablename__ = "user_appearance_settings"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, nullable=False)
    theme: Mapped[str] = mapped_column(String(10), nullable=False, default="light")
    accent_preset: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_hex: Mapped[str | None] = mapped_column(String(7), nullable=True)
    display_scale: Mapped[int] = mapped_column(nullable=False, default=110)
