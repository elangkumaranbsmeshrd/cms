/* ==========================================================================
   MESHRD CMS PROTOTYPE — CORE
   Icons, formatters, state, RBAC engine, router, shell, login.
   Screen renderers live in app-screens.js (registered onto window.RENDER).
   ========================================================================== */
(function () {
  'use strict';
  const C = window.CMS, D = C.D;

  /* ---------------- ICONS ---------------- */
  const I = {
    dash: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 15h7v6H3z"/>',
    masters: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    employee: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    asset: '<path d="m21 16-9 5-9-5V8l9-5 9 5z"/><path d="m3.3 7.5 8.7 5 8.7-5M12 21v-8.5"/>',
    ticket: '<path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6"/><path d="M13 5v2M13 11v2M13 17v2"/>',
    leave: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>',
    payroll: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    vendor: '<path d="M10 17h4V5H2v12h3M14 9h5l3 4v4h-3"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
    customer: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/>',
    opp: '<path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/>',
    project: '<rect x="3" y="3" width="6" height="14" rx="1"/><rect x="11" y="3" width="6" height="9" rx="1"/><rect x="19" y="3" width="2" height="18" rx="1"/>',
    invoice: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
    expense: '<path d="M4 2v20l2.5-1.6L9 22l2.5-1.6L14 22l2.5-1.6L19 22V2l-2.5 1.6L14 2l-2.5 1.6L9 2 6.5 3.6z"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    purchase: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M1 2h3.5l2.4 12h11.4l2-8H6"/>',
    rbac: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    arrow: '<path d="M9 18l6-6-6-6"/>', check: '<path d="m4 12 5 5L20 6"/>',
    rupee: '<path d="M6 3h12M6 8h12M16.5 3c0 5-3.5 5-6 5h-.5l7 13"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    eye: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
    kanban: '<rect x="3" y="3" width="6" height="14" rx="1"/><rect x="11" y="3" width="6" height="9" rx="1"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    tag: '<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'
  };
  const svg = (k, s, w) => `<svg width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.9}" stroke-linecap="round" stroke-linejoin="round">${I[k] || ''}</svg>`;

  /* ---------------- FORMATTERS ---------------- */
  function inrAbbr(n) {
    const sg = n < 0 ? '-' : ''; n = Math.abs(n);
    if (n >= 100000) return sg + '₹' + (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return sg + '₹' + (n / 1000).toFixed(1) + 'K';
    return sg + '₹' + n;
  }
  function inr(n) {
    if (n === null || n === undefined || n === '' || n === '—') return '—';
    const neg = n < 0; const s = Math.round(Math.abs(n)).toString();
    const l3 = s.slice(-3), rest = s.slice(0, -3);
    return (neg ? '-' : '') + '₹' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + l3 : l3);
  }
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const initials = n => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const badgeCls = v => C.BADGE[v] || 'b-neutral';

  /* ---------------- STATE ---------------- */
  const S = { authed: false, role: 'superadmin', route: 'dashboard', theme: 'light', accent: 'blue', customAccent: '#2a4bd7', scale: 110, collapsed: false, open: {}, tab: {}, view: {} };

  /* Accent palette — each entry pre-tuned for both themes so switching light/dark
     never has to recompute a color, just look up the other half of the same row. */
  const ACCENTS = {
    blue:   { name: 'Blue (default)', light: { accent: '#2a4bd7', hover: '#1f3ab0', subtle: '#eaeeff', line: '#c3cffb' }, dark: { accent: '#7592ff', hover: '#8fa6ff', subtle: '#18203a', line: '#2c3a63' } },
    purple: { name: 'Purple',         light: { accent: '#7c3aed', hover: '#6425d1', subtle: '#f2ebfe', line: '#d8c2fb' }, dark: { accent: '#a78bfa', hover: '#b79cfc', subtle: '#241a3d', line: '#3d2e5c' } },
    green:  { name: 'Green',          light: { accent: '#059669', hover: '#047857', subtle: '#e6f7f1', line: '#b9e8d6' }, dark: { accent: '#34d399', hover: '#4ade80', subtle: '#103328', line: '#1f4d3c' } },
    amber:  { name: 'Amber',          light: { accent: '#d97706', hover: '#b45309', subtle: '#fef3e2', line: '#fbd9a5' }, dark: { accent: '#fbbf24', hover: '#fcd34d', subtle: '#3a2a0d', line: '#5c4318' } },
    rose:   { name: 'Rose',           light: { accent: '#e11d48', hover: '#be123c', subtle: '#fde8ec', line: '#f9c2ce' }, dark: { accent: '#fb7185', hover: '#fda4af', subtle: '#3a1620', line: '#5c2432' } },
    teal:   { name: 'Teal',           light: { accent: '#0d9488', hover: '#0f766e', subtle: '#e3f6f4', line: '#a8e0da' }, dark: { accent: '#2dd4bf', hover: '#5eead4', subtle: '#0f2e2b', line: '#1b4842' } }
  };
  window.ACCENTS = ACCENTS;

  /* ---------------- SCREEN INDEX ---------------- */
  const SCREENS = {};
  const OWNER = {};
  C.MODULES.forEach(m => m.screens.forEach(s => { SCREENS[s.id] = s; OWNER[s.id] = m; }));

  function canSee(s, role) { return !s.roles || s.roles.indexOf(role) >= 0; }
  function scopeOf(s, role) {
    if (!s.scope) return 'all';
    if (s.scope[role]) return s.scope[role];
    if (s.scope.all) return s.scope.all;
    return 'all';
  }
  function scopeLabel(sc, role) {
    if (sc === 'own') return 'Own records';
    if (sc === 'team') return role === 'manager' ? 'My team (5)' : 'Team';
    if (sc === 'view') return 'View only';
    return 'Company-wide';
  }
  function visibleModules(role) {
    return C.MODULES.map(m => {
      const sc = m.screens.filter(s => canSee(s, role));
      return sc.length ? Object.assign({}, m, { screens: sc }) : null;
    }).filter(Boolean);
  }
  function firstVisible(role) {
    const m = visibleModules(role); return m.length ? m[0].screens[0].id : 'dashboard';
  }

  /* ---------------- SCOPE FILTERING (RBAC Layer 4) ---------------- */
  const TEAM = D.team.map(e => e.name).concat(['Vikram Iyer']);
  /* ---------------- SCOPE RULES (RBAC Layer 4) ----------------
     Explicit per-screen membership rules. The previous version guessed the
     person-column from a fixed list of names and silently returned EVERY row when
     it guessed wrong — which is why an Employee could see all 8 projects. Rules are
     now declared per screen, and anything unresolved is recorded in
     window.SCOPE_UNRESOLVED so a test can fail on it instead of it passing quietly.

     Each rule: (row, me, teamNames) -> boolean. `me` is the signed-in person's name. */
  const memberOf = (r, me) => (r.members || []).indexOf(me) >= 0;
  const SCOPE_RULES = {
    /* Employee §2.1 — Manager sees direct reports plus self; Employee sees only self. */
    'emp.directory': { team: (r, me) => r.mgr === me || r.name === me, own: (r, me) => r.name === me },
    /* Project §2.1 — "Employee sees only projects they're a team member on."
       Team membership = Project Lead OR one of the Members. */
    'proj.directory': { own: (r, me) => r.lead === me || memberOf(r, me) },
    'proj.timesheets': { own: (r, me) => r.person === me },
    /* Ticket §2.1 — Employee sees only tickets assigned to them. */
    'ticket.list': { own: (r, me) => r.to === me },
    'emp.tickets': { own: (r, me) => r.to === me },
    /* Asset §2.1 — Manager is scoped to their direct reports' assets. */
    'asset.directory': { team: (r, me, team) => team.indexOf(r.to) >= 0, own: (r, me) => r.to === me },
    'asset.maintenance': { team: () => true },
    'asset.requests': { team: (r, me, team) => team.indexOf(r.emp) >= 0 },
    'emp.assets': { own: (r, me) => r.to === me },
    /* Leave §2.2 — a Manager's queue is their own direct reports' requests. */
    'leave.approvals': { team: (r, me, team) => team.indexOf(r.emp) >= 0 },
    /* Payroll §2.3 — Team Payslips, direct reports only. */
    'payroll.team': { team: (r, me, team) => team.indexOf(r.emp) >= 0 },
    /* Self-service lists are already one person's own records. */
    'emp.projects': { own: () => true },
    'emp.documents': { own: () => true },
    'exp.my': { own: () => true },
    'payroll.mine': { own: () => true },
    'leave.my': { own: () => true },
  };
  window.SCOPE_UNRESOLVED = [];

  function applyScope(rows, sid, sc, role) {
    if (sc === 'all' || sc === 'view') return rows;
    const me = C.ROLES[role].who;
    const rule = SCOPE_RULES[sid] && SCOPE_RULES[sid][sc];
    if (rule) return rows.filter(r => rule(r, me, TEAM));
    /* No rule for a screen that declares this scope — record it rather than
       silently handing back the full, unscoped set. */
    if (rows.length) window.SCOPE_UNRESOLVED.push(sid + ':' + sc);
    return rows;
  }

  /* ---------------- SHARED UI BUILDERS ---------------- */
  const U = {
    svg: svg, inr: inr, inrAbbr: inrAbbr, esc: esc, initials: initials, badgeCls: badgeCls,
    S: S, SCREENS: SCREENS, OWNER: OWNER, scopeOf: scopeOf, scopeLabel: scopeLabel, applyScope: applyScope, TEAM: TEAM,

    pageHead(s, extraActions) {
      const role = S.role;
      const RB = window.RBAC;
      /* Drop every action this role may not perform here (RBAC Layer 2). */
      const acts = (extraActions || [])
        .filter(a => !RB || RB.can(role, s.id, a.label))
        .map(a => `<button class="btn ${a.cls || ''}" ${a.go ? `data-go="${a.go}"` : `data-toast="${esc(a.toast || a.label)}"`}>${a.icon ? svg(a.icon, 14) : ''} ${esc(a.label)}</button>`).join('');
      /* A read-only grant should be legible, not just silently missing buttons. */
      const m = RB ? RB.mode(role, s.id) : 'full';
      const roBadge = (m === 'view' || m === 'view:team')
        ? ` <span class="badge-s b-warn" title="${esc(C.ROLES[role].name)} is view-only on this screen — every field is locked and no mutating action is offered">Read-only</span>` : '';
      return `<div class="page-head">
        <div>
          <h1 class="page-title">${esc(s.label)} <span class="spec-ref">${esc(s.ref || '')}</span>${roBadge}</h1>
          ${s.desc ? `<p class="page-sub">${s.desc}</p>` : ''}
        </div>
        <div class="page-actions">${acts}</div>
      </div>`;
    },

    exportBtns(label) {
      return `<button class="btn" data-toast="Exporting ${esc(label || 'this list')} to PDF — exactly the filtered set on screen, with a header block naming the filters, the result count, who exported it, and when.">${svg('download', 14)} Export PDF</button>
              <button class="btn" data-toast="Exporting ${esc(label || 'this list')} to Excel — one row per record, columns matching the screen.">${svg('download', 14)} Export Excel</button>`;
    },

    filterbar(s, role, shown, total) {
      const names = s.filterNames || [];
      const hide = (s.hideFilterFor && s.hideFilterFor[role]) || [];
      const opts = (s.filters || []).map((o, i) => hide.indexOf(i) >= 0 ? '' :
        `<select class="fselect" title="${esc(names[i] || '')}" data-toast="Filter applied: ${esc(names[i] || 'filter')}">${o.map((v, j) => `<option${j === 0 ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`).join('');
      const sc = scopeOf(s, role);
      const chips = [{ k: 'Period', v: 'This Financial Year' }, { k: 'Scope', v: scopeLabel(sc, role) }];
      if (role === 'superadmin') chips.push({ k: 'Super Admin', v: 'All filters, unscoped' });
      const hidden = hide.length ? `<span style="font-size:11px;color:var(--text-tertiary);margin-left:4px">${hide.length} filter${hide.length > 1 ? 's' : ''} hidden — the dimension is meaningless at this scope (§2.2b)</span>` : '';
      return `<div class="filterbar rise">
        <div class="filter-row">
          <div class="searchbox" style="width:216px">
            <span class="s-icon">${svg('search', 14, 2)}</span>
            <input type="text" placeholder="Search…" style="padding-right:10px">
          </div>
          ${opts}${hidden}
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn sm" data-toast="Export follows the filter — PDF of exactly what is on screen.">${svg('download', 13)} PDF</button>
            <button class="btn sm" data-toast="Export follows the filter — Excel of exactly what is on screen.">${svg('download', 13)} Excel</button>
          </div>
        </div>
        <div class="chips">
          ${chips.map(c => `<span class="chip">${c.k}: <b>${esc(c.v)}</b><span class="rm" data-toast="Filter removed. Applied filters always show as removable chips.">×</span></span>`).join('')}
          <span class="clear" data-toast="All filters cleared.">Clear all</span>
          <span class="count">Showing ${shown} of ${total}</span>
        </div>
      </div>`;
    },

    empty(msg, hint) {
      return `<div class="empty"><div class="ico">${svg('smile', 18)}</div><p>${esc(msg)}</p>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
    },

    note(html, kind) { return `<div class="rbac-note ${kind || ''}">${svg('info', 14)}<div>${html}</div></div>`; },

    badge(v) { return `<span class="badge-s ${badgeCls(v)}">${esc(v)}</span>`; },
    chip(v) { return `<span class="badge-s b-neutral plain">${esc(v)}</span>`; },

    cell(col, row, role) {
      let v = col.calc ? col.calc(row) : row[col.k];
      if (col.type === 'status') return v === undefined || v === '—' ? '—' : U.badge(v);
      if (col.type === 'chip') return v ? U.chip(v) : '—';
      if (col.type === 'money') return v === 0 ? '<span style="color:var(--text-tertiary)">₹0</span>' : inr(v);
      if (col.type === 'masked') return `<span class="masked" title="${esc(col.maskNote || 'Hidden by a field-level permission')}">${svg('lock', 11)} hidden</span>`;
      if (v === undefined || v === null || v === '') return '—';
      if (col.avatar) return `<span style="display:inline-flex;align-items:center;gap:7px"><span class="mini-av">${initials(v)}</span>${esc(v)}</span>`;
      return esc(v);
    },

    /* SINGLE CONTROL POINT FOR MONEY ALIGNMENT — amounts are LEFT-aligned.
       Every table builder (U.table, and the `mini`/`tableCard` helpers in the two
       screen files) maps its columns through this, so alignment is decided in one
       place instead of drifting screen by screen the way it did before. A masked
       money column is normalised identically, so hiding an amount from a role never
       shifts that column's layout. To switch the whole product back to right-aligned
       amounts, append ' r' here instead of stripping it. */
    moneyAlign(c) {
      const isMoney = c.type === 'money'
        || (c.type === 'masked' && /amount|total|value|salary|net|pay|balance|cost|price/i.test(c.t));
      if (!isMoney) return c;
      return Object.assign({}, c, {
        c: (c.c || '').replace(/\br\b/g, '').replace(/\s+/g, ' ').trim(),
        th: (c.th || '').replace(/\br\b/g, '').replace(/\s+/g, ' ').trim()
      });
    },

    table(s, rows, role) {
      const RB = window.RBAC;
      /* Column-level masking: data.js hideFrom, plus the policy's field rules so a
         toggle-governed column (Purchase Value, Net Pay, vendor GSTIN) disappears
         for the right role without every screen restating the rule. */
      const cols = (s.columns || []).filter(c => {
        if (c.hideFrom && c.hideFrom.indexOf(role) >= 0) return false;
        if (RB && RB.fieldMode(role, s.id, c.t) === 'hidden') return false;
        return true;
      }).map(c => (RB && RB.fieldMode(role, s.id, c.t) === 'masked' && c.type !== 'masked')
        ? Object.assign({}, c, { type: 'masked', maskNote: RB.lockReason(role, s.id, c.t) })
        : c)
        .map(U.moneyAlign);
      const ra = (s.rowActions || [])
        .filter(a => typeof a === 'string' || !a.roles || a.roles.indexOf(role) >= 0)
        .filter(a => !RB || RB.can(role, s.id, typeof a === 'string' ? a : a.l));
      if (!rows.length) return U.empty(s.empty || 'No records found.', 'No records match the filters currently applied. Clear them to see everything you have access to.');
      return `<div class="table-wrap"><table>
        <thead><tr>${cols.map(c => `<th class="${c.th || ''}">${esc(c.t)}</th>`).join('')}${ra.length ? '<th class="r">Actions</th>' : ''}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="${s.rowGo ? 'clickable' : ''}" ${s.rowGo ? `data-go="${s.rowGo}"` : ''}>
          ${cols.map(c => `<td class="${c.c || ''}">${U.cell(c, r, role)}</td>`).join('')}
          ${ra.length ? `<td><div class="row-actions">${ra.map(a => {
            const l = typeof a === 'string' ? a : a.l, cls = typeof a === 'string' ? '' : (a.c || '');
            /* A row action carrying `go` navigates to its own screen. It deliberately
               omits data-stop: closest() finds this button before the row, so the
               action's target wins over the row-click target. */
            if (typeof a === 'object' && a.go) return `<button class="btn sm ${cls}" data-go="${a.go}">${esc(l)}</button>`;
            return `<button class="btn sm ${cls}" data-stop data-toast="${esc(l)} — ${esc(l)} recorded on this row. In the real system this writes an audit entry.">${esc(l)}</button>`;
          }).join('')}</div></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>`;
    },

    pager(shown, total) {
      return `<div class="pager"><span>Rows per page</span>
        <select class="fselect" style="height:24px" data-toast="Page size changed."><option>25</option><option>10</option><option>50</option><option>100</option></select>
        <span class="mono">Showing 1–${shown} of ${total}</span>
        <div class="pages">
          <button class="pg" data-toast="Previous page">‹</button>
          <button class="pg on">1</button><button class="pg" data-toast="Page 2">2</button><button class="pg" data-toast="Next page">›</button>
        </div></div>`;
    },

    kpi(o) {
      return `<div class="kpi rise" style="--tone:${o.tone};--tone-bg:${o.bg};animation-delay:${(o.i || 0) * 35}ms" ${o.go ? `data-go="${o.go}"` : `data-toast="${esc(o.label)}"`}>
        <div class="kpi-top"><div class="kpi-ico">${svg(o.icon, 14)}</div><div class="kpi-label">${esc(o.label)}</div></div>
        <div class="kpi-val num">${o.value}${o.unit ? `<small> ${esc(o.unit)}</small>` : ''}</div>
        <div class="kpi-foot">${o.delta ? `<span class="delta ${o.dir}">${o.dir === 'up' ? '▲' : '▼'} ${o.delta}</span>` : ''}<span>${esc(o.foot || '')}</span></div>
      </div>`;
    },

    ministat(o) {
      return `<div class="ministat" style="--tone:${o.tone};--tone-bg:${o.bg}" ${o.go ? `data-go="${o.go}"` : `data-toast="${esc(o.l)}"`}>
        <div class="ico">${svg(o.icon, 15)}</div>
        <div><div class="n num">${o.n}</div><div class="l">${esc(o.l)}</div></div>
        <div class="go">${svg('arrow', 14, 2.2)}</div></div>`;
    },

    feedItem(o) {
      return `<div class="feed-item" style="--tone:${o.tone};--tone-bg:${o.bg}" data-toast="Opening the linked record">
        ${o.u ? '<span class="unread"></span>' : ''}
        <div class="feed-ico">${svg(o.ico, 13)}</div>
        <div class="feed-body"><div class="feed-title">${o.t}</div>
          <div class="feed-meta">${o.pin ? '<span class="pin">Pinned</span>' : ''}<span>${esc(o.m)}</span></div></div></div>`;
    },

    /* Every field passes through the access policy for the ACTIVE screen and role.
       Reading S.route/S.role here rather than requiring callers to thread `role`
       through is deliberate: it is what makes a renderer that ignores its own
       `role` argument still emit correctly restricted output. */
    field(f) {
      const RB = window.RBAC;
      if (RB && S.route) {
        const m = RB.fieldMode(S.role, S.route, f.l);
        if (m === 'hidden') return '';
        if (m === 'masked') {
          return `<div class="field">
            <label>${esc(f.l)}</label>
            <div><span class="masked" title="${esc(RB.lockReason(S.role, S.route, f.l) || 'Hidden by a field-level permission')}">${svg('lock', 11)} hidden</span></div>
            ${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
        }
        if (m === 'read' && !f.ro) {
          f = Object.assign({}, f, { ro: 1, lock: f.lock || RB.lockReason(S.role, S.route, f.l) || 'Read-only' });
        }
      }
      const ro = f.ro ? ' ro' : '';
      let ctl;
      if (f.type === 'select') ctl = `<select class="input"${f.ro ? ' disabled' : ''}>${(f.opts || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>`;
      else if (f.type === 'textarea') ctl = `<textarea class="input" placeholder="${esc(f.ph || '')}"${f.ro ? ' disabled' : ''}>${esc(f.v || '')}</textarea>`;
      else if (f.type === 'toggle') ctl = `<span class="toggle ${f.v ? 'on' : ''}" data-toggle><span class="track"></span><span class="tl">${esc(f.on || 'Enabled')}</span></span>`;
      else if (f.type === 'file') ctl = `<button class="btn" style="width:100%;justify-content:center" data-toast="File picker — PDF/JPG/PNG up to 5 MB.">${svg('upload', 14)} ${esc(f.v || 'Choose file')}</button>`;
      else if (f.type === 'checkgroup') ctl = `<div class="checklist" style="border:1px solid var(--border);border-radius:var(--r-md)">${(f.opts || []).map(o => {
        const on = (f.checked || []).indexOf(o.v || o) >= 0;
        const label = o.l || o;
        return `<div class="ck ${on ? 'done' : ''}" data-toast="${esc(label)} ${on ? 'removed from' : 'added to'} the sprint.">
          <div class="ck-box">${on ? svg('check', 12, 3) : ''}</div><div class="ck-body"><div class="ck-title">${esc(label)}</div></div></div>`;
      }).join('')}</div>`;
      else ctl = `<input class="input" value="${esc(f.v || '')}" placeholder="${esc(f.ph || '')}"${f.ro ? ' disabled' : ''}>`;
      return `<div class="field${ro} ${f.span ? 'span' + f.span : ''}">
        <label>${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}${f.lock ? `<span class="field-lock">${svg('lock', 10)} ${esc(f.lock)}</span>` : ''}</label>
        ${ctl}${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
    },

    section(title, fields, note, cols) {
      return `<div class="form-section">
        <div class="form-section-head"><h4>${esc(title)}</h4>${note ? `<span class="note">${note}</span>` : ''}</div>
        <div class="form-grid${cols === 2 ? ' two' : ''}">${fields.map(U.field).join('')}</div></div>`;
    },

    formbar(note, buttons) {
      const RB = window.RBAC;
      const allowed = (buttons || []).filter(b => !RB || RB.can(S.role, S.route, b.l));
      const m = RB ? RB.mode(S.role, S.route) : 'full';
      const roNote = (m === 'view' || m === 'view:team')
        ? `<span class="note">${esc(C.ROLES[S.role].name)} is view-only on this screen — no save action is offered.</span>` : '';
      return `<div class="formbar">
        <span class="note">${note || ''}</span>${roNote}
        ${allowed.map(b => {
        /* A form button carrying `go` navigates (e.g. Stage → Lost opens the
           required-reason prompt); everything else reports what it would do. */
        const hook = b.go ? `data-go="${b.go}"` : `data-toast="${esc(b.toast || b.l + ' — recorded.')}"`;
        return `<button class="btn ${b.cls || ''}" ${hook}>${b.icon ? svg(b.icon, 14) : ''} ${esc(b.l)}</button>`;
      }).join('')}
      </div>`;
    },

    tabs(id, list, active) {
      return `<div class="tabs">${list.map(t => `<div class="tab ${t.k === active ? 'on' : ''}" data-tab="${id}:${t.k}">${esc(t.l)}${t.n !== undefined ? `<span class="cnt">${t.n}</span>` : ''}</div>`).join('')}</div>`;
    },

    card(title, sub, body, foot, right) {
      return `<div class="card rise">
        <div class="card-head"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${right ? `<div class="right">${right}</div>` : ''}</div>
        <div class="card-body${body.indexOf('<table') >= 0 || body.indexOf('class="feed"') >= 0 || body.indexOf('checklist') >= 0 ? ' flush' : ''}">${body}</div>
        ${foot ? `<div class="card-foot">${foot}</div>` : ''}</div>`;
    },

    soon(t, p) {
      return `<div class="soon rise"><div class="ico">${svg('clock', 20)}</div><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`;
    },

    toast(msg, kind) {
      const w = document.getElementById('toasts');
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.innerHTML = svg(kind === 'ok' ? 'check' : 'info', 15) + '<span>' + esc(msg) + '</span>';
      w.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(16px)'; setTimeout(() => el.remove(), 220); }, 3600);
    }
  };
  window.U = U; window.RENDER = {};

  /* ---------------- NAVIGATION ---------------- */
  function renderNav() {
    /* Settings is deliberately excluded from the module tree — it already has a
       fixed, always-visible link at the bottom-left of the sidebar (index.html's
       .nav-foot) plus an entry in the profile menu. A third copy inside the
       Administration group would just be the same screen listed twice at once. */
    const role = S.role, mods = visibleModules(role).filter(m => m.id !== 'settings');
    const groups = [];
    mods.forEach(m => { let g = groups.find(x => x.g === m.group); if (!g) { g = { g: m.group, mods: [] }; groups.push(g); } g.mods.push(m); });
    let h = '';
    groups.forEach(g => {
      h += `<div class="nav-label">${esc(g.g)}</div>`;
      g.mods.forEach(m => {
        const isActive = m.screens.some(s => s.id === S.route);
        if (m.single) {
          h += `<div class="nav-item ${isActive ? 'active' : ''}" data-go="${m.screens[0].id}" title="${esc(m.label)}">${svg(m.icon, 16)}<span class="txt">${esc(m.label)}</span></div>`;
          return;
        }
        const open = S.open[m.id] || isActive;
        let badgeTotal = 0, hot = 0;
        m.screens.forEach(s => { const b = C.BADGES[s.id] && C.BADGES[s.id][role]; if (b) { if (typeof b === 'object') { badgeTotal += b.n; hot = 1; } else badgeTotal += b; } });
        h += `<div class="nav-item ${isActive ? 'active' : ''} ${open ? 'open' : ''}" data-mod="${m.id}" title="${esc(m.label)} — ${m.screens.length} screens">
          ${svg(m.icon, 16)}<span class="txt">${esc(m.label)}</span>
          ${badgeTotal ? `<span class="badge${hot ? ' hot' : ''}">${badgeTotal}</span>` : ''}
          <span class="chev">${svg('arrow', 12, 2.4)}</span></div>`;
        h += `<div class="subnav" style="${open ? '' : 'display:none'}">`;
        /* Screens flagged navHidden are create/action forms reached from a button on
           their parent screen ("+ Add Expense Type", "Adjust Balance", …). They stay
           fully routable — and still appear here while active, so the sidebar never
           loses its place — but they don't pad the tree with 40+ entries. */
        m.screens.filter(s => !s.navHidden || s.id === S.route).forEach(s => {
          let b = C.BADGES[s.id] && C.BADGES[s.id][role], bh = 0;
          if (b && typeof b === 'object') { bh = b.hot; b = b.n; }
          h += `<div class="sub-item ${s.id === S.route ? 'active' : ''}" data-go="${s.id}" title="${esc(s.label)} — ${esc(s.ref || '')}">
            <span class="txt">${esc(s.label)}</span>${b ? `<span class="badge${bh ? ' hot' : ''}">${b}</span>` : ''}</div>`;
        });
        h += `</div>`;
      });
    });
    document.getElementById('nav').innerHTML = h;
  }

  /* ---------------- CRUMB ---------------- */
  function renderCrumb() {
    const s = SCREENS[S.route], m = OWNER[S.route];
    if (!s) return;
    const parts = [`<a data-go="dashboard">Meshrd CMS</a>`, `<span class="sep">/</span>`];
    if (m && !m.single) parts.push(`<a data-mod-go="${m.id}">${esc(m.label)}</a>`, `<span class="sep">/</span>`);
    parts.push(`<b>${esc(s.label)}</b>`);
    document.getElementById('crumb').innerHTML = parts.join('');
  }

  /* ---------------- RENDER ROUTE ---------------- */
  function renderRoute() {
    const role = S.role;
    let s = SCREENS[S.route];
    if (!s || !canSee(s, role)) {
      const canS = s && !canSee(s, role);
      const target = canS ? firstVisible(role) : 'dashboard';
      document.getElementById('canvas').innerHTML = `
        <div class="page-head"><div><h1 class="page-title">Screen not available</h1>
        <p class="page-sub">${canS ? `<b>${esc(SCREENS[S.route].label)}</b> is Hidden for the ${esc(C.ROLES[role].name)} role at Layer 1. A hidden screen leaves no greyed-out menu item and no URL to guess — this page exists only because you arrived by a direct link.` : 'That screen does not exist in this prototype.'}</p></div></div>
        <div class="card"><div class="card-body">${U.empty('Nothing to show here.', 'Use the sidebar, or switch roles from the header to see it as a role that can.')}
        <div style="text-align:center;margin-top:4px"><button class="btn primary" data-go="${target}">Go to ${esc(SCREENS[target].label)}</button></div></div></div>`;
      renderNav(); return;
    }
    const fn = window.RENDER[s.type] || window.RENDER.list;
    let html = '';
    try { html = fn(s, role); }
    catch (e) { html = U.pageHead(s) + `<div class="card"><div class="card-body">${U.empty('This screen failed to render.', String(e.message || e))}</div></div>`; }
    const c = document.getElementById('canvas');
    c.innerHTML = html;
    document.querySelector('.canvas').scrollTop = 0;
    renderNav(); renderCrumb();
  }

  /* ---------------- ROLE ---------------- */
  function setRole(role, silent) {
    S.role = role;
    const R = C.ROLES[role];
    document.getElementById('roleVal').textContent = R.name;
    document.getElementById('roleDot').style.background = R.color;
    document.getElementById('avatarEl').textContent = R.init;
    if (!canSee(SCREENS[S.route] || {}, role)) S.route = 'dashboard';
    if (!canSee(SCREENS[S.route], role)) S.route = firstVisible(role);
    renderRoleMenu(); renderUserMenu(); renderRoute();
    if (!silent) U.toast('Now viewing as ' + R.name + ' — ' + R.who + '. Navigation, widgets, actions and scope all redrawn.', 'ok');
  }
  function renderRoleMenu() {
    document.getElementById('roleMenuList').innerHTML = Object.keys(C.ROLES).map(k => {
      const r = C.ROLES[k], n = visibleModules(k).reduce((a, m) => a + m.screens.length, 0);
      return `<div class="menu-item ${k === S.role ? 'on' : ''}" data-role="${k}">
        <span class="role-dot" style="background:${r.color}"></span>
        <span style="min-width:0"><b>${esc(r.name)}</b><span class="mi-sub">${esc(r.who)} · ${n} screens · ${esc(r.scope)}</span></span>
        <span class="check">${svg('check', 13, 2.6)}</span></div>`;
    }).join('');
  }
  function renderUserMenu() {
    const R = C.ROLES[S.role];
    document.getElementById('userMenu').innerHTML = `
      <div style="padding:9px 10px 8px;display:flex;gap:9px;align-items:center;border-bottom:1px solid var(--hairline);margin-bottom:4px">
        <span class="avatar" style="width:32px;height:32px;font-size:11.5px">${esc(R.init)}</span>
        <span style="min-width:0"><b style="font-size:12.5px;display:block">${esc(R.who)}</b>
        <span style="font-size:11px;color:var(--text-tertiary)">${esc(R.email)}</span></span>
      </div>
      <div class="menu-item" data-go="emp.profile">${svg('employee', 15)} My Profile</div>
      <div class="menu-item" data-go="emp.documents">${svg('doc', 15)} My Documents</div>
      <div class="menu-item" data-go="emp.announce">${svg('bell', 15)} Announcements</div>
      ${S.role === 'superadmin' ? `<div class="menu-item" data-go="settings">${svg('settings', 15)} Settings</div>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-item" data-theme-toggle>${svg(S.theme === 'dark' ? 'sun' : 'moon', 15)} Switch to ${S.theme === 'dark' ? 'light' : 'dark'} theme</div>
      <div class="menu-sep"></div>
      <div class="menu-item danger" data-logout>${svg('logout', 15)} Log out</div>`;
  }

  /* ---------------- THEME + ACCENT + SCALE (in-memory only, never persisted) ----------------
     Every one of these writes an inline custom property on <html>, which beats the
     stylesheet's own [data-theme] values — that is what lets a live change survive a
     theme switch without recomputing anything. */

  /* Derive a full 4-colour accent ramp from any single hex the user picks, so the
     colour wheel is not limited to the six presets. Tints are mixed toward white on
     light and toward the canvas on dark, matching how the presets were hand-tuned. */
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function rampFrom(hex, dark) {
    const base = hexRgb(hex), white = [255, 255, 255], black = [0, 0, 0];
    return dark
      ? { accent: toHex(mix(base, white, .22)), hover: toHex(mix(base, white, .38)),
          subtle: toHex(mix(base, hexRgb('#0a0c11'), .84)), line: toHex(mix(base, hexRgb('#0a0c11'), .66)) }
      : { accent: hex, hover: toHex(mix(base, black, .22)),
          subtle: toHex(mix(base, white, .90)), line: toHex(mix(base, white, .68)) };
  }
  function applyAccent() {
    const dark = S.theme === 'dark';
    const pal = S.accent === 'custom'
      ? rampFrom(S.customAccent, dark)
      : (ACCENTS[S.accent] || ACCENTS.blue)[dark ? 'dark' : 'light'];
    const root = document.documentElement.style;
    root.setProperty('--accent', pal.accent);
    root.setProperty('--accent-hover', pal.hover);
    root.setProperty('--accent-subtle', pal.subtle);
    root.setProperty('--accent-line', pal.line);
  }
  function setTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('themeIcon').innerHTML = t === 'dark' ? I.sun : I.moon;
    applyAccent();
    renderUserMenu();
    if (S.route === 'settings' && S.authed) renderRoute();
  }
  function setAccent(name) {
    if (name !== 'custom' && !ACCENTS[name]) return;
    S.accent = name;
    applyAccent();
    if (S.route === 'settings' && S.authed) renderRoute();
  }
  /* The colour wheel. Sets the accent to a free hex and switches the mode to custom,
     so a preset is never left looking selected while a different colour is applied. */
  function setCustomAccent(hex, rerender) {
    if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(hex))) return;
    S.customAccent = String(hex).charAt(0) === '#' ? hex : '#' + hex;
    S.accent = 'custom';
    applyAccent();
    if (rerender && S.route === 'settings' && S.authed) renderRoute();
  }

  /* Display scale — the whole app zooms, the way the browser's own zoom does, so a
     user on a large or high-density screen can size the interface without every
     screen needing its own responsive breakpoints. 110% is the default because that
     is the size this prototype was reviewed and signed off at. */
  const SCALES = [90, 100, 110, 125, 150];
  function setScale(n) {
    n = Math.max(80, Math.min(200, parseInt(n, 10) || 100));
    S.scale = n;
    document.body.style.zoom = (n / 100).toFixed(2);
    if (S.route === 'settings' && S.authed) renderRoute();
  }
  window.setTheme = setTheme;
  window.setAccent = setAccent;
  window.setCustomAccent = setCustomAccent;
  window.setScale = setScale;
  window.SCALES = SCALES;

  /* ---------------- NOTIFICATIONS ---------------- */
  function renderNotif(tab) {
    document.getElementById('notifList').innerHTML = tab === 'ann'
      ? D.announcements.map(a => U.feedItem({ ico: 'bell', tone: 'var(--accent)', bg: 'var(--accent-subtle)', t: a.t, m: a.m, pin: a.pin })).join('')
      : D.notifs.map(n => U.feedItem(n)).join('');
  }

  /* ---------------- POPOVERS ---------------- */
  function closeAll() { ['notifPop', 'roleMenu', 'userMenu', 'scrim'].forEach(id => document.getElementById(id).classList.remove('open')); }
  function toggle(id) {
    const el = document.getElementById(id), was = el.classList.contains('open');
    closeAll(); if (!was) { el.classList.add('open'); document.getElementById('scrim').classList.add('open'); }
  }

  /* ---------------- LOGIN ----------------
     Demo credentials, pre-filled and RE-filled on every logout so signing back in
     is a single click. The password is the same for every role; the email just
     follows whichever role is selected. */
  const DEMO_PASSWORD = 'meshrd123';
  function fillLogin(role) {
    const r = role || S.role || 'superadmin';
    const sel = document.getElementById('loginRole');
    if (sel) sel.value = r;
    document.getElementById('loginEmail').value = C.ROLES[r].email;
    document.getElementById('loginPass').value = DEMO_PASSWORD;
  }
  function showLogin() {
    S.authed = false;
    document.getElementById('app').style.display = 'none';
    document.getElementById('login').style.display = '';
    /* deliberately NOT cleared — re-filled instead, so you never retype to get back in */
    fillLogin(S.role);
  }
  function doLogin(role) {
    S.authed = true;
    if (role) S.role = role;
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = '';
    S.route = 'dashboard';
    setRole(S.role, true);
    U.toast('Signed in as ' + C.ROLES[S.role].who + ' (' + C.ROLES[S.role].name + ').', 'ok');
  }

  /* ---------------- GLOBAL EVENTS ---------------- */
  function go(id) {
    if (!SCREENS[id]) { U.toast('That screen is not part of this prototype.'); return; }
    S.route = id;
    const m = OWNER[id]; if (m && !m.single) S.open[m.id] = true;
    location.hash = '#/' + id;
    renderRoute();
    if (window.innerWidth <= 860) document.getElementById('app').classList.remove('navopen');
  }
  window.go = go;

  document.addEventListener('click', function (e) {
    const t = e.target;
    const roleItem = t.closest('[data-role]');
    if (roleItem) { closeAll(); setRole(roleItem.getAttribute('data-role')); return; }
    if (t.closest('[data-logout]')) { closeAll(); showLogin(); return; }
    if (t.closest('[data-theme-toggle]')) { closeAll(); setTheme(S.theme === 'dark' ? 'light' : 'dark'); return; }
    const themeOpt = t.closest('[data-set-theme]');
    if (themeOpt) { const v = themeOpt.getAttribute('data-set-theme'); setTheme(v === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : v); return; }
    const accentOpt = t.closest('[data-set-accent]');
    if (accentOpt) { setAccent(accentOpt.getAttribute('data-set-accent')); return; }
    const scaleOpt = t.closest('[data-set-scale]');
    if (scaleOpt) { setScale(scaleOpt.getAttribute('data-set-scale')); return; }

    const modHead = t.closest('[data-mod]');
    if (modHead) { const id = modHead.getAttribute('data-mod'); S.open[id] = !(S.open[id] || OWNER[S.route] && OWNER[S.route].id === id && S.open[id] !== false); renderNav(); return; }
    const modGo = t.closest('[data-mod-go]');
    if (modGo) { const m = C.MODULES.find(x => x.id === modGo.getAttribute('data-mod-go')); if (m) { const sc = m.screens.filter(s => canSee(s, S.role)); if (sc.length) go(sc[0].id); } return; }

    const goEl = t.closest('[data-go]');
    const stop = t.closest('[data-stop]');
    if (goEl && !stop) { e.preventDefault(); go(goEl.getAttribute('data-go')); return; }

    const tabEl = t.closest('[data-tab]');
    if (tabEl) { const p = tabEl.getAttribute('data-tab').split(':'); S.tab[p[0]] = p[1]; renderRoute(); return; }
    const viewEl = t.closest('[data-view]');
    if (viewEl) { const p = viewEl.getAttribute('data-view').split(':'); S.view[p[0]] = p[1]; renderRoute(); return; }

    const tg = t.closest('[data-toggle]');
    if (tg) { tg.classList.toggle('on'); return; }
    const mact = t.closest('.mact, .mfield');
    if (mact) { mact.classList.toggle('on'); return; }
    const seg = t.closest('.scope-seg button, .seg button');
    if (seg) { Array.from(seg.parentElement.children).forEach(b => b.classList.remove('on')); seg.classList.add('on'); return; }
    const mHead = t.closest('.matrix-head');
    if (mHead) { mHead.parentElement.classList.toggle('open'); return; }

    const toastEl = t.closest('[data-toast]');
    if (toastEl) { e.preventDefault(); U.toast(toastEl.getAttribute('data-toast')); return; }
  });

  document.getElementById('bellBtn').onclick = e => { e.stopPropagation(); toggle('notifPop'); };
  document.getElementById('roleBtn').onclick = e => { e.stopPropagation(); toggle('roleMenu'); };
  document.getElementById('avatarEl').onclick = e => { e.stopPropagation(); toggle('userMenu'); };
  document.getElementById('scrim').onclick = closeAll;
  document.getElementById('themeBtn').onclick = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  document.getElementById('collapseBtn').onclick = () => {
    const app = document.getElementById('app');
    if (window.innerWidth <= 860) app.classList.toggle('navopen'); else { S.collapsed = !S.collapsed; app.classList.toggle('collapsed', S.collapsed); }
  };
  document.querySelectorAll('.pop-tab').forEach(tab => {
    tab.onclick = () => { document.querySelectorAll('.pop-tab').forEach(x => x.classList.remove('on')); tab.classList.add('on'); renderNotif(tab.getAttribute('data-ntab')); };
  });
  document.getElementById('loginForm').onsubmit = e => { e.preventDefault(); doLogin(document.getElementById('loginRole').value); };
  /* Changing the role dropdown swaps the email to match, so the form always
     reads as a coherent set of credentials rather than a mismatched pair. */
  document.getElementById('loginRole').onchange = e => fillLogin(e.target.value);
  /* The chips are one-click sign-in: fill AND submit, no second press. */
  document.querySelectorAll('[data-login-role]').forEach(b => {
    b.onclick = () => {
      const r = b.getAttribute('data-login-role');
      fillLogin(r);
      doLogin(r);
    };
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const i = document.querySelector('.topbar .searchbox input'); if (i) i.focus(); }
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#/', '');
    if (id && SCREENS[id] && id !== S.route && S.authed) { S.route = id; renderRoute(); }
  });

  /* ---------------- BOOT ---------------- */
  window.CMS_BOOT = function () {
    renderNotif('notif'); renderRoleMenu(); renderUserMenu(); setTheme('light'); setScale(S.scale);
    document.getElementById('loginModules').innerHTML = C.MODULES.filter(m => !m.single)
      .map(m => `<span>${esc(m.label)}</span>`).join('') + `<span>Dashboard</span><span>Settings</span>`;
    showLogin();
  };
})();
