"""Compare SPEC-INVENTORY-CHECKLIST's extracted field lists against labels actually
present in the built Angular app, and report what looks genuinely missing.

WHY THIS IS NOT A NAIVE GREP
An earlier version searched only frontend/src/app/features/<module>/ and flagged 83
items. Spot-checking showed most of them were false: this app renders the majority
of its UI through SHARED components, so "+ Add Line Item" lives in
shared/screens/document-screen, "Display Scale" and "Mark all as read" live in
layout/, and none of them appear in the owning module's own directory at all.
Sending someone to "fix" those means sending them to break working code — the
failure mode the checklist's own rule 5 warns about.

So the search space is features/<module>/ PLUS shared/ PLUS layout/, and the report
says WHERE each match was found so a reviewer can sanity-check the verdict rather
than trust it.

THE SECOND SOURCE OF NOISE is the extractor upstream: it pulls bullet lines out of
the spec tables, and some of those lines are prose, not field names — "None — this
is a single table view" is a Tabs entry meaning the screen HAS no tabs, and one
"button" is a full paragraph about the export convention. Those are dropped here
rather than reported as missing controls.

WHAT THIS STILL CANNOT DO, stated so the output is not over-trusted:
  - It matches on strings in source. A field rendered from a runtime value, or
    labelled by a variable, will look missing when it is present.
  - It cannot see conditional fields, which is exactly what the checklist's rule 2
    is about. Set the trigger and look before believing any verdict here.
  - It says nothing about whether a control WORKS, only that its label exists.

Treat the output as a shortlist to verify in the browser, never as a defect list.

Run:  python build-docs/_gap_check.py
"""

import glob
import io
import json
import re
import unicodedata

APP = 'frontend/src/app'

MAP = {  # spec file -> built feature dir
    '01-masters-module.md': 'masters',
    '02-employee-module.md': 'employee',
    '03-asset-management-module.md': 'asset',
    '04-ticket-module.md': 'ticket',
    '05-leave-module.md': 'leave',
    '06-payroll-module.md': 'payroll',
    '07-vendor-module.md': 'vendor',
    '08-customer-module.md': 'customer',
    '09-opportunity-module.md': 'opportunity',
    '10-project-module.md': 'project',
    '11-invoice-module.md': 'invoice',
    '12-expense-module.md': 'expense',
    '13-purchase-bill-module.md': 'purchase-bill',
    '14-rbac-module.md': 'rbac',
    '15-tax-compliance-module.md': 'compliance',
}


def norm(s):
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'\(.*?\)', '', s)  # drop parentheticals
    s = re.sub(r'[^a-z0-9]+', '', s.lower())
    # The app is written in US spelling, several specs in British. A field is not
    # missing because of one vowel — a real wording mismatch is a Low finding for
    # a human, not something to report as an absent control.
    s = s.replace('colour', 'color').replace('organisation', 'organization')
    return s


def labels_in(paths):
    labs = set()
    for f in paths:
        t = open(f, encoding='utf-8', errors='ignore').read()
        for m in re.findall(r"label:\s*'([^']+)'", t):
            labs.add(norm(m))
        for m in re.findall(r"header:\s*'([^']+)'", t):
            labs.add(norm(m))
        for m in re.findall(r"key:\s*'([a-z0-9_]+)'", t):
            labs.add(norm(m.replace('_', '')))
        for m in re.findall(r"title:\s*'([^']+)'", t):
            labs.add(norm(m))
        for m in re.findall(r"placeholder:\s*'([^']+)'", t):
            labs.add(norm(m))
        # createLabel is what EVERY "+ Add X" button in this app is declared
        # with — the shared list header supplies the plus icon. Omitting it made
        # the checker report seven working Masters create buttons as missing,
        # which is six more phantoms than any real finding it produced there.
        for m in re.findall(r"createLabel:\s*'([^']+)'", t):
            labs.add(norm(m))
            labs.add(norm('+ ' + m))
        for m in re.findall(r"section:\s*['\"]([^'\"]+)['\"]", t):
            labs.add(norm(m))
        # Hand-written templates.
        for tag in ('label', 'th', 'h1', 'h2', 'h3', 'h4', 'button', 'option', 'legend', 'td', 'span', 'div', 'a', 'p'):
            for m in re.findall(r'<' + tag + r'[^>]*>([^<{]{2,60})</' + tag + r'>', t):
                labs.add(norm(m))
        for m in re.findall(r">\s*([A-Z][A-Za-z0-9 /&()—.-]{2,50}?)\s*<", t):
            labs.add(norm(m))
        for m in re.findall(r"aria-label=\"([^\"]{2,50})\"", t):
            labs.add(norm(m))
        # A control can be labelled by its tooltip alone — the role switcher's
        # own name lives only in title="Preview as this role", and without this
        # the checker reported a shipped, spec-approved feature as missing.
        for m in re.findall(r"title=\"([^\"]{2,60})\"", t):
            labs.add(norm(m))
    labs.discard('')
    return labs


def ts(pattern):
    return glob.glob(pattern, recursive=True)


# Shared + layout are searched for EVERY module — see the module docstring.
SHARED = labels_in(ts(f'{APP}/shared/**/*.ts') + ts(f'{APP}/layout/**/*.ts') + ts(f'{APP}/core/**/*.ts'))

