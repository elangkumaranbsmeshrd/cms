from pydantic import BaseModel


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: str


class MePolicyScreen(BaseModel):
    # Static registry data (app/rbac/registry/screens.py's ScreenDef), not
    # permission data — included so the client can render a real nav label/
    # module grouping without hardcoding a second copy of the registry.
    label: str
    module: str
    # mode: 'none' | 'full' | 'view' | 'view_team' | 'own' | 'team' — the
    # real app.rbac.resolver.PermissionSet vocabulary, not ARCH-3's
    # aspirational 'view:team' spelling (see the router's own docstring for
    # why this endpoint uses real names instead of forcing a lossy adapter).
    mode: str
    actions: list[str] = []
    # field_key -> 'show' | 'mask' | 'hide' — only entries that deviate from
    # the default-show rule are present, same as the resolver's own field_modes.
    fields: dict[str, str] = {}


class MePolicy(BaseModel):
    version: str
    screens: dict[str, MePolicyScreen]


class MeOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    must_change_password: bool
    policy: MePolicy
    # RBAC §4.2 "Preview as this role" — set only when this response was
    # computed under a Super-Admin-only ?preview_role= override (get_me).
    # `role` above always stays the caller's REAL role; this is what the
    # policy was resolved as instead, so the client can label the preview.
    previewing_as: str | None = None
