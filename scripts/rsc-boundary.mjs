/**
 * The server/client boundary, checked from the SOURCE, because tsc, lint,
 * the tests and `next build` all pass the two defects below and only a
 * render shows them. It has happened three times (AGENTS.md, "The
 * server/client boundary"):
 *   - TH_ROW, a constant, imported by a server page from a "use client"
 *     module (2026-09-23, caught in the harness before commit);
 *   - a "use server" file exporting a constant (2026-09-23, the team page's
 *     DISABLE_INSTEAD, caught in the harness before commit);
 *   - effectiveQty(), a function, called by a server page from a "use
 *     client" module (2d4c10f, shipped: the order page crashed in
 *     production until 28f7807).
 *
 * Two rules:
 *   A. A server file may import from a "use client" module only React
 *      components. Anything else arrives on the server as a client
 *      reference: a constant is not its value, a function cannot be called.
 *   B. A "use server" file exports only async functions (types are erased
 *      and allowed). Next refuses anything else at request time.
 *
 * WHAT COUNTS AS A SERVER FILE. The module graph from the server entries,
 * not a guess per file: every page, layout, template, default, not-found,
 * loading and route file in src/app that is not itself "use client", every
 * file that imports "server-only", and every "use server" file; then every
 * file those import through a relative or "@/" path, stopping at a "use
 * client" module (that is the boundary, and it is where rule A looks).
 *
 * THE HEURISTIC FOR "A REACT COMPONENT" (the check cannot run the code): an
 * imported name is a component when it is PascalCase — an upper-case first
 * letter, at least one lower-case letter, no underscore — and the client
 * module exports it as a function or a const. A default import counts as a
 * component. What it can miss:
 *   - a PascalCase export that is not a component (a class, an object such
 *     as `Colors`) passes;
 *   - a default export that is not a component passes;
 *   - `import()` expressions and `require` are not read;
 *   - an import path that is neither relative nor "@/" (a package) is not
 *     followed.
 * What it flags that it should: SCREAMING_CASE constants (TH_ROW),
 * camelCase functions (effectiveQty), namespace imports (`* as x`), and
 * any name the client module does not export at all.
 *
 * Usage, from the app folder:
 *   node scripts/rsc-boundary.mjs [srcRoot]      exit 1 on any problem
 * The test (src/lib/rsc-boundary.test.ts) runs it on src, on fixtures it
 * must flag, and (with RSC_SCAN_ROOT) on another tree.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

/** Source with comments removed, strings kept (enough for the reads below). */
export function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") q = c;
    out += c;
    i++;
  }
  return out;
}

