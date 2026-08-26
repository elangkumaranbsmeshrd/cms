"""Phase 6 — the real transport behind Email Configuration's Provider setting
(Masters §3.21). Two halves:

  - `send_templated_email()` — the call every notification trigger site uses.
    Looks up the EmailTemplate by key, respects BOTH gates (global Sending
    Enabled + the template's own Enabled — Invariant 12: disabling a
    template silences only the email, never the in-app notification, so
    this function is deliberately never called from inside notify.py or
    vice versa — they're independent, parallel calls at each trigger site).
  - `send_raw()` — the actual provider dispatch + EmailSendLog write, shared
    by send_templated_email() and Send Test (masters_email_config.py).

Placeholder rendering is a plain regex substitution over a literal dict —
deliberately NOT str.format()/Jinja on a user-editable template (BUILD-PROMPT
§9: a crafted template must not be able to reach object internals via
`{0.__class__...}`-style format-spec tricks).

Locked stack (per project memory, 2026-07-31 phase-close decision) names
Mailgun as the actual deployment provider; CUSTOM_SMTP is a genuine second
real transport (smtplib). SENDGRID/AMAZON_SES/POSTMARK stay selectable in
the dropdown (matching the spec's own Provider list) but log a clear FAILED
row rather than silently pretending to send — no SDK for those three is in
scope.
"""

from __future__ import annotations

import re
import smtplib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.masters import EmailSendLog, EmailServerSettings, EmailTemplate
from app.services.crypto import decrypt_secret

_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


@dataclass
class Attachment:
    filename: str
    content: bytes
    mime_type: str = "application/pdf"


def render_template(text: str, context: dict) -> str:
    return _PLACEHOLDER.sub(lambda m: str(context.get(m.group(1), "")), text)


async def _dispatch(
    settings: EmailServerSettings, recipient_email: str, subject: str, body: str, attachment: Attachment | None,
) -> tuple[str, str | None, str | None]:
    """Returns (delivery_status, provider_message_id, error_detail)."""
    if settings.provider == "MAILGUN":
        api_key = decrypt_secret(settings.api_key_encrypted) if settings.api_key_encrypted else None
        if not api_key:
            return "FAILED", None, "Mailgun API Key is not configured"
        domain = settings.from_email.split("@", 1)[-1]
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"https://api.mailgun.net/v3/{domain}/messages",
                    auth=("api", api_key),
                    data={
                        "from": f"{settings.from_name} <{settings.from_email}>",
                        "to": recipient_email,
                        "subject": subject,
                        "text": body,
                        **({"h:Reply-To": settings.reply_to_email} if settings.reply_to_email else {}),
                    },
                    files=[("attachment", (attachment.filename, attachment.content, attachment.mime_type))] if attachment else None,
                )
            if resp.status_code == 200:
                return "SENT", resp.json().get("id"), None
            return "FAILED", None, f"Mailgun {resp.status_code}: {resp.text[:500]}"
        except httpx.HTTPError as exc:
            return "FAILED", None, f"Mailgun request error: {exc}"

    if settings.provider == "CUSTOM_SMTP":
        password = decrypt_secret(settings.password_encrypted) if settings.password_encrypted else None
        if not settings.smtp_host or not settings.smtp_port:
            return "FAILED", None, "SMTP Host/Port are not configured"
        try:
            import asyncio

            def _send_smtp() -> None:
                if attachment is not None:
                    msg = MIMEMultipart()
                    msg.attach(MIMEText(body))
                    part = MIMEApplication(attachment.content, Name=attachment.filename)
                    part["Content-Disposition"] = f'attachment; filename="{attachment.filename}"'
                    msg.attach(part)
                else:
                    msg = MIMEText(body)
                msg["Subject"] = subject
                msg["From"] = f"{settings.from_name} <{settings.from_email}>"
                msg["To"] = recipient_email
                if settings.reply_to_email:
                    msg["Reply-To"] = settings.reply_to_email
                # ck_ess_encryption's real value set: STARTTLS / SSL_TLS / NONE.
                cls = smtplib.SMTP_SSL if settings.encryption == "SSL_TLS" else smtplib.SMTP
                with cls(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
                    if settings.encryption == "STARTTLS":
                        smtp.starttls()
                    if settings.username and password:
                        smtp.login(settings.username, password)
                    smtp.sendmail(settings.from_email, [recipient_email], msg.as_string())

            await asyncio.to_thread(_send_smtp)
            return "SENT", None, None
        except (smtplib.SMTPException, OSError) as exc:
            return "FAILED", None, f"SMTP error: {exc}"

    return "FAILED", None, f"Provider '{settings.provider}' has no transport implemented yet"


async def send_raw(
    db: AsyncSession, recipient_email: str, subject: str, body: str,
    related_record_type: str | None = None, related_record_id: str | None = None,
    email_template_id: str | None = None, bypass_sending_enabled: bool = False,
    attachment: Attachment | None = None,
) -> EmailSendLog:
    settings = (await db.execute(select(EmailServerSettings))).scalar_one_or_none()
    if settings is None:
        status_, msg_id, err = "FAILED", None, "Email Server Settings are not configured"
    elif not settings.sending_enabled and not bypass_sending_enabled:
        # Masters §3.21 EMAIL MASTER SWITCH: off stops every outbound email at
        # once — logged, not silently dropped, so Recent Sends still shows why.
        status_, msg_id, err = "FAILED", None, "Sending Enabled is off (Email Configuration → Server Settings)"
    else:
        status_, msg_id, err = await _dispatch(settings, recipient_email, subject, body, attachment)

    row = EmailSendLog(
        id=str(uuid.uuid4()), email_template_id=email_template_id, recipient_email=recipient_email,
        subject_snapshot=subject, sent_at=datetime.now(timezone.utc), delivery_status=status_,
        provider_message_id=msg_id, error_detail=err,
        related_record_type=related_record_type, related_record_id=related_record_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def send_templated_email(
    db: AsyncSession, template_key: str, recipient_email: str, context: dict,
    related_record_type: str | None = None, related_record_id: str | None = None,
    attachment: Attachment | None = None,
) -> EmailSendLog | None:
    """Returns None (no row written) when the template itself is disabled —
    that's a deliberate no-op per Invariant 12, not a failure to log. A
    missing/unconfigured server or a real send failure both still produce a
    FAILED EmailSendLog row via send_raw(), so those stay visible in
    Recent Sends. Pass `attachment=Attachment(filename, content_bytes,
    mime_type)` for the one documented case that needs one (Offer/
    Appointment Letter, "email with the letter attached," 02-employee-
    module.md §2.15) — every other template is attachment-free.
    """
    template = (await db.execute(select(EmailTemplate).where(EmailTemplate.template_key == template_key))).scalar_one_or_none()
    if template is None or not template.is_enabled:
        return None
    subject = render_template(template.subject, context)
    body = render_template(template.body, context)
    return await send_raw(
        db, recipient_email=recipient_email, subject=subject, body=body,
        related_record_type=related_record_type, related_record_id=related_record_id,
        email_template_id=template.id, attachment=attachment,
    )
