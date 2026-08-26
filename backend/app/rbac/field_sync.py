"""Additive sync of ScreenSensitiveField rows from the frontend's own field
manifest (ARCH-2 §3.1 / MASTER-BUILD-PROMPT.md §3).

WHY THIS EXISTS: app/rbac/registry/screens.py's `sensitive_fields` tuples are
a HAND-CURATED list — real, code-reviewed, and the right place for a
deliberate carve-out like vendor.directory's banking fields. But by hand it
only ever covered ~8 fields across 82 screens, and MASTER-BUILD-PROMPT.md §3
is explicit: "Never a hand-maintained second list: 900+ fields curated by
hand would be stale within a week... Each screen already declares its fields
and columns in its config; derive the field registry from that at
build/startup and sync it into the RBAC tables."

The "config" in question is the Angular screen configs under
frontend/src/app/features/**/*.config.ts (ListScreenConfig.columns,
FormScreenConfig/SingletonFormConfig.fields, RecordScreenConfig's tabs'
sections' fields, TabbedScreenConfig recursing into its tabs' own configs —
see screen.types.ts). Those configs contain real functions (`compute:`,
`predicate:`, …) that can't be safely imported/executed from Python, so a
separate Node script (frontend/scripts/generate-field-manifest.js) statically
parses their TypeScript AST and writes the extracted {screen_key: [{field_key,
label}, …]} map to field_manifest.json, sitting right next to this module.
That JSON is the ONLY thing this file reads — it never touches TypeScript.

REGENERATE THE MANIFEST whenever a *.config.ts file's fields/columns change:

    cd frontend && node scripts/generate-field-manifest.js

This is a build-time sync, not a live one — nothing here watches the
frontend source, and `seed()` only re-reads field_manifest.json from disk.

ADDITIVE ONLY, always. This module NEVER updates or deletes an existing
ScreenSensitiveField row:
  - A hand-curated row from screens.py's `sensitive_fields` may carry a
    deliberately different label than the frontend's own column header.
  - A row — hand-curated or previously auto-synced — may already be
    referenced by a seeded RolePermissionField grant (e.g. vendor.directory's
    Manager 'hide' rows in seed.py's SCREEN_FIELD_PERMISSIONS); rewriting it
    out from under that grant would be a silent behaviour change.
So the only operation here is: for a (screen, field_key) pair that has NO row
at all yet, insert one. Anything already present — from either source — is
left completely alone.

Manifest screen_keys with no matching ScreenDef in the real registry (a
config that exists in Angular but hasn't been registered in
app/rbac/registry/screens.py's SCREENS dict yet — a separate, expected build-
sequencing gap, not an error) are skipped silently, and returned in the
result's `skipped_screens` list so a caller can choose to log them.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rbac import ScreenSensitiveField

MANIFEST_PATH = Path(__file__).parent / "field_manifest.json"

# screen_sensitive_fields.label is String(120) — a couple of the frontend's
# own arrayFields labels (Tax Head's Slab Bands / Split Components / Relief
# Rules) are full descriptive sentences well past that, so truncate rather
# than let a DB insert fail over a label that's cosmetic to begin with.
_LABEL_MAX_LEN = 120


@dataclass
class FieldSyncResult:
    added: int = 0
    screens_touched: int = 0
    skipped_screens: list[str] = field(default_factory=list)
    manifest_missing: bool = False


async def sync_fields_from_manifest(
    db: AsyncSession,
    screen_ids: dict[str, str],
    manifest_path: Path = MANIFEST_PATH,
) -> FieldSyncResult:
    """Additively insert ScreenSensitiveField rows for every (screen_key,
    field_key) in the manifest that:
      1. has a screen_key present in `screen_ids` (i.e. a real ScreenDef —
         `screen_ids` is the same key->id map seed()'s own screen-registry
         loop already built, whether that screen row was just created or
         already existed), and
      2. does not already have a ScreenSensitiveField row for that field_key
         on that screen (from the hand-curated loop that runs before this,
         or from a previous run of this same sync).

    Never touches an existing row. Safe to call every time seed() runs.
    """
    result = FieldSyncResult()

    if not manifest_path.exists():
        result.manifest_missing = True
        return result

    manifest: dict[str, list[dict[str, str]]] = json.loads(manifest_path.read_text(encoding="utf-8"))

    for screen_key, entries in manifest.items():
        screen_id = screen_ids.get(screen_key)
        if screen_id is None:
            # Angular has a config for this screen_key, but it isn't
            # registered in SCREENS yet — expected, not an error.
            result.skipped_screens.append(screen_key)
            continue

        existing_keys = set(
            (
                await db.execute(
                    select(ScreenSensitiveField.field_key).where(ScreenSensitiveField.screen_id == screen_id)
                )
            )
            .scalars()
            .all()
        )

        added_for_screen = 0
        for entry in entries:
            field_key = entry.get("field_key")
            if not field_key or field_key in existing_keys:
                continue
            label = (entry.get("label") or field_key.replace("_", " ").title())[:_LABEL_MAX_LEN]
            db.add(
                ScreenSensitiveField(
                    id=str(uuid.uuid4()),
                    screen_id=screen_id,
                    field_key=field_key,
                    label=label,
                )
            )
            existing_keys.add(field_key)  # guard against duplicate field_keys within the same manifest list
            added_for_screen += 1

        if added_for_screen:
            result.added += added_for_screen
            result.screens_touched += 1

    if result.added:
        await db.flush()

    return result
