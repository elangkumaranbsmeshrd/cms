"""Generic CRUD router factory for the 15 simple lookup sub-masters (Masters
§3.0): Expense Types, Leave Types, Holidays, Payment Mode, Department,
Designation, HSN/SAC Code, Service Category, Unit of Measure, Ticket
Categories, Customer Status, Customer Source, Asset Categories, Employment
Type, Insurance Plans. Every one of them is list + add/edit + Super-Admin-only
delete/deactivate (§3.0 rule 1) — one factory instead of fifteen near-
identical files, parameterised only by field shape and screen key.

Three mutation endpoints beyond create/update, matching §3.0's two-tier
lifecycle exactly:
  - `POST /{id}/deactivate` / `POST /{id}/activate` — both halves of the
    Active/Inactive toggle every sub-master has (§3.0's own Fields Table:
    "Status: Toggle (Active/Inactive)"). `activate` was added by the §4.3
    audit — every sub-master built off this factory could be switched off
    but never back on through the UI, which is a one-way door §3.0's "never
    silently unreachable" rule does not allow. Same Super-Admin-only guard
    as deactivate.
  - `DELETE /{id}` — a real delete, for a record nothing has ever referenced
    yet. If it IS referenced, the database's own ON DELETE RESTRICT foreign
    keys reject it, and any of the three constraint-carrying tables' own
    triggers (e.g. Holidays' locked-FY guard) can reject too — both surface
    as 409, not a 500.

Two per-entity extension points, both optional, used only where a lookup's
behaviour genuinely isn't identical to its siblings — anything beyond these
belongs in a bespoke router (like Taxes/Bank Account/etc.), not a special
case bolted onto this factory:
  - `search_field` / `include_inactive` — Masters §3.0's Filter & Export
    convention, the Search and Status halves of it. `search_field` accepts
    either a single column name (every sub-master except the two noted below)
    or a list of column names, ORed together — added by the §4.3 audit for
    Department, whose `code` column §3.0's own cross-cutting rule ("Search,
    across that sub-master's name and code fields") requires alongside `name`
    but which the single-column default silently left unsearched. PDF/Excel
    export (Phase 6) is now wired for every sub-master too, ONCE, in
    `list_rows` itself — see the docstring note below. Used/Unused and
    Created By/Modified By/date-range filters are still deliberately NOT
    implemented here.
  - `before_write` — an async hook run just before a create/update commits,
    given the incoming data dict, the db session, and the existing row (None
    on create). It can validate (raise HTTPException) or inject server-
    computed fields. Used by Expense Types (Claim Type change bookkeeping)
    and HSN/SAC Code (Linked Tax scope restriction) — see masters_simple.py.

FILTERS & EXPORT CONVENTION — WHAT'S DEFERRED, AND WHY (found by the Phase 1
audit): Masters §3.0 asks for Search, Status, Used/Unused, Created By/Last
Modified By/Created On range filters, and PDF/Excel export identically on
every one of the ~19 sub-master lists — and BUILD-PROMPT §7 calls this same
contract out again for ~51 list screens system-wide ("build the contract
ONCE; every list inherits it"). Search and the Status filter are implemented
here now because they're cheap and immediately useful. Used/Unused needs
real cross-module reference data most of these lookups don't have yet
(Employee, Invoice, Purchase Bill, etc. aren't built until later phases) and
is still deferred. PDF/Excel export (Phase 6) IS now wired here, ONCE, in
`build_lookup_router` itself — every sub-master generated from this factory
gets `?format=pdf|excel` on its list endpoint for free, via the same
`list_export.build_export` contract every other list screen in the system
uses (RBAC §2.2(f)). Columns are built generically from each sub-master's own
`fields` dict (plus `id` and `is_active`) — see `_export_columns_for` below —
since the factory has no per-entity knowledge beyond that shape.
"""

import logging
import typing
import uuid
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, create_model
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

BeforeWriteHook = Callable[[dict, AsyncSession, Any | None], Awaitable[dict]]

_ALIGN_RIGHT_TOKENS = ("pct", "percent", "count", "days", "quantity", "qty")


def _base_type(tp: Any) -> Any:
    """Unwraps `X | None` (and other `Optional[X]` spellings) down to `X`, so
    alignment/formatting decisions look at the real underlying type instead
    of the Union.
    """
    args = typing.get_args(tp)
    if args:
        non_none = [a for a in args if a is not type(None)]
        if non_none:
            return non_none[0]
    return tp


def _humanize(field_name: str) -> str:
    return field_name.replace("_", " ").title()


