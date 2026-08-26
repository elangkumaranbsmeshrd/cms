import { SingletonFormConfig } from '../../../shared/screens/screen.types';
import { EmailServerSettingsRow } from '../masters.api';

interface SendTestEmailResponse {
  readonly delivery_status?: string; // 'SENT' | 'FAILED' — masters_email_config.py's send_test_email
  readonly error_detail?: string | null;
}

// ck_ess_provider / ck_ess_encryption's real value sets; labels are the
// prototype's own (app-screens2.js:764-766).
// Exported (same pattern as work-week-policies.list.config's
// SATURDAY_RULE_OPTIONS) so email-configuration.tabbed.config.ts's record
// header can map the raw enum onto the same label instead of showing
// SCREAMING_SNAKE in the rec-head meta line.
export const PROVIDER_OPTIONS = [
  { value: 'CUSTOM_SMTP', label: 'Custom SMTP' },
  { value: 'SENDGRID', label: 'SendGrid' },
  { value: 'SES', label: 'Amazon SES' },
  { value: 'MAILGUN', label: 'Mailgun' },
  { value: 'POSTMARK', label: 'Postmark' },
];
export const ENCRYPTION_OPTIONS = [
  { value: 'STARTTLS', label: 'STARTTLS' },
  { value: 'SSL_TLS', label: 'SSL/TLS' },
  { value: 'NONE', label: 'None' },
];

// §3.21's own Fields Table marks SMTP Host/Port/Encryption "Y, if Provider =
// Custom SMTP", and the Provider row itself: "Custom SMTP shows the four
// connection fields below; a named provider replaces them with a single API
// Key field instead" — the same progressive-disclosure shape as Taxes'
// whenMethod (taxes.form.config.ts).
const isCustomSmtp = (m: Record<string, unknown>) => m['provider'] === 'CUSTOM_SMTP';
const isNamedProvider = (m: Record<string, unknown>) => m['provider'] !== 'CUSTOM_SMTP';

