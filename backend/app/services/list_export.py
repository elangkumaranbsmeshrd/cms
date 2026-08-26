"""Phase 6 — the shared "export the filtered set" contract every list
endpoint plugs into. RBAC §2.2(f), verbatim requirements this module exists
to satisfy: "Export to PDF"/"Export to Excel" on every list screen, not a
Super Admin privilege; exports exactly what's on screen (same filters,
search, sort, and — critically — the SAME MASKING the JSON response would
carry for that role); "every exported file carries a header block listing
the filters that produced it, the result count, who exported it, and when."

Callers build their already-filtered `rows` (as plain dicts, already passed
through whatever `apply_field_masking()` call the JSON path uses) and a
`ColumnSpec` list, then call `build_export()` — this module only owns the
header-block assembly and dispatch to pdf_engine/excel_engine, never touches
scope or masking itself, so a router can't accidentally export more than its
own JSON response already shows.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import User
from app.services import excel_engine, pdf_engine
from app.services.pdf_engine import ColumnSpec

ExportFormat = str  # "pdf" | "excel" — validated at the FastAPI Query layer by each router


def _format_filter_value(v: Any) -> str | None:
    if v is None or v == "" or v == []:
        return None
    if isinstance(v, (list, tuple)):
        return ", ".join(str(x) for x in v)
    return str(v)


def _header_lines(title: str, filters_applied: dict[str, Any], result_count: int, exported_by: str) -> list[str]:
    active = {k: _format_filter_value(v) for k, v in filters_applied.items()}
    active = {k: v for k, v in active.items() if v is not None}
    filters_line = "Filters: " + (", ".join(f"{k}={v}" for k, v in active.items()) if active else "none")
    now = datetime.now(timezone.utc).strftime("%d-%m-%Y %H:%M UTC")
    return [filters_line, f"Result count: {result_count}", f"Exported by {exported_by} on {now}"]


async def build_export(
    format: str,
    db: AsyncSession,
    current_user: User,
    title: str,
    columns: list[ColumnSpec],
    rows: list[dict],
    filters_applied: dict[str, Any],
) -> Response:
    if format not in ("pdf", "excel"):
        raise ValueError(f"Unknown export format: {format!r}")
    header_lines = _header_lines(title, filters_applied, len(rows), current_user.full_name)
    slug = "".join(c if c.isalnum() else "_" for c in title).strip("_") or "export"

    if format == "pdf":
        company, logo = await pdf_engine.company_logo_bytes(db)
        content = pdf_engine.render_table_pdf(title, columns, rows, header_lines, company, logo)
        return Response(
            content=content, media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{slug}.pdf"'},
        )
    content = excel_engine.render_excel(title, columns, rows, header_lines)
    return Response(
        content=content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{slug}.xlsx"'},
    )
