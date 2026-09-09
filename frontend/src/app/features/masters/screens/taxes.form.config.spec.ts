/**
 * Layer 4 (COMPLETE-TEST-PROMPT.md §"Per-screen logic"):
 *   Tax Head form — **every `visibleWhen` branch**: each Tax Type revealing the
 *   right rate fields, the onward-liability toggle revealing its six,
 *   withholding scope revealing direction and base, and the received-payments
 *   direction revealing the certificate.
 *
 * Why this config gets its own spec rather than being folded into the
 * form-screen one: `visibleWhen` is not merely which inputs are drawn. A field
 * FormScreenComponent hides is also dropped from the request body (its own
 * save(); proved in form-screen.component.spec.ts), which is what makes
 * switching Tax Type CLEAR the rate that no longer applies instead of leaving a
 * stale figure on the row. So a branch that reveals too MUCH is not a cosmetic
 * slip — it writes a figure the chosen calculation method has no business
 * carrying, and tax_engine._compute_gross reads exactly those columns. Every
 * case below therefore asserts the FULL visible set, not just that the expected
 * fields appear: what stays hidden is half the assertion.
 *
 * The config is pure data, so no TestBed is needed — the predicates are
 * evaluated directly against a form model. Everything enumerable (the Tax
 * Types, the Scopes, which fields are gated at all) is read out of the config
 * itself, so a seventh Tax Type or a newly-gated field fails a test here
 * instead of quietly going uncovered.
 *
 * Every case model is built eagerly at load time, not inside the `it` bodies,
 * so the coverage guard at the bottom does not depend on Jasmine's execution
 * order (which is randomised by default).
 */
import config, { SCOPE_OPTIONS, TAX_TYPE_OPTIONS } from './taxes.form.config';

type Model = Record<string, unknown>;

const FIELDS = config.fields;
const GATED_KEYS: readonly string[] = FIELDS.filter((f) => !!f.visibleWhen).map((f) => f.key);
/** Fields with no `visibleWhen` at all — present in EVERY case below, which is
 * what lets each case assert an exact visible set instead of a subset. */
const UNGATED_KEYS: readonly string[] = FIELDS.filter((f) => !f.visibleWhen).map((f) => f.key);

function optionValues(key: string): string[] {
  return (FIELDS.find((f) => f.key === key)?.staticOptions ?? []).map((o) => o.value);
}

/** Driven off the config's own dropdowns, never a list transcribed into this
 * file — a Tax Type added to the enum shows up here automatically and trips the
 * coverage guard at the bottom until it is given a case. */
const TAX_TYPES: readonly string[] = optionValues('tax_type');
const SCOPES: readonly string[] = optionValues('scope');

function model(overrides: Model = {}): Model {
  return { ...(config.emptyRow() as unknown as Model), ...overrides };
}

function visibleKeys(m: Model): string[] {
  return FIELDS.filter((f) => f.visibleWhen?.(m) ?? true).map((f) => f.key);
}

// ---------------------------------------------------------------------------
// The case tables. These come from §3.2's Fields Table and the config's own
// section headings — deliberately written out rather than derived from the
// predicates, because a table derived from the code under test can only ever
// agree with it.
// ---------------------------------------------------------------------------

/** "Conditional — required if Tax Type is …" — one entry per Tax Type. */
const RATE_FIELDS_BY_TAX_TYPE: Readonly<Record<string, readonly string[]>> = {
  GST_IGST: ['rate_pct'],
  GST_CGST_SGST: ['cgst_rate_pct', 'sgst_rate_pct'],
  PERCENTAGE: ['rate_pct'],
  FIXED_AMOUNT: ['fixed_amount'],
  SLAB: ['slab_application'],
  DECLARATION_CAP: ['declaration_cap'],
};

const ALL_RATE_FIELDS: readonly string[] = [...new Set(Object.values(RATE_FIELDS_BY_TAX_TYPE).flat())];

/** §3.2: "Only one of the fields above is unconditionally visible — the Creates
 * an Onward Liability toggle. Everything else is revealed by it." */
