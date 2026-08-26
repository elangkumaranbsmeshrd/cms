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

from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape as _xml_escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.masters import CompanyProfile
from app.services import file_storage

_STYLES = getSampleStyleSheet()
_TITLE = ParagraphStyle("MeshrdTitle", parent=_STYLES["Title"], fontSize=16, spaceAfter=4)
_SUBTLE = ParagraphStyle("MeshrdSubtle", parent=_STYLES["Normal"], fontSize=8, textColor=colors.HexColor("#666666"))
_SECTION = ParagraphStyle("MeshrdSection", parent=_STYLES["Heading3"], fontSize=11, spaceBefore=10, spaceAfter=4)
_BODY = _STYLES["Normal"]
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
    if text is None:
        return ""
    return _xml_escape(str(text))


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
        return f"₹{v:,.2f}"
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
        return _money(v) if isinstance(v, Decimal) else str(v)

    header = [c.label for c in columns]
    data = [header] + [[_cell(row.get(c.key)) for c in columns] for row in rows]

    table = Table(data, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), _INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
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
        data = [[label, value] for label, value in rows]
        t = Table(data, colWidths=[60 * mm, None])
        t.setStyle(TableStyle([
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
