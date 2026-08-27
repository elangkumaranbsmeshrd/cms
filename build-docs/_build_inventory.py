"""Extracts EVERY screen, tab, field, column, button, action, filter, status value,
empty state, role rule and workflow step from the 15 module specs into one checklist.

Regenerate:  python3 build-docs/_build_inventory.py
"""
import re, glob, io

SKIP_FIRST = {'Field Name','Field','Column','Column holds','Field Group','Sub-Master','#'}
NOISE = re.compile(r'Module \d+|Section \d+\.\d+|\u2192')

def clean(s):
    s = re.sub(r'\*\*|`|\[([^\]]*)\]\([^)]*\)', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip()

def bad(v):
    return (not v or len(v) > 70 or NOISE.search(v)
            or v.lower().startswith(('the ','a ','this ','see ','if ','when ','every ','it ','so ')))

buf = io.StringIO(); W = buf.write
G = dict(screens=0, tabs=0, fields=0, cols=0, btns=0, filters=0, states=0, steps=0)

for path in sorted(glob.glob('*-module.md')):
    lines = open(path, encoding='utf-8').read().split('\n')
    W(f"\n# {clean(lines[0].lstrip('# '))}\n\n`{path}`\n\n")
    cur = None; screens = []

    def flush():
        if cur: screens.append(cur)

    for i, ln in enumerate(lines):
        nxt = lines[i+1] if i+1 < len(lines) else ''
        m = re.match(r'^### (\d+\.\d+[a-z]?)\s+(.+)$', ln)
        if m:
            flush()
            cur = dict(ref=m.group(1), title=clean(m.group(2)), roles='', purpose='',
                       tabs=[], fields=[], cols=[], btns=[], filters=[], states=[],
                       steps=[], statuses=[], notes=[])
            continue
        if not cur:
            continue

        # ---- tabs -------------------------------------------------------
        t = re.match(r'^#### Tab: (.+)$', ln)
        if t: cur['tabs'].append(clean(t.group(1))); continue

        # ---- tables -----------------------------------------------------
        if ln.startswith('|') and ln.count('|') >= 3:
            if re.match(r'^\|[-: |]+\|$', nxt.strip()):
                continue                                   # header row itself
            cells = [clean(c) for c in ln.strip('|').split('|')]
            first = cells[0]
            if first and not re.match(r'^[-: ]+$', first) and first not in SKIP_FIRST and not bad(first):
                hdr = cells[1].lower() if len(cells) > 1 else ''
                (cur['cols'] if ('note' in hdr or 'meaning' in hdr or 'source' in hdr) else cur['fields']).append(first)

        # ---- labelled blocks --------------------------------------------
        for pat, key in [(r"\*\*What it's for:?\*\*(.+)", 'purpose'),
                         (r'\*\*Who can open it:?\*\*(.+)', 'roles')]:
            mm = re.search(pat, ln)
            if mm and not cur[key]: cur[key] = clean(mm.group(1))[:280]
        for pat, key in [(r'\*\*Buttons?[^:*]*:?\*\*(.+)', 'btns'),
                         (r'\*\*Filters?[^:*]*:?\*\*(.+)', 'filters'),
                         (r'\*\*Columns?[^:*]*:?\*\*(.+)', 'cols'),
                         (r'\*\*Empty[^:*]*:?\*\*(.+)', 'states'),
                         (r'\*\*Status:?\*\*(.+)', 'statuses'),
                         (r'\*\*Tabs?:?\*\*(.+)', 'tabs')]:
            mm = re.search(pat, ln)
            if mm:
                v = clean(mm.group(1))
                if key in ('cols', 'tabs'):
                    cur[key] += [c for c in (x.strip(' .') for x in re.split(r',(?![^(]*\))', v)) if c and not bad(c)][:25]
                elif v: cur[key].append(v[:300])

        # ---- inline buttons / actions -----------------------------------
        for q in re.findall(r'"(\+\s?[A-Z][^"]{1,45})"', ln): cur['btns'].append(q)
        for q in re.findall(r'"([A-Z][^"]{1,40})"\s*(?:button|action)', ln): cur['btns'].append(q)
        for q in re.findall(r'\*\*"([^"]{2,40})"\*\*', ln):
            if q.startswith(('+', 'Add', 'Save', 'Cancel', 'Edit', 'Delete', 'Run', 'Export',
                             'Approve', 'Reject', 'Send', 'Download', 'Upload', 'Confirm',
                             'Submit', 'Lock', 'Assign', 'Mark', 'Generate', 'Record', 'New')):
                cur['btns'].append(q)

        # ---- numbered workflow steps ------------------------------------
        st = re.match(r'^(\d{1,2})\.\s+\*\*(.{4,70}?)\*\*', ln)
        if st: cur['steps'].append(clean(st.group(2)))

    flush()

    for s in screens:
        if not any(s[k] for k in ('fields','cols','btns','filters','tabs','states','steps')): continue
        G['screens'] += 1
        W(f"## {s['ref']} {s['title']}\n\n")
        if s['purpose']: W(f"*{s['purpose']}*\n\n")
        if s['roles']:   W(f"**Roles:** {s['roles']}\n\n")
        for key, label, gk in [('tabs','Tabs','tabs'), ('cols','Columns','cols'),
                               ('fields','Fields','fields'), ('btns','Buttons / actions','btns'),
                               ('filters','Filters','filters'), ('statuses','Status values',None),
                               ('states','Empty state',None), ('steps','Workflow / functionality','steps')]:
            items = list(dict.fromkeys(s[key]))
            if not items: continue
            if gk: G[gk] += len(items)
            W(f"**{label} ({len(items)}):**\n" if key in ('tabs','cols','fields','btns') else f"**{label}:**\n")
            for it in items: W(f"- [ ] {it}\n")
            W("\n")

open('build-docs/_body.md','w',encoding='utf-8').write(buf.getvalue())
print("screens=%(screens)d tabs=%(tabs)d fields=%(fields)d columns=%(cols)d buttons=%(btns)d filters=%(filters)d steps=%(steps)d" % G)
