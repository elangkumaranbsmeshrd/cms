import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { EmailTemplateRow } from '../masters.api';

/** §3.21 / the prototype's "Available Placeholders" field: read-only, "Fixed
 * per trigger — only the placeholders this specific trigger actually has data
 * for are usable; an unsupported placeholder would print literally instead of
 * a value." EmailTemplateOut sends the list (`available_placeholders`), but
 * masters.api.ts's EmailTemplateRow has not declared it yet, hence the cast —
 * a previewField rather than a FieldConfig, because it must never be typed
 * into and never round-trip as an edit. */
function availablePlaceholders(model: Partial<EmailTemplateRow>): string {
  const raw = (model as unknown as Record<string, unknown>)['available_placeholders'];
  const declared = Array.isArray(raw) ? raw.map((p) => '{{' + String(p).replace(/[{}]/g, '') + '}}') : [];
  if (declared.length) return declared.join(', ');
  // Every seeded row currently carries an EMPTY list (app/seed.py:623 passes
  // available_placeholders=[]) even though its subject plainly uses
  // {{first_name}} and friends. Saying "none" there would be wrong, so the
  // fallback reports what the copy in front of the user actually references —
  // and says plainly that the declared set is what is missing.
  const used = placeholdersUsedIn(String(model.subject ?? '') + ' ' + String(model.body ?? ''));
  if (!used.length) return 'Not recorded for this trigger, and none are used in the subject or body above.';
  return 'Not recorded for this trigger. Used in the subject/body above: ' + used.join(', ');
}

function placeholdersUsedIn(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    found.add('{{' + match[1] + '}}');
    match = re.exec(text);
  }
  return [...found];
}

// QUEUED / NOT BUILT — the prototype's 3rd form button, "Send Preview to
// Myself" (prototype/app-forms.js:368: `buttons: [{l:'Save'...}, {l:'Send
// Preview to Myself'}, {l:'Cancel'}]`), has no equivalent here. Two separate
// things are missing, not one:
//   - FormScreenConfig (shared/screens/screen.types.ts:310-345) has no field
//     for a third, non-Save/Cancel button at all — the generic form-screen
//     component only ever renders the Save/Cancel pair it always renders.
//     Adding this button means extending the shared type and its renderer,
//     not just this config.
//   - Even with that button in place, there is nothing real for it to call.
//     POST /masters/email-configuration/send-test
//     (backend/app/api/v1/masters_email_config.py:213-227) only takes
//     SendTestEmailRequest{to_email} and sends a fixed generic body ("This is
//     a test email confirming your Email Configuration server settings are
//     working.") — it cannot render and send THIS template's own (possibly
//     unsaved) subject/body draft with sample placeholder values.
// Needs a new endpoint first — e.g. POST /masters/email-configuration/
// templates/{id}/preview, carrying the draft subject/body, rendering it with
// sample placeholder values, and sending to the signed-in user's own address
// — before a button on this form would mean anything. Once that exists, add
// it as a FormScreenConfig button/page-action alongside Save/Cancel.
const config: FormScreenConfig<EmailTemplateRow> = {
  shape: 'form',
  id: 'masters.email_configuration',
  title: 'Email Template',
  listEndpoint: '/masters/email-configuration/templates',
  createEndpoint: '/masters/email-configuration/templates',
  updateEndpoint: (id) => `/masters/email-configuration/templates/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/email-configuration/templates'],
  emptyRow: () => ({
    template_key: '',
    template_name: '',
    triggered_from_module: '',
    triggered_from_screen: null,
    is_enabled: true,
    subject: '',
    body: '',
  }),
  fields: [
    // The four below exist only on EmailTemplateCreate — EmailTemplateWrite
    // (the PUT body) carries just is_enabled/subject/body, per §3.21's Fields
    // Table ("Template Name: Read-only… identifies the trigger, not editable
    // here"). So they are inputs when adding a new trigger and plain read-only
    // text once the row exists.
    {
      key: 'template_key',
      label: 'Template Key',
      createOnly: true,
      required: true,
      placeholder: 'e.g. payslip_available',
      hint: 'The stable machine key the sending code fires this email by. It never changes once the row exists, and it must be unique — the API rejects a duplicate with a 409',
    },
    {
      key: 'template_name',
      label: 'Template Name',
      createOnly: true,
      required: true,
      placeholder: 'e.g. Payslip Available',
      hint: 'What this trigger is called on the Templates list',
    },
    {
      key: 'triggered_from_module',
      label: 'Triggered From',
      createOnly: true,
      required: true,
      placeholder: 'e.g. Payroll',
      hint: 'Which module fires this email. What causes it to fire is defined at that trigger point, not here — this screen only controls whether it sends and what it says',
    },
    {
      key: 'triggered_from_screen',
      label: 'Triggered From Screen',
      createOnly: true,
      placeholder: 'e.g. Run Payroll',
      hint: 'Optional. The specific screen inside that module, where naming it helps someone trace where the email came from',
    },
    {
      // Invariant 12, and the one field on this form with real consequences:
      // off silences ONLY the email copy. The in-app notification for the same
      // event still fires, elsewhere, and is untouched by this flag.
      key: 'is_enabled',
      label: 'Enabled',
      type: 'checkbox',
      required: true,
      hint: 'Off silences only the email copy of this notification. The in-app bell notification is unaffected — it always fires',
    },
    {
      key: 'subject',
      label: 'Subject Line',
      required: true,
      span: 2,
      placeholder: 'e.g. Your payslip for {{month}} is ready',
      hint: 'Supports the placeholders listed below, filled in per recipient at send time. A placeholder this trigger has no data for prints literally instead of a value',
    },
    {
      key: 'body',
      label: 'Body',
      type: 'textarea',
      required: true,
      span: 2,
      placeholder: 'Hi {{first_name}},\n\n…\n\n— Meshrd',
      hint: 'Plain text — the same placeholder set as the subject line applies here',
    },
  ],
  previewFields: [{ label: 'Available Placeholders (fixed per trigger)', compute: availablePlaceholders }],
};

export default config;
