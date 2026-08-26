#!/usr/bin/env node
'use strict';

/**
 * Statically extracts every field/column key + label declared across the
 * Angular screen configs under src/app/features/**\/*.config.ts, and writes
 * them to backend/app/rbac/field_manifest.json.
 *
 * WHY: MASTER-BUILD-PROMPT.md §3 requires every field on every screen to be
 * governable by RBAC's Layer 3 (field-level show/mask/hide), but
 * backend/app/rbac/registry/screens.py's `sensitive_fields` tuples are hand-
 * curated and only cover ~8 fields total. "Never a hand-maintained second
 * list: 900+ fields curated by hand would be stale within a week." Each
 * screen config already declares its own fields/columns — this script
 * derives the registry from that, instead of a human re-typing it.
 *
 * HOW: pure TypeScript AST parsing (the `typescript` package's Compiler
 * API — already a devDependency of this Angular project), NOT `ts-node` /
 * `eval` / `require()` of the config files. These configs contain real
 * functions (`compute:`, `predicate:`, `visibleWhen:`, row-action endpoint
 * builders, …) that reference application types and cannot be safely
 * executed outside Angular's own runtime. So this walks the parsed syntax
 * tree looking for string-literal `key`/`header`/`label` pairs, and doesn't
 * need to execute a single line of the config.
 *
 * SHAPES HANDLED (screen.types.ts):
 *   - ListScreenConfig.columns[]                (ColumnDef: key + header)
 *   - FormScreenConfig/SingletonFormConfig.fields[]   (FieldConfig: key + label)
 *   - FormScreenConfig.arrayFields[]            (own key+label, and its
 *                                                 .columns[] — ArrayColumnConfig)
 *   - RecordScreenConfig.tabs[].sections[].fields[]   (FieldConfig)
 *   - TabbedScreenConfig.tabs[].config          (any of the above, recursively —
 *                                                 whether inlined, a local const,
 *                                                 an imported default export, or
 *                                                 the return value of a small
 *                                                 local helper function like
 *                                                 taxes.tabbed.config.ts's
 *                                                 `scopedTab()`)
 *
 * A field whose label isn't a plain string literal (computed, or a template
 * expression) falls back to humanizing its `key` (snake_case -> Title Case)
 * rather than dropping the field or crashing the run.
 *
 * Regenerate this manifest (`node scripts/generate-field-manifest.js`) any
 * time a *.config.ts file's fields/columns change — this is a build-time
 * sync, consumed by backend/app/rbac/field_sync.py during `python -m
 * app.seed`, not a live one.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FEATURES_ROOT = path.resolve(__dirname, '..', 'src', 'app', 'features');
const OUTPUT_PATH = path.resolve(REPO_ROOT, 'backend', 'app', 'rbac', 'field_manifest.json');

function rel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

// --------------------------------------------------------------------------
// File discovery
// --------------------------------------------------------------------------
function findConfigFiles(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findConfigFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.config.ts')) {
      out.push(full);
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Source cache
// --------------------------------------------------------------------------
const sourceCache = new Map(); // normalized filePath -> ts.SourceFile | null

function loadSource(filePath) {
  const norm = path.normalize(filePath);
  if (sourceCache.has(norm)) return sourceCache.get(norm);
  let sf = null;
  if (fs.existsSync(norm) && fs.statSync(norm).isFile()) {
    const text = fs.readFileSync(norm, 'utf8');
    sf = ts.createSourceFile(norm, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  sourceCache.set(norm, sf);
  return sf;
}

function resolveModulePath(fromFile, spec) {
  if (!spec || !spec.startsWith('.')) return null; // only relative imports point at other config/data files
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base + '.ts', path.join(base, 'index.ts'), base];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// --------------------------------------------------------------------------
// Small AST helpers
// --------------------------------------------------------------------------
function unwrap(expr) {
  while (
    expr &&
    (ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isNonNullExpression(expr) ||
      ts.isSatisfiesExpression?.(expr))
  ) {
    expr = expr.expression;
  }
  return expr;
}

function propName(nameNode) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return null; // computed property name — not used by these configs
}

function collectProps(objNode) {
  const out = [];
  for (const prop of objNode.properties) {
    if (ts.isSpreadAssignment(prop)) {
      out.push({ isSpread: true, spreadExpr: prop.expression });
    } else if (ts.isPropertyAssignment(prop)) {
      const name = propName(prop.name);
      if (name != null) out.push({ isSpread: false, name, valueNode: unwrap(prop.initializer) });
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      out.push({ isSpread: false, name: prop.name.text, valueNode: prop.name });
    }
    // method/getter properties aren't used for id/shape/columns/fields in these configs
  }
  return out;
}

function findProp(props, name) {
  return props.find((p) => !p.isSpread && p.name === name);
}

function isStringLiteralLike(node) {
  return !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

function findLocalInitializer(sf, name) {
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          return unwrap(decl.initializer);
        }
      }
    }
  }
  return null;
}

function findDefaultImportModuleSpecifier(sf, localName) {
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause && stmt.importClause.name) {
      if (stmt.importClause.name.text === localName) {
        const spec = stmt.moduleSpecifier;
        if (ts.isStringLiteral(spec)) return spec.text;
      }
    }
  }
  return null;
}

function findDefaultExportExpr(sf) {
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      return unwrap(stmt.expression);
    }
  }
  return null;
}

// function-like local declarations: `function f(...) {...}`, `const f = (...) => ...`, `const f = function(...) {...}`
function findLocalFunctionLike(sf, name) {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.name.text === name && stmt.body) {
      return { kind: 'block', body: stmt.body };
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          const init = decl.initializer;
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            if (ts.isBlock(init.body)) return { kind: 'block', body: init.body };
            return { kind: 'expr', body: unwrap(init.body) };
          }
        }
      }
    }
  }
  return null;
}

// Find the first `return <expr>;` inside a block, without descending into
// nested function bodies (a nested function's own return doesn't belong to
// the outer one). Good enough for the small helper functions these configs
// actually use (single-branch or simple if/else returns).
function findFirstReturnExpr(block) {
  function walkStatements(statements) {
    for (const s of statements) {
      const found = walkStatement(s);
      if (found) return found;
    }
    return null;
  }
  function walkStatement(stmt) {
    if (!stmt) return null;
    if (ts.isReturnStatement(stmt)) {
      return stmt.expression ? unwrap(stmt.expression) : null;
    }
    if (ts.isBlock(stmt)) return walkStatements(stmt.statements);
    if (ts.isIfStatement(stmt)) {
      return walkStatement(stmt.thenStatement) || walkStatement(stmt.elseStatement);
    }
    if (ts.isTryStatement?.(stmt)) {
      return walkStatement(stmt.tryBlock) || (stmt.finallyBlock ? walkStatement(stmt.finallyBlock) : null);
    }
    // Function/class declarations, loops with function bodies etc. intentionally
    // NOT descended into — their returns belong to a different scope.
    return null;
  }
  return walkStatements(block.statements);
}

// --------------------------------------------------------------------------
// Core resolver: turn an arbitrary expression into an object/array literal,
// following local const bindings, default imports of sibling config files,
// and simple local helper-function calls. Cycle-safe via `visited`.
// --------------------------------------------------------------------------
function resolveExprToLiteral(expr, sf, filePath, visited, warnings) {
  expr = unwrap(expr);
  if (!expr) return null;

  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) {
    return { node: expr, sf, filePath };
  }

  if (ts.isIdentifier(expr)) {
    const localInit = findLocalInitializer(sf, expr.text);
    if (localInit) {
      const vkey = filePath + '#local#' + expr.text;
      if (visited.has(vkey)) return null;
      visited.add(vkey);
      return resolveExprToLiteral(localInit, sf, filePath, visited, warnings);
    }
    const spec = findDefaultImportModuleSpecifier(sf, expr.text);
    if (spec) {
      const modPath = resolveModulePath(filePath, spec);
      if (modPath) {
        const vkey = modPath + '#defaultExport';
        if (visited.has(vkey)) return null;
        visited.add(vkey);
        const modSf = loadSource(modPath);
        if (modSf) {
          const defExpr = findDefaultExportExpr(modSf);
          if (defExpr) return resolveExprToLiteral(defExpr, modSf, modPath, visited, warnings);
        }
      }
    }
    return null; // unresolvable identifier (external type, enum, etc.) — skip gracefully
  }

  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) {
      const fn = findLocalFunctionLike(sf, callee.text);
      if (fn) {
        const vkey = filePath + '#fn#' + callee.text + '#' + expr.pos;
        if (visited.has(vkey)) return null;
        visited.add(vkey);
        const retExpr = fn.kind === 'block' ? findFirstReturnExpr(fn.body) : fn.body;
        if (retExpr) return resolveExprToLiteral(retExpr, sf, filePath, visited, warnings);
      }
    }
    return null; // can't statically evaluate an arbitrary call — skip gracefully
  }

  return null;
}

// --------------------------------------------------------------------------
// Result accumulation
// --------------------------------------------------------------------------
const stats = {
  filesProcessed: 0,
  filesSkipped: 0,
  fallbackLabels: [], // {screen, field, file}
  warnings: [],
};

function addResult(results, screenKey, fieldKey, label, fallback, sourceFile) {
  if (!results[screenKey]) results[screenKey] = new Map();
  const bucket = results[screenKey];
  const existing = bucket.get(fieldKey);
  if (!existing) {
    bucket.set(fieldKey, { label, fallback });
  } else if (existing.fallback && !fallback) {
    // upgrade a humanized fallback to a real literal label found elsewhere
    bucket.set(fieldKey, { label, fallback });
  }
  if (fallback) {
    stats.fallbackLabels.push({ screen: screenKey, field: fieldKey, file: rel(sourceFile) });
  }
}

function humanize(key) {
  return key
    .replace(/[_\-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --------------------------------------------------------------------------
// Field/column array (ColumnDef[] | FieldConfig[] | ArrayColumnConfig[])
// --------------------------------------------------------------------------
function handleFieldArray(arrayNode, sf, filePath, screenKeyStack, results, visited) {
  const screenKey = screenKeyStack[screenKeyStack.length - 1];
  if (!screenKey) return;
  for (const el of arrayNode.elements) {
    if (ts.isSpreadElement(el)) {
      const resolved = resolveExprToLiteral(el.expression, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleFieldArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
      continue;
    }
    let elNode = el;
    let elSf = sf;
    let elFile = filePath;
    if (!ts.isObjectLiteralExpression(elNode)) {
      const resolved = resolveExprToLiteral(elNode, sf, filePath, visited, stats.warnings);
      if (!resolved || !ts.isObjectLiteralExpression(resolved.node)) continue;
      elNode = resolved.node;
      elSf = resolved.sf;
      elFile = resolved.filePath;
    }
    const props = collectProps(elNode);
    const keyProp = findProp(props, 'key');
    const headerProp = findProp(props, 'header') || findProp(props, 'label');
    const configProp = findProp(props, 'config'); // a TabDef {key,label,config} slipping in — not a real field
    if (configProp) continue;
    if (!keyProp || !isStringLiteralLike(keyProp.valueNode)) {
      stats.warnings.push(`${rel(elFile)} [${screenKey}]: field entry with missing/non-literal 'key' — skipped`);
      continue;
    }
    const fieldKey = keyProp.valueNode.text;
    let label;
    let fallback = false;
    if (headerProp && isStringLiteralLike(headerProp.valueNode)) {
      label = headerProp.valueNode.text;
    } else {
      label = humanize(fieldKey);
      fallback = true;
    }
    addResult(results, screenKey, fieldKey, label, fallback, elFile);
  }
}

// --------------------------------------------------------------------------
// sections[] (FieldSection: { title, fields })
// --------------------------------------------------------------------------
function handleSectionsArray(arrayNode, sf, filePath, screenKeyStack, results, visited) {
  for (const el of arrayNode.elements) {
    if (ts.isSpreadElement(el)) {
      const resolved = resolveExprToLiteral(el.expression, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleSectionsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
      continue;
    }
    let elNode = el;
    let elSf = sf;
    let elFile = filePath;
    if (!ts.isObjectLiteralExpression(elNode)) {
      const resolved = resolveExprToLiteral(elNode, sf, filePath, visited, stats.warnings);
      if (!resolved || !ts.isObjectLiteralExpression(resolved.node)) continue;
      elNode = resolved.node;
      elSf = resolved.sf;
      elFile = resolved.filePath;
    }
    const props = collectProps(elNode);
    const fieldsProp = findProp(props, 'fields');
    if (fieldsProp) {
      const resolved = resolveExprToLiteral(fieldsProp.valueNode, elSf, elFile, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleFieldArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    }
  }
}

// --------------------------------------------------------------------------
// arrayFields[] (ArrayFieldConfig: { key, label, columns, emptyItem })
// --------------------------------------------------------------------------
function handleArrayFieldsArray(arrayNode, sf, filePath, screenKeyStack, results, visited) {
  const screenKey = screenKeyStack[screenKeyStack.length - 1];
  for (const el of arrayNode.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const props = collectProps(el);
    const keyProp = findProp(props, 'key');
    const labelProp = findProp(props, 'label');
    const columnsProp = findProp(props, 'columns');
    if (screenKey && keyProp && isStringLiteralLike(keyProp.valueNode)) {
      const fieldKey = keyProp.valueNode.text;
      let label;
      let fallback = false;
      if (labelProp && isStringLiteralLike(labelProp.valueNode)) {
        label = labelProp.valueNode.text;
      } else {
        label = humanize(fieldKey);
        fallback = true;
      }
      addResult(results, screenKey, fieldKey, label, fallback, filePath);
    }
    if (columnsProp) {
      const resolved = resolveExprToLiteral(columnsProp.valueNode, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleFieldArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    }
  }
}

// --------------------------------------------------------------------------
// tabs[] — either TabDef ({key,label,config}, TabbedScreenConfig) or
// RecordTab ({id,label,sections}, RecordScreenConfig)
// --------------------------------------------------------------------------
function handleTabsArray(arrayNode, sf, filePath, screenKeyStack, results, visited) {
  for (const el of arrayNode.elements) {
    if (ts.isSpreadElement(el)) {
      const resolved = resolveExprToLiteral(el.expression, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleTabsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
      continue;
    }
    let elNode = el;
    let elSf = sf;
    let elFile = filePath;
    if (!ts.isObjectLiteralExpression(elNode)) {
      const resolved = resolveExprToLiteral(elNode, sf, filePath, visited, stats.warnings);
      if (!resolved || !ts.isObjectLiteralExpression(resolved.node)) continue;
      elNode = resolved.node;
      elSf = resolved.sf;
      elFile = resolved.filePath;
    }
    const props = collectProps(elNode);
    const configProp = findProp(props, 'config');
    const sectionsProp = findProp(props, 'sections');
    if (configProp) {
      const resolved = resolveExprToLiteral(configProp.valueNode, elSf, elFile, visited, stats.warnings);
      if (resolved && ts.isObjectLiteralExpression(resolved.node)) {
        visitConfigNode(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    } else if (sectionsProp) {
      const resolved = resolveExprToLiteral(sectionsProp.valueNode, elSf, elFile, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleSectionsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    }
  }
}

// --------------------------------------------------------------------------
// Any ScreenConfig-shaped object literal (root export, or a resolved
// tabs[].config). Detects its own `id` (pushed as the current screen key
// context for direct fields/columns/sections/arrayFields found on it), then
// walks its known field-bearing properties.
// --------------------------------------------------------------------------
function visitConfigNode(node, sf, filePath, screenKeyStack, results, visited) {
  if (!node || !ts.isObjectLiteralExpression(node)) return;
  const props = collectProps(node);

  let pushed = false;
  const idProp = findProp(props, 'id');
  if (idProp && isStringLiteralLike(idProp.valueNode)) {
    screenKeyStack.push(idProp.valueNode.text);
    pushed = true;
  }

  for (const p of props) {
    if (p.isSpread) {
      const resolved = resolveExprToLiteral(p.spreadExpr, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isObjectLiteralExpression(resolved.node)) {
        visitConfigNode(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
      continue;
    }
    if (p.name === 'columns' || p.name === 'fields') {
      const resolved = resolveExprToLiteral(p.valueNode, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleFieldArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    } else if (p.name === 'sections') {
      const resolved = resolveExprToLiteral(p.valueNode, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleSectionsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    } else if (p.name === 'tabs') {
      const resolved = resolveExprToLiteral(p.valueNode, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleTabsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    } else if (p.name === 'arrayFields') {
      const resolved = resolveExprToLiteral(p.valueNode, sf, filePath, visited, stats.warnings);
      if (resolved && ts.isArrayLiteralExpression(resolved.node)) {
        handleArrayFieldsArray(resolved.node, resolved.sf, resolved.filePath, screenKeyStack, results, visited);
      }
    }
    // every other property (title, endpoint, header, filters, rowActions, ...) is irrelevant to field extraction
  }

  if (pushed) screenKeyStack.pop();
}

// --------------------------------------------------------------------------
// Per-file entry point
// --------------------------------------------------------------------------
function processFile(filePath, results) {
  const sf = loadSource(filePath);
  if (!sf) {
    stats.filesSkipped++;
    stats.warnings.push(`${rel(filePath)}: could not read/parse — skipped`);
    return;
  }
  const defExpr = findDefaultExportExpr(sf);
  if (!defExpr) {
    stats.filesSkipped++;
    stats.warnings.push(`${rel(filePath)}: no 'export default' found — skipped`);
    return;
  }
  const visited = new Set();
  const resolved = resolveExprToLiteral(defExpr, sf, filePath, visited, stats.warnings);
  if (!resolved || !ts.isObjectLiteralExpression(resolved.node)) {
    stats.filesSkipped++;
    stats.warnings.push(`${rel(filePath)}: default export did not resolve to an object literal — skipped`);
    return;
  }
  const rootIdProp = findProp(collectProps(resolved.node), 'id');
  if (!rootIdProp || !isStringLiteralLike(rootIdProp.valueNode)) {
    stats.filesSkipped++;
    stats.warnings.push(`${rel(filePath)}: root config has no literal 'id' string — skipped`);
    return;
  }
  stats.filesProcessed++;
  visitConfigNode(resolved.node, resolved.sf, resolved.filePath, [], results, visited);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
function main() {
  const files = findConfigFiles(FEATURES_ROOT);
  const results = {}; // screenKey -> Map(fieldKey -> {label, fallback})

  for (const f of files) processFile(f, results);

  const manifest = {};
  let totalFieldRows = 0;
  const screenKeys = Object.keys(results).sort();
  for (const screenKey of screenKeys) {
    const bucket = results[screenKey];
    const fieldKeys = Array.from(bucket.keys()).sort();
    manifest[screenKey] = fieldKeys.map((fieldKey) => {
      const { label } = bucket.get(fieldKey);
      totalFieldRows++;
      return { field_key: fieldKey, label };
    });
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`Scanned ${files.length} *.config.ts files under ${rel(FEATURES_ROOT)}`);
  console.log(`  processed: ${stats.filesProcessed}, skipped: ${stats.filesSkipped}`);
  console.log(`Extracted ${screenKeys.length} screen keys, ${totalFieldRows} field rows total`);
  console.log(`Wrote manifest -> ${rel(OUTPUT_PATH)}`);

  if (stats.fallbackLabels.length) {
    console.log(`\n${stats.fallbackLabels.length} field(s) fell back to a humanized key (no string-literal label found):`);
    for (const f of stats.fallbackLabels.slice(0, 50)) {
      console.log(`  - [${f.screen}] ${f.field}  (${f.file})`);
    }
    if (stats.fallbackLabels.length > 50) console.log(`  ... and ${stats.fallbackLabels.length - 50} more`);
  }

  if (stats.warnings.length) {
    console.log(`\n${stats.warnings.length} warning(s):`);
    for (const w of stats.warnings) console.log(`  - ${w}`);
  }
}

main();