/** "use client" / "use server" / null: the file's directive, its first statement. */
export function directiveOf(src) {
  const m = /^\s*(?:(['"])use (client|server)\1\s*;?)/.exec(stripComments(src));
  return m ? m[2] : null;
}

/** The imports of a file: { from, names: [{name, type}], def, ns, typeOnly }. */
export function importsOf(src) {
  const code = stripComments(src);
  const out = [];
  const re = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\4/g;
  let m;
  while ((m = re.exec(code))) {
    const kind = m[1], typeOnly = !!m[2], clause = m[3].trim(), from = m[5];
    if (kind === "export" && !/^\{|^\*/.test(clause)) continue; // `export const x = … from` never matches this shape
    const rec = { from, names: [], def: null, ns: false, typeOnly, reexport: kind === "export" };
    let rest = clause;
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(rest);
    if (ns || rest === "*") rec.ns = true;
    const braces = /\{([\s\S]*?)\}/.exec(rest);
    if (braces) {
      for (const part of braces[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const t = /^type\s+/.test(part);
        const name = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        rec.names.push({ name, type: t });
      }
      rest = rest.replace(braces[0], "");
    }
    const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(rest.replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, "").trim());
    if (def && kind === "import") rec.def = def[1];
    out.push(rec);
  }
  // side-effect imports: import "server-only";
  const se = /(?:^|[;\n])\s*import\s+(['"])([^'"]+)\1/g;
  while ((m = se.exec(code))) out.push({ from: m[2], names: [], def: null, ns: false, typeOnly: false, sideEffect: true });
  return out;
}

/** The runtime exports of a module: name -> "function" | "async-function" | "const" | "class" | "other". */
export function exportsOf(src) {
  const code = stripComments(src);
  const out = new Map();
  let m;
  const fn = /export\s+(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/g;
  while ((m = fn.exec(code))) out.set(m[1] ? "default" : m[3], m[2] ? "async-function" : "function");
  const cls = /export\s+(default\s+)?class\s+([A-Za-z_$][\w$]*)?/g;
  while ((m = cls.exec(code))) out.set(m[1] ? "default" : m[2], "class");
  const v = /export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(async\b)?/g;
  while ((m = v.exec(code))) out.set(m[2], m[3] ? "async-function" : "const");
  const list = /export\s*\{([^}]*)\}(?!\s*from)/g;
  while ((m = list.exec(code))) {
    for (const part of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (/^type\s+/.test(part)) continue;
      const alias = part.split(/\s+as\s+/).pop().trim();
      out.set(alias, "other");
    }
  }
  if (/export\s+default\s+(?!async\s+function|function|class)/.test(code)) out.set("default", "other");
  if (/export\s*\*\s*from/.test(code)) out.set("*", "other");
  return out;
}

export function isComponentName(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
}

function resolveFrom(file, spec, srcRoot, exists) {
  let base;
  if (spec.startsWith("@/")) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
  else return null;
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, "index" + e))];
  return cands.find((c) => exists(c)) ?? null;
}

const ENTRY = /^(page|layout|template|default|not-found|loading|route)\.(tsx?|jsx?)$/;

/**
 * Checks a set of files. `files` maps absolute path -> source. Returns
 * { problems: string[], serverFiles: number, clientModules: number }.
 */
export function checkFiles(files, srcRoot) {
  const exists = (p) => files.has(p);
  const dir = new Map([...files].map(([p, s]) => [p, directiveOf(s)]));
  const rel = (p) => path.relative(srcRoot, p).split(path.sep).join("/");
  const problems = [];

  // Rule B.
  for (const [p, s] of files) {
    if (dir.get(p) !== "server") continue;
    for (const [name, kind] of exportsOf(s)) {
      if (kind !== "async-function") {
        problems.push(`B ${rel(p)}: a "use server" file exports ${name === "*" ? "export * (unknown names)" : `"${name}"`} (${kind}); only async functions may be exported`);
      }
    }
  }

  // The server graph.
  const queue = [];
  for (const [p, s] of files) {
    if (dir.get(p) === "client") continue;
    const inApp = rel(p).startsWith("app/");
    const entry = inApp && ENTRY.test(path.basename(p));
    const serverOnly = importsOf(s).some((i) => i.from === "server-only");
    if (entry || serverOnly || dir.get(p) === "server") queue.push(p);
  }
  const server = new Set(queue);
  while (queue.length) {
    const p = queue.shift();
    for (const imp of importsOf(files.get(p))) {
      const target = resolveFrom(p, imp.from, srcRoot, exists);
      if (!target) continue;
      if (dir.get(target) === "client") {
        // Rule A: at the boundary.
        if (imp.typeOnly || imp.sideEffect) continue;
        const exported = exportsOf(files.get(target));
        if (imp.ns) problems.push(`A ${rel(p)}: imports "* as" from the "use client" module ${rel(target)}; only components may cross`);
        for (const { name, type } of imp.names) {
          if (type) continue;
          const kind = exported.get(name);
          if (!isComponentName(name) || !(kind === "function" || kind === "const" || kind === "async-function")) {
            problems.push(`A ${rel(p)}: imports "${name}" from the "use client" module ${rel(target)}; a server file may import only React components from it (${kind ?? "not exported there"})`);
          }
        }
        continue;
      }
      if (!server.has(target)) { server.add(target); queue.push(target); }
    }
  }
  return { problems, serverFiles: server.size, clientModules: [...dir.values()].filter((d) => d === "client").length };
}

export function readTree(srcRoot) {
  const files = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p); }
      else if (EXTS.includes(path.extname(e.name)) && !/\.test\.[tj]sx?$/.test(e.name) && !e.name.endsWith(".d.ts")) files.set(p, fs.readFileSync(p, "utf8"));
    }
  };
  walk(srcRoot);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../src"));
  const { problems, serverFiles, clientModules } = checkFiles(readTree(root), root);
  console.log(`rsc-boundary: ${serverFiles} server files, ${clientModules} "use client" modules`);
  for (const p of problems) console.log("  XX " + p);
  if (problems.length) process.exit(1);
  console.log("  OK no problems");
}
