"""Phase 6 — the generic upload/download endpoints every `*_stored_file_id`/
`*_file_id` column across this codebase has been referencing by ID since
Phase 1, with nothing able to create or serve one until now (confirmed
absent by the Phase 6 research pass — zero `UploadFile` usage anywhere).

Authorization model: any authenticated user may upload (creates an inert
row nobody can reach without being handed its id) and download BY ID. This
deliberately mirrors how every consumer already works — a Ticket entry's
`attachment_stored_file_id`, an Asset's `photo_stored_file_id`, a Company
Profile's `logo_file_id` are all only ever discoverable through their own
already-screen-gated parent endpoint; downloading isn't more sensitive than
the parent record's other fields the caller can already see. There is no
per-purpose ACL on the file itself, same as this codebase has never had one
on any `_id` foreign key value in a response body.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.platform import StoredFile, User
from app.services import file_storage

router = APIRouter(prefix="/files", tags=["files"])

# Per-purpose limits, drawn from the module specs that actually name one
# (Ticket/Employee attachments: PDF/JPG/PNG, 5MB — 04-ticket-module.md §2.3,
# 02-employee-module.md's document upload). Anything not listed here falls
# back to a generic, reasonably permissive default rather than blocking a
# purpose no spec has constrained yet.
_PDF_IMAGE = {"application/pdf", "image/jpeg", "image/png"}
_PURPOSE_RULES: dict[str, tuple[set[str], int]] = {
    "ticket_attachment": (_PDF_IMAGE, 5 * 1024 * 1024),
    "asset_photo": ({"image/jpeg", "image/png"}, 5 * 1024 * 1024),
    "asset_request_photo": ({"image/jpeg", "image/png"}, 5 * 1024 * 1024),
    "employee_document": (_PDF_IMAGE, 5 * 1024 * 1024),
    "expense_receipt": (_PDF_IMAGE, 5 * 1024 * 1024),
    "purchase_bill_attachment": (_PDF_IMAGE, 10 * 1024 * 1024),
    "company_logo": ({"image/jpeg", "image/png"}, 2 * 1024 * 1024),
    "company_letterhead": ({"image/jpeg", "image/png", "application/pdf"}, 5 * 1024 * 1024),
    "bank_upi_qr": ({"image/jpeg", "image/png"}, 2 * 1024 * 1024),
    "opportunity_file": (_PDF_IMAGE | {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, 10 * 1024 * 1024),
    "asset_file": (_PDF_IMAGE, 10 * 1024 * 1024),
}
_DEFAULT_RULE = (_PDF_IMAGE | {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, 10 * 1024 * 1024)

# Phase 7 hardening round 2 — a security audit confirmed the MIME allowlist
# above was checked only against the client-supplied multipart Content-Type
# header (file.content_type), never against the actual bytes: uploading a
# renamed .exe declared as "image/png" sailed straight through. Covers every
# type that ever appears in _PURPOSE_RULES/_DEFAULT_RULE — deliberately
# hand-rolled rather than a python-magic/libmagic dependency, since that's
# an extra system library this Docker build doesn't otherwise need for a
# fixed, small set of types. DOCX and XLSX share the same ZIP-based OOXML
# signature and aren't distinguished further — both only ever appear
# together in the same purpose rules, so that's not a gap this needs to close.
_MAGIC_BYTES: dict[str, tuple[bytes, ...]] = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
}


def _content_matches_declared_type(content: bytes, content_type: str) -> bool:
    signatures = _MAGIC_BYTES.get(content_type)
    if signatures is None:
        return True  # no signature on file for this type — nothing to check against
    return any(content.startswith(sig) for sig in signatures)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    purpose: str = Form("generic"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    allowed_mimes, max_bytes = _PURPOSE_RULES.get(purpose, _DEFAULT_RULE)
    content = await file.read()
    if file.content_type not in allowed_mimes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"File type {file.content_type} is not allowed for '{purpose}' (allowed: {', '.join(sorted(allowed_mimes))})")
    if not _content_matches_declared_type(content, file.content_type):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"File content does not match its declared type ({file.content_type})")
    if len(content) > max_bytes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"File exceeds the {max_bytes // (1024 * 1024)}MB limit for '{purpose}'")
    if len(content) == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File is empty")

    # Content-addressed storage (file_storage.py): `stored_files.storage_key`
    # is UNIQUE on the sha256 of the bytes, so a second upload of
    # byte-identical content — the same logo re-attached to two records, the
    # same file picked twice after Replace — is not a second row, it's the
    # same row again. Checked BEFORE attempting an insert (the common,
    # non-racing case) rather than only discovered via a failed INSERT: this
    # used to reach the DB unconditionally and crash with a raw 500 on the
    # unique-constraint collision instead of a clean, silent reuse.
    content_hash = file_storage.content_hash_of(content)
    existing = (await db.execute(select(StoredFile).where(StoredFile.storage_key == content_hash))).scalar_one_or_none()
    if existing is not None:
        return {"id": existing.id, "original_filename": existing.original_filename, "mime_type": existing.mime_type, "size_bytes": existing.size_bytes}

    row = file_storage.save_upload(content, content_hash, file.filename or "upload", file.content_type or "application/octet-stream", current_user.id)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError:
        # The narrow race the pre-check above can't close: two uploads of the
        # same new content, close enough together that neither saw the
        # other's row yet. The loser doesn't get a row of its own —
        # content-addressed means exactly one row per distinct content — it
        # reuses whichever one the winner just committed.
        await db.rollback()
        existing = (await db.execute(select(StoredFile).where(StoredFile.storage_key == content_hash))).scalar_one_or_none()
        if existing is not None:
            return {"id": existing.id, "original_filename": existing.original_filename, "mime_type": existing.mime_type, "size_bytes": existing.size_bytes}
        raise
    await db.refresh(row)
    return {"id": row.id, "original_filename": row.original_filename, "mime_type": row.mime_type, "size_bytes": row.size_bytes}


def _safe_header_filename(name: str) -> str:
    """The uploader's own client-supplied filename is reflected into a
    response header verbatim otherwise — strip control characters (CR/LF/
    NUL, which could otherwise smuggle extra header lines depending on the
    ASGI server's leniency) and escape a literal quote so it can't terminate
    the filename="..." value early.
    """
    cleaned = "".join(ch for ch in name if ch.isprintable() and ch not in ("\r", "\n"))
    return cleaned.replace('"', "'") or "download"


@router.get("/{file_id}")
async def download_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    row = await db.get(StoredFile, file_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    content = file_storage.read_bytes(row)
    return Response(
        content=content, media_type=row.mime_type,
        headers={"Content-Disposition": f'inline; filename="{_safe_header_filename(row.original_filename)}"'},
    )
