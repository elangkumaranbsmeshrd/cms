import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1 import (
    adhoc_adjustments,
    announcements,
    assets,
    attendance,
    attendance_reconciliation,
    auth,
    compensatory_hours,
    compliance,
    credit_notes,
    customers,
    employee_compensation,
    employee_documents,
    employee_lifecycle,
    employees,
    expenses,
    files,
    financial_years,
    invoices,
    leave_balance,
    leave_reports,
    leave_requests,
    masters_bank_accounts,
    masters_company_profile,
    masters_email_config,
    masters_simple,
    masters_tax_schemes,
    masters_taxes,
    masters_work_week,
    notifications,
    opportunities,
    payroll_runs,
    payslips,
    projects,
    purchase_bills,
    rbac_admin,
    search,
    tax_declarations,
    tickets,
    users,
    vendors,
)
from app.core.config import get_settings
from app.core.db import engine
from app.core.logging_config import configure_logging, request_id_var

configure_logging()
logger = logging.getLogger("app.request")

app = FastAPI(title="Meshrd CMS API", version="0.7.0-phase6")

_cors_origins = [o.strip() for o in get_settings().cors_allowed_origins.split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_cors_origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )


# ARCH-3 §9.5's gunicorn access_log_format reads a `%({x-request-id}i)s`
# header — this middleware is what makes that header exist, generating one
# when no upstream proxy has already set it, and threads it through a
# contextvar so any log call anywhere in this request can be correlated to
# one HTTP request without passing the id down every function signature.
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    incoming = request.headers.get("x-request-id") or str(uuid.uuid4())
    token = request_id_var.set(incoming)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-Id"] = incoming
    return response


# Starlette's own default (debug=False, the default here) already withholds
# the traceback from the response body, so this handler isn't a security
# fix — it exists because nothing was logging unhandled exceptions with
# enough context (path, method, request id) to find them in gunicorn's
# `errorlog = "-"` -> journald output at all.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(auth.router, prefix="/api/v1")
app.include_router(auth.me_router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(financial_years.router, prefix="/api/v1")
app.include_router(masters_taxes.router, prefix="/api/v1")
app.include_router(masters_tax_schemes.router, prefix="/api/v1")
app.include_router(masters_company_profile.router, prefix="/api/v1")
app.include_router(masters_bank_accounts.router, prefix="/api/v1")
app.include_router(masters_work_week.router, prefix="/api/v1")
app.include_router(masters_work_week.pay_cycle_router, prefix="/api/v1")
app.include_router(masters_work_week.saturday_router, prefix="/api/v1")
app.include_router(masters_email_config.router, prefix="/api/v1")
app.include_router(masters_simple.combined_router, prefix="/api/v1")

# ------------------------------------------------------------------ Phase 2
app.include_router(employees.router, prefix="/api/v1")
app.include_router(employee_compensation.router, prefix="/api/v1")
app.include_router(employee_documents.router, prefix="/api/v1")
app.include_router(employee_lifecycle.router, prefix="/api/v1")
app.include_router(tax_declarations.router, prefix="/api/v1")
app.include_router(announcements.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(leave_requests.router, prefix="/api/v1")
app.include_router(leave_balance.router, prefix="/api/v1")
app.include_router(leave_reports.router, prefix="/api/v1")
app.include_router(compensatory_hours.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")

# ------------------------------------------------------------------ Phase 3
app.include_router(payroll_runs.router, prefix="/api/v1")
app.include_router(adhoc_adjustments.router, prefix="/api/v1")
app.include_router(payslips.router, prefix="/api/v1")
app.include_router(attendance_reconciliation.router, prefix="/api/v1")

# ------------------------------------------------------------------ Phase 4
app.include_router(customers.router, prefix="/api/v1")
app.include_router(vendors.router, prefix="/api/v1")
app.include_router(purchase_bills.router, prefix="/api/v1")
app.include_router(invoices.router, prefix="/api/v1")
app.include_router(credit_notes.router, prefix="/api/v1")
app.include_router(expenses.router, prefix="/api/v1")

# ------------------------------------------------------------------ Phase 5
app.include_router(opportunities.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(tickets.router, prefix="/api/v1")
app.include_router(assets.router, prefix="/api/v1")

# ------------------------------------------------------------------ Module 15
app.include_router(compliance.router, prefix="/api/v1")

# ---------------------------------------------------------- RBAC admin screens
app.include_router(rbac_admin.router, prefix="/api/v1")

# ------------------------------------------------------------ cross-cutting
app.include_router(users.router, prefix="/api/v1")
app.include_router(search.router, prefix="/api/v1")


@app.get("/health")
async def health() -> JSONResponse:
    # ARCH-3 §9.4's nginx config proxies this bare, and DO's own uptime
    # monitor (§9.2) hits it every minute — a static {"status": "ok"} would
    # report healthy even with MySQL completely down, which is exactly the
    # case an uptime check exists to catch.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health check: database unreachable")
        return JSONResponse(status_code=503, content={"status": "unhealthy", "database": "unreachable"})
    return JSONResponse(status_code=200, content={"status": "ok", "database": "ok"})
