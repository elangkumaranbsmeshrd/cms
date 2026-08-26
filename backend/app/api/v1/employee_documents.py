"""Employee §2.6 Documents. Scope in the seeded policy (app/seed.py) is
'own' for Manager/Accountant/Employee — everyone sees only their own
documents by default — and 'full' for HR/Super Admin, who additionally get
the cross-employee verification queue. Delete is role-differentiated (an
employee may withdraw only a still-Pending upload of their own; HR/Super
Admin may always remove one) — an RBAC/API distinction, not a DB invariant,
per the migration's own note on this table.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Employee, EmployeeDocument
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.employee import DocumentOut, DocumentUpload, DocumentVerifyDecision
from app.services import email_transport, list_export, org_scope
from app.services.notify import notify
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["employee"])
SCREEN = "employee.documents"

_LIST_COLUMNS = [
    ColumnSpec("employee_name", "Employee Name"),
    ColumnSpec("document_type", "Document Type"),
    ColumnSpec("status", "Status"),
    ColumnSpec("uploaded_at", "Uploaded On"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


@router.get("/employees/{employee_id}/documents", response_model=list[DocumentOut])
async def list_employee_documents(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[EmployeeDocument]:
    if perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        if own_id != employee_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only view your own documents")
    rows = (await db.execute(select(EmployeeDocument).where(EmployeeDocument.employee_id == employee_id))).scalars().all()
    return list(rows)


@router.post("/employees/{employee_id}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    employee_id: str,
    body: DocumentUpload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="upload")),
) -> EmployeeDocument:
    if perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        if own_id != employee_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only upload your own documents")

    row = EmployeeDocument(
        id=str(uuid.uuid4()), employee_id=employee_id, uploaded_at=datetime.now(timezone.utc),
        uploaded_by_user_id=current_user.id, source="EMPLOYEE_UPLOAD" if perms.mode == "own" else "HR_UPLOAD",
        created_by=current_user.id, updated_by=current_user.id, **body.model_dump(),
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.delete("/employees/{employee_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    employee_id: str,
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> None:
    row = await db.get(EmployeeDocument, document_id)
    if row is None or row.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        if own_id != employee_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only remove your own documents")
        if row.status != "PENDING_VERIFICATION":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending document may be withdrawn — it has already been reviewed")
    await db.delete(row)
    await db.commit()


@router.get("/documents/verification-queue", response_model=None)
async def verification_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="verify")),
    status_filter: str | None = Query("PENDING_VERIFICATION", alias="status"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[DocumentOut] | Response:
    stmt = select(EmployeeDocument)
    if status_filter:
        stmt = stmt.where(EmployeeDocument.status == status_filter)
    rows = list((await db.execute(stmt)).scalars().all())

    if format:
        export_rows = []
        for row in rows:
            employee = await db.get(Employee, row.employee_id)
            employee_name = f"{employee.first_name} {employee.last_name or ''}".strip() if employee else row.employee_id
            export_rows.append({
                "employee_name": employee_name, "document_type": row.document_type,
                "status": row.status, "uploaded_at": row.uploaded_at,
            })
        filters_applied = {"status": status_filter}
        return await list_export.build_export(format, db, current_user, "Employee Documents", _LIST_COLUMNS, export_rows, filters_applied)

    return [DocumentOut.model_validate(row) for row in rows]


@router.post("/documents/{document_id}/verify", response_model=DocumentOut)
async def verify_document(
    document_id: str,
    body: DocumentVerifyDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="verify")),
) -> EmployeeDocument:
    row = await db.get(EmployeeDocument, document_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING_VERIFICATION":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already reviewed")
    if not body.approve and not (body.rejection_reason and body.rejection_reason.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject a document")

    row.status = "VERIFIED" if body.approve else "REJECTED"
    row.verified_by = current_user.id
    row.verified_at = datetime.now(timezone.utc)
    row.rejection_reason = body.rejection_reason
    row.updated_by = current_user.id

    employee = await db.get(Employee, row.employee_id)
    notify(
        db, recipient_user_id=employee.user_id, notification_type="DOCUMENT", actor_user_id=current_user.id,
        title=f"Document {row.status.lower()}",
        body=f"Your {row.document_type} document was {row.status.lower()}." + (f" Reason: {row.rejection_reason}" if row.rejection_reason else ""),
        source_module="documents", source_record_id=row.id,
    )

    await db.commit()
    await db.refresh(row)

    await email_transport.send_templated_email(
        db, "document_verified" if body.approve else "document_rejected", employee.email,
        {"first_name": employee.first_name, "document_name": row.document_type},
        related_record_type="employee_document", related_record_id=row.id,
    )

    return row
