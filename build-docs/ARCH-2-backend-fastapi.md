I have what I need. Here is the architecture.

---

# FastAPI Backend Architecture — Meshrd CMS

Grounded in the 14 spec docs at `D:\Projects\Company Management Software\01-…14-…md` and the prototype policy map at `D:\Projects\Company Management Software\prototype\app-rbac.js`.

> **As-built annotation pass (2026-08-03).** The backend is now built and feature-complete (`backend/app/…`, migrations 0001–0008, Phases 0–7 plus Module 15 and the RBAC admin screens). Where the implementation deliberately diverges from this document, an **"As built"** note has been inserted at the point of divergence with the reasoning. The original text is left untouched — the notes are additive, not rewrites.

**One framing decision drives everything below.** The prototype's own header comment records the failure mode to design against:

> "Twenty renderers silently ignored it, so — for one real example — Super Admin was shown 'Editable — needs HR approval' on their own profile."

The fix there was to move policy into shared builders that read the active screen themselves, so *a renderer that forgets to use its `role` argument still produces correctly restricted output*. The server-side equivalent is the organising principle here: **enforcement lives in shared machinery that a route cannot opt out of, and the failure mode of forgetting is a 500 or a failing test, never a silent data leak.**

**A note on screen counts.** The RBAC inventory (§3) totals ~81 spec screens; `prototype/data.js` declares 68 screen ids; your brief says ~161. These reconcile at the registry: the permission registry must be granular to the **tab**, not the screen — Customer 360's 8 tabs, Masters' 20 sub-masters, Taxes' 5 tabs, Work Week's 6 tabs, Employee Master Record's 10 tabs. Layer 3 toggles hang off tabs (`Salary Structure` is a tab, not a screen), so tab-granularity is forced by the permission model, and that expansion is what takes ~81 to ~161.

---

## 1. Project / directory layout

```
cms-api/
├── pyproject.toml              # uv/poetry; py3.12
├── alembic.ini
├── alembic/versions/
├── docker-compose.yml          # mysql 8.4, redis 7, api, worker
├── deploy/
│   ├── nginx.conf              # internal location for X-Accel-Redirect
│   └── systemd/{cms-api,cms-worker}.service
└── src/cms/
    ├── main.py                 # app factory, lifespan, exception handlers
    ├── settings.py             # pydantic-settings; all secrets from env
    │
    ├── core/                   # platform. no business rules.
    │   ├── db.py               # async engine, sessionmaker, UnitOfWork
    │   ├── base.py             # DeclarativeBase + TimestampMixin, ActorMixin, SoftDeleteMixin
    │   ├── types.py            # Money = Numeric(18,4), Percent, FYLabel, utc_now
    │   ├── ctx.py              # ContextVar[AccessContext]
    │   ├── errors.py           # AppError hierarchy -> RFC7807 responses
    │   ├── routing.py          # ScreenRoute (APIRoute subclass), APIRouter defaults
    │   ├── listing/            # THE list contract (§4)
    │   │   ├── query.py        # ListQuery dependency
    │   │   ├── spec.py         # ListSpec — per-resource declaration
    │   │   ├── apply.py        # apply_list_query(): scope -> filter -> sort -> page
    │   │   ├── envelope.py     # ListResponse, AppliedFilter
    │   │   └── export.py       # export enqueue + header block builder
    │   ├── serialization/masking.py   # Masked base, Sensitive annotation
    │   ├── numbering/service.py       # FY-stamped document numbers
    │   ├── audit/{models,service}.py  # append-only trails
    │   ├── files/{storage,service,validation}.py
    │   ├── mail/{mailgun,service,renderer,models}.py
    │   ├── notify/service.py   # in-app notification (never gated by email config)
    │   └── jobs/{worker,queue,registry}.py
    │
    ├── rbac/                   # Module 14 — and the enforcement engine for all four layers
    │   ├── registry/
    │   │   ├── screens.py      # SCREENS: the ~161 (module, screen, tab) keys — code, seeded to DB
    │   │   ├── actions.py      # per-screen action keys, from each module's own doc
    │   │   ├── fields.py       # sensitive field keys + which screens expose them
    │   │   └── toggles.py      # the 46 named toggles from RBAC §2.1
    │   ├── models.py           # roles, role_screen/action/field_permissions, overrides, change_log
    │   ├── resolver.py         # PermissionSet builder + Redis cache keyed on permissions_version
    │   ├── scope.py            # Scope enum, ScopeRule, SCOPE_RULES registry
    │   ├── deps.py             # require_screen(...) -> AccessContext
    │   ├── service.py          # matrix save (batched), overrides, change log
    │   └── router.py           # 4.1 directory, 4.2 matrix, 4.3 overrides, 4.4 change log
    │
    ├── auth/                   # login, refresh, temp password, forced change, reset
    │   ├── router.py service.py tokens.py passwords.py schemas.py models.py
    │
    └── modules/                # one package per spec module, same 6 files each
        ├── masters/
        │   ├── financial_year/     # 3.1 — locking is a global data-integrity gate
        │   ├── taxes/
        │   │   ├── models.py schemas.py repository.py service.py router.py
        │   │   └── engine/         # THE TAX ENGINE (§6)
        │   │       ├── types.py resolver.py methods.py slabs.py splits.py relief.py trace.py
        │   ├── workweek/           # 3.20 — policies, saturday calendar, pay cycle
        │   │   ├── models.py service.py calendar.py paycycle.py
        │   ├── email_config/       # 3.21 — server settings + templates + recent sends
        │   ├── company_profile/    # 3.6 incl. number prefixes
        │   └── simple/             # the ~14 flat sub-masters, one generic CRUD factory
        ├── employees/              # incl. salary_structure/, declarations/, onboarding/, letters/
        ├── assets/  tickets/  leave/
        ├── payroll/
        │   ├── models.py repository.py router.py service.py
        │   └── engine/             # THE PAYROLL ENGINE (§6)
        │       ├── context.py pipeline.py attendance.py earnings.py
        │       ├── statutory.py income_tax.py lop.py trace.py
        ├── vendors/ customers/ opportunities/ projects/
        └── invoices/ expenses/ purchase_bills/
```

Every `modules/*` package has the identical shape — `models.py`, `schemas.py`, `repository.py`, `service.py`, `router.py`, `listing.py`. `listing.py` holds that module's `ListSpec`s and is the only place a filter is declared.

> **As built — layout, driver, and platform plumbing.** The built tree is `backend/app/`, not `cms-api/src/cms/`: routers live in `app/api/v1/*.py` (one module per file, wired in `app/main.py`), engines and services in `app/services/` (`payroll_engine.py`, `tax_engine.py`, `salary_engine.py`, …), models in `app/models/`, platform code in `app/core/` and `app/auth/`. Same layering intent, flatter package shape — the per-module six-file package structure was not adopted. Other verified as-built facts for this section:
> - **DB driver** is `asyncmy` for the running app and `pymysql` for Alembic (`backend/.env.example`); the security analyses for asyncmy's CVE-2025-65896 and python-jose's ecdsa CVE-2024-23342 (both unreachable here, with the reasoning) live as comments in `backend/pyproject.toml`.
> - `app/main.py` carries a request-id middleware (accepts/generates `X-Request-Id`, threads it via a ContextVar) plus a global unhandled-exception handler, and `app/core/logging_config.py` configures plain one-line stdlib logging with `request_id=` correlation — deliberately not JSON, matching journald-style log reading (ARCH-3 §9.5).
> - `/health` executes a real `SELECT 1` and returns **503** when MySQL is unreachable, so the uptime monitor catches a dead database rather than a static `{"status": "ok"}`.

---

## 2. Layered architecture — and what lives where

```
HTTP  →  Router  →  Service  →  Repository  →  Model  →  MySQL
          ▲           ▲            ▲
    AccessContext   invariants   scope always applied here
```

| Layer | Owns | Explicitly must NOT |
|---|---|---|
| **Router** | HTTP shape, status codes, `Depends(require_screen(...))`, response models | Contain any `if role ==`. Touch the DB session directly. Build a `select()`. |
| **Service** | Business invariants, orchestration, transactions, audit writes, job enqueues, engine invocation | Know about `Request`, HTTP status, or `Depends`. |
| **Repository** | Query construction. **This is the only layer allowed to call `select()`.** Applies scope before anything else. | Contain business rules or commit. |
| **Model** | SQLAlchemy 2.x `Mapped[]` ORM, column constraints, DB-level invariants | Contain query logic. |

**Concern placement, specifically:**

- **L1/L2 authorization** — `Depends(require_screen(...))` at the router. Fails before the service is entered.
- **L4 scope** — repository, mechanically. Never the service.
- **L3 field masking** — serializer on the way out, request-guard on the way in. Never the router.
- **Data-integrity locks** — service layer, and these are *not* RBAC. Locked Financial Year (Masters §3.1), locked tax head (§3.2), invoice locked at Paid (Invoice §2). The spec is explicit that these are "deliberately stricter than any role permission" and bind Super Admin too. They are invariants asserted in the service and mirrored as DB constraints/triggers; they do not appear in the permission tables at all. Conflating the two is the single most likely design error here.
- **Transactions** — one `UnitOfWork` per request, opened by the `get_db` dependency, committed by the router's success path. Services never commit; they may `flush()`.

```python
# core/db.py
class UnitOfWork:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._audit_buffer: list[AuditEntry] = []

    def record_audit(self, entry: AuditEntry) -> None:
        """Buffered so audit rows land in the same commit as the change they describe."""
        self._audit_buffer.append(entry)

    async def commit(self) -> None:
        if self._audit_buffer:
            self.session.add_all([e.to_row() for e in self._audit_buffer])
        await self.session.commit()
```

---

## 3. The four RBAC layers

### 3.1 The model: policy is data, the registry is code

The prototype hardcoded `POLICY`, `ACTIONS`, `FIELDS`, `TOGGLES` as JS literals. Server-side, split that in two:

- **The registry is code** (`rbac/registry/`) — *what screens, actions and fields exist*, and which layers apply to each. This must match the spec docs and is version-controlled, reviewed, and CI-checked.
- **The grants are rows** — *who gets what*. Super Admin edits these at runtime through screen 4.2. Nothing is hardcoded, satisfying RBAC §1: "Access is a setting everywhere in this system, never a hardcoded rule."