const ONWARD_FIELDS: readonly string[] = [
  'remitted_to_authority',
  'remittance_period',
  'period_aligns_to',
  'deposit_due_days_after_period_end',
  'liability_arises_on',
  'authority_reference_label',
];

/** Direction and base — the two the withholding SCOPE alone reveals. */
const WITHHOLDING_FIELDS: readonly string[] = ['withholding_directions', 'default_calculated_on'];
/** §3.2a words Certificate Expected narrower than the other two: "Conditional
 * — shown when Direction includes On Payments Received". A head that only
 * withholds on payments the company MAKES has no counterparty to issue it a
 * certificate, so the scope alone must NOT reveal this one. */
const CERTIFICATE_FIELDS: readonly string[] = ['certificate_expected'];
const WITHHOLDING_SCOPE = 'WITHHOLDING_AT_SOURCE';
const ON_PAYMENTS_RECEIVED = 'ON_PAYMENTS_RECEIVED';
const ON_PAYMENTS_MADE = 'ON_PAYMENTS_MADE';

/** The only two scopes a "which regime" choice is meaningful for. */
const SCHEME_FIELDS: readonly string[] = ['tax_scheme_id'];
const SCHEME_SCOPES: readonly string[] = ['PAYROLL_INCOME_TAX', 'EMPLOYEE_DECLARATION'];

// ---------------------------------------------------------------------------
// The case space, built once.
// ---------------------------------------------------------------------------

interface Case {
  /** Names the failure when an assertion trips. */
  readonly name: string;
  readonly model: Model;
  /** Gated fields this case must reveal — everything else gated must stay hidden. */
  readonly extra: readonly string[];
}

function rateFieldsFor(taxType: string): readonly string[] {
  return RATE_FIELDS_BY_TAX_TYPE[taxType] ?? [];
}

/** emptyRow() is what the user first sees: PERCENTAGE / SALES_BILLING / off. */
const DEFAULT_CASE: Case = { name: 'default emptyRow() state', model: model(), extra: ['rate_pct'] };

const NO_TAX_TYPE_CASE: Case = {
  name: 'tax_type unset',
  model: model({ tax_type: null, scope: 'SALES_BILLING', creates_onward_liability: false }),
  extra: [],
};

const TAX_TYPE_CASES: readonly Case[] = TAX_TYPES.map((taxType) => ({
  name: `tax_type=${taxType}`,
  model: model({ tax_type: taxType, scope: 'SALES_BILLING', creates_onward_liability: false }),
  extra: rateFieldsFor(taxType),
}));

const SCOPE_CASES: readonly Case[] = SCOPES.map((scope) => ({
  name: `scope=${scope}`,
  model: model({ scope, tax_type: 'PERCENTAGE', creates_onward_liability: false }),
  extra: [
    'rate_pct',
    ...(SCHEME_SCOPES.includes(scope) ? SCHEME_FIELDS : []),
    ...(scope === WITHHOLDING_SCOPE ? WITHHOLDING_FIELDS : []),
  ],
}));

const ONWARD_CASES: readonly Case[] = [
  {
    name: 'creates_onward_liability=true',
    model: model({ creates_onward_liability: true, tax_type: 'PERCENTAGE', scope: 'SALES_BILLING' }),
    extra: ['rate_pct', ...ONWARD_FIELDS],
  },
  {
    name: 'creates_onward_liability=false',
    model: model({ creates_onward_liability: false, tax_type: 'PERCENTAGE', scope: 'SALES_BILLING' }),
    extra: ['rate_pct'],
  },
  {
    name: 'creates_onward_liability absent',
    model: model({ creates_onward_liability: undefined, tax_type: 'PERCENTAGE', scope: 'SALES_BILLING' }),
    extra: ['rate_pct'],
  },
];

/** The toggle is available on EVERY scope — a payroll deduction must be able to
 * join the same remittance register as a supplier withholding. */
