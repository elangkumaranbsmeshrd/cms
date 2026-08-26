// Mirrors backend/app/schemas/asset.py's AssetOut, in full. Decimal columns
// (purchase_value, current_value) arrive as JSON STRINGS — Pydantic v2's own
// serialisation, confirmed and already documented the same way by
// taxes.list.config.ts and work-week.tabbed.config.ts elsewhere in this app.
// current_value is additionally the literal string "Not available" whenever
// asset_engine.calculate_current_value() has nothing to compute from
// (purchase_value or useful_life_years missing) — _load_asset_out
// (assets.py) always substitutes that string in for a null result, so on the
// wire this field is never actually null, just possibly non-numeric text.
export interface AssetRow {
  readonly id: string;
  readonly asset_tag: string;
  readonly financial_year_id: string;
  readonly name: string;
  readonly category_id: string;
  readonly serial_number: string | null;
  readonly order_date: string | null;
  readonly purchase_date: string;
  readonly purchase_value: string | null;
  readonly useful_life_years: number | null;
  readonly vendor_id: string | null;
  readonly warranty_expiry: string | null;
  readonly location_address_id: string | null;
  readonly department_id: string | null;
  readonly status: string; // IN_STORE | IN_USE | UNDER_REPAIR | RETIRED_DISPOSED
  readonly assigned_to: string | null; // Employee id
  readonly depreciation_method: string; // only 'STRAIGHT_LINE' accepted today
  readonly notes: string | null;
  readonly retired_date: string | null;
  readonly retirement_reason: string | null;
  readonly current_value: string | null; // Decimal-as-string, or "Not available"
  readonly value_as_of_fy_label: string | null;
}

// Mirrors AssetAssignmentHistoryOut. employee_id is an Employee id;
// performed_by is a raw User id, resolved via the cross-cutting GET /users
// (see asset.assignment-history.component.ts's own USER_REF).
export interface AssetAssignmentHistoryRow {
  readonly id: string;
  readonly asset_id: string;
  readonly employee_id: string;
  readonly from_date: string;
  readonly to_date: string | null;
  readonly action: string; // ASSIGNED | TRANSFERRED | UNASSIGNED
  readonly performed_by: string; // User id
  readonly reason: string | null;
}

// Mirrors AssetMaintenanceOut. cost is a Decimal-as-string, same reasoning as
// AssetRow.purchase_value above.
export interface AssetMaintenanceRow {
  readonly id: string;
  readonly asset_id: string;
  readonly log_date: string;
  readonly description: string;
  readonly cost: string | null;
  readonly next_due_date: string | null;
  readonly serviced_by_vendor_id: string | null;
  readonly is_system_generated: boolean;
  readonly source_request_id: string | null;
  readonly maintenance_status: string | null; // COMPLETED | OVERDUE | UPCOMING
}

// Mirrors AssetRequestOut. approved_by is a raw User id, same 0.3 caveat as
// AssetAssignmentHistoryRow.performed_by above.
export interface AssetRequestRow {
  readonly id: string;
  readonly asset_id: string;
  readonly employee_id: string;
  readonly request_type: string; // REPAIR | DAMAGE_REPORT | RETURN
  readonly description: string;
  readonly photo_stored_file_id: string | null;
  readonly status: string; // PENDING | APPROVED | REJECTED
  readonly approved_by: string | null; // User id
  readonly approved_at: string | null;
  readonly rejection_reason: string | null;
}

// Verbatim from Asset's own DB status column (backend/app/models/asset.py,
// values confirmed against every literal in assets.py's own endpoint logic —
// no separate CHECK-constraint migration line names them more authoritatively
// than the endpoints that set/compare them do).
export const ASSET_STATUS_OPTIONS = [
  { value: 'IN_STORE', label: 'In Store' },
  { value: 'IN_USE', label: 'In Use' },
  { value: 'UNDER_REPAIR', label: 'Under Repair' },
  { value: 'RETIRED_DISPOSED', label: 'Retired / Disposed' },
] as const;