```python
# rbac/registry/screens.py
@dataclass(frozen=True, slots=True)
class ScreenDef:
    key: str                       # 'emp.record.salary'  — module.screen.tab
    module: str                    # 'employee'
    label: str
    spec_ref: str                  # '02-employee-module.md §2.2'
    is_list: bool                  # drives the §4 list contract + export
    scope_dimension: bool          # Layer 4 applies at all? Masters→FY: False
    actions: tuple[str, ...]       # Layer 2 — from THAT screen's doc, never generic
    fields: tuple[str, ...]        # Layer 3 — sensitive field keys only

SCREENS: dict[str, ScreenDef] = {
    "emp.record.salary": ScreenDef(
        key="emp.record.salary", module="employee",
        label="Employee Master Record — Salary Structure",
        spec_ref="02-employee-module.md §2.2",
        is_list=False, scope_dimension=True,
        actions=("view", "edit", "add_structure_revision"),
        fields=("salary.basic", "salary.hra", "salary.special_allowance",
                "salary.statutory_applicable_toggle"),
    ),
    "masters.fy": ScreenDef(
        key="masters.fy", module="masters", label="Financial Year",
        spec_ref="01-masters-module.md §3.1", is_list=True,
        scope_dimension=False,          # RBAC §2 — company-wide and singular
        actions=("view", "add", "edit", "lock", "export"),
        fields=(),
    ),
    # ... ~161 entries
}
```

Tables (`rbac/models.py`):

```
roles(id, key, label, is_system, created_at)                    -- 5 now, 6th needs no schema change
screens(key, module, label, spec_ref, is_list, scope_dimension) -- mirrored from registry by seeder
screen_actions(screen_key, action_key)
screen_fields(screen_key, field_key)

role_screen_permissions(role_id, screen_key, visible bool, scope scope_enum)      -- L1 + L4
role_action_permissions(role_id, screen_key, action_key, allowed bool)            -- L2
role_field_permissions(role_id, screen_key, field_key, mode field_mode_enum,
                       editable bool)                                            -- L3

permission_overrides(id, user_id, layer, screen_key, target_key NULL,
                     effect grant|revoke, scope_value NULL,
                     created_by, created_at, removed_at NULL)                     -- override layer

feature_toggles(key, enabled, updated_by, updated_at)                             -- the 46
permission_change_log(id, at, changed_by, target_kind role|person, target_id,
                      screen_key, layer, target_key, old_value, new_value)        -- 4.4, append-only
permissions_version(singleton_id, version bigint)                                 -- cache epoch
```

`field_mode_enum = ('show','mask','hide')`, `scope_enum = ('all','team','own')`.

**Immutability of the change log** is enforced at the database, not in Python:

```sql
REVOKE UPDATE, DELETE ON permission_change_log       FROM cms_app;
REVOKE UPDATE, DELETE ON asset_assignment_history    FROM cms_app;
REVOKE UPDATE, DELETE ON payslip_reissue_history     FROM cms_app;
REVOKE UPDATE, DELETE ON leave_balance_adjustments   FROM cms_app;
```

The application role can `INSERT` and `SELECT` only. Migrations run as a separate owner role. This is the only version of "immutable" that survives a bug in a service.

### 3.2 Resolution — one `PermissionSet` per user, cached on an epoch

```python
# rbac/resolver.py
@dataclass(frozen=True, slots=True)
class ScreenGrant:
    visible: bool
    scope: Scope
    actions: frozenset[str]
    fields: Mapping[str, FieldMode]     # field_key -> show|mask|hide
    editable_fields: frozenset[str]

@dataclass(frozen=True, slots=True)
class PermissionSet:
    version: int
    role_key: str
    screens: Mapping[str, ScreenGrant]

    def grant(self, screen: str) -> ScreenGrant | None:
        g = self.screens.get(screen)
        return g if g and g.visible else None


class PermissionResolver:
    def __init__(self, session: AsyncSession, cache: Redis) -> None: ...

    async def for_user(self, user_id: UUID) -> PermissionSet:
        version = await self._version()
        key = f"perm:{user_id}:{version}"
        if raw := await self.cache.get(key):
            return PermissionSet.loads(raw)
        ps = await self._build(user_id, version)
        await self.cache.set(key, ps.dumps(), ex=3600)
        return ps

    async def _build(self, user_id: UUID, version: int) -> PermissionSet:
        user = await self._load_user(user_id)

        # Super Admin short-circuit. RBAC §8: the only role that can touch Module 14,
        # and per §2.2e it gets every screen, every filter, unscoped.
        if user.role_key == "superadmin":
            return PermissionSet(version, "superadmin", _all_screens_granted())

        toggles = await self._toggles()
        screens: dict[str, ScreenGrant] = {}

        for defn in SCREENS.values():
            row = await self._role_row(user.role_id, defn.key)
            visible = row.visible if row else False
            scope   = row.scope if (row and defn.scope_dimension) else Scope.ALL
            actions = await self._role_actions(user.role_id, defn.key)
            fields  = await self._role_fields(user.role_id, defn.key)

            # Named toggles (RBAC §2.1) are grants layered onto the role defaults.
            visible, scope, actions, fields = apply_toggles(
                defn, user.role_key, toggles, visible, scope, actions, fields)

            screens[defn.key] = ScreenGrant(visible, scope,
                                            frozenset(actions), fields,
                                            _editable(fields, defn))

        # Person overrides last — RBAC §2 "The Override Layer, on Top of All Four".
        for ov in await self._overrides(user_id):
            screens[ov.screen_key] = _apply_override(screens[ov.screen_key], ov)

        return PermissionSet(version, user.role_key, screens)
```

Any write in `rbac/service.py` runs `UPDATE permissions_version SET version = version + 1` in the same transaction. Every cached `PermissionSet` becomes unreachable atomically at commit. No invalidation fan-out, no stale-permission window, no per-user bookkeeping — the correctness argument is one line long.

### 3.3 The dependency — `require_screen`

```python
# rbac/deps.py
@dataclass(frozen=True, slots=True)
class AccessContext:
    principal: Principal          # user_id, employee_id, role_key
    screen: str
    grant: ScreenGrant

    @property
    def scope(self) -> Scope: return self.grant.scope
    def may(self, action: str) -> bool: return action in self.grant.actions
    def field_mode(self, key: str) -> FieldMode:
        return self.grant.fields.get(key, FieldMode.SHOW)


def require_screen(screen: str, action: str | None = None):
    if screen not in SCREENS:
        raise RuntimeError(f"Unregistered screen {screen!r}")          # boots-time failure
    if action and action not in SCREENS[screen].actions:
        raise RuntimeError(f"{action!r} not declared on {screen!r}")

    async def dep(
        request: Request,
        principal: Principal = Depends(get_principal),
        resolver: PermissionResolver = Depends(get_resolver),
    ) -> AccessContext:
        ps = await resolver.for_user(principal.user_id)
        grant = ps.grant(screen)

        # LAYER 1. RBAC §2: "no greyed-out menu item, no 'access denied' page
        # reachable by URL guessing, it simply isn't there." -> 404, not 403.
        if grant is None:
            raise NotFound()

        # LAYER 2.
        if action and action not in grant.actions:
            raise Forbidden(f"Action {action!r} not permitted on this screen")

        ctx = AccessContext(principal, screen, grant)
        request.state.access = ctx
        _ACCESS.set(ctx)                    # ContextVar — powers Layer 3 masking
        return ctx

    return dep
```

**404 on Layer 1 is deliberate and load-bearing.** A 403 confirms the screen exists and leaks the shape of the org's configuration. The spec forbids "an access-denied page reachable by URL guessing"; 404 is the only response consistent with that.

Router usage — note there is no `current_user` parameter anywhere:

```python
# modules/assets/router.py
router = APIRouter(prefix="/assets", tags=["assets"], route_class=ScreenRoute)

@router.get("", response_model=ListResponse[AssetOut])
async def list_assets(
    ctx: AccessContext = Depends(require_screen("asset.directory", "view")),
    q: AssetListQuery = Depends(),
    svc: AssetService = Depends(get_asset_service),
) -> ListResponse[AssetOut]:
    return await svc.list(ctx, q)

@router.post("/{asset_id}/assign", response_model=AssetOut)
async def assign_asset(
    asset_id: UUID,
    body: AssetAssignIn,
    ctx: AccessContext = Depends(require_screen("asset.assign", "assign")),
    svc: AssetService = Depends(get_asset_service),
) -> AssetOut:
    return await svc.assign(ctx, asset_id, body)
```

### 3.4 Layer 3 — field masking applied to serialization

Two directions, both mandatory. A masked field must not leak *out*, and a hidden field must not be writable *in*.

**Outbound.** A `Sensitive` annotation names the field key; a wrap-serializer on a shared base reads the request's `AccessContext` from the ContextVar. Because it is a serializer on the model, it fires on nested models and inside lists automatically, and a router that forgets is impossible — there is no router-side step to forget.

```python
# core/serialization/masking.py
_ACCESS: ContextVar[AccessContext | None] = ContextVar("access_ctx", default=None)

@dataclass(frozen=True, slots=True)
class Sensitive:
    key: str

class Masked(BaseModel):
    """Base for any response schema carrying a Layer-3 field."""

    @model_serializer(mode="wrap")
    def _apply_field_policy(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        ctx = _ACCESS.get()
        if ctx is None:                       # jobs/tests may serialize unscoped
            return data

        restricted: dict[str, str] = {}
        for name, field in type(self).model_fields.items():
            sens = next((m for m in field.metadata if isinstance(m, Sensitive)), None)
            if sens is None:
                continue
            match ctx.field_mode(sens.key):
                case FieldMode.HIDE:
                    data.pop(name, None)              # absent entirely
                    restricted[sens.key] = "hidden"
                case FieldMode.MASK:
                    data[name] = None                 # value null, reason stated
                    restricted[sens.key] = "masked"
                case FieldMode.SHOW:
                    pass
        if restricted:
            data["_restricted"] = restricted
        return data
```

```python
# modules/assets/schemas.py
class AssetOut(Masked):
    id: UUID
    asset_code: str                                          # AST-2026-0001
    name: str
    category: str
    purchase_value:  Annotated[Decimal | None, Sensitive("asset.purchase_value")] = None
    current_value:   Annotated[Decimal | None, Sensitive("asset.current_value")]  = None
```

