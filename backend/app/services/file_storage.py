"""Phase 6 — local filesystem storage backing `stored_files` (locked stack:
"local filesystem storage on that droplet," ARCH-3). Content-addressed by
sha256 so an identical re-upload (e.g. the same logo re-attached to two
records) doesn't duplicate bytes on disk — `stored_files.content_hash`
already existed as a column with nothing computing it until now.
"""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.models.platform import StoredFile


def _storage_root() -> Path:
    root = Path(get_settings().file_storage_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path_for_hash(content_hash: str) -> Path:
    return _storage_root() / content_hash[:2] / content_hash


def content_hash_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


# `content_hash` is computed by the caller (files.py) and passed in rather
# than recomputed here, because the caller needs it BEFORE this is called —
# to look up whether a StoredFile row for this exact content already exists.
# `storage_key` carries a UNIQUE constraint on that same hash, so a second
# row for identical content is never valid; the caller is what decides
# reuse-vs-create, this function only ever writes bytes and builds a row.
def save_upload(content: bytes, content_hash: str, original_filename: str, mime_type: str, uploaded_by: str | None) -> StoredFile:
    path = _path_for_hash(content_hash)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return StoredFile(
        id=str(uuid.uuid4()), storage_key=content_hash, original_filename=original_filename,
        mime_type=mime_type, size_bytes=len(content), content_hash=content_hash, uploaded_by=uploaded_by,
    )


def read_bytes(stored_file: StoredFile) -> bytes:
    return _path_for_hash(stored_file.storage_key).read_bytes()
