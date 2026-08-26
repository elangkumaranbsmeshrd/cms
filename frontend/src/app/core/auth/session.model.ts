// Mirrors app/schemas/auth.py's MeOut/MePolicy/MePolicyScreen exactly — real
// backend vocabulary (mode strings with underscores, field modes
// show|mask|hide), not ARCH-3's aspirational 'view:team'/edit|read|hidden|
// masked spelling. See backend/app/api/v1/auth.py's get_me() docstring for
// why this endpoint deliberately didn't force that lossy adapter.

export type ScreenMode = 'none' | 'full' | 'view' | 'view_team' | 'own' | 'team';
export type FieldMode = 'show' | 'mask' | 'hide';

export interface PolicyScreen {
  label: string;
  module: string;
  mode: ScreenMode;
  actions: string[];
  fields: Record<string, FieldMode>;
}

export interface Policy {
  version: string;
  screens: Record<string, PolicyScreen>;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  mustChangePassword: boolean;
  policy: Policy;
  // RBAC §4.2 "Preview as this role" — set only while a Super Admin is
  // previewing another role's screens/actions/fields (backend/app/api/v1/
  // auth.py's get_me). `role` above always stays the real, authenticated
  // role; this is the extra bit the UI needs to know a preview is live.
  previewingAs: string | null;
}

export const EMPTY_POLICY: Policy = { version: '1970-01-01T00:00:00', screens: {} };

/** Raw shape as FastAPI actually serializes MeOut (snake_case). */
export interface MeResponseRaw {
  id: string;
  email: string;
  full_name: string;
  role: string;
  must_change_password: boolean;
  policy: {
    version: string;
    screens: Record<string, { label: string; module: string; mode: ScreenMode; actions: string[]; fields: Record<string, FieldMode> }>;
  };
  previewing_as?: string | null;
}

export function fromMeResponse(raw: MeResponseRaw): CurrentUser {
  return {
    id: raw.id,
    email: raw.email,
    fullName: raw.full_name,
    role: raw.role,
    mustChangePassword: raw.must_change_password,
    policy: raw.policy,
    previewingAs: raw.previewing_as ?? null,
  };
}