`mask` returns `null` plus `_restricted: {"asset.purchase_value": "masked"}` rather than a `"••••"` string, so the OpenAPI type stays honest and the client knows *why* the value is absent. The client renders the placeholder — which satisfies RBAC §2.2c-i(4), "a masked amount keeps the alignment of the amount it replaces," since the column and its alignment still exist client-side.

**Do not stop at serialization for genuinely secret columns.** For SMTP passwords, bank account numbers and salary figures, also avoid loading them:

```python
# modules/employees/repository.py
def salary_columns(ctx: AccessContext) -> list[ColumnElement]:
    cols = [SalaryStructure.id, SalaryStructure.effective_from]
    if ctx.field_mode("salary.basic") is FieldMode.SHOW:
        cols += [SalaryStructure.basic, SalaryStructure.hra, SalaryStructure.special_allowance]
    return cols
```

Serialization masking is the guarantee; column selection is defence in depth and keeps secrets out of query logs and `repr()` in tracebacks.

**Inbound.** A hidden or read-only field silently ignored on write is a privilege escalation. Reject loudly:

```python
# core/serialization/masking.py
def guard_write(ctx: AccessContext, payload: BaseModel) -> None:
    offending: list[str] = []
    for name, field in type(payload).model_fields.items():
        if name not in payload.model_fields_set:
            continue                                  # not supplied — nothing to guard
        sens = next((m for m in field.metadata if isinstance(m, Sensitive)), None)
        if sens is None:
            continue
        if ctx.field_mode(sens.key) is not FieldMode.SHOW or sens.key not in ctx.grant.editable_fields:
            offending.append(sens.key)
    if offending:
        raise Forbidden(f"Fields not editable for this role: {', '.join(sorted(offending))}")
```

Called as the first line of every mutating service method. A generic-CRUD base calls it automatically.

### 3.5 Layer 4 — scope injected into queries, before filters

Scope is declared once per model and applied by the base repository. Services cannot construct an unscoped query because they cannot construct a query at all.

```python
# rbac/scope.py
class Scope(StrEnum):
    ALL = "all"; TEAM = "team"; OWN = "own"

@dataclass(frozen=True, slots=True)
class ScopeRule:
    own:  Callable[[Select, Principal], Select]
    team: Callable[[Select, Principal], Select] | None = None

def direct_reports(p: Principal) -> Select:
    return select(Employee.id).where(
        Employee.reporting_manager_id == p.employee_id,
        Employee.status == EmployeeStatus.ACTIVE,
    )

SCOPE_RULES: dict[type[Base], ScopeRule] = {
    Ticket: ScopeRule(
        own=lambda s, p: s.where(Ticket.assigned_to_id == p.employee_id),
        team=lambda s, p: s.where(Ticket.assigned_to_id.in_(direct_reports(p))),
    ),
    Asset: ScopeRule(
        own=lambda s, p: s.where(Asset.assigned_to_id == p.employee_id),
        team=lambda s, p: s.where(Asset.assigned_to_id.in_(direct_reports(p))),
    ),
    # RBAC §2.1 "Restrict Manager to Only Their Own Customers" — Owner, not reports.
    Customer: ScopeRule(
        own=lambda s, p: s.where(Customer.owner_id == p.employee_id),
        team=lambda s, p: s.where(Customer.owner_id.in_(direct_reports(p).union(
                                   select(literal(p.employee_id))))),
    ),
    Project: ScopeRule(
        own=lambda s, p: s.where(Project.lead_id == p.employee_id),
        team=lambda s, p: s.where(or_(
            Project.lead_id == p.employee_id,
            Project.id.in_(select(ProjectMember.project_id)
                           .where(ProjectMember.employee_id.in_(direct_reports(p)))),
        )),
    ),
}
```

```python
# core/repository.py
class ScopedRepository(Generic[M]):
    model: ClassVar[type[M]]

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def scoped(self, ctx: AccessContext) -> Select:
        """The ONLY entry point to a query. RBAC §2.2d: role scope always
        applies before filters, so it is applied here and nowhere else."""
        stmt = select(self.model)
        if ctx.scope is Scope.ALL:
            return stmt
        rule = SCOPE_RULES.get(self.model)
        if rule is None:
            raise RuntimeError(
                f"{self.model.__name__} is reachable at scope={ctx.scope} "
                f"but declares no ScopeRule")     # fail closed, loudly
        if ctx.scope is Scope.TEAM:
            if rule.team is None:
                raise RuntimeError(f"{self.model.__name__} has no team scope rule")
            return rule.team(stmt, ctx.principal)
        return rule.own(stmt, ctx.principal)

    async def get_or_404(self, ctx: AccessContext, pk: UUID) -> M:
        """Single-record reads are scoped identically — otherwise scope is a
        list-screen decoration that an /{id} route walks straight past."""
        row = await self.session.scalar(self.scoped(ctx).where(self.model.id == pk))
        if row is None:
            raise NotFound()
        return row
```

`get_or_404` matters as much as the list path. A Manager at `own` scope guessing `/api/customers/{uuid}` gets a 404, because the scope predicate is in the `WHERE` clause, not a post-hoc check.

**The structural guarantee**, as a test:

```python
# tests/rbac/test_no_unscoped_queries.py
FORBIDDEN = re.compile(r"\bselect\s*\(", re.I)

def test_only_repositories_build_queries() -> None:
    offenders = [
        p for p in Path("src/cms").rglob("*.py")
        if p.name not in {"repository.py", "scope.py", "apply.py", "resolver.py"}
        and "alembic" not in p.parts
        and FORBIDDEN.search(p.read_text(encoding="utf-8"))
    ]
    assert not offenders, f"select() outside a repository: {offenders}"
```

### 3.6 The exhaustive matrix test

The strongest RBAC guarantee available is a generated test over every `(role × screen × action)` triple. It is what stops a route added in month nine from shipping without a permission declaration.

```python
# tests/rbac/test_matrix.py
@pytest.mark.parametrize("role", ["employee", "manager", "accountant", "hr", "superadmin"])
@pytest.mark.parametrize("screen", sorted(SCREENS))
async def test_screen_visibility_matches_seeded_policy(client, role, screen) -> None:
    route = ROUTE_FOR_SCREEN.get(screen)
    if route is None:
        pytest.fail(f"Screen {screen!r} is registered but no route declares it")
    async with as_role(client, role) as c:
        resp = await c.get(route.path_for_probe())
    expected = await seeded_visibility(role, screen)
    if expected:
        assert resp.status_code != 404, f"{role} should see {screen}"
    else:
        assert resp.status_code == 404, (
            f"{role} must not learn {screen} exists (got {resp.status_code})")

def test_every_route_declares_a_screen() -> None:
    undeclared = [r.path for r in app.routes
                  if isinstance(r, ScreenRoute) and r.screen_key is None]
    assert not undeclared
```

`ScreenRoute` (`core/routing.py`) is an `APIRoute` subclass that inspects its own dependencies at construction, records which `require_screen` it carries, and raises at import time if a non-public route has none. The app cannot boot with an unguarded endpoint.

---

## 4. The shared list-endpoint contract

RBAC §2.2 is a platform convention, not a per-module choice — "it's part of what makes a screen a list screen in this CMS at all." So it is one implementation, and a module supplies only a declaration.

### 4.1 Query parameters (identical on every list endpoint)

```python
# core/listing/query.py
class DatePreset(StrEnum):
    THIS_MONTH = "this_month"; LAST_MONTH = "last_month"; THIS_QUARTER = "this_quarter"
    THIS_FY = "this_fy"; LAST_FY = "last_fy"; ALL_FY = "all_fy"; CUSTOM = "custom"

class ListQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")     # a typo'd filter is a 422, not silence

    q: str | None = Field(None, max_length=200)
    date_preset: DatePreset | None = None
    date_from: date | None = None
    date_to: date | None = None
    status: list[str] = Field(default_factory=list)        # multi-select, always
    owner_id: list[UUID] = Field(default_factory=list)
    include_inactive: bool = False                          # defaults to Active only
    created_by: list[UUID] = Field(default_factory=list)    # Super Admin superset (§2.2e)
    modified_by: list[UUID] = Field(default_factory=list)
    include_archived: bool = False                          # Super Admin superset (§2.2e)

    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=200)
    sort: str | None = None                                 # "-created_at,name"
```

Module-specific filters subclass it (`AssetListQuery(ListQuery)` adds `category_id`, `purchase_value_min`, …), so the baseline can never be forgotten.

### 4.2 The per-resource declaration

```python
# modules/assets/listing.py
ASSET_LIST = ListSpec(
    model=Asset,
    screen="asset.directory",
    search_columns=(Asset.name, Asset.asset_code, Asset.serial_number),
    date_column=Asset.purchase_date,
    status_column=Asset.status,
    owner_column=Asset.assigned_to_id,
    active_column=Asset.is_active,
    sortable={"name": Asset.name, "code": Asset.asset_code,
              "purchase_date": Asset.purchase_date, "current_value": Asset.current_value},
    default_sort="-purchase_date",
    filters={
        "category_id": eq(Asset.category_id),
        "purchase_value_min": gte(Asset.purchase_value, requires_field="asset.purchase_value"),
        "purchase_value_max": lte(Asset.purchase_value, requires_field="asset.purchase_value"),
    },
    export_columns=(...),
)
```

`requires_field` implements RBAC §2.2b exception 2 verbatim — "if Purchase Value is hidden from Manager on the Asset Directory, the Purchase Value range filter goes with it. The field's visibility decides; the filter follows." The filter is dropped from the schema and rejected if submitted, automatically, from the Layer 3 grant.

Exception 1 ("a dimension where every row already belongs to the viewer") is equally mechanical: when `ctx.scope is Scope.OWN` and the spec's `owner_column` is the scoping column, the owner filter is suppressed.

### 4.3 Application — the fixed order

