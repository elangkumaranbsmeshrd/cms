"""Pydantic schemas for the RBAC module's own 4 admin screens (14-rbac-module.md
§4): Role Directory, Role Permission Matrix, Individual Permission Overrides,
Permission Change Log.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class RoleDirectoryRow(BaseModel):
    role_code: str
    role_name: str
    people_count: int
    override_count: int


class MatrixActionState(BaseModel):
    action_key: str
    label: str
    allowed: bool


class MatrixFieldState(BaseModel):
    field_key: str
    label: str
    mode: str  # show | read | mask | hide — migration 0010


class MatrixScreenState(BaseModel):
    screen_key: str
    label: str
    has_scope: bool
    mode: str  # none | full | view | view_team | own | team
    actions: list[MatrixActionState]
    fields: list[MatrixFieldState]


class MatrixModuleState(BaseModel):
    module_key: str
    screens: list[MatrixScreenState]


class MatrixScreenChange(BaseModel):
    screen_key: str
    mode: str | None = None
    actions: dict[str, bool] | None = None
    fields: dict[str, str] | None = None


class MatrixSaveRequest(BaseModel):
    changes: list[MatrixScreenChange]


class OverrideCreate(BaseModel):
    user_id: str
    screen_key: str
    layer: str  # L1 | L2 | L3 | L4
    action_key: str | None = None
    field_key: str | None = None
    override_value: str
    reason: str


class OverrideOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    role_code: str
    screen_key: str
    screen_label: str
    module_key: str
    layer: str
    action_key: str | None
    field_key: str | None
    override_value: str
    reason: str
    granted_by: str
    granted_by_name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RoleDefaultSummary(BaseModel):
    role_code: str
    role_name: str
    modules: list[MatrixModuleState]


class ToggleOut(BaseModel):
    toggle_key: str
    module_key: str
    label: str
    enabled: bool
    default_enabled: bool
    numeric_value: Decimal | None = None


class ToggleUpdate(BaseModel):
    toggle_key: str
    enabled: bool
    # Expense §6.1 "Set an Auto-Approval Threshold" is the only toggle today
    # that carries a companion number. Omit this field entirely for every
    # other toggle — update_toggles() below only touches numeric_value when
    # the key is actually present in the request (model_fields_set), so a
    # plain enabled-flip never clobbers an unrelated toggle's stored amount.
    numeric_value: Decimal | None = None


class ToggleUpdateRequest(BaseModel):
    changes: list[ToggleUpdate]


class ChangeLogOut(BaseModel):
    id: str
    changed_at: datetime
    changed_by: str
    changed_by_name: str
    target_role: str | None
    target_user: str | None
    target_user_name: str | None
    screen_key: str | None
    screen_label: str | None
    module_key: str | None
    layer: str
    before_value: dict | None
    after_value: dict | None