built = {}
for feat in set(MAP.values()):
    built[feat] = labels_in(ts(f'{APP}/features/{feat}/**/*.ts'))


def matches(n, pool):
    if n in pool:
        return True
    return any(n in b or b in n for b in pool if len(b) > 4)


# Lines the extractor produced that are prose, not control names.
# NOTE the deliberate absence of re.I on the lowercase-start test below: with
# re.I, [a-z] matches uppercase too, which silently classified almost every real
# label as prose. Caught by the skipped-line count jumping to 915 of 989.
NOT_A_CONTROL = re.compile(r'^\s*(none\b|n/?a\b|—|–|-\s)', re.I)
STARTS_LOWER = re.compile(r'^[a-z]')


def is_prose(item):
    item = item.strip()
    if not item:
        return True
    if len(item) > 60:  # a control label is not a paragraph
        return True
    if NOT_A_CONTROL.search(item):  # "None — this is a single table view"
        return True
    if STARTS_LOWER.match(item):  # a rendered label starts capitalised or with a symbol
        return True
    if item.count(',') >= 2:  # an enumeration of several things, not one control
        return True
    if ' the ' in item.lower() and len(item.split()) > 6:  # sentence fragment
        return True
    return False


# Items already verified in the running app and found not to be defects. Kept in
# a separate file so the verdicts survive a regeneration, and so adding one is a
# deliberate act with a written reason rather than an edit to this script.
try:
    ADJUDICATED = {
        k: v
        for k, v in json.load(open('build-docs/gap-adjudicated.json', encoding='utf-8')).items()
        if not k.startswith('_')
    }
except FileNotFoundError:
    ADJUDICATED = {}

txt = open('build-docs/SPEC-INVENTORY-CHECKLIST.md', encoding='utf-8').read()
out = io.StringIO()
W = out.write
W("# Gap Report — spec checklist vs built frontend\n\n")
W("Regenerate with `python build-docs/_gap_check.py`. Read that script's docstring before\n")
W("acting on anything here — it explains what this comparison can and cannot see.\n\n")
W("**MISSING means no matching label string was found in the module's own files, in `shared/`,\n")
W("in `layout/`, or in `core/`.** It does NOT mean the control is absent: a field labelled from a\n")
W("runtime value, or one hidden behind a conditional, looks missing here and is not.\n")
W("**Verify in the browser before changing anything.**\n\n")

cur_mod = cur_screen = cur_feat = section = None
tot = miss = skipped = adjudicated = 0
per = {}

for ln in txt.split('\n'):
    m = re.match(r'^# (Module \d+ of \d+: .+)$', ln)
    if m:
        cur_mod = m.group(1)
        continue
    m = re.match(r'^`(\d\d-.*\.md)`$', ln)
    if m:
        cur_feat = MAP.get(m.group(1))
        W(f"\n## {cur_mod}  →  `features/{cur_feat}/`\n\n")
        per.setdefault(cur_feat, [0, 0])
        continue
    m = re.match(r'^## (\d+\.\d+[a-z]?) (.+)$', ln)
    if m:
        cur_screen = f"{m.group(1)} {m.group(2)}"
        continue
    m = re.match(r'^\*\*(Fields|Buttons / actions|Tabs|Columns) \(\d+\):\*\*$', ln)
    if m:
        section = m.group(1)
        continue
    if ln.startswith('**'):
        section = None
        continue
    m = re.match(r'^- \[ \] (.+)$', ln)
    if m and section in ('Fields', 'Buttons / actions', 'Tabs', 'Columns') and cur_feat:
        item = m.group(1)
        if is_prose(item):
            skipped += 1
            continue
        # Sections the specs themselves mark as not-yet-built. Reporting these as
        # missing is noise: the spec is describing a future flow, not a gap.
        # e.g. "3.5 (Future) The Biometric Feed Replaces Manual Entry" and
        # "7.3 Milestones - Future Flow".
        if cur_screen and re.search(r'\(future\)|future flow|in the future', cur_screen, re.I):
            skipped += 1
            continue
        n = norm(item)
        if len(n) < 3:
            continue
        tot += 1
        per[cur_feat][0] += 1
        if matches(n, built[cur_feat]):
            continue
        if matches(n, SHARED):
            continue  # rendered by a shared component — present, just not in this dir
        verdict = ADJUDICATED.get(f"{cur_screen} :: {item}")
        if verdict:
            adjudicated += 1
            W(f"- ADJUDICATED [{section}] `{item}` — {cur_screen}\n      {verdict}\n")
            continue
        miss += 1
        per[cur_feat][1] += 1
        W(f"- **MISSING** [{section}] `{item}` — {cur_screen}\n")

open('build-docs/GAP-REPORT.md', 'w', encoding='utf-8').write(out.getvalue())
print(
    f"checked={tot}  flagged_missing={miss} ({100 * miss // max(tot, 1)}%)  "
    f"adjudicated={adjudicated}  prose_lines_skipped={skipped}\n"
)
for f, (t, m) in sorted(per.items(), key=lambda x: -x[1][1]):
    if t:
        print(f"  {f:16} {m:4}/{t:4} missing")
