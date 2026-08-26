// Mirrors backend/app/schemas/opportunity.py's OpportunityOut / OpportunityWrite,
// OpportunityActivityOut and OpportunityFileOut, plus the fixed option lists
// and RefLookup shorthands every screen in this module shares — same
// centralising convention as ticket.api.ts (TICKET_STATUS_OPTIONS,
// TICKET_CUSTOMER_REF, ...).
//
// value / probability_pct are Decimal columns server-side. Every other
// Decimal-backed field already confirmed in this codebase (AssetRow's
// purchase_value/current_value, taxes.list.config.ts's rate fields,
// work-week.tabbed.config.ts) arrives as a JSON STRING, not a number —
// Pydantic v2's own serialisation — so these are typed `string | null` here
// too, and every display path below runs the raw value through Number()
// before formatting rather than assuming it is already numeric.

export interface OpportunityRow {
  readonly id: string;
  readonly opportunity_code: string;
  readonly financial_year_id: string;
  readonly title: string;
  readonly customer_id: string;
  readonly value: string | null;
  readonly stage: string; // PROSPECTING | QUALIFYING | PROPOSAL | WON | LOST
  readonly probability_pct: string | null;
  readonly expected_close_date: string | null;
  readonly description: string | null;
  readonly owner_id: string | null;
  readonly lost_reason: string | null;
  readonly last_activity_at: string | null;
}

// The exact body both POST /opportunities and PUT /opportunities/{id} accept
// (OpportunityWrite, schemas/opportunity.py). PUT requires the COMPLETE body
// every time — the handler does `for field, value in body.model_dump():
// setattr(row, field, value)` over every field, so a partial body either
// 422s (missing required title/customer_id) or nulls out everything else.
// Declared mainly so opportunity.board.component.ts's own hand-built
// stageChangeBody (the one place this module constructs a PUT body by hand,
// outside FormScreenComponent's own generic save()) is checked against the
// real shape at compile time. value/probability_pct are plain numbers here,
// not strings — FormScreenComponent's `<input type="number">` binding
// (Angular's NumberValueAccessor) always produces a real JS number in
// formModel, regardless of what string the GET response seeded it with.
export interface OpportunityWriteBody {
  readonly title: string;
  readonly customer_id: string;
  readonly value: number | null;
  readonly stage: string;
  readonly probability_pct: number | null;
  readonly expected_close_date: string | null;
  readonly description: string | null;
  readonly owner_id: string | null;
  readonly lost_reason: string | null;
}

export interface OpportunityActivityRow {
  readonly id: string;
  readonly opportunity_id: string;
  readonly activity_type: string; // CALL | EMAIL | MEETING | NOTE
  readonly activity_date: string;
  readonly description: string;
  readonly related_contact_id: string | null;
  readonly logged_by: string; // raw User id — resolved via OPPORTUNITY_USER_REF (GET /users)
  readonly created_at: string;
}

export interface OpportunityFileRow {
  readonly id: string;
  readonly opportunity_id: string;
  readonly stored_file_id: string;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly created_at: string;
  readonly created_by: string | null;
}

// GET /customers/{customerId}/contacts row shape — used only by
// opportunity.activities.component.ts's Related Contact dropdown. Not a
// static RefLookup (that type only takes one fixed endpoint string, and this
// endpoint varies per the opportunity's own customer_id), so it is fetched
// directly with HttpClient rather than through RefDataService.
export interface OpportunityContactOption {
  readonly id: string;
  readonly customer_id: string;
  readonly name: string;
  readonly designation: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly is_primary: boolean;
}

// ck-style enum, verbatim from OpportunityWrite's own stage validator
// (schemas/opportunity.py). cell-format.ts's shared badgeClass() dictionary
// already has exact lowercase entries for all five values (prospecting:
// b-neutral, qualifying: b-info, proposal: b-warn, won: b-ok, lost:
// b-danger) — normalizeKey() lowercases before lookup, so passing either the
// raw SCREAMING_SNAKE value or one of these Title Case labels through
// badgeClass() resolves to the same class.
export const OPPORTUNITY_STAGE_OPTIONS = [
  { value: 'PROSPECTING', label: 'Prospecting' },
  { value: 'QUALIFYING', label: 'Qualifying' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
];

export const OPPORTUNITY_ACTIVITY_TYPE_OPTIONS = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'NOTE', label: 'Note' },
];

export const OPPORTUNITY_ACTIVITY_TYPE_ICON: Record<string, string> = { CALL: '📞', EMAIL: '✉️', MEETING: '🤝', NOTE: '📝' };

// RefLookup shorthands (plain object literals — every other *.api.ts file in
// this codebase, e.g. ticket.api.ts, declares these without importing the
// RefLookup type itself, relying on structural typing wherever they're
// consumed).
//
// Customer: CustomerOut (schemas/customer.py) has no `name` field at all —
// RefDataService's default labelKey is 'name', so leaving this unset would
// resolve every customer to the literal string "undefined". company_name is
// the real field.
export const OPPORTUNITY_CUSTOMER_REF = { endpoint: '/customers/options', labelKey: 'label' };
// Employee: GET /employees returns first_name/last_name as separate fields,
// no {id,name} shape — labelKey: 'first_name' is the established workaround
// used across every other module (asset.api.ts, ticket.api.ts, ...). Reused
// for owner_id, created_by and last_modified_by alike — all three are
// Employee ids on this endpoint.
export const OPPORTUNITY_OWNER_REF = { endpoint: '/employees/options', labelKey: 'label' };
export const OPPORTUNITY_FY_REF = { endpoint: '/masters/financial-years/options', labelKey: 'label' };
// Distinct from OPPORTUNITY_OWNER_REF above: OpportunityFileRow.created_by and
// OpportunityActivityRow.logged_by are platform User ids (whoever was logged
// in when they uploaded/logged the entry), not Employee ids — resolved via
// the cross-cutting GET /users instead of /employees.
export const OPPORTUNITY_USER_REF = { endpoint: '/users', labelKey: 'name' };
