/**
 * Layer 4 (COMPLETE-TEST-PROMPT.md §"Shared spine"):
 *   `form-screen` — `visibleWhen` progressive disclosure; **hidden fields
 *   excluded from submit**; dirty-state guard.
 *
 * The middle one is the reason this file exists, and it is not cosmetic. Every
 * 'form'-shape screen in the app (~25 Masters lookups, plus Vendor's and
 * Asset's own "New" forms) renders through this one component, and its save()
 * decides the request body. If a field the UI has decided to hide still
 * reaches the API, then a value the user was never shown — a stale rate left
 * over from a different Tax Type, a field the role's own RBAC fieldMode says
 * 'hide', a regime that does not exist yet — is influencing a stored record.
 * That is a permission/data-integrity bug wearing a UI costume, so the
 * assertions below pin BOTH halves each time: the visible field IS in the
 * body, and the hidden one is NOT even present as a key.
 *
 * There are three independent reasons isFieldVisible() hides a field, and a
 * hidden field must be dropped from the body for all three — so each gets its
 * own submit test:
 *   1. `visibleWhen`      — this form's own model (Tax Head's rate fields)
 *   2. `hideWhenRefEmpty` — live external data (Masters §3.2d)
 *   3. PolicyStore.fieldMode() 'hide'/'mask' — RBAC Layer 3
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { FieldMode } from '../../../core/auth/session.model';
import { SessionStore } from '../../../core/auth/session.store';
import { DirtyStateService } from '../../../core/navigation/dirty-state.service';
import { FieldConfig, FormScreenConfig, RefLookup } from '../screen.types';
import { FormScreenComponent } from './form-screen.component';

interface TestRow {
  id: string;
  mode: string;
  always_visible: string | null;
  basic_note: string | null;
  advanced_secret: string | null;
  approver_override: string | null;
  scheme_id: string | null;
}

/** The component's members are `protected` (template-only by design), which is
 * exactly right for production and unusable from a spec — this names the few
 * this file drives, rather than sprinkling `as any` at every call site. */
interface Internals {
  formModel: Record<string, unknown>;
  save(): void;
  visibleFields(): readonly { readonly key: string; readonly label: string }[];
  isReadOnlyRecord(): boolean;
}

const SCHEME_REF: RefLookup = { endpoint: '/test/schemes', labelKey: 'label' };

const BASE_FIELDS: readonly FieldConfig<TestRow>[] = [
  {
    key: 'mode',
    label: 'Mode',
    type: 'select',
    required: true,
    staticOptions: [
      { value: 'BASIC', label: 'Basic' },
      { value: 'ADVANCED', label: 'Advanced' },
    ],
  },
  { key: 'always_visible', label: 'Always Visible', required: true },
  // The pair under test: mutually exclusive branches of one controlling field,
  // exactly the shape Tax Head's rate fields take.
  { key: 'basic_note', label: 'Basic Note', visibleWhen: (m) => m['mode'] === 'BASIC' },
  { key: 'advanced_secret', label: 'Advanced Secret', visibleWhen: (m) => m['mode'] === 'ADVANCED' },
  // No visibleWhen at all — hidden only when RBAC says so.
  { key: 'approver_override', label: 'Approver Override' },
];

const REF_FIELD: FieldConfig<TestRow> = {
  key: 'scheme_id',
  label: 'Scheme',
  type: 'select',
  ref: SCHEME_REF,
  hideWhenRefEmpty: SCHEME_REF,
};

function makeConfig(overrides: Partial<FormScreenConfig<TestRow>> = {}): FormScreenConfig<TestRow> {
  return {
    shape: 'form',
    id: 'test.form-screen',
    title: 'Test Record',
    listEndpoint: '/test/things',
    createEndpoint: '/test/things',
    updateEndpoint: (id) => `/test/things/${id}`,
    rowId: (row) => row.id,
    listRoute: ['/test/things'],
    emptyRow: () => ({
      mode: 'BASIC',
      always_visible: '',
      basic_note: null,
      advanced_secret: null,
      approver_override: null,
    }),
    fields: BASE_FIELDS,
    ...overrides,
  };
}

const LIST_URL = `${environment.apiBaseUrl}/test/things?include_inactive=true`;
const CREATE_URL = `${environment.apiBaseUrl}/test/things`;
const SCHEMES_URL = `${environment.apiBaseUrl}/test/schemes`;

function loadedRow(): Record<string, unknown> {
  return {
    id: 'row-1',
    mode: 'BASIC',
    always_visible: 'loaded',
    basic_note: 'note',
    advanced_secret: 'server-side-secret',
    approver_override: null,
  };
}

