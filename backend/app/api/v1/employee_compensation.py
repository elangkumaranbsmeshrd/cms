"""Employee §2.2 Salary Structure and Insurance & Benefits tabs.

Salary Structure is versioned by date (effective_from/effective_to), never
edited in place — Employee §2.2 / the migration's own module docstring:
"Closing the previous current version is done in the SERVICE layer". So
'edit' (Super Admin) means "add a new dated revision", not PUT-in-place;
'edit_applicability' (Accountant, on individual statutory lines only) is the
one thing that DOES mutate the current revision, and must recompute its
rolled-up totals since a line's applicability changes what they sum to.

ASSUMPTION, flagged rather than silently decided (tax_heads carries no
payroll-specific base-amount field — Masters §3.2a deliberately left
borne_by/include_in_ctc/per_employee_opt_out_allowed inside the open-ended
`behaviour` JSON, and no field says what a payroll deduction/contribution is
computed ON): every PAYROLL_EMPLOYEE_DEDUCTION/PAYROLL_EMPLOYER_CONTRIBUTION
head is calculated against Gross Monthly. tax_engine.py itself sets the
precedent for flagging an engine assumption in its own docstring rather than
resolving it invisibly — this does the same.
"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import (
    Employee,
    EmployeeInsuranceEnrollment,
    InsuranceDependent,
    InsuranceNominee,
    SalaryStructure,
    SalaryStructureStatutoryLine,
)
from app.models.masters import InsurancePlan, TaxHead, TaxHeadSlabBand
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.employee import (
    InsuranceDependentWrite,
    InsuranceEnrollmentOut,
    InsuranceEnrollmentWrite,
    InsuranceNomineeWrite,
    SalaryStructureOut,
    SalaryStructureWrite,
    StatutoryLineApplicabilityWrite,
)
from app.services import tax_engine
from app.services.numbering import get_current_financial_year
from app.services.salary_engine import StatutoryLineAmount, compute_gross_monthly, compute_totals

router = APIRouter(prefix="/employees/{employee_id}", tags=["employee"])
SALARY_STRUCTURE = "employee.salary_structure"
INSURANCE = "employee.insurance"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _tax_head_snapshot(db: AsyncSession, head: TaxHead) -> tax_engine.TaxHeadSnapshot:
    bands = (await db.execute(select(TaxHeadSlabBand).where(TaxHeadSlabBand.tax_head_id == head.id))).scalars().all()
    return tax_engine.TaxHeadSnapshot(
        tax_name=head.tax_name,
        tax_type=head.tax_type,
        applies_from=head.applies_from,
        applies_until=head.applies_until,
        rate_pct=head.rate_pct,
        fixed_amount=head.fixed_amount,
        slab_application=head.slab_application,
        slab_bands=tuple(tax_engine.SlabBand(b.sequence_no, b.band_from, b.band_to, b.rate_or_amount) for b in bands),
        print_label=head.print_label,
    )


async def _load_lines(db: AsyncSession, structure_id: str) -> list[SalaryStructureStatutoryLine]:
    return list(
        (
            await db.execute(
                select(SalaryStructureStatutoryLine)
                .where(SalaryStructureStatutoryLine.salary_structure_id == structure_id)
                .order_by(SalaryStructureStatutoryLine.display_order)
            )
        ).scalars()
    )


async def _to_out(db: AsyncSession, structure: SalaryStructure) -> SalaryStructureOut:
    lines = await _load_lines(db, structure.id)
    out = SalaryStructureOut.model_validate(structure)
    out.statutory_lines = lines
    return out


def _recompute_and_apply_totals(structure: SalaryStructure, lines: list[SalaryStructureStatutoryLine]) -> None:
    amounts = [
        StatutoryLineAmount(
            tax_head_id=line.tax_head_id,
            borne_by=line.borne_by,
            include_in_ctc=line.include_in_ctc_snapshot,
            is_applicable=line.is_applicable,
            computed_amount_monthly=line.computed_amount_monthly,
        )
        for line in lines
    ]
    totals = compute_totals(
        gross_monthly=structure.gross_monthly,
        variable_pay_amount=structure.variable_pay_amount,
        variable_pay_frequency=structure.variable_pay_frequency,
        statutory_lines=amounts,
        insurance_employee_contribution_monthly=structure.insurance_employee_contribution_monthly,
        insurance_employer_contribution_monthly=structure.insurance_employer_contribution_monthly,
        basic_salary_monthly=structure.basic_salary_monthly,
        dearness_allowance_monthly=structure.dearness_allowance_monthly,
    )
    structure.total_employee_statutory_monthly = totals.total_employee_statutory_monthly
    structure.total_employer_statutory_ctc_monthly = totals.total_employer_statutory_ctc_monthly
    structure.net_monthly = totals.net_monthly
    structure.annual_ctc = totals.annual_ctc
    structure.basic_plus_da_share_pct = totals.basic_plus_da_share_pct
    structure.is_wage_code_compliant = totals.is_wage_code_compliant


# ========================================================= SALARY STRUCTURE
@router.get("/salary-structures", response_model=list[SalaryStructureOut])
async def list_salary_structures(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SALARY_STRUCTURE)),
) -> list[SalaryStructureOut]:
    rows = (
        await db.execute(
            select(SalaryStructure).where(SalaryStructure.employee_id == employee_id).order_by(SalaryStructure.effective_from.desc())
        )
    ).scalars().all()
    return [await _to_out(db, r) for r in rows]


@router.get("/salary-structures/current", response_model=SalaryStructureOut)
async def get_current_salary_structure(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SALARY_STRUCTURE)),
) -> SalaryStructureOut:
    row = (
        await db.execute(
            select(SalaryStructure).where(SalaryStructure.employee_id == employee_id, SalaryStructure.effective_to.is_(None))
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No current Salary Structure for this employee")
    return await _to_out(db, row)


@router.post("/salary-structures", response_model=SalaryStructureOut, status_code=status.HTTP_201_CREATED)
async def create_salary_structure(
    employee_id: str,
    body: SalaryStructureWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SALARY_STRUCTURE, action="edit")),
) -> SalaryStructureOut:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    fy = await get_current_financial_year(db)

    gross_monthly = compute_gross_monthly(
        basic_salary_monthly=body.basic_salary_monthly,
        dearness_allowance_monthly=body.dearness_allowance_monthly,
        hra_monthly=body.hra_monthly,
        lta_amount=body.lta_amount,
        lta_payout_basis=body.lta_payout_basis,
        special_allowance_monthly=body.special_allowance_monthly,
        other_earnings_monthly=body.other_earnings_monthly,
    )

    heads = (
        await db.execute(
            select(TaxHead).where(
                TaxHead.scope.in_(("PAYROLL_EMPLOYEE_DEDUCTION", "PAYROLL_EMPLOYER_CONTRIBUTION")),
                TaxHead.is_active.is_(True),
                TaxHead.applies_from <= body.effective_from,
            )
        )
    ).scalars().all()
    heads = [h for h in heads if h.applies_until is None or h.applies_until >= body.effective_from]

    enrollments = (
        await db.execute(
            select(EmployeeInsuranceEnrollment).where(
                EmployeeInsuranceEnrollment.employee_id == employee_id, EmployeeInsuranceEnrollment.status == "ACTIVE"
            )
        )
    ).scalars().all()
    insurance_employee = sum((e.employee_contribution_monthly_snapshot for e in enrollments), Decimal("0"))
    insurance_employer = sum((e.company_contribution_monthly_snapshot for e in enrollments), Decimal("0"))

    line_amounts: list[StatutoryLineAmount] = []
    pending_lines: list[SalaryStructureStatutoryLine] = []
    for head in heads:
        snapshot = await _tax_head_snapshot(db, head)
        result = tax_engine.calculate_tax(snapshot, gross_monthly)
        behaviour = head.behaviour or {}
        borne_by = behaviour.get("borne_by") or ("EMPLOYEE" if head.scope == "PAYROLL_EMPLOYEE_DEDUCTION" else "EMPLOYER")
        include_in_ctc = bool(behaviour.get("include_in_ctc", False))
        opt_out_allowed = bool(behaviour.get("per_employee_opt_out_allowed", False))
        line_amounts.append(
            StatutoryLineAmount(
                tax_head_id=head.id, borne_by=borne_by, include_in_ctc=include_in_ctc,
                is_applicable=True, computed_amount_monthly=result.computed_amount,
            )
        )
        pending_lines.append(
            SalaryStructureStatutoryLine(
                id=str(uuid.uuid4()), tax_head_id=head.id, head_name_snapshot=head.tax_name,
                print_label_snapshot=head.print_label or head.tax_name, scope_snapshot=head.scope,
                tax_type_snapshot=head.tax_type, rate_snapshot=head.rate_pct, fixed_amount_snapshot=head.fixed_amount,
                slab_application_snapshot=head.slab_application, computed_base_amount=gross_monthly,
                computed_amount_monthly=result.computed_amount, borne_by=borne_by,
                include_in_ctc_snapshot=include_in_ctc, per_employee_opt_out_allowed_snapshot=opt_out_allowed,
                is_applicable=True, calculated_at=datetime.now(timezone.utc),
                created_by=current_user.id, updated_by=current_user.id,
            )
        )

    totals = compute_totals(
        gross_monthly=gross_monthly, variable_pay_amount=body.variable_pay_amount,
        variable_pay_frequency=body.variable_pay_frequency, statutory_lines=line_amounts,
        insurance_employee_contribution_monthly=insurance_employee,
        insurance_employer_contribution_monthly=insurance_employer,
        basic_salary_monthly=body.basic_salary_monthly, dearness_allowance_monthly=body.dearness_allowance_monthly,
    )
    if not totals.is_wage_code_compliant and not (body.wage_code_override_reason and body.wage_code_override_reason.strip()):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Basic + DA is only {totals.basic_plus_da_share_pct}% of CTC (Code on Wages requires >= 50%) — an override reason is required",
        )

    previous = (
        await db.execute(
            select(SalaryStructure).where(SalaryStructure.employee_id == employee_id, SalaryStructure.effective_to.is_(None))
        )
    ).scalar_one_or_none()
    if previous is not None:
        if previous.effective_from >= body.effective_from:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="New revision must be effective after the current one")
        previous.effective_to = body.effective_from - timedelta(days=1)
        previous.updated_by = current_user.id
        await db.flush()

    # gross_monthly / variable_pay_annualised are real STORED GENERATED
    # columns in MySQL (models.employee.SalaryStructure) — deliberately not
    # passed here; the `gross_monthly` local above already fed the tax/totals
    # calculation for this request, and refresh() below reads the DB's own
    # computed figures back (which are the same formula, so they agree).
    structure = SalaryStructure(
        id=str(uuid.uuid4()), employee_id=employee_id, financial_year_id=fy.id, changed_by=current_user.id,
        insurance_employee_contribution_monthly=insurance_employee, insurance_employer_contribution_monthly=insurance_employer,
        total_employee_statutory_monthly=totals.total_employee_statutory_monthly,
        total_employer_statutory_ctc_monthly=totals.total_employer_statutory_ctc_monthly,
        net_monthly=totals.net_monthly, annual_ctc=totals.annual_ctc,
        basic_plus_da_share_pct=totals.basic_plus_da_share_pct, is_wage_code_compliant=totals.is_wage_code_compliant,
        wage_code_override_by=current_user.id if not totals.is_wage_code_compliant else None,
        wage_code_override_at=datetime.now(timezone.utc) if not totals.is_wage_code_compliant else None,
        created_by=current_user.id, updated_by=current_user.id,
        **body.model_dump(),
    )
    db.add(structure)
    await db.flush()
    for line in pending_lines:
        line.salary_structure_id = structure.id
        db.add(line)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(structure)
    return await _to_out(db, structure)


@router.put("/salary-structures/{structure_id}/lines/{line_id}/applicability", response_model=SalaryStructureOut)
async def set_line_applicability(
    employee_id: str,
    structure_id: str,
    line_id: str,
    body: StatutoryLineApplicabilityWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SALARY_STRUCTURE, action="edit_applicability")),
) -> SalaryStructureOut:
    structure = await db.get(SalaryStructure, structure_id)
    if structure is None or structure.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    line = await db.get(SalaryStructureStatutoryLine, line_id)
    if line is None or line.salary_structure_id != structure_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    line.is_applicable = body.is_applicable
    line.applicability_changed_by = current_user.id
    line.applicability_changed_at = datetime.now(timezone.utc)
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This statutory line does not allow a per-employee opt-out") from exc

    lines = await _load_lines(db, structure_id)
    _recompute_and_apply_totals(structure, lines)
    structure.updated_by = current_user.id
    await db.commit()
    await db.refresh(structure)
    return await _to_out(db, structure)


# =============================================================== INSURANCE
async def _insurance_to_out(db: AsyncSession, enrollment: EmployeeInsuranceEnrollment) -> InsuranceEnrollmentOut:
    dependents = (
        await db.execute(select(InsuranceDependent).where(InsuranceDependent.employee_insurance_enrollment_id == enrollment.id))
    ).scalars().all()
    nominees = (
        await db.execute(select(InsuranceNominee).where(InsuranceNominee.employee_insurance_enrollment_id == enrollment.id))
    ).scalars().all()
    out = InsuranceEnrollmentOut.model_validate(enrollment)
    out.dependents = list(dependents)
    out.nominees = list(nominees)
    return out


@router.get("/insurance-enrollments", response_model=list[InsuranceEnrollmentOut])
async def list_insurance_enrollments(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(INSURANCE)),
) -> list[InsuranceEnrollmentOut]:
    rows = (
        await db.execute(select(EmployeeInsuranceEnrollment).where(EmployeeInsuranceEnrollment.employee_id == employee_id))
    ).scalars().all()
    return [await _insurance_to_out(db, r) for r in rows]


@router.post("/insurance-enrollments", response_model=InsuranceEnrollmentOut, status_code=status.HTTP_201_CREATED)
async def create_insurance_enrollment(
    employee_id: str,
    body: InsuranceEnrollmentWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(INSURANCE, action="edit")),
) -> InsuranceEnrollmentOut:
    plan = await db.get(InsurancePlan, body.insurance_plan_id)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Insurance plan not found")
    if plan.plan_type == "HEALTH" and body.nominees:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nominees only apply to Life/Personal Accident plans")
    if plan.plan_type != "HEALTH" and body.dependents:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Dependents only apply to a Health plan")
    # §2.2: Nominee is "Conditional — required if enrolled in a Life or
    # Personal Accident plan" — found unenforced by the Phase 2 audit (the
    # DB only rejected the WRONG-typed child rows, never a missing nominee).
    if plan.plan_type in ("LIFE", "PERSONAL_ACCIDENT") and not body.nominees:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one nominee is required for a Life or Personal Accident plan")

    enrollment = EmployeeInsuranceEnrollment(
        id=str(uuid.uuid4()), employee_id=employee_id, insurance_plan_id=plan.id, enrollment_date=body.enrollment_date,
        plan_type_snapshot=plan.plan_type, plan_name_snapshot=plan.plan_name, coverage_amount_snapshot=plan.coverage_amount,
        company_contribution_monthly_snapshot=plan.company_contribution_monthly,
        employee_contribution_monthly_snapshot=plan.employee_contribution_monthly,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(enrollment)
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This employee already has an active enrollment in this plan") from exc

    for dep in body.dependents:
        db.add(InsuranceDependent(id=str(uuid.uuid4()), employee_insurance_enrollment_id=enrollment.id, created_by=current_user.id, updated_by=current_user.id, **dep.model_dump()))
    for nom in body.nominees:
        db.add(InsuranceNominee(id=str(uuid.uuid4()), employee_insurance_enrollment_id=enrollment.id, created_by=current_user.id, updated_by=current_user.id, **nom.model_dump()))

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(enrollment)
    return await _insurance_to_out(db, enrollment)


@router.post("/insurance-enrollments/{enrollment_id}/dependents", response_model=InsuranceEnrollmentOut, status_code=status.HTTP_201_CREATED)
async def add_dependent(
    employee_id: str,
    enrollment_id: str,
    body: InsuranceDependentWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(INSURANCE, action="edit")),
) -> InsuranceEnrollmentOut:
    enrollment = await db.get(EmployeeInsuranceEnrollment, enrollment_id)
    if enrollment is None or enrollment.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    db.add(InsuranceDependent(id=str(uuid.uuid4()), employee_insurance_enrollment_id=enrollment_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump()))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Dependents may only be added to a Health plan enrollment") from exc
    return await _insurance_to_out(db, enrollment)


@router.post("/insurance-enrollments/{enrollment_id}/nominees", response_model=InsuranceEnrollmentOut, status_code=status.HTTP_201_CREATED)
async def add_nominee(
    employee_id: str,
    enrollment_id: str,
    body: InsuranceNomineeWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(INSURANCE, action="edit")),
) -> InsuranceEnrollmentOut:
    enrollment = await db.get(EmployeeInsuranceEnrollment, enrollment_id)
    if enrollment is None or enrollment.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    db.add(InsuranceNominee(id=str(uuid.uuid4()), employee_insurance_enrollment_id=enrollment_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump()))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Nominees may only be added to a Life or Personal Accident plan enrollment") from exc
    return await _insurance_to_out(db, enrollment)


@router.post("/insurance-enrollments/{enrollment_id}/end", response_model=InsuranceEnrollmentOut)
async def end_insurance_enrollment(
    employee_id: str,
    enrollment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(INSURANCE, action="edit")),
) -> InsuranceEnrollmentOut:
    enrollment = await db.get(EmployeeInsuranceEnrollment, enrollment_id)
    if enrollment is None or enrollment.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if enrollment.status == "ENDED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already ended")
    enrollment.status = "ENDED"
    enrollment.unenrolled_date = date.today()
    enrollment.updated_by = current_user.id
    await db.commit()
    await db.refresh(enrollment)
    return await _insurance_to_out(db, enrollment)
