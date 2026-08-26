"""Phase 6 — shared reportlab building blocks. Two callers:
  - list_export.py's filtered-list PDF (a letterheaded table + a header
    block naming the filters, per RBAC §2.2(f)).
  - Single-document PDFs (Invoice, Credit Note, Payslip, Salary Certificate,
    Offer/Appointment/Resignation-Acceptance Letters, Asset Card) — each
    builds its own `sections`, this module only owns the letterhead and the
    low-level flowable helpers so every generated PDF looks like one system.

APPENDIX-B's "OFFICIAL DOCUMENT RULE": Payslip/Salary Certificate/Invoice/
Credit Note/Offer Letter must "read like an official document — proper
letterhead, company details and formatting from Company Profile."
"""

from __future__ import annotations

import logging
import os
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape as _xml_escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.masters import CompanyProfile
from app.services import file_storage

_log = logging.getLogger(__name__)

RUPEE = "\u20b9"

# ---------------------------------------------------------------------------
# Fonts. reportlab's base-14 fonts (Helvetica & friends) are Type1 fonts under
# WinAnsiEncoding, whose glyph set predates U+20B9 INDIAN RUPEE SIGN entirely.
# reportlab does NOT raise on a missing glyph — it maps the unknown codepoint
# through its WinAnsi table and silently emits whatever byte falls out, which
# for U+20B9 is 0x6E, the letter "n". Every money amount in a generated
# Invoice / Payslip / Salary Certificate / Offer Letter PDF therefore printed
# "n45,000.00", on documents that get emailed to customers and employees.
#
# Fix, in two layers:
#   1. Register a real Unicode TrueType face if the host has one, and use it
#      for every Paragraph and every table cell. Then U+20B9 is embedded as a
#      genuine glyph and the PDF says "₹45,000.00".
#   2. If the host has no such face (python:3.12-slim, for instance, ships no
#      fonts at all), degrade to a *readable* transliteration — "Rs 45,000.00"
#      — instead of a silently wrong letter. Layer 2 also catches every other
#      non-WinAnsi character that can reach a PDF through user-authored data
#      (smart quotes pasted from Word, an en dash in a customer name, ...),
#      which had the same silent-substitution problem.
# Candidates are probed in order and only accepted if the face actually
# carries a U+20B9 glyph, so a font that merely exists can't re-introduce the
# bug. MESHRD_PDF_FONT / MESHRD_PDF_FONT_BOLD let a deployment point at a
# face outside the standard locations without a code change.
# ---------------------------------------------------------------------------
_UNICODE_FONT_CANDIDATES: tuple[tuple[str, str, str], ...] = (
    ("MeshrdPdfSans", os.environ.get("MESHRD_PDF_FONT", ""), os.environ.get("MESHRD_PDF_FONT_BOLD", "")),
    ("DejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("DejaVuSans", "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("NotoSans", "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
    ("LiberationSans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ("WinArial", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("WinSegoeUI", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/segoeuib.ttf"),
    ("MacArial", "/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
)


def _register_unicode_font() -> tuple[str, str] | None:
    """Return (regular_font_name, bold_font_name) for the first candidate that
    exists, parses, and really has the rupee glyph. None => no Unicode face on
    this host, fall back to Helvetica + transliteration.
    """
    for family, regular_path, bold_path in _UNICODE_FONT_CANDIDATES:
        if not regular_path or not os.path.isfile(regular_path):
            continue
        try:
            face = TTFont(family, regular_path)
            if face.face.charToGlyph.get(ord(RUPEE), 0) == 0:
                continue  # exists but can't draw ₹ — no better than Helvetica
            pdfmetrics.registerFont(face)
        except Exception:  # unreadable/unsupported TTF — try the next one
            continue
        bold_name = family
        if bold_path and os.path.isfile(bold_path):
            try:
                pdfmetrics.registerFont(TTFont(f"{family}-Bold", bold_path))
                bold_name = f"{family}-Bold"
            except Exception:
                bold_name = family
        pdfmetrics.registerFontFamily(family, normal=family, bold=bold_name, italic=family, boldItalic=bold_name)
        return family, bold_name
    return None


_resolved_font = _register_unicode_font()
_UNICODE_FONT_OK = _resolved_font is not None
_FONT_REGULAR, _FONT_BOLD = _resolved_font or ("Helvetica", "Helvetica-Bold")
if not _UNICODE_FONT_OK:
    _log.warning(
        "pdf_engine: no Unicode TrueType face found on this host; generated PDFs will "
        "transliterate ₹ to 'Rs' and other non-WinAnsi characters to their closest ASCII "
        "form. Install a Unicode font (e.g. fonts-dejavu-core) or set MESHRD_PDF_FONT."
    )

# Characters that carry meaning we must not lose when the Unicode face is
# missing. Anything not listed here falls through to an NFKD/ASCII reduction.
_ASCII_FALLBACKS = {
    "\u20b9": "Rs ",  # ₹ INDIAN RUPEE SIGN
    "\u20a8": "Rs ",  # ₨ RUPEE SIGN
    "\u20ac": "EUR ",  # € (in WinAnsi, but keep the mapping honest if it isn't)
    "\u2060": "",
    "\ufeff": "",
}


def _to_winansi(text: str) -> str:
    """Reduce `text` to characters Helvetica/WinAnsiEncoding can actually draw."""
    try:
        text.encode("cp1252")
        return text
    except UnicodeEncodeError:
        pass
    out: list[str] = []
    for ch in text:
        try:
            ch.encode("cp1252")
            out.append(ch)
            continue
        except UnicodeEncodeError:
            pass
        sub = _ASCII_FALLBACKS.get(ch)
        if sub is None:
            stripped = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
            try:
                stripped.encode("cp1252")
            except UnicodeEncodeError:
                stripped = ""
            sub = stripped or "?"
        out.append(sub)
    return "".join(out)


def _pdf_text(value: Any) -> str:
    """Every string that reaches a Paragraph or a table cell goes through here,
    so the font decision is made in exactly one place.
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    return text if _UNICODE_FONT_OK else _to_winansi(text)


_STYLES = getSampleStyleSheet()
_TITLE = ParagraphStyle("MeshrdTitle", parent=_STYLES["Title"], fontName=_FONT_BOLD, fontSize=16, spaceAfter=4)
_SUBTLE = ParagraphStyle("MeshrdSubtle", parent=_STYLES["Normal"], fontName=_FONT_REGULAR, fontSize=8, textColor=colors.HexColor("#666666"))
_SECTION = ParagraphStyle("MeshrdSection", parent=_STYLES["Heading3"], fontName=_FONT_BOLD, fontSize=11, spaceBefore=10, spaceAfter=4)
_BODY = ParagraphStyle("MeshrdBody", parent=_STYLES["Normal"], fontName=_FONT_REGULAR)
_INK = colors.HexColor("#1a1a2e")
_HAIRLINE = colors.HexColor("#dddddd")


@dataclass
class ColumnSpec:
    key: str
    label: str
    align: str = "left"  # "left" | "right" — money is left per this project's own reversed convention


def _esc(text: Any) -> str:
    """`reportlab.platypus.Paragraph` parses a restricted XML/HTML-like
    markup subset in its text argument — any value that could ever contain
    attacker- or user-authored free text (a Customer/Vendor/Employee name, a
    Ticket subject, a search filter value, ...) MUST be escaped before
    reaching a Paragraph() call, or a name/value containing an unmatched
    "<letter..." pattern throws an unhandled ValueError (a cheap, reachable
    DoS — confirmed live against this exact reportlab version). Table cells
    (plain strings, never wrapped in Paragraph) don't need this — only
    Paragraph() call sites do.
    """
    return _xml_escape(_pdf_text(text))


def _letterhead_flowables(company: CompanyProfile | None) -> list:
    flow: list = []
    if company is None:
        # §6: no brand name belongs in code — Appendix-B's OFFICIAL DOCUMENT
        # RULE says the letterhead comes from Company Profile, so when that
        # row doesn't exist yet the honest letterhead is "nothing configured",
        # not a stand-in company name.
        flow.append(Paragraph("Company Profile Not Configured", _TITLE))
        return flow
    flow.append(Paragraph(_esc(company.legal_name), _TITLE))
    detail_bits = [b for b in (company.gstin and f"GSTIN: {company.gstin}", company.pan and f"PAN: {company.pan}", company.official_email, company.phone) if b]
    if detail_bits:
        # "&nbsp;|&nbsp;" is OUR OWN trusted separator markup — escape only
        # the individual data pieces, then join with it, so the separator
        # itself isn't double-escaped into literal "&amp;nbsp;" text.
        flow.append(Paragraph(" &nbsp;|&nbsp; ".join(_esc(b) for b in detail_bits), _SUBTLE))
    flow.append(Spacer(1, 6))
    return flow


def _money(v: Any) -> str:
    # NOTE — the ₹ *glyph* problem (it used to print as the letter "n") is
    # fixed at the font layer above; what remains below is the separate,
    # still-open question of which currency a deployment should format in.
    #
    # QUEUED — §6 flags this ₹ literal as hardcoded currency/locale. Not
    # fixed here because there is nothing real to read it from yet:
    # CompanyProfile (backend/app/models/masters.py:286 `class
    # CompanyProfile(Base, AuditMixin)`) has no currency_symbol /
    # currency_code / decimal_places column at all, so a Super Admin has no
    # way to set one for a non-INR deployment. This is also the one shared
    # formatter every PDF (invoices, payslips, credit notes, salary
    # certificates, assets, opportunities, compliance remittances,
    # employee-lifecycle letters) is supposed to route through — several of
    # those routers currently inline their own ad hoc f"₹{...}" instead of
    # calling this function, which is a second, separate problem (dedupe
    # onto this helper) layered on top of this one (make the helper itself
    # dynamic).
    # Needs, in order: (1) a currency_symbol/currency_code column added to
    # company_profile + a migration, seeded with a comment recording why
    # INR/₹ was the default, (2) this function threaded the `company:
    # CompanyProfile` object already passed into every render_*_pdf call
    # instead of formatting from a bare Decimal, (3) the routers that
    # currently inline "₹" switched to call _money()/this helper instead of
    # repeating the literal. None of that schema/API surface exists yet, so
    # doing it here would mean guessing at a column shape no migration has
    # created.
    if v is None:
        return ""
    if isinstance(v, Decimal):
        return f"{RUPEE}{v:,.2f}"
    return str(v)


def render_table_pdf(
    title: str, columns: list[ColumnSpec], rows: list[dict], header_lines: list[str],
    company: CompanyProfile | None = None, logo_bytes: bytes | None = None,
) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=15 * mm, leftMargin=15 * mm, rightMargin=15 * mm)
    flow: list = []
    if logo_bytes:
        try:
            flow.append(Image(BytesIO(logo_bytes), width=28 * mm, height=14 * mm))
            flow.append(Spacer(1, 4))
        except Exception:
            pass
    flow += _letterhead_flowables(company)
    flow.append(Paragraph(_esc(title), _SECTION))
    for line in header_lines:
        flow.append(Paragraph(_esc(line), _SUBTLE))
    flow.append(Spacer(1, 8))

    def _cell(v: Any) -> str:
        if v is None:
            return ""
        return _pdf_text(_money(v) if isinstance(v, Decimal) else v)

    header = [_pdf_text(c.label) for c in columns]
    data = [header] + [[_cell(row.get(c.key)) for c in columns] for row in rows]

    table = Table(data, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), _INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), _FONT_REGULAR),
        ("FONTNAME", (0, 0), (-1, 0), _FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, _HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f7f9")]),
    ]
    for i, c in enumerate(columns):
        style.append(("ALIGN", (i, 0), (i, -1), "RIGHT" if c.align == "right" else "LEFT"))
    table.setStyle(TableStyle(style))
    flow.append(table)
    doc.build(flow)
    return buf.getvalue()


def render_document_pdf(title: str, company: CompanyProfile | None, sections: list[tuple[str, list[tuple[str, str]]]], logo_bytes: bytes | None = None) -> bytes:
    """`sections` is a list of (heading, [(label, value), ...]) key-value
    blocks — used for Payslip/Salary Certificate/Letters. Invoice/Credit
    Note use render_table_pdf for their line-item table plus a totals block
    built the same way as a section here.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=15 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    flow: list = []
    if logo_bytes:
        try:
            flow.append(Image(BytesIO(logo_bytes), width=28 * mm, height=14 * mm))
            flow.append(Spacer(1, 4))
        except Exception:
            pass
    flow += _letterhead_flowables(company)
    flow.append(Paragraph(_esc(title), _SECTION))
    flow.append(Spacer(1, 4))
    for heading, rows in sections:
        if heading:
            flow.append(Paragraph(_esc(heading), _SECTION))
        data = [[_pdf_text(label), _pdf_text(value)] for label, value in rows]
        t = Table(data, colWidths=[60 * mm, None])
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), _FONT_REGULAR),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#555555")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, _HAIRLINE),
        ]))
        flow.append(t)
        flow.append(Spacer(1, 6))
    doc.build(flow)
    return buf.getvalue()


async def company_logo_bytes(db) -> tuple[CompanyProfile | None, bytes | None]:
    from sqlalchemy import select

    company = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if company is None or not company.logo_file_id:
        return company, None
    from app.models.platform import StoredFile

    logo_row = await db.get(StoredFile, company.logo_file_id)
    if logo_row is None:
        return company, None
    try:
        return company, file_storage.read_bytes(logo_row)
    except OSError:
        return company, None