describe('FormScreenComponent', () => {
  let httpMock: HttpTestingController;
  let dirty: DirtyStateService;
  let session: SessionStore;
  let navigate: jasmine.Spy;
  /** Mutated per-test before the fixture is built; an :id here means edit mode. */
  let routeParams: Record<string, string>;

  beforeEach(() => {
    routeParams = {};
    TestBed.configureTestingModule({
      imports: [FormScreenComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap(routeParams) };
            },
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    dirty = TestBed.inject(DirtyStateService);
    session = TestBed.inject(SessionStore);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
  });

  afterEach(() => {
    httpMock.verify();
  });

  function build(config: FormScreenConfig<TestRow> = makeConfig()): {
    fixture: ComponentFixture<FormScreenComponent<TestRow>>;
    cmp: Internals;
  } {
    const fixture = TestBed.createComponent<FormScreenComponent<TestRow>>(FormScreenComponent);
    fixture.componentRef.setInput('config', config);
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance as unknown as Internals };
  }

  /** What a person actually sees — read off the rendered DOM, not off the
   * component's own bookkeeping, so a field that is "visible" per the model
   * but never reaches the template would still fail. */
  function renderedLabels(fixture: ComponentFixture<unknown>): string[] {
    const labels: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.field > label');
    return Array.from(labels).map((el) => (el.textContent ?? '').replace('*', '').trim());
  }

  /** Grants the screen full access, hiding/masking only the named fields. */
  function signInWithFieldModes(fields: Record<string, FieldMode>): void {
    session.set({
      id: 'u1',
      email: 'tester@example.test',
      fullName: 'Tester',
      role: 'EMPLOYEE',
      mustChangePassword: false,
      previewingAs: null,
      policy: {
        version: '2026-01-01T00:00:00',
        screens: {
          'test.form-screen': { label: 'Test Record', module: 'test', mode: 'full', actions: ['edit'], fields },
        },
      },
    });
  }

  // ---------------------------------------------------------------------
  // visibleWhen — progressive disclosure
  // ---------------------------------------------------------------------
  describe('visibleWhen progressive disclosure', () => {
    it('renders only the branch the seeded model selects', () => {
      const { fixture, cmp } = build();

      expect(cmp.formModel['mode']).toBe('BASIC');
      const labels = renderedLabels(fixture);
      expect(labels).toContain('Basic Note');
      expect(labels).not.toContain('Advanced Secret');
    });

    it('flips the branch when its controlling field changes, both ways', () => {
      const { fixture, cmp } = build();

      cmp.formModel['mode'] = 'ADVANCED';
      fixture.detectChanges();
      expect(renderedLabels(fixture)).toContain('Advanced Secret');
      expect(renderedLabels(fixture)).not.toContain('Basic Note');

      // And back — a branch that only ever opens is not progressive disclosure.
      cmp.formModel['mode'] = 'BASIC';
      fixture.detectChanges();
      expect(renderedLabels(fixture)).toContain('Basic Note');
      expect(renderedLabels(fixture)).not.toContain('Advanced Secret');
    });

    it('leaves every branch closed when the controlling field is unset', () => {
      const { fixture, cmp } = build();

      cmp.formModel['mode'] = null;
      fixture.detectChanges();
      const labels = renderedLabels(fixture);
      expect(labels).not.toContain('Basic Note');
      expect(labels).not.toContain('Advanced Secret');
      // Unconditional fields are unaffected by any branch.
      expect(labels).toContain('Always Visible');
    });

    it('hides a hideWhenRefEmpty field while its lookup has no rows, and shows it once it does', () => {
      const { fixture } = build(makeConfig({ fields: [...BASE_FIELDS, REF_FIELD] }));

      // Still in flight -> options() is null -> hidden (§3.2d treats "loading"
      // and "loaded, zero rows" the same, deliberately).
      expect(renderedLabels(fixture)).not.toContain('Scheme');

      httpMock.expectOne(SCHEMES_URL).flush([{ id: 's1', label: 'Scheme One' }]);
      fixture.detectChanges();
      expect(renderedLabels(fixture)).toContain('Scheme');
    });
  });

  // ---------------------------------------------------------------------
  // Hidden fields excluded from submit — the security-adjacent one
  // ---------------------------------------------------------------------
  describe('hidden fields excluded from submit', () => {
    it('sends the visible branch and omits the hidden one entirely (create)', () => {
      const { fixture, cmp } = build();

      // Fill the advanced field while it IS on screen...
      cmp.formModel['mode'] = 'ADVANCED';
      fixture.detectChanges();
      cmp.formModel['advanced_secret'] = 'override-approval-chain';

      // ...then switch back, which is what hides it. The stale value is still
      // sitting in formModel — that is precisely the risk being tested.
      cmp.formModel['mode'] = 'BASIC';
      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['basic_note'] = 'an ordinary note';
      fixture.detectChanges();
      expect(cmp.formModel['advanced_secret']).toBe('override-approval-chain');

      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      expect(req.request.method).toBe('POST');
      const body = req.request.body as Record<string, unknown>;

      // The visible field IS sent.
      expect(body['basic_note']).toBe('an ordinary note');
      expect(body['always_visible']).toBe('filled');
      // The hidden field is NOT sent — not as a value, not as a null, not at all.
      expect('advanced_secret' in body).toBe(false);
      expect(body['advanced_secret']).toBeUndefined();

      req.flush({ id: 'new-1' });
    });

    it('drops the OTHER branch under the same rule — it is visibility deciding, not a fixed key list', () => {
      const { fixture, cmp } = build();

      cmp.formModel['basic_note'] = 'left behind';
      cmp.formModel['mode'] = 'ADVANCED';
      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['advanced_secret'] = 'now the visible one';
      fixture.detectChanges();

      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      const body = req.request.body as Record<string, unknown>;
      expect(body['advanced_secret']).toBe('now the visible one');
      expect('basic_note' in body).toBe(false);

      req.flush({ id: 'new-2' });
    });

    it('does not echo a hidden value back on edit, even though the server itself supplied it', () => {
      // The sharpest form of the rule: the row arrives WITH advanced_secret,
      // the form hides it, and the PUT must not carry it back. Otherwise a
      // value the UI withheld still round-trips through the client.
      routeParams = { id: 'row-1' };
      const { fixture, cmp } = build();

      httpMock.expectOne(LIST_URL).flush([loadedRow()]);
      fixture.detectChanges();

      expect(renderedLabels(fixture)).not.toContain('Advanced Secret');
      expect(cmp.formModel['advanced_secret']).toBe('server-side-secret');

      cmp.save();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/test/things/row-1`);
      expect(req.request.method).toBe('PUT');
      const body = req.request.body as Record<string, unknown>;
      expect(body['basic_note']).toBe('note');
      expect('advanced_secret' in body).toBe(false);

      req.flush({ id: 'row-1' });
    });

    it('sends an unrestricted field — the control the two RBAC cases below are measured against', () => {
      // Without this, "the field is absent from the body" could just as well
      // mean the field was never rendered or never populated in the first
      // place, and the two tests after it would pass for the wrong reason.
      const { fixture, cmp } = build();

      expect(renderedLabels(fixture)).toContain('Approver Override');

      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['approver_override'] = 'self';
      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      expect((req.request.body as Record<string, unknown>)['approver_override']).toBe('self');
      req.flush({ id: 'new-0' });
    });

    it('omits a field the role own fieldMode hides (RBAC Layer 3)', () => {
      signInWithFieldModes({ approver_override: 'hide' });
      const { fixture, cmp } = build();

      expect(renderedLabels(fixture)).not.toContain('Approver Override');

      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['approver_override'] = 'self';
      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      const body = req.request.body as Record<string, unknown>;
      expect('approver_override' in body).toBe(false);
      expect(body['always_visible']).toBe('filled');

      req.flush({ id: 'new-3' });
    });

    it('omits a field the role own fieldMode masks, the same as hide', () => {
      signInWithFieldModes({ approver_override: 'mask' });
      const { fixture, cmp } = build();

      expect(renderedLabels(fixture)).not.toContain('Approver Override');

      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['approver_override'] = 'self';
      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      expect('approver_override' in (req.request.body as Record<string, unknown>)).toBe(false);

      req.flush({ id: 'new-4' });
    });

    it('omits a hideWhenRefEmpty field while its lookup is empty', () => {
      const { fixture, cmp } = build(makeConfig({ fields: [...BASE_FIELDS, REF_FIELD] }));

      httpMock.expectOne(SCHEMES_URL).flush([]); // §3.2d: zero rows is a valid state
      fixture.detectChanges();

      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['scheme_id'] = 'a-regime-that-does-not-exist';
      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      expect('scheme_id' in (req.request.body as Record<string, unknown>)).toBe(false);
      req.flush({ id: 'new-5' });
    });

    it('sends a ref-gated field once its lookup actually has rows', () => {
      const { fixture, cmp } = build(makeConfig({ fields: [...BASE_FIELDS, REF_FIELD] }));

      httpMock.expectOne(SCHEMES_URL).flush([{ id: 's1', label: 'Scheme One' }]);
      fixture.detectChanges();

      cmp.formModel['always_visible'] = 'filled';
      cmp.formModel['scheme_id'] = 's1';
      cmp.save();

      const req = httpMock.expectOne(CREATE_URL);
      expect((req.request.body as Record<string, unknown>)['scheme_id']).toBe('s1');
      req.flush({ id: 'new-6' });
    });

    it('does not block the save on a REQUIRED field that is currently hidden', () => {
      // The corollary of dropping hidden fields: a conditionally-required
      // field must not be demanded while its branch is closed, or the branch
      // it belongs to becomes unsavable. Tax Head's rate fields are exactly
      // this — "Conditional — required if Tax Type is …".
      const { cmp } = build(
        makeConfig({
          fields: [
            ...BASE_FIELDS.filter((f) => f.key !== 'advanced_secret'),
            { key: 'advanced_secret', label: 'Advanced Secret', required: true, visibleWhen: (m) => m['mode'] === 'ADVANCED' },
          ],
        }),
      );

      cmp.formModel['always_visible'] = 'filled';
      cmp.save();

      httpMock.expectOne(CREATE_URL).flush({ id: 'new-7' });
      expect(navigate).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Dirty-state guard
  // ---------------------------------------------------------------------
  describe('dirty-state guard', () => {
    it('reports clean on a freshly seeded create form', () => {
      build();
      expect(dirty.isDirty()).toBe(false);
    });

    it('reports dirty once a value differs from the seeded one', () => {
      const { cmp } = build();

      cmp.formModel['always_visible'] = 'typed something';
      expect(dirty.isDirty()).toBe(true);
    });

    it('goes clean again when the edit is undone', () => {
      const { cmp } = build();

      cmp.formModel['always_visible'] = 'typed something';
      expect(dirty.isDirty()).toBe(true);
      cmp.formModel['always_visible'] = '';
      expect(dirty.isDirty()).toBe(false);
    });

    it('treats null and empty string as the same emptiness', () => {
      const { cmp } = build();

      // basic_note is seeded null; an <input> round-trip turns that into ''.
      cmp.formModel['basic_note'] = '';
      expect(dirty.isDirty()).toBe(false);
    });

    it('compares child-row arrays by value, not identity', () => {
      const { cmp } = build();

      cmp.formModel['bands'] = [];
      expect(dirty.isDirty()).toBe(false);
      cmp.formModel['bands'] = [{ from: 0, to: 100 }];
      expect(dirty.isDirty()).toBe(true);
    });

    it('reports clean against the LOADED row in edit mode, and dirty after a change', () => {
      routeParams = { id: 'row-1' };
      const { fixture, cmp } = build();

      httpMock.expectOne(LIST_URL).flush([loadedRow()]);
      fixture.detectChanges();

      expect(dirty.isDirty()).toBe(false);
      cmp.formModel['basic_note'] = 'edited';
      expect(dirty.isDirty()).toBe(true);
    });

    it('stops reporting dirty after a successful save', () => {
      const { cmp } = build();

      cmp.formModel['always_visible'] = 'typed something';
      expect(dirty.isDirty()).toBe(true);

      cmp.save();
      const req = httpMock.expectOne(CREATE_URL);
      expect(dirty.isDirty()).toBe(false); // in flight — leaving discards nothing
      req.flush({ id: 'new-8' });

      expect(dirty.isDirty()).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/test/things']);
    });

    it('keeps reporting dirty when the save FAILS — the edit is still unsaved', () => {
      const { cmp } = build();

      cmp.formModel['always_visible'] = 'typed something';
      cmp.save();
      httpMock.expectOne(CREATE_URL).flush({ detail: 'Nope.' }, { status: 400, statusText: 'Bad Request' });

      expect(dirty.isDirty()).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('never prompts on a record nothing can be saved on', () => {
      routeParams = { id: 'row-1' };
      const { fixture, cmp } = build(makeConfig({ updateEndpoint: undefined }));

      httpMock.expectOne(LIST_URL).flush([loadedRow()]);
      fixture.detectChanges();

      expect(cmp.isReadOnlyRecord()).toBe(true);
      cmp.formModel['basic_note'] = 'changed somehow';
      expect(dirty.isDirty()).toBe(false);
    });
  });
});