def _infer_align(field_name: str, field_type: Any) -> str:
    """This project's own reversed convention (confirmed project memory):
    money is LEFT-aligned, counts/quantities/percentages/day-figures are
    RIGHT-aligned. The factory has no semantic knowledge of any one
    sub-master's fields, so it infers from the field name for the
    non-money numeric cases (rate_pct, usage_count, default_annual_quota_days,
    ...) and otherwise treats a bare Decimal as money (left) — every other
    type (str, bool, date, id) is left-aligned same as ColumnSpec's default.
    """
    lowered = field_name.lower()
    if any(tok in lowered for tok in _ALIGN_RIGHT_TOKENS):
        return "right"
    if _base_type(field_type) is int:
        return "right"
    return "left"


def _export_columns_for(fields: dict[str, tuple[type, Any]]) -> list[ColumnSpec]:
    columns = [ColumnSpec("id", "ID")]
    columns += [ColumnSpec(key, _humanize(key), align=_infer_align(key, ftype)) for key, (ftype, _default) in fields.items()]
    columns.append(ColumnSpec("is_active", "Status"))
    return columns


def _export_title_for(screen_key: str) -> str:
    return screen_key.split(".")[-1].replace("_", " ").title()


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    # DBAPIError, not IntegrityError: it also catches a rejected trigger
    # SIGNAL (OperationalError), e.g. Holidays' locked-FY guard — found
    # missing by the Phase 1 audit, where only IntegrityError was caught and
    # a locked-FY rejection surfaced as a raw 500 instead of a clean 409.
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


ReferencedBy = list[tuple[type, str]]


async def _referenced_ids(db: AsyncSession, referenced_by: ReferencedBy) -> set[str]:
    """Live, not stored — MASTERS-COMPLETION-PROMPT.md §3a picked this
    pattern (over a stored/incremented counter like ExpenseType.usage_count)
    specifically because most of these lookups are consumed by modules that
    don't have a frontend yet; a live query needs no consumer-side
    bookkeeping and is automatically correct the day those modules ship.
    Matches masters_bank_accounts.py's own `_referenced_account_ids`.
    """
    ids: set[str] = set()
    for ref_model, fk_col in referenced_by:
        col = getattr(ref_model, fk_col)
        rows = (await db.execute(select(col).where(col.is_not(None)).distinct())).scalars().all()
        ids.update(rows)
    return ids