```python
# core/listing/apply.py
async def apply_list_query(
    session: AsyncSession, repo: ScopedRepository, ctx: AccessContext,
    spec: ListSpec, q: ListQuery,
) -> tuple[Sequence[Any], int, int, list[AppliedFilter]]:

    # 1. SCOPE FIRST — never negotiable (RBAC §2.2d).
    base = repo.scoped(ctx)
    scoped_total = await session.scalar(
        select(func.count()).select_from(base.subquery()))

    stmt, applied = base, []

    # 2. Filters, strictly inside that set.
    if q.q:
        term = f"%{q.q.lower()}%"
        stmt = stmt.where(or_(*[func.lower(c).like(term) for c in spec.search_columns]))
        applied.append(AppliedFilter("search", "Search", q.q))

    if window := resolve_date_window(q, spec, await current_fy(session)):
        stmt = stmt.where(spec.date_column.between(window.start, window.end))
        applied.append(AppliedFilter("date", spec.date_label, window.label))

    if q.status:
        stmt = stmt.where(spec.status_column.in_(q.status))
        applied.append(AppliedFilter("status", "Status", ", ".join(q.status)))

    if q.owner_id and spec.owner_column is not None and not spec.owner_filter_meaningless(ctx):
        stmt = stmt.where(spec.owner_column.in_(q.owner_id))
        applied.append(AppliedFilter("owner", spec.owner_label,
                                     await label_people(session, q.owner_id)))

    if spec.active_column is not None and not q.include_inactive:
        stmt = stmt.where(spec.active_column.is_(True))
        applied.append(AppliedFilter("active", "Status", "Active only"))

    for name, builder in spec.filters.items():
        if (value := getattr(q, name, None)) in (None, [], ""):
            continue
        if builder.requires_field and ctx.field_mode(builder.requires_field) is not FieldMode.SHOW:
            raise Forbidden(f"Filter {name!r} is unavailable for this role")
        stmt = builder.apply(stmt, value)
        applied.append(AppliedFilter(name, builder.label, builder.describe(value)))

    filtered_total = await session.scalar(
        select(func.count()).select_from(stmt.subquery()))

    # 3. Sort, then 4. paginate.
    stmt = apply_sort(stmt, spec, q.sort)
    rows = (await session.scalars(
        stmt.offset((q.page - 1) * q.page_size).limit(q.page_size))).all()

    return rows, filtered_total, scoped_total, applied
```

`resolve_date_window` reads Masters → Financial Year (§3.1) for the FY presets. RBAC §2.2c is explicit that these "never hardcode a date."

### 4.4 Response envelope

```python
class AppliedFilter(BaseModel):
    key: str          # for the chip's remove action
    label: str        # "Status"
    value: str        # "Open, In Progress"

class PageInfo(BaseModel):
    page: int; page_size: int; total_pages: int
    has_next: bool; has_prev: bool

class ListResponse(BaseModel, Generic[T]):
    data: list[T]
    page: PageInfo
    total: int                      # after filters — "24" of "Showing 24 of 312"
    scoped_total: int               # after scope, before filters — the "312"
    filters_applied: list[AppliedFilter]
    empty_reason: str | None        # §2.2c: never a bare "No records found"
    export: ExportAffordances       # {"pdf": true, "xlsx": true} — §2.2f, every role
```

`empty_reason` is server-built so the message is identical in the UI and in an export's header:

```python
def empty_reason(applied: list[AppliedFilter], scoped_total: int) -> str | None:
    if applied and scoped_total:
        return "No records match " + " and ".join(f"{f.label} = {f.value}" for f in applied)
    return None
```

This satisfies §2.2c literally: *"No tickets match Status = Closed and Date = This Month."*

### 4.5 Export — exactly the filtered set

```python
@router.post("/export", status_code=202, response_model=JobAccepted)
async def export_assets(
    fmt: ExportFormat,
    q: AssetListQuery = Depends(),
    ctx: AccessContext = Depends(require_screen("asset.directory", "export")),
    jobs: JobQueue = Depends(get_jobs),
) -> JobAccepted:
    # No "export everything" path exists — the same ListQuery, or nothing.
    job_id = await jobs.enqueue(
        "export_list",
        user_id=ctx.principal.user_id,      # NOT the resolved permissions
        screen=ctx.screen, spec="assets.directory",
        query=q.model_dump(mode="json"), fmt=fmt,
    )
    return JobAccepted(job_id=job_id)
```

**The worker re-resolves permissions for `user_id` rather than trusting a serialized `AccessContext`.** If Super Admin revoked someone's access in the seconds between request and execution, the export must reflect the revocation. It then calls the *same* `apply_list_query` — there is no second query path that could drift from the screen.

The header block is generated from the same `AppliedFilter` list the chips came from:

```python
def export_header(applied, filtered, scoped, exporter, when, company) -> ExportHeader:
    return ExportHeader(
        title=spec.label,
        filters=[f"{f.label}: {f.value}" for f in applied] or ["No filters applied"],
        result_count=f"{filtered} of {scoped} records",
        exported_by=exporter.display_name,
        exported_at=when.strftime("%d-%m-%Y %H:%M"),
        letterhead=company.letterhead,     # Masters §3.6 — PDF only
    )
```

§2.2f: *"A spreadsheet of 24 rows that doesn't say it was filtered to one month is actively misleading once it's been emailed to someone."* PDF via WeasyPrint with the Company Profile letterhead; XLSX via `xlsxwriter` in `constant_memory` mode, one row per record, no formatting — a plain data export, per spec. Money columns get the left alignment mandated by §2.2c-i, set once in the shared writer.

---

## 5. Auth

### 5.1 Token design

Short-lived JWT access token + opaque, rotating, revocable refresh token in MySQL, delivered as an `HttpOnly; Secure; SameSite=Lax` cookie.

> **As built — bearer headers, not cookies (deliberate deferral).** This section bundles two separable decisions, and only one of them is built:
> 1. **Server-side revocability — BUILT** (migration `0008_auth_hardening.py`, `app/services/auth_tokens.py`, `app/api/v1/auth.py`). 15-minute access JWT (`access_token_expire_minutes = 15` in `app/core/config.py`; was 8 h with no revocation before Phase 7 hardening round 2) + an opaque `secrets.token_urlsafe(32)` refresh token stored in `refresh_tokens` as a **SHA-256 hash** (fast hash on purpose — it protects a 256-bit random value, not a guessable password), 30-day expiry, **single-use rotation** (`rotate_refresh_token` marks the old row `revoked_at` in the same step, so a stolen-then-reused old token fails), and the rotation path **re-checks `user.is_enabled`**, so disabling a login cuts every session within one access-token lifetime.
> 2. **Cookie delivery — DEFERRED.** Tokens are returned in the JSON body and presented as `Authorization: Bearer` headers (`OAuth2PasswordBearer` in `app/auth/deps.py`). Reasoning, recorded in migration 0008's docstring: an HttpOnly/Secure/SameSite cookie is meaningless before a browser client exists to receive and use it — the Angular frontend is not started — and switching the delivery mechanism belongs with that frontend's auth-interceptor work, not a backend-only hardening pass. Bearer delivery also keeps every existing curl/test pattern working. Revisit when the Angular app is built.

The refresh token is a database row rather than a JWT because three requirements demand server-side revocation: disabling an account must cut sessions immediately (Employee §2.2, "it immediately blocks that person from logging in"), `Last Login` must be recorded, and exit processing must terminate access on the spot.

> **As built:** all three of those requirements are now satisfied — revocation as above, and `last_login_at` is set on every successful `/auth/login` (it was never recorded before Phase 7 hardening round 2). Login is also constant-time: `verify_password` always runs, against the real hash or a precomputed argon2id `DUMMY_PASSWORD_HASH` (`app/auth/security.py`), so a nonexistent or disabled account is indistinguishable from a wrong password by response timing (CWE-208, confirmed exploitable by the security audit before this fix). Additionally — not in this document's §5 at all — `/auth/login` is **rate-limited** (`app/core/rate_limit.py`): Redis fixed-window, 5 failed attempts per 15 minutes, keyed **per-account and per-source-IP independently**, failures-only, reset on success, and **failing open** with a logged warning if Redis is unreachable (a defense-in-depth control must not become a second single point of failure for login). ARCH-3 §9.4's nginx `limit_req` remains worth layering on top once a droplet exists — nginx is IP-only and does nothing against a botnet spreading guesses across source IPs, which is exactly what the per-account key covers.

```python
# auth/tokens.py
class AccessClaims(BaseModel):
    sub: UUID          # user id
    emp: UUID | None   # employee id — what scope rules resolve against
    role: str
    pv: int            # permissions_version at issue
    mcp: bool          # must_change_password
    jti: UUID
    exp: int           # +15 minutes
```

> **As built:** the access JWT carries only `sub` (user id) and `exp` (`create_access_token` in `app/auth/security.py`) — no `emp`/`role`/`pv`/`mcp`/`jti` claims. `get_current_user` loads the `User` row from the DB on every request anyway (it must, to enforce `is_enabled` and `must_change_password` live), so role and employee-id come from the row, not the token, and there is no stale-claim window to reason about. The richer claim set can be added when a consumer actually needs it.

```python
async def get_principal(
    token: Annotated[str, Depends(bearer)],
    session: AsyncSession = Depends(get_session),
) -> Principal:
    claims = decode_access(token)                       # raises 401 on bad sig/expiry

    # Forced change on first login gates the entire API surface.
    if claims.mcp and _current_route(request) not in PASSWORD_CHANGE_ALLOWLIST:
        raise PasswordChangeRequired()                  # 403, code=must_change_password

    user = await session.get(User, claims.sub)
    if user is None or not user.is_enabled:
        raise Unauthorized()                            # disabled mid-session -> out
    return Principal(user.id, user.employee_id, user.role_key)
```

`PASSWORD_CHANGE_ALLOWLIST` is `{POST /auth/password/change, POST /auth/logout, GET /auth/me}` and nothing else. Employee §3.6 step 4: *"Instead of reaching the normal dashboard, they're taken straight to the Change Own Password form ... before doing anything else."* Enforcing that only client-side would make it decorative.

> **As built:** the allowlist gate IS enforced, in `get_current_user` (`app/auth/deps.py`) — a `must_change_password` account gets 403 on everything except the allowlist (the security audit found the flag was previously set and cleared but never checked in between, so a temporary password worked as a fully-privileged credential indefinitely). Two differences from the text above: the built allowlist is `{("POST", "/api/v1/auth/change-password")}` only — `/auth/logout` needs no entry because it takes no auth dependency at all (the refresh token being surrendered is itself the credential), and `GET /auth/me` does not exist as an endpoint.

`pv` in the token is advisory. The resolver always reads the live version, so a permission change takes effect on the very next request — it does not wait for token expiry.

### 5.2 Passwords

