"""Symmetric encryption for stored credentials (Email Server Settings'
password/API key) — Fernet, keyed off `settings.credential_encryption_key`.
Same "masked on read, only the last few characters shown" convention as
every other stored credential in this CMS (see masters_email_config.py's
`credential_hint`) — this module is what makes the encrypted column real
rather than the placeholder UTF-8 encoding it started as.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    return Fernet(get_settings().credential_encryption_key.encode("utf-8"))


def encrypt_secret(plain: str) -> bytes:
    return _fernet().encrypt(plain.encode("utf-8"))


def decrypt_secret(cipher: bytes) -> str | None:
    try:
        return _fernet().decrypt(cipher).decode("utf-8")
    except InvalidToken:
        return None
