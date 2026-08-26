"""Resolves which Work Week Policy covers a given employee on a given date —
needed identically by Attendance (attendance_records.work_week_policy_id)
and Leave (leave_requests.working_days_basis_policy_id), so it lives here
once rather than in either router.

Specificity precedence, most to least specific: DESIGNATION > DEPARTMENT >
EMPLOYMENT_TYPE > COMPANY_WIDE — a policy aimed at the employee's exact
designation should win over one merely covering their whole department.
Within a tier, the most recently effective matching policy wins (Masters
§3.20 policies are themselves date-versioned).
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.masters import WorkWeekPolicy

_SPECIFICITY = {"DESIGNATION": 0, "DEPARTMENT": 1, "EMPLOYMENT_TYPE": 2, "COMPANY_WIDE": 3}


async def resolve_policy_for_employee(db: AsyncSession, employee: Employee, as_of: date) -> WorkWeekPolicy | None:
    candidates = (
        await db.execute(select(WorkWeekPolicy).where(WorkWeekPolicy.is_active.is_(True), WorkWeekPolicy.effective_from <= as_of))
    ).scalars().all()

    matching = []
    for policy in candidates:
        if policy.applies_to == "COMPANY_WIDE":
            matching.append(policy)
        elif policy.applies_to == "DEPARTMENT" and policy.department_id == employee.department_id:
            matching.append(policy)
        elif policy.applies_to == "DESIGNATION" and policy.designation_id == employee.designation_id:
            matching.append(policy)
        elif policy.applies_to == "EMPLOYMENT_TYPE" and policy.employment_type_id == employee.employment_type_id:
            matching.append(policy)

    if not matching:
        return None
    matching.sort(key=lambda p: (_SPECIFICITY.get(p.applies_to, 9), -p.effective_from.toordinal()))
    return matching[0]
