/* ==========================================================================
   MESHRD CMS PROTOTYPE — SCREEN RENDERERS (part 2)
   record (7 shapes) · pipeline · document · invdash · expsummary
   payrollrun · payslip · leavemy · taxdecl · letter · assign · depreciation
   assetcard · taskdetail · matrix · settings
   ========================================================================== */
(function () {
  'use strict';
  const C = window.CMS, D = C.D, U = window.U, R = window.RENDER;
  const svg = U.svg, esc = U.esc, inr = U.inr, inrAbbr = U.inrAbbr, S = U.S;

  /* Money alignment is normalised centrally — see U.moneyAlign in app-core.js. */
  const mini = (cols0, rows, go) => ((cols => `<div class="table-wrap"><table>
    <thead><tr>${cols.map(c => `<th class="${c.th || ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr class="${go ? 'clickable' : ''}" ${go ? `data-go="${go}"` : ''}>${cols.map(c => `<td class="${c.c || ''}">${U.cell(c, r, S.role)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}">${U.empty('Nothing here yet.')}</td></tr>`}</tbody></table></div>`)(cols0.map(U.moneyAlign)));

  /* ============================== RECORD SHAPES ============================== */
  const RECORDS = {
    employee: {
      head: () => {
        const e = D.employees[4];
        return { av: U.initials(e.name), id: e.id, name: e.name, meta: [e.desig, e.dept, e.type, e.loc], badge: e.status };
      },
      tabs: (role) => {
        const canEdit = role === 'superadmin' || role === 'hr';
        return [
          {
            k: 'personal', l: 'Personal Details', body: () => U.section('Personal Details', [
              { l: 'Photo', type: 'file', v: 'arun-menon.jpg' },
              { l: 'First Name', req: 1, v: 'Arun', ro: !canEdit, hint: '2–50 characters' },
              { l: 'Last Name', v: 'Menon', ro: !canEdit },
              { l: 'Email', req: 1, v: 'arun.menon@meshrd.in', ro: !canEdit, hint: 'Must be unique — also used as the login identifier' },
              { l: 'Phone', v: '98400 11005', ro: !canEdit, hint: '10-digit Indian mobile number' },
              { l: 'Date of Birth', v: '14-02-1994', ro: !canEdit, hint: 'Must be at least 18 as of the Joining Date' },
              { l: 'Gender', type: 'select', opts: ['Male', 'Female', 'Other', 'Prefer not to say'], ro: !canEdit },
              { l: 'Current Address', type: 'textarea', span: 2, v: 'Flat 3B, Sunrise Apartments, Velachery, Chennai 600042', ro: !canEdit }
            ], canEdit ? '' : 'Read-only for ' + esc(C.ROLES[role].name))
          },
          {
            k: 'employment', l: 'Employment Details', body: () => U.section('Employment Details', [
              { l: 'Department', type: 'select', req: 1, opts: C.DEPTS, ro: !canEdit },
              { l: 'Designation', type: 'select', req: 1, opts: D.masters.designation.map(d => d.name), ro: !canEdit },
              { l: 'Joining Date', req: 1, v: '05-09-2022', ro: !canEdit },
              { l: 'Employment Type', type: 'select', req: 1, opts: ['Full Time', 'Part Time', 'Contract', 'Intern'], ro: !canEdit },
              { l: 'Reporting Manager', type: 'select', opts: C.PEOPLE, ro: !canEdit, hint: 'Circular reporting chains are blocked' },
              { l: 'Status', type: 'select', req: 1, opts: ['Active', 'Inactive', 'On Notice', 'Exited'], ro: !canEdit },
              { l: 'Work Location', type: 'select', opts: ['Chennai', 'Coimbatore'], ro: !canEdit }
            ])
          },
          {
            k: 'account', l: 'Account & Login', body: () => U.section('Account & Login', [
              { l: 'Create Login', type: 'toggle', v: 1, on: 'Login created' },
              { l: 'Login Email', v: 'arun.menon@meshrd.in', ro: 1, hint: 'Mirrors Email — never a separate username' },
              { l: 'Set Role', type: 'select', req: 1, opts: ['Employee', 'Manager', 'Accountant', 'HR', 'Super Admin'], ro: role !== 'superadmin', lock: role !== 'superadmin' ? 'Super Admin only' : '' },
              { l: 'Account Status', type: 'toggle', v: 1, on: 'Enabled' },
              { l: 'Must Change Password on Next Login', v: 'No', ro: 1, hint: 'System-set — flips to Yes on account creation or Reset Password' },
              { l: 'Last Login', v: '29-07-2026 08:41', ro: 1 }
            ], '') + `<div class="form-section"><div class="form-section-head"><h4>Extra Permissions</h4>
              <span class="note">Per-person overrides — Super Admin only to add or remove</span></div>
              ${mini([{ k: 'perm', t: 'Permission' }, { k: 'module', t: 'Module' }, { k: 'type', t: 'Type', type: 'status' }, { k: 'by', t: 'Granted By' }, { k: 'on', t: 'Date', c: 'mono' }],
              D.overrides.filter(o => o.emp === 'Arun Menon'), 'rbac.overrides')}
              <div style="margin-top:10px;display:flex;gap:7px">
                <button class="btn ${role === 'superadmin' ? '' : 'disabled'}" data-go="rbac.overrides">${svg('plus', 14)} Add Permission Override</button>
                <button class="btn" data-toast="A new random temporary password is generated and emailed to the employee. HR never sees it. Must Change Password on Next Login is set to Yes.">${svg('refresh', 14)} Reset Password</button>
              </div></div>`
          },
          {
            k: 'bank', l: 'Bank & Statutory', body: () => U.section('Bank Details', [
              { l: 'Bank Name', v: 'HDFC Bank', ro: !canEdit }, { l: 'Bank Account Number', v: '50100XXXXXX8842', ro: !canEdit },
              { l: 'Confirm Bank Account Number', v: '50100XXXXXX8842', ro: !canEdit, hint: 'Typo safeguard — not stored separately' },
              { l: 'IFSC Code', v: 'HDFC0000521', ro: !canEdit, hint: 'Exactly 11 characters' },
              { l: 'PAN', v: 'AXKPM4471L', ro: !canEdit }, { l: 'Aadhaar Number', v: 'XXXX-XXXX-1234', ro: 1, hint: 'Displayed masked once saved' }
            ]) + `<div class="form-section"><div class="form-section-head"><h4>Statutory Identifiers</h4>
              <span class="note">One field per configured tax head that requires one — no tax is named in the specification</span></div>
              <div class="form-grid">
                ${U.field({ l: 'Retirement Fund — Member ID', v: 'MH/BAN/0012345/000/0009876', ro: !canEdit, hint: 'Label comes from the head\'s own Employee Identifier Label in Masters → Taxes' })}
                ${U.field({ l: 'State Employment Levy — Registration', v: 'TN-PT-0099231', ro: !canEdit, hint: 'This block renders only for heads with "Requires an Employee Identifier" set to Yes' })}
              </div></div>`
          },
          {
            k: 'salary', l: 'Salary Structure', body: (role) => {
              const saOnly = role !== 'superadmin';
              /* Basic is split out of the uniform map so it can carry req:1 — §2.2 marks it Mandatory. */
              const rows = [['Dearness Allowance — DA (Monthly)', 11250], ['HRA — House Rent Allowance (Monthly)', 22500], ['Leave Travel Allowance — LTA (Monthly or Annual)', 3750], ['Special Allowance (Monthly)', 26250], ['Other Earnings (Monthly)', 3750]];
              const gross = rows.reduce((a, r) => a + r[1], 0) + 45000;
              return U.note(saOnly ? `<b>Salary Structure is Super Admin only to edit.</b> HR and Accountant are view-only here — a deliberate tightening, distinct from the rest of HR's record-keeping authority. <b>One narrow exception:</b> Accountant can edit the Applicable toggles inside the Statutory block below, and nothing else on this tab.` : `<b>Super Admin.</b> Compensation-setting stays with this role. Rates, ceilings and thresholds are never entered here — they belong to the tax heads in Masters, and this tab only shows the result of applying them to one person's pay.`, saOnly ? 'warn' : '')
                + `<div class="form-section"><div class="form-section-head"><h4>Earnings</h4></div>
                <div class="form-grid">
                ${U.field({ l: 'Effective From', req: 1, v: '01-04-2026', ro: saOnly, hint: 'When this version of the structure starts applying. Cannot be in the future beyond the current financial year. A new Effective From closes the previous structure into Structure Change History rather than overwriting it, and decides which tax heads are in force for the Statutory block below.' })}
                ${U.field({ l: 'Basic Salary (Monthly)', req: 1, v: '45,000', ro: saOnly, hint: 'The core component. Basic + DA must be at least 50% of Annual CTC.' })}
                ${rows.map(r => U.field({ l: r[0], v: inr(r[1]).replace('₹', ''), ro: saOnly })).join('')}
                ${U.field({ l: 'Variable / Performance Pay (Annual)', v: '1,80,000', ro: saOnly, hint: 'Not included in Gross Monthly — it feeds Annual CTC and shows on whichever payslip it is paid out on' })}</div></div>
                <div class="form-section"><div class="form-section-head"><h4>Statutory Deductions &amp; Contributions</h4>
                  <span class="note">Generated from Masters → Taxes — one row per applicable head</span></div>
                  ${mini([{ k: 'label', t: 'Print Label', c: 'cell-strong' }, { k: 'borne', t: 'Borne By', type: 'chip' }, { k: 'amt', t: 'Monthly Amount', type: 'money', c: 'r', th: 'r' }, { k: 'app', t: 'Applicable', type: 'status' }],
                [{ label: 'Retirement Fund', borne: 'Employee', amt: 6750, app: 'Yes' },
                { label: 'Retirement Fund (Employer)', borne: 'Company', amt: 6750, app: 'Yes' },
                { label: 'State Levy', borne: 'Employee', amt: 208, app: 'Yes' },
                { label: 'Income Withholding', borne: 'Employee', amt: 7122, app: 'Yes' }])}
                  <div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary);line-height:1.5">
                    The per-employee <b>Applicable</b> toggle appears only on heads marked "Per-Employee Opt-Out Allowed" in Masters. Editable by Super Admin <i>or</i> Accountant — whether a statutory component applies to a person is a compliance judgment, not a compensation decision.
                    ${role === 'superadmin' || role === 'accountant' ? '' : '<br><b>Read-only for ' + esc(C.ROLES[role].name) + '.</b>'}
                  </div></div>
                <div class="form-section"><div class="form-section-head"><h4>Computed</h4></div>
                  <div class="totals" style="margin-left:0;width:340px">
                    <div class="tr"><span>Gross Monthly</span><b>${inr(gross)}</b></div>
                    <div class="tr"><span>Insurance — Employee Contribution</span><b>− ${inr(0)}</b></div>
                    <div class="tr"><span>Statutory (employee-borne)</span><b>− ${inr(14080)}</b></div>
                    <div class="tr"><span>Net Monthly (before income tax)</span><b>${inr(gross - 14080)}</b></div>
                    <div class="tr"><span>Annual CTC</span><b>${inr(gross * 12 + 180000 + 6750 * 12 + 12500 * 12)}</b></div>
                  </div>
                  <div style="margin-top:10px" class="rbac-note warn">${svg('alert', 14)}<div><b>Code on Wages validation.</b> Basic + DA must be at least 50% of Annual CTC. Currently <b>${(((45000 + 11250) * 12) / (gross * 12 + 180000 + 6750 * 12 + 12500 * 12) * 100).toFixed(1)}%</b> — saving a non-compliant split warns, and ideally blocks.</div></div>
                </div>
                <div class="form-section"><div class="form-section-head"><h4>Structure Change History</h4>
                  <span class="note">A new Effective From closes out the previous version rather than overwriting it</span></div>
                  ${mini([{ k: 'from', t: 'Effective From', c: 'mono' }, { k: 'to', t: 'Effective To', c: 'mono' }, { k: 'basic', t: 'Basic Salary', type: 'money', c: 'r', th: 'r' }, { k: 'gross', t: 'Gross Monthly', type: 'money', c: 'r', th: 'r' }, { k: 'ctc', t: 'Annual CTC', type: 'money', c: 'r', th: 'r' }, { k: 'by', t: 'Changed By' }],
                  [{ from: '01-04-2026', to: '—', basic: 45000, gross: 112500, ctc: 1611000, by: 'Ravi Shankar' },
                  { from: '01-04-2025', to: '31-03-2026', basic: 39000, gross: 97500, ctc: 1398000, by: 'Ravi Shankar' },
                  { from: '05-09-2022', to: '31-03-2025', basic: 32000, gross: 80000, ctc: 1152000, by: 'Ravi Shankar' }])}
                </div>`;
            }
          },
          {
            k: 'insurance', l: 'Insurance & Benefits', body: () => U.section('Enrollment', [
              { l: 'Insurance Plan', type: 'select', opts: ['Group Health — Standard, Group Term Life'], ro: !canEdit, hint: 'Multi-select — an employee can be enrolled in more than one plan' },
              { l: 'Enrollment Date', v: '01-04-2026', ro: !canEdit },
              { l: 'Nominee Name', v: 'Latha Menon', ro: !canEdit, hint: 'Required for Life / Personal Accident plans' },
              { l: 'Nominee Relationship', type: 'select', opts: ['Spouse', 'Parent', 'Sibling', 'Other'], ro: !canEdit },
              { l: 'Nominee Phone', v: '98400 55120', ro: !canEdit }
            ]) + `<div class="form-section"><div class="form-section-head"><h4>Dependents Covered</h4><span class="note">Health plans only</span></div>
              ${mini([{ k: 'n', t: 'Name', c: 'cell-strong' }, { k: 'r', t: 'Relationship' }], [{ n: 'Latha Menon', r: 'Spouse' }, { n: 'Kavya Menon', r: 'Child' }])}
              <div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary)">The selected plan's Company and Employee Contribution (Masters §3.19) flow automatically into Annual CTC and Net Monthly — the premium is never entered twice.</div></div>`
          },
          {
            k: 'emergency', l: 'Emergency Contact', body: () => U.section('Emergency Contact', [
              { l: 'Contact Name', v: 'Latha Menon', ro: !canEdit },
              { l: 'Relationship', type: 'select', opts: ['Spouse', 'Parent', 'Sibling', 'Friend', 'Other'], ro: !canEdit },
              { l: 'Contact Phone', v: '98400 55120', ro: !canEdit }
            ])
          },
          {
            k: 'docs', l: 'Documents', n: D.myDocs.length, body: () =>
              mini([{ k: 'type', t: 'Document Type', c: 'cell-strong' }, { k: 'file', t: 'File Name', c: 'mono' }, { k: 'up', t: 'Uploaded On', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'rej', t: 'Rejection Reason' }], D.myDocs, 'emp.documents')
              + `<div style="margin-top:10px;display:flex;gap:7px"><button class="btn ok" data-toast="Document verified. The employee is notified.">${svg('check', 14)} Verify</button>
                 <button class="btn no" data-toast="Reject requires a short reason, shown back to the employee so they can correct and re-upload.">Reject</button>
                 <button class="btn" data-go="emp.docqueue">${svg('list', 14)} Open the full queue</button></div>`
          },
          {
            k: 'assets', l: 'Assigned Assets', n: D.myAssets.length, body: () =>
              U.note('Pulled from Asset Management, read-only. No add, edit or reassign actions live here — those happen inside Asset Management itself.')
              + mini([{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Asset Name', c: 'cell-strong' }, { k: 'cat', t: 'Category' }, { k: 'pdate', t: 'Assigned Date', c: 'mono' }, { k: 'status', t: 'Condition', type: 'status' }], D.myAssets, 'asset.directory')
          },
          {
            k: 'leave', l: 'Leave & Attendance', body: () =>
              mini([{ k: 't', t: 'Leave Type', c: 'cell-strong' }, { k: 'allowed', t: 'Allowed', c: 'r num', th: 'r' }, { k: 'cf', t: 'Carried Forward', c: 'r num', th: 'r' }, { k: 'taken', t: 'Taken', c: 'r num', th: 'r' }, { k: 'rem', t: 'Remaining', c: 'r num cell-strong', th: 'r', calc: r => r.allowed ? r.allowed + r.cf - r.taken - r.pending : 'Not tracked' }], D.leaveBal)
              + `<div class="form-section" style="margin-top:16px"><div class="form-section-head"><h4>Attendance</h4>
                <span class="note">Only Super Admin can manually record attendance today</span></div>
                <div style="display:flex;gap:9px;margin-bottom:11px">
                  <button class="btn primary" data-go="emp.attendance">${svg('plus', 14)} Record Attendance</button>
                  <button class="btn disabled">${svg('clock', 14)} Biometric <span class="badge-s b-warn" style="margin-left:5px">Coming Soon</span></button>
                </div>
                ${mini([{ k: 'd', t: 'Date', c: 'mono' }, { k: 'i', t: 'Check-In', c: 'mono' }, { k: 'o', t: 'Check-Out', c: 'mono' }, { k: 'by', t: 'Recorded By' }],
                [{ d: '29-07-2026', i: '09:12', o: '18:40', by: 'Ravi Shankar' }, { d: '28-07-2026', i: '09:04', o: '19:15', by: 'Ravi Shankar' }, { d: '27-07-2026', i: '09:22', o: '18:10', by: 'Ravi Shankar' }])}</div>`
          }
        ];
      },
      actions: (role) => (role === 'superadmin' || role === 'hr')
        ? [{ l: 'Edit', icon: 'edit', cls: 'primary' }, { l: 'Generate Letter', icon: 'doc', go: 'emp.letter' }, { l: 'Raise Exit', icon: 'logout', go: 'emp.offboarding' }]
        : [{ l: 'Export PDF', icon: 'download' }]
    },

    myprofile: {
      head: () => { const R2 = C.ROLES[S.role]; return { av: R2.init, id: 'My Profile', name: R2.who, meta: [R2.name + ' role', R2.email, 'Chennai'], badge: 'Active' }; },
      tabs: (role) => {
        /* RBAC §1: Super Admin's access is unrestricted — they are never gated behind
           anyone else's approval, including on their own profile. HR owns the Employee
           Master Record (§2.2) and edits these fields there directly, so HR is not
           gated either. The approval queue exists for the roles that genuinely cannot
           edit the master record: Employee, Manager and Accountant (§2.3). */
        const selfServe = role === 'superadmin' || role === 'hr';
        const gate = selfServe ? {} : { ro: 1, lock: 'Request Change' };
        const idFields = [
          { l: 'Date of Birth', v: '14-02-1994', hint: 'Cannot be in the future; must be at least 18 as of the Joining Date' },
          { l: 'Gender', type: 'select', opts: ['Male', 'Female', 'Other', 'Prefer not to say'] },
          { l: 'Bank Name', v: 'HDFC Bank' },
          { l: 'Bank Account Number', v: '50100XXXXXX8842', hint: 'Numeric, checked for a plausible length' },
          { l: 'IFSC Code', v: 'HDFC0000521', hint: 'Exactly 11 characters' },
          { l: 'PAN', v: 'AXKPM4471L', hint: 'Exactly 10 characters' },
          { l: 'Aadhaar Number', v: 'XXXX-XXXX-1234', hint: '12 digits; displayed masked once saved' }
        ].map(f => Object.assign({}, f, gate));
        /* HR-set employment fields: Super Admin and HR edit these on the master record,
           so they stay open here too. Everyone else sees them read-only. */
        const hrFields = [
          { l: 'Employee ID', v: 'EMP-2026-0005', ro: 1, lock: 'Auto-generated' },
          { l: 'Department', v: 'Engineering' }, { l: 'Designation', v: 'Senior Engineer' },
          { l: 'Joining Date', v: '05-09-2022' }, { l: 'Employment Type', v: 'Full Time' },
          { l: 'Reporting Manager', v: 'Vikram Iyer' }
        ].map(f => (selfServe || f.ro) ? f : Object.assign({}, f, { ro: 1 }));

        return [
          {
            k: 'personal', l: 'Personal Details', body: () =>
              (selfServe
                ? U.note('<b>' + esc(C.ROLES[role].name) + ' — unrestricted on this record.</b> ' +
                  (role === 'superadmin'
                    ? 'Super Admin access is never gated behind another role\'s approval (RBAC §1), so every field here is directly editable — including bank and statutory details.'
                    : 'HR owns the Employee Master Record (§2.2) and edits these fields there directly, so nothing on your own profile routes through an approval queue.'))
                : U.note('Fields you can change yourself are open below. <b>Identity, bank and statutory changes route to an HR approval queue</b> — unless <code>Allow Employee to Edit Bank Details Directly</code> is turned on (RBAC §2.1, OFF by default).', 'warn'))
              + U.section('Editable directly — no approval needed', [
                { l: 'Phone', v: '98400 11005' }, { l: 'Current Address', type: 'textarea', span: 2, v: 'Flat 3B, Sunrise Apartments, Velachery, Chennai 600042' },
                { l: 'Emergency Contact Name', v: 'Latha Menon' },
                { l: 'Emergency Contact Relationship', type: 'select', opts: ['Spouse', 'Parent', 'Sibling', 'Friend', 'Other'] },
                { l: 'Emergency Contact Phone', v: '98400 55120' }, { l: 'Photo', type: 'file', v: 'Change photo' }
              ])
              + U.section(selfServe ? 'Identity, bank & statutory — editable directly' : 'Editable — needs HR approval', idFields,
                selfServe ? 'No approval step applies to this role' : 'A “Pending Approval” badge shows on a field until HR resolves the request; the old value stays in effect meanwhile')
              + U.section(selfServe ? 'Employment details — editable directly' : 'Read-only — set by HR', hrFields,
                selfServe ? 'You edit these on the Employee Master Record; shown here for convenience' : 'Changed only by HR on the Employee Master Record')
              + (selfServe
                ? `<div style="margin-top:10px"><button class="btn primary" data-toast="Saved. ${esc(C.ROLES[role].name)} edits apply immediately — no approval step.">${svg('check', 14)} Save Changes</button></div>`
                : `<div style="margin-top:10px"><button class="btn primary" data-go="emp.changereq">${svg('edit', 14)} Request Change</button></div>`)
          },
        {
          k: 'password', l: 'Change Password', body: () => U.section('Change Own Password', [
            { l: 'Current Password', req: 1, ph: '••••••••' }, { l: 'New Password', req: 1, ph: '••••••••' }, { l: 'Confirm New Password', req: 1, ph: '••••••••' }
          ], 'This is the same form a temporary password redirects into on first login')
        },
        {
          k: 'insurance', l: 'My Insurance', body: () => U.note('Read-only. Enrollment is HR/Super Admin-managed at a fixed annual window, unless <code>Allow Employee to Change Insurance Plan Mid-Year</code> is on.')
            + mini([{ k: 'name', t: 'Plan', c: 'cell-strong' }, { k: 'type', t: 'Type', type: 'chip' }, { k: 'cover', t: 'Sum Insured', type: 'money', c: 'r', th: 'r' }, { k: 'emp', t: 'My Contribution', type: 'money', c: 'r', th: 'r' }], D.masters.insurance.slice(0, 1).concat(D.masters.insurance.slice(2, 3)))
        },
        { k: 'resign', l: 'Raise Resignation', body: () => U.section('Raise Resignation', [{ l: 'Last Working Day', req: 1, hint: 'Must be after today' }, { l: 'Reason', type: 'textarea', span: 2 }], 'Goes to your Reporting Manager for acknowledgment; HR is notified once acknowledged') }
        ];
      },
      actions: () => [{ l: 'Save Changes', cls: 'primary', icon: 'check' }, { l: 'Cancel' }]
    },

    asset: {
      head: () => { const a = D.assets[0]; return { av: svg('asset', 20), id: a.tag, name: a.name, meta: [a.cat, 'Serial ' + a.serial, a.loc], badge: a.status }; },
      tabs: (role) => [
        {
          k: 'details', l: 'Details', body: () => {
            const canEdit = role === 'superadmin' || role === 'accountant';
            const hideVal = role === 'manager';
            return U.section('Identity', [
              { l: 'Asset Tag', v: 'AST-2026-0001', ro: 1, hint: 'Auto-generated from the Number Prefixes table' },
              { l: 'Asset Name', req: 1, v: 'MacBook Pro 14" M3', ro: !canEdit },
              { l: 'Category', type: 'select', req: 1, opts: D.masters.assetCategories.map(c => c.name), ro: !canEdit },
              { l: 'Serial Number', v: 'C02XL0AAJGH5', ro: !canEdit, hint: 'Unique if provided' },
              { l: 'Location / Branch', type: 'select', opts: ['Chennai', 'Coimbatore'], ro: !canEdit, hint: 'Sourced from Company Profile → Addresses' },
              { l: 'Vendor', type: 'select', opts: ['—'].concat(C.VENDORS), ro: !canEdit }
            ]) + U.section('Purchase & Depreciation', hideVal ? [
              { l: 'Order Date', v: '02-04-2024', ro: 1 }, { l: 'Purchase Date', v: '12-04-2024', ro: 1 }, { l: 'Warranty Expiry', v: '11-04-2027', ro: 1 },
              { l: 'Purchase Value', v: 'Hidden', ro: 1, lock: 'Show Purchase Value to Manager is OFF' },
              { l: 'Current Value', v: 'Hidden', ro: 1, lock: 'Show Purchase Value to Manager is OFF' }
            ] : [
              { l: 'Order Date', v: '02-04-2024', ro: !canEdit, hint: 'Must be on or before Purchase Date' },
              { l: 'Purchase Date', req: 1, v: '12-04-2024', ro: !canEdit },
              { l: 'Warranty Expiry', v: '11-04-2027', ro: !canEdit },
              { l: 'Purchase Value (₹)', v: '1,85,000', ro: !canEdit, hint: 'Depreciation cannot be calculated without it' },
              { l: 'Useful Life (Years)', v: '4', ro: !canEdit, hint: 'Required if Purchase Value is filled in' },
              { l: 'Depreciation Method', type: 'select', req: 1, opts: ['Straight Line'], ro: !canEdit, hint: 'Mandatory. Straight Line is the only option today — built so more methods can be added later without a rebuild' }
            ]) + U.section('Assignment & Status', [
              { l: 'Status', v: 'In Use', ro: 1, lock: 'Locked after creation', hint: 'Changes only through Assign / Transfer / Unassign, so Assignment History stays complete' },
              { l: 'Assigned To', v: 'Arun Menon', ro: 1, lock: 'Locked after creation' },
              { l: 'Notes', type: 'textarea', span: 3, v: 'Issued at onboarding. AppleCare+ purchased.', ro: !canEdit },
              { l: 'Attachments', type: 'file', v: 'invoice-AST-0001.pdf, photo-front.jpg' }
            ]);
          }
        },
        {
          k: 'history', l: 'Assignment History', n: D.assignHistory.length, body: () =>
            mini([{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'from', t: 'From Date', c: 'mono' }, { k: 'to', t: 'To Date', c: 'mono' }, { k: 'action', t: 'Action', type: 'chip' }, { k: 'by', t: 'Performed By' }, { k: 'reason', t: 'Reason' }], D.assignHistory)
            + `<div style="margin-top:10px"><button class="btn primary ${role === 'superadmin' || role === 'hr' ? '' : 'disabled'}" data-go="asset.assign">${svg('employee', 14)} Assign / Transfer / Unassign</button></div>`
        },
        {
          k: 'maint', l: 'Maintenance & Service', n: 1, body: () =>
            mini([{ k: 'date', t: 'Date', c: 'mono' }, { k: 'desc', t: 'Description', c: 'cell-strong' }, { k: 'cost', t: 'Cost', type: 'money', c: 'r', th: 'r' }, { k: 'next', t: 'Next Due Date', c: 'mono' }], D.maintenance.filter(m => m.tag === 'AST-2026-0001'))
            + `<div style="margin-top:10px"><button class="btn ${role === 'superadmin' || role === 'accountant' ? 'primary' : 'disabled'}" data-go="asset.maintenance">${svg('plus', 14)} Add Maintenance Entry</button></div>`
        },
        { k: 'dep', l: 'Depreciation', body: () => R.depreciationBody(role) }
      ],
      actions: (role) => (role === 'superadmin' || role === 'accountant')
        ? [{ l: 'Save', cls: 'primary', icon: 'check' }, { l: 'Download Asset Card', icon: 'download', go: 'asset.download' }, { l: 'Mark Retired/Disposed', cls: 'no' }]
        : [{ l: 'Download Asset Card', icon: 'download', go: 'asset.download' }]
    },

    customer: {
      head: () => {
        const c = D.customers[0];
        return {
          av: svg('customer', 20), id: c.code, name: c.name, meta: [c.source, 'Owner: ' + c.owner, c.city], badge: c.status,
          summary: [{ l: 'Total Invoiced', v: inr(c.inv) }, { l: 'Received', v: inr(c.inv - c.out) }, { l: 'Outstanding', v: inr(c.out) }]
        };
      },
      tabs: () => [
        {
          k: 'overview', l: 'Overview', body: () => U.section('Master Record', [
            { l: 'Company Name', v: 'Trinetra Systems Pvt Ltd', ro: 1 }, { l: 'Display Name', v: 'Trinetra', ro: 1 },
            { l: 'Customer Code', v: 'CUST-2026-0001', ro: 1 }, { l: 'GSTIN', v: '33AABCT1234M1Z5', ro: 1 }, { l: 'PAN', v: 'AABCT1234M', ro: 1 },
            { l: 'Status', v: 'Active', ro: 1 }, { l: 'Source', v: D.customers[0].source, ro: 1, hint: 'From Masters → Customer Source (Section 3.16)' }, { l: 'Owner', v: 'Meera Joshi', ro: 1 },
            { l: 'Website', v: 'https://trinetra.in', ro: 1 }, { l: 'Mobile Number', v: '98410 22001', ro: 1 }, { l: 'Email', v: 'priya.n@trinetra.in', ro: 1 },
            { l: 'Address', type: 'textarea', span: 3, v: 'No. 22, Anna Salai, Guindy, Chennai 600032', ro: 1 },
          { l: 'Notes', type: 'textarea', span: 3, v: 'Parent group is consolidating vendors this year. Renewal scope agreed pending the driver-summary report.', ro: 1 }
          ], 'The money summary sits in the persistent header above, so it is not repeated here')
        },
        {
          k: 'contacts', l: 'Contacts', n: D.contacts.length, body: () =>
            mini([{ k: 'name', t: 'Name', c: 'cell-strong', avatar: 1 }, { k: 'desig', t: 'Designation' }, { k: 'email', t: 'Email' }, { k: 'phone', t: 'Phone', c: 'mono' }, { k: 'primary', t: 'Primary', type: 'status' }], D.contacts)
            + `<div style="margin-top:10px"><button class="btn primary" data-go="cust.contact">${svg('plus', 14)} Add Contact</button></div>`
        },
        {
          k: 'activities', l: 'Activities', n: D.activities.length, body: () => `<div class="timeline">${D.activities.map(a => {
            const tone = { Meeting: 'var(--accent)', Call: 'var(--success)', Email: 'var(--info)', Note: 'var(--warning)' }[a.type];
            const bg = { Meeting: 'var(--accent-subtle)', Call: 'var(--success-bg)', Email: 'var(--info-bg)', Note: 'var(--warning-bg)' }[a.type];
            const ic = { Meeting: 'employee', Call: 'phone', Email: 'mail', Note: 'doc' }[a.type];
            return `<div class="tl-item"><div class="tl-dot" style="--tone:${tone};--tone-bg:${bg}">${svg(ic, 11)}</div>
              <div class="tl-head"><span class="who">${esc(a.type)}</span><span class="when">${esc(a.date)}</span>
              <span style="font-size:11px;color:var(--text-tertiary)">by ${esc(a.by)}${a.contact !== '—' ? ' · with ' + esc(a.contact) : ''}</span></div>
              <div class="tl-body">${esc(a.desc)}</div></div>`;
          }).join('')}</div>
            <div style="margin-top:12px"><button class="btn primary" data-go="cust.activity">${svg('plus', 14)} Add Activity</button></div>`
        },
        {
          k: 'opps', l: 'Opportunities', n: 1, body: () => U.note('Read-only. The Opportunity module owns everything about a deal beyond this summary.')
            + mini([{ k: 'title', t: 'Opportunity', c: 'cell-strong' }, { k: 'stage', t: 'Stage', type: 'status' }, { k: 'val', t: 'Value', type: 'money', c: 'r', th: 'r' }, { k: 'close', t: 'Expected Close', c: 'mono' }, { k: 'owner', t: 'Owner' }], D.opportunities.filter(o => o.cust === 'Trinetra Systems Pvt Ltd'), 'opp.pipeline')
        },
        {
          k: 'projects', l: 'Projects', n: 2, body: () => mini([{ k: 'name', t: 'Project Name', c: 'cell-strong' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'start', t: 'Start Date', c: 'mono' }, { k: 'end', t: 'End Date', c: 'mono' }],
            D.projects.filter(p => p.cust === 'Trinetra Systems Pvt Ltd'), 'proj.directory')
        },
        {
          k: 'invoices', l: 'Invoices', n: 2, body: () => U.note('This tab is the data source for the Total Invoiced / Received / Outstanding figures in the header — those three numbers are summed from here, not stored separately.')
            + mini([{ k: 'no', t: 'Invoice Number', c: 'mono cell-accent' }, { k: 'due', t: 'Due Date', c: 'mono' }, { k: 'total', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'bal', t: 'Balance', type: 'money', c: 'r', th: 'r' }],
              D.invoices.filter(i => i.cust === 'Trinetra Systems Pvt Ltd'), 'inv.list')
        },
        {
          k: 'tickets', l: 'Tickets', n: 2, body: () => mini([{ k: 'no', t: 'Ticket Number', c: 'mono cell-accent' }, { k: 'subj', t: 'Subject', c: 'cell-strong' }, { k: 'pri', t: 'Priority', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'to', t: 'Assigned To' }],
            D.tickets.filter(t => t.cust === 'Trinetra Systems Pvt Ltd'), 'ticket.detail')
        },
        {
          k: 'files', l: 'Files', n: 3, body: () => mini([{ k: 'f', t: 'File Name', c: 'cell-strong mono' }, { k: 'by', t: 'Uploaded By' }, { k: 'on', t: 'Uploaded On', c: 'mono' }, { k: 'sz', t: 'Size', c: 'r mono', th: 'r' }],
            [{ f: 'MSA-Trinetra-2024.pdf', by: 'Meera Joshi', on: '12-04-2024', sz: '1.4 MB' },
            { f: 'SOW-analytics-addon.pdf', by: 'Meera Joshi', on: '15-07-2026', sz: '820 KB' },
            { f: 'renewal-notes-Q2.docx', by: 'Divya Raman', on: '27-07-2026', sz: '64 KB' }])
            + `<div style="margin-top:10px"><button class="btn primary" data-toast="Upload — PDF/JPG/PNG/DOCX up to 5 MB.">${svg('upload', 14)} Upload File</button></div>`
        }
      ],
      actions: () => [{ l: 'Edit', icon: 'edit', cls: 'primary', go: 'cust.edit' }, { l: 'New Invoice', icon: 'invoice', go: 'inv.edit' }, { l: 'Export PDF', icon: 'download' }]
    },

    opportunity: {
      head: () => {
        const o = D.opportunities[0];
        return {
          av: svg('opp', 20), id: o.code, name: o.title, meta: [o.cust, 'Owner: ' + o.owner, o.close],
          badge: o.stage,
          summary: [{ l: 'Value', v: inr(o.val) }, { l: 'Probability', v: o.prob + '%' }, { l: 'Expected Close', v: o.close }]
        };
      },
      tabs: () => [
        {
          k: 'details', l: 'Details', body: () => U.section('Deal', [
            { l: 'Title', v: 'Analytics add-on — Trinetra', ro: 1 }, { l: 'Opportunity Code', v: 'OPP-2026-0001', ro: 1 },
            { l: 'Customer', v: 'Trinetra Systems Pvt Ltd', ro: 1 }, { l: 'Value (₹)', v: '18,50,000', ro: 1 },
            { l: 'Stage', v: 'Proposal', ro: 1 }, { l: 'Probability (%)', v: '60', ro: 1 },
            { l: 'Expected Close Date', v: '30-08-2026', ro: 1 }, { l: 'Owner', v: 'Meera Joshi', ro: 1 },
            { l: 'Description', type: 'textarea', span: 3, v: 'Analytics module licence plus a 12-report custom pack for the Guindy office, with 2 days of onsite training.', ro: 1 }
          ], 'Edit opens the full form (2.2) — this tab is read-only, matching the same pattern Customer 360 uses')
        },
        {
          k: 'activities', l: 'Activities', n: D.oppActivities.length, body: () => `<div class="timeline">${D.oppActivities.map(a => {
            const tone = { Meeting: 'var(--accent)', Call: 'var(--success)', Email: 'var(--info)', Note: 'var(--warning)' }[a.type];
            const bg = { Meeting: 'var(--accent-subtle)', Call: 'var(--success-bg)', Email: 'var(--info-bg)', Note: 'var(--warning-bg)' }[a.type];
            const ic = { Meeting: 'employee', Call: 'phone', Email: 'mail', Note: 'doc' }[a.type];
            return `<div class="tl-item"><div class="tl-dot" style="--tone:${tone};--tone-bg:${bg}">${svg(ic, 11)}</div>
              <div class="tl-head"><span class="who">${esc(a.type)}</span><span class="when">${esc(a.date)}</span>
              <span style="font-size:11px;color:var(--text-tertiary)">by ${esc(a.by)}${a.contact !== '—' ? ' · with ' + esc(a.contact) : ''}</span></div>
              <div class="tl-body">${esc(a.desc)}</div></div>`;
          }).join('')}</div>
            <div style="margin-top:12px"><button class="btn primary" data-go="opp.activity">${svg('plus', 14)} Add Activity</button></div>`
        },
        {
          k: 'files', l: 'Files', n: D.oppFiles.length, body: () => mini([{ k: 'f', t: 'File Name', c: 'cell-strong mono' }, { k: 'by', t: 'Uploaded By' }, { k: 'on', t: 'Uploaded On', c: 'mono' }, { k: 'sz', t: 'Size', c: 'r mono', th: 'r' }],
            D.oppFiles)
            + `<div style="margin-top:10px"><button class="btn primary" data-toast="Upload — PDF/JPG/PNG/DOCX up to 5 MB.">${svg('upload', 14)} Upload File</button></div>`
        }
      ],
      actions: () => [{ l: 'Edit', icon: 'edit', cls: 'primary', go: 'opp.edit' }, { l: 'Create Invoice', icon: 'invoice', go: 'inv.edit' }, { l: 'Export PDF', icon: 'download' }]
    },

    vendor: {
      head: () => { const v = D.vendors[1]; return { av: svg('vendor', 20), id: 'Vendor', name: v.name, meta: [v.gstin, v.city, v.terms], badge: v.status }; },
      tabs: (role) => {
        const bankHidden = role === 'manager';
        return [
          {
            k: 'details', l: 'Details', body: () => U.section('Vendor', [
              { l: 'Vendor Name', req: 1, span: 2, v: 'Chola Technologies', hint: '2–150 characters' },
              { l: 'Status', type: 'toggle', v: 1, req: 1, on: 'Active', hint: 'Defaults to Active' },
              { l: 'GSTIN', v: bankHidden ? 'Hidden' : '33AACCC3344M1Z4', ro: bankHidden, lock: bankHidden ? 'Accountant / Super Admin only' : '', hint: 'Exactly 15 characters, auto-uppercased' },
              { l: 'PAN', v: bankHidden ? 'Hidden' : 'AACCC3344M', ro: bankHidden, lock: bankHidden ? 'Accountant / Super Admin only' : '' },
              { l: 'Payment Terms (days)', v: '15', hint: 'Defaults to 30 if left blank' },
              { l: 'Contact Email', v: 'billing@cholatech.in' }, { l: 'Contact Phone', v: '98411 30002' }
            ]) + U.section('Address', [
              { l: 'Address — Street', v: '4th Floor, Prince Info Park, Ambattur' }, { l: 'Address — City', v: 'Chennai' },
              { l: 'Address — State', type: 'select', opts: ['Tamil Nadu', 'Karnataka', 'Maharashtra'] }, { l: 'Address — PIN Code', v: '600058', hint: 'Exactly 6 digits' }
            ]) + U.section('Bank Details — the vendor\'s own account, for Meshrd to pay them', bankHidden ? [
              { l: 'Bank Account Number', v: 'Hidden', ro: 1, lock: 'Allow Manager to Edit Vendor Bank & GST Details is OFF' },
              { l: 'IFSC Code', v: 'Hidden', ro: 1, lock: 'Allow Manager to Edit Vendor Bank & GST Details is OFF' }
            ] : [
              { l: 'Bank Account Number', v: '918020XXXXXX331' },
              { l: 'IFSC Code', v: 'UTIB0000412', hint: 'Exactly 11 characters — without it a bill payment cannot be routed by NEFT/RTGS' }
            ], 'Completely separate from the Bank Account sub-master in Masters, which holds only Meshrd\'s own accounts')
          },
          {
            k: 'usage', l: 'Usage', n: D.vendorUsage.length, body: () =>
              U.note('A vendor with <b>any</b> usage history can only be Deactivated, never deleted — deleting one already in use would break that history. The Delete button is simply not shown once a vendor has any usage at all.', 'warn')
              + mini([{ k: 'type', t: 'Type', type: 'chip' }, { k: 'ref', t: 'Reference', c: 'mono cell-accent' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'status', t: 'Status', type: 'status' }], D.vendorUsage, 'vendor.usage')
          }
        ];
      },
      actions: () => [{ l: 'Save', cls: 'primary', icon: 'check' }, { l: 'Deactivate', cls: 'no' }, { l: 'Delete', cls: 'disabled', toast: 'Delete is unavailable — this vendor has 5 linked records.' }]
    },

    workweek: {
      head: () => {
        const p = D.masters.workWeek[0];
        const jun = D.masters.satCalendar.filter(s => s.month === 'Jun 2026');
        const satWork = jun.filter(s => s.actual === 'Working').length;
        const days = 22 + satWork;
        return {
          av: svg('clock', 20), id: 'Masters §3.20', name: 'Work Week & Hours',
          meta: [D.masters.workWeek.filter(w => w.status === 'Active').length + ' active policies', p.satrule, 'FY 2026–27'],
          badge: 'Active',
          summary: [
            { l: 'Net Hours / Day', v: p.net.toFixed(2) },
            { l: 'Weekly Target', v: p.weekly + ' h' },
            { l: 'Working Days — Jun', v: String(days) },
            { l: 'Required Hours', v: String(days * p.net) }
          ]
        };
      },
      tabs: (role) => {
        const ro = role !== 'superadmin';
        const p = D.masters.workWeek[0];
        return [
          {
            k: 'policies', l: 'Work Week Policies', n: D.masters.workWeek.length, body: () =>
              U.note('Every figure below is configured here, not built into the software. A narrower policy (a department, an employment type, a named person) always wins over the company-wide default for the people it covers.')
              + mini([
                { k: 'name', t: 'Policy', c: 'cell-strong' },
                { k: 'applies', t: 'Applies To' },
                { k: 'gross', t: 'Gross h/day', c: 'r num', th: 'r' },
                { k: 'brk', t: 'Break', c: 'r num', th: 'r' },
                { k: 'net', t: 'Net h/day', c: 'r num cell-strong', th: 'r' },
                { k: 'weekly', t: 'Weekly Target', c: 'r num', th: 'r' },
                { k: 'weekoff', t: 'Weekly Off' },
                { k: 'satrule', t: 'Saturday Rule', type: 'chip' },
                { k: 'comp', t: 'Comp Allowed', type: 'status' },
                { k: 'shortfall', t: 'Shortfall Becomes' },
                { k: 'status', t: 'Status', type: 'status' }
              ], D.masters.workWeek, 'masters.workweek.add')
              + `<div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">
                 <button class="btn ${ro ? 'disabled' : 'primary'}" data-go="masters.workweek.add">${svg('plus', 14)} Add Policy</button>
                 ${ro ? '' : '<button class="btn" data-toast="Deactivating a policy leaves already-processed payroll periods untouched — it only affects future runs.">Deactivate</button>'}</div>`
              + (ro ? U.note('Read-only for ' + esc(C.ROLES[role].name) + ' — these numbers decide pay, so only Super Admin changes them. You can see every rule you may be asked about.', 'warn') : '')
          },
          {
            k: 'day', l: 'Daily Hours', body: () => {
              const grace = 15;
              return U.note('<b>' + p.gross + ' hours gross − ' + p.brk + ' hour break = ' + p.net.toFixed(2) + ' net hours</b> is what an employee has to actually reach on a working day. Attendance measures against the net figure, never the gross one — so sitting at a desk for nine hours with a two-hour lunch is a shortfall.')
                + U.section('Derived From “' + p.name + '”', [
                  { l: 'Gross Hours per Day', v: String(p.gross), ro: 1, lock: 'Configured' },
                  { l: 'Unpaid Break (hours)', v: String(p.brk), ro: 1, lock: 'Configured' },
                  { l: 'Net Working Hours per Day', v: p.net.toFixed(2), ro: 1, lock: 'Derived', hint: 'Gross − Break. The figure payroll compares against' },
                  { l: 'Grace Window', v: grace + ' minutes', ro: 1, lock: 'Configured', hint: 'A day landing within ' + grace + ' minutes of the target still counts as a Full Day' },
                  { l: 'Half Day Threshold', v: '4.00 hours', ro: 1, lock: 'Configured' },
                  { l: 'Weekly Hour Target', v: p.weekly + ' hours', ro: 1, lock: 'Configured', hint: '5 working days × ' + p.net.toFixed(0) + ' net hours, Saturdays excluded' }
                ], ro ? 'Read-only' : '')
                + `<div class="form-section"><div class="form-section-head"><h4>Hour Bands → Day Status</h4>
                   <span class="note">How worked hours become a payable day — the bands, not attendance itself, decide</span></div>
                   ${mini([
                  { k: 'status', t: 'Day Status', c: 'cell-strong' },
                  { k: 'min', t: 'From', c: 'mono r', th: 'r' },
                  { k: 'max', t: 'To', c: 'mono r', th: 'r' },
                  { k: 'pay', t: 'Paid As', c: 'mono cell-accent r', th: 'r' },
                  { k: 'ded', t: 'Deduction' },
                  { k: 'note', t: 'Note' }
                ], D.masters.hourRules)}</div>`;
            }
          },
          {
            k: 'saturday', l: 'Saturday Calendar', n: D.masters.satCalendar.length, body: () => {
              const work = D.masters.satCalendar.filter(s => s.actual === 'Working').length;
              const off = D.masters.satCalendar.filter(s => s.actual === 'Week Off').length;
              const hol = D.masters.satCalendar.filter(s => s.actual === 'Holiday').length;
              return U.note('<b>' + p.satrule + '</b> — resolved across FY 2026–27: <b>' + work + ' working</b>, <b>' + off + ' week off</b>, <b>' + hol + '</b> taken by a Mandatory holiday. Change the rule on the policy and this whole table redraws; or override one Saturday at a time when a release weekend needs it.')
                + mini([
                  { k: 'month', t: 'Month', c: 'cell-strong' },
                  { k: 'date', t: 'Date', c: 'mono' },
                  { k: 'ord', t: 'Which', type: 'chip' },
                  { k: 'rule', t: 'Pattern Says' },
                  { k: 'actual', t: 'Actually', type: 'status' },
                  { k: 'hrs', t: 'Hours Required', c: 'r num', th: 'r' },
                  { k: 'note', t: 'Override / Note' }
                ], D.masters.satCalendar)
                + `<div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">
                   <button class="btn ${ro ? 'disabled' : 'primary'}" data-go="masters.workweek.satrule">${svg('edit', 14)} Override a Saturday</button>
                   <button class="btn" data-toast="Exports every Saturday of the financial year with its resolved status — the file HR circulates at the start of the year.">${svg('download', 14)} Export Calendar</button></div>`
                + U.note('A Mandatory holiday always beats the Saturday pattern. <b>15-08-2026</b> is a 3rd Saturday, which the odd rule would make a working day — Independence Day makes it a holiday instead, and required hours for that date drop to zero.');
            }
          },
          {
            k: 'comp', l: 'Compensation', body: () => {
              const pend = D.compRequests.filter(r => r.status === 'Pending').length;
              return U.note('The rule the company actually runs on: someone who leaves halfway through the day for an emergency does <b>not</b> lose half a day\'s pay — they work the missing hours on another day <b>of their own choosing</b>, and the shortfall clears. Only hours never made up reach the payslip.')
                + U.section('Compensation Rules — “' + p.name + '”', [
                  { l: 'Allow Compensatory Hours', v: p.comp === 'Yes' ? 'Yes' : 'No', ro: 1, lock: 'Configured' },
                  { l: 'Compensation Window', v: p.window + ' days', ro: 1, lock: 'Configured', hint: 'How long after the shortfall the make-up day may fall' },
                  { l: 'Make-Up Day Chosen By', v: 'Employee — subject to approval', ro: 1, lock: 'Configured' },
                  { l: 'Allow Make-Up on a Week Off', v: 'Yes — including non-working Saturdays', ro: 1, lock: 'Configured', hint: 'An off Saturday is the most common make-up day in practice' },
                  { l: 'Allow Make-Up on a Mandatory Holiday', v: 'No', ro: 1, lock: 'Configured' },
                  { l: 'Max Compensatory Hours per Month', v: '16 hours', ro: 1, lock: 'Configured', hint: 'A ceiling, so compensation cannot quietly become unpaid overtime' },
                  { l: 'Uncompensated Shortfall Becomes', v: p.shortfall + ' (Loss of Pay)', ro: 1, lock: 'Configured' },
                  { l: 'Excess Hours Become', v: 'Compensatory credit — expires with the window', ro: 1, lock: 'Configured' }
                ], ro ? 'Read-only' : '')
                + `<div class="form-section"><div class="form-section-head"><h4>Open Compensatory Requests</h4>
                   <span class="note">${pend} awaiting approval — the live queue lives in Leave → Compensatory Hours</span></div>
                   ${mini([
                  { k: 'id', t: 'Request #', c: 'mono cell-accent' },
                  { k: 'emp', t: 'Employee', c: 'cell-strong' },
                  { k: 'shortDate', t: 'Shortfall', c: 'mono' },
                  { k: 'shortHrs', t: 'Short', c: 'r num', th: 'r' },
                  { k: 'makeupDate', t: 'Make-Up Day', c: 'mono' },
                  { k: 'makeupHrs', t: 'Hours', c: 'r num', th: 'r' },
                  { k: 'status', t: 'Status', type: 'status' }
                ], D.compRequests, 'leave.comp')}
                   <div style="margin-top:10px"><button class="btn" data-go="leave.comp">${svg('leave', 14)} Open the full queue</button></div></div>`;
            }
          },
          {
            k: 'paycycle', l: 'Pay Cycle', body: () => {
              const c = D.masters.payrollCycle;
              const jul = D.payPeriodRange('July', 2026), aug = D.payPeriodRange('August', 2026), sep = D.payPeriodRange('September', 2026);
              return U.note('The window a payroll run actually covers — <b>fully dynamic</b>, not the calendar month. Start Day, End Day and Salary Credit Day below are editable fields; every date shown on this tab is computed live from them, so changing the cycle here changes what every future run covers without touching a line of code.')
                + U.section('Current Cycle', [
                  { l: 'Cycle Type', v: c.mode, ro: 1, lock: 'Configured' },
                  { l: 'Start Day', v: String(c.startDay), ro: 1, lock: 'Configured', hint: 'Day of the previous month a pay period opens' },
                  { l: 'End Day', v: String(c.endDay), ro: 1, lock: 'Configured', hint: 'Day of the current month a pay period closes — the cutoff' },
                  { l: 'Salary Credit Day', v: String(c.creditDay), ro: 1, lock: 'Configured', hint: 'Day of the month the bank transfer actually reaches employees’ accounts — clamped to the real last day of a shorter month (e.g. February)' },
                  { l: 'In Plain Words', v: c.note, ro: 1, lock: 'Derived', span: 3 }
                ], '')
                + `<div class="form-section"><div class="form-section-head"><h4>Resolved Periods</h4>
                   <span class="note">Computed from Start Day / End Day / Salary Credit Day above — not typed in anywhere</span></div>
                   ${mini([
                  { k: 'label', t: 'Pay Period', c: 'cell-strong' },
                  { k: 'from', t: 'Covers From', c: 'mono' },
                  { k: 'to', t: 'Covers To (cutoff)', c: 'mono cell-accent' },
                  { k: 'credit', t: 'Salary Credited', c: 'mono cell-strong' }
                ], [
                  { label: 'July 2026', from: jul.from, to: jul.to, credit: D.payCreditDate('July', 2026) },
                  { label: 'August 2026', from: aug.from, to: aug.to, credit: D.payCreditDate('August', 2026) },
                  { label: 'September 2026', from: sep.from, to: sep.to, credit: D.payCreditDate('September', 2026) }
                ])}</div>`
                + `<div class="form-section"><div class="form-section-head"><h4>Cutoff Reconciliation — worked example</h4>
                   <span class="note">What happens when an event lands after the End Day</span></div>
                   ${mini([
                  { k: 'emp', t: 'Employee', c: 'cell-strong' },
                  { k: 'event', t: 'Event' },
                  { k: 'date', t: 'Date', c: 'mono' },
                  { k: 'closedPeriod', t: 'Misses' },
                  { k: 'deferredTo', t: 'Picked Up By', c: 'cell-strong' }
                ], D.payrollCarryover)}
                   <div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary);line-height:1.5">${D.payrollCarryover[0].reason} Nothing is lost — the leave is still Approved and still paid, it simply prints on next month's payslip instead of this one, because this one's window already closed on the ${c.endDay}${c.endDay === 25 ? 'th' : ''}.</div></div>`
                + `<div style="margin-top:10px"><button class="btn ${role === 'superadmin' ? 'primary' : 'disabled'}" data-go="masters.paycycle.edit">${svg('edit', 14)} Edit Pay Cycle</button></div>`;
            }
          },
          {
            k: 'used', l: 'Where Used', body: () =>
              U.note('This screen is not decorative — four modules read it on every calculation. Change the Saturday rule and 148 people\'s required hours move the same afternoon.')
              + mini([
                { k: 'mod', t: 'Module', c: 'cell-strong' },
                { k: 'screen', t: 'Screen' },
                { k: 'reads', t: 'What it reads' },
                { k: 'effect', t: 'Effect of a change' }
              ], [
                { mod: 'Payroll', screen: 'Attendance & Time Basis', reads: 'Net hours/day, working days, Saturday rule', effect: 'Required hours per employee per month' },
                { mod: 'Payroll', screen: 'Run Payroll', reads: 'Shortfall treatment, payable days', effect: 'Loss of Pay lines on the payslip' },
                { mod: 'Leave', screen: 'Apply for Leave', reads: 'Weekly off days, Saturday rule, holidays', effect: 'Which days count against a leave balance' },
                { mod: 'Leave', screen: 'Compensatory Hours', reads: 'Window, monthly cap, permitted make-up days', effect: 'Whether a chosen make-up date is accepted' },
                { mod: 'Employee', screen: 'Record Attendance', reads: 'Net hours, grace, half-day threshold', effect: 'The Day Status a recorded day resolves to' },
                { mod: 'Dashboard', screen: 'Attendance widgets', reads: 'Working days in the period', effect: 'Present / absent percentages' },
                { mod: 'Payroll', screen: 'Run Payroll, Payslip', reads: 'Pay Cycle — Start Day, End Day', effect: 'Which calendar dates a given month\'s payslip actually covers, and which events roll to next month' },
                { mod: 'Daily Task', screen: 'My Daily Tasks, Team Daily Tasks', reads: 'Net Working Hours per Day, per employee\'s own policy', effect: 'Standard Working Hours used in the Free Time calculation — never a second, competing setting' }
              ])
          }
        ];
      },
      actions: (role) => role === 'superadmin'
        ? [{ l: 'Save', cls: 'primary', icon: 'check', toast: 'Work week policy saved — future payroll periods use the new figures.' }, { l: 'Add Policy', icon: 'plus', go: 'masters.workweek.add' }, { l: 'Export PDF', icon: 'download' }]
        : [{ l: 'Export PDF', icon: 'download' }]
    },

    taxes: {
      head: () => ({ av: svg('masters', 20), id: 'Masters §3.2', name: 'Taxes', meta: [D.masters.taxHeads.filter(h => h.force === 'In Force').length + ' active taxes', '2 tax schemes'], badge: 'Active' }),
      tabs: (role) => {
        const canManage = role === 'superadmin' || role === 'accountant';
        const billingHeads = D.masters.taxHeads.filter(h => /Sales/.test(h.scope) && h.force === 'In Force');
        const purchaseHeads = D.masters.taxHeads.filter(h => /Purchase/.test(h.scope) && h.force === 'In Force');
        const payrollHeads = D.masters.taxHeads.filter(h => /Payroll|Declaration/.test(h.scope) && h.force === 'In Force');
        function taxTable(rows) {
          return mini([
            { k: 'name', t: 'Tax Name', c: 'cell-strong' },
            { k: 'type', t: 'Type', type: 'chip' },
            { k: 'rate', t: 'Rate', c: 'mono' },
            { k: 'from', t: 'Applies From', c: 'mono' },
            { k: 'force', t: 'Status', type: 'status' }
          ], rows);
        }
        return [
          {
            k: 'billing', l: 'Billing Taxes', n: billingHeads.length, body: () =>
              U.note('These taxes appear in the <b>Invoice</b> dropdown. Pick GST — IGST for interstate sales; GST — CGST+SGST for intrastate sales.')
              + taxTable(D.masters.taxHeads.filter(h => /Sales/.test(h.scope)))
              + `<div style="margin-top:10px;display:flex;gap:7px">
                 <button class="btn ${canManage ? 'primary' : 'disabled'}" data-go="masters.taxes.add">${svg('plus', 14)} Add Billing Tax</button>
                 ${role === 'superadmin' ? '<button class="btn">Deactivate</button>' : ''}</div>`
          },
          {
            k: 'purchase', l: 'Purchase Taxes', n: purchaseHeads.length, body: () =>
              U.note('These taxes appear in <b>Purchase Bill</b> tax field. Typically Input GST.')
              + taxTable(D.masters.taxHeads.filter(h => /Purchase/.test(h.scope)))
              + `<div style="margin-top:10px;display:flex;gap:7px">
                 <button class="btn ${canManage ? 'primary' : 'disabled'}" data-go="masters.taxes.add">${svg('plus', 14)} Add Purchase Tax</button>
                 ${role === 'superadmin' ? '<button class="btn">Deactivate</button>' : ''}</div>`
          },
          {
            k: 'payroll', l: 'Payroll Taxes', n: payrollHeads.length, body: () =>
              U.note('These apply to salary runs — PF, Professional Tax, TDS, and employee declarations. ' + (canManage ? '' : '<b>Accountant can manage payroll taxes directly.</b>'))
              + taxTable(D.masters.taxHeads.filter(h => /Payroll|Declaration/.test(h.scope)))
              + `<div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">
                 <button class="btn ${canManage ? 'primary' : 'disabled'}" data-go="masters.taxes.add">${svg('plus', 14)} Add Payroll Tax</button>
                 ${role === 'superadmin' ? '<button class="btn">Deactivate</button>' : ''}
                 <button class="btn" data-go="masters.taxes.slab">${svg('masters', 14)} Slab Bands</button>
                 <button class="btn" data-go="masters.taxes.split">${svg('masters', 14)} Split Components</button>
                 <button class="btn" data-go="masters.taxes.relief">${svg('masters', 14)} Relief Rules</button></div>`
          },
          {
            k: 'schemes', l: 'Tax Schemes', n: D.masters.taxSchemes.length, body: () =>
              mini([{ k: 'name', t: 'Scheme', c: 'cell-strong' }, { k: 'def', t: 'Is Default', type: 'status' }, { k: 'desc', t: 'Description' }, { k: 'window', t: 'Choice Window' }, { k: 'heads', t: 'Declaration Heads', c: 'r num', th: 'r' }], D.masters.taxSchemes)
              + `<div style="margin-top:10px"><button class="btn ${canManage ? 'primary' : 'disabled'}" data-go="masters.taxes.scheme">${svg('plus', 14)} Add Tax Scheme</button></div>`
          },
          {
            k: 'used', l: 'Where Used', body: () =>
              mini([{ k: 'head', t: 'Tax', c: 'cell-strong' }, { k: 'where', t: 'Used In' }, { k: 'count', t: 'Records', c: 'r num', th: 'r' }, { k: 'lock', t: 'Locked', type: 'status' }],
                [{ head: 'GST 18% — CGST + SGST', where: 'Invoice', count: 61, lock: 'Yes' },
                 { head: 'GST 18% — IGST',         where: 'Invoice', count: 23, lock: 'Yes' },
                 { head: 'Input GST 18% — IGST',   where: 'Purchase Bill', count: 31, lock: 'Yes' },
                 { head: 'PF — Employee (12%)',     where: 'Payroll runs, Salary Structure', count: 39, lock: 'Yes' },
                 { head: 'Income Tax (TDS)',         where: 'Payroll runs', count: 39, lock: 'Yes' }])
              + U.note('A tax <b>locks once used</b> in a calculation — edit it by creating a new version with a later Applies From date.')
          }
        ];
      },
      actions: (role) => (role === 'superadmin' || role === 'accountant')
        ? [{ l: 'Add Tax', cls: 'primary', icon: 'plus', go: 'masters.taxes.add' }, { l: 'Export', icon: 'download' }]
        : [{ l: 'Export', icon: 'download' }]
    },

    company: {
      head: () => ({ av: 'M', id: 'Masters §3.6', name: 'Meshrd Technologies Pvt Ltd', meta: ['CIN U72900TN2019PTC128841', 'GSTIN 33AAACM1234K1Z9', 'Chennai'], badge: 'Active' }),
      tabs: (role) => {
        const ro = role !== 'superadmin';
        return [
          {
            /* §3.6a — all 19 spec rows. Mandatory rows carry req:1; Registered Address
               is derived from whichever Addresses row is Primary, so it is read-only here. */
            k: 'general', l: 'General Info', body: () => (ro ? U.note('<b>Manager is view-only</b> on Company Profile.', 'warn') : '') + U.section('Company', [
              { l: 'Company Legal Name', req: 1, span: 2, v: 'Meshrd Technologies Pvt Ltd', ro: ro }, { l: 'Display Name', v: 'Meshrd', ro: ro },
              { l: 'CIN', req: 1, v: 'U72900TN2019PTC128841', ro: ro, hint: 'Corporate Identification Number' },
              { l: 'GSTIN', v: '33AAACM1234K1Z9', ro: ro, hint: 'Exactly 15 characters, auto-uppercased' },
              { l: 'PAN', req: 1, v: 'AAACM1234K', ro: ro, hint: 'Exactly 10 characters' },
              { l: 'TAN', v: 'CHEM12345B', ro: ro, hint: 'Tax Deduction Account Number. Not mandatory — a company not registered for a given levy must still be able to save its own profile' },
              { l: 'Company Type', type: 'select', req: 1, opts: ['Private Limited', 'One Person Company (OPC)', 'LLP', 'Partnership', 'Proprietorship'], ro: ro },
              { l: 'Year of Incorporation', req: 1, v: '2019', ro: ro, hint: '4-digit year' },
              { l: 'Industry / Business Type', v: 'IT & IoT Services', ro: ro, hint: 'Free text' },
              { l: 'MSME Registration Number', v: 'UDYAM-TN-02-0034567', ro: ro },
              { l: 'Official Email', req: 1, v: 'accounts@meshrd.in', ro: ro, hint: 'Standard email format' },
              { l: 'Support Email', v: 'support@meshrd.in', ro: ro, hint: 'Standard email format' },
              { l: 'Phone Number', req: 1, v: '044 4210 8800', ro: ro }, { l: 'Alternate Phone', v: '044 4210 8801', ro: ro },
              { l: 'Website', v: 'https://meshrd.in', ro: ro, hint: 'Must start with http:// or https://' },
              { l: 'Logo', type: 'file', v: 'meshrd-logo.svg' },
              { l: 'Letterhead Template', type: 'file', v: 'meshrd-letterhead.pdf', hint: 'Used when generating offer letters, appointment letters and other official documents' },
              { l: 'Registered Address (Primary)', span: 2, v: 'No. 14, Habibullah Road, T. Nagar, Chennai 600017', ro: 1, lock: 'From Addresses', hint: 'Shows whichever address is marked Primary on the Addresses tab; not edited from here' },
              {
                l: 'Default Billing Tax', type: 'select', ro: ro,
                opts: ['GST 18% — CGST + SGST (18%)'].concat(D.masters.taxHeads.filter(h => /Sales/.test(h.scope) && h.force === 'In Force').map(h => h.name + ' (' + h.rate + ')').filter(n => n !== 'GST 18% — CGST + SGST (18%)')).concat(['— None —']),
                hint: 'Every in-force Sales/Billing tax head from Masters → Taxes — a real, editable rate, never a fixed label. Super Admin selects it manually here, same as any other field on this profile; it is only ever the starting suggestion pre-filled on a new Invoice or Quote, never a lock — changed per document any time. Optional: a company with none configured must still be able to save this profile, hence "— None —".'
              },
              { l: 'Payroll Basis', v: 'Hour-Basis', ro: 1, lock: 'Live', hint: 'Read by Run Payroll — required hours come from Masters → Work Week & Hours, worked hours from Attendance & Time Basis (§2.4). No longer a choice; hour-basis is the only calculation this CMS runs.' }
            ])
          },
          {
            k: 'addresses', l: 'Addresses', n: D.masters.addresses.length, body: () =>
              mini([{ k: 'label', t: 'Label', c: 'cell-strong' }, { k: 'line', t: 'Address' }, { k: 'city', t: 'City' }, { k: 'state', t: 'State' }, { k: 'pin', t: 'PIN', c: 'mono' }, { k: 'primary', t: 'Primary', type: 'status' }], D.masters.addresses)
              + `<div style="margin-top:10px"><button class="btn ${ro ? 'disabled' : 'primary'}" data-go="masters.company.address">${svg('plus', 14)} Add Another Address</button></div>`
              + `<div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary)">Asset Management sources its Location / Branch dropdown from these addresses, rather than creating a separate master for two offices.</div>`
          },
          {
            k: 'bank', l: 'Bank Details', n: D.masters.bank.length, body: () =>
              mini([{ k: 'name', t: 'Account Label', c: 'cell-strong' }, { k: 'bank', t: 'Bank' }, { k: 'acc', t: 'Account Number', c: 'mono' }, { k: 'ifsc', t: 'IFSC', c: 'mono' }, { k: 'branch', t: 'Branch' }, { k: 'status', t: 'Status', type: 'status' }], D.masters.bank)
              + (!ro ? `<div style="margin-top:10px;display:flex;gap:7px"><button class="btn primary" data-go="masters.bank.add">${svg('plus', 14)} Add Bank Account</button><button class="btn">Deactivate</button></div>` : '')
          },
          {
            /* §3.6d — four labeled upload sections, not one flat table.
               Financial and ROC documents are additionally tagged by Financial Year. */
            k: 'docs', l: 'Documents', body: () => U.section('Document Uploads', [
              { l: 'General Documents', type: 'file', span: 2, v: 'coi-meshrd.pdf, gst-cert.pdf', hint: 'Multiple. Each entry stores the file, a user-given label, uploaded-by user and uploaded-on date' },
              { l: 'Financial Documents', type: 'file', span: 2, v: 'audited-statement-FY2025-26.pdf', hint: 'Multiple, tagged by Financial Year — grouped and filterable by year' },
              { l: 'ROC Documents', type: 'file', span: 2, v: 'roc-annual-return-2025.pdf', hint: 'Multiple, tagged by Financial Year. Registrar of Companies filings and related paperwork' },
              { l: 'Invoice Template', type: 'file', v: 'invoice-letterhead.pdf', hint: 'Single. The layout file the Invoice module uses to generate invoice PDFs' }
            ])
              + mini([{ k: 'f', t: 'Document', c: 'cell-strong' }, { k: 'file', t: 'File', c: 'mono' }, { k: 'fy', t: 'Financial Year' }, { k: 'on', t: 'Uploaded On', c: 'mono' }],
                [{ f: 'Certificate of Incorporation', file: 'coi-meshrd.pdf', fy: '—', on: '02-04-2019' }, { f: 'GST Registration', file: 'gst-cert.pdf', fy: '—', on: '18-04-2019' },
                { f: 'Audited Statements', file: 'audited-statement-FY2025-26.pdf', fy: 'FY 2025–26', on: '30-06-2026' },
                { f: 'ROC Annual Return', file: 'roc-annual-return-2025.pdf', fy: 'FY 2025–26', on: '12-07-2026' },
                { f: 'Invoice Template', file: 'invoice-letterhead.pdf', fy: '—', on: '01-04-2026' }])
              + `<div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary)">Every generated PDF in this CMS — invoices, payslips, salary certificates, credit notes, and filtered list exports — uses this letterhead.</div>`
          },
          {
            k: 'prefix', l: 'Number Prefixes', n: D.masters.numberPrefixes.length, body: () =>
              mini([{ k: 'doc', t: 'Document', c: 'cell-strong' }, { k: 'prefix', t: 'Prefix', c: 'mono' }, { k: 'fmt', t: 'Format', c: 'mono' }, { k: 'digits', t: 'Digits', c: 'r num', th: 'r' }, { k: 'next', t: 'Next Number', c: 'r num', th: 'r' }], D.masters.numberPrefixes)
              + `<div style="margin-top:10px"><button class="btn ${ro ? 'disabled' : 'primary'}" data-go="masters.company.prefix">${svg('edit', 14)} Edit a Prefix</button></div>`
              + U.note('Every running code in the CMS stamps its financial year from here — Employee ID, Customer Code, Invoice, Credit Note, Purchase Bill, Ticket, Asset Tag, Project and Opportunity.')
          }
        ];
      },
      actions: (role) => role === 'superadmin' ? [{ l: 'Save', cls: 'primary', icon: 'check' }, { l: 'Export PDF', icon: 'download' }] : [{ l: 'Export PDF', icon: 'download' }]
    },

    /* Masters §3.21 — Email Configuration. Server settings are one record, the same
       "hardcoded default, editable in place" pattern as Company Profile — a company
       has exactly one outbound mail server, not a list of them. Templates ARE a
       real list (D.masters.emailTemplates), because which triggers exist and
       whether each is on is precisely the kind of thing that needs to change
       without a code change. */
    emailconfig: {
      head: () => {
        const c = D.masters.emailConfig;
        return {
          av: svg('mail', 20), id: 'Masters §3.21', name: c.fromName + ' <' + c.fromEmail + '>',
          meta: [c.provider, c.host + ':' + c.port, c.encryption], badge: c.status,
          summary: [{ l: 'Templates', v: D.masters.emailTemplates.length }, { l: 'Enabled', v: D.masters.emailTemplates.filter(t => t.enabled === 'Yes').length }, { l: 'Last Test', v: c.lastTest.split(' · ')[1] }]
        };
      },
      tabs: () => {
        const c = D.masters.emailConfig;
        return [
          {
            k: 'server', l: 'Server Settings', body: () => U.section('Outbound Mail Server', [
              { l: 'Sending Enabled', type: 'toggle', v: c.status === 'Active' ? 1 : 0, on: 'Active', hint: 'Turning this off stops every email this CMS sends — welcome emails, payslips, approvals, resets — without touching a single template. The in-app notification bell keeps working either way; only the email copy stops.' },
              { l: 'Provider', type: 'select', opts: ['Custom SMTP', 'SendGrid', 'Amazon SES', 'Mailgun', 'Postmark'], v: c.provider, hint: 'Custom SMTP shows the four server fields below; a named provider replaces them with a single API Key field instead' },
              { l: 'SMTP Host', v: c.host, hint: 'e.g. smtp.meshrd.in — ignored when Provider is not Custom SMTP' },
              { l: 'SMTP Port', v: c.port, hint: 'Common values: 587 (STARTTLS), 465 (SSL), 25 (unencrypted, not recommended)' },
              { l: 'Encryption', type: 'select', opts: ['STARTTLS', 'SSL/TLS', 'None'], v: c.encryption },
              { l: 'Username', v: c.username },
              { l: 'Password', type: 'password', v: '••••••••••••', hint: 'Never shown in full once saved, same as any stored credential in this CMS' },
              { l: 'From Name', req: 1, v: c.fromName, hint: 'What recipients see as the sender name' },
              { l: 'From Email Address', req: 1, v: c.fromEmail, hint: 'Must be a domain this mail server is authorised to send as, or messages land in spam' },
              { l: 'Reply-To Email', v: c.replyTo, hint: 'Optional. Where a recipient\'s reply actually goes — often a shared support inbox rather than the no-reply sending address' }
            ], 'Nothing here is wired into code. Changing providers, rotating credentials, or redirecting replies to a different inbox is a Masters edit, not a deployment.')
              + `<div style="margin-top:12px;display:flex;align-items:center;gap:10px">
                <button class="btn" data-go="masters.email.test">${svg('send', 14)} Send Test Email</button>
                <span style="font-size:11.5px;color:var(--text-tertiary)">Last test: ${esc(c.lastTest)}</span></div>`
          },
          {
            k: 'templates', l: 'Email Templates', n: D.masters.emailTemplates.length, body: () =>
              U.note('Every automatic email this CMS sends is one row here. Switching Enabled to No silences just that trigger — the in-app notification still fires, only its email copy stops. Subject Line supports placeholders like <span class="mono">{{first_name}}</span> and <span class="mono">{{month}}</span>, filled in per recipient when the email actually sends.')
              + mini([
                { k: 'name', t: 'Template Name', c: 'cell-strong' }, { k: 'category', t: 'Triggered From', type: 'chip' },
                { k: 'subject', t: 'Subject Line', c: 'mono' }, { k: 'enabled', t: 'Enabled', type: 'status' }
              ], D.masters.emailTemplates, 'masters.email.template')
          },
          {
            k: 'log', l: 'Recent Sends', n: 5, body: () => U.note('Read-only, for troubleshooting a specific delivery — spend and volume reporting belongs elsewhere, this is just "did that one email actually go out."', 'warn')
              + mini([{ k: 'to', t: 'To' }, { k: 'template', t: 'Template', c: 'cell-strong' }, { k: 'on', t: 'Sent On', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }], [
                { to: 'arun.menon@meshrd.in', template: 'Payslip Available', on: '01-07-2026 09:00', status: 'Delivered' },
                { to: 'sneha.pillai@meshrd.in', template: 'Leave Approved', on: '28-07-2026 16:12', status: 'Delivered' },
                { to: 'ravi.shankar@meshrd.in', template: 'Ticket Assigned', on: '23-07-2026 10:19', status: 'Delivered' },
                { to: 'newvendorcontact@example.com', template: 'Welcome Email', on: '20-07-2026 11:41', status: 'Bounced' },
                { to: 'test@meshrd.in', template: '— Test Email —', on: c.lastTest.split(' · ')[0], status: c.lastTest.split(' · ')[1] }
              ])
          }
        ];
      },
      actions: () => [{ l: 'Save', cls: 'primary', icon: 'check' }]
    }
  };

  R.record = function (s, role) {
    const def = RECORDS[s.record];
    if (!def) return U.pageHead(s) + U.card('Record', '', U.empty('This record shape is not defined in the prototype.'));
    const h = def.head(role), tabs = def.tabs(role), active = S.tab[s.id] && tabs.some(t => t.k === S.tab[s.id]) ? S.tab[s.id] : tabs[0].k;
    const cur = tabs.find(t => t.k === active);
    const acts = (def.actions ? def.actions(role) : []).map(a => `<button class="btn ${a.cls || ''}" ${a.go ? `data-go="${a.go}"` : `data-toast="${esc(a.toast || a.l + ' — recorded.')}"`}>${a.icon ? svg(a.icon, 14) : ''} ${esc(a.l)}</button>`).join('');
    const head = U.pageHead(s);
    const rec = `<div class="rec-head rise">
      <div class="rec-avatar">${h.av && h.av.length <= 3 ? esc(h.av) : h.av}</div>
      <div style="min-width:0"><div class="rec-id">${esc(h.id)}</div><div class="rec-name">${esc(h.name)}</div>
        <div class="rec-meta">${h.meta.map((m, i) => (i ? '<span class="dot"></span>' : '') + '<span>' + esc(m) + '</span>').join('')}
        <span class="dot"></span>${U.badge(h.badge)}</div></div>
      ${h.summary ? `<div class="rec-summary">${h.summary.map(x => `<div class="s"><div class="l">${esc(x.l)}</div><div class="v num">${esc(x.v)}</div></div>`).join('')}</div>` : ''}
      <div class="rec-actions">${acts}</div></div>`;
    return head + rec + U.tabs(s.id, tabs, active) + `<div class="card rise"><div class="card-body">${cur.body(role)}</div></div>`;
  };

  /* ============================== PIPELINE ============================== */
  R.pipeline = function (s, role) {
    const view = S.view[s.id] || 'stages';
    const stages = ['Prospecting', 'Qualifying', 'Proposal', 'Won', 'Lost'];
    const head = U.pageHead(s, [{ label: '+ Add Opportunity', cls: 'primary', icon: 'plus', go: 'opp.edit' }, { label: 'Export PDF', icon: 'download', toast: 'Export from either view — the filtered set, with a header block stating the filters applied.' }]);
    const fb = U.filterbar({ id: s.id, filters: [['All Customers'].concat(C.CUSTOMERS), ['All Stages'].concat(stages), ['All Owners', 'Meera Joshi', 'Divya Raman'], C.FIN_PRESETS], filterNames: ['Customer', 'Stage', 'Owner', 'Period'], scope: s.scope }, role, D.opportunities.length, D.opportunities.length);
    const sw = `<div class="seg" style="margin-bottom:12px"><button class="${view === 'stages' ? 'on' : ''}" data-view="${s.id}:stages">${svg('kanban', 13)} Stage summary</button><button class="${view === 'table' ? 'on' : ''}" data-view="${s.id}:table">${svg('list', 13)} Table</button></div>`;
    const body = view === 'stages'
      ? `<div class="pipe">${stages.map(st => {
        const list = D.opportunities.filter(o => o.stage === st);
        const tot = list.reduce((a, o) => a + o.val, 0);
        return `<div class="bcol"><div class="pcol-head"><div class="nm">${esc(st)}</div><div class="vv num">${inrAbbr(tot)}</div><div class="cc">${list.length} deal${list.length === 1 ? '' : 's'}</div></div>
            <div class="bcol-body">${list.length ? list.map(o => `<div class="ocard" data-go="opp.360">
              <div class="ot">${esc(o.title)}</div><div class="oc">${esc(o.cust)} · ${o.prob}%</div><div class="ov">${inr(o.val)}</div></div>`).join('')
            : `<div style="padding:14px 6px;text-align:center;font-size:11.5px;color:var(--text-tertiary)">No deals at this stage.</div>`}</div></div>`;
      }).join('')}</div>`
      : U.card('Opportunity Pipeline', D.opportunities.length + ' deals', mini(
        [{ k: 'code', t: 'Code', c: 'mono cell-accent' }, { k: 'title', t: 'Title', c: 'cell-strong' }, { k: 'cust', t: 'Customer' }, { k: 'val', t: 'Value', type: 'money', c: 'r', th: 'r' }, { k: 'stage', t: 'Stage', type: 'status' }, { k: 'prob', t: 'Probability', c: 'r num', th: 'r' }, { k: 'close', t: 'Expected Close', c: 'mono' }, { k: 'owner', t: 'Owner' }],
        D.opportunities, 'opp.360'));
    return head + U.note('<b>Filters apply to both views.</b> Switching between Table and Stage summary keeps the filter set applied, so the stage counts and ₹ totals always reflect the same set the table would show.') + fb + sw + body;
  };

  /* ============================== DOCUMENT (invoice / bill) ============================== */
  R.document = function (s, role) {
    const isInv = s.doc === 'invoice';
    const lines = isInv ? D.invoiceLines : [{ desc: 'Annual software subscription — 12 seats', hsn: '998314', qty: 12, rate: 12000 }, { desc: 'Priority support add-on', hsn: '998313', qty: 1, rate: 12000 }];
    const sub = lines.reduce((a, l) => a + l.qty * l.rate, 0);
    const tax = Math.round(sub * 0.18);
    /* Withholding applies to bills only, and is DEDUCTED from what the vendor is
       paid rather than added to the bill. Read from the demo bill this screen
       stands in for (PB-2026-0031) so the figures here, the list column and the
       Record Payment ceiling all quote the same number. */
    const theBill = isInv ? null : (D.bills.find(b => b.id === 'PB-2026-0031') || {});
    const wh = isInv ? 0 : (theBill.wh || 0);
    const whName = isInv ? '' : (theBill.whtax || '');
    const locked = isInv;
    const head = U.pageHead(s, isInv
      ? [{ label: 'Save', cls: 'primary', icon: 'check' }, { label: 'Send', icon: 'send', toast: 'Invoice sent. Status moves Draft → Sent.' }, { label: 'Download', icon: 'download', toast: 'Invoice PDF generated using the template set in Company Profile.' }, { label: 'Record Payment', go: 'inv.payment' }, { label: 'Raise Credit Note', go: 'inv.creditnote' }]
      : [{ label: 'Save', cls: 'primary', icon: 'check' }, { label: 'Record Payment', go: 'pb.payment' }, { label: 'Open Attachment', icon: 'doc', toast: 'Opening the vendor\'s bill scan — the audit source document.' }]);
    const rec = `<div class="rec-head rise"><div class="rec-avatar">${svg(isInv ? 'invoice' : 'purchase', 20)}</div>
      <div><div class="rec-id">${isInv ? 'INV-2627-0138' : 'PB-2026-0031'}</div>
      <div class="rec-name">${isInv ? 'Aarohi Retail Solutions' : 'Chola Technologies'}</div>
      <div class="rec-meta">${isInv ? '<span>Due 11-07-2026</span>' : '<span>Vendor Bill No. CT/26-27/0912</span>'}<span class="dot"></span>${U.badge(isInv ? 'Part-Paid' : 'Unpaid')}<span class="dot"></span><span>FY 2026–27</span></div></div>
      <div class="rec-summary">
        <div class="s"><div class="l">Total</div><div class="v num">${inr(sub + tax)}</div></div>
        <div class="s"><div class="l">Paid</div><div class="v num">${inr(isInv ? 200000 : 0)}</div></div>
        <div class="s"><div class="l">Balance</div><div class="v num">${inr(sub + tax - (isInv ? 200000 : 0))}</div></div>
      </div></div>`;
    const fields = isInv ? [
      { l: 'Customer', type: 'select', req: 1, opts: C.CUSTOMERS },
      { l: 'Opportunity', type: 'select', opts: ['—'].concat(D.opportunities.map(o => o.title)), hint: 'Optional link, filtered to the selected customer' },
      { l: 'Due Date', v: '11-07-2026', hint: 'Without one, this invoice can never appear in the Overdue filter' },
      /* Optional, not mandatory, and still editable after the invoice is raised —
         the account can legitimately be decided later. Payment Mode used to sit
         here as a "suggested method"; it was removed because it was a guess that
         nothing read. The real mode is captured once, on Record Payment, where the
         money actually arrives. */
      { l: 'Bank Account', type: 'select', opts: ['— Decide later —'].concat(D.masters.bank.filter(b => b.status === 'Active').map(b => b.name)), hint: 'Optional. Which Meshrd account the customer should pay into — printed on the invoice and carried through as the default on Record Payment, where it stays editable. Leave it as "Decide later" and the invoice simply prints no account.' },
      { l: 'Tax', type: 'select', opts: ['— None —'].concat(D.masters.taxHeads.filter(h => /Sales/.test(h.scope) && h.force === 'In Force').map(h => h.name + ' (' + h.rate + ')')).concat(['— Custom —']), hint: 'Pick a configured tax from Masters → Taxes, or choose "— Custom —" at the bottom to enter your own rate below.' },
      { l: 'Custom Tax Label', ph: 'e.g. Service Tax, Cess, Surcharge', hint: 'Shown on the invoice when Custom is selected above — what this tax is called' },
      { l: 'Custom Tax Rate (%)', ph: '0.00', hint: 'Enter the percentage to apply on the subtotal when Custom is selected above. Leave blank if using a configured tax.' },
      { l: 'Financial Year', v: 'FY 2026–27', ro: 1 },
      { l: 'Customer Address', type: 'textarea', span: 2, ro: 1, v: '14, Baner Road, Pune 411045' },
      { l: 'Notes', type: 'textarea', span: 1 }
    ] : [
      { l: 'Vendor', type: 'select', req: 1, opts: C.VENDORS, hint: 'Or "+ Add New Vendor" inline, without leaving this form' },
      { l: 'Vendor Bill Number', req: 1, v: 'CT/26-27/0912', hint: "The vendor's own number, printed on their document" },
      { l: 'Internal Bill ID', v: 'PB-2026-0031', ro: 1, hint: "Meshrd's own reference, never seen by the vendor" },
      { l: 'Bill Date', req: 1, v: '24-07-2026', hint: 'Cannot be in the future' },
      { l: 'Due Date', v: '08-08-2026', hint: 'Must be after Bill Date' },
      { l: 'Bank Account', type: 'select', opts: ['— Decide later —'].concat(D.masters.bank.filter(b => b.status === 'Active').map(b => b.name)), hint: 'Optional. Which Meshrd account this bill is expected to be paid from; carried through as the default on Record Payment, where it stays editable.' },
      /* The other half of the Expense ↔ Purchase Bill mapping. Same spend can reach
         the system twice — once as a staff claim, once as the supplier's own bill.
         Linking them is what stops it being paid twice. */
      { l: 'Linked Expense Claim', type: 'select', opts: ['— None —'].concat(D.allExpenses.map(e => e.emp + ' · ' + e.type + ' · ₹' + e.amt.toLocaleString('en-IN') + ' · ' + e.date)), hint: 'Optional. Link the staff expense claim that covers this same spend — someone paid the Wi-Fi bill on a personal card and the provider also invoiced Meshrd for it. Linked, the two settle as one amount and the claim shows this bill back on its own row; unlinked, the company pays both.' },
      /* Withholding — DEDUCTED from what the vendor is paid, never added to the bill.
         The opposite direction from Tax Amount above, which is exactly why the hints
         say so. Hidden entirely when no withholding-scope head is configured. */
      /* Payments-side heads only: a "Receipts Collected" head governs what CUSTOMERS
         withhold from us and must never be selectable on a bill we are paying. */
      { l: 'Withholding Tax', type: 'select', opts: ['— None —'].concat(D.masters.taxHeads.filter(t => /Withholding — On Payments/.test(t.scope) && t.force === 'In Force').map(t => t.name + ' (' + t.rate + ')')), hint: 'Optional. A tax held back from what this supplier is paid and remitted to the authority instead — the opposite of Tax Amount above, which increases what they are owed. From Masters → Taxes, scope "Withholding — On Payments Made" or "On Payments & Receipts". The whole group disappears if no such head is configured.' },
      { l: 'Withholding Calculated On', type: 'select', opts: ['Subtotal (before tax)', 'Total (including tax)'], hint: 'Required once a withholding tax is selected. Defaults to Subtotal — withholding is commonly calculated on the taxable value before purchase tax, and the two bases produce materially different figures, so it is asked rather than assumed.' },
      { l: 'Withholding Amount (₹)', v: '15,600', hint: 'Auto-filled from the selected head against the chosen base — here 10% of the ₹1,56,000 subtotal, not of the total — and still directly editable for the same reason Tax Amount is. Cannot exceed Total.' },
      { l: 'Amount Payable to Vendor', v: '₹1,68,480', ro: 1, lock: 'Total − Withholding', hint: 'What actually leaves the bank, and the ceiling for every payment recorded against this bill. The bill still reaches Paid once payments plus withholding equal the Total — the vendor is owed nothing further.' },
      { l: 'Tax', type: 'select', opts: ['— None —'].concat(D.masters.taxHeads.filter(t => /Purchase/.test(t.scope) && t.force === 'In Force').map(t => t.name + ' (' + t.rate + ')')), hint: 'From Masters → Taxes — Purchase Taxes tab. Picking one auto-fills Tax Amount.' },
      { l: 'Tax Amount (₹)', v: '43,200', hint: 'Auto-filled from the selected Tax Head and still directly editable — the vendor\'s own figure may not land exactly on a configured head (rounding, for instance).' },
      { l: 'Attachment', type: 'file', span: 2, v: 'chola-bill-0912.pdf' },
      { l: 'Notes', type: 'textarea' }
    ];
    const lineTable = `<div class="table-wrap"><table class="lineitems">
      <thead><tr><th style="width:34%">Description</th><th>HSN / SAC</th><th>Unit</th><th class="r">Quantity</th><th>Rate (₹)</th><th>Line Total</th><th></th></tr></thead>
      <tbody>${lines.map(l => `<tr>
        <td><input class="input" value="${esc(l.desc)}"${locked ? ' disabled' : ''}></td>
        <td><select class="input"${locked ? ' disabled' : ''}>${D.masters.hsn.map(h => `<option${h.code === l.hsn ? ' selected' : ''}>${h.code}</option>`).join('')}</select></td>
        <td><select class="input"${locked ? ' disabled' : ''}>${D.masters.uom.map(u => `<option${u.name === l.unit ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></td>
        <td class="r"><input class="input" style="text-align:right" value="${l.qty}"${locked ? ' disabled' : ''}></td>
        <td><input class="input" value="${l.rate.toLocaleString('en-IN')}"${locked ? ' disabled' : ''}></td>
        <td class="num cell-strong">${inr(l.qty * l.rate)}</td>
        <td><button class="btn sm ghost no" data-toast="Line item removed.">${svg('trash', 13)}</button></td></tr>`).join('')}</tbody></table></div>
      <div style="margin-top:10px"><button class="btn" data-toast="Row added.">${svg('plus', 14)} Add Line Item</button></div>
      <div style="display:flex;margin-top:14px"><div class="totals">
        <div class="tr"><span>Subtotal</span><b>${inr(sub)}</b></div>
        <div class="tr"><span>${isInv ? 'Tax — Output Tax — Services @ 18%' : 'Tax Amount — Input Tax @ 18%'}</span><b>${inr(tax)}</b></div>
        <div class="tr"><span>${isInv ? 'Grand Total' : 'Total'}</span><b>${inr(sub + tax)}</b></div>
        ${!isInv && wh ? `<div class="tr"><span>${esc(whName)} @ 10% on Subtotal</span><b>− ${inr(wh)}</b></div>
        <div class="tr"><span>Amount Payable to Vendor</span><b>${inr(sub + tax - wh)}</b></div>` : ''}</div></div>`;
    const note = isInv
      ? U.note('<b>The lock on Paid, stated exactly.</b> Once an invoice reaches Status = Paid it locks — every field becomes read-only and only View and Download remain. Corrections after that go through a <b>Credit Note</b>, which keeps the audit trail intact. This example is Part-Paid, so it is still editable.')
      : U.note('<b>No PDF-generation button here</b>, unlike Invoice — there is nobody to send a Purchase Bill to. What matters is opening the Attachment quickly: it is the audit source document.');
    return head + rec + note + `<div class="card rise"><div class="card-body">
      ${U.section(isInv ? 'Invoice Details' : 'Bill Details', fields)}
      <div class="form-section"><div class="form-section-head"><h4>Line Items</h4>
      <span class="note">HSN/SAC sits at line-item level — a single document can mix items needing different codes</span></div>${lineTable}</div>
      </div></div>`;
  };

  /* ============================== INVOICE DASHBOARD ============================== */
  R.invdash = function (s, role) {
    const f = D.finance;
    const head = U.pageHead(s, [{ label: 'Export PDF', icon: 'download', toast: 'Export to PDF.' }, { label: 'Export Excel', icon: 'download', toast: 'Export to Excel.' }, { label: '+ New Invoice', cls: 'primary', icon: 'plus', go: 'inv.edit' }]);
    const k = `<div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'rupee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Total Invoiced', value: inrAbbr(f.invoiced), foot: inr(f.invoiced), go: 'inv.list' })}
      ${U.kpi({ i: 1, icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Received', value: inrAbbr(f.received), foot: inr(f.received), go: 'inv.list' })}
      ${U.kpi({ i: 2, icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Outstanding', value: inrAbbr(f.outstanding), foot: inr(f.outstanding), go: 'inv.list' })}
      ${U.kpi({ i: 3, icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Overdue Invoices', value: f.overdue, unit: 'invoices', foot: 'Status not Paid, Due Date passed', go: 'inv.list' })}</div>
      <div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'expense', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Total Expenses', value: inrAbbr(f.expenses), foot: 'From the Expense module', go: 'exp.all' })}
      ${U.kpi({ i: 1, icon: 'project', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Active Projects', value: f.projects, unit: 'live', foot: 'Status not Completed', go: 'proj.directory' })}
      ${U.kpi({ i: 2, icon: 'ticket', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Open Tickets', value: f.tickets, unit: 'open', foot: 'Status Open or In Progress', go: 'ticket.list' })}
      ${U.kpi({ i: 3, icon: 'employee', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Active Employees', value: f.employees, unit: 'active', foot: 'Status Active', go: 'emp.directory' })}</div>`;
    const t1 = U.card('Overdue Invoices', 'Invoice Number, Customer, Amount, Due Date',
      mini([{ k: 'no', t: 'Invoice Number', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer' }, { k: 'bal', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'due', t: 'Due Date', c: 'mono' }], D.invoices.filter(i => i.over > 0), 'inv.list'),
      `<span class="link" data-go="inv.list">Open the Invoice List ${svg('arrow', 12, 2.4)}</span>`);
    const t2 = U.card('Recent Payments', 'Customer, Amount, Mode, Date',
      mini([{ k: 'cust', t: 'Customer' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'mode', t: 'Mode', type: 'chip' }, { k: 'date', t: 'Date', c: 'mono' }], D.payments, 'inv.list'),
      `<span class="link" data-go="inv.payment">Record a payment ${svg('arrow', 12, 2.4)}</span>`);
    return head + U.note('This dashboard pulls from four other modules — Expense, Project, Ticket and Employee. It is really a general company/admin home screen that the source spreadsheet happens to file under Invoice. Large figures use lakh/thousand abbreviation; individual invoice records always show the full rupee figure.')
      + U.filterbar({ id: s.id, filters: [C.FIN_PRESETS, ['All Customers'].concat(C.CUSTOMERS)], filterNames: ['Period', 'Customer'] }, role, 24, 312) + k + `<div class="grid g-2">${t1}${t2}</div>`;
  };

  /* ============================== EXPENSE SUMMARY ============================== */
  R.expsummary = function (s, role) {
    const rows = D.allExpenses;
    const head = U.pageHead(s, [{ label: 'Export PDF', icon: 'download', toast: 'Export to PDF.' }, { label: 'Export Excel', icon: 'download', toast: 'Export to Excel.' }]);
    const byType = {}; rows.forEach(r => { byType[r.type] = (byType[r.type] || 0) + r.amt; });
    const committed = rows.filter(r => r.status === 'Approved' || r.status === 'Reimbursed').reduce((a, r) => a + r.amt, 0);
    const paid = rows.filter(r => r.status === 'Reimbursed').reduce((a, r) => a + r.amt, 0);
    const k = `<div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'rupee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Committed Spend', value: inrAbbr(committed), foot: 'Approved + Reimbursed — money committed to' })}
      ${U.kpi({ i: 1, icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Actually Reimbursed', value: inrAbbr(paid), foot: 'Money that has really left the account' })}
      ${U.kpi({ i: 2, icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Awaiting Approval', value: rows.filter(r => r.status === 'Pending').length, unit: 'claims', foot: inr(rows.filter(r => r.status === 'Pending').reduce((a, r) => a + r.amt, 0)) })}
      ${U.kpi({ i: 3, icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Missing Receipts', value: rows.filter(r => r.rcpt === 'No').length, unit: 'claims', foot: 'The filter this queue most needed' })}</div>`;
    const tbl = U.card('All Expenses', 'Company-wide', mini(
      [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'type', t: 'Type' }, { k: 'vendor', t: 'Vendor' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'date', t: 'Date', c: 'mono' }, { k: 'rcpt', t: 'Receipt', type: 'status' }, { k: 'status', t: 'Status', type: 'status' }], rows),
      `<button class="btn sm ok" data-go="exp.reimburse">${svg('check', 13)} Mark as Reimbursed</button>
       <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">Reimbursed is a distinct step from Approved — it resolves what "Approved" used to leave ambiguous.</span>`);
    const maxT = Math.max.apply(null, Object.keys(byType).map(x => byType[x]));
    const summary = U.card('Spend by Expense Type', 'Simple totals, not a full analytics dashboard',
      Object.keys(byType).map(t => `<div class="meter-row" style="--tone:var(--accent)">
        <div class="meter-name">${esc(t)}</div><div class="meter"><i style="width:${(byType[t] / maxT * 100).toFixed(0)}%"></i></div>
        <div class="meter-val" style="width:88px"><b>${inr(byType[t])}</b></div></div>`).join(''));
    /* §2.3 — the summary view is "total spend by Expense Type, AND total spend by month" */
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const byMonth = {};
    rows.forEach(r => { const p = String(r.date).split('-'); const key = MON[+p[1] - 1] + ' ' + p[2]; byMonth[key] = (byMonth[key] || 0) + r.amt; });
    const maxM = Math.max.apply(null, Object.keys(byMonth).map(x => byMonth[x]));
    const summaryMonth = U.card('Spend by Month', 'Simple totals, not a full analytics dashboard',
      Object.keys(byMonth).map(m => `<div class="meter-row" style="--tone:var(--info)">
        <div class="meter-name">${esc(m)}</div><div class="meter"><i style="width:${(byMonth[m] / maxM * 100).toFixed(0)}%"></i></div>
        <div class="meter-val" style="width:88px"><b>${inr(byMonth[m])}</b></div></div>`).join(''));
    return head + U.filterbar({ id: s.id, filters: [['All Statuses', 'Pending', 'Approved', 'Reimbursed', 'Rejected'], ['All Types'].concat(Object.keys(byType)), ['All Employees'].concat(C.PEOPLE), C.FIN_PRESETS, ['Receipt — Any', 'Yes', 'No']], filterNames: ['Status', 'Type', 'Employee', 'Period', 'Has Receipt'] }, role, rows.length, rows.length)
      + k + `<div class="grid g-8-4">${tbl}<div>${summary}<div style="height:12px"></div>${summaryMonth}</div></div>`;
  };

  /* ============================== PAYROLL RUN ============================== */
  R.payrollrun = function (s, role) {
    const emp = D.payrollRegister.slice(0, 6);
    const period = D.payPeriodRange('July', 2026);
    const creditDate = D.payCreditDate('July', 2026);
    const head = U.pageHead(s, [{ label: 'Save as Draft', toast: 'Saved as Draft — the calculation is stored for review, payslips are not generated, and it can be recalculated or discarded freely.' },
    { label: 'Confirm & Generate Payslips', cls: 'primary', icon: 'check', toast: 'Run finalized. Status set to Processed for every employee included, payslips generated, and each of them notified. This step cannot be skipped.' }]);
    const setup = `<div>` + U.card('Run Setup', period.from + ' to ' + period.to, U.section('', [
      { l: 'Month', type: 'select', req: 1, opts: ['July', 'June', 'May', 'April'] },
      { l: 'Year', type: 'select', req: 1, opts: ['2026', '2025'] },
      { l: 'Pay Period Covers', v: period.from + ' to ' + period.to, ro: 1, lock: 'From Masters → Work Week & Hours → Pay Cycle', hint: 'Not the calendar month — resolved live from the Start Day / End Day set on the Pay Cycle tab. Change it there, not here.' },
      { l: 'Salary Credit Date', v: creditDate, ro: 1, lock: 'From Masters → Work Week & Hours → Pay Cycle', hint: 'When the bank transfer actually reaches employees’ accounts — editable on the Pay Cycle tab, not fixed to the last day of the period' },
      { l: 'Working Days in Month', v: '27', hint: 'Auto-calculated from the calendar minus weekends minus Mandatory holidays — shown and overridable' },
      { l: 'Employee Selection', type: 'select', req: 1, opts: ['All active employees', 'Specific employees…'], span: 2 },
      { l: 'Payroll Basis', v: 'Hour-Basis', ro: 1, lock: 'Live', hint: 'Reads Attendance & Time Basis (§2.5) — required hours from the work-week policy, worked hours from check-in/check-out. See that screen for the full reconciliation.' }
    ]), `<button class="btn primary" data-toast="Calculating — Salary Structure, paid days, unpaid leave, every applicable tax head, and any pending ad-hoc adjustments.">${svg('play', 13)} Calculate</button>
      <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">Employees already Processed for this period are excluded automatically, so nobody is double-processed.</span>`)
      + `<div style="margin-top:12px">` + U.note(`<b>Cutoff:</b> this run covers everything up to and including ${period.to}. Anything dated after that — an approved leave, a compensatory make-up day, a late attendance correction — rolls into next month's run automatically, it is never lost. ${D.payrollCarryover[0].emp}'s ${D.payrollCarryover[0].event.toLowerCase()} on ${D.payrollCarryover[0].date} is exactly this case — it prints on the ${D.payrollCarryover[0].deferredTo.split(' (')[0]} payslip, not this one. Start Day, End Day and Salary Credit Day are all editable on Masters → Work Week & Hours → Pay Cycle.`) + `</div></div>`;
    const preview = U.card('Preview', 'Nothing is finalized until you confirm', `<div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Gross Pay</th><th>Unpaid Leave</th><th>Retirement Fund</th><th>State Levy</th><th>Income Withholding</th><th>Ad-hoc</th><th>Net Pay</th></tr></thead>
      <tbody>${emp.map((e, i) => {
      const gross = e.net + 26080 + (i === 4 ? 0 : 4000);
      const adhoc = i === 4 ? 15000 : i === 2 ? -4000 : 0;
      return `<tr><td class="cell-strong">${esc(e.emp)}</td>
        <td class="num">${inr(gross)}</td><td class="num">${i === 3 ? inr(3750) : '—'}</td>
        <td class="num">${inr(Math.round(gross * 0.06))}</td><td class="num">${inr(208)}</td>
        <td class="num">${inr(Math.round(gross * 0.063))}</td>
        <td class="num" style="color:${adhoc > 0 ? 'var(--success)' : adhoc < 0 ? 'var(--danger)' : 'inherit'}">${adhoc ? (adhoc > 0 ? '+' : '−') + inr(Math.abs(adhoc)).slice(1) : '—'}</td>
        <td class="num cell-strong">${inr(e.net + adhoc)}</td></tr>`;
    }).join('')}</tbody></table></div>`,
      `<span style="font-size:11px;color:var(--text-tertiary)">The deduction columns are built from the configuration — a run with three configured heads shows three columns, a run with none shows only Unpaid Leave. <b>This module contains no knowledge of any specific deduction.</b></span>`);
    return head + U.note('A processed payslip records <b>the configuration that produced it</b>, not just the result — each statutory line stores which head it came from and what that head\'s figures were at the moment of calculation. That is what makes a payslip from two years ago still explainable after the head has been retired.')
      + `<div class="grid g-4-8">${setup}${preview}</div>`
      + U.card('Payroll History', 'Past runs', mini([{ k: 'period', t: 'Pay Period', c: 'cell-strong' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'by', t: 'Run By' }, { k: 'on', t: 'Run On', c: 'mono' }, { k: 'count', t: 'Employees', c: 'r num', th: 'r' }, { k: 'net', t: 'Total Net Pay', type: 'money', c: 'r', th: 'r' }], D.payrollRuns, 'payroll.history'),
        `<span class="link" data-go="payroll.history">Full history with filters ${svg('arrow', 12, 2.4)}</span>`);
  };

  /* ============================== PAYSLIP ============================== */
  R.payslip = function (s, role) {
    const earn = [['Basic Salary', 45000], ['Dearness Allowance', 11250], ['HRA', 22500], ['Leave Travel Allowance', 3750], ['Special Allowance', 26250], ['Other Earnings', 3750]];
    const ded = [['Retirement Fund', 6750], ['State Levy', 208], ['Income Withholding', 7122], ['Unpaid Leave (1 day)', 3750]];
    const adhoc = [['Diwali Bonus', 15000]];
    const gross = earn.reduce((a, e) => a + e[1], 0) + adhoc.reduce((a, e) => a + e[1], 0);
    const totDed = ded.reduce((a, e) => a + e[1], 0);
    const period = D.payPeriodRange('June', 2026);
    const creditDate = D.payCreditDate('June', 2026);
    return U.pageHead(s, [{ label: 'Download PDF', cls: 'primary', icon: 'download', toast: 'Payslip PDF generated using the letterhead from Company Profile.' },
    { label: 'Download Salary Certificate', icon: 'doc', toast: 'A separate formal document from a monthly payslip — generated on demand, with an optional Purpose field (e.g. visa or loan application).' },
    ...(role === 'superadmin' || role === 'accountant' || role === 'hr' ? [{ label: 'Reissue', toast: 'Reissue opens the original calculation pre-filled and editable. A Reason is required either way, and a Reissue History entry records the old figures alongside the new.' }] : [])])
      + `<div class="rec-head rise"><div class="rec-avatar">${U.initials(C.ROLES[role].who)}</div>
        <div><div class="rec-id">Payslip · June 2026</div><div class="rec-name">${esc(C.ROLES[role].who)}</div>
        <div class="rec-meta"><span>EMP-2026-0005</span><span class="dot"></span><span>Senior Engineer</span><span class="dot"></span>${U.badge('Processed')}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">Covers ${period.from} to ${period.to} · Credited to account on <b style="color:var(--text-secondary)">${creditDate}</b> — from Masters → Work Week & Hours → Pay Cycle</div></div>
        <div class="rec-summary">
          <div class="s"><div class="l">Gross</div><div class="v num">${inr(gross)}</div></div>
          <div class="s"><div class="l">Deductions</div><div class="v num">${inr(totDed)}</div></div>
          <div class="s"><div class="l">Net Pay</div><div class="v num">${inr(gross - totDed)}</div></div>
        </div></div>`
      + `<div class="grid g-2">
        ${U.card('Earnings', 'June 2026', `<div class="payslip-rows" style="padding:0">
          ${earn.map(e => `<div class="pr"><span>${esc(e[0])}</span><b>${inr(e[1])}</b></div>`).join('')}
          ${adhoc.map(e => `<div class="pr"><span>${esc(e[0])} <span class="badge-s b-accent" style="height:16px;font-size:10px">Ad-hoc</span></span><b style="color:var(--success)">+ ${inr(e[1])}</b></div>`).join('')}
          <div class="pr tot"><span>Gross Earnings</span><b>${inr(gross)}</b></div></div>`,
        `<span style="font-size:11px;color:var(--text-tertiary)">Ad-hoc lines print with their <b>actual label</b> — "Diwali Bonus", not a generic "Adjustment". The whole point is that the employee can see what each one is.</span>`)}
        ${U.card('Deductions', 'One line per applicable head', `<div class="payslip-rows" style="padding:0">
          ${ded.map(e => `<div class="pr ded"><span>${esc(e[0])}</span><b>− ${inr(e[1])}</b></div>`).join('')}
          <div class="pr tot"><span>Total Deductions</span><b>− ${inr(totDed)}</b></div>
          <div class="pr tot" style="border-top-width:2px"><span>Net Pay</span><b>${inr(gross - totDed)}</b></div></div>`,
          `<span style="font-size:11px;color:var(--text-tertiary)">Each line prints under its own <b>Print Label</b> from Masters → Taxes. Heads with <i>Show on Payslip</i> set to No are calculated but not printed.</span>`)}
      </div>`
      /* §2.4 — a reissue records Date, Reissued By, Reason, and the old figures
         alongside the new. Same accountability pattern as asset/ticket history. */
      + U.card('Reissue History', 'Recorded on the payslip itself, for audit',
        mini([{ k: 'date', t: 'Date', c: 'mono' }, { k: 'by', t: 'Reissued By', c: 'cell-strong' }, { k: 'reason', t: 'Reason' },
        { k: 'oldv', t: 'Old Figures', c: 'num' }, { k: 'newv', t: 'New Figures', c: 'num' }],
          [{ date: '04-05-2026', by: 'Nisha Kulkarni', reason: 'Unpaid leave applied twice for 02-Apr', oldv: inr(80900), newv: inr(84150) }]),
        `<span style="font-size:11px;color:var(--text-tertiary)">A Reason is required before a reissue can be confirmed. The employee is notified with a link to the updated version unless <b>Notify Employee When a Payslip Is Reissued</b> is turned off.</span>`);
  };

  /* ============================== MY LEAVE ============================== */
  R.leavemy = function (s, role) {
    const head = U.pageHead(s, [{ label: '+ Apply for Leave', cls: 'primary', icon: 'plus', go: 'leave.apply' },
    { label: 'Export PDF', icon: 'download', toast: 'Export the filtered history — commonly needed at appraisal time, during exit, and whenever a balance is disputed.' },
    { label: 'Export Excel', icon: 'download', toast: 'Export to Excel.' }]);
    const bal = U.card('Balance', 'FY 2026–27 · one row per Leave Type from Masters', `<div class="table-wrap"><table>
      <thead><tr><th>Leave Type</th><th class="r">Allowed</th><th class="r">Carried Forward</th><th class="r">Taken</th><th class="r">Pending</th><th class="r">Remaining</th></tr></thead>
      <tbody>${D.leaveBal.map(l => `<tr><td class="cell-strong">${esc(l.t)}</td>
        <td class="r num">${l.allowed}</td><td class="r num">${l.cf}</td><td class="r num">${l.taken}</td><td class="r num">${l.pending}</td>
        <td class="r num cell-strong">${l.allowed ? (l.allowed + l.cf - l.taken - l.pending) : '<span style="color:var(--text-tertiary);font-style:italic">Not tracked</span>'}</td></tr>`).join('')}</tbody></table></div>`,
      `<span style="font-size:11px;color:var(--text-tertiary)">Carried Forward is computed at year-end, never typed in. A quota of 0 means the type does not consume a balance.</span>`);
    const hist = U.card('Leave History', D.myLeave.length + ' requests', mini(
      [{ k: 'type', t: 'Leave Type', c: 'cell-strong' }, { k: 'from', t: 'From', c: 'mono' }, { k: 'to', t: 'To', c: 'mono' }, { k: 'days', t: 'Days', c: 'r num', th: 'r' }, { k: 'half', t: 'Half-Day', type: 'status' }, { k: 'reason', t: 'Reason' }, { k: 'status', t: 'Status', type: 'status' }, { k: 'by', t: 'Actioned By' }, { k: 'applied', t: 'Applied', c: 'mono' }, { k: 'actioned', t: 'Date Actioned', c: 'mono' }], D.myLeave),
      `<button class="btn sm no" data-toast="Cancel Request — shown only on your own still-Pending requests. Cancelling returns the days to Remaining immediately.">Cancel Request</button>
       <span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">You are notified by email and in-app the moment a request is Approved or Rejected.</span>`);
    return head + U.note('<b>Self-service screens get the full filter and export treatment.</b> An employee looking back over four years of leave needs to narrow that list exactly as much as HR does. There is no Employee filter here, since every row is already theirs.')
      + U.filterbar({ id: s.id, filters: [['All Leave Types'].concat(D.leaveBal.map(l => l.t)), ['All Statuses', 'Pending', 'Approved', 'Rejected', 'Cancelled'], ['FY 2026–27', 'FY 2025–26', 'All financial years'], ['Half-Day — Any', 'Yes', 'No']], filterNames: ['Leave Type', 'Status', 'Financial Year', 'Half-Day'], scope: { all: 'own' } }, role, D.myLeave.length, D.myLeave.length)
      + bal + '<div style="height:12px"></div>' + hist;
  };

  /* ============================== TAX DECLARATIONS ============================== */
  R.taxdecl = function (s, role) {
    const heads = D.masters.taxHeads.filter(h => h.scope === 'Employee Declaration / Exemption');
    return U.pageHead(s, [{ label: 'Save as Draft' }, { label: 'Submit', cls: 'primary', icon: 'check', toast: 'Submitted and locked for the financial year. Payroll uses these figures from the next run onward.' }])
      + U.note('<b>This screen no longer knows what any deduction is called.</b> It renders one row per configured head with scope <code>Employee Declaration / Exemption</code>. If none are configured, it says so and shows nothing else — it does not show an empty form, and it does not error.')
      + U.card('Scheme', 'Shown only because schemes are configured', U.section('', [
        { l: 'Financial Year', v: 'FY 2026–27', ro: 1 },
        { l: 'Tax Scheme', type: 'select', opts: D.masters.taxSchemes.map(x => x.name), hint: D.masters.taxSchemes[0].desc + ' Choice window: ' + D.masters.taxSchemes[0].window },
        { l: 'Declaration Status', v: 'Draft', ro: 1, hint: 'Draft → Submitted (locked, used by Payroll) → Verified (HR/Accountant audit trail, not a blocking gate)' }
      ]))
      + '<div style="height:12px"></div>'
      + U.card('Declarations', heads.length + ' configured head' + (heads.length === 1 ? '' : 's') + ' + the catch-all',
        heads.map(h => `<div class="form-section"><div class="form-section-head"><h4>${esc(h.name)}</h4><span class="note">${esc(h.rate)}</span></div>
        <div class="form-grid">
          ${U.field({ l: 'Amount Declared (₹)', v: '1,20,000', hint: 'Validated against the head\'s Maximum Amount per Period — exceeding it shows the cap inline and blocks Submit rather than silently trimming' })}
          ${U.field({ l: 'Proof Upload', type: 'file', v: 'savings-statement-2026.pdf', span: 2, hint: 'Mandatory because this head has Requires Proof set to Yes. PDF/JPG/PNG up to 5 MB each' })}
        </div></div>`).join('')
        + `<div class="form-section"><div class="form-section-head"><h4>Other Declared Deduction</h4>
          <span class="note">The only field on this screen with a fixed name</span></div>
          <div class="form-grid">${U.field({ l: 'Amount (₹)', ph: '0' })}${U.field({ l: 'Description', span: 2, ph: 'What this is' })}</div>
          <div style="margin-top:8px;font-size:11.5px;color:var(--text-tertiary);line-height:1.5">It exists because an employee may legitimately have something to declare that Super Admin has not set up a head for yet. It is <b>flagged for HR/Accountant attention during verification rather than fed into the tax calculation automatically</b> — an uncategorized amount should not silently reduce someone's tax when no head has said it may.</div></div>`);
  };

  /* ============================== OFFER LETTER ============================== */
  R.letter = function (s, role) {
    return U.pageHead(s, [{ label: 'Preview', icon: 'eye' }, { label: 'Generate PDF', cls: 'primary', icon: 'download' },
    { label: 'Send to Employee', icon: 'send', toast: 'Sending an outbound letter needs the same explicit permission as any other outbound message in this CMS.' }])
      + `<div class="rec-head rise"><div class="rec-avatar">DR</div>
        <div><div class="rec-id">EMP-2026-0011</div><div class="rec-name">Divya Raman</div>
        <div class="rec-meta"><span>Sales Executive</span><span class="dot"></span><span>Sales</span><span class="dot"></span><span>Joins 27-07-2026</span><span class="dot"></span>${U.badge('Active')}</div></div>
        <div class="rec-actions"><button class="btn" data-go="emp.record">${svg('employee', 14)} Open record</button></div></div>`
      + `<div class="card rise"><div class="card-body">
        ${U.section('Letter', [
        { l: 'Employee', v: 'Divya Raman', ro: 1 },
        { l: 'Letter Type', type: 'select', req: 1, opts: ['Appointment Letter', 'Offer Letter'] },
        { l: 'Designation', v: 'Sales Executive', ro: 1 }, { l: 'Department', v: 'Sales', ro: 1 },
        { l: 'Joining Date', v: '27-07-2026', ro: 1 }, { l: 'Employment Type', v: 'Full Time', ro: 1 }
      ], 'Pulled read-only from Employment Details')}
        <div class="form-section"><div class="form-section-head"><h4>Compensation Summary</h4><span class="note">From Salary Structure</span></div>
          <div class="totals" style="margin-left:0;width:340px">
            <div class="tr"><span>Basic Salary (Monthly)</span><b>${inr(32000)}</b></div>
            <div class="tr"><span>HRA (Monthly)</span><b>${inr(16000)}</b></div>
            <div class="tr"><span>Special Allowance (Monthly)</span><b>${inr(19000)}</b></div>
            <div class="tr"><span>Annual CTC</span><b>${inr(1044000)}</b></div></div></div>
        <div class="form-section"><div class="form-section-head"><h4>Statutory Components Disclosed</h4>
          <span class="note">Whichever heads actually apply — by the name Super Admin gave each one</span></div>
          ${mini([{ k: 'label', t: 'Head' }, { k: 'borne', t: 'Borne By', type: 'chip' }], [{ label: 'Retirement Fund', borne: 'Employee' }, { label: 'Retirement Fund (Employer)', borne: 'Company' }, { label: 'State Levy', borne: 'Employee' }])}
          <div style="margin-top:8px;font-size:11.5px;color:var(--text-tertiary)">An employee never receives a letter promising something different from what their payslip later shows. If no statutory heads apply, this section is omitted entirely rather than printing an empty heading.</div></div>
        <div class="form-section"><div class="form-section-head"><h4>Custom Terms</h4>
          <span class="note">Same field shape as Ad-hoc Payslip Adjustments, deliberately</span></div>
          ${mini([{ k: 'label', t: 'Label', c: 'cell-strong' }, { k: 'type', t: 'Type', type: 'chip' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'rec', t: 'Recurring', type: 'status' }],
        [{ label: 'Signing Bonus per Offer Letter', type: 'Addition', amt: 50000, rec: 'No' }], 'payroll.adhoc')}
          <div style="margin-top:10px"><button class="btn" data-toast="Add a custom term — Label, Type, Amount, Recurring.">${svg('plus', 14)} Add Custom Term</button></div>
          <div style="margin-top:9px;font-size:11.5px;color:var(--text-tertiary)">On save, each Custom Term is <b>queued automatically</b> as an Ad-hoc Payslip Adjustment against this employee, effective from their Joining Date — no manual "remember to add this later" step.</div></div>
      </div></div>`;
  };

  /* ============================== ASSET: ASSIGN / DEPRECIATION / CARD ============================== */
  R.assign = function (s, role) {
    return U.pageHead(s) + U.note('<b>Transfer is a pure HR/Super Admin administrative action</b>, not something raised as a request. Manager\'s approval role covers Repair, Damage and Return requests only.')
      + `<div class="grid g-3">
        ${U.card('Assign', 'Available only when Status is In Store', U.section('', [{ l: 'Employee', type: 'select', req: 1, opts: C.PEOPLE }, { l: 'Effective Date', req: 1, v: '29-07-2026' }]),
        `<button class="btn primary" data-toast="Assigned. Status set to In Use and one row added to Assignment History.">Assign</button>`)}
        ${U.card('Transfer', 'Available only when Status is In Use', U.section('', [{ l: 'New Employee', type: 'select', req: 1, opts: C.PEOPLE }, { l: 'Effective Date', req: 1, v: '29-07-2026' }, { l: 'Reason', type: 'textarea', req: 1, span: 3 }]),
          `<button class="btn primary" data-toast="Transferred. Status stays In Use under a new Assigned To, with the reason recorded in Assignment History.">Transfer</button>`)}
        ${U.card('Unassign / Return to Store', 'Clears Assigned To', U.section('', [{ l: 'Effective Date', req: 1, v: '29-07-2026' }, { l: 'Note', type: 'textarea', span: 3 }]),
          `<button class="btn primary" data-toast="Unassigned. Status set to In Store and Assigned To cleared.">Unassign</button>`)}
      </div>`
      + U.card('Assignment History', 'AST-2026-0001 · MacBook Pro 14" M3',
        mini([{ k: 'emp', t: 'Employee', c: 'cell-strong' }, { k: 'from', t: 'From Date', c: 'mono' }, { k: 'to', t: 'To Date', c: 'mono' }, { k: 'action', t: 'Action', type: 'chip' }, { k: 'by', t: 'Performed By' }, { k: 'reason', t: 'Reason' }], D.assignHistory));
  };
  R.depreciationBody = function (role) {
    const hide = role === 'manager';
    if (hide) return U.note('<b>Purchase Value and Current Value are hidden from Manager by default.</b> Turning on <code>Show Purchase Value to Manager</code> (RBAC §2.1) reveals both — and the matching range filter on the Asset Directory returns with them.', 'warn')
      + U.empty('Depreciation figures are not visible at your permission level.', 'The field\'s visibility decides; the filter follows.');
    const pv = 185000, life = 4, years = 2.3, cv = Math.max(0, Math.round(pv - (pv / life) * years));
    return U.section('Depreciation — read-only, calculated automatically', [
      { l: 'Purchase Value (₹)', v: '1,85,000', ro: 1 }, { l: 'Useful Life (Years)', v: '4', ro: 1 },
      { l: 'Depreciation Method', v: 'Straight Line', ro: 1 }, { l: 'Current Value (₹)', v: inr(cv).replace('₹', ''), ro: 1 },
      { l: 'As of', v: 'FY 2026–27', ro: 1, hint: 'Recalculated automatically at the start of each financial year' }
    ], 'Never typed in — the only place Purchase Value, Useful Life or Method can be changed is the Details tab')
      + `<div class="rbac-note">${svg('info', 14)}<div>Current Value = Purchase Value − (Purchase Value ÷ Useful Life × Years Since Purchase). Value never drops below ₹0. If Purchase Value or Useful Life is missing, this shows <b>"Not available"</b> rather than guessing.</div></div>`;
  };
  R.depreciation = function (s, role) {
    return U.pageHead(s) + `<div class="card rise"><div class="card-body">${R.depreciationBody(role)}</div></div>`
      + U.card('Depreciation across all assets', 'Straight Line', mini(
        [{ k: 'tag', t: 'Asset Tag', c: 'mono cell-accent' }, { k: 'name', t: 'Name', c: 'cell-strong' }, { k: 'cat', t: 'Category' },
        { k: 'pv', t: 'Purchase Value', type: role === 'manager' ? 'masked' : 'money', c: 'r', th: 'r', maskNote: 'Show Purchase Value to Manager is OFF' },
        { k: 'cv', t: 'Current Value', type: role === 'manager' ? 'masked' : 'money', c: 'r', th: 'r', maskNote: 'Show Purchase Value to Manager is OFF' }], D.assets, 'asset.directory'));
  };
  R.assetcard = function (s, role) {
    const a = D.assets[0], hide = role === 'manager';
    return U.pageHead(s, [{ label: 'Download Asset Card', cls: 'primary', icon: 'download', toast: 'A single-page printable summary.' }, { label: 'Download Asset List', icon: 'download', go: 'asset.directory' }])
      + `<div style="max-width:620px">${U.card('Asset Card — ' + a.tag, 'Printable summary', U.section('', [
        { l: 'Asset Tag', v: a.tag, ro: 1 }, { l: 'Name', v: a.name, ro: 1 }, { l: 'Category', v: a.cat, ro: 1 },
        { l: 'Assigned To', v: a.to, ro: 1 }, { l: 'Purchase Date', v: a.pdate, ro: 1 },
        { l: 'Purchase Value', v: hide ? 'Hidden' : inr(a.pv), ro: 1, lock: hide ? 'Not visible to Manager' : '' },
        { l: 'Current Value', v: hide ? 'Hidden' : inr(a.cv), ro: 1, lock: hide ? 'Not visible to Manager' : '' }
      ]), `<span style="font-size:11px;color:var(--text-tertiary)">Purchase and Current Value are included only for roles that can already see those fields.</span>`)}</div>`;
  };

  /* ============================== TASK DETAIL ============================== */
  R.taskdetail = function (s, role) {
    const canDelete = role === 'superadmin' || role === 'manager';
    const t = D.tasks.find(x => x.id === 'TSK-0141') || D.tasks[0];
    return U.pageHead(s, [{ label: 'Save', cls: 'primary', icon: 'check' }, { label: 'Cancel' },
    { label: 'Delete', cls: canDelete ? 'no' : 'disabled', toast: canDelete ? 'Delete shows a confirm-before-you-go prompt.' : 'Delete is Manager and Super Admin only — Employee cannot delete a task.' }])
      + `<div class="rec-head rise"><div class="rec-avatar">${svg('kanban', 20)}</div>
        <div><div class="rec-id">${esc(t.id)} · PRJ-2026-0001</div><div class="rec-name">${esc(t.t)}</div>
        <div class="rec-meta">${U.badge(t.s)}<span class="dot"></span>${U.badge(t.pri)}<span class="dot"></span><span>Due ${esc(t.due)}</span><span class="dot"></span><span>${t.sprint !== '—' ? esc(t.sprint) : 'Not in a sprint — still in Backlog'}</span></div></div>
        <div class="rec-actions"><button class="btn" data-go="proj.board">${svg('kanban', 14)} Back to board</button>${t.sprint !== '—' ? `<button class="btn" data-go="proj.sprints">${svg('play', 14)} ${esc(t.sprint.replace(/ —.*$/, ''))}</button>` : ''}</div></div>`
      + `<div class="grid g-8-4">
        ${U.card('Task', '', U.section('', [
        { l: 'Title', req: 1, span: 3, v: t.t },
        { l: 'Assignee', type: 'select', req: 1, opts: C.PEOPLE, hint: 'Limited to employees on this project\'s team' },
        { l: 'Status', type: 'select', req: 1, opts: ['In Progress', 'Backlog', 'To Do', 'In Review', 'Done'], hint: 'Matches the board column — changing either updates the other' },
        { l: 'Due Date', v: t.due },
        { l: 'Sprint', v: t.sprint !== '—' ? t.sprint : 'Not in a sprint', ro: 1, lock: 'Set from Sprints', hint: 'Which sprint a task belongs to is decided from the Sprint side — Update Sprint (§2.5) checks it in or out. This field is read-only here so the two screens can never disagree.' },
        { l: 'Description', type: 'textarea', span: 3, v: 'Their IdP sends emailAddress instead of email in the SAML assertion. Add a per-tenant attribute mapping layer rather than asking each customer to change their claim — three other tenants will hit this.' }
      ]) + `<div class="form-section"><div class="form-section-head"><h4>Sub-tasks</h4></div>
          <div class="checklist" style="border:1px solid var(--border);border-radius:var(--r-md)">
            ${[['Add mapping table + migration', 1], ['Tenant config UI', 1], ['Backfill existing tenants', 0], ['Regression test with 3 IdPs', 0]].map(t => `<div class="ck ${t[1] ? 'done' : ''}">
              <div class="ck-box">${t[1] ? svg('check', 12, 3) : ''}</div><div class="ck-body"><div class="ck-title">${esc(t[0])}</div></div></div>`).join('')}</div>
          <div style="margin-top:9px"><button class="btn" data-toast="Sub-task added.">${svg('plus', 14)} Add Sub-task</button></div></div>`)}
        ${U.card('Comments', '3 comments', `<div class="timeline" style="padding-left:26px">
          ${[['Vikram Iyer', '28-07 10:07', 'Go with the per-tenant mapping. Three other customers will hit this eventually.'],
      ['Arun Menon', '28-07 11:20', 'Mapping table is in. Config UI next — should land before Friday.'],
      ['Sneha Pillai', '29-07 09:14', 'Flagging that the backfill needs a maintenance window for the two largest tenants.']]
        .map(c => `<div class="tl-item"><div class="tl-dot" style="--tone:var(--accent);--tone-bg:var(--accent-subtle)">${svg('employee', 11)}</div>
              <div class="tl-head"><span class="who">${esc(c[0])}</span><span class="when">${esc(c[1])}</span></div>
              <div class="tl-body">${esc(c[2])}</div></div>`).join('')}</div>
          <div style="margin-top:10px"><textarea class="input" placeholder="Add a comment…"></textarea>
          <button class="btn primary" style="margin-top:8px" data-toast="Comment added. Comments are never edited or deleted once posted, only added to.">${svg('send', 13)} Add Comment</button></div>`)}
      </div>`;
  };

  /* ============================== TAX & COMPLIANCE OVERVIEW ==============================
     Two panels, deliberately never netted into one figure: the payable side is money
     the company HOLDS and OWES onward to an authority; the receivable side is a credit
     it can CLAIM BACK. They are different balance-sheet items, and a single "net tax
     position" number would be wrong in both directions and misleading once exported. */
  R.taxoverview = function (s, role) {
    const P = D.taxPeriods, R2 = D.taxReceipts;
    const sum = (a, f) => a.reduce((x, r) => x + (f(r) || 0), 0);

    const outstanding = sum(P, r => r.outstanding);
    const overdue = P.filter(r => r.status === 'Overdue');
    const dueSoon = P.filter(r => r.status === 'Due Soon');
    const remittedFY = sum(P, r => r.remitted);

    const whFY = sum(R2, r => r.withheld);
    const certOut = sum(R2.filter(r => r.cert === 'No'), r => r.withheld);
    const certUnclaimed = sum(R2.filter(r => r.cert === 'Yes' && r.claimed === 'No'), r => r.withheld);
    const claimed = sum(R2.filter(r => r.claimed === 'Yes'), r => r.withheld);

    const head = U.pageHead(s, [{ label: 'Export', icon: 'download', toast: 'Exports both registers separately — never combined into one net figure.' }]);

    /* No withholding head configured at all is a different state from "nothing withheld
       yet", and says so rather than showing a confidently empty register. */
    const anyHead = D.masters.taxHeads.some(t => /Withholding/.test(t.scope) && t.force === 'In Force');
    if (!anyHead) {
      return head + U.card('Tax & Compliance', '', U.empty('No withholding taxes are configured.',
        'Add one in Masters → Taxes (Section 3.2) under a Withholding scope, and anything withheld on a Purchase Bill or held back by a customer will appear here automatically.'));
    }

    const panel = (title, note, kpis) => U.card(title, note,
      `<div class="grid g-kpi">${kpis.map((k, i) => U.kpi(Object.assign({ i: i }, k))).join('')}</div>`);

    const payable = panel('Payable — money held, owed onward to an authority',
      'A liability. This is not the company\'s money.', [
      { icon: 'rupee', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Withheld — Not Yet Remitted', value: inrAbbr(outstanding), foot: inr(outstanding) + ' across ' + P.filter(r => r.outstanding > 0).length + ' open periods' },
      { icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Due Within 7 Days', value: inrAbbr(sum(dueSoon, r => r.outstanding)), foot: dueSoon.length + ' period' + (dueSoon.length === 1 ? '' : 's') },
      { icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Overdue Remittances', value: overdue.length, unit: 'periods', foot: overdue.length ? inr(sum(overdue, r => r.outstanding)) + ' past its due date' : 'Nothing overdue' },
      { icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Remitted This Financial Year', value: inrAbbr(remittedFY), foot: inr(remittedFY) }
    ]);

    const receivable = panel('Receivable — credits the company can claim',
      'An asset, evidenced by a certificate the customer issues.', [
      { icon: 'rupee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Withheld by Customers — This FY', value: inrAbbr(whFY), foot: inr(whFY) + ' across ' + R2.length + ' receipts' },
      { icon: 'doc', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Certificate Outstanding', value: inrAbbr(certOut), foot: certOut ? 'Chase the customer — no certificate, no claim' : 'All certificates received' },
      { icon: 'clock', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Certified — Not Yet Claimed', value: inrAbbr(certUnclaimed), foot: inr(certUnclaimed) + ' ready to claim' },
      { icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Credit Claimed This FY', value: inrAbbr(claimed), foot: inr(claimed) }
    ]);

    const dueTable = U.card('Due Soon & Overdue', 'Sorted by due date, soonest first',
      mini([{ k: 'head', t: 'Tax Head', c: 'cell-strong' }, { k: 'label', t: 'Period' }, { k: 'outstanding', t: 'Outstanding', type: 'money' },
      { k: 'due', t: 'Due Date', c: 'mono' }, { k: 'status', t: 'Status', type: 'status' }],
        P.filter(r => r.outstanding > 0), 'tax.payable'),
      `<button class="btn sm ghost" data-go="tax.payable">${svg('arrow', 13)} Open the payable register</button>`);

    const certTable = U.card('Certificates Outstanding — Oldest First', 'No certificate, no claim',
      mini([{ k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'inv', t: 'Invoice', c: 'mono cell-accent' }, { k: 'date', t: 'Payment Date', c: 'mono' },
      { k: 'withheld', t: 'Withheld', type: 'money' }, { k: 'status', t: 'Status', type: 'status' }],
        R2.filter(r => r.cert === 'No'), 'tax.receivable'),
      `<button class="btn sm ghost" data-go="tax.receivable">${svg('arrow', 13)} Open the receivable register</button>`);

    return head
      + U.note('<b>These two panels are never netted into a single figure.</b> What the company withheld from suppliers is a liability it owes an authority; what customers withheld from the company is an asset it can claim back. Offsetting them would produce a number that is wrong in both directions — and worse once exported, because the reader cannot tell which way it leans.')
      + payable + '<div style="height:12px"></div>' + receivable
      + '<div style="height:12px"></div><div class="grid g-2">' + dueTable + certTable + '</div>';
  };

  /* ============================== RBAC MATRIX ============================== */
  R.matrix = function (s, role) {
    const target = S.view['matrixRole'] || 'employee';
    const head = U.pageHead(s, [{ label: 'Preview as this role', icon: 'eye', toast: 'Preview mode shows the app exactly as the selected role would see it, given the currently saved settings. In this prototype, use the "Viewing as" switcher in the header — it does the same thing.' },
    { label: 'Discard Changes' }, { label: 'Save Changes', cls: 'primary', icon: 'check', toast: 'All pending toggle changes committed together. Toggles accumulate as pending edits rather than saving one at a time.' }]);
    const mods = C.MODULES.filter(m => !m.single && m.id !== 'rbac');
    const toggleTotal = mods.reduce((a, m) => a + (D.toggles[m.label] || []).length, 0);
    const screenTotal = mods.reduce((a, m) => a + m.screens.length, 0);
    const sel = `<div class="filterbar rise"><div class="filter-row">
      <span style="font-size:11.5px;font-weight:600;color:var(--text-secondary)">Configure permissions for</span>
      <select class="fselect" style="max-width:220px" id="matrixRoleSel">${Object.keys(C.ROLES).map(k => `<option value="${k}"${k === target ? ' selected' : ''}>${esc(C.ROLES[k].name)}</option>`).join('')}</select>
      <div class="searchbox" style="width:260px"><span class="s-icon">${svg('search', 14, 2)}</span>
        <input type="text" placeholder="Search modules and screens…" style="padding-right:10px"></div>
      <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">${mods.length} modules · ~${screenTotal} screens · ${toggleTotal} field/action toggles</span>
    </div></div>`;
    const body = mods.map((m, mi) => {
      const toggles = D.toggles[m.label] || [];
      return `<div class="matrix-mod ${mi === 1 ? 'open' : ''}">
        <div class="matrix-head"><span class="chev">${svg('arrow', 13, 2.4)}</span>
          <h4>${esc(m.label)}</h4><span class="spec-ref">${esc(m.ref || '')}</span>
          <span class="meta">${m.screens.length} screens · ${toggles.length} toggle${toggles.length === 1 ? '' : 's'}</span></div>
        <div class="matrix-body">
          ${m.screens.map(sc => {
        const visible = sc.roles.indexOf(target) >= 0;
        const scp = U.scopeOf(sc, target);
        return `<div class="mscreen"><div class="mscreen-top">
              <span class="nm">${esc(sc.label)}</span><span class="spec-ref">${esc(sc.ref || '')}</span>
              <div class="mscreen-ctl">
                <div class="scope-seg" title="Layer 1 — screen-level visibility">
                  <button class="${visible ? 'on' : ''}">Visible</button><button class="${visible ? '' : 'on'}">Hidden</button></div>
                ${visible && sc.scope ? `<div class="scope-seg" title="Layer 4 — scope restriction">
                  <button class="${scp === 'all' ? 'on' : ''}">All</button><button class="${scp === 'team' ? 'on' : ''}">Team</button><button class="${scp === 'own' ? 'on' : ''}">Own</button></div>` : ''}
              </div></div>
              ${visible ? `<div class="mactions">
                ${['View', 'Add', 'Edit', 'Export'].map((a, i) => `<span class="mact ${i === 0 || target === 'superadmin' ? 'on' : i < 2 ? 'on' : ''}"><span class="bx">${svg('check', 9, 3.4)}</span>${a}</span>`).join('')}
                ${(sc.rowActions || []).map(a => `<span class="mact ${target === 'superadmin' ? 'on' : ''}"><span class="bx">${svg('check', 9, 3.4)}</span>${esc(typeof a === 'string' ? a : a.l)}</span>`).join('')}
                <span class="mact"><span class="bx">${svg('check', 9, 3.4)}</span>Delete <span style="font-size:10px;opacity:.7">(Super Admin only)</span></span>
              </div>` : ''}</div>`;
      }).join('')}
          ${toggles.length ? `<div class="mscreen" style="background:var(--surface-sunk)">
            <div class="mscreen-top"><span class="nm" style="color:var(--text-tertiary);font-size:11px;letter-spacing:.05em;text-transform:uppercase">Field &amp; behaviour toggles — Layer 3</span></div>
            <div class="mactions" style="border-top:none;padding-top:4px">
              ${toggles.map(t => `<span class="mfield ${D.defaultOn.indexOf(t) >= 0 ? 'on' : ''}"><span class="bx">${svg('check', 9, 3.4)}</span>${esc(t)}</span>`).join('')}
            </div></div>` : ''}
        </div></div>`;
    }).join('');
    setTimeout(() => {
      const el = document.getElementById('matrixRoleSel');
      if (el) el.onchange = () => { S.view['matrixRole'] = el.value; window.go('rbac.matrix'); };
    }, 0);
    /* RBAC §3 keeps the RBAC module itself out of the per-module matrix — Super Admin
       has unconditional access to it. But §8 defines one toggle about this module,
       so it gets its own block rather than being lost. */
    const selfBlock = `<div class="matrix-mod open"><div class="matrix-head" style="cursor:default">
        <h4>Roles &amp; Access</h4><span class="spec-ref">§8</span>
        <span class="meta">not itself configurable · 1 toggle</span></div>
      <div class="matrix-body"><div class="mscreen" style="background:var(--surface-sunk)">
        <div class="mscreen-top"><span class="nm" style="color:var(--text-tertiary);font-size:11px;letter-spacing:.05em;text-transform:uppercase">Field &amp; behaviour toggles — Layer 3</span></div>
        <div class="mactions" style="border-top:none;padding-top:4px">
          ${(D.toggles['Roles & Access'] || []).map(t => `<span class="mfield"><span class="bx">${svg('check', 9, 3.4)}</span>${esc(t)}</span>`).join('')}
        </div></div>
        <div style="padding:10px 13px;font-size:11.5px;color:var(--text-tertiary);line-height:1.5">
          The four RBAC screens themselves are not listed for configuration: only Super Admin can open this module at all, and for every other role it is invisible — not read-only, not partial, it simply does not exist (§1).
        </div></div></div>`;
    return head + U.note(`Configuring <b>${esc(C.ROLES[target].name)}</b>. Four layers per screen: <b>Visible/Hidden</b> (Layer 1), <b>action permissions</b> pulled from that screen's own documented action list (Layer 2), <b>field-level toggles</b> (Layer 3), and <b>All / Team / Own</b> scope (Layer 4). Controls that would not mean anything on a given screen simply do not appear on it.`)
      + sel + body + selfBlock;
  };

  /* ============================== SETTINGS ============================== */
  R.settings = function (s, role) {
    const t = S.theme;
    const head = U.pageHead(s, [{ label: 'Save Changes', cls: 'primary', icon: 'check', toast: 'Settings saved.' }]);
    const tab = S.tab[s.id] || 'appearance';
    const tabs = U.tabs(s.id, [{ k: 'appearance', l: 'Appearance' }, { k: 'regional', l: 'Regional & Financial' }, { k: 'system', l: 'System' }, { k: 'about', l: 'About this prototype' }], tab);
    const prev = (mode) => {
      const c = mode === 'dark' ? { side: '#0a0c11', bg: '#111419', bar: '#232830', acc: '#7592ff' } : { side: '#14171e', bg: '#ffffff', bar: '#e0e3e9', acc: '#2a4bd7' };
      return `<div class="theme-prev" style="background:${c.bg}">
        <div class="tp-side" style="background:${c.side}"></div>
        <div class="tp-main"><div class="tp-bar" style="background:${c.acc};width:44%"></div>
        <div class="tp-bar" style="background:${c.bar}"></div><div class="tp-bar" style="background:${c.bar};width:72%"></div>
        <div class="tp-bar" style="background:${c.bar};width:56%"></div></div></div>`;
    };
    let body;
    if (tab === 'appearance') {
      body = U.card('Theme', 'Applies instantly across every screen and persists for this session', `
        <div class="theme-picker">
          <div class="theme-opt ${t === 'light' ? 'on' : ''}" data-set-theme="light">${prev('light')}
            <div class="tn">${svg('sun', 14)} Light<span class="radio-dot"></span></div>
            <div class="td">Cool grey canvas, dark sidebar. The default.</div></div>
          <div class="theme-opt ${t === 'dark' ? 'on' : ''}" data-set-theme="dark">${prev('dark')}
            <div class="tn">${svg('moon', 14)} Dark<span class="radio-dot"></span></div>
            <div class="td">Near-black canvas, lifted surfaces, softened accent.</div></div>
          <div class="theme-opt" data-set-theme="system">${prev(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')}
            <div class="tn">${svg('settings', 14)} Match system<span class="radio-dot"></span></div>
            <div class="td">Follows the operating system setting.</div></div>
        </div>`,
        `<span style="font-size:11px;color:var(--text-tertiary)">Theme is held in memory for this session only — nothing is written to browser storage. A quick toggle also sits in the header and in the profile menu.</span>`)
        + '<div style="height:12px"></div>'
        + U.card('Accent Color', 'Changes live, across every screen, right now', `
          <div style="display:flex;gap:14px;flex-wrap:wrap;padding:2px 0">
            ${Object.keys(window.ACCENTS).map(k => {
        const p = window.ACCENTS[k];
        const on = S.accent === k;
        const swatch = p[t === 'dark' ? 'dark' : 'light'].accent;
        return `<div data-set-accent="${k}" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;width:66px" title="${esc(p.name)}">
                <div style="width:36px;height:36px;border-radius:50%;background:${swatch};display:grid;place-items:center;color:#fff;border:2px solid ${on ? swatch : 'transparent'};box-shadow:${on ? '0 0 0 2px var(--surface), 0 0 0 3.5px ' + swatch : '0 0 0 1px var(--border)'}">
                  ${on ? svg('check', 14, 3) : ''}</div>
                <span style="font-size:11px;color:${on ? 'var(--text-primary)' : 'var(--text-tertiary)'};font-weight:${on ? '600' : '400'};text-align:center">${esc(p.name.replace(' (default)', ''))}</span>
              </div>`;
      }).join('')}
            <!-- Free colour choice. The swatch IS the input, so clicking it opens the
                 OS colour wheel; oninput fires while dragging, so the whole app
                 recolours live as the user moves through the picker. -->
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:66px" title="Pick any colour">
              <label style="cursor:pointer;position:relative;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;
                background:conic-gradient(#e11d48,#d97706,#facc15,#059669,#0d9488,#2a4bd7,#7c3aed,#e11d48);
                border:2px solid ${S.accent === 'custom' ? S.customAccent : 'transparent'};
                box-shadow:${S.accent === 'custom' ? '0 0 0 2px var(--surface), 0 0 0 3.5px ' + S.customAccent : '0 0 0 1px var(--border)'}">
                ${S.accent === 'custom' ? `<span style="width:16px;height:16px;border-radius:50%;background:${S.customAccent};border:2px solid #fff"></span>` : ''}
                <input type="color" value="${esc(S.customAccent)}" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"
                  oninput="window.setCustomAccent(this.value)" onchange="window.setCustomAccent(this.value, true)">
              </label>
              <span style="font-size:11px;color:${S.accent === 'custom' ? 'var(--text-primary)' : 'var(--text-tertiary)'};font-weight:${S.accent === 'custom' ? '600' : '400'};text-align:center">Custom</span>
            </div>
          </div>
          ${S.accent === 'custom' ? `<div style="margin-top:12px;display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--text-secondary)">
            <span class="mono" style="padding:3px 8px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-sunk)">${esc(String(S.customAccent).toUpperCase())}</span>
            <span>Hover, subtle-fill and hairline shades are derived from this one colour automatically, and re-derived for Dark — so a custom accent stays legible in both themes without picking four colours.</span></div>` : ''}`,
          `<span style="font-size:11px;color:var(--text-tertiary)">Recolors every accent-tinted element — primary buttons, active nav, links, focus rings — in both Light and Dark. Also in-memory only, same as Theme above.</span>`)
        + '<div style="height:12px"></div>'
        + U.card('Display Scale', 'Sizes the entire interface, live — currently ' + S.scale + '%', `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${window.SCALES.map(n => `<button class="btn ${S.scale === n ? 'primary' : ''}" data-set-scale="${n}">${n}%</button>`).join('')}
            <span style="margin-left:6px;font-size:11.5px;color:var(--text-tertiary)">or drag</span>
            <input type="range" min="80" max="200" step="5" value="${S.scale}" style="flex:1;min-width:180px;accent-color:var(--accent)"
              oninput="window.setScale(this.value)">
          </div>
          <div class="set-row" style="margin-top:10px"><div><div class="t">Why this exists separately from the browser's own zoom</div>
            <div class="d">Browser zoom is per-site and resets with a cleared profile; this is an application setting that travels with the user account, so a shared machine or a fresh browser still opens the CMS at the size that person works in. On a large or high-density display, one control here beats every screen carrying its own breakpoints.</div></div></div>`,
          `<span style="font-size:11px;color:var(--text-tertiary)">100% is the design baseline; <b>110% is the default</b>, the size this prototype was reviewed and signed off at. Held in memory for this session only, same as Theme and Accent.</span>`)
        + '<div style="height:12px"></div>'
        + U.card('Display', '', `
          <div class="set-row"><div><div class="t">Dense tables</div><div class="d">13px base type and 30px controls. Turning this off adds vertical breathing room at the cost of rows per screen.</div></div>
            <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span></span></div></div>
          <div class="set-row"><div><div class="t">Show spec references</div><div class="d">The small monospace chip beside every page title, naming the module section each screen was built from. Useful during review; off in production.</div></div>
            <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span></span></div></div>
          <div class="set-row"><div><div class="t">Collapse sidebar by default</div><div class="d">Starts every session with the icon-only rail instead of the full module tree.</div></div>
            <div class="ctl"><span class="toggle" data-toggle><span class="track"></span></span></div></div>
          <div class="set-row"><div><div class="t">Reduced motion</div><div class="d">Disables entrance animations and transitions. Also honoured automatically when the OS requests it.</div></div>
            <div class="ctl"><span class="toggle" data-toggle><span class="track"></span></span></div></div>`);
    } else if (tab === 'regional') {
      body = U.card('Regional & Financial', 'Drawn from Masters where a master already owns the value', `
        <div class="set-row"><div><div class="t">Active Financial Year</div><div class="d">Sourced from Masters → Financial Year. Every running code stamps its year from here, and every date-range preset reads it rather than hardcoding boundaries.</div></div>
          <div class="ctl"><select class="fselect" data-toast="Financial year changed — this is managed in Masters → Financial Year."><option>FY 2026–27</option><option>FY 2025–26</option></select></div></div>
        <div class="set-row"><div><div class="t">Currency display</div><div class="d">Dashboard summary widgets abbreviate to lakh/thousand (₹2.3L, ₹50.0K). Individual records always show the full figure.</div></div>
          <div class="ctl"><select class="fselect" data-toast="Currency display changed."><option>₹ Indian (lakh / crore)</option><option>₹ Full figures everywhere</option></select></div></div>
        <div class="set-row"><div><div class="t">Date format</div><div class="d">Used across every list, record and export in the CMS.</div></div>
          <div class="ctl"><select class="fselect" data-toast="Date format changed."><option>dd-mm-yyyy</option><option>dd MMM yyyy</option><option>yyyy-mm-dd</option></select></div></div>
        <div class="set-row"><div><div class="t">Default page size</div><div class="d">Rows per page on every list screen. Individually overridable per screen.</div></div>
          <div class="ctl"><select class="fselect" data-toast="Page size changed."><option>25</option><option>10</option><option>50</option><option>100</option></select></div></div>
        <div class="set-row"><div><div class="t">Payroll basis</div><div class="d">Hour-Basis, live — see Payroll → Attendance & Time Basis §2.4. Required hours come from Masters → Work Week & Hours.</div></div>
          <div class="ctl"><select class="fselect" data-toast="Payroll basis is read by Run Payroll."><option>Hour-Basis</option></select></div></div>`);
    } else if (tab === 'system') {
      body = U.card('System', 'Super Admin only', `
        <div class="set-row"><div><div class="t">Filter persistence</div><div class="d">Applied filters persist for a user, on a screen, within a session. Deliberately <b>not</b> across sessions — a stale filter silently applied at next login is a common source of "the data is missing" reports.</div></div>
          <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span><span class="tl">Within session</span></span></div></div>
        <div class="set-row"><div><div class="t">Export header block</div><div class="d">Every exported file carries the filters that produced it, the result count, who exported it, and when. A 24-row spreadsheet that does not say it was filtered is actively misleading once emailed.</div></div>
          <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span><span class="tl">Always</span></span></div></div>
        <div class="set-row"><div><div class="t">Require a reason on every rejection</div><div class="d">Platform-wide default across Leave, Expense, Documents and Asset Requests.</div></div>
          <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span><span class="tl">Required</span></span></div></div>
        <div class="set-row"><div><div class="t">Confirm before irreversible actions</div><div class="d">Deactivating a login, marking an employee Exited, retiring an asset, locking a financial year.</div></div>
          <div class="ctl"><span class="toggle on" data-toggle><span class="track"></span></span></div></div>
        <div class="set-row"><div><div class="t">Roles &amp; Access</div><div class="d">Screen visibility, action permissions, field-level toggles and scope all live in their own module.</div></div>
          <div class="ctl"><button class="btn" data-go="rbac.matrix">${svg('rbac', 14)} Open Role Permission Matrix</button></div></div>`);
    } else {
      const total = C.MODULES.reduce((a, m) => a + m.screens.length, 0);
      body = U.card('About this prototype', '', `
        <div class="set-row"><div><div class="t">Meshrd CMS — clickable HTML prototype</div>
          <div class="d">${total} screens across 14 modules plus login and settings, built directly from the module specification documents. No backend: all data is mock data, and every action reports what it would do rather than doing it.</div></div></div>
        <div class="grid g-4" style="margin:0">
          ${U.ministat({ icon: 'grid', tone: 'var(--accent)', bg: 'var(--accent-subtle)', n: '14', l: 'Modules built' })}
          ${U.ministat({ icon: 'list', tone: 'var(--info)', bg: 'var(--info-bg)', n: total, l: 'Screens reachable' })}
          ${U.ministat({ icon: 'rbac', tone: 'var(--danger)', bg: 'var(--danger-bg)', n: '5', l: 'Roles, switchable live' })}
          ${U.ministat({ icon: 'settings', tone: 'var(--success)', bg: 'var(--success-bg)', n: '46', l: 'RBAC toggles catalogued' })}
        </div>
        <div style="margin-top:14px">${U.note('Screen counts per role: ' + Object.keys(C.ROLES).map(k => '<b>' + esc(C.ROLES[k].name) + '</b> ' + C.MODULES.reduce((a, m) => a + m.screens.filter(x => x.roles.indexOf(k) >= 0).length, 0)).join(' · ') + '. Switch roles from the header to see the difference.')}</div>`);
    }
    setTimeout(() => {
      document.querySelectorAll('[data-set-theme]').forEach(el => el.onclick = () => {
        const v = el.getAttribute('data-set-theme');
        window.setTheme(v === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v);
        U.toast('Theme set to ' + v + '. Held in memory for this session only.', 'ok');
      });
    }, 0);
    return head + tabs + body;
  };

  /* ============================== ATTENDANCE (hour basis) ============================== */
  R.attendance = function (s, role) {
    const pol = D.masters.workWeek[0];
    const team = ['Arun Menon', 'Sneha Pillai', 'Rohit Deshmukh', 'Ayesha Khan', 'Karthik Nair'];
    const scoped = role === 'manager' ? D.attendanceMonthly.filter(r => team.indexOf(r.name) >= 0) : D.attendanceMonthly;
    const jun = D.masters.satCalendar.filter(x => x.month === 'Jun 2026');
    const satWork = jun.filter(x => x.actual === 'Working');

    const head = U.pageHead(s, role === 'superadmin'
      ? [{ label: 'Record Attendance', cls: 'primary', icon: 'plus', go: 'emp.attendance' }, { label: 'Work Week Policy', icon: 'masters', go: 'masters.workweek' }, { label: 'Export Excel', icon: 'download', toast: 'Attendance export downloaded — the filtered set, hours and all.' }]
      : [{ label: 'Work Week Policy', icon: 'masters', go: 'masters.workweek' }, { label: 'Export Excel', icon: 'download', toast: 'Attendance export downloaded — the filtered set, hours and all.' }]);

    const fb = U.filterbar({
      id: s.id, scope: s.scope, filters: [
        ['June 2026', 'May 2026', 'April 2026', 'July 2026'],
        ['All Employees'].concat(scoped.map(r => r.name)),
        ['All Departments'].concat(C.DEPTS),
        ['All Statuses', 'Met', 'Short — compensable', 'Short — payroll impact'],
        ['All Policies'].concat(D.masters.workWeek.map(w => w.name))
      ], filterNames: ['Month', 'Employee', 'Department', 'Hour Status', 'Work Week Policy']
    }, role, scoped.length, D.attendanceMonthly.length);

    /* ---- the period basis strip: where required hours actually come from ---- */
    const basis = `<div class="rec-head rise">
      <div class="rec-avatar">${svg('clock', 20)}</div>
      <div style="min-width:0">
        <div class="rec-id">June 2026 · ${esc(pol.name)}</div>
        <div class="rec-name">Hour basis — ${pol.gross} h gross − ${pol.brk} h break = ${pol.net.toFixed(2)} h net per day</div>
        <div class="rec-meta">
          <span>22 weekdays</span><span class="dot"></span>
          <span>${satWork.length} working Saturday${satWork.length === 1 ? '' : 's'} (${satWork.map(x => x.ord).join(', ')})</span><span class="dot"></span>
          <span>${jun.length - satWork.length} Saturday${jun.length - satWork.length === 1 ? '' : 's'} off</span><span class="dot"></span>
          <span>${esc(pol.satrule)}</span>
        </div>
      </div>
      <div class="rec-summary">
        <div class="s"><div class="l">Working Days</div><div class="v num">${22 + satWork.length}</div></div>
        <div class="s"><div class="l">Required Hours</div><div class="v num">${(22 + satWork.length) * pol.net}</div></div>
        <div class="s"><div class="l">Weekly Target</div><div class="v num">${pol.weekly} h</div></div>
        <div class="s"><div class="l">Met / Short</div><div class="v num">${scoped.filter(r => r.short === 0).length} / ${scoped.filter(r => r.short > 0).length}</div></div>
      </div>
    </div>`;

    const hrs = (v, col) => `<td class="r num"${col ? ` style="color:${col}"` : ''}>${v.toFixed(2)}</td>`;
    const balCol = b => b > 0 ? 'var(--ok)' : (b < 0 ? 'var(--danger)' : 'var(--text-tertiary)');

    const TABS = [
      { k: 'summary', l: 'Monthly Summary', n: scoped.length },
      { k: 'daywise', l: 'Day-wise Log', n: D.attendanceDaily.length },
      { k: 'impact', l: 'Payroll Impact', n: scoped.filter(r => r.short > 0).length },
      { k: 'comp', l: 'Compensation', n: D.compRequests.filter(r => r.status === 'Pending').length },
      { k: 'biometric', l: 'Biometric Feed' }
    ];
    const active = S.tab[s.id] && TABS.some(t => t.k === S.tab[s.id]) ? S.tab[s.id] : 'summary';

    let body = '';

    if (active === 'summary') {
      body = U.note('Required hours are <b>net hours × working days</b> for whichever policy covers the person — so the intern on 4.5 h and Support on a six-day week are measured against their own targets, not a company average. Approved leave and approved compensatory hours are <b>credited</b>; only what is still short reaches payroll.')
        + U.card('June 2026 — Hour Reconciliation', scoped.length + ' employees', `<div class="table-wrap"><table>
          <thead><tr>
            <th>Employee</th><th>Department</th><th>Policy</th>
            <th class="r">Req. Hours</th><th class="r">Worked</th><th class="r">of which Comp</th><th class="r">Leave Cr.</th>
            <th class="r">Credited</th><th class="r">Balance</th>
            <th class="r">Payable Days</th><th class="r">LOP Days</th><th>Status</th>
          </tr></thead>
          <tbody>${scoped.map(r => `<tr class="clickable" data-tab="${s.id}:daywise">
            <td class="cell-strong">${esc(r.name)}</td>
            <td>${esc(r.dept)}</td>
            <td>${U.chip(r.pol.replace(/ —.*$/, ''))}</td>
            ${hrs(r.reqH)}
            ${hrs(r.worked)}
            ${hrs(r.comp, r.comp > 0 ? 'var(--accent)' : '')}
            ${hrs(r.lvH, r.lvH > 0 ? 'var(--warn)' : '')}
            <td class="r num cell-strong">${r.credited.toFixed(2)}</td>
            <td class="r num" style="color:${balCol(r.bal)}">${r.bal > 0 ? '+' : ''}${r.bal.toFixed(2)}</td>
            <td class="r num">${r.payable.toFixed(2)}</td>
            <td class="r num" style="color:${r.lop > 0 ? 'var(--danger)' : 'var(--text-tertiary)'}">${r.lop.toFixed(2)}</td>
            <td>${U.badge(r.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`, 'Click any row to open that person’s day-wise log. <b>Credited</b> = Worked + Leave. <b>of which Comp</b> is a subset of Worked, not an addition — the hours are counted once. <b>Balance</b> = Credited − Required.')
        + U.note('<b>Fatima Sheikh</b> is the rule working as intended — 176.00 hours worked (3.50 of them compensatory hours she chose to put in), plus 16.00 credited for two days of approved leave, landing exactly on 192.00. No deduction. <b>Rohit Deshmukh</b> is 19 hours short with a make-up day still unapproved, so 2.37 days of Loss of Pay sit against him until it clears.');
    }

    if (active === 'daywise') {
      const d = D.attendanceDaily;
      const tot = d.reduce((a, r) => ({ w: a.w + r.worked, req: a.req + r.req, c: a.c + r.comp }), { w: 0, req: 0, c: 0 });
      const kindCol = r => r.status === 'Absent' ? 'var(--danger)'
        : r.status === 'Half Day' ? 'var(--warn)'
          : r.status === 'Comp / Extra Work' ? 'var(--accent)'
            : r.req === 0 ? 'var(--text-tertiary)' : 'var(--ok)';
      body = U.note('<b>Arun Menon — June 2026.</b> One row per calendar day. A day only asks for hours if the work-week policy says it is a working day, so Sundays, even Saturdays and Mandatory holidays sit at zero required and cost nothing.')
        + U.card('Day-wise Hour Log', 'Arun Menon · June 2026 · ' + esc(pol.name), `<div class="table-wrap"><table>
          <thead><tr>
            <th>Date</th><th>Day</th><th>Day Type</th>
            <th>In</th><th>Out</th><th class="r">Break</th>
            <th class="r">Required</th><th class="r">Worked</th><th class="r">Comp</th><th class="r">Balance</th>
            <th>Status</th><th>Note</th>
          </tr></thead>
          <tbody>${d.map(r => `<tr${r.req === 0 && r.worked === 0 ? ' style="opacity:.55"' : ''}>
            <td class="mono">${esc(r.date)}</td>
            <td>${esc(r.day)}</td>
            <td style="font-size:11.5px">${esc(r.kind)}</td>
            <td class="mono">${esc(r.inT)}</td>
            <td class="mono">${esc(r.outT)}</td>
            <td class="r num">${r.brk ? r.brk.toFixed(2) : '—'}</td>
            <td class="r num">${r.req ? r.req.toFixed(2) : '—'}</td>
            <td class="r num">${r.worked ? r.worked.toFixed(2) : '—'}</td>
            <td class="r num" style="color:var(--accent)">${r.comp ? r.comp.toFixed(2) : '—'}</td>
            <td class="r num" style="color:${balCol(r.bal)}">${r.bal ? (r.bal > 0 ? '+' : '') + r.bal.toFixed(2) : '0.00'}</td>
            <td><span class="badge-s" style="color:${kindCol(r)}">${esc(r.status)}</span></td>
            <td style="font-size:11px;color:var(--text-tertiary)">${esc(r.note)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr>
            <td colspan="6" class="cell-strong">June 2026 total</td>
            <td class="r num cell-strong">${tot.req.toFixed(2)}</td>
            <td class="r num cell-strong">${tot.w.toFixed(2)}</td>
            <td class="r num cell-strong" style="color:var(--accent)">${tot.c.toFixed(2)}</td>
            <td class="r num cell-strong" style="color:${balCol(tot.w - tot.req)}">${(tot.w - tot.req) > 0 ? '+' : ''}${(tot.w - tot.req).toFixed(2)}</td>
            <td colspan="2"></td>
          </tr></tfoot>
        </table></div>`, '<b>Balance</b> is that day alone — Worked − Required. <b>Comp</b> does not add hours on top of Worked; it marks how many of the hours already in that row are credited against an earlier shortfall, so nothing is counted twice.')
        + U.note('<b>The compensation rule, end to end.</b> Tuesday 09-06 he left at 14:05 for a family emergency — 4.42 worked against 8 required, a 3.58 h shortfall, and the day dropped to Half Day. Rather than lose half a day\'s pay he worked <b>Saturday 27-06 — a 4th Saturday, normally off</b> — 10:00 to 14:30, four hours, a day he picked himself. The shortfall cleared and June came out ahead. Wednesday 24-06 he was 0.17 h under and the 15-minute grace window absorbed it — still a full day.');
    }

    if (active === 'impact') {
      const shortRows = scoped.filter(r => r.short > 0);
      const rate = 112500 / (22 + satWork.length) / pol.net;   /* gross ÷ working days ÷ net hours */
      body = U.note('Only this tab moves money. Everything above is measurement; this is the handoff to <b>Run Payroll</b>. The conversion is whatever <b>Uncompensated Shortfall Becomes</b> says on the policy — currently <b>' + esc(pol.shortfall) + '</b>.')
        + (shortRows.length
          ? U.card('Shortfall → Loss of Pay', shortRows.length + ' employees with an open shortfall', `<div class="table-wrap"><table>
            <thead><tr>
              <th>Employee</th><th>Policy</th>
              <th class="r">Hours Short</th><th class="r">Comp Pending</th><th class="r">Net Short</th>
              <th class="r">LOP Days (net)</th><th>Est. Deduction</th><th>Status</th><th>Next Step</th>
            </tr></thead>
            <tbody>${shortRows.map(r => {
            const pend = D.compRequests.filter(c => c.emp === r.name && c.status === 'Pending').reduce((a, c) => a + c.makeupHrs, 0);
            const net = Math.max(0, +(r.short - pend).toFixed(2));
            const lopNet = +(net / r.dayNet).toFixed(2);
            const next = pend === 0 ? 'No make-up proposed — deducts at the next run'
              : net === 0 ? 'Approve the pending make-up day and this clears in full'
                : 'Pending make-up covers only ' + pend.toFixed(2) + ' of ' + r.short.toFixed(2) + ' h — the other ' + net.toFixed(2) + ' h still deducts';
            return `<tr>
                <td class="cell-strong">${esc(r.name)}</td>
                <td>${U.chip(r.pol.replace(/ —.*$/, ''))}</td>
                <td class="r num" style="color:var(--danger)">${r.short.toFixed(2)}</td>
                <td class="r num" style="color:var(--accent)">${pend ? pend.toFixed(2) : '—'}</td>
                <td class="r num cell-strong" style="color:${net > 0 ? 'var(--danger)' : 'var(--ok)'}">${net.toFixed(2)}</td>
                <td class="r num" style="color:${lopNet > 0 ? 'var(--danger)' : 'var(--ok)'}">${lopNet.toFixed(2)}</td>
                <td class="num">${net > 0 ? inr(Math.round(net * rate)) : '<span style="color:var(--ok)">₹0</span>'}</td>
                <td>${U.badge(r.status)}</td>
                <td style="font-size:11.5px">${esc(next)}</td>
              </tr>`;
          }).join('')}</tbody>
          </table></div>`, 'Estimated at ' + inr(Math.round(rate)) + ' per hour on a ' + inr(112500) + ' gross — the real figure is per-person and computed at run time.')
          : U.empty('Nobody is short this period.', 'Every employee met their required hours, or made the balance up.'))
        + U.note('<b>A pending compensatory request suspends the deduction, it does not cancel it.</b> If the make-up day is approved the shortfall clears and nothing reaches the payslip. If it is rejected, or the compensation window closes first, the full amount converts at the next payroll run. Nothing is deducted silently — the employee sees the figure on Leave → Compensatory Hours before it happens.', 'warn')
        + `<div style="margin-top:12px;display:flex;gap:7px;flex-wrap:wrap">
             <button class="btn" data-go="leave.comp">${svg('leave', 14)} Compensatory queue</button>
             <button class="btn ${role === 'superadmin' || role === 'hr' ? '' : 'disabled'}" data-go="payroll.run">${svg('payroll', 14)} Open Run Payroll</button>
           </div>`;
    }

    if (active === 'comp') {
      body = U.note('The queue that keeps a bad afternoon from becoming a pay cut. The <b>employee</b> nominates the make-up day — inside the ' + pol.window + '-day window on their policy, up to 16 hours a month — and their manager confirms it.')
        + U.card('Compensatory Hour Requests', D.compRequests.length + ' this period', mini([
          { k: 'id', t: 'Request #', c: 'mono cell-accent' },
          { k: 'emp', t: 'Employee', c: 'cell-strong' },
          { k: 'dept', t: 'Department' },
          { k: 'shortDate', t: 'Shortfall Date', c: 'mono' },
          { k: 'shortHrs', t: 'Hours Short', c: 'r num', th: 'r' },
          { k: 'makeupDate', t: 'Make-Up Date', c: 'mono' },
          { k: 'makeupHrs', t: 'Hours', c: 'r num', th: 'r' },
          { k: 'reason', t: 'Reason' },
          { k: 'status', t: 'Status', type: 'status' },
          { k: 'by', t: 'Decided By' }
        ], D.compRequests, 'leave.comp'))
        + U.note('<b>27-06-2026 is a 4th Saturday — normally a week off.</b> The policy permits make-up on a non-working Saturday, which is why Arun\'s request was accepted; it would have been refused on 15-08-2026, a Mandatory holiday. Divya Raman\'s was rejected because she proposed no make-up day at all, so her 9.50 hours convert to Loss of Pay.')
        + `<div style="margin-top:12px;display:flex;gap:7px;flex-wrap:wrap">
             <button class="btn primary" data-go="leave.comp.add">${svg('plus', 14)} Request Compensatory Hours</button>
             <button class="btn" data-go="leave.comp">${svg('leave', 14)} Full queue with filters</button>
             <button class="btn" data-go="masters.workweek">${svg('masters', 14)} Compensation rules</button>
           </div>`;
    }

    if (active === 'biometric') {
      body = U.soon('Biometric / device feed — planned',
        'The hour basis above is live and already drives payroll: required hours come from the work-week policy, worked hours from recorded check-in and check-out less the break, and shortfalls convert to Loss of Pay. What is still to come is the automatic feed — a fingerprint or face device, or a push from an external HR system, writing those check-in and check-out times instead of Super Admin entering them by hand. The stored record does not change shape when that arrives; only the Recorded By source does.')
        + U.note('<b>What is planned is the input method, not the calculation.</b> Manual entry via Employee → Record Attendance writes to the same fields a device will, so nothing on the Monthly Summary, Day-wise Log or Payroll Impact tabs is waiting on hardware.')
        + U.card('Planned sources', '3 integration paths', mini([
          { k: 'src', t: 'Source', c: 'cell-strong' },
          { k: 'how', t: 'How it arrives' },
          { k: 'writes', t: 'Writes' },
          { k: 'status', t: 'Status', type: 'status' }
        ], [
          { src: 'Manual entry', how: 'Employee → Record Attendance (Super Admin)', writes: 'Check-In, Check-Out, Break', status: 'Live' },
          { src: 'Biometric device', how: 'Fingerprint / face terminal per office', writes: 'Check-In, Check-Out', status: 'Planned' },
          { src: 'External HR system', how: 'Scheduled push or API pull', writes: 'Check-In, Check-Out, Leave', status: 'Planned' },
          { src: 'Mobile check-in', how: 'Geo-fenced app check-in for field staff', writes: 'Check-In, Check-Out, Location', status: 'Planned' }
        ]));
    }

    return head + basis + fb + U.tabs(s.id, TABS, active) + body;
  };

})();
