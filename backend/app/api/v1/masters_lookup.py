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
    `list_rows` itself — see the docstring note below. Used/Unused is now
    built as well, per-registration, via `referenced_by`; Created By / Last
    Modified By / Created On range are built unconditionally, since every
    model here carries AuditMixin and so needs no opt-in (see `list_rows`).
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
ONCE; every list inherits it"). Search and the Status filter were implemented
here first because they're cheap and immediately useful. Used/Unused needed
cross-module reference data most of these lookups did not have while the
consuming modules were unbuilt — it landed later, as `referenced_by`. Created
By / Last Modified By / Created On range (A048) landed last, in `list_rows`
below: the columns they read come from AuditMixin, which every model this
factory serves already has, so the only thing that was ever missing was the
four query params. PDF/Excel export (Phase 6) IS now wired here, ONCE, in
`build_lookup_router` itself — every sub-master generated from this factory
gets `?format=pdf|excel` on its list endpoint for free, via the same
`list_export.build_export` contract every other list screen in the system
uses (RBAC §2.2(f)). Columns are built generically from each sub-master's own
`fields` dict (plus `id` and `is_active`) — see `_export_columns_for` below —
since the factory has no per-entity knowledge beyond that shape.
"""

import logging
import types as _types
import typing
import uuid
from datetime import date, timedelta
from typing import Annotated, Any, Awaitable, Callable, Union

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, StringConstraints, create_model
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


def _strip_constraints(tp: Any) -> Any:
    """Drops every `Annotated[...]` wrapper (pydantic constraints) from a type,
    recursing through unions, so a constrained spec such as
    `Annotated[int, Field(gt=0)] | None` collapses back to `int | None`.

    Used for two things: the export/alignment inference below (which compares
    against bare `int`), and `out_schema` — a response model must stay
    permissive, or a row that predates a newly added constraint would blow up
    at serialization time with a 500 instead of merely being un-editable.
    """
    if typing.get_origin(tp) is Annotated:
        return _strip_constraints(typing.get_args(tp)[0])
    origin = typing.get_origin(tp)
    if origin is Union or origin is _types.UnionType:
        return Union[tuple(_strip_constraints(a) for a in typing.get_args(tp))]
    return tp


def _base_type(tp: Any) -> Any:
    """Unwraps `X | None` (and other `Optional[X]` spellings) down to `X`, so
    alignment/formatting decisions look at the real underlying type instead
    of the Union.
    """
    tp = _strip_constraints(tp)
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


_NON_BLANK = StringConstraints(strip_whitespace=True, min_length=1)
_TRIMMED = StringConstraints(strip_whitespace=True)


def _writable_field(spec: tuple[type, Any]) -> tuple[type, Any]:
    """Every caller-writable text column on these 15 sub-masters is trimmed on
    the way in, and a *required* one may not be blank after trimming.

    Found live by the audit sweep: `POST /masters/departments {"name":"   "}`
    returned 201 and stored three spaces, producing a row that renders as an
    empty entry in every dropdown that consumes it. Worse, because nothing
    trimmed, the DB unique index that correctly rejects an exact duplicate name
    with a 409 was bypassable by appending one trailing space — two visually
    identical rows could coexist. Trimming here is what makes that index mean
    what the screen says it means.

    This is deliberately applied to the WRITE schemas only (`write_schema` /
    `create_schema`), never to `out_schema` — see `_strip_constraints`.
    """
    ftype, default = spec
    if _base_type(ftype) is not str:
        return spec
    constrained = Annotated[str, _NON_BLANK if default is ... else _TRIMMED]
    if _strip_constraints(ftype) is str:
        return (constrained, default)
    return (Union[constrained, None], default)


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
    options_extra_fields: tuple[str, ...] | None = None,
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
    This route bypasses `apply_field_masking` entirely, so the thing to check
    before setting `label_field` is the LABEL COLUMN ITSELF — the SELECT never
    names anything but `id`, `label_field` and `is_active`, so no other column
    on the table is reachable through it no matter how sensitive it is. That
    is the same reasoning masters_bank_accounts.py's own hand-written
    `/options` already runs on: Bank Account carries the most sensitive
    columns in Masters (account_number, ifsc, upi_id) and still has one,
    precisely because it selects `nickname` and stops. Applied across the
    factory (2026-08 sweep) the test comes out the same everywhere: every
    sub-master here labels itself by a plain `name`/`code`/`plan_name`, none
    of which is a secret. The one worth naming is Insurance Plans, whose row
    DOES carry money (coverage and both contribution figures) — safe here for
    exactly the Bank Account reason, and see that registration's own comment
    in masters_simple.py for which caller therefore still needs the full list
    route instead. A sub-master whose IDENTIFYING field was itself the secret
    would be the real exclusion; there is no such lookup in this app today.

    `options_extra_fields` widens that SELECT, and therefore weakens the
    invariant above from "structurally cannot leak anything else" to "leaks
    exactly what is named here". That is a real downgrade, so the bar for
    adding a column is: the CLIENT MUST NEED THE VALUE, not merely need to
    filter on it. If a caller only wants a narrowed list, the filter belongs
    on the server as a query parameter and nothing extra crosses the wire —
    masters_taxes.py's own `/options` does exactly that with `scope` and
    `in_force_on`, which is why a tax head's rate_pct, cgst/sgst split,
    fixed_amount and slab bands remain unreachable through it.

    The one opted-in column today is Expense Types' `claim_type`
    (masters_simple.py). It qualifies because the Expense claim form RENDERS
    it: §2.1's read-only "Claim Type" field is carried from the selected
    type's own claim_type, and the picker offers Company-Paid types only to
    Super Admin/Accountant — so the client genuinely needs the value per row,
    which a server-side filter cannot supply. It is a two-value enum
    (REIMBURSABLE | COMPANY_PAID) classifying a category, carrying nothing
    about any person or amount. Anything with a number in it does not clear
    this bar.

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

    # Constraints belong on the way IN (write_fields) and must not appear on
    # the way OUT (out_fields): a row that predates a constraint still has to
    # serialize, or tightening validation would turn old rows into 500s.
    write_fields = {key: _writable_field(spec) for key, spec in fields.items()}
    out_fields = {key: (_strip_constraints(ftype), dflt) for key, (ftype, dflt) in fields.items()}
    out_read_only = {key: (_strip_constraints(ftype), dflt) for key, (ftype, dflt) in (read_only_fields or {}).items()}

    out_schema = create_model(
        f"{model.__name__}Out",
        __base__=BaseModel,
        id=(str, ...),
        is_active=(bool, True),
        **out_fields,
        **out_read_only,
        **({"is_referenced": (bool, False)} if tracks_references else {}),
    )
    out_schema.model_config = ConfigDict(from_attributes=True)
    write_schema = create_model(f"{model.__name__}Write", **write_fields)
    create_schema = (
        create_model(f"{model.__name__}Create", **write_fields, **create_only_fields)
        if create_only_fields
        else write_schema
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
            extra = tuple(options_extra_fields or ())
            stmt = select(model.id, getattr(model, label_field), model.is_active, *(getattr(model, f) for f in extra))
            if not include_inactive:
                stmt = stmt.where(model.is_active.is_(True))
            rows = (await db.execute(stmt)).all()
            return [
                {
                    "id": row[0],
                    "label": row[1],
                    "is_active": row[2],
                    **{name: row[3 + i] for i, name in enumerate(extra)},
                }
                for row in rows
            ]

    @router.get("", response_model=None)
    async def list_rows(
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
        perms: PermissionSet = Depends(require_screen(screen_key)),
        search: str | None = Query(None, description="Case-insensitive substring match on the identifying field"),
        include_inactive: bool = Query(False, description="Masters §3.0: defaults to Active only"),
        is_referenced: bool | None = Query(None, description="Masters §3.0's Used/Unused filter — omit for both"),
        created_by: str | None = Query(None, description="Masters §3.0's Created By filter — a users.id"),
        updated_by: str | None = Query(None, description="Masters §3.0's Last Modified By filter — a users.id"),
        created_from: date | None = Query(None, description="Masters §3.0's Created On range, inclusive"),
        created_to: date | None = Query(None, description="Masters §3.0's Created On range, inclusive"),
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
        # §3.0's "Created By, Last Modified By, and Created On range" half of
        # the Filter & Export convention (Appendix A, A048). Every model this
        # factory serves carries AuditMixin, so these four need no per-entity
        # opt-in and no migration — the columns are already there on all 15.
        # Same shape customers.py:212-225 already uses, so a caller writes the
        # same params against a lookup as against any other list: `created_to`
        # is INCLUSIVE, hence the < next-day comparison against a DATETIME.
        if created_by:
            stmt = stmt.where(model.created_by == created_by)
        if updated_by:
            stmt = stmt.where(model.updated_by == updated_by)
        if created_from:
            stmt = stmt.where(model.created_at >= created_from)
        if created_to:
            stmt = stmt.where(model.created_at < created_to + timedelta(days=1))
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
            filters_applied = {
                "search": search, "include_inactive": include_inactive,
                **({"is_referenced": is_referenced} if tracks_references else {}),
                # Named in the PDF/Excel header block only when actually set —
                # list_export drops empty values, so an unfiltered export does
                # not grow four "None" lines it never had.
                "created_by": created_by, "updated_by": updated_by,
                "created_from": created_from, "created_to": created_to,
            }
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
