"""Layer 3 applied at the serialization boundary — a renderer that forgets to
check a field still cannot leak it, because masking happens here, not in every
route handler (ARCH-2 §3.4).
"""

from typing import Any

from app.rbac.resolver import PermissionSet

MASKED_PLACEHOLDER = {"__masked__": True}


def apply_field_masking(payload: dict[str, Any], perms: PermissionSet) -> dict[str, Any]:
    if not perms.field_modes:
        return payload
    out = dict(payload)
    for field_key, mode in perms.field_modes.items():
        if field_key not in out:
            continue
        if mode == "hide":
            out.pop(field_key, None)
        elif mode == "mask":
            out[field_key] = MASKED_PLACEHOLDER
    return out