const ONWARD_ON_EVERY_SCOPE: readonly Case[] = SCOPES.map((scope) => ({
  name: `onward liability on, scope=${scope}`,
  model: model({ scope, creates_onward_liability: true, tax_type: 'FIXED_AMOUNT' }),
  extra: [
    'fixed_amount',
    ...ONWARD_FIELDS,
    ...(SCHEME_SCOPES.includes(scope) ? SCHEME_FIELDS : []),
    ...(scope === WITHHOLDING_SCOPE ? WITHHOLDING_FIELDS : []),
  ],
}));

/** All three gates open at once, once per Tax Type — proves they compose
 * rather than interfering. */
const COMBINED_CASES: readonly Case[] = TAX_TYPES.map((taxType) => ({
  name: `tax_type=${taxType} under withholding scope + onward liability`,
  model: model({ tax_type: taxType, scope: WITHHOLDING_SCOPE, creates_onward_liability: true }),
  extra: [...rateFieldsFor(taxType), ...WITHHOLDING_FIELDS, ...ONWARD_FIELDS],
}));

/** Certificate Expected's own gate, which the withholding scope alone does not
 * open — §3.2a: "shown when Direction includes On Payments Received". */
const CERTIFICATE_CASES: readonly Case[] = [
  {
    name: 'withholding head with no direction chosen yet',
    model: model({ scope: WITHHOLDING_SCOPE, tax_type: 'PERCENTAGE', withholding_directions: [] }),
    extra: ['rate_pct', ...WITHHOLDING_FIELDS],
  },
  {
    name: 'withholding on payments MADE only',
    model: model({ scope: WITHHOLDING_SCOPE, tax_type: 'PERCENTAGE', withholding_directions: [ON_PAYMENTS_MADE] }),
    extra: ['rate_pct', ...WITHHOLDING_FIELDS],
  },
  {
    name: 'withholding on payments RECEIVED',
    model: model({ scope: WITHHOLDING_SCOPE, tax_type: 'PERCENTAGE', withholding_directions: [ON_PAYMENTS_RECEIVED] }),
    extra: ['rate_pct', ...WITHHOLDING_FIELDS, ...CERTIFICATE_FIELDS],
  },
  {
    name: 'withholding in both directions',
    model: model({
      scope: WITHHOLDING_SCOPE,
      tax_type: 'PERCENTAGE',
      withholding_directions: [ON_PAYMENTS_MADE, ON_PAYMENTS_RECEIVED],
    }),
    extra: ['rate_pct', ...WITHHOLDING_FIELDS, ...CERTIFICATE_FIELDS],
  },
  {
    // A direction left behind by an earlier scope choice must not leak the
    // certificate onto a billing head — the scope half of the gate still holds.
    name: 'a stray received-direction on a billing head',
    model: model({ scope: 'SALES_BILLING', tax_type: 'PERCENTAGE', withholding_directions: [ON_PAYMENTS_RECEIVED] }),
    extra: ['rate_pct'],
  },
];

const SCHEME_PLUS_ONWARD_CASE: Case = {
  name: 'declaration cap on a payroll income tax head with onward liability',
  model: model({ tax_type: 'DECLARATION_CAP', scope: 'PAYROLL_INCOME_TAX', creates_onward_liability: true }),
  extra: ['declaration_cap', ...SCHEME_FIELDS, ...ONWARD_FIELDS],
};

const ALL_CASES: readonly Case[] = [
  DEFAULT_CASE,
  NO_TAX_TYPE_CASE,
  ...TAX_TYPE_CASES,
  ...SCOPE_CASES,
  ...ONWARD_CASES,
  ...ONWARD_ON_EVERY_SCOPE,
  ...COMBINED_CASES,
  ...CERTIFICATE_CASES,
  SCHEME_PLUS_ONWARD_CASE,
];

function expectExactlyVisible(c: Case): void {
  const expected = [...UNGATED_KEYS, ...c.extra].slice().sort();
  expect(visibleKeys(c.model).slice().sort()).withContext(c.name).toEqual(expected);
}