`argon2id` via `argon2-cffi` (`time_cost=3, memory_cost=64 MiB, parallelism=4`). A `password_hashes` history table of the last N hashes blocks reuse. Verification is constant-time and runs a dummy hash on unknown users so login timing does not enumerate accounts.

> **As built:** all of this is implemented, with these exact parameters (`app/auth/security.py`), plus one addition this document didn't specify: the codebase started on bcrypt (Phases 0–6), and there is no way to convert a bcrypt hash to argon2id without the plaintext, so instead of forcing a mass password reset the code does the standard **lazy migration** — `verify_password` detects the hash prefix and dispatches to the matching verifier (bcrypt or argon2id), and a successful login transparently rehashes to argon2id (`needs_rehash` in `security.py`, applied in `/auth/login`). `needs_rehash` also catches argon2id hashes whose stored parameters drift from the configured ones after a future tuning change. History table is `password_history` (migration 0008), N pinned to **5** (`PASSWORD_HISTORY_LIMIT` in `app/services/auth_tokens.py` — a service-layer trim, not a DB constraint). The dummy-hash constant-time verification is built exactly as described.

### 5.3 Temporary password on account creation

Employee §2.2: *"HR never sees or relays the password itself — it goes straight to the employee."* That is an architectural constraint, not a UI nicety: the generated password must never enter a response body, a log line, or an audit row.

```python
# modules/employees/service.py
async def enable_login(self, ctx: AccessContext, employee_id: UUID,
                       role_key: str) -> None:
    guard_write(ctx, ...)
    employee = await self.repo.get_or_404(ctx, employee_id)
    if not employee.email:
        raise ValidationError("Login Email mirrors Email — set an email address first")

    temp = secrets.token_urlsafe(12)                 # never returned, never logged
    user = User(
        employee_id=employee.id,
        email=employee.email.lower(),
        role_key=role_key,
        password_hash=hash_password(temp),
        must_change_password=True,                   # §2.2 "Must Change Password on Next Login"
        password_is_temporary=True,
        temp_password_expires_at=utc_now() + timedelta(days=7),
        is_enabled=True,
    )
    self.session.add(user)
    await self.session.flush()

    # Two distinct triggers, both rows in Masters §3.21 Email Templates.
    await self.notifier.notify("welcome_email", user, {"first_name": employee.first_name})
    await self.notifier.notify(
        "temporary_password", user,
        {"first_name": employee.first_name, "temporary_password": temp,
         "login_url": settings.app_url, "expires_in": "7 days"},
        sensitive=True,          # excluded from the Recent Sends body preview
    )
    self.uow.record_audit(AuditEntry(
        action="login.created", entity="employee", entity_id=employee.id,
        actor=ctx.principal.user_id, detail={"role": role_key}))   # no password material
```

`sensitive=True` makes the `email_sends` row store the rendered *subject* and delivery status but not the body — otherwise the Recent Sends tab (Masters §3.21) becomes a plaintext password store.

### 5.4 Reset Password

Employee §2.2 changed this deliberately from a reset *link* to the same generate-and-email mechanism: *"so there's one consistent mechanism instead of two different ones for what's conceptually the same need."* So `POST /auth/password/reset-request` and the HR-initiated `POST /employees/{id}/reset-password` converge on one internal function:

```python
async def issue_temporary_password(self, user: User, *, actor: UUID | None) -> None:
    temp = secrets.token_urlsafe(12)
    user.password_hash = hash_password(temp)
    user.must_change_password = True
    user.password_is_temporary = True
    user.temp_password_expires_at = utc_now() + timedelta(days=7)
    await self.tokens.revoke_all_for(user.id)          # every existing session dies
    await self.notifier.notify("password_reset", user,
                               {"first_name": user.first_name,
                                "temporary_password": temp}, sensitive=True)
```

The self-service endpoint always returns `204` regardless of whether the email exists, and is rate-limited per-IP and per-email — otherwise it is an account-enumeration oracle.

> **As built:** the self-service `POST /auth/password/reset-request` is **NOT built**. Only the HR-initiated path exists — `POST /employees/{id}/reset-password` (`app/api/v1/employees.py`), which follows the generate-temp-password-and-email mechanism described here (the temp password is emailed, never returned in the response body). Self-service reset is a genuinely new feature (unauthenticated endpoint, its own enumeration-resistant rate limiting), deferred rather than half-built; when it is added it should converge on the same internal issue-temporary-password function as this section prescribes.

### 5.5 Completing the forced change

```python
@router.post("/password/change", status_code=204)
async def change_password(body: PasswordChangeIn,
                          principal: Principal = Depends(get_principal_allow_mcp),
                          svc: AuthService = Depends(get_auth_service)) -> None:
    await svc.change_own_password(principal, body.current_password, body.new_password)
```

On success: `must_change_password = False`, `password_is_temporary = False`, all *other* refresh tokens revoked, current session re-issued. Employee §3.6: *"Once saved, Must Change Password on Next Login flips to No, and every login after this one goes straight through as normal."*

> **As built:** `POST /api/v1/auth/change-password` (`app/api/v1/auth.py`) does all of this with one simplification: it revokes **ALL** of the user's refresh tokens, including the caller's own, rather than "all *other*" — the endpoint isn't sent the caller's refresh token today, and threading it through just to spare one row buys nothing: the caller's 15-minute access token keeps working either way, so the security outcome is identical and the code is simpler. Reuse of any of the last 5 passwords (or the current one) is rejected with 422. The endpoint requires only login, no RBAC screen gate — it isn't a screen, it's every account's own credential.

---

## 6. The two calculation engines

Both are **pure functions over configuration and inputs**, in packages with no SQLAlchemy import. Data is loaded by the service, passed in as frozen dataclasses, and the engine returns a result plus a trace. This is what makes the golden-file testing in §10 possible, and it is why they can be tested without a database at all.

### 6.1 Tax engine — `modules/masters/taxes/engine/`

Masters §3.2 is emphatic: *"it names no tax, proposes no rate, and assumes no country's tax structure… The system is not aware that any specific tax exists."* The engine's public types therefore contain no tax name anywhere.

```python
# engine/types.py
class TaxScopeKind(StrEnum):
    SALES = "sales"; PURCHASE = "purchase"; SALES_AND_PURCHASE = "sales_and_purchase"
    PAYROLL_EMPLOYEE_DEDUCTION = "payroll_employee_deduction"
    PAYROLL_EMPLOYER_CONTRIBUTION = "payroll_employer_contribution"
    PAYROLL_INCOME_TAX = "payroll_income_tax"
    EMPLOYEE_DECLARATION = "employee_declaration"

class TaxType(StrEnum):
    GST_IGST = "gst_igst"; GST_CGST_SGST = "gst_cgst_sgst"
    PERCENTAGE = "percentage"; FIXED_AMOUNT = "fixed_amount"
    SLAB = "slab"; DECLARATION_CAP = "declaration_cap"

class SlabApplication(StrEnum):
    PROGRESSIVE = "progressive"; FLAT_BY_BAND = "flat_by_band"

@dataclass(frozen=True, slots=True)
class SlabBand:
    band_from: Decimal
    band_to: Decimal | None          # None == "and above"; exactly one, and it must be last
    value: Decimal
    label: str | None = None

@dataclass(frozen=True, slots=True)
class SplitComponent:
    name: str
    share_pct: Decimal
    applies_when: Literal["always", "conditional"] = "always"
    condition: Condition | None = None

@dataclass(frozen=True, slots=True)
class ReliefRule:
    name: str
    threshold: Decimal
    kind: Literal["reduce_by", "reduce_to_zero", "cap_at"]
    amount: Decimal | None

@dataclass(frozen=True, slots=True)
class TaxHead:
    id: UUID
    name: str
    tax_type: TaxType
    scope: TaxScopeKind
    applies_from: date
    applies_until: date | None
    rate: Decimal | None = None
    cgst_rate: Decimal | None = None
    sgst_rate: Decimal | None = None
    fixed_amount: Decimal | None = None
    declaration_cap: Decimal | None = None
    slab_application: SlabApplication | None = None
    bands: tuple[SlabBand, ...] = ()
    components: tuple[SplitComponent, ...] = ()
    reliefs: tuple[ReliefRule, ...] = ()
    print_label: str | None = None

@dataclass(frozen=True, slots=True)
class TaxLine:
    head_id: UUID
    print_label: str
    base: Decimal
    amount: Decimal
    components: tuple[ComputedComponent, ...]
    trace: TaxTrace              # persisted verbatim onto the document/payslip
```

```python
# engine/methods.py
def compute(head: TaxHead, base: Decimal, ctx: TaxContext) -> TaxLine:
    if not head.is_in_force(ctx.as_of):
        raise HeadNotInForce(head.id, ctx.as_of)

    steps: list[TraceStep] = []
    match head.tax_type:
        case TaxType.PERCENTAGE | TaxType.GST_IGST:
            amount = pct(base, head.rate)
            steps.append(TraceStep("rate", f"{base} × {head.rate}% = {amount}"))
        case TaxType.GST_CGST_SGST:
            # Spec: SGST must equal CGST. Validated on save; asserted here too.
            amount = pct(base, head.cgst_rate) + pct(base, head.sgst_rate)
            steps.append(TraceStep("split_rate",
                f"CGST {head.cgst_rate}% + SGST {head.sgst_rate}% on {base} = {amount}"))
        case TaxType.FIXED_AMOUNT:
            amount = head.fixed_amount
            steps.append(TraceStep("fixed", f"flat {amount}"))
        case TaxType.SLAB:
            amount, band_steps = apply_slabs(head.bands, head.slab_application, base)
            steps.extend(band_steps)
        case TaxType.DECLARATION_CAP:
            amount = min(base, head.declaration_cap)
            steps.append(TraceStep("cap", f"min({base}, {head.declaration_cap}) = {amount}"))

    amount, relief_steps = apply_reliefs(head.reliefs, base, amount)
    steps.extend(relief_steps)

    amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    components = split(head.components, amount, ctx)

    return TaxLine(head.id, head.print_label or head.name, base, amount, components,
                   TaxTrace(head_snapshot=snapshot(head), steps=tuple(steps)))
```

