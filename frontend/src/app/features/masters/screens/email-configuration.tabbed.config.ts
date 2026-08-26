import { TabbedScreenConfig } from '../../../shared/screens/screen.types';
import { EmailServerSettingsRow, EmailSendLogRow, EmailTemplateRow } from '../masters.api';

import serverSettings, { ENCRYPTION_OPTIONS, PROVIDER_OPTIONS } from './email-server-settings.singleton.config';
import templates from './email-templates.list.config';
import recentSends from './email-recent-sends.list.config';

// Masters §3.21 as the prototype renders it (app-screens2.js RECORDS.emailconfig):
// server settings, the per-trigger template list and the delivery log are one
// record with tabs, not three sibling routes.
const config: TabbedScreenConfig<EmailServerSettingsRow> = {
  shape: 'tabbed',
  id: 'masters.email_configuration',
  title: 'Email Configuration',
  specRef: '§3.21',
  description:
    'Every outbound email this CMS sends — the server it goes through and the per-trigger template list — configured here. Nothing is hardcoded: change the server, or switch a single notification off, without a code change.',
  headerEndpoint: '/masters/email-configuration/server-settings',
  header: {
    avatar: () => '@',
    recId: () => 'Masters §3.21',
    // GET returns null until the settings are first saved (the PUT is the
    // upsert), so the card states that rather than showing a blank host. Once
    // saved, From Name and From Email are both `required: true` on the form
    // (email-server-settings.singleton.config.ts), so they're always there to
    // build the identity from — unlike smtp_host, which is null for every
    // named provider (SendGrid/SES/Mailgun/Postmark authenticate via api_key,
    // not a host). Matches the prototype's own header name, `c.fromName + '
    // <' + c.fromEmail + '>'` (app-screens2.js:753).
    name: (row) => (row ? `${row.from_name} <${row.from_email}>` : 'Mail server not configured yet'),
    // Prototype meta is [c.provider, c.host + ':' + c.port, c.encryption]
    // (app-screens2.js:754) — Provider leads. Host:port and Encryption are
    // Custom-SMTP-only concepts here (smtp_host/encryption are null for a
    // named provider, per the form's own hints), so each is left out rather
    // than rendered as "null:null" or a stale value from a since-abandoned
    // Custom SMTP setup; RecordHeaderDef drops blank entries.
    meta: (row) => {
      if (!row) return [];
      const providerLabel = PROVIDER_OPTIONS.find((o) => o.value === row.provider)?.label ?? row.provider;
      const encryptionLabel = ENCRYPTION_OPTIONS.find((o) => o.value === row.encryption)?.label ?? '';
      return [
        providerLabel,
        row.smtp_host ? `${row.smtp_host}:${row.smtp_port ?? '—'}` : '',
        row.provider === 'CUSTOM_SMTP' ? encryptionLabel : '',
      ];
    },
    // Driven off the same Sending Enabled toggle the prototype's badge reads
    // (c.status, itself set by the toggle at app-screens2.js:753,763) rather
    // than merely row-exists/null, so switching Sending Enabled off actually
    // moves the badge instead of it reading "Active" regardless.
    badge: (row) => (row ? (row.sending_enabled ? 'Active' : 'Inactive') : 'Draft'),
    // MASTERS-COMPLETION-PROMPT.md §3 — three tiles (app-screens2.js:755):
    // Templates (count), Enabled (count of enabled templates), Last Test
    // (result of the most recent TEST send). `tabRows` is
    // RecordHeaderDef.summary's second param, added this pass specifically
    // so a header tile can read a DIFFERENT tab's already-fetched rows
    // instead of only headerEndpoint's — see screen.types.ts's RecordHeaderDef
    // and tabbed-screen.component.ts's tabRowsByKey for the mechanism.
    summary: (_row, tabRows) => {
      const templates = (tabRows['templates'] ?? []) as readonly EmailTemplateRow[];
      const sends = (tabRows['sends'] ?? []) as readonly EmailSendLogRow[];
      // No is_test flag exists on EmailSendLogRow — matching the prototype's
      // own mock data, a test send is identified by its subject, which
      // masters_email_config.py's send_test_email always suffixes this way
      // (dynamically, off From Name — see that file's own fix note).
      const lastTest = [...sends]
        .filter((s) => s.subject_snapshot.endsWith('— Test Email'))
        .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))[0];
      return [
        { label: 'Templates', value: String(templates.length) },
        { label: 'Enabled', value: String(templates.filter((t) => t.is_enabled).length) },
        { label: 'Last Test', value: lastTest ? (lastTest.delivery_status === 'SENT' ? 'Delivered' : 'Failed') : 'Never' },
      ];
    },
  },
  tabs: [
    { key: 'server', label: 'Server Settings', config: serverSettings },
    { key: 'templates', label: 'Email Templates', config: templates },
    { key: 'sends', label: 'Recent Sends', config: recentSends },
  ],
};

export default config;