describe('taxes.form.config — Tax Head progressive disclosure', () => {
  it('enumerates its Tax Types and Scopes from the config, not from a transcribed list', () => {
    expect(TAX_TYPES.length).toBeGreaterThan(0);
    expect(SCOPES.length).toBeGreaterThan(0);
    // The exported option lists and the fields' own dropdowns must be one
    // source of truth — taxes.list.config.ts renders these very values as
    // column labels.
    expect(TAX_TYPES).toEqual(TAX_TYPE_OPTIONS.map((o) => o.value));
    expect(SCOPES).toEqual(SCOPE_OPTIONS.map((o) => o.value));
  });

  it('shows the Percentage rate and nothing else on a brand-new head', () => {
    expectExactlyVisible(DEFAULT_CASE);
  });

  // -------------------------------------------------------------------------
  // Tax Type -> rate fields
  // -------------------------------------------------------------------------
  describe('each Tax Type reveals exactly its own rate fields', () => {
    it('has a declared expectation for every Tax Type the config offers', () => {
      const missing = TAX_TYPES.filter((t) => !(t in RATE_FIELDS_BY_TAX_TYPE));
      expect(missing).withContext('Tax Types with no case in this spec').toEqual([]);
    });

    for (const c of TAX_TYPE_CASES) {
      it(`${c.name} reveals ${c.extra.join(' + ') || 'no rate field'}`, () => {
        expectExactlyVisible(c);

        // Stated the other way round as well, so a failure names the offender:
        // no OTHER method's rate field may be on screen.
        const shown = visibleKeys(c.model);
        const leaked = ALL_RATE_FIELDS.filter((k) => !c.extra.includes(k) && shown.includes(k));
        expect(leaked).withContext(`rate fields leaking into ${c.name}`).toEqual([]);
      });
    }

    it('reveals no rate field at all while Tax Type is unset', () => {
      expectExactlyVisible(NO_TAX_TYPE_CASE);
    });

    it('keeps every rate field marked required, since the branch is what makes it conditional', () => {
      // §3.2's "Conditional — required if Tax Type is …" is expressed as
      // required + visibleWhen together (save() only checks VISIBLE fields).
      // Drop `required` and a Slab head saves with no slab_application, which
      // ck_tax_heads_slab rejects at the database.
      const notRequired = ALL_RATE_FIELDS.filter((k) => !FIELDS.find((f) => f.key === k)?.required);
      expect(notRequired).withContext('rate fields not marked required').toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Scope -> tax scheme, and the withholding fields
  // -------------------------------------------------------------------------
  describe('scope gates', () => {
    for (const c of SCOPE_CASES) {
      it(`${c.name} reveals ${c.extra.filter((k) => k !== 'rate_pct').join(' + ') || 'nothing beyond the rate'}`, () => {
        expectExactlyVisible(c);
      });
    }

    it('reveals direction and base together — both, never a subset', () => {
      const shown = visibleKeys(model({ scope: WITHHOLDING_SCOPE, tax_type: 'PERCENTAGE', creates_onward_liability: false }));
      for (const key of WITHHOLDING_FIELDS) {
        expect(shown).withContext(`${key} on the withholding scope`).toContain(key);
      }
      expect(WITHHOLDING_FIELDS.length).toBe(2);
    });

    it('reveals the withholding fields on no other scope', () => {
      for (const scope of SCOPES.filter((s) => s !== WITHHOLDING_SCOPE)) {
        const shown = visibleKeys(model({ scope, tax_type: 'PERCENTAGE', creates_onward_liability: false }));
        for (const key of [...WITHHOLDING_FIELDS, ...CERTIFICATE_FIELDS]) {
          expect(shown).withContext(`${key} leaking onto scope=${scope}`).not.toContain(key);
        }
      }
    });

    // §3.2a: Certificate Expected is the one withholding field the scope alone
    // does not open — it needs the direction as well.
    for (const c of CERTIFICATE_CASES) {
      it(`Certificate Expected — ${c.name}`, () => {
        expectExactlyVisible(c);
      });
    }

    it('reveals Tax Scheme on the payroll income tax and declaration scopes only', () => {
      for (const scope of SCOPES) {
        const shown = visibleKeys(model({ scope, tax_type: 'PERCENTAGE', creates_onward_liability: false }));
        expect(shown.includes('tax_scheme_id')).withContext(`tax_scheme_id on scope=${scope}`).toBe(SCHEME_SCOPES.includes(scope));
      }
    });

    it('requires a Withholding Direction, because the API refuses a head without one', () => {
      // masters_taxes.py:141-149 (_validate_withholding_directions) — "At least
      // one required". Without `required` here the form posts a head the server
      // then rejects.
      expect(FIELDS.find((f) => f.key === 'withholding_directions')?.required).toBe(true);
    });

    it('never gates Applies Until — the spec rate-change sequence depends on it staying reachable', () => {
      // "Set Applies Until on the locked head and add a new one" only works if
      // the field is reachable on every scope and every method.
      expect(GATED_KEYS).not.toContain('applies_until');
    });
  });

  // -------------------------------------------------------------------------
  // The onward-liability toggle
  // -------------------------------------------------------------------------
  describe('the onward-liability toggle', () => {
    it('reveals its six, and only its six', () => {
      expect(ONWARD_FIELDS.length).toBe(6);
      expectExactlyVisible(ONWARD_CASES[0]);
    });

    it('hides all six again when switched off', () => {
      expectExactlyVisible(ONWARD_CASES[1]);
      const shown = visibleKeys(ONWARD_CASES[1].model);
      for (const key of ONWARD_FIELDS) {
        expect(shown).withContext(`${key} while onward liability is off`).not.toContain(key);
      }
    });

    it('stays closed when the flag is simply absent', () => {
      expectExactlyVisible(ONWARD_CASES[2]);
    });

    it('is itself unconditional — it is the one field nothing gates', () => {
      expect(GATED_KEYS).not.toContain('creates_onward_liability');
    });

    for (const c of ONWARD_ON_EVERY_SCOPE) {
      it(`opens on every scope — ${c.name}`, () => {
        expectExactlyVisible(c);
      });
    }
  });

  // -------------------------------------------------------------------------
  // The three gates compose
  // -------------------------------------------------------------------------
  describe('the three gates compose', () => {
    for (const c of COMBINED_CASES) {
      it(c.name, () => {
        expectExactlyVisible(c);
      });
    }

    it(SCHEME_PLUS_ONWARD_CASE.name, () => {
      expectExactlyVisible(SCHEME_PLUS_ONWARD_CASE);
    });
  });

  // -------------------------------------------------------------------------
  // Coverage guard — the acceptance bar is "every visibleWhen branch exercised"
  // -------------------------------------------------------------------------
  describe('coverage of every visibleWhen branch', () => {
    it('has a case naming every field that carries a visibleWhen', () => {
      const covered = new Set<string>([
        ...ALL_RATE_FIELDS,
        ...SCHEME_FIELDS,
        ...WITHHOLDING_FIELDS,
        ...CERTIFICATE_FIELDS,
        ...ONWARD_FIELDS,
      ]);
      const uncovered = GATED_KEYS.filter((k) => !covered.has(k));
      expect(uncovered).withContext('gated fields with no case in this spec').toEqual([]);

      // And the reverse, so this spec cannot drift into testing fields that no
      // longer have a branch at all.
      const stale = [...covered].filter((k) => !GATED_KEYS.includes(k));
      expect(stale).withContext('fields this spec treats as gated but which are not').toEqual([]);
    });

    it('drives every branch in both directions — revealed by some case, hidden by another', () => {
      expect(ALL_CASES.length).toBeGreaterThan(0);
      for (const key of GATED_KEYS) {
        const revealed = ALL_CASES.some((c) => visibleKeys(c.model).includes(key));
        const hidden = ALL_CASES.some((c) => !visibleKeys(c.model).includes(key));
        expect(revealed).withContext(`${key} is never revealed by any case above`).toBe(true);
        expect(hidden).withContext(`${key} is never hidden by any case above`).toBe(true);
      }
    });

    it('leaves no field both gated and ungated by accident', () => {
      expect(GATED_KEYS.length + UNGATED_KEYS.length).toBe(FIELDS.length);
      expect(new Set(FIELDS.map((f) => f.key)).size).withContext('duplicate field keys').toBe(FIELDS.length);
    });
  });
});