def build_lookup_router(
    *,
    prefix: str,
    tag: str,
    screen_key: str,
    model: type,
    fields: dict[str, tuple[type, Any]],
    search_field: str | list[str] | None = "name",
    before_write: BeforeWriteHook | None = None,
    read_only_fields: dict[str, tuple[type, Any]] | None = None,
    referenced_by: ReferencedBy | None = None,
    create_only_fields: dict[str, tuple[type, Any]] | None = None,
    label_field: str | None = None,
) -> APIRouter:
    """`read_only_fields` are server-computed columns that show up in
    responses but are never caller-writable (e.g. Expense Types'
    claim_type_changed_at/previous_claim_type/usage_count, set only by
    `before_write`) — kept out of `write_schema` on purpose.

    `referenced_by` turns on the Layer-3-style `is_referenced` field (§3a):
    a list of (OtherModel, fk_column_name) pairs — every row in OtherModel
    whose fk_column_name is non-null counts this lookup row as referenced.
    Pass `[]` (not None) for a lookup that genuinely has zero referencing
    tables today (e.g. units_of_measure) — that's a checked, honest "never
    referenced", not "we didn't look". Passing None omits `is_referenced`
    from the schema entirely, for lookups that don't want this field at all.

    `label_field` (2026-08 RBAC audit fix): when set, adds a `GET
    {prefix}/options` route gated on plain authentication only (no
    `require_screen` check) — the "not more sensitive than what the caller
    can already see" precedent `GET /users`/`files.py` already established.
    Returns only `[{id, label}]` for active rows, nothing else from `fields`.
    Exists because several sub-masters previously had their real screen-level
    `view` permission widened in `seed.py` just so a role like Accountant
    could populate an unrelated screen's dropdown (e.g. Invoice's Payment
    Mode field) — that accidentally also let them open the Masters admin
    screen itself, which the spec says they should not be able to do. A
    minimal, non-screen-gated options endpoint is the correct fix: the
    dropdown gets what it needs without granting standalone screen access.
    Only set this for sub-masters with no sensitive fields at all (Payment
    Mode, HSN/SAC Code) — a sub-master with any Layer-3-sensitive field
    should NOT use this, since this route bypasses `apply_field_masking`
    entirely by construction (it never selects more than `id`+`label_field`).

    `create_only_fields` (§3b) are accepted on POST but never on PUT — the
    prototype's Status toggle on every Add form is this shape exactly: "the
    form field is how you create something already inactive," never a way to
    flip an EXISTING row's status (that stays Super-Admin-only, via the
    dedicated deactivate/activate actions, per §4a's write-authority rule).
    Deliberately excluded from `write_schema`, which `update_row` alone
    uses — if `is_active` were in `fields` instead, any role granted plain
    'edit' could flip a row inactive through a normal PUT, bypassing the
    'delete' action guard deactivate_row/activate_row enforce.
    """
    router = APIRouter(prefix=prefix, tags=[tag])
    tracks_references = referenced_by is not None

    out_schema = create_model(
        f"{model.__name__}Out",
        __base__=BaseModel,
        id=(str, ...),
        is_active=(bool, True),
        **fields,
        **(read_only_fields or {}),
        **({"is_referenced": (bool, False)} if tracks_references else {}),
    )
    out_schema.model_config = ConfigDict(from_attributes=True)
    write_schema = create_model(f"{model.__name__}Write", **fields)
    create_schema = (
        create_model(f"{model.__name__}Create", **fields, **create_only_fields) if create_only_fields else write_schema
    )

    _export_columns = _export_columns_for(fields) + ([ColumnSpec("is_referenced", "Used")] if tracks_references else [])
    _export_title = _export_title_for(screen_key)

    async def _mark_referenced(db: AsyncSession, row: Any) -> Any:
        """Sets a transient (non-column) attribute on a single ORM instance
        before returning it through `response_model=out_schema` — FastAPI's
        response serialization reads it via plain attribute access, the same
        as any real mapped column (docstring on list_rows below explains why
        that's safe here but a direct `.model_validate()` call would not be).
        """
        if tracks_references:
            ids = await _referenced_ids(db, referenced_by)
            row.is_referenced = row.id in ids
        return row

    if label_field is not None:

        @router.get("/options", response_model=None)
        async def list_options(
            db: AsyncSession = Depends(get_db),
            current_user: User = Depends(get_current_user),
            include_inactive: bool = Query(False, description="A historical record (e.g. an old reimbursement) may reference a since-deactivated row and still needs its label to resolve"),
        ) -> list[dict]:
            stmt = select(model.id, getattr(model, label_field), model.is_active)
            if not include_inactive:
                stmt = stmt.where(model.is_active.is_(True))
            rows = (await db.execute(stmt)).all()
            return [{"id": row_id, "label": label, "is_active": is_active} for row_id, label, is_active in rows]

    @router.get("", response_model=None)
    async def list_rows(
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key)),
        search: str | None = Query(None, description="Case-insensitive substring match on the identifying field"),
        include_inactive: bool = Query(False, description="Masters §3.0: defaults to Active only"),
        is_referenced: bool | None = Query(None, description="Masters §3.0's Used/Unused filter — omit for both"),
        format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
    ) -> list | Response:
        stmt = select(model)
        if not include_inactive:
            stmt = stmt.where(model.is_active.is_(True))
        if search and search_field is not None:
            # str | list[str]: a single sub-master (Department, §4.3 audit)
            # needs two columns ORed together; every other registration still
            # passes the plain string it always has.
            search_columns = [search_field] if isinstance(search_field, str) else search_field
            stmt = stmt.where(or_(*(getattr(model, col).ilike(f"%{search}%") for col in search_columns)))
        rows = (await db.execute(stmt)).scalars().all()

        referenced_ids = await _referenced_ids(db, referenced_by) if tracks_references else set()
        if tracks_references and is_referenced is not None:
            rows = [r for r in rows if (r.id in referenced_ids) == is_referenced]

        if format:
            # RBAC §2.2(f): export exactly the filtered/searched set on
            # screen — same rows the JSON branch below would return, just
            # re-shaped. read_only_fields (server-computed, e.g. Expense
            # Types' usage_count) are deliberately left out here — the
            # factory only knows the caller-writable `fields` shape.
            export_rows = [
                {
                    "id": row.id, **{key: getattr(row, key) for key in fields}, "is_active": "Active" if row.is_active else "Inactive",
                    **({"is_referenced": "Yes" if row.id in referenced_ids else "No"} if tracks_references else {}),
                }
                for row in rows
            ]
            filters_applied = {"search": search, "include_inactive": include_inactive, **({"is_referenced": is_referenced} if tracks_references else {})}
            return await list_export.build_export(format, db, current_user, _export_title, _export_columns, export_rows, filters_applied)

        # RBAC §3.2 Layer 3, enforced at the serialization boundary (ARCH-2
        # §3.4) rather than in the DOM: previously `return list(rows)` handed
        # back raw ORM rows with every field present, and this factory alone
        # backs 15 of the app's screens — the single highest-leverage place
        # a hidden field could still leak.
        #
        # Built by hand rather than `out_schema.model_validate(row)`: this
        # class's `model_config = ConfigDict(from_attributes=True)` is
        # assigned AFTER `create_model()` (line 157 above), which does not
        # retrigger pydantic-core's validator compilation — so
        # `model_validate()` on this class never actually accepted an ORM
        # object at all (confirmed live: it raised "Input should be a valid
        # dictionary or instance of ...Out", i.e. exactly the from_attributes-
        # disabled error). `create_row`/`update_row` below don't hit this,
        # because FastAPI's OWN response_model machinery forces
        # `from_attributes=True` at the point it validates a route's return
        # value — a behavior that only applies via `response_model=`, not to
        # a direct `model_validate()` call like this one. Building the dict
        # explicitly sidesteps the whole issue and matches the export
        # branch's already-proven shape above, except read_only_fields ARE
        # included here (the export branch deliberately excludes them per its
        # own comment; the JSON response is exactly where read-only fields
        # such as Expense Types' usage_count are meant to be read).
        out_rows = [
            {
                "id": row.id,
                "is_active": row.is_active,
                **{key: getattr(row, key) for key in fields},
                **{key: getattr(row, key) for key in (read_only_fields or {})},
                **({"is_referenced": row.id in referenced_ids} if tracks_references else {}),
            }
            for row in rows
        ]
        return [apply_field_masking(r, perms) for r in out_rows]

    @router.post("", response_model=out_schema, status_code=status.HTTP_201_CREATED)
    async def create_row(
        body: create_schema,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key, action="edit")),
    ):
        data = body.model_dump()
        if before_write is not None:
            data = await before_write(data, db, None)
        row = model(id=str(uuid.uuid4()), created_by=current_user.id, updated_by=current_user.id, **data)
        db.add(row)
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Duplicate name or invalid reference") from exc
        await db.refresh(row)
        # A brand-new row can't be referenced by anything yet — trivially
        # False, no query needed (still gated on tracks_references so the
        # attribute is only set where out_schema actually declares it).
        if tracks_references:
            row.is_referenced = False
        return row

    @router.put("/{row_id}", response_model=out_schema)
    async def update_row(
        row_id: str,
        body: write_schema,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key, action="edit")),
    ):
        row = await db.get(model, row_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        data = body.model_dump()
        if before_write is not None:
            data = await before_write(data, db, row)
        for name, value in data.items():
            setattr(row, name, value)
        row.updated_by = current_user.id
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Duplicate name or invalid reference") from exc
        await db.refresh(row)
        return await _mark_referenced(db, row)

    @router.post("/{row_id}/deactivate", response_model=out_schema)
    async def deactivate_row(
        row_id: str,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key, action="delete")),  # §3.0 rule 1: SA only
    ):
        row = await db.get(model, row_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        row.is_active = False
        row.updated_by = current_user.id
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Rejected by a database constraint") from exc
        await db.refresh(row)
        return await _mark_referenced(db, row)

    @router.post("/{row_id}/activate", response_model=out_schema)
    async def activate_row(
        row_id: str,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        # Mirrors deactivate_row's guard, not a separate grantable permission:
        # §4.3 audit (Department, Designation, HSN/SAC, Service Category) found
        # every sub-master's Active/Inactive toggle (§3.0's own Fields Table
        # calls Status "Toggle (Active/Inactive)") only ever worked one
        # direction — deactivate existed, its reverse didn't, so a retired row
        # could never come back except by editing the database directly, which
        # contradicts §3.0's "never silently unreachable" rule. The prototype
        # itself never renders this action (none of these list screens declare
        # a rowAction beyond '+ Add …'), so this is a spec-fidelity fix, not a
        # prototype-parity one — same class of gap as Financial Year's End
        # Date in this build's worked example.
        perms: PermissionSet = Depends(require_screen(screen_key, action="delete")),  # §3.0 rule 1: SA only
    ):
        row = await db.get(model, row_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        row.is_active = True
        row.updated_by = current_user.id
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Rejected by a database constraint") from exc
        await db.refresh(row)
        return await _mark_referenced(db, row)

    @router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_row(
        row_id: str,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key, action="delete")),
    ) -> None:
        row = await db.get(model, row_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        await db.delete(row)
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Still referenced elsewhere — deactivate instead of deleting") from exc

    return router