const config: SingletonFormConfig<EmailServerSettingsRow> = {
  shape: 'singleton',
  id: 'masters.email_configuration',
  title: 'Email Server Settings',
  loadEndpoint: '/masters/email-configuration/server-settings',
  createEndpoint: '/masters/email-configuration/server-settings',
  updateEndpoint: '/masters/email-configuration/server-settings',
  // masters_email_config.py exposes only GET and PUT here (:57, :65) — the PUT
  // is itself the upsert. POSTing the first save 405s, so Email Configuration
  // could never be set up on a fresh database.
  createMethod: 'PUT',
  emptyRow: () => ({
    sending_enabled: false,
    provider: 'CUSTOM_SMTP',
    smtp_host: null,
    smtp_port: null,
    encryption: 'STARTTLS',
    username: null,
    password: '',
    api_key: '',
    from_name: '',
    from_email: '',
    reply_to_email: null,
  }),
  // Field order and hints follow §3.21's Server Settings Fields Table and the
  // prototype's own Server Settings tab (app-screens2.js:763-773). Only two of
  // the four transports named in the dropdown are actually implemented today
  // (Mailgun's API and Custom SMTP — email_transport._dispatch); the rest
  // store fine and fail the send with a stated reason, which the hint says.
  fields: [
    {
      key: 'sending_enabled',
      label: 'Sending Enabled',
      type: 'checkbox',
      required: true,
      hint: 'The master switch. Off stops every email this CMS sends — welcome emails, payslips, approvals, resets — without touching a single template. The in-app notification bell keeps working either way; only the email copy stops, and the attempt is still logged to Recent Sends with the reason',
    },
    {
      key: 'provider',
      label: 'Provider',
      type: 'select',
      required: true,
      staticOptions: PROVIDER_OPTIONS,
      hint: 'Custom SMTP uses the four connection fields below; a named provider uses the API Key instead. Transports built so far are Custom SMTP and Mailgun — the others store correctly but a send through them fails with "no transport implemented yet" in Recent Sends',
    },
    {
      key: 'smtp_host',
      label: 'SMTP Host',
      visibleWhen: isCustomSmtp,
      hint: 'e.g. smtp.meshrd.in — required for Custom SMTP, ignored for every other provider',
    },
    {
      key: 'smtp_port',
      label: 'SMTP Port',
      type: 'number',
      visibleWhen: isCustomSmtp,
      hint: 'Common values: 587 (STARTTLS), 465 (SSL/TLS), 25 (unencrypted — discouraged). Required for Custom SMTP',
    },
    {
      key: 'encryption',
      label: 'Encryption',
      type: 'select',
      staticOptions: ENCRYPTION_OPTIONS,
      visibleWhen: isCustomSmtp,
      hint: 'Custom SMTP only. SSL/TLS opens an implicit-TLS connection; STARTTLS upgrades a plain one',
    },
    {
      key: 'username',
      label: 'Username',
      visibleWhen: isCustomSmtp,
      hint: 'Custom SMTP only. Left blank, the connection is made without authenticating',
    },
    // Write-only, per §3.21's masking convention — GET returns credential_hint
    // (the last 4 characters) instead, never the real secret. Both fields load
    // blank every time, and upsert_server_settings only overwrites the stored,
    // Fernet-encrypted value when this request actually supplies a new one. So
    // an ordinary edit — toggling Sending Enabled, fixing the From Name —
    // leaves the saved credential untouched rather than wiping it.
    {
      key: 'password',
      label: 'Password (Custom SMTP)',
      type: 'password',
      visibleWhen: isCustomSmtp,
      hint: 'Never shown in full once saved, the same convention as every stored credential in this CMS. Leave blank to keep the one already stored',
    },
    {
      key: 'api_key',
      label: 'API Key (named providers)',
      type: 'password',
      visibleWhen: isNamedProvider,
      hint: 'Used instead of the SMTP fields when Provider is not Custom SMTP. Leave blank to keep the one already stored',
    },
    {
      key: 'from_name',
      label: 'From Name',
      required: true,
      hint: 'What recipients see as the sender name',
    },
    {
      key: 'from_email',
      label: 'From Email Address',
      type: 'email',
      required: true,
      hint: 'Must be a domain this mail server is authorised to send as, or messages land in spam or are rejected outright. On Mailgun this address\'s domain is also what the API is called against',
    },
    {
      key: 'reply_to_email',
      label: 'Reply-To Email',
      type: 'email',
      hint: 'Optional. Where a recipient\'s reply actually goes — often a shared support inbox rather than the no-reply sending address',
    },
  ],
  // Masters §3.21b — Send Test Email (app-screens2.js:774-776, app-forms.js's
  // 'm.emailtest'). Posts the typed recipient to the real send-test endpoint
  // (masters_email_config.py:213, action='send_test' — already reserved in
  // the RBAC registry, screens.py:104-107) rather than a separate hardcoded
  // test path, so a green result actually proves the saved configuration
  // works.
  testAction: {
    label: 'Send Test Email',
    endpoint: '/masters/email-configuration/send-test',
    screenAction: 'send_test',
    promptLabel: 'Send To',
    promptPlaceholder: 'you@meshrd.in',
    buildBody: (toEmail) => ({ to_email: toEmail }),
    // Mirrors the prototype's own read-only "Using Server" line (app-forms.js:375):
    // whatever is CURRENTLY on screen, not a second fetch, so this can never
    // name a different server than what the last Save actually persisted.
    usingLabel: (row) => {
      if (isNamedProvider(row as Record<string, unknown>)) {
        return PROVIDER_OPTIONS.find((p) => p.value === row.provider)?.label ?? String(row.provider ?? '—');
      }
      const encLabel = ENCRYPTION_OPTIONS.find((o) => o.value === row.encryption)?.label;
      const hostPort = [row.smtp_host, row.smtp_port].filter((v) => v !== null && v !== undefined && v !== '').join(':');
      return [hostPort || 'Not configured', encLabel].filter(Boolean).join(' · ');
    },
    // send_test_email always returns 201 with a real EmailSendLog row — SENT
    // or FAILED — never a thrown error for a bad transport, so the result has
    // to be read out of the response body, not assumed from the HTTP status
    // (email_transport.send_raw never raises; masters_email_config.py:213-227).
    resultMessage: (response) => {
      const r = (response ?? {}) as SendTestEmailResponse;
      if (r.delivery_status === 'FAILED') {
        return `Test email failed — ${r.error_detail ?? 'see Recent Sends for the reason.'}`;
      }
      return 'Test email sent. Check Recent Sends for the result.';
    },
  },
};

export default config;
