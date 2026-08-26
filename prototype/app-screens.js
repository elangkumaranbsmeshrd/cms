/* ==========================================================================
   MESHRD CMS PROTOTYPE — SCREEN RENDERERS (part 1)
   Generic: list · dashboard · form · record · board · report · calendar
            checklist · conversation · feedpage · soon
   ========================================================================== */
(function () {
  'use strict';
  const C = window.CMS, D = C.D, U = window.U, R = window.RENDER;
  const svg = U.svg, esc = U.esc, inr = U.inr, inrAbbr = U.inrAbbr, S = U.S;

  const rowsOf = s => typeof s.rows === 'function' ? s.rows() : (D[s.rows] || []);

  /* ============================== LIST ============================== */
  R.list = function (s, role) {
    const all = rowsOf(s);
    const sc = U.scopeOf(s, role);
    const rows = U.applyScope(all, s.id, sc, role);
    const acts = (s.actions || []).filter(a => !a.roles || a.roles.indexOf(role) >= 0)
      .map(a => ({ label: a.label, cls: a.primary ? 'primary' : '', go: a.go, icon: a.primary ? 'plus' : 'download', toast: a.label + ' — opens the create form in the real system.' }));
    const head = U.pageHead(s, acts.concat([
      { label: 'Export PDF', icon: 'download', toast: 'Export to PDF — exactly the filtered, searched, sorted set on screen, with a header block naming the filters, result count, who exported it, and when.' },
      { label: 'Export Excel', icon: 'download', toast: 'Export to Excel — one row per record, columns matching the screen. Role scope applies identically: export is never a backdoor to more data than the screen shows.' }
    ]));
    const hiddenCols = (s.columns || []).filter(c => c.hideFrom && c.hideFrom.indexOf(role) >= 0);
    let note = '';
    if (hiddenCols.length) note = U.note(`<b>Layer 3 — field-level sensitivity.</b> ${hiddenCols.map(c => '<code>' + esc(c.t) + '</code>').join(' and ')} ${hiddenCols.length > 1 ? 'are' : 'is'} hidden from ${esc(C.ROLES[role].name)}, and the matching range filter goes with it. The field's visibility decides; the filter follows.`, 'warn');
    else if (sc !== 'all' && sc !== 'view') note = U.note(`<b>Layer 4 — scope.</b> This list is limited to <code>${esc(U.scopeLabel(sc, role))}</code> before any filter is applied. Filters operate strictly inside that set — a filter is a lens, never a key.`);
    return head + note + U.filterbar(s, role, rows.length, all.length) +
      `<div class="card rise"><div class="card-body flush">${U.table(s, rows, role)}</div>${rows.length ? U.pager(rows.length, all.length) : ''}</div>`;
  };

  /* ============================== DASHBOARD ============================== */
  function leaveCard() {
    const body = D.leaveBal.map(l => {
      const rem = l.allowed + l.cf - l.taken - l.pending;
      const pct = l.allowed ? Math.min(100, (l.taken / (l.allowed + l.cf)) * 100) : 0;
      return `<div class="meter-row" style="--tone:${l.tone}">
        <div class="meter-name">${esc(l.t)}</div>
        <div class="meter"><i style="width:${pct.toFixed(0)}%"></i></div>
        <div class="meter-val">${l.allowed ? `<b>${rem}</b><span> / ${l.allowed + l.cf}</span>` : '<span>Not tracked</span>'}</div></div>`;
    }).join('');
    return U.card('Leave Balance', 'FY 2026–27', body,
      `<span class="link" data-go="leave.my">My Leave ${svg('arrow', 12, 2.4)}</span><span style="margin-left:auto;font-size:11.5px;color:var(--text-tertiary)">Next holiday: <b style="color:var(--text-secondary)">15 Aug</b></span>`,
      `<button class="btn sm primary" data-go="leave.my">${svg('plus', 13)} Apply</button>`);
  }
  function payslipCard() {
    const p = D.payslip;
    const body = `<div class="payslip">
      <div class="payslip-top"><div class="per">${esc(p.period)} · Net Pay</div><div class="amt num">${inr(p.net)}</div></div>
      <div class="payslip-rows">
        <div class="pr"><span>Gross earnings</span><b>${inr(p.gross)}</b></div>
        <div class="pr ded"><span>Total deductions</span><b>− ${inr(p.deductions)}</b></div>
        <div class="pr"><span>Payable days</span><b>${p.days} / 30</b></div></div></div>`;
    return U.card('Latest Payslip', '', body,
      `<button class="btn sm" data-toast="Downloading the June 2026 payslip PDF, using the letterhead from Company Profile.">${svg('download', 13)} Download PDF</button><span class="link" style="margin-left:auto" data-go="payroll.mine">All payslips ${svg('arrow', 12, 2.4)}</span>`,
      `<span class="badge-s b-ok">${esc(p.status)}</span>`);
  }
  const myCounts = () => `<div class="grid g-3" style="margin-bottom:12px">
    ${U.ministat({ icon: 'ticket', tone: 'var(--danger)', bg: 'var(--danger-bg)', n: D.myTickets.length, l: 'Open tickets assigned to me', go: 'emp.tickets' })}
    ${U.ministat({ icon: 'project', tone: 'var(--info)', bg: 'var(--info-bg)', n: 7, l: 'Pending tasks assigned to me', go: 'emp.projects' })}
    ${U.ministat({ icon: 'asset', tone: 'var(--warning)', bg: 'var(--warning-bg)', n: D.myAssets.length, l: 'Assets assigned to me', go: 'emp.assets' })}</div>`;
  const activityCard = () => U.card('Recent Activity', 'System generated', `<div class="feed">${D.activity.map(U.feedItem).join('')}</div>`, `<span class="link" data-go="emp.announce">All notifications ${svg('arrow', 12, 2.4)}</span>`);
  const announceCard = () => U.card('Company Announcements', '', `<div class="feed">${D.announcements.map(a => U.feedItem({ ico: 'bell', tone: 'var(--accent)', bg: 'var(--accent-subtle)', t: a.t, m: a.m, pin: a.pin })).join('')}</div>`,
    `<span class="link" data-go="emp.announce">All announcements ${svg('arrow', 12, 2.4)}</span>`, `<span class="badge-s b-info">${D.announcements.length} active</span>`);
  function quickLinks(role) {
    const base = [['My Profile', 'employee', 'emp.profile'], ['My Leave', 'leave', 'leave.my'], ['My Payslips', 'payroll', 'payroll.mine'],
    ['My Documents', 'doc', 'emp.documents'], ['My Tickets', 'ticket', 'emp.tickets'], ['My Tasks', 'project', 'emp.projects'],
    ['My Assets', 'asset', 'emp.assets'], ['My Expenses', 'expense', 'exp.my'], ['Tax Declarations', 'invoice', 'emp.tax'],
    ['Holiday Calendar', 'leave', 'leave.holidays'], ['Timesheets', 'clock', 'proj.timesheets'], ['Announcements', 'bell', 'emp.announce']];
    return U.card('Quick Links', 'Self-service', `<div class="qlinks">${base.map(b => `<div class="qlink" data-go="${b[2]}">${svg(b[1], 14)} ${esc(b[0])}</div>`).join('')}</div>`);
  }
  function teamStrip() {
    const leave = D.leaveApprovals.filter(l => l.routed === 'Vikram Iyer');
    const c1 = U.card('Pending Leave Requests', '', `<div class="feed">${leave.map(t => `<div class="feed-item">
        <div class="feed-ico" style="--tone:var(--warning);--tone-bg:var(--warning-bg)">${svg('leave', 13)}</div>
        <div class="feed-body"><div class="feed-title">${esc(t.emp)}</div><div class="feed-meta">${esc(t.dates)} · ${esc(t.type)} · ${t.days}d</div></div>
        <div style="display:flex;gap:4px"><button class="btn sm ok" style="height:23px;padding:0 7px" data-toast="Approved. The applicant is notified and the days move from Pending to Taken.">Approve</button>
        <button class="btn sm no" style="height:23px;padding:0 7px" data-toast="Reject requires a reason — the applicant is notified with it.">Reject</button></div></div>`).join('')}</div>`,
      `<span class="link" data-go="leave.approvals">Leave Approvals ${svg('arrow', 12, 2.4)}</span>`, `<span class="badge-s b-warn">${leave.length}</span>`);
    const load = [['Sneha Pillai', 1], ['Rohit Deshmukh', 1], ['Ayesha Khan', 0], ['Karthik Nair', 2], ['Meera Joshi', 0]];
    const c2 = U.card('Team Ticket Load', '', load.map(([n, v]) => `<div class="meter-row" style="--tone:${v > 1 ? 'var(--danger)' : v ? 'var(--accent)' : 'var(--success)'}">
      <div class="meter-name">${esc(n.split(' ')[0])}</div><div class="meter"><i style="width:${v / 3 * 100}%"></i></div>
      <div class="meter-val"><b>${v}</b><span> open</span></div></div>`).join(''),
      `<span class="link" data-go="ticket.list">Ticket List — Team scope ${svg('arrow', 12, 2.4)}</span>`);
    const c3 = U.card('Team Payslip Status', 'June 2026', `<div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Status</th><th class="r">Net Pay</th></tr></thead>
      <tbody>${D.payrollRegister.slice(0, 5).map(t => `<tr><td>${esc(t.emp)}</td><td>${U.badge(t.status)}</td>
        <td class="r"><span class="masked" title="RBAC Layer 3 — 'Show Salary Amount to Manager' is OFF">${svg('lock', 11)} hidden</span></td></tr>`).join('')}</tbody></table></div>`,
      `<span style="font-size:11px;color:var(--text-tertiary);line-height:1.4">${svg('lock', 12)} Amounts hidden — <b>Show Salary Amount to Manager</b> is OFF (RBAC §2.1). The export matches the screen.</span>`);
    return `<div class="strip rise"><div class="strip-head"><span class="tag">Manager</span><h3>My Team</h3>
      <span style="font-size:11.5px;color:var(--text-secondary)">5 direct reports · Team scope</span>
      <button class="btn sm" style="margin-left:auto" data-go="emp.directory">${svg('eye', 13)} Team Directory</button></div>
      <div class="strip-grid">${c1}${c2}${c3}</div></div>`;
  }
  function financeKpis() {
    const f = D.finance;
    return `<div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'rupee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Total Invoiced', value: inrAbbr(f.invoiced), foot: inr(f.invoiced) + ' · 84 invoices', delta: '12.4%', dir: 'up', go: 'inv.list' })}
      ${U.kpi({ i: 1, icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Received', value: inrAbbr(f.received), foot: inr(f.received) + ' · 77% collected', delta: '8.1%', dir: 'up', go: 'inv.list' })}
      ${U.kpi({ i: 2, icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Outstanding', value: inrAbbr(f.outstanding), foot: inr(f.outstanding) + ' across 19 invoices', delta: '3.6%', dir: 'down', go: 'inv.list' })}
      ${U.kpi({ i: 3, icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Overdue Invoices', value: f.overdue, unit: 'invoices', foot: inr(2841700) + ' past due date', go: 'inv.list' })}</div>`;
  }
  function opsKpis() {
    const f = D.finance;
    return `<div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'expense', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Total Expenses', value: inrAbbr(f.expenses), foot: 'This financial year to date', delta: '5.2%', dir: 'up', go: 'exp.all' })}
      ${U.kpi({ i: 1, icon: 'project', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Active Projects', value: f.projects, unit: 'live', foot: '3 nearing milestone this week', go: 'proj.directory' })}
      ${U.kpi({ i: 2, icon: 'ticket', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Open Tickets', value: f.tickets, unit: 'open', foot: '6 unassigned · 2 breaching SLA', go: 'ticket.list' })}
      ${U.kpi({ i: 3, icon: 'employee', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Active Employees', value: f.employees, unit: 'active', foot: '3 onboarding · 1 exiting', go: 'emp.directory' })}</div>`;
  }
  function hrKpis() {
    return `<div class="grid g-kpi">
      ${U.kpi({ i: 0, icon: 'employee', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Active Employees', value: 148, unit: 'active', foot: 'Across 7 departments', go: 'emp.directory' })}
      ${U.kpi({ i: 1, icon: 'leave', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Leave Approvals', value: 7, unit: 'pending', foot: '2 awaiting HR co-approval', go: 'leave.approvals' })}
      ${U.kpi({ i: 2, icon: 'doc', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Docs to Verify', value: 6, unit: 'pending', foot: 'Oldest waiting 9 days', go: 'emp.docqueue' })}
      ${U.kpi({ i: 3, icon: 'employee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Onboarding / Exits', value: '3 / 1', foot: 'In progress right now', go: 'emp.onboardqueue' })}</div>`;
  }
  /* Money alignment is normalised centrally — see U.moneyAlign in app-core.js. */
  const tableCard = (title, sub, cols0, rows, foot, right) => ((cols => U.card(title, sub,
    `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th class="${c.th || ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
     <tbody>${rows.map(r => `<tr class="clickable" ${r.__go ? `data-go="${r.__go}"` : 'data-toast="Opening the record"'}>${cols.map(c => `<td class="${c.c || ''}">${U.cell(c, r, S.role)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, foot, right))(cols0.map(U.moneyAlign)));

  const overdueTable = () => tableCard('Overdue Invoices', 'Status ≠ Paid · Due date passed',
    [{ k: 'no', t: 'Invoice #', c: 'mono cell-accent' }, { k: 'cust', t: 'Customer' }, { k: 'bal', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'due', t: 'Due Date', c: 'mono' }, { k: 'over', t: 'Overdue', c: 'r', th: 'r', calc: r => r.over + ' days' }],
    D.invoices.filter(i => i.over > 0).map(r => Object.assign({ __go: 'inv.list' }, r)),
    `<span class="link" data-go="inv.list">View all 19 outstanding invoices ${svg('arrow', 12, 2.4)}</span><span style="margin-left:auto;font-size:11.5px;color:var(--text-tertiary)" class="mono">Showing 5 of 7</span>`,
    `<button class="btn sm ghost" data-toast="Export follows the filter.">${svg('download', 13)} Export</button>`);
  const paymentsTable = () => tableCard('Recent Payments', 'Last 7 days',
    [{ k: 'cust', t: 'Customer', c: 'cell-strong' }, { k: 'ref', t: 'Receipt', c: 'mono' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'mode', t: 'Mode', type: 'chip' }, { k: 'date', t: 'Date', c: 'mono' }],
    D.payments.map(r => Object.assign({ __go: 'inv.list' }, r)),
    `<span class="link" data-go="inv.payment">Record a payment ${svg('arrow', 12, 2.4)}</span>`);
  const hrQueueCard = () => tableCard('Onboarding & Exit Queue', 'HR cross-employee view',
    [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'dept', t: 'Department' }, { k: 'stage', t: 'Stage' }, { k: 'done', t: 'Progress', c: 'mono' }],
    D.onboardingQueue.map(r => ({ emp: r.emp, dept: r.dept, stage: 'Onboarding · ' + r.stuck, done: r.done, __go: 'emp.onboardqueue' }))
      .concat(D.exitQueue.filter(e => e.settle === 'Pending').map(r => ({ emp: r.emp, dept: r.dept, stage: 'Exit · ' + r.assets + ' assets outstanding', done: r.done, __go: 'emp.exitqueue' }))),
    `<span class="link" data-go="emp.onboardqueue">Onboarding ${svg('arrow', 12, 2.4)}</span><span class="link" style="margin-left:12px" data-go="emp.exitqueue">Exits ${svg('arrow', 12, 2.4)}</span>`);
  const expApprovalCard = () => tableCard('Expense Approvals', '',
    [{ k: 'emp', t: 'Employee', c: 'cell-strong', avatar: 1 }, { k: 'type', t: 'Type' }, { k: 'amt', t: 'Amount', type: 'money', c: 'r', th: 'r' }, { k: 'rcpt', t: 'Receipt', type: 'status' }],
    D.allExpenses.filter(e => e.status === 'Pending').map(r => Object.assign({ __go: 'exp.approvals' }, r)),
    `<span style="font-size:11px;color:var(--text-tertiary)">Rejection always requires a reason (platform-wide default)</span><span class="link" style="margin-left:auto" data-go="exp.approvals">Open queue ${svg('arrow', 12, 2.4)}</span>`,
    `<span class="badge-s b-warn">4 pending</span>`);
  const rbacStrip = () => `<div class="grid g-3" style="margin-bottom:18px">
    ${U.ministat({ icon: 'rbac', tone: 'var(--danger)', bg: 'var(--danger-bg)', n: '5', l: 'Roles configured · 4 with overrides', go: 'rbac.roles' })}
    ${U.ministat({ icon: 'employee', tone: 'var(--accent)', bg: 'var(--accent-subtle)', n: D.overrides.length, l: 'Individual permission overrides live', go: 'rbac.overrides' })}
    ${U.ministat({ icon: 'clock', tone: 'var(--info)', bg: 'var(--info-bg)', n: '3', l: 'Permission changes in the last 7 days', go: 'rbac.log' })}</div>`;

  R.dashboard = function (s, role) {
    const Rl = C.ROLES[role];
    const head = `<div class="page-head">
      <div><h1 class="page-title">Good afternoon, ${esc(Rl.who.split(' ')[0])}</h1>
      <p class="page-sub">Wednesday, 29 July 2026 · <b>${esc(Rl.name)}</b> — ${esc(Rl.scope)}</p></div>
      <div class="page-actions">${U.exportBtns('this dashboard')}
      <button class="btn primary" data-toast="Quick Create — a shortcut into the create form of any module this role can write to.">${svg('plus', 14)} Quick Create</button></div></div>`;
    const filters = U.filterbar({ id: 'dashboard', filters: [C.FIN_PRESETS, ['All Departments'].concat(C.DEPTS), ['All Statuses', 'Open', 'In Progress', 'Pending', 'Closed']], filterNames: ['Period', 'Department', 'Status'], scope: s.scope || (role === 'employee' ? { all: 'own' } : role === 'manager' ? { manager: 'team' } : null) }, role, role === 'employee' ? 8 : 24, role === 'employee' ? 8 : 312);
    let body = '';
    if (role === 'superadmin') {
      body = U.note(`<b>Super Admin</b> — every widget, every filter, unscoped. Financial, operational, people and RBAC panels are all visible; the <code>All financial years</code> option and <code>Created By / Last Modified By</code> filters appear here and nowhere else (RBAC §2.2e).`)
        + financeKpis() + opsKpis()
        + `<div class="grid g-8-4">${overdueTable()}${leaveCard()}</div>`
        + `<div class="grid g-8-4">${paymentsTable()}${announceCard()}</div>`
        + rbacStrip() + `<div class="grid g-2">${hrQueueCard()}${expApprovalCard()}</div>`;
    } else if (role === 'accountant') {
      body = U.note(`<b>Accountant</b> — Invoice, Expense, Purchase Bill, Vendor and Payroll, company-wide. Masters is visible but view-only on Taxes unless <code>Allow Accountant to Manage Taxes</code> is on. People screens like Onboarding are Hidden at Layer 1.`)
        + financeKpis()
        + `<div class="grid g-8-4">${overdueTable()}${payslipCard()}</div>`
        + `<div class="grid g-8-4">${paymentsTable()}${announceCard()}</div>` + expApprovalCard();
    } else if (role === 'hr') {
      body = U.note(`<b>HR</b> — people modules only. Revenue widgets are <b>not rendered at all</b> because <code>Show Non-Financial Dashboard Widgets to HR</code> is OFF: a hidden screen leaves no greyed-out placeholder and no URL to guess (RBAC Layer 1).`)
        + hrKpis()
        + `<div class="grid g-8-4">${hrQueueCard()}${leaveCard()}</div>`
        + `<div class="grid g-8-4">${activityCard()}${announceCard()}</div>`
        + `<div class="grid g-2">${U.card('Pending Approvals', 'Empty-state treatment', U.empty('Nothing waiting on you — nice and clear.', 'Every widget with no data says something friendly rather than showing an empty box.'))}${quickLinks(role)}</div>`;
    } else if (role === 'manager') {
      body = U.note(`<b>Manager</b> — own records plus direct reports (Layer 4 scope = <code>Team</code>). Salary amounts are masked by Layer 3. Invoice, Purchase Bill and Masters' finance sections are Hidden entirely, so they never appear in navigation.`)
        + myCounts() + `<div class="grid g-8-4">${payslipCard()}${leaveCard()}</div>` + teamStrip()
        + `<div class="grid g-2">${activityCard()}${announceCard()}</div>` + quickLinks(role);
    } else {
      body = U.note(`<b>Employee</b> — the most restrictive role, and the prototype's baseline. Layer 4 scope = <code>Own</code>: every list, count and export on this page is already limited to this person before any filter is applied (RBAC §2.2d).`)
        + `<div class="grid g-8-4">${payslipCard()}${leaveCard()}</div>` + myCounts()
        + `<div class="grid g-8-4">${activityCard()}${announceCard()}</div>` + quickLinks(role);
    }
    return head + filters + body;
  };

  /* ============================== FORMS ============================== */
  const FORMS = {
    ticket: {
      sections: [['Ticket Details', [
        { l: 'Customer', type: 'select', req: 1, opts: C.CUSTOMERS },
        { l: 'Category', type: 'select', opts: ['—'].concat(D.masters.ticketCategories.map(c => c.name)), hint: 'From Masters → Ticket Categories' },
        { l: 'Priority', type: 'select', req: 1, opts: ['Medium', 'Low', 'High', 'Urgent'], hint: 'Defaults to Medium' },
        { l: 'Subject', req: 1, span: 3, ph: 'Short summary of the issue', hint: '5–150 characters' },
        { l: 'Description', type: 'textarea', req: 1, span: 3 },
        { l: 'Assigned To', type: 'select', opts: ['Unassigned'].concat(C.PEOPLE), hint: 'Can be left blank and assigned later' },
        { l: 'Linked Project', type: 'select', opts: ['—'].concat(D.projects.map(p => p.name)), hint: 'Filtered to the selected customer\'s projects only' },
        { l: 'Ticket Number', v: 'TKT-2026-0913', ro: 1, hint: 'Auto-generated on save using the prefix from Company Profile' }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Ticket saved. Ticket Number TKT-2026-0913 assigned.' }, { l: 'Cancel' }],
      note: 'Ticket Number auto-generates as TKT-&lt;FY&gt;-0000 on save.'
    },
    reassign: {
      sections: [['Reassign TKT-2026-0912', [
        { l: 'Current Assignee', v: 'Arun Menon', ro: 1 },
        { l: 'New Assignee', type: 'select', req: 1, opts: C.PEOPLE },
        { l: 'Note', type: 'textarea', span: 3, ph: 'e.g. Reassigning — I\'m on leave next week' }
      ]]],
      buttons: [{ l: 'Reassign', cls: 'primary', toast: 'Reassigned. Both assignees are notified and an Assignment History entry is recorded on the ticket.' }, { l: 'Cancel' }],
      note: 'On save an Assignment History entry is recorded — Previous Assignee, New Assignee, Changed By, Date, Note.'
    },
    project: {
      sections: [['Project Details', [
        { l: 'Project Name', req: 1, span: 2, v: 'Trinetra Analytics Rollout', hint: '2–150 characters' },
        { l: 'Project Code', v: 'PRJ-2026-0001', ro: 1, hint: 'Auto-generated on save' },
        { l: 'Customer', type: 'select', req: 1, opts: C.CUSTOMERS },
        { l: 'Opportunity', type: 'select', opts: ['—'].concat(D.opportunities.map(o => o.title)), hint: 'Selecting one that is not already Won sets it to Won on save — the Won trigger, Path B' },
        { l: 'Status', type: 'select', req: 1, opts: ['In Progress', 'Not Started', 'On Hold', 'Completed'] },
        { l: 'Start Date', v: '01-05-2026' }, { l: 'End Date', v: '30-09-2026', hint: 'Must be after Start Date' },
        { l: 'Budget (₹)', v: '18,50,000', hint: 'Positive number if provided' },
        { l: 'Project Lead', type: 'select', req: 1, opts: C.PEOPLE, hint: 'Any employee of any system role can be Project Lead — unrelated to the Manager role' },
        { l: 'Members', type: 'select', span: 2, opts: ['Arun Menon, Sneha Pillai, Rohit Deshmukh, Ayesha Khan'] },
        { l: 'Description', type: 'textarea', span: 3 }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Project saved. The linked Opportunity was already Won, so nothing changed on it.' }, { l: 'Cancel' }]
    },
    opportunity: {
      sections: [['Opportunity', [
        { l: 'Title', req: 1, span: 2, v: 'Analytics add-on — Trinetra' },
        { l: 'Opportunity Code', v: 'OPP-2026-0001', ro: 1 },
        { l: 'Customer', type: 'select', req: 1, opts: C.CUSTOMERS },
        { l: 'Value (₹)', v: '18,50,000', hint: 'Positive number if provided' },
        { l: 'Stage', type: 'select', req: 1, opts: ['Proposal', 'Prospecting', 'Qualifying', 'Won', 'Lost'], hint: 'Moving to Lost prompts immediately for a required Reason' },
        { l: 'Probability (%)', v: '60', hint: 'Auto-suggested from Stage (10/30/60/100/0) and still manually editable' },
        { l: 'Expected Close Date', v: '30-08-2026' },
        { l: 'Owner', type: 'select', opts: ['Meera Joshi', 'Divya Raman'] },
        { l: 'Description', type: 'textarea', span: 3 }
      ]]],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Opportunity saved.' }, { l: 'Mark Lost', cls: 'no', go: 'opp.lost' }, { l: 'Cancel' }]
    },
    customer: {
      sections: [
        ['Company', [
          { l: 'Company Name', req: 1, span: 2, v: 'Trinetra Systems Pvt Ltd', hint: '2–200 characters' },
          { l: 'Customer Code', v: 'CUST-2026-0001', ro: 1 },
          { l: 'Display Name', v: 'Trinetra', hint: 'Defaults to Company Name if left blank' },
          { l: 'GSTIN', v: '33AABCT1234M1Z5', hint: 'Exactly 15 characters, auto-uppercased' },
          { l: 'PAN', v: 'AABCT1234M', hint: 'Exactly 10 characters' },
          { l: 'Status', type: 'select', req: 1, opts: ['Active', 'Prospect', 'Inactive'], hint: 'From Masters → Customer Status' },
          { l: 'Source', type: 'select', opts: D.masters.customerSource.filter(s => s.status === 'Active').map(s => s.name), hint: 'From Masters → Customer Source (Section 3.16) — where this customer first came from' },
          { l: 'Owner', type: 'select', opts: ['Meera Joshi', 'Divya Raman'] }
        ]],
        ['Contact', [
          { l: 'Mobile Number', v: '98410 22001', hint: '10-digit Indian mobile number' },
          { l: 'Email', v: 'priya.n@trinetra.in' },
          { l: 'Website', v: 'https://trinetra.in', hint: 'Must start with http:// or https://' },
          { l: 'Address', type: 'textarea', span: 3, v: 'No. 22, Anna Salai, Guindy, Chennai 600032' },
          { l: 'Notes', type: 'textarea', span: 3 }
        ]]
      ],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'Customer saved.' }, { l: 'Cancel' }]
    },
    payment: {
      sections: [['Record Payment — INV-2627-0138', [
        { l: 'Balance Due', v: '₹4,65,500', ro: 1, hint: 'Claim − Settled, where Claim is Grand Total less any approved Credit Notes, and Settled is Received + Withheld' },
        { l: 'Withheld So Far on this Invoice', v: '₹0 — nothing withheld on INV-2627-0138 yet', ro: 1, lock: 'From earlier payments', hint: 'Shown so whoever records a second payment sees why Balance Due sits below Claim − Received.' },
        { l: 'Amount Received (₹)', req: 1, ph: '0.00', hint: 'Money that actually arrived in the bank. Renamed from "Amount" — with a second money field beside it, "Amount" was ambiguous between what arrived and what was settled.' },
        /* Receipts-side heads only — a payments-side head governs what WE withhold
           from suppliers and must never be selectable against money coming in. */
        { l: 'Customer Withheld Tax', type: 'select', opts: ['— None —'].concat(D.masters.taxHeads.filter(t => /Withholding — On (Receipts|Payments &)/.test(t.scope) && t.force === 'In Force').map(t => t.name + ' (' + t.rate + ')')), hint: 'What the customer held back from this payment and will remit themselves. Discovered when a short payment arrives — never guessed on the invoice. Hidden entirely if no receipts-scope head is configured.' },
        { l: 'Withholding Calculated On', type: 'select', opts: ['Invoice Subtotal', 'Invoice Grand Total'], hint: 'Required once a withheld tax is selected. Defaults to Subtotal, same as Purchase Bill.' },
        { l: 'Withheld Amount (₹)', ph: '0.00', hint: 'Auto-suggested from the head against the chosen base, less anything already withheld on earlier payments — and still editable, because the customer\'s figure is the one that governs, not ours.' },
        { l: 'Amount Settled', v: '₹0.00', ro: 1, lock: 'Received + Withheld', hint: 'What comes off the invoice balance. Shown before you save, so you can see whether this closes the invoice: it reaches Paid when Received + Withheld equals the Claim.' },
        { l: 'Mode', type: 'select', req: 1, opts: D.masters.paymentMode.map(m => m.name), hint: 'From Masters → Payment Mode. This is the mode the money actually arrived by — the only place a payment mode is recorded, and deliberately not something guessed at invoice-creation time.' },
        /* Defaulted from the invoice's own Bank Account, but left editable and
           optional: money genuinely does land in a different account from the one
           printed on the invoice, and forcing a match would make the record lie. */
        { l: 'Received Into (Bank Account)', type: 'select', opts: [(D.invoices.find(i => i.no === 'INV-2627-0138') || {}).acc || '— None —'].concat(D.masters.bank.filter(b => b.status === 'Active').map(b => b.name).filter(n => n !== ((D.invoices.find(i => i.no === 'INV-2627-0138') || {}).acc))).concat(['— Not recorded —']), hint: 'Defaults to the account chosen when this invoice was created, and stays editable — a customer may well pay into a different Meshrd account than the one printed. Optional: leave it as "Not recorded" if the account is not known yet. This is the field the bank reconciliation matches on.' },
        { l: 'Date', req: 1, v: '29-07-2026' },
        { l: 'Reference', span: 2, ph: 'Transaction ID or cheque number' }
      ]]],
      buttons: [{ l: 'Record Payment', cls: 'primary', toast: 'Payment recorded. Paid and Balance update automatically; if Paid equals the Grand Total the invoice moves to Paid and locks.' }, { l: 'Cancel' }],
      note: 'Available only on an invoice with Status Sent or Part-Paid — never Draft.'
    },
    billpayment: {
      sections: [['Record Payment — PB-2026-0030', [
        { l: 'Balance Due', v: '₹56,000', ro: 1, hint: 'Measured against Amount Payable to Vendor, not the bill Total — on a bill with withholding, the net figure is the most that can still be paid' },
        { l: 'Withheld on this Bill', v: '₹0 — no withholding on PB-2026-0030', ro: 1, lock: 'Set on the bill', hint: 'Shown so whoever releases the payment can see why the payable figure differs from the bill total. Nothing here can change it — it is set on the bill itself. A bill reaches Paid once payments plus withholding equal the Total, so a withheld bill settles on a smaller payment than its total.' },
        { l: 'Amount (₹)', req: 1, ph: '0.00', hint: 'Cannot exceed the balance due of ₹56,000' },
        { l: 'Mode', type: 'select', req: 1, opts: D.masters.paymentMode.map(m => m.name) },
        { l: 'Paid From (Meshrd Account)', type: 'select', opts: D.masters.bank.filter(b => b.status === 'Active').map(b => b.name).concat(['— Not recorded —']), hint: 'Which company account the money left from. This is what fills the "Paid From" column on Vendor Usage, so a supplier\'s payment history can be reconciled account by account.' },
        { l: "Paid Into (Vendor's Account)", ro: 1, v: 'HDFC ••••2201', lock: 'From the vendor record', hint: 'The vendor\'s own bank account, carried through from Vendor → Bank Details. Read-only here — change it on the vendor record, not on a payment.' },
        { l: 'Date', req: 1, v: '29-07-2026' },
        { l: 'Reference', span: 2, ph: 'Transaction ID or cheque number' }
      ]]],
      buttons: [{ l: 'Record Payment', cls: 'primary', toast: 'Payment recorded against PB-2026-0030. Status moves to Paid once the balance clears.' }, { l: 'Cancel' }],
      note: 'Available only on a bill with Status Unpaid or Part-Paid. Multiple partial payments are supported.'
    },
    financialyear: {
      sections: [
        ['Enter', [
          { l: 'Start Date', req: 1, v: '01-04-2027', hint: 'Must be 1 April of a chosen year; dd-mm-yyyy. Financial Years cannot overlap each other.' }
        ]],
        ['Derived automatically — shown as a preview before saving', [
          { l: 'Financial Year Label', req: 1, v: '2027', ro: 1, lock: 'Auto-generated', hint: 'Auto-filled from the Start Date\'s year — "2027" for the year starting 01-Apr-2027. Not directly editable.' },
          { l: 'End Date', req: 1, v: '31-03-2028', ro: 1, lock: 'Auto-set', hint: 'Auto-set to 31 March of the following year once Start Date is chosen. Not independently editable.' },
          { l: 'Status', type: 'select', req: 1, opts: ['Open', 'Locked'], ro: 1, lock: 'Defaults to Open', hint: 'Defaults to "Open"; can only be changed to "Locked," never back.' },
          { l: 'Is Current Financial Year', type: 'toggle', on: 'No', ro: 1, lock: 'System-managed', hint: 'Only one Financial Year can be marked current at a time; managed automatically based on today\'s date.' },
          { l: 'Locked By', v: '—', ro: 1, lock: 'System', hint: 'Auto-filled with the user who locked it.' },
          { l: 'Locked On', v: '—', ro: 1, lock: 'System', hint: 'Auto-filled with the date/time it was locked.' }
        ]]
      ],
      buttons: [{ l: 'Save', cls: 'primary', toast: 'FY 2027 created — 01-04-2027 to 31-03-2028, Status Open.' }, { l: 'Cancel' }],
      note: 'Validation: Start Date must be 1 April; Financial Years cannot overlap. Once Status is set to Locked, every field on this record — and every record dated inside that year, in every module — becomes permanently read-only for all users, Super Admin included.'
    },
    creditnote: {
      sections: [['Credit Note', [
        { l: 'Original Invoice', v: 'INV-2627-0149 · Trinetra Systems Pvt Ltd', ro: 1, span: 2 },
        { l: 'Credit Note Number', v: 'CN-2026-0005', ro: 1, hint: 'A new numbering series, never reusing the Invoice Number' },
        { l: 'Reason', type: 'select', req: 1, opts: ['Billing Error', 'Customer Dispute', 'Goods or Service Not Delivered', 'Other'] },
        { l: 'Credit Amount (₹)', req: 1, v: '42,000', hint: 'Cannot exceed the original invoice Grand Total of ₹11,80,000' },
        { l: 'Line Items Affected', type: 'select', opts: ['—', 'Custom report pack — 6 reports', 'Implementation support — July 2026'], hint: 'Optional, for partial credits tied to specific items' },
        { l: 'Reason Detail', type: 'textarea', req: 1, span: 3, v: 'Two of the six report templates were billed in error — they were included in the original licence scope.' }
      ]]],
      buttons: [{ l: 'Save as Draft' }, { l: 'Submit for Approval', cls: 'primary', toast: 'Submitted. Super Admin approval is required before a Credit Note takes effect.' }, { l: 'Approve', toast: 'Approve is Super Admin only. Approving reduces the invoice\'s effective Outstanding balance without reopening the locked invoice.' }, { l: 'Download', icon: 'download' }],
      note: 'A Credit Note never edits the original invoice, which stays locked. It reduces what is owed; it does not move money.'
    }
  };
  /* Form definitions also come from app-forms.js (window.FORMS_EXT), which holds the
     per-spec Fields Tables for the Masters sub-masters and the other capture screens.
     Split out purely to keep this file readable — same shape, same renderer. */
  R.form = function (s, role) {
    const f = FORMS[s.form] || (window.FORMS_EXT || {})[s.form];
    if (!f) return U.pageHead(s) + U.card('Form', '', U.empty('This form is not defined in the prototype.'));
    return U.pageHead(s) + `<div class="card rise"><div class="card-body">
      ${f.sections.map(sec => U.section(sec[0], sec[1])).join('')}
      </div></div>` + U.formbar(f.note || '', f.buttons);
  };

  /* ============================== BOARD ============================== */
  R.board = function (s, role) {
    const isBug = s.board === 'bugs';
    const cols = isBug ? ['Open', 'In Progress', 'Fixed', 'Closed'] : ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'];
    const items = isBug ? D.bugs : D.tasks;
    const head = U.pageHead(s, [
      { label: isBug ? '+ Report Bug' : '+ Add Task', cls: 'primary', icon: 'plus', go: isBug ? 'proj.bugadd' : 'proj.task' },
      { label: 'Export PDF', icon: 'download', toast: 'A Kanban board does not export as a board — it exports as the flat list it is built from, one row per card with its column as the Status value.' }
    ]);
    const fb = U.filterbar({
      id: s.id, filters: isBug
        ? [['All Severities', 'Critical', 'High', 'Medium', 'Low'], ['All Statuses'].concat(cols), ['All Assignees'].concat(C.PEOPLE)]
        : [['All Assignees'].concat(C.PEOPLE), ['All Priorities', 'High', 'Medium', 'Low'], ['All Sprints'].concat(D.sprints.map(x => x.name))],
      filterNames: isBug ? ['Severity', 'Status', 'Assignee'] : ['Assignee', 'Priority', 'Sprint']
    }, role, items.length, items.length);
    const proj = `<div class="rec-head rise"><div class="rec-avatar">${svg('project', 20)}</div>
      <div><div class="rec-id">PRJ-2026-0001</div><div class="rec-name">Trinetra Analytics Rollout</div>
      <div class="rec-meta"><span>Trinetra Systems Pvt Ltd</span><span class="dot"></span><span>Lead: Vikram Iyer</span><span class="dot"></span>${U.badge('In Progress')}</div></div>
      <div class="rec-actions">
        <button class="btn ${!isBug ? 'primary' : ''}" data-go="proj.board">${svg('kanban', 14)} Tasks</button>
        <button class="btn ${isBug ? 'primary' : ''}" data-go="proj.bugs">${svg('alert', 14)} Bugs</button>
        <button class="btn" data-go="proj.sprints">Sprints</button>
        <button class="btn" data-go="proj.milestones">Milestones</button>
        <button class="btn" data-go="proj.timesheets">Timesheets</button>
        ${role === 'superadmin' || role === 'manager' ? `<button class="btn" data-go="proj.report">Report</button>` : ''}
      </div></div>`;
    const board = `<div class="board ${isBug ? 'c4' : 'c5'}">${cols.map(cn => {
      const list = items.filter(i => i.s === cn);
      return `<div class="bcol"><div class="bcol-head"><span class="nm">${esc(cn)}</span><span class="cnt">${list.length}</span>
        <span class="add" data-toast="Add a card to ${esc(cn)}">${svg('plus', 14, 2.2)}</span></div>
        <div class="bcol-body">${list.length ? list.map(i => `<div class="tcard" data-go="proj.task">
          <div class="tid">${esc(i.id)}</div><div class="tt">${esc(i.t)}</div>
          ${!isBug && i.sprint && i.sprint !== '—' ? `<div style="display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--accent);margin:2px 0">${svg('play', 10, 2.4)} ${esc(i.sprint.replace(/ —.*$/, ''))}</div>` : ''}
          <div class="tm">${isBug ? U.badge(i.sev) : U.badge(i.pri)}
            <span class="mini-av" title="${esc(i.a)}">${U.initials(i.a === 'Unassigned' ? '?' : i.a)}</span>
            <span class="due ${i.over ? 'over' : ''}">${esc(i.due)}</span></div></div>`).join('')
          : `<div style="padding:14px 6px;text-align:center;font-size:11.5px;color:var(--text-tertiary)">No ${isBug ? 'bugs' : 'tasks'} here.</div>`}
        </div></div>`;
    }).join('')}</div>`;
    return head + proj + fb + board;
  };

  /* ============================== REPORT ============================== */
  const REPORTS = {
    leave: {
      kpis: [{ icon: 'leave', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Leave Liability', value: '412', unit: 'days', foot: 'Unused leave across every active employee' },
      { icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Days Taken (FY)', value: '284', unit: 'days', foot: 'Approved requests only' },
      { icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Pending Requests', value: '7', unit: 'requests', foot: 'Materially changes a liability figure' },
      { icon: 'employee', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Avg Days / Employee', value: '19.2', unit: 'days', foot: 'Across 148 active employees' }],
      tables: [
        { t: 'Leave taken by Type', cols: ['Leave Type', 'Days Taken', 'Requests', 'Employees'], rows: [['Casual Leave', 96, 62, 74], ['Sick Leave', 71, 55, 61], ['Earned Leave', 88, 24, 33], ['Comp Off', 12, 12, 9], ['Work From Home', 17, 14, 11]] },
        { t: 'Leave taken by Department', cols: ['Department', 'Days Taken', 'Employees', 'Avg / Employee'], rows: [['Engineering', 118, 46, '2.6'], ['Sales', 52, 22, '2.4'], ['Support', 41, 18, '2.3'], ['Accounts', 28, 12, '2.3'], ['Human Resources', 21, 9, '2.3'], ['Design', 24, 11, '2.2']] },
        { t: 'Leave taken by Employee', cols: ['Employee', 'Department', 'Days Taken', 'Requests', 'Remaining'], rows: [['Ayesha Khan', 'Design', 9.5, 5, 11], ['Sneha Pillai', 'Engineering', 7, 4, 6.5], ['Rohit Deshmukh', 'Engineering', 6, 3, 9], ['Karthik Nair', 'Support', 5, 4, 12], ['Meera Joshi', 'Sales', 4, 2, 13]] }
      ]
    },
    asset: {
      kpis: [{ icon: 'asset', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Total Assets', value: '10', unit: 'records', foot: '7 In Use · 1 In Store · 1 Under Repair' },
      { icon: 'rupee', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Total Purchase Value', value: inrAbbr(749500), foot: inr(749500) + ' across all categories' },
      { icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Current Value', value: inrAbbr(486083), foot: 'Straight Line, as of FY 2026–27' },
      { icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Warranty Due (90d)', value: '2', unit: 'assets', foot: '1 maintenance entry overdue' }],
      tables: [
        { t: 'Count and value by Category', cols: ['Category', 'Number of Assets', 'Total Purchase Value', 'Total Current Value'], rows: [['Laptop', 4, '₹4,29,000', '₹2,66,083'], ['Monitor', 1, '₹48,000', '₹33,600'], ['Networking', 1, '₹1,26,000', '₹84,000'], ['Furniture', 1, '₹42,000', '₹35,000'], ['Printer', 1, '₹34,000', '₹20,400'], ['Mobile', 1, '₹61,000', '₹40,667'], ['Peripheral', 1, '₹9,500', '₹6,333']] },
        { t: 'Warranty or maintenance due soon', cols: ['Asset Tag', 'Name', 'Due Type', 'Date'], rows: [['AST-2026-0003', 'Dell UltraSharp U2723QE', 'Maintenance — overdue', '02-07-2026'], ['AST-2026-0002', 'Dell Latitude 5440', 'Warranty expiry', '04-06-2026'], ['AST-2026-0004', 'iPhone 14 (Test Device)', 'Warranty expiry', '01-02-2026']] }
      ]
    },
    ticket: {
      kpis: [{ icon: 'ticket', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Open + In Progress', value: '5', unit: 'tickets', foot: '2 unassigned' },
      { icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Resolved / Closed', value: '5', unit: 'tickets', foot: 'In the selected date range' },
      { icon: 'clock', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Avg First Response', value: '1h 32m', foot: 'Raised Date → first Public Reply' },
      { icon: 'refresh', tone: 'var(--info)', bg: 'var(--info-bg)', label: 'Avg Resolve Time', value: '2d 4h', foot: 'Raised Date → Resolved / Closed' }],
      tables: [
        { t: 'Ticket count by Status', cols: ['Status', 'Count', 'Share'], rows: [['Open', 2, '20%'], ['In Progress', 3, '30%'], ['Resolved', 2, '20%'], ['Closed', 3, '30%']] },
        { t: 'Ticket count by Priority', cols: ['Priority', 'Count', 'Share'], rows: [['Urgent', 2, '20%'], ['High', 3, '30%'], ['Medium', 3, '30%'], ['Low', 2, '20%']] },
        { t: 'Top customers by ticket volume', cols: ['Customer', 'Ticket Count', 'Open'], rows: [['Trinetra Systems Pvt Ltd', 2, 1], ['Kaveri Infotech LLP', 2, 1], ['Aarohi Retail Solutions', 1, 1], ['Nandan Logistics', 1, 1], ['Sahyadri Foods Pvt Ltd', 1, 0]] }
      ]
    },
    project: {
      kpis: [{ icon: 'kanban', tone: 'var(--accent)', bg: 'var(--accent-subtle)', label: 'Total Tasks', value: '10', foot: '2 Done · 3 In Progress' },
      { icon: 'alert', tone: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Open Bugs', value: '4', foot: '1 Critical · 2 High' },
      { icon: 'clock', tone: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Overdue Tasks', value: '1', foot: 'Past Due Date, not Done' },
      { icon: 'check', tone: 'var(--success)', bg: 'var(--success-bg)', label: 'Milestones Reached', value: '2 / 5', foot: '1 missed · 2 upcoming' }],
      tables: [
        { t: 'Tasks by Status', cols: ['Status', 'Count'], rows: [['Backlog', 2], ['To Do', 3], ['In Progress', 2], ['In Review', 1], ['Done', 2]] },
        { t: 'Bugs by Severity', cols: ['Severity', 'Count'], rows: [['Critical', 2], ['High', 2], ['Medium', 2], ['Low', 1]] },
        { t: 'Bugs by Status', cols: ['Status', 'Count'], rows: [['Open', 2], ['In Progress', 2], ['Fixed', 2], ['Closed', 1]] }
      ]
    }
  };
  R.report = function (s, role) {
    const rp = REPORTS[s.report] || REPORTS.leave;
    const head = U.pageHead(s, [{ label: 'Download Report', icon: 'download', toast: 'Report downloaded. Every export from a reports screen carries a header block stating the filters, the result count, who exported it, and when.' },
    { label: 'Export PDF', icon: 'download', toast: 'Export to PDF.' }, { label: 'Export Excel', icon: 'download', toast: 'Export to Excel.' }]);
    const fb = U.filterbar({ id: s.id, filters: [C.FIN_PRESETS, ['All Departments'].concat(C.DEPTS), ['All Statuses']], filterNames: ['Period', 'Department', 'Status'], scope: s.scope }, role, 24, 312);
    const kpis = `<div class="grid g-kpi">${rp.kpis.map((k, i) => U.kpi(Object.assign({ i: i }, k))).join('')}</div>`;
    /* Report rows are plain arrays with no column types, so money is detected from
       the values themselves: a column whose cells carry ₹ is left-aligned, matching
       U.moneyAlign everywhere else. Counts and averages stay right-aligned. */
    const moneyCol = (t, i) => t.rows.some(r => /₹/.test(String(r[i])));
    const tables = `<div class="grid g-2">${rp.tables.map(t => U.card(t.t, '',
      `<div class="table-wrap"><table><thead><tr>${t.cols.map((c, i) => `<th class="${i && !moneyCol(t, i) ? 'r' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
       <tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${!i ? 'cell-strong' : moneyCol(t, i) ? 'num' : 'r num'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      `<button class="btn sm ghost" data-toast="Download this view, filtered exactly as shown.">${svg('download', 13)} Download this view</button>`)).join('')}</div>`;
    return head + U.note('<b>All filters apply across every view on this screen simultaneously</b>, so switching view never silently changes the underlying set — a figure that quietly reflects a different filter than the table beside it would be worse than no figure at all.') + fb + kpis + tables;
  };

  /* ============================== CALENDAR ============================== */
  R.calendar = function (s, role) {
    const acts = s.editable && (role === 'superadmin' || role === 'manager')
      ? [{ label: '+ Add Holiday', cls: 'primary', icon: 'plus', go: 'masters.holidays.add' },
         { label: 'Bulk Import', icon: 'upload', go: 'masters.holidays.import' }]
      : [];
    const head = U.pageHead(s, acts.concat([{ label: 'Export PDF', icon: 'download', toast: 'A printable holiday calendar for the selected year.' }, { label: 'Export Excel', icon: 'download', toast: 'Export to Excel.' }]));
    const fb = U.filterbar({ id: s.id, filters: [['All Months', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Mar'], ['FY 2026–27', 'FY 2025–26'], ['All Types', 'Mandatory', 'Optional']], filterNames: ['Month', 'Financial Year', 'Type'] }, role, D.holidays.length, D.holidays.length);
    const months = [];
    D.holidays.forEach(h => { let m = months.find(x => x.m === h.m); if (!m) { m = { m: h.m, days: [] }; months.push(m); } m.days.push(h); });
    const view = S.view[s.id] || 'cal';
    const switcher = `<div class="seg" style="margin-bottom:12px"><button class="${view === 'cal' ? 'on' : ''}" data-view="${s.id}:cal">${svg('grid', 13)} Calendar</button><button class="${view === 'list' ? 'on' : ''}" data-view="${s.id}:list">${svg('list', 13)} List</button></div>`;
    const body = view === 'cal'
      ? `<div class="cal">${months.map(m => `<div class="cal-month"><h5>${esc(m.m)} 2026–27</h5>
          ${m.days.map(h => `<div class="cal-day"><div class="cal-date"><span class="d">${h.d}</span><span class="m">${esc(h.m)}</span></div>
          <div class="cal-name">${esc(h.name)}<span class="sub">${esc(h.day)}</span></div>
          <span class="badge-s ${h.type === 'Mandatory' ? 'b-danger' : 'b-outline'}">${esc(h.type)}</span></div>`).join('')}</div>`).join('')}</div>`
      : U.card('Holiday List', 'FY 2026–27', `<div class="table-wrap"><table><thead><tr><th>Holiday Name</th><th>Date</th><th>Day</th><th>Type</th></tr></thead>
        <tbody>${D.holidays.map(h => `<tr><td class="cell-strong">${esc(h.name)}</td><td class="mono">${esc(h.date)}</td><td>${esc(h.day)}</td>
        <td><span class="badge-s ${h.type === 'Mandatory' ? 'b-danger' : 'b-outline'}">${esc(h.type)}</span></td></tr>`).join('')}</tbody></table></div>`);
    const note = s.editable ? '' : U.note('<b>Read-only for all five roles.</b> This calendar is sourced entirely from Masters → Holidays and is not editable here. All five roles get the identical filter set — the same company-wide data, so there is no scoping difference to reflect.');
    return head + note + fb + switcher + body;
  };

  /* ============================== CHECKLIST ============================== */
  R.checklist = function (s, role) {
    const items = D[s.list] || [];
    const done = items.filter(i => i.done).length;
    const head = U.pageHead(s, [{ label: 'Send Welcome Email', icon: 'mail', toast: 'Welcome email sent, with a checklist pointing at My Documents.' },
    { label: 'Export PDF', icon: 'download', toast: 'Export to PDF.' }]);
    const rec = `<div class="rec-head rise"><div class="rec-avatar">${U.initials(s.subject)}</div>
      <div><div class="rec-id">${esc(s.id === 'emp.onboarding' ? 'Onboarding' : 'Exit')}</div>
      <div class="rec-name">${esc(s.subject)}</div><div class="rec-meta"><span>${esc(s.subjectSub)}</span></div></div>
      <div class="rec-summary"><div class="s"><div class="l">Progress</div><div class="v num">${done} / ${items.length}</div></div>
      <div class="s"><div class="l">Status</div><div class="v">${U.badge(done === items.length ? 'Completed' : 'In Progress')}</div></div></div>
      <div class="rec-actions"><button class="btn" data-go="${s.id === 'emp.onboarding' ? 'emp.onboardqueue' : 'emp.exitqueue'}">${svg('list', 14)} All employees</button>
      <button class="btn" data-go="emp.record">${svg('employee', 14)} Open record</button></div></div>`;
    /* A step naming a `gate` cannot be actioned until that step is Done. This is
       what makes the exit order real rather than advisory — asset return stays
       shut until the resignation letter exists, and settlement/login/status stay
       shut until every asset is back. */
    const doneNames = items.filter(i => i.done).map(i => i.t);
    const blockedBy = i => (i.gate && doneNames.indexOf(i.gate) < 0) ? i.gate : null;
    const body = `<div class="checklist">${items.map((i, n) => {
      const blk = i.done ? null : blockedBy(i);
      return `<div class="ck ${i.done ? 'done' : ''}${blk ? ' blocked' : ''}">
      <div class="ck-box">${i.done ? svg('check', 12, 3) : blk ? svg('lock', 11) : `<span style="font-size:9.5px;font-weight:700;color:var(--text-tertiary)">${n + 1}</span>`}</div>
      <div class="ck-body"><div class="ck-title">${esc(i.t)}</div><div class="ck-desc">${esc(i.d)}</div>
        ${blk ? `<div class="ck-desc" style="color:var(--warning);margin-top:3px"><b>Blocked</b> — “${esc(blk)}” has to be done first.</div>` : ''}</div>
      <div class="ck-act">${i.done ? `<span class="badge-s b-ok">Done</span>`
        : blk ? `<span class="badge-s b-warn">${svg('lock', 10)} Locked</span>`
          : (i.go ? `<button class="btn sm" data-go="${i.go}">Open</button>` : '')
          + `<button class="btn sm" data-toast="${esc(i.t)} — marked complete. Most steps auto-check when the linked action completes elsewhere.">Mark done</button>`}</div></div>`;
    }).join('')}</div>`;
    const blockedCount = items.filter(i => !i.done && blockedBy(i)).length;
    const foot = done === items.length ? `<span class="badge-s b-ok">All steps complete</span>`
      : `<span style="font-size:11.5px;color:var(--text-tertiary)">${items.length - done} step${items.length - done > 1 ? 's' : ''} outstanding${blockedCount ? `, ${blockedCount} still locked behind an earlier step` : ''}. Steps auto-check when the linked action completes in its own module.</span>`;
    return head + rec + U.card(s.id === 'emp.onboarding' ? 'Onboarding Checklist' : 'Exit Checklist', items.length + ' steps', body, foot);
  };

  /* ============================== CONVERSATION ============================== */
  R.conversation = function (s, role) {
    const t = D.tickets[0];
    const head = U.pageHead(s, [{ label: 'Reassign', icon: 'employee', go: 'ticket.assign' }, { label: 'Export PDF', icon: 'download', toast: 'Export this conversation to PDF.' }]);
    const rec = `<div class="rec-head rise"><div class="rec-avatar" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-line)">${svg('ticket', 20)}</div>
      <div><div class="rec-id">${esc(t.no)}</div><div class="rec-name">${esc(t.subj)}</div>
      <div class="rec-meta"><span class="link" data-go="cust.360">${esc(t.cust)}</span><span class="dot"></span>${U.badge(t.pri)}<span class="dot"></span>${U.badge(t.status)}
      <span class="dot"></span><span>Assigned to <b>${esc(t.to)}</b></span><span class="dot"></span><span class="badge-s b-info">First response ${esc(t.frt)}</span></div></div>
      <div class="rec-actions">
        <select class="fselect" style="height:30px" data-toast="Status changed. The first Public Reply on an Open ticket moves it to In Progress automatically."><option>In Progress</option><option>Open</option><option>Resolved</option><option>Closed</option></select>
        <button class="btn" data-go="ticket.assign">${svg('employee', 14)} Reassign</button>
        <button class="btn no" data-go="ticket.close">Close ticket</button>
      </div></div>`;
    const thread = D.conversation.map(m => `<div class="msg ${m.type === 'Internal Note' ? 'internal' : ''}">
      <div class="msg-av">${esc(m.init)}</div>
      <div class="msg-body"><div class="msg-head"><b>${esc(m.who)}</b>
        <span class="badge-s ${m.type === 'Internal Note' ? 'b-warn' : 'b-info'}">${esc(m.type)}</span>
        <span class="when">${esc(m.when)}</span></div>
        <div class="msg-text">${esc(m.text)}</div></div></div>`).join('');
    const composer = `<div class="composer">
      <div class="composer-head">
        <label style="font-size:11.5px;font-weight:600;color:var(--text-secondary);margin:0">Entry Type <span class="req">*</span></label>
        <div class="seg"><button class="on">${svg('send', 12)} Public Reply</button><button class="warn">${svg('lock', 12)} Internal Note</button></div>
        <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">Notes are never emailed — but mis-marking an entry is the real risk, so this control is deliberately hard to miss.</span>
      </div>
      <div class="composer-body">
        <div class="field" style="margin-bottom:0">
          <label>Content <span class="req">*</span></label>
          <textarea class="input" placeholder="Write your reply…" style="min-height:74px"></textarea>
        </div>
      </div>
      <div class="composer-foot">
        <span style="font-size:11.5px;font-weight:600;color:var(--text-secondary)">Attachment</span>
        <button class="btn sm" data-toast="Attachment — PDF/JPG/PNG up to 5 MB.">${svg('upload', 13)} Attach</button>
        <button class="btn primary" style="margin-left:auto" data-toast="Sent as a Public Reply. First-Response Time is captured on the first public reply, and an Open ticket moves to In Progress at the same moment.">${svg('send', 13)} Send</button>
      </div></div>`;
    return head + rec + `<div class="grid g-8-4">
      ${U.card('Conversation', D.conversation.length + ' entries', thread + '<div style="height:14px"></div>' + composer)}
      <div>
        ${U.card('Assignment History', '', `<div class="timeline" style="padding:4px 0 4px 26px">
          <div class="tl-item"><div class="tl-dot" style="--tone:var(--accent);--tone-bg:var(--accent-subtle)">${svg('employee', 11)}</div>
            <div class="tl-head"><span class="who">Arun Menon</span><span class="when">28-07 09:20</span></div>
            <div class="tl-body">Assigned by Vikram Iyer — "Arun owns the SSO work."</div></div>
          <div class="tl-item"><div class="tl-dot" style="--tone:var(--text-tertiary);--tone-bg:var(--neutral-bg)">${svg('plus', 11)}</div>
            <div class="tl-head"><span class="who">Unassigned</span><span class="when">28-07 09:14</span></div>
            <div class="tl-body">Ticket raised by Priya Nandakumar.</div></div></div>`)}
        <div style="height:12px"></div>
        ${U.card('Linked', '', `<div class="qlinks">
          <div class="qlink" data-go="cust.360">${svg('customer', 14)} Customer 360</div>
          <div class="qlink" data-go="proj.board">${svg('project', 14)} PRJ-2026-0003</div>
          <div class="qlink" data-go="ticket.list">${svg('ticket', 14)} All tickets</div></div>`)}
      </div></div>`;
  };

  /* ============================== FEED PAGE ============================== */
  R.feedpage = function (s, role) {
    const tab = S.tab[s.id] || 'notif';
    const head = U.pageHead(s, (role === 'superadmin' || role === 'hr') ? [{ label: '+ Post Announcement', cls: 'primary', icon: 'plus', go: 'emp.postannounce' }] : []);
    const tabs = U.tabs(s.id, [{ k: 'notif', l: 'My Notifications', n: D.notifs.filter(n => n.u).length }, { k: 'ann', l: 'Announcements', n: D.announcements.length }], tab);
    const fb = U.filterbar({
      id: s.id, filters: tab === 'notif'
        ? [['All Types', 'Leave', 'Document', 'Payslip', 'Ticket', 'Task', 'Asset', 'Profile change'], ['All', 'Unread', 'Read'], C.FIN_PRESETS]
        : [['All Posters', 'HR', 'Accounts', 'Operations'], ['All Scopes', 'All Employees'].concat(C.DEPTS), ['Active', 'Expired', 'All']],
      filterNames: tab === 'notif' ? ['Type', 'Read/Unread', 'Period'] : ['Posted By', 'Post To', 'Active/Expired']
    }, role, tab === 'notif' ? D.notifs.length : D.announcements.length, tab === 'notif' ? D.notifs.length : D.announcements.length);
    const body = tab === 'notif'
      ? U.card('My Notifications', 'Generated automatically by events elsewhere in the system',
        `<div class="feed">${D.notifs.map(U.feedItem).join('')}</div>`,
        `<span class="link" data-toast="All notifications marked read.">Mark all as read</span><span style="margin-left:auto;font-size:11px;color:var(--text-tertiary)">Personal notifications are deliberately <b>not</b> exportable — they are transient UI state, not a business record.</span>`)
      : U.card('Company Announcements', 'Posted by HR and Super Admin',
        `<div class="feed">${D.announcements.map(a => U.feedItem({ ico: 'bell', tone: 'var(--accent)', bg: 'var(--accent-subtle)', t: a.t, m: a.m, pin: a.pin })).join('')}</div>`,
        U.exportBtns('the announcements list'));
    return head + tabs + fb + body;
  };

  /* ============================== SOON ============================== */
  R.soon = function (s) { return U.pageHead(s) + U.soon(s.soon.t, s.soon.p); };
})();