```python
# engine/slabs.py
def apply_slabs(bands, application, base) -> tuple[Decimal, list[TraceStep]]:
    ordered = sorted(bands, key=lambda b: b.band_from)
    validate_continuity(ordered)          # no overlaps, no gaps — Masters §3.2b

    if application is SlabApplication.FLAT_BY_BAND:
        band = next(b for b in ordered if b.contains(base))
        amt = pct(base, band.value)
        return amt, [TraceStep("flat_by_band",
                               f"{base} in [{band.band_from}, {band.band_to}] "
                               f"→ {band.value}% on whole base = {amt}")]

    total, steps = Decimal(0), []
    for b in ordered:
        if base <= b.band_from:
            break
        upper = base if b.band_to is None else min(base, b.band_to)
        portion = upper - b.band_from
        if portion <= 0:
            continue
        part = pct(portion, b.value)
        total += part
        steps.append(TraceStep("band",
            f"{b.label or f'{b.band_from}–{b.band_to or "∞"}'}: "
            f"{portion} × {b.value}% = {part}"))
    return total, steps
```

**Three properties the engine guarantees, each from an explicit spec line:**

1. **Empty configuration is valid, not an error.** *"Payroll and Invoice both handle an empty Taxes list without breaking — they simply produce documents with no tax lines… There is no built-in default anywhere in this CMS."* `resolve_heads()` returning `[]` yields zero tax lines and no warning.
2. **Heads lock once used.** `TaxHeadService.update()` checks `EXISTS (SELECT 1 FROM tax_line_usages WHERE head_id = …)` and rejects any change to a numeric field for everyone including Super Admin, offering the Duplicate route instead. Backed by a DB trigger, since this is a data-integrity lock, not a permission.
3. **Every computation is reproducible.** `TaxTrace.head_snapshot` — the full head config as JSONB — is written onto the invoice line or payslip line. Payroll §2.1: *"A processed payslip records the configuration that produced it, not just the result."*

> **As built:** "JSONB" is a Postgres-era term that survived drafting — the target has always been MySQL 8, so snapshots/traces are stored in MySQL `JSON` columns. Same guarantee, different column type. (The same substitution applies wherever this document says `jsonb` or `timestamptz`: MySQL `JSON` and `DATETIME(6)` respectively.)

`Decimal` everywhere, `NUMERIC(18,4)` in MySQL, rounding only at the final quantize. Floats are banned by a lint rule over the engine packages.

**One gap to carry forward, flagged in the spec and not silently absorbed:** Payroll §2.1(6) records that marginal-relief tapering above a relief threshold *"is the one calculation shape the current design cannot express."* `ReliefRule` should be left open for a `taper_rate` field rather than the engine being written as if the shape were complete.

### 6.2 Payroll engine — `modules/payroll/engine/`

A linear pipeline of pure steps, each appending to a trace. Every step is independently testable.

```python
# engine/pipeline.py
STEPS: tuple[PayrollStep, ...] = (
    ResolvePayPeriod(),        # Masters §3.20 Pay Cycle — 26th→25th, NOT the calendar month
    ResolveWorkWeekPolicy(),   # narrowest matching policy wins over Company-wide
    ReconcileAttendance(),     # hours, not days
    ComputeEarnings(),         # Salary Structure, effective-dated
    ApplyAdhocAdjustments(),   # §2.1a, incl. Recurring
    ComputeStatutory(),        # every employee-deduction / employer-contribution head
    ComputeIncomeTax(),        # annualise → reduce → slab → relief → ÷ remaining months
    ApplyLossOfPay(),          # uncompensated shortfall, per the policy setting
    ComputeNetPay(),
)

def run_for_employee(inp: EmployeePayrollInput) -> PayslipDraft:
    state = PayrollState.initial(inp)
    for step in STEPS:
        state = step(state)          # frozen dataclass in, frozen dataclass out
    return state.to_draft()
```

**Pay period resolution** — Masters §3.20 is precise, and the cutoff rule is the part that bites:

```python
# engine/paycycle.py  (lives in masters/workweek, consumed here)
def resolve_period(cycle: PayCycle, month: int, year: int) -> PayPeriod:
    if cycle.cycle_type is CycleType.CALENDAR_MONTH:
        start = date(year, month, 1)
        end = date(year, month, monthrange(year, month)[1])
    else:
        prev_y, prev_m = (year, month - 1) if month > 1 else (year - 1, 12)
        start = date(prev_y, prev_m, min(cycle.start_day, monthrange(prev_y, prev_m)[1]))
        end   = date(year, month,   min(cycle.end_day,   monthrange(year, month)[1]))

    # Clamped, per spec: "a Credit Day of 30 or 31 still resolves inside February,
    # rather than silently rolling into March."
    credit = date(year, month, min(cycle.salary_credit_day, monthrange(year, month)[1]))
    return PayPeriod(start=start, end=end, salary_credit_date=credit,
                     label=f"{calendar.month_name[month]} {year}")
```

The cutoff reconciliation rule — *"any event with a date falling after the End Day belongs to the next pay period, never the one that just closed"* — needs no special handling anywhere. Every dated input (leave, attendance corrections, comp make-up days, ad-hoc adjustments) is fetched with `WHERE event_date BETWEEN period.start AND period.end`. The date alone decides which run picks it up, exactly as the spec requires, and no one has to remember to move anything.

**Attendance reconciliation** is hours-based. Payroll §2.4: *"Hours are the unit of account here, not days. A day is only ever a display convenience."*

```python
# engine/attendance.py
def reconcile(policy: WorkWeekPolicy, cal: PeriodCalendar,
              punches: Sequence[DayRecord], leave: Sequence[LeaveDay],
              comp: Sequence[CompRequest]) -> AttendanceResult:

    required = sum(cal.required_hours_for(d) for d in cal.days)   # 0 on Sun/even-Sat/mandatory holiday
    worked   = sum(max(Decimal(0), (p.out - p.inp) - policy.unpaid_break) for p in punches)
    leave_cr = Decimal(len(leave)) * policy.net_hours_per_day

    # "of which Comp" — a SUBSET of worked, never added. Double-counting here
    # silently overpays, which is why the spec calls it out explicitly.
    comp_of_which = sum(c.hours for c in comp if c.status is CompStatus.APPROVED)

    credited = worked + leave_cr
    balance  = credited - required

    pending  = sum(c.hours for c in comp if c.status is CompStatus.PENDING)
    return AttendanceResult(
        required=required, worked=worked, comp_of_which=comp_of_which,
        leave_credit=leave_cr, credited=credited, balance=balance,
        # A pending request SUSPENDS the deduction; it does not cancel it.
        deductible_shortfall=max(Decimal(0), -balance - pending),
        suspended_shortfall=min(pending, max(Decimal(0), -balance)),
    )
```

**Saturday calendar** resolution, with the collision rule from §3.20 — *"a Mandatory holiday always overrides the Saturday rule"*, and an Optional holiday does not:

```python
def required_hours_for(self, d: date) -> Decimal:
    if d.weekday() in self.policy.weekly_off_days:
        return Decimal(0)
    if h := self.holidays.get(d):
        if h.is_mandatory:
            return Decimal(0)                       # overrides everything, incl. Saturday
    if d.weekday() == SATURDAY:
        if ov := self.saturday_overrides.get(d):    # an explicit, reason-carrying override
            return ov.hours_required if ov.to_working else Decimal(0)
        if not self.policy.saturday_rule.is_working(nth_weekday_of_month(d)):
            return Decimal(0)
        return self.policy.saturday_hours           # full / half / custom
    return self.policy.net_hours_per_day
```

**Income tax**, Payroll §2.1(6), in order — annualise, subtract only what a head *permits*, apply the head's own calculation, apply reliefs, divide by remaining months. And critically: *"If no income-tax head is configured, this step produces nothing and is skipped entirely — no error, no zero-line on the payslip."*

**Concurrency.** A payroll run takes a MySQL advisory lock so two Accountants cannot run the same period twice:

```python
async with advisory_lock(session, key=("payroll", year, month)):
    ...
```

and the already-processed skip (§2.1.7) is a partial unique index, so the invariant holds even if the lock is somehow bypassed:

```sql
CREATE UNIQUE INDEX payslip_one_processed_per_period
  ON payslips (employee_id, period_year, period_month)
  WHERE status = 'processed';
```

> **As built:** this `CREATE UNIQUE INDEX … WHERE` is Postgres syntax — **MySQL has no partial indexes**, so the invariant cannot be expressed this way on the actual target database. The built enforcement of "one processed payslip per employee per period" lives in the service/engine layer (see `app/services/payroll_engine.py` and the payroll run flow in `app/api/v1/payroll_runs.py`). If a DB-level backstop is wanted later, the MySQL equivalents are a generated column (`NULL` unless `status='processed'`) under a plain unique index, or a functional index over such an expression.

**Reissue** writes to the append-only `payslip_reissue_history` (date, reissued_by, reason, old figures, new figures) — the same accountability pattern the spec names for asset assignment history and leave balance adjustments. `UPDATE`/`DELETE` are revoked from the app role.

---

## 7. Mailgun, driven by the Email Configuration master

### 7.1 The rule that shapes the design

Masters §3.21: *"Off silences only this specific email. The in-app notification for the same event still fires — Enabled here never suppresses in-app awareness of the underlying event, only its email copy."*

Therefore **no module ever calls the email service.** Modules call `NotificationService.notify()`, which always writes the in-app notification and only then *considers* email. There is no code path that can accidentally couple the two.

```python
# core/notify/service.py
class NotificationService:
    async def notify(self, trigger: str, recipient: User,
                     context: dict[str, Any], *, sensitive: bool = False) -> None:
        # 1. In-app ALWAYS. Not conditional on anything in Email Configuration.
        self.session.add(InAppNotification(
            user_id=recipient.id, trigger=trigger,
            title=render_inapp_title(trigger, context),
            body=render_inapp_body(trigger, context),
            created_at=utc_now(),
        ))

        # 2. Email is a separate, silenceable copy.
        server = await self.email_config.server_settings()
        if not server.sending_enabled:                 # master switch
            return
        template = await self.email_config.template(trigger)
        if template is None or not template.enabled:   # per-trigger switch
            return

        await self.jobs.enqueue("send_email",
            to=recipient.email, trigger=trigger,
            context=context, sensitive=sensitive)
```

### 7.2 Safe placeholder rendering

Templates are edited at runtime by Super Admin. **Do not render them with Jinja2** — a runtime-editable Jinja template is a server-side template injection primitive, and Jinja reaches Python objects through attribute access. Use a closed substitution over a declared placeholder set:

```python
# core/mail/renderer.py
PLACEHOLDER = re.compile(r"\{\{\s*([a-z0-9_]{1,40})\s*\}\}")

TRIGGER_PLACEHOLDERS: dict[str, frozenset[str]] = {
    "temporary_password": frozenset({"first_name", "temporary_password", "login_url", "expires_in"}),
    "payslip_available":  frozenset({"first_name", "month", "year", "net_pay", "salary_credit_date"}),
    "ticket_assigned":    frozenset({"first_name", "ticket_no", "subject", "priority"}),
    # ... one entry per Email Templates row
}

def render(trigger: str, template: str, context: Mapping[str, Any]) -> str:
    allowed = TRIGGER_PLACEHOLDERS[trigger]
    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in allowed:
            return m.group(0)          # unknown placeholder renders literally, never raises
        return html.escape(str(context.get(key, "")))
    return PLACEHOLDER.sub(sub, template)

def validate_template(trigger: str, subject: str, body: str) -> list[str]:
    """Called on save so Super Admin sees unknown placeholders before sending."""
    used = {m.group(1) for m in PLACEHOLDER.finditer(subject + body)}
    return sorted(used - TRIGGER_PLACEHOLDERS[trigger])
```

The template-edit endpoint returns the unknown-placeholder list as a warning, so a typo is caught on the Masters screen rather than in a delivered email.

### 7.3 Transport

```python
# core/mail/mailgun.py
class MailgunTransport:
    def __init__(self, client: httpx.AsyncClient, settings: MailgunSettings) -> None: ...

    async def send(self, msg: OutboundMessage) -> ProviderReceipt:
        resp = await self.client.post(
            f"{self.settings.base_url}/v3/{self.settings.domain}/messages",
            auth=("api", self.settings.api_key.get_secret_value()),
            data={
                "from": f"{msg.from_name} <{msg.from_email}>",
                "to": msg.to, "subject": msg.subject, "text": msg.body_text,
                "h:Reply-To": msg.reply_to or "",
                "v:trigger": msg.trigger,          # echoed back on webhooks
                "v:send_id": str(msg.send_id),
                "o:tag": [msg.trigger],
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return ProviderReceipt(provider_id=resp.json()["id"])
```

**Credential handling.** Masters §3.21 lists Provider as a dropdown with an API Key field, and marks the password *"Never shown in full once saved."* Store the Mailgun API key encrypted (`pgcrypto`, or an app-level Fernet key from the environment), never return it from any endpoint — return `sk_…last4` — and hold the domain and base URL as ordinary settings.

> **As built:** the app-level **Fernet** option was chosen (`pgcrypto` is Postgres-only and off the table on MySQL) — `app/services/crypto.py` encrypts `EmailServerSettings.password_encrypted`/`api_key_encrypted` with the key from `credential_encryption_key`. That setting has **no source default** (`app/core/config.py`): it must come from the environment or the app refuses to start. The Phase 7 security review found a real Fernet key had been baked into source as the default — meaning any deployment that forgot the env var would silently encrypt production credentials with a publicly-known key — so the default was removed, matching the "must be set" posture `secret_key` already had. Server Settings is Super Admin only (§3.21 Role Access), so the read endpoint is behind `require_screen("masters.email.server", "view")` and still redacts.

**Recent Sends** is `email_sends(id, trigger, recipient, subject, status, provider_id, sent_at, error)`. A Mailgun webhook at `POST /webhooks/mailgun` — signature-verified with HMAC-SHA256 over `timestamp + token`, with a replay window and a seen-token cache — updates `status` to Delivered/Bounced. Per §3.21 this is a troubleshooting log, not a volume report, so it carries no aggregation endpoints.

`Send Test Email` posts to `POST /masters/email-config/test` with a target address, sends through the live configuration, and records a row like any other send.

---

## 8. Local file storage on the droplet

### 8.1 Layout — content-addressed blobs, referenced by attachments

```
/srv/cms/
├── blobs/                       # immutable, content-addressed, deduped
│   └── a3/f9/a3f9c8...e21       # sha256, no extension, mode 0640
├── derived/                     # regenerable: PDF renders, thumbnails, exports
│   └── exports/2026/07/{job_id}.xlsx
└── tmp/                         # in-flight uploads, same filesystem as blobs
```

Two tables:

```sql
file_blobs(sha256 char(64) PK, byte_size bigint, mime text,
           created_at timestamptz, ref_count int NOT NULL DEFAULT 0)

file_attachments(id uuid PK, blob_sha256 references file_blobs,
                 entity_type text, entity_id uuid,        -- 'employee_document', 'expense_receipt'
                 original_filename text, uploaded_by uuid,
                 uploaded_at timestamptz, deleted_at timestamptz NULL)
```

**Dedupe is the point of the split.** The same 4 MB policy PDF attached to 60 employee records is one blob and 60 attachment rows. `ref_count` is maintained in the same transaction as the attachment row; a nightly sweeper deletes blobs at `ref_count = 0` older than 7 days (the delay makes the operation forgiving of a bug).

Content addressing also makes uploads idempotent — a retried upload writes the same path and costs nothing.

**Never derive the served path from user input.** The filename is a column; the path is `sha256`. Path traversal is structurally impossible.

### 8.2 Validation

```python
# core/files/validation.py
MAX_BYTES = 5 * 1024 * 1024        # Employee §2.6: "PDF, JPG, or PNG, up to 5 MB"

ALLOWED = {
    "application/pdf": {".pdf"},
    "image/jpeg":      {".jpg", ".jpeg"},
    "image/png":       {".png"},
}
# Deliberately excluded: SVG (script-bearing), HTML, anything archive-like.

async def validate_and_store(upload: UploadFile, *, purpose: FilePurpose) -> StoredBlob:
    tmp = Path("/srv/cms/tmp") / f"{uuid4()}.part"
    digest, size = hashlib.sha256(), 0
    try:
        async with aiofiles.open(tmp, "wb") as fh:
            while chunk := await upload.read(64 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:               # enforced while streaming, never buffered whole
                    raise FileTooLarge(MAX_BYTES)
                digest.update(chunk)
                await fh.write(chunk)

        # Sniff magic bytes. The client-supplied content-type is a hint, not evidence.
        sniffed = magic.from_file(str(tmp), mime=True)
        if sniffed not in ALLOWED:
            raise UnsupportedFileType(sniffed)
        if Path(upload.filename or "").suffix.lower() not in ALLOWED[sniffed]:
            raise ExtensionMismatch(upload.filename, sniffed)

        sha = digest.hexdigest()
        final = blob_path(sha)
        final.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
        if not final.exists():
            os.replace(tmp, final)                 # atomic, same filesystem
            os.chmod(final, 0o640)
        else:
            tmp.unlink()                           # dedupe hit
        return StoredBlob(sha256=sha, size=size, mime=sniffed)
    finally:
        tmp.unlink(missing_ok=True)
```

`/srv/cms/blobs` is `chmod 0750`, owned by the app user, and mounted `noexec,nosuid,nodev`.

### 8.3 Serving with authorization

The blob directory is **not** in any nginx `root`. Authorization happens in FastAPI; the bytes are handed to nginx via `X-Accel-Redirect`, so Python never streams file content:

```python
@router.get("/files/{attachment_id}")
async def download(
    attachment_id: UUID,
    principal: Principal = Depends(get_principal),
    svc: FileService = Depends(get_file_service),
) -> Response:
    # Authorization is delegated to the OWNING entity's screen + scope, not to the
    # file. A receipt on an expense is visible exactly when that expense is.
    att = await svc.authorize_download(principal, attachment_id)
    return Response(
        status_code=200,
        headers={
            "X-Accel-Redirect": f"/internal-blobs/{att.blob_sha256[:2]}/"
                                f"{att.blob_sha256[2:4]}/{att.blob_sha256}",
            "Content-Type": att.mime,
            "Content-Disposition":
                f'attachment; filename="{sanitize(att.original_filename)}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=0, no-store",
        },
    )
```

```nginx
location /internal-blobs/ {
    internal;                        # unreachable from outside; only X-Accel can enter
    alias /srv/cms/blobs/;
}
```

`authorize_download` resolves the owning entity and re-runs the normal screen + scope check against it — so a Manager at Team scope cannot fetch a direct report's-manager's employee document by guessing an attachment UUID. `Content-Disposition: attachment` plus `nosniff` plus the sandbox CSP means even a mislabelled file cannot execute in the app's origin.

### 8.4 Backup

| What | How | Cadence |
|---|---|---|
| MySQL | `mysqldump --single-transaction --routines --triggers` nightly, plus binlog shipping to DO Spaces for point-in-time recovery | Continuous + nightly |
| Blobs | `restic backup /srv/cms/blobs` → DO Spaces, `--read-concurrency 4` | Nightly |
| Derived | Not backed up — regenerable by design | — |
| Config | Env/secrets in a sealed store, never on the droplet unencrypted | On change |

Blobs are append-only and content-addressed, so restic's dedupe makes incrementals near-free. `restic check --read-data-subset=5%` weekly, and a scripted quarterly restore drill into a scratch droplet — an untested backup is not a backup. Retention: 7 daily, 4 weekly, 12 monthly.

---

## 9. Background jobs

**Use `arq`.** It is asyncio-native, so jobs reuse the same async SQLAlchemy session factory, repositories and engines as the API — no second data-access stack. Celery's prefork model would force a sync SQLAlchemy engine alongside the async one, which means every repository written twice. That duplication is a far larger long-run cost than anything Celery's extra features buy at this scale.

```python
# core/jobs/worker.py
class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [run_payroll, export_list, generate_pdf, send_email,
                 recalculate_income_tax, sweep_orphan_blobs]
    cron_jobs = [
        cron(sweep_orphan_blobs,        hour=3, minute=0),
        cron(refresh_saturday_calendar, hour=2, minute=0),   # rolls at FY boundary
        cron(expire_temp_passwords,     hour=1, minute=0),
    ]
    max_jobs = 10
    job_timeout = 1800                 # payroll for a few hundred employees
    keep_result = 3600
    on_startup = startup   # engine, session factory, mailgun client
    on_shutdown = shutdown
```

**Queue separation.** Two worker processes on the droplet against different Redis queues: `interactive` (email, notifications — low latency, high concurrency) and `heavy` (payroll, exports, PDF — `max_jobs=2`, so a 400-person payroll run cannot starve password-reset emails).

