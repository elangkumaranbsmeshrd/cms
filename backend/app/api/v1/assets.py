"""Asset Management (03-asset-management-module.md) — Directory (§2.1),
Master Record (§2.2), Assign/Transfer/Unassign (§2.3), Maintenance (§2.4),
Depreciation (§2.5, computed live — see asset_engine.py), Asset Requests
(§2.6), Reports (§2.7), Reclaim on Exit (§2.8), plus Employee module's My
Assets (§2.9) self-service view.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.platform import StoredFile, User
from app.models.asset import Asset, AssetAssignmentHistory, AssetFile, AssetMaintenanceLog, AssetRequest
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.asset import (
    AssetAssignmentHistoryOut,
    AssetAssignRequest,
    AssetFileCreate,
    AssetFileOut,
    AssetLocationWrite,
    AssetMaintenanceOut,
    AssetMaintenanceWrite,
    AssetOut,
    AssetReclaimMarkReturnedRequest,
    AssetRequestOut,
    AssetRequestRejectRequest,
    AssetRequestWrite,
    AssetTransferRequest,
    AssetWrite,
)
from app.services import asset_engine, email_transport, exit_checklist_sync, list_export, org_scope, pdf_engine
from app.services.notify import notify
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["asset"])
DIRECTORY_SCREEN = "asset.directory"
MAINTENANCE_SCREEN = "asset.maintenance"
REQUESTS_SCREEN = "asset.requests"
REPORTS_SCREEN = "asset.reports"
RECLAIM_SCREEN = "asset.reclaim"

# §2.9: "Asset List ... using the same columns as the Directory table" — never
# Purchase/Current Value, matching the Directory's own masking (those two
# fields simply aren't in this column set, so a masked caller can't leak them
# through the export path either).
_ASSET_LIST_COLUMNS = [
    ColumnSpec("asset_tag", "Asset Tag"),
    ColumnSpec("name", "Name"),
    ColumnSpec("category", "Category"),
    ColumnSpec("status", "Status"),
    ColumnSpec("assigned_to", "Assigned To"),
]
_ASSET_REQUEST_COLUMNS = [
    ColumnSpec("asset", "Asset"),
    ColumnSpec("employee", "Employee"),
    ColumnSpec("request_type", "Type"),
    ColumnSpec("status", "Status"),
]
_MAINTENANCE_COLUMNS = [
    ColumnSpec("asset", "Asset"),
    ColumnSpec("log_date", "Date"),
    ColumnSpec("description", "Description"),
    ColumnSpec("cost", "Cost", align="left"),
    ColumnSpec("status", "Status"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


# Every endpoint below that calls _load_asset_out (or otherwise masks a dict
# by hand) MUST declare response_model=None on its route. FastAPI treats an
# undeclared response_model as "infer it from the return type annotation" —
# so a plain `-> AssetOut` (or `response_model=AssetOut` in the decorator)
# forces the masked dict back through AssetOut's own validation on the way
# OUT: a "hide"-mode field that was popped from the dict either resurrects as
# null (fields with a `= None` default) or 500s with "field required"
# (fields without one, e.g. useful_life_years/vendor_id/warranty_expiry/
# location_address_id/department_id/assigned_to/notes/serial_number/
# order_date/retired_date/retirement_reason — none of them default), and a
# "mask"-mode field (MASKED_PLACEHOLDER, a dict) always 500s against a
# non-dict-typed field. This is the same class of bug as the sharp edge on
# the way IN, just at the opposite end of the response.
def _load_asset_out(asset: Asset, perms: PermissionSet, fy_label: str | None = None) -> dict:
    out = AssetOut.model_validate(asset)
    current_value = asset_engine.calculate_current_value(
        asset.purchase_value, asset.useful_life_years, asset.purchase_date, date_type.today(), asset.depreciation_method,
    )
    out.current_value = current_value if current_value is not None else "Not available"
    # §2.5: Current Value is computed live "as of today", so the financial
    # year it is stated as of is simply the FY that contains today — the one
    # Masters flags is_current. The slot used to be published on every
    # response and populated by nothing, so a reader got a depreciated figure
    # with no period attached. Left null when there is no figure to label
    # (no Purchase Value -> "Not available") or when no FY is marked current.
    if isinstance(current_value, Decimal):
        out.value_as_of_fy_label = fy_label
    # §6.1/6.2: "Show Purchase Value to Manager" toggle OFF by default —
    # governs Purchase Value AND Current Value together (same Layer-3
    # masking pattern as Vendor/Customer in Phase 4).
    return apply_field_masking(out.model_dump(), perms)


async def _current_fy_label(db: AsyncSession) -> str | None:
    """The label of the FY that contains today, for value_as_of_fy_label.

    Deliberately non-raising (unlike numbering.get_current_financial_year,
    which 409s): a company that has not yet flagged a current FY must still
    be able to READ its asset records — the label is simply omitted.
    """
    from app.models.numbering import FinancialYear

    return (await db.execute(select(FinancialYear.label).where(FinancialYear.is_current.is_(True)))).scalars().first()


async def _validate_asset_references(db: AsyncSession, body: AssetWrite, *, include_assignment: bool) -> None:
    """Every foreign key the Details tab can set, checked before the write.

    Without this the FK rejection surfaced as an unhandled 500 on create: the
    row is written by db.flush() (and by the autoflush inside
    exit_checklist_sync), both of which run before the commit that
    _as_client_error guards, so the DBAPIError escaped the guard entirely.
    Checking up front also names the offending field instead of returning a
    generic "Rejected by a database constraint".
    """
    from app.models.employee import Employee
    from app.models.masters import AssetCategory, CompanyAddress, Department
    from app.models.vendor import Vendor

    checks = [
        (AssetCategory, body.category_id, "Category"),
        (Vendor, body.vendor_id, "Vendor"),
    ]
    # update_asset drops Location/Department/Assigned To before writing (§6.1
    # — they belong to the assign action, not this edit action), so they are
    # only checked where they are actually persisted.
    if include_assignment:
        checks += [
            (CompanyAddress, body.location_address_id, "Location"),
            (Department, body.department_id, "Department"),
            (Employee, body.assigned_to, "Assigned To"),
        ]
    for model, value, label in checks:
        if value is not None and await db.get(model, value) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{label} does not exist")


async def _assert_employee_exists(db: AsyncSession, employee_id: str) -> None:
    """Assign/Transfer used to hand an unknown employee id straight to the
    database. The FK rejection fired on the autoflush inside
    exit_checklist_sync (which SELECTs Asset), i.e. before any commit, and
    escaped as an unhandled 500 — the same class of miss as create_asset's.
    Same up-front check attendance.record_attendance already does.
    """
    from app.models.employee import Employee

    if await db.get(Employee, employee_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Employee not found")


async def _get_employee_user(db: AsyncSession, employee_id: str) -> str | None:
    from app.models.employee import Employee

    employee = await db.get(Employee, employee_id)
    return employee.user_id if employee else None


async def _validate_asset_dates(db: AsyncSession, body: AssetWrite, existing_id: str | None) -> None:
    if body.purchase_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Purchase Date cannot be in the future")
    if body.order_date is not None and body.order_date > body.purchase_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Order Date must be on or before Purchase Date")
    if body.warranty_expiry is not None and body.warranty_expiry <= body.purchase_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Warranty Expiry must be after Purchase Date")
    if body.purchase_value is not None and body.useful_life_years is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Useful Life (Years) is required when Purchase Value is provided")
    if body.serial_number:
        stmt = select(Asset.id).where(Asset.serial_number == body.serial_number)
        if existing_id:
            stmt = stmt.where(Asset.id != existing_id)
        if (await db.execute(stmt)).scalar_one_or_none() is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Serial Number is already in use by another asset")


# ================================================================= DIRECTORY
@router.get("/assets", response_model=None)
async def list_assets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN)),
    category_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    assigned_to: str | None = Query(None),
    location_address_id: str | None = Query(None),
    department_id: str | None = Query(None),
    purchase_date_from: date_type | None = Query(None),
    purchase_date_to: date_type | None = Query(None),
    order_date_from: date_type | None = Query(None),
    order_date_to: date_type | None = Query(None),
    warranty_expiry_from: date_type | None = Query(None),
    warranty_expiry_to: date_type | None = Query(None),
    purchase_value_min: Decimal | None = Query(None),
    purchase_value_max: Decimal | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AssetOut] | Response:
    stmt = select(Asset)
    if category_id:
        stmt = stmt.where(Asset.category_id == category_id)
    if status_filter:
        stmt = stmt.where(Asset.status.in_(status_filter))
    if location_address_id:
        stmt = stmt.where(Asset.location_address_id == location_address_id)
    if department_id:
        stmt = stmt.where(Asset.department_id == department_id)
    if purchase_date_from:
        stmt = stmt.where(Asset.purchase_date >= purchase_date_from)
    if purchase_date_to:
        stmt = stmt.where(Asset.purchase_date <= purchase_date_to)
    if order_date_from:
        stmt = stmt.where(Asset.order_date >= order_date_from)
    if order_date_to:
        stmt = stmt.where(Asset.order_date <= order_date_to)
    if warranty_expiry_from:
        stmt = stmt.where(Asset.warranty_expiry >= warranty_expiry_from)
    if warranty_expiry_to:
        stmt = stmt.where(Asset.warranty_expiry <= warranty_expiry_to)
    if purchase_value_min is not None:
        stmt = stmt.where(Asset.purchase_value >= purchase_value_min)
    if purchase_value_max is not None:
        stmt = stmt.where(Asset.purchase_value <= purchase_value_max)
    if search:
        stmt = stmt.where(or_(Asset.name.ilike(f"%{search}%"), Asset.asset_tag.ilike(f"%{search}%"), Asset.serial_number.ilike(f"%{search}%")))
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = stmt.where(Asset.assigned_to.in_(team_ids)) if team_ids else stmt.where(Asset.id.is_(None))
    elif assigned_to:
        stmt = stmt.where(Asset.assigned_to == assigned_to)
    rows = (await db.execute(stmt.order_by(Asset.name))).scalars().all()

    if format:
        from app.models.employee import Employee
        from app.models.masters import AssetCategory

        category_ids = {r.category_id for r in rows if r.category_id}
        categories = {
            c.id: c.name for c in (
                await db.execute(select(AssetCategory).where(AssetCategory.id.in_(category_ids)))
            ).scalars().all()
        } if category_ids else {}
        employee_ids = {r.assigned_to for r in rows if r.assigned_to}
        employees = {
            e.id: f"{e.first_name} {e.last_name or ''}".strip() for e in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            ).scalars().all()
        } if employee_ids else {}
        # §2.9: same Directory columns for every caller — Purchase/Current
        # Value are simply never in _ASSET_LIST_COLUMNS, so a Manager without
        # "Show Purchase Value" can't pull them out through this export path.
        export_rows = [
            {
                "asset_tag": r.asset_tag, "name": r.name, "category": categories.get(r.category_id, ""),
                "status": r.status, "assigned_to": employees.get(r.assigned_to, "") if r.assigned_to else "",
            }
            for r in rows
        ]
        filters_applied = {
            "category_id": category_id, "status": status_filter, "assigned_to": assigned_to,
            "location_address_id": location_address_id, "department_id": department_id,
            "purchase_date_from": purchase_date_from, "purchase_date_to": purchase_date_to,
            "order_date_from": order_date_from, "order_date_to": order_date_to,
            "warranty_expiry_from": warranty_expiry_from, "warranty_expiry_to": warranty_expiry_to,
            "purchase_value_min": purchase_value_min, "purchase_value_max": purchase_value_max, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Assets", _ASSET_LIST_COLUMNS, export_rows, filters_applied)

    fy_label = await _current_fy_label(db)
    return [_load_asset_out(row, perms, fy_label) for row in rows]


@router.post("/assets", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> dict:
    await _validate_asset_dates(db, body, existing_id=None)
    await _validate_asset_references(db, body, include_assignment=True)
    fy = await get_current_financial_year(db)
    code = await allocate_number(db, "AST", fy.id, fy.label)
    data = body.model_dump()
    assigned_to = data.pop("assigned_to")
    row = Asset(
        id=str(uuid.uuid4()), asset_tag=code, financial_year_id=fy.id, created_by=current_user.id, updated_by=current_user.id,
        status="IN_USE" if assigned_to else "IN_STORE", assigned_to=assigned_to, **data,
    )
    db.add(row)
    # The flush (and the autoflush inside sync_outstanding_assets) has to sit
    # INSIDE the guard: that is where the INSERT actually hits the database,
    # so a constraint rejection there used to escape as an unhandled 500
    # while the guard sat uselessly around the commit alone.
    try:
        await db.flush()
        if assigned_to is not None:
            db.add(AssetAssignmentHistory(
                id=str(uuid.uuid4()), asset_id=row.id, employee_id=assigned_to, from_date=date_type.today(),
                action="ASSIGNED", performed_by=current_user.id,
            ))
            await exit_checklist_sync.sync_outstanding_assets(db, assigned_to, current_user.id)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


async def _get_asset_scoped(db: AsyncSession, asset_id: str, perms: PermissionSet, current_user: User) -> Asset:
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        if asset.assigned_to not in team_ids:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
    return asset


@router.get("/assets/{asset_id}", response_model=None)
async def get_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN)),
) -> dict:
    asset = await _get_asset_scoped(db, asset_id, perms, current_user)
    return _load_asset_out(asset, perms, await _current_fy_label(db))


@router.get("/assets/{asset_id}/pdf")
async def download_asset_pdf(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN)),
) -> Response:
    """§2.9 Asset Card: "a single-page printable summary: Asset Tag, Name,
    Category, Assigned To, Purchase Date. Purchase Value and Current Value
    are included only for roles that can already see those fields." Reuses
    _load_asset_out's masking (and _get_asset_scoped's team-scope check) so
    this can never show a Manager more than the record's own JSON response
    already would.
    """
    from app.models.employee import Employee
    from app.models.masters import AssetCategory

    asset = await _get_asset_scoped(db, asset_id, perms, current_user)
    masked = _load_asset_out(asset, perms, await _current_fy_label(db))
    category = await db.get(AssetCategory, asset.category_id)
    assigned_employee = await db.get(Employee, asset.assigned_to) if asset.assigned_to else None
    assigned_name = f"{assigned_employee.first_name} {assigned_employee.last_name or ''}".strip() if assigned_employee else "Unassigned"

    core_rows = [
        ("Asset Tag", asset.asset_tag),
        ("Name", asset.name),
        ("Category", category.name if category else "—"),
        ("Assigned To", assigned_name),
        ("Purchase Date", str(asset.purchase_date)),
    ]
    # "hide" (the seeded default) pops the key entirely -> .get() is None ->
    # skipped. A "mask" mode (per-role/per-user override, still possible even
    # though "hide" is what's seeded) leaves MASKED_PLACEHOLDER behind rather
    # than the real figure — shown as "Masked", never formatted as money.
    pv = masked.get("purchase_value")
    if isinstance(pv, Decimal):
        core_rows.append(("Purchase Value", f"₹{pv:,.2f}"))
    elif pv is not None:
        core_rows.append(("Purchase Value", "Masked" if isinstance(pv, dict) else str(pv)))
    cv = masked.get("current_value")
    if isinstance(cv, Decimal):
        core_rows.append(("Current Value", f"₹{cv:,.2f}"))
    elif cv is not None:
        core_rows.append(("Current Value", "Masked" if isinstance(cv, dict) else str(cv)))

    company, logo = await pdf_engine.company_logo_bytes(db)
    content = pdf_engine.render_document_pdf(f"Asset Card — {asset.asset_tag}", company, [("Asset Details", core_rows)], logo)
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{asset.asset_tag}.pdf"'})


@router.put("/assets/{asset_id}", response_model=None)
async def update_asset(
    asset_id: str,
    body: AssetWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> dict:
    """§2.2: "Status and Assigned To are locked after creation... every
    change is captured in Assignment History" — this endpoint only ever
    touches the Details tab's Core Info + Purchase & Financial fields (§6.1),
    never Status/Assigned To, and never Location/Department either — those
    two live only under Assignment & Location (§6.1), edited exclusively via
    PUT /assets/{id}/location, which shares the 'assign' action (Super
    Admin + HR) rather than this 'edit' action (Super Admin + Accountant),
    so Accountant can never relocate an asset through this endpoint.
    """
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _validate_asset_dates(db, body, existing_id=asset_id)
    await _validate_asset_references(db, body, include_assignment=False)
    data = body.model_dump()
    data.pop("assigned_to", None)
    data.pop("location_address_id", None)
    data.pop("department_id", None)
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


@router.put("/assets/{asset_id}/location", response_model=None)
async def relocate_asset(
    asset_id: str,
    body: AssetLocationWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="assign")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.location_address_id = body.location_address_id
    row.department_id = body.department_id
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


@router.post("/assets/{asset_id}/retire", response_model=None)
async def retire_asset(
    asset_id: str,
    reason: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status == "RETIRED_DISPOSED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This asset is already Retired/Disposed")
    previously_held_by = row.assigned_to
    row.status = "RETIRED_DISPOSED"
    row.retired_date = date_type.today()
    row.retirement_reason = reason
    row.updated_by = current_user.id
    if previously_held_by is not None:
        await exit_checklist_sync.sync_outstanding_assets(db, previously_held_by, current_user.id)
    await db.commit()
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


# ================================================================ ATTACHMENTS
# §2.2's own disclosed gap, now closed: "Built at the storage layer, linking
# endpoint deferred" — the asset_files table and the shared /files upload
# endpoint (purpose asset_photo|asset_file) both already existed; only the
# link/list pair was missing. Same two-step pattern as Employee Documents
# (employee_documents.py): the caller uploads via POST /files first, then
# links the returned file id here — gated on the same 'edit' action as the
# rest of the Details tab (Accountant + Super Admin), per §2.2's own field
# table (Attachments sits under Core Info, §6.1).
async def _load_asset_file_out(db: AsyncSession, row: AssetFile) -> AssetFileOut:
    stored = await db.get(StoredFile, row.stored_file_id)
    return AssetFileOut(
        id=row.id, asset_id=row.asset_id, stored_file_id=row.stored_file_id,
        original_filename=stored.original_filename if stored else "", mime_type=stored.mime_type if stored else "",
        size_bytes=stored.size_bytes if stored else 0, created_by=row.created_by, created_at=row.created_at,
    )


async def _stored_files(db: AsyncSession, stored_file_ids: set[str]) -> dict[str, StoredFile]:
    """Batch StoredFile lookup for the file list — one `.in_()` query keyed
    in Python, the same shape as expenses.py's _employee_names/_vendor_names,
    instead of one db.get per attachment. A row whose StoredFile is missing
    simply isn't in the mapping, which is the same `stored is None` the
    per-row db.get returned — the blank name/type and zero size, never a
    KeyError and never a dropped attachment.
    """
    if not stored_file_ids:
        return {}
    rows = (await db.execute(select(StoredFile).where(StoredFile.id.in_(stored_file_ids)))).scalars().all()
    return {row.id: row for row in rows}


async def _load_asset_file_outs(db: AsyncSession, files: list[AssetFile]) -> list[AssetFileOut]:
    """List counterpart to _load_asset_file_out: 1 query in TOTAL rather
    than 1 per attachment.
    """
    stored_by_id = await _stored_files(db, {f.stored_file_id for f in files})
    outs = []
    for row in files:
        stored = stored_by_id.get(row.stored_file_id)
        outs.append(
            AssetFileOut(
                id=row.id, asset_id=row.asset_id, stored_file_id=row.stored_file_id,
                original_filename=stored.original_filename if stored else "", mime_type=stored.mime_type if stored else "",
                size_bytes=stored.size_bytes if stored else 0, created_by=row.created_by, created_at=row.created_at,
            )
        )
    return outs


@router.get("/assets/{asset_id}/files", response_model=None)
async def list_asset_files(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN)),
) -> list[AssetFileOut]:
    await _get_asset_scoped(db, asset_id, perms, current_user)
    rows = (await db.execute(select(AssetFile).where(AssetFile.asset_id == asset_id).order_by(AssetFile.created_at.desc()))).scalars().all()
    return await _load_asset_file_outs(db, list(rows))


@router.post("/assets/{asset_id}/files", response_model=AssetFileOut, status_code=status.HTTP_201_CREATED)
async def attach_asset_file(
    asset_id: str,
    body: AssetFileCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> AssetFileOut:
    if await db.get(Asset, asset_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if await db.get(StoredFile, body.stored_file_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Upload the file first via POST /files")
    row = AssetFile(id=str(uuid.uuid4()), asset_id=asset_id, stored_file_id=body.stored_file_id, created_by=current_user.id, updated_by=current_user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await _load_asset_file_out(db, row)


@router.delete("/assets/{asset_id}/files/{file_link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_asset_file(
    asset_id: str,
    file_link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> None:
    row = await db.get(AssetFile, file_link_id)
    if row is None or row.asset_id != asset_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    await db.delete(row)
    await db.commit()


# ================================================ ASSIGN / TRANSFER / UNASSIGN
@router.post("/assets/{asset_id}/assign", response_model=None)
async def assign_asset(
    asset_id: str,
    body: AssetAssignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="assign")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "IN_STORE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Assign is only available when Status is In Store")
    await _assert_employee_exists(db, body.employee_id)
    row.status = "IN_USE"
    row.assigned_to = body.employee_id
    row.updated_by = current_user.id
    db.add(AssetAssignmentHistory(
        id=str(uuid.uuid4()), asset_id=asset_id, employee_id=body.employee_id, from_date=body.effective_date or date_type.today(),
        action="ASSIGNED", performed_by=current_user.id,
    ))
    try:
        await exit_checklist_sync.sync_outstanding_assets(db, body.employee_id, current_user.id)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


@router.post("/assets/{asset_id}/transfer", response_model=None)
async def transfer_asset(
    asset_id: str,
    body: AssetTransferRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="assign")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "IN_USE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Transfer is only available when Status is In Use")
    await _assert_employee_exists(db, body.employee_id)
    effective = body.effective_date or date_type.today()
    previous_employee = row.assigned_to
    for hist in (
        await db.execute(select(AssetAssignmentHistory).where(AssetAssignmentHistory.asset_id == asset_id, AssetAssignmentHistory.to_date.is_(None)))
    ).scalars():
        hist.to_date = effective
    row.assigned_to = body.employee_id
    row.updated_by = current_user.id
    db.add(AssetAssignmentHistory(
        id=str(uuid.uuid4()), asset_id=asset_id, employee_id=body.employee_id, from_date=effective,
        action="TRANSFERRED", performed_by=current_user.id, reason=body.reason,
    ))
    try:
        if previous_employee is not None:
            await exit_checklist_sync.sync_outstanding_assets(db, previous_employee, current_user.id)
        await exit_checklist_sync.sync_outstanding_assets(db, body.employee_id, current_user.id)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


async def _unassign(db: AsyncSession, row: Asset, actor_user_id: str) -> None:
    """§2.3: each action "adds one row to the Assignment History tab" — one,
    not one per open row.

    This used to create the new UNASSIGNED row INSIDE the loop that closes
    the open ones, and to leave that new row's To Date null. Since nothing
    ever closes an UNASSIGNED row, every cycle left one more permanently-open
    row behind, and the next unassign then emitted one UNASSIGNED row per
    open row — N assign/unassign cycles produced N*(N+1)/2 UNASSIGNED rows
    instead of N, so the history read as several hand-backs for a single
    hand-back. The stale open rows also matched the `to_date IS NULL` lookup
    behind GET /employees/me/assets' assigned-date filter.

    Now: close every open holding row, then add exactly one UNASSIGNED row
    for the employee who actually held the asset, already closed — it records
    the moment of return, not an ongoing holding, so it must never sit open.
    """
    today = date_type.today()
    held_by = row.assigned_to
    # Status/assigned_to must flip BEFORE the sync call below — it recounts
    # this employee's IN_USE assets, and this asset needs to already read as
    # no-longer-theirs for the count to be correct (was a real bug: the sync
    # originally ran inside the loop, before this asset's own state changed).
    row.status = "IN_STORE"
    row.assigned_to = None
    row.updated_by = actor_user_id
    affected: list[str] = []
    for hist in (
        await db.execute(select(AssetAssignmentHistory).where(AssetAssignmentHistory.asset_id == row.id, AssetAssignmentHistory.to_date.is_(None)))
    ).scalars():
        hist.to_date = today
        if hist.employee_id not in affected:
            affected.append(hist.employee_id)
    # Falls back to the open history rows only when Assigned To is somehow
    # already blank, so an inconsistent record still logs its hand-back.
    returning = [held_by] if held_by is not None else affected
    for employee_id in returning:
        db.add(AssetAssignmentHistory(
            id=str(uuid.uuid4()), asset_id=row.id, employee_id=employee_id, from_date=today, to_date=today,
            action="UNASSIGNED", performed_by=actor_user_id,
        ))
    # Every employee whose holdings changed gets re-synced, including the one
    # named on the asset even if no open history row mentioned them.
    to_sync = list(affected)
    if held_by is not None and held_by not in to_sync:
        to_sync.append(held_by)
    for employee_id in to_sync:
        await exit_checklist_sync.sync_outstanding_assets(db, employee_id, actor_user_id)


@router.post("/assets/{asset_id}/unassign", response_model=None)
async def unassign_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="assign")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "IN_USE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Unassign is only available when Status is In Use")
    await _unassign(db, row, current_user.id)
    await db.commit()
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


@router.get("/assets/{asset_id}/assignment-history", response_model=list[AssetAssignmentHistoryOut])
async def assignment_history(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN)),
) -> list[AssetAssignmentHistory]:
    await _get_asset_scoped(db, asset_id, perms, current_user)
    return list(
        (await db.execute(select(AssetAssignmentHistory).where(AssetAssignmentHistory.asset_id == asset_id).order_by(AssetAssignmentHistory.from_date.desc())))
        .scalars().all()
    )


# =============================================================== MAINTENANCE
def _maintenance_status(next_due_date: date_type | None, today: date_type) -> str:
    if next_due_date is None:
        return "COMPLETED"
    return "OVERDUE" if next_due_date < today else "UPCOMING"


def _load_maintenance_out(row: AssetMaintenanceLog, today: date_type) -> AssetMaintenanceOut:
    out = AssetMaintenanceOut.model_validate(row)
    out.maintenance_status = _maintenance_status(row.next_due_date, today)
    return out


@router.get("/assets/{asset_id}/maintenance", response_model=None)
async def list_asset_maintenance(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MAINTENANCE_SCREEN)),
) -> list[dict]:
    # Reuses Directory's own team-scope check — a Manager's 'view_team' mode
    # means the same thing here as it does on the Directory (their direct
    # reports' assets only), and the helper is generic over which screen's
    # PermissionSet is passed in.
    await _get_asset_scoped(db, asset_id, perms, current_user)
    today = date_type.today()
    rows = (await db.execute(select(AssetMaintenanceLog).where(AssetMaintenanceLog.asset_id == asset_id).order_by(AssetMaintenanceLog.log_date.desc()))).scalars().all()
    # This screen previously returned AssetMaintenanceOut objects straight
    # through, unmasked (e.g. Cost, §2.4) — MAINTENANCE_SCREEN's own
    # PermissionSet (already injected above) was never applied to it.
    # response_model=None (was list[AssetMaintenanceOut]) so masking survives
    # the trip out, same reasoning as _load_asset_out's endpoints above.
    return [apply_field_masking(_load_maintenance_out(r, today).model_dump(), perms) for r in rows]


@router.post("/assets/{asset_id}/maintenance", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_maintenance(
    asset_id: str,
    body: AssetMaintenanceWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MAINTENANCE_SCREEN, action="edit")),
) -> dict:
    asset = await db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Asset not found")
    # Retired/Disposed "has no further action after it" (Section 4) — Assign
    # already 409s on it, but Maintenance had no guard at all, so a log with a
    # future Next Due Date could be booked against a disposed asset and then
    # showed up under "due soon" in the §2.7 report.
    if asset.status == "RETIRED_DISPOSED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This asset is Retired/Disposed — no further maintenance can be logged against it")
    row = AssetMaintenanceLog(id=str(uuid.uuid4()), asset_id=asset_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    # A hidden field must be absent from the create response too (§3.2), not
    # just from later GETs — same MASTER-BUILD-PROMPT rule the other
    # single-record endpoints in this file already follow.
    return apply_field_masking(_load_maintenance_out(row, date_type.today()).model_dump(), perms)


@router.put("/assets/{asset_id}/maintenance/{log_id}", response_model=None)
async def update_maintenance(
    asset_id: str,
    log_id: str,
    body: AssetMaintenanceWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MAINTENANCE_SCREEN, action="edit")),
) -> dict:
    """§2.4's own disclosed gap, now closed: "add and edit entries" was only
    ever half-built (add only) — this is the missing update, same edit-action
    guard (Accountant + Super Admin) as add_maintenance above. Exists
    specifically so a system-generated entry (created by an approved Repair/
    Damage request, §2.6, with Cost/Next Due Date left blank) can actually be
    filled in later, which is the concrete case §2.4's own text names.
    """
    row = await db.get(AssetMaintenanceLog, log_id)
    if row is None or row.asset_id != asset_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Maintenance entry not found")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return apply_field_masking(_load_maintenance_out(row, date_type.today()).model_dump(), perms)


@router.get("/maintenance", response_model=None)
async def list_all_maintenance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MAINTENANCE_SCREEN)),
    asset_id: str | None = Query(None),
    category_id: str | None = Query(None),
    location_address_id: str | None = Query(None),
    serviced_by_vendor_id: str | None = Query(None),
    service_date_from: date_type | None = Query(None),
    service_date_to: date_type | None = Query(None),
    next_due_from: date_type | None = Query(None),
    next_due_to: date_type | None = Query(None),
    cost_min: Decimal | None = Query(None),
    cost_max: Decimal | None = Query(None),
    overdue_only: bool | None = Query(None),
    upcoming_only: bool | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AssetMaintenanceOut] | Response:
    stmt = select(AssetMaintenanceLog)
    if asset_id:
        stmt = stmt.where(AssetMaintenanceLog.asset_id == asset_id)
    if serviced_by_vendor_id:
        stmt = stmt.where(AssetMaintenanceLog.serviced_by_vendor_id == serviced_by_vendor_id)
    if service_date_from:
        stmt = stmt.where(AssetMaintenanceLog.log_date >= service_date_from)
    if service_date_to:
        stmt = stmt.where(AssetMaintenanceLog.log_date <= service_date_to)
    if next_due_from:
        stmt = stmt.where(AssetMaintenanceLog.next_due_date >= next_due_from)
    if next_due_to:
        stmt = stmt.where(AssetMaintenanceLog.next_due_date <= next_due_to)
    if cost_min is not None:
        stmt = stmt.where(AssetMaintenanceLog.cost >= cost_min)
    if cost_max is not None:
        stmt = stmt.where(AssetMaintenanceLog.cost <= cost_max)
    if search:
        stmt = stmt.where(AssetMaintenanceLog.description.ilike(f"%{search}%"))
    if category_id or location_address_id or search:
        stmt = stmt.join(Asset, Asset.id == AssetMaintenanceLog.asset_id)
        if category_id:
            stmt = stmt.where(Asset.category_id == category_id)
        if location_address_id:
            stmt = stmt.where(Asset.location_address_id == location_address_id)
        if search:
            stmt = stmt.where(or_(AssetMaintenanceLog.description.ilike(f"%{search}%"), Asset.name.ilike(f"%{search}%"), Asset.asset_tag.ilike(f"%{search}%")))
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        asset_ids = (await db.execute(select(Asset.id).where(Asset.assigned_to.in_(team_ids)))).scalars().all() if team_ids else []
        stmt = stmt.where(AssetMaintenanceLog.asset_id.in_(asset_ids)) if asset_ids else stmt.where(AssetMaintenanceLog.id.is_(None))
    rows = (await db.execute(stmt.order_by(AssetMaintenanceLog.log_date.desc()))).scalars().all()
    today = date_type.today()
    if overdue_only:
        rows = [r for r in rows if r.next_due_date is not None and r.next_due_date < today]
    if upcoming_only:
        rows = [r for r in rows if r.next_due_date is not None and today <= r.next_due_date]
    # Kept as AssetMaintenanceOut objects (not masked dicts) through this
    # point on purpose — the export branch below reads out.maintenance_status
    # off them directly, and per the ground rules that branch is untouched.
    # Masking is applied only at the very end, on the JSON-response path.
    out_rows = [_load_maintenance_out(r, today) for r in rows]

    if format:
        asset_ids = {r.asset_id for r in rows}
        assets_by_id = {
            a.id: a for a in (
                await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))
            ).scalars().all()
        } if asset_ids else {}
        export_rows = [
            {
                "asset": f"{assets_by_id[r.asset_id].name} ({assets_by_id[r.asset_id].asset_tag})" if r.asset_id in assets_by_id else "",
                "log_date": r.log_date, "description": r.description, "cost": r.cost, "status": out.maintenance_status,
            }
            for r, out in zip(rows, out_rows)
        ]
        filters_applied = {
            "asset_id": asset_id, "category_id": category_id, "location_address_id": location_address_id,
            "serviced_by_vendor_id": serviced_by_vendor_id, "service_date_from": service_date_from, "service_date_to": service_date_to,
            "next_due_from": next_due_from, "next_due_to": next_due_to, "cost_min": cost_min, "cost_max": cost_max,
            "overdue_only": overdue_only, "upcoming_only": upcoming_only, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Asset Maintenance", _MAINTENANCE_COLUMNS, export_rows, filters_applied)

    # This endpoint never masked its rows before (Cost/etc. went straight
    # out) — masked here, after the export branch, same as list_asset_maintenance.
    return [apply_field_masking(o.model_dump(), perms) for o in out_rows]


# =============================================================== REQUESTS
@router.get("/asset-requests", response_model=None)
async def list_asset_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(REQUESTS_SCREEN)),
    status_filter: list[str] | None = Query(None, alias="status"),
    request_type: str | None = Query(None),
    employee_id: str | None = Query(None),
    approved_by: str | None = Query(None),
    category_id: str | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AssetRequestOut] | Response:
    stmt = select(AssetRequest)
    if status_filter:
        stmt = stmt.where(AssetRequest.status.in_(status_filter))
    if request_type:
        stmt = stmt.where(AssetRequest.request_type == request_type)
    if employee_id:
        stmt = stmt.where(AssetRequest.employee_id == employee_id)
    if approved_by:
        stmt = stmt.where(AssetRequest.approved_by == approved_by)
    if date_from:
        stmt = stmt.where(AssetRequest.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AssetRequest.created_at <= date_to)
    if category_id or search:
        stmt = stmt.join(Asset, Asset.id == AssetRequest.asset_id)
        if category_id:
            stmt = stmt.where(Asset.category_id == category_id)
        if search:
            stmt = stmt.where(or_(AssetRequest.description.ilike(f"%{search}%"), Asset.name.ilike(f"%{search}%"), Asset.asset_tag.ilike(f"%{search}%")))
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = stmt.where(AssetRequest.employee_id.in_(team_ids)) if team_ids else stmt.where(AssetRequest.id.is_(None))
    rows = (await db.execute(stmt.order_by(AssetRequest.created_at.desc()))).scalars().all()

    if format:
        from app.models.employee import Employee

        asset_ids = {r.asset_id for r in rows}
        assets_by_id = {
            a.id: a for a in (
                await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))
            ).scalars().all()
        } if asset_ids else {}
        employee_ids = {r.employee_id for r in rows}
        employees = {
            e.id: f"{e.first_name} {e.last_name or ''}".strip() for e in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            ).scalars().all()
        } if employee_ids else {}
        export_rows = [
            {
                "asset": f"{assets_by_id[r.asset_id].name} ({assets_by_id[r.asset_id].asset_tag})" if r.asset_id in assets_by_id else "",
                "employee": employees.get(r.employee_id, ""), "request_type": r.request_type, "status": r.status,
            }
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "request_type": request_type, "employee_id": employee_id, "approved_by": approved_by,
            "category_id": category_id, "date_from": date_from, "date_to": date_to, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Asset Requests", _ASSET_REQUEST_COLUMNS, export_rows, filters_applied)

    # Previously returned AssetRequestOut objects straight through, unmasked
    # (e.g. approved_by/rejection_reason) — response_model=None on this route
    # was already set, but nothing here actually called apply_field_masking.
    return [apply_field_masking(AssetRequestOut.model_validate(r).model_dump(), perms) for r in rows]


@router.post("/asset-requests/{request_id}/approve", response_model=None)
async def approve_asset_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(REQUESTS_SCREEN, action="approve")),
) -> dict:
    req = await db.get(AssetRequest, request_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, req.employee_id)
    if req.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending request can be approved")
    asset = await db.get(Asset, req.asset_id)
    req.status = "APPROVED"
    req.approved_by = current_user.id
    req.approved_at = datetime.now(timezone.utc)
    req.updated_by = current_user.id

    if req.request_type == "RETURN":
        await _unassign(db, asset, current_user.id)
    elif req.request_type in ("REPAIR", "DAMAGE_REPORT"):
        # §2.6: Damage Report treated the same as Repair — Status -> Under
        # Repair + an auto-created Maintenance entry (Assumption, flagged in
        # the spec itself; the brief only specifies this for Repair).
        asset.status = "UNDER_REPAIR"
        asset.updated_by = current_user.id
        db.add(AssetMaintenanceLog(
            id=str(uuid.uuid4()), asset_id=asset.id, log_date=date_type.today(), description=req.description,
            is_system_generated=True, source_request_id=req.id, created_by=current_user.id, updated_by=current_user.id,
        ))

    recipient = await _get_employee_user(db, req.employee_id)
    notify(db, recipient_user_id=recipient, notification_type="ASSET", actor_user_id=current_user.id,
           title="Asset request approved", body=f"Your {req.request_type.replace('_', ' ').title()} request has been approved.",
           source_module="asset", source_record_id=req.id)
    await db.commit()
    await db.refresh(req)

    # Independent of notify() above (Invariant 12) — sent after the main
    # commit, same "commit main state, then side-effect actions" pattern.
    from app.models.employee import Employee

    employee = await db.get(Employee, req.employee_id)
    if employee is not None:
        await email_transport.send_templated_email(
            db, "asset_request_approved", employee.email,
            {"first_name": employee.first_name, "asset_name": asset.name if asset else ""},
            related_record_type="asset_request", related_record_id=req.id,
        )
    # response_model was AssetRequestOut (strict schema) — changed to None so
    # this masked dict survives the trip out (§3.2 applies to action-endpoint
    # responses too, not just plain GETs).
    return apply_field_masking(AssetRequestOut.model_validate(req).model_dump(), perms)


@router.post("/asset-requests/{request_id}/reject", response_model=None)
async def reject_asset_request(
    request_id: str,
    body: AssetRequestRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(REQUESTS_SCREEN, action="approve")),
) -> dict:
    req = await db.get(AssetRequest, request_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, req.employee_id)
    if req.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending request can be rejected")
    asset = await db.get(Asset, req.asset_id)
    req.status = "REJECTED"
    req.rejection_reason = body.rejection_reason
    req.updated_by = current_user.id

    recipient = await _get_employee_user(db, req.employee_id)
    notify(db, recipient_user_id=recipient, notification_type="ASSET", actor_user_id=current_user.id,
           title="Asset request rejected", body=f"Your {req.request_type.replace('_', ' ').title()} request was rejected: {body.rejection_reason}",
           source_module="asset", source_record_id=req.id)
    await db.commit()
    await db.refresh(req)

    from app.models.employee import Employee

    employee = await db.get(Employee, req.employee_id)
    if employee is not None:
        await email_transport.send_templated_email(
            db, "asset_request_rejected", employee.email,
            {"first_name": employee.first_name, "asset_name": asset.name if asset else ""},
            related_record_type="asset_request", related_record_id=req.id,
        )
    return apply_field_masking(AssetRequestOut.model_validate(req).model_dump(), perms)


# ================================================================== REPORTS
@router.get("/assets/reports/summary", response_model=None)
async def asset_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(REPORTS_SCREEN)),
    category_id: str | None = Query(None),
    location_address_id: str | None = Query(None),
    department_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    assigned_to: str | None = Query(None),
    purchase_date_from: date_type | None = Query(None),
    purchase_date_to: date_type | None = Query(None),
    purchase_value_min: Decimal | None = Query(None),
    purchase_value_max: Decimal | None = Query(None),
    due_soon_days: int = Query(30),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response. Exports the By-Category breakdown, this report's only flat-row shape"),
) -> dict | Response:
    stmt = select(Asset)
    if category_id:
        stmt = stmt.where(Asset.category_id == category_id)
    if location_address_id:
        stmt = stmt.where(Asset.location_address_id == location_address_id)
    if department_id:
        stmt = stmt.where(Asset.department_id == department_id)
    if status_filter:
        stmt = stmt.where(Asset.status.in_(status_filter))
    if assigned_to:
        stmt = stmt.where(Asset.assigned_to == assigned_to)
    if purchase_date_from:
        stmt = stmt.where(Asset.purchase_date >= purchase_date_from)
    if purchase_date_to:
        stmt = stmt.where(Asset.purchase_date <= purchase_date_to)
    if purchase_value_min is not None:
        stmt = stmt.where(Asset.purchase_value >= purchase_value_min)
    if purchase_value_max is not None:
        stmt = stmt.where(Asset.purchase_value <= purchase_value_max)
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = stmt.where(Asset.assigned_to.in_(team_ids)) if team_ids else stmt.where(Asset.id.is_(None))
    rows = (await db.execute(stmt)).scalars().all()
    today = date_type.today()

    # §6.2: value figures hidden from Manager by default (same "Show
    # Purchase Value to Manager" toggle governing Directory/Reports/Downloads
    # together). This report's per-category shape doesn't flow through
    # apply_field_masking (different key names), so it's checked directly —
    # via the resolved Layer-3 field_mode, not perms.mode, so a per-person
    # override ("Show Purchase Value" turned on just for one Manager, §6.5)
    # is respected here exactly like every other Asset-returning endpoint.
    can_see_value = perms.field_mode("purchase_value") == "show"
    by_category: dict[str, dict] = {}
    for r in rows:
        entry = by_category.setdefault(r.category_id, {"count": 0, "total_purchase_value": Decimal("0"), "total_current_value": Decimal("0")})
        entry["count"] += 1
        if r.purchase_value:
            entry["total_purchase_value"] += r.purchase_value
        cv = asset_engine.calculate_current_value(r.purchase_value, r.useful_life_years, r.purchase_date, today, r.depreciation_method)
        if cv:
            entry["total_current_value"] += cv

    # §2.7 "Warranty or maintenance due soon" — 30-day default window,
    # adjustable via due_soon_days.
    # A Retired/Disposed asset is never work outstanding — it is already
    # reported, by status, in this same response's retired_assets list, and
    # "no further action after it" (Section 4) is the whole meaning of that
    # status. Listing it under "due soon" double-counted it and overstated
    # the upcoming workload. The user-facing filters above still apply to all
    # three views identically; this is a status-of-record exclusion, not a
    # filter, so switching view never changes the filtered set.
    due_soon = []
    for r in rows:
        if r.status == "RETIRED_DISPOSED":
            continue
        warranty_days = asset_engine.days_until(r.warranty_expiry, today)
        warranty_due = warranty_days is not None and 0 <= warranty_days <= due_soon_days
        next_due_dates = (
            await db.execute(select(AssetMaintenanceLog.next_due_date).where(AssetMaintenanceLog.asset_id == r.id, AssetMaintenanceLog.next_due_date.is_not(None)))
        ).scalars().all()
        maintenance_due = any(0 <= asset_engine.days_until(d, today) <= due_soon_days for d in next_due_dates)
        if warranty_due or maintenance_due:
            due_soon.append({
                "id": r.id, "asset_tag": r.asset_tag, "name": r.name,
                "warranty_expiry": r.warranty_expiry if warranty_due else None,
                "maintenance_next_due": min((d for d in next_due_dates if 0 <= asset_engine.days_until(d, today) <= due_soon_days), default=None) if maintenance_due else None,
            })
    retired = [r for r in rows if r.status == "RETIRED_DISPOSED"]

    result = {
        "count_and_value_by_category": [
            {"category_id": cat, **({k: v for k, v in vals.items()} if can_see_value else {"count": vals["count"]})}
            for cat, vals in by_category.items()
        ],
        "due_soon": due_soon,
        "due_soon_count": len(due_soon),
        "retired_count": len(retired),
        "retired_assets": [{"id": r.id, "asset_tag": r.asset_tag, "name": r.name, "retired_date": r.retired_date} for r in retired],
    }

    if format:
        # This report's overall shape (due_soon / retired_assets / the
        # by-category breakdown, each a different row shape) doesn't reduce
        # to one flat table — the by-category breakdown is the one part of
        # it that's genuinely a row set, so that's what's exported here,
        # same can_see_value gate as the JSON response above.
        from app.models.masters import AssetCategory

        cat_ids = {entry["category_id"] for entry in result["count_and_value_by_category"] if entry.get("category_id")}
        categories = {
            c.id: c.name for c in (
                await db.execute(select(AssetCategory).where(AssetCategory.id.in_(cat_ids)))
            ).scalars().all()
        } if cat_ids else {}
        if can_see_value:
            columns = [
                ColumnSpec("category", "Category"),
                ColumnSpec("count", "Count", align="right"),
                ColumnSpec("total_purchase_value", "Total Purchase Value", align="left"),
                ColumnSpec("total_current_value", "Total Current Value", align="left"),
            ]
            export_rows = [
                {
                    "category": categories.get(entry["category_id"], entry["category_id"]), "count": entry["count"],
                    "total_purchase_value": entry["total_purchase_value"], "total_current_value": entry["total_current_value"],
                }
                for entry in result["count_and_value_by_category"]
            ]
        else:
            columns = [ColumnSpec("category", "Category"), ColumnSpec("count", "Count", align="right")]
            export_rows = [
                {"category": categories.get(entry["category_id"], entry["category_id"]), "count": entry["count"]}
                for entry in result["count_and_value_by_category"]
            ]
        filters_applied = {
            "category_id": category_id, "location_address_id": location_address_id, "department_id": department_id,
            "status": status_filter, "assigned_to": assigned_to, "purchase_date_from": purchase_date_from,
            "purchase_date_to": purchase_date_to, "purchase_value_min": purchase_value_min, "purchase_value_max": purchase_value_max,
            "due_soon_days": due_soon_days,
        }
        return await list_export.build_export(format, db, current_user, "Asset Reports — By Category", columns, export_rows, filters_applied)

    return result


# ============================================================ RECLAIM ON EXIT
@router.get("/employees/{employee_id}/reclaim-assets", response_model=None)
async def reclaim_list(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(RECLAIM_SCREEN)),
) -> list[dict]:
    rows = (await db.execute(select(Asset).where(Asset.assigned_to == employee_id, Asset.status == "IN_USE"))).scalars().all()
    fy_label = await _current_fy_label(db)
    return [_load_asset_out(row, perms, fy_label) for row in rows]


@router.post("/assets/{asset_id}/reclaim", response_model=None)
async def reclaim_mark_returned(
    asset_id: str,
    body: AssetReclaimMarkReturnedRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(RECLAIM_SCREEN, action="mark_returned")),
) -> dict:
    row = await db.get(Asset, asset_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "IN_USE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This asset is not currently assigned")
    held_by = row.assigned_to
    if body.working_condition:
        await _unassign(db, row, current_user.id)
    else:
        for hist in (
            await db.execute(select(AssetAssignmentHistory).where(AssetAssignmentHistory.asset_id == asset_id, AssetAssignmentHistory.to_date.is_(None)))
        ).scalars():
            hist.to_date = date_type.today()
        row.status = "RETIRED_DISPOSED"
        row.retired_date = date_type.today()
        row.retirement_reason = body.reason
        row.assigned_to = None
        row.updated_by = current_user.id
        await exit_checklist_sync.sync_outstanding_assets(db, held_by, current_user.id)
    await db.commit()
    await db.refresh(row)
    return _load_asset_out(row, perms, await _current_fy_label(db))


# ============================================================= MY ASSETS
@router.get("/employees/me/assets", response_model=None)
async def my_assets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_assets")),
    category_id: str | None = Query(None),
    assigned_date_from: date_type | None = Query(None),
    assigned_date_to: date_type | None = Query(None),
    search: str | None = Query(None),
) -> list[dict]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    stmt = select(Asset).where(Asset.assigned_to == own_id)
    if category_id:
        stmt = stmt.where(Asset.category_id == category_id)
    if search:
        stmt = stmt.where(or_(Asset.name.ilike(f"%{search}%"), Asset.asset_tag.ilike(f"%{search}%")))
    rows = (await db.execute(stmt)).scalars().all()
    if assigned_date_from or assigned_date_to:
        history_from = (
            await db.execute(
                select(AssetAssignmentHistory.asset_id, AssetAssignmentHistory.from_date)
                .where(AssetAssignmentHistory.employee_id == own_id, AssetAssignmentHistory.to_date.is_(None))
            )
        ).all()
        eligible = {
            aid for aid, from_date in history_from
            if (assigned_date_from is None or from_date >= assigned_date_from) and (assigned_date_to is None or from_date <= assigned_date_to)
        }
        rows = [r for r in rows if r.id in eligible]
    fy_label = await _current_fy_label(db)
    return [_load_asset_out(row, perms, fy_label) for row in rows]


@router.get("/employees/me/asset-requests", response_model=None)
async def my_asset_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_assets")),
    request_type: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
) -> list[dict]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    stmt = select(AssetRequest).where(AssetRequest.employee_id == own_id)
    if request_type:
        stmt = stmt.where(AssetRequest.request_type == request_type)
    if status_filter:
        stmt = stmt.where(AssetRequest.status.in_(status_filter))
    if date_from:
        stmt = stmt.where(AssetRequest.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AssetRequest.created_at <= date_to)
    rows = (await db.execute(stmt.order_by(AssetRequest.created_at.desc()))).scalars().all()
    return [apply_field_masking(AssetRequestOut.model_validate(r).model_dump(), perms) for r in rows]


@router.post("/employees/me/asset-requests", response_model=None, status_code=status.HTTP_201_CREATED)
async def raise_asset_request(
    body: AssetRequestWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_assets", action="raise_request")),
) -> dict:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    asset = await db.get(Asset, body.asset_id)
    if asset is None or asset.assigned_to != own_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Asset must be one of your currently assigned assets")
    row = AssetRequest(id=str(uuid.uuid4()), employee_id=own_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return apply_field_masking(AssetRequestOut.model_validate(row).model_dump(), perms)
