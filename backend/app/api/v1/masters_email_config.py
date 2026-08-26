"""Masters §3.21 — Email Configuration. Server Settings (singleton, credential
fields masked on read per the stored convention), Templates (never created or
deleted via the API — seeded rows, only Enabled/Subject/Body are editable —
the DB trigger rejects DELETE outright, proven live), and Recent Sends
(read-only append-only log).

Send Test now calls the real transport (app/services/email_transport.py,
Phase 6) — Mailgun/SMTP behind whatever Provider is configured, or a queued-
but-undelivered row with an explanatory error_detail when Sending is off or
misconfigured, same as any other real send.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import EmailSendLog, EmailServerSettings, EmailTemplate
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import (
    EmailSendLogOut,
    EmailServerSettingsOut,
    EmailServerSettingsWrite,
    EmailTemplateCreate,
    EmailTemplateOut,
    EmailTemplateWrite,
    SendTestEmailRequest,
)
from app.services import email_transport, list_export
from app.services.crypto import encrypt_secret
from app.services.pdf_engine import ColumnSpec

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/masters/email-configuration", tags=["masters"])
SCREEN = "masters.email_configuration"

# Migration 0002's CHECK constraints on email_server_settings, mapped to the
# message a user can act on. EmailServerSettingsWrite types provider /
# encryption / smtp_port as plain str|int, so nothing rejects an out-of-range
# value before the INSERT — and MySQL raises a CHECK failure (3819) as an
# OperationalError, which no handler here caught at all, so every one of these
# surfaced as a raw 500. Same _as_client_error split as
# masters_company_profile.py; the realistic case is ck_ess_api_key — an admin
# switching Provider from Custom SMTP to Mailgun and saving before pasting the
# key.
_ALLOWED_PROVIDERS = ("CUSTOM_SMTP", "SENDGRID", "SES", "MAILGUN", "POSTMARK")
_PROVIDER_MESSAGE = "Provider must be one of " + ", ".join(_ALLOWED_PROVIDERS)

_CHECK_CONSTRAINT_MESSAGES = {
    "ck_ess_provider": _PROVIDER_MESSAGE,
    "ck_ess_encryption": "Encryption must be STARTTLS, SSL_TLS or NONE",
    "ck_ess_port": "SMTP Port must be between 1 and 65535",
    "ck_ess_api_key": "This provider needs an API key — supply api_key when Provider is not CUSTOM_SMTP",
    "ck_ess_smtp_complete": "CUSTOM_SMTP needs SMTP Host, SMTP Port and Encryption",
}


def _as_client_error(exc: DBAPIError) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    text = str(exc.orig)
    for constraint, message in _CHECK_CONSTRAINT_MESSAGES.items():
        if constraint in text:
            return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Rejected by a database constraint")

_TEMPLATE_LIST_COLUMNS = [
    ColumnSpec("template_name", "Template Name"),
    ColumnSpec("triggered_from_module", "Triggered From Module"),
    ColumnSpec("is_enabled", "Enabled"),
    ColumnSpec("subject", "Subject"),
]

_RECENT_SENDS_COLUMNS = [
    ColumnSpec("recipient_email", "Recipient"),
    ColumnSpec("subject_snapshot", "Subject"),
    ColumnSpec("sent_at", "Sent At"),
    ColumnSpec("delivery_status", "Status"),
    ColumnSpec("error_detail", "Error"),
]


# Phase 1 RBAC wiring — field_manifest.json's "masters.email_configuration"
# entry registers real field_keys across all three sub-resources (Server
# Settings, Templates, Recent Sends: e.g. body, subject, encryption,
# recipient_email, delivery_status, sent_at, template_name — see the manifest
# for the full ~24-row list), so apply_field_masking is meaningful on every
# endpoint below, not just a formality. Same call-site pattern as
# customers.py's _masked_customer: model_validate(row).model_dump() is safe
# here because EmailServerSettingsOut/EmailTemplateOut/EmailSendLogOut are all
# real `class Foo(BaseModel): ... model_config = ConfigDict(from_attributes=
# True)` bodies (config set at class-definition time), not create_model(...)
# with model_config bolted on after — the documented sharp edge doesn't apply.
# credential_hint (last-4-chars) is a SEPARATE, pre-existing masking
# convention for the raw password/api_key secrets themselves — those two
# fields never appear in EmailServerSettingsOut's output at all, so
# apply_field_masking has nothing to act on for them (its "field_key not in
# out: continue" no-op guard skips them); this doesn't double-mask or
# conflict, credential_hint's own truncation IS the masking for that pair.
def _masked_settings(row: EmailServerSettings, perms: PermissionSet) -> dict:
    return apply_field_masking(EmailServerSettingsOut.model_validate(row).model_dump(), perms)


def _masked_template(row: EmailTemplate, perms: PermissionSet) -> dict:
    return apply_field_masking(EmailTemplateOut.model_validate(row).model_dump(), perms)


def _masked_send_log(row: EmailSendLog, perms: PermissionSet) -> dict:
    return apply_field_masking(EmailSendLogOut.model_validate(row).model_dump(), perms)


@router.get("/server-settings", response_model=None)
async def get_server_settings(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict | None:
    # response_model dropped to None: masking must run before the response
    # leaves this function (it can't be done through FastAPI's automatic
    # response_model path), and a hidden field must stay absent from THIS
    # response too, not just from list endpoints (masking master prompt §3.2).
    row = (await db.execute(select(EmailServerSettings))).scalar_one_or_none()
    return _masked_settings(row, perms) if row is not None else None


@router.put("/server-settings", response_model=None)
async def upsert_server_settings(
    body: EmailServerSettingsWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    # Mirrors ck_ess_provider, checked here first for the same reason
    # masters_bank_accounts.py's deactivate mirrors its trigger: MySQL
    # evaluates ck_ess_api_key before ck_ess_provider, so an unknown provider
    # otherwise comes back complaining about a missing API key instead of
    # about the provider. It also decides which secret field is read below.
    if body.provider not in _ALLOWED_PROVIDERS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_PROVIDER_MESSAGE)
    row = (await db.execute(select(EmailServerSettings))).scalar_one_or_none()
    # Found by the Phase 1 audit: credential_hint (and the encrypted secret
    # itself) must only change when THIS request actually supplies a new
    # secret. GET never echoes the raw value back (correctly, per the
    # masking convention), so any ordinary edit that doesn't resupply
    # password/api_key — toggling Sending Enabled, fixing a typo in From
    # Name — must leave the previously-saved credential untouched, not wipe
    # it to NULL.
    new_secret = body.api_key if body.provider != "CUSTOM_SMTP" else body.password

    if row is None:
        row = EmailServerSettings(id=str(uuid.uuid4()), singleton_lock=True, created_by=current_user.id, updated_by=current_user.id)
        db.add(row)

    row.sending_enabled = body.sending_enabled
    row.provider = body.provider
    row.smtp_host = body.smtp_host
    row.smtp_port = body.smtp_port
    row.encryption = body.encryption
    row.username = body.username
    row.from_name = body.from_name
    row.from_email = body.from_email
    row.reply_to_email = body.reply_to_email
    if new_secret is not None:
        row.credential_hint = new_secret[-4:]
        if body.provider == "CUSTOM_SMTP":
            row.password_encrypted = encrypt_secret(body.password)
        else:
            row.api_key_encrypted = encrypt_secret(body.api_key)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return _masked_settings(row, perms)


@router.get("/templates", response_model=None)
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    rows = list((await db.execute(select(EmailTemplate))).scalars().all())

    if format:
        # RBAC §2.2a: "Log" screens are list screens too — this tab has no
        # query filters of its own, so filters_applied is empty (build_export
        # still stamps the result count / exported-by / exported-at block).
        export_rows = [
            {
                "template_name": r.template_name, "triggered_from_module": r.triggered_from_module,
                "is_enabled": "Yes" if r.is_enabled else "No", "subject": r.subject,
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "Email Templates", _TEMPLATE_LIST_COLUMNS, export_rows, {})

    return [_masked_template(r, perms) for r in rows]


@router.post("/templates", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: EmailTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="create")),
) -> dict:
    """Masters §3.21: "Super Admin can add a row here the moment a future
    module introduces a new notification — this list is not meant to be
    exhaustive beyond what exists today." The 16 starting rows are seeded
    (app/seed.py, SEED_EMAIL_TEMPLATES); this is that growth path, found
    missing entirely by the Phase 1 audit (only GET/PUT existed).
    """
    existing = (await db.execute(select(EmailTemplate).where(EmailTemplate.template_key == body.template_key))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A template with key '{body.template_key}' already exists")
    row = EmailTemplate(id=str(uuid.uuid4()), created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _masked_template(row, perms)


@router.put("/templates/{template_id}", response_model=None)
async def update_template(
    template_id: str,
    body: EmailTemplateWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await db.get(EmailTemplate, template_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Invariant 12: disabling a template silences ONLY the email — the
    # in-app notification for the same event still fires, elsewhere, and is
    # untouched by this flag.
    row.is_enabled = body.is_enabled
    row.subject = body.subject
    row.body = body.body
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return _masked_template(row, perms)


@router.post("/send-test", response_model=None, status_code=status.HTTP_201_CREATED)
async def send_test_email(
    body: SendTestEmailRequest,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="send_test")),
) -> dict:
    settings = (await db.execute(select(EmailServerSettings))).scalar_one_or_none()
    if settings is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Configure Server Settings before sending a test email")
    log_row = await email_transport.send_raw(
        db, recipient_email=body.to_email, subject=f"{settings.from_name} — Test Email",
        body="This is a test email confirming your Email Configuration server settings are working.",
        bypass_sending_enabled=True,
    )
    return _masked_send_log(log_row, perms)


@router.get("/recent-sends", response_model=None)
async def recent_sends(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    rows = list((await db.execute(select(EmailSendLog).order_by(EmailSendLog.sent_at.desc()))).scalars().all())

    if format:
        # RBAC §2.2a: "Log" screens are list screens too — this tab has no
        # query filters of its own, so filters_applied is empty (build_export
        # still stamps the result count / exported-by / exported-at block).
        export_rows = [
            {
                "recipient_email": r.recipient_email, "subject_snapshot": r.subject_snapshot,
                "sent_at": r.sent_at, "delivery_status": r.delivery_status, "error_detail": r.error_detail or "",
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "Recent Sends", _RECENT_SENDS_COLUMNS, export_rows, {})

    return [_masked_send_log(r, perms) for r in rows]