**A user-visible job table**, because the UI must poll export and payroll progress:

```sql
job_runs(id uuid PK, kind text, status text, requested_by uuid,
         params jsonb, progress_current int, progress_total int,
         result_attachment_id uuid NULL, error text NULL,
         idempotency_key text UNIQUE NULL, created_at, started_at, finished_at)
```

**Rules every job follows:**

- **Idempotent.** `idempotency_key` is unique; re-enqueueing the same export returns the existing job. Payroll's key is `payroll:{year}:{month}:{run_id}`.
- **Re-resolve permissions.** Jobs store `requested_by`, never a serialized `PermissionSet`. §4.5 explains why.
- **Chunked, not one transaction.** A payroll run commits per batch of ~50 employees and updates `progress_current`, so a failure at employee 380 leaves 350 durable drafts and a resumable run rather than 30 minutes of lost work and a bloated WAL.
- **Notify on completion** through `NotificationService.notify()` — in-app always, email if the template is enabled. Exports land as a `derived/` file exposed as a time-limited attachment.
- **PDF generation** uses WeasyPrint, which is CPU-bound and releases the GIL poorly; run it in a `ProcessPoolExecutor` inside the heavy worker so it cannot block the event loop.

```python
async def run_payroll(ctx: JobCtx, *, run_id: UUID, requested_by: UUID) -> None:
    async with session_scope() as session:
        perms = await PermissionResolver(session, ctx["redis"]).for_user(requested_by)
        access = AccessContext(await principal(session, requested_by),
                               "payroll.run", perms.screens["payroll.run"])
        if "run" not in access.grant.actions:
            raise JobAborted("Requester no longer permitted to run payroll")

        svc = PayrollService(session)
        employees = await svc.employees_for_run(access, run_id)
        await svc.set_progress(run_id, 0, len(employees))

        for batch in chunked(employees, 50):
            await svc.compute_batch(access, run_id, batch)
            await session.commit()
            await svc.advance_progress(run_id, len(batch))
```

---

## 10. Testing strategy

Weighted hard toward the engines, because that is where a bug is silent, financial, and discovered months later on a payslip.

### Layer 1 — Engine golden files (the largest suite)

The engines are pure, so cases are data. Non-engineers can add them.

```yaml
# tests/engines/tax/cases/slab_progressive.yaml
name: progressive slab, base lands in third band
head:
  tax_type: slab
  slab_application: progressive
  scope: payroll_income_tax
  applies_from: 2026-04-01
  bands:
    - {band_from: 0,       band_to: 300000,  value: 0}
    - {band_from: 300000,  band_to: 700000,  value: 5}
    - {band_from: 700000,  band_to: null,    value: 10}
base: "900000"
expect:
  amount: "40000.00"
  trace:
    - "300000–700000: 400000 × 5% = 20000"
    - "700000–∞: 200000 × 10% = 20000"
```

```python
@pytest.mark.parametrize("case", load_cases("tests/engines/tax/cases"), ids=attrgetter("name"))
def test_tax_engine(case: TaxCase) -> None:
    line = compute(case.head, case.base, case.ctx)
    assert line.amount == Decimal(case.expect.amount)
    assert [s.text for s in line.trace.steps if s.kind == "band"] == case.expect.trace
```

Asserting the **trace**, not only the total, is what makes these tests catch the failure mode that matters: a right answer reached by wrong arithmetic, which stays right until the inputs move.

Minimum coverage before build is considered done:

- Every `TaxType` × every `Scope` combination that is legal.
- Progressive vs flat-by-band on the same bands and base — the spec warns they *"produce very different numbers."*
- Base exactly on a band boundary, at zero, and above the open-ended band.
- Split components totalling 100%, and the conditional variant.
- Each `ReliefRule` kind, including relief exceeding the computed tax (must floor at zero, never refund).
- **Empty configuration → zero lines, no exception.** This is a spec requirement, and it is the one an implementer is most likely to break by defaulting something.

Payroll cases mirror the spec's own worked examples:

- Whole-month attendance, exactly at target.
- Mid-month joiner and mid-month leaver.
- Shortfall fully compensated → no LOP.
- Shortfall partially compensated → the spec's rule that *"a partial make-up clears only its own hours."*
- Pending comp request → deduction **suspended**, not cancelled.
- **The §3.1b cutoff example, verbatim:** leave on 27-07-2026 under a 26th–25th cycle appears on the **August** payslip, not July. This is the highest-value single test in the suite — it is the rule most likely to be implemented as "the calendar month" by someone who did not read §3.20.
- Mandatory holiday on a 3rd Saturday → required hours 0.
- Salary credit day 31 in February → clamped to the 28th/29th.
- Each `Uncompensated Shortfall Becomes` option.

### Layer 2 — Property tests (Hypothesis)

```python
@given(bands=valid_band_tables(), base=decimals(min_value=0, max_value=10_000_000))
def test_progressive_slab_is_monotonic_and_never_exceeds_base(bands, base) -> None:
    lo = apply_slabs(bands, SlabApplication.PROGRESSIVE, base)[0]
    hi = apply_slabs(bands, SlabApplication.PROGRESSIVE, base + 1000)[0]
    assert hi >= lo                       # more income never means less tax
    assert lo <= base                     # tax never exceeds the base

@given(components=split_components_summing_to_100(), amount=money())
def test_component_shares_reconcile_to_the_total(components, amount) -> None:
    parts = split(components, amount, ctx=TaxContext.blank())
    assert sum(p.amount for p in parts) == amount   # rounding residue assigned, not lost
```

The second one catches the classic split bug: three components at 33.33% of ₹100 summing to ₹99.99. The largest component absorbs the residue.

### Layer 3 — RBAC matrix and contract tests

Covered in §3.6. Three generated suites:

1. `(role × screen)` visibility vs the seeded policy, asserting **404** where hidden.
2. `(role × screen × action)` on every mutating endpoint, asserting 403 where not granted.
3. Field-level: for each screen with sensitive fields, each role fetches a record and the response is checked against the expected `show`/`mask`/`hide` — including that a hidden key is **absent**, not null.

Plus scope tests with a fixture org (Super Admin, two Managers, four reports): a Manager at Team scope must see exactly their reports' rows, and `GET /{id}` on another manager's report must 404.

And a contract test over the router table:

```python
@pytest.mark.parametrize("route", [r for r in app.routes if getattr(r, "is_list", False)])
async def test_list_endpoints_honour_the_convention(client, route) -> None:
    resp = await client.get(route.path, params={"page": 1, "page_size": 5})
    body = resp.json()
    assert {"data", "page", "total", "scoped_total",
            "filters_applied", "export"} <= body.keys()
    # Export exists for every role that can open the screen (RBAC §2.2f).
    assert body["export"] == {"pdf": True, "xlsx": True}
    # Every baseline filter is accepted, not 422'd.
    for param in ("q", "date_preset", "status", "owner_id", "include_inactive"):
        assert (await client.get(route.path, params={param: sample(param)})).status_code == 200
```

### Layer 4 — Integration

`testcontainers-python` for a real MySQL — never SQLite, since the schema depends on JSONB, partial unique indexes, advisory locks and `REVOKE`. One migrated database per session, per-test transaction rollback for isolation.

> **As built:** the "real MySQL, never SQLite" conclusion stands, but two of the four reasons listed are Postgres constructs that don't exist on MySQL and were not built: JSONB (MySQL `JSON` is used instead) and partial unique indexes (see the §6.2 note — enforced in the service layer). Advisory locks (`GET_LOCK`) and MySQL `JSON` semantics remain genuine reasons a real MySQL is required.

Migration test: `alembic upgrade head` then `alembic downgrade base` then `upgrade head` again, and a check that `alembic revision --autogenerate` produces an empty diff against the models — a stale migration is otherwise found in production.

Registry drift test:

```python
async def test_seeded_registry_matches_code(session) -> None:
    db = {r.key for r in await session.scalars(select(Screen))}
    assert db == set(SCREENS), f"Run `cms seed-permissions`. Drift: {db ^ set(SCREENS)}"
```

### Layer 5 — Security regression

Small, specific, and each one a bug that would otherwise be found by a customer:

- Temp password never appears in a response body, a log record, or an `email_sends.body` row.
- SMTP/Mailgun credentials are redacted on every read path.
- A runtime-edited email template containing `{{ 7*7 }}` and `{{ config.SECRET_KEY }}` renders **literally**.
- Upload of a `.png` whose bytes are a PDF is rejected; SVG is rejected.
- `GET /files/{id}` for an attachment on an out-of-scope entity returns 404.
- Every append-only table rejects `UPDATE` and `DELETE` under the application role.

### Coverage targets

| Area | Target | Rationale |
|---|---|---|
| `masters/taxes/engine/` | 100% branch | Every branch is a rupee figure |
| `payroll/engine/` | 100% branch | Same |
| `rbac/` | 100% branch | Every branch is an access decision |
| `core/listing/` | ≥95% | One bug here is 161 screens' worth of bug |
| `modules/*/service.py` | ≥85% | — |
| Routers | Covered by contract tests | Thin by construction |

CI gate: the three engine/RBAC packages fail the build below 100% branch coverage. They are pure and small; anything less means an untested arithmetic or authorization path shipped.

---

## The five decisions worth challenging before build starts

1. **404 vs 403 on Layer 1.** I read RBAC §2 as requiring 404 ("no access-denied page reachable by URL guessing"). It complicates client error handling. Confirm before it is baked into 161 endpoints.
2. **`arq` over Celery.** Right for stack coherence; if you later need chords, canvas workflows or Flower-grade operational tooling, the migration is real work. Decide now.
3. **Masked fields serialize to `null` + `_restricted`, not `"••••"`.** Keeps OpenAPI honest, moves placeholder rendering to the client. The alternative preserves the exact prototype behaviour at the cost of union-typed response fields.
4. **Document numbers allocate under a row lock, so there are no gaps** — this serializes concurrent invoice creation on one row per code type. Correct for finance, and fine at this volume, but it is a deliberate throughput trade.
5. **The marginal-relief gap is real and unclosed.** Payroll §2.1(6) already flags it as *"the one calculation shape the current design cannot express."* Leave `ReliefRule` extensible rather than writing the engine as though the shape were complete.