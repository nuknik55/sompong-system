/**
 * Run with: npm test — the customer page cannot lose an edit (queue item 51),
 * checked on the parsed source as save-booking-lock.test.ts does, so that a
 * comment naming a call cannot satisfy a check. Each check first flags the
 * old code's shape and the regressions the review tried (a save that ignores
 * its answer, a token taken from the page instead of the edit, a zero-row
 * answer taken as success, a guard or a lock wired to `false`, an input
 * outside the lock), and each fails on the code before item 51.
 *
 * The page filled its form once when it opened; its save wrote all eight
 * fields with no conflict check and took a zero-row answer as success; it had
 * no leave guard; and typing while it saved was dropped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, f), "utf8");
const CLIENT = "customers/[id]/CustomerDetailClient.tsx";

function parse(source: string, tsx = false) {
  return ts.createSourceFile(tsx ? "x.tsx" : "x.ts", source, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function functionBody(file: ts.SourceFile, fnName: string): ts.Block | undefined {
  let body: ts.Block | undefined;
  file.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === fnName) body = n.body; });
  return body;
}
function each(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((c) => each(c, visit));
}
function contains(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let hit = false;
  each(node, (n) => { if (pred(n)) hit = true; });
  return hit;
}
/** `const { data: rows } = …` → "rows" for "data". */
function boundName(file: ts.SourceFile, decl: ts.VariableDeclaration, prop: string): string | null {
  if (!ts.isObjectBindingPattern(decl.name)) return null;
  for (const el of decl.name.elements) {
    const key = (el.propertyName ?? el.name).getText(file);
    if (key === prop && ts.isIdentifier(el.name)) return el.name.text;
  }
  return null;
}
/** An object literal with `ok: true` (or false) somewhere inside. */
function hasOk(file: ts.SourceFile, node: ts.Node, value: "true" | "false") {
  return contains(node, (n) => ts.isPropertyAssignment(n) && n.name.getText(file) === "ok" && n.initializer.getText(file) === value);
}
function lastStatementReturns(s: ts.Statement) {
  if (ts.isReturnStatement(s)) return true;
  return ts.isBlock(s) && s.statements.length > 0 && ts.isReturnStatement(s.statements[s.statements.length - 1]);
}

/**
 * How the customer save writes: whether its update is a compare-and-set that
 * reads its rows back, whether anything in it throws, and whether a zero-row
 * answer is REFUSED — an `if (<rows>.length === 0)` at the top of the body
 * that always returns, returns no `ok: true`, and comes before every success.
 */
function saveShape(source: string): { casUpdates: number; plainUpdates: number; throws: number; zeroRowsRefused: boolean } | null {
  const file = parse(source);
  const body = functionBody(file, "updateCateringCustomer");
  if (!body) return null;
  let casUpdates = 0, plainUpdates = 0, throws = 0;
  let rows: string | null = null;
  each(body, (n) => {
    if (ts.isThrowStatement(n)) throws++;
    // The whole statement or declaration that holds .update( on catering_customers.
    if (ts.isExpressionStatement(n) || ts.isVariableDeclaration(n)) {
      const text = n.getText(file);
      if (!text.includes("\"catering_customers\"") || !text.includes(".update(")) return;
      if (text.includes(".eq(\"updated_at\"") && text.includes(".select(")) {
        casUpdates++;
        if (ts.isVariableDeclaration(n)) rows = boundName(file, n, "data");
      } else plainUpdates++;
    }
  });
  const isZeroTest = (n: ts.Node) => ts.isBinaryExpression(n)
    && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && n.left.getText(file) === `${rows}.length` && n.right.getText(file) === "0";
  const guard = rows === null ? undefined : body.statements.find((s) =>
    ts.isIfStatement(s) && contains(s.expression, isZeroTest));
  let zeroRowsRefused = false;
  if (guard && ts.isIfStatement(guard)) {
    const successes: number[] = [];
    each(body, (n) => { if (ts.isReturnStatement(n) && hasOk(file, n, "true")) successes.push(n.getStart(file)); });
    zeroRowsRefused = lastStatementReturns(guard.thenStatement)
      && !hasOk(file, guard.thenStatement, "true")
      && successes.every((p) => p > guard.end);
  }
  return { casUpdates, plainUpdates, throws, zeroRowsRefused };
}

test("the save check flags a write with no conflict check, one that throws, and a zero-row answer taken as success", () => {
  const old = `export async function updateCateringCustomer(id, data) {
    const { error } = await supabase.from("catering_customers").update({ name: data.name }).eq("id", id);
    if (error) throw error;
  }`;
  assert.deepEqual(saveShape(old), { casUpdates: 0, plainUpdates: 1, throws: 1, zeroRowsRefused: false });
  const cas = (zeroTest: string) => `export async function updateCateringCustomer(id, data, t) {
    const { data: rows, error } = await supabase.from("catering_customers").update({ name: data.name }).eq("id", id).eq("updated_at", t).select("id, updated_at");
    if (error) return { ok: false, error: error.message };
    if (${zeroTest}) {
      return { ok: false, conflict: true, error: "x" };
    }
    return { ok: true, updatedAt: rows[0].updated_at };
  }`;
  // The review's mutant: the zero-row branch switched off, so no rows passes as a save.
  assert.deepEqual(saveShape(cas("false")), { casUpdates: 1, plainUpdates: 0, throws: 0, zeroRowsRefused: false });
  assert.deepEqual(saveShape(cas("!rows || rows.length === 0")), { casUpdates: 1, plainUpdates: 0, throws: 0, zeroRowsRefused: true });
  // A zero-row branch that reports success is no refusal.
  const okOnZero = cas("!rows || rows.length === 0").replace("ok: false, conflict: true", "ok: true, conflict: true");
  assert.deepEqual(saveShape(okOnZero), { casUpdates: 1, plainUpdates: 0, throws: 0, zeroRowsRefused: false });
});

test("A CUSTOMER SAVE IS A COMPARE-AND-SET ON updated_at, reads its rows back, refuses a zero-row answer, and returns every refusal rather than throwing", () => {
  assert.deepEqual(saveShape(read("actions.ts")), { casUpdates: 1, plainUpdates: 0, throws: 0, zeroRowsRefused: true });
});

/**
 * On the customer page:
 *   - saveTokens: the third argument of each updateCateringCustomer call, a
 *     local alias resolved (`sending.token` where `const sending = edit`
 *     reads "edit.token"); "(none)" when there is none;
 *   - editToken: the `token` an edit is opened with, beside its form;
 *   - saveFlow: the save transition's statements, in order — each `if` that
 *     returns without closing the edit reads "refuse if <condition>";
 *   - guardArg: what useLeaveGuard is given, a local resolved to its value;
 *   - fieldsetLock: what disables the fieldset, and where that comes from;
 *   - inputs: form controls inside and outside that fieldset.
 */
function pageShape(source: string) {
  const file = parse(source, true);
  const values = new Map<string, string>();
  const arrays = new Map<string, string>();
  each(file, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer) return;
    if (ts.isIdentifier(n.name)) values.set(n.name.text, n.initializer.getText(file));
    if (ts.isArrayBindingPattern(n.name)) for (const el of n.name.elements)
      if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) arrays.set(el.name.text, n.initializer.getText(file));
  });
  const resolve = (e: ts.Expression) => {
    if (ts.isIdentifier(e)) return values.get(e.text) ?? e.text;
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression))
      return `${values.get(e.expression.text) ?? e.expression.text}.${e.name.text}`;
    return e.getText(file);
  };
  const isSaveCall = (n: ts.Node) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "updateCateringCustomer";

  const saveTokens: string[] = [];
  let editToken: string | null = null, guardArg: string | null = null, fieldsetLock: string | null = null;
  let saveFlow: string[] = [];
  let formFrozenAtMount = false;
  const inputs = { inside: 0, outside: 0 };
  each(file, (n) => {
    if (isSaveCall(n) && ts.isCallExpression(n)) saveTokens.push(n.arguments[2] ? resolve(n.arguments[2]) : "(none)");
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fn = n.expression.text;
      if (fn === "useLeaveGuard" && n.arguments[0]) guardArg = resolve(n.arguments[0]);
      // useState(() => formFromCustomer(customer)): the form taken once, when the page opened.
      if (fn === "useState" && n.arguments[0] && n.arguments[0].getText(file).includes("formFromCustomer")) formFrozenAtMount = true;
      if (fn === "setEdit" && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
        const token = n.arguments[0].properties.find((p) => p.name?.getText(file) === "token");
        if (token && ts.isPropertyAssignment(token)) editToken = token.initializer.getText(file);
      }
      // The transition whose callback makes the save.
      const cb = n.arguments[0];
      if (fn === "startTransition" && cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && ts.isBlock(cb.body) && contains(cb.body, isSaveCall)) {
        saveFlow = cb.body.statements.map((s) => {
          if (contains(s, isSaveCall)) return "await save";
          if (ts.isIfStatement(s) && lastStatementReturns(s.thenStatement) && !s.elseStatement
              && !contains(s.thenStatement, (x) => ts.isCallExpression(x) && x.expression.getText(file) === "setEdit"))
            return `refuse if ${s.expression.getText(file)}`;
          return ts.isExpressionStatement(s) ? s.getText(file) : ts.SyntaxKind[s.kind];
        });
      }
    }
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))) {
      const tag = n.tagName.getText(file);
      if (tag === "fieldset") {
        const attr = n.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(file) === "disabled");
        if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const e = attr.initializer.expression;
          fieldsetLock = ts.isIdentifier(e) && arrays.has(e.text) ? `${e.text} from ${arrays.get(e.text)}` : e.getText(file);
        }
      }
      if (tag === "input" || tag === "textarea" || tag === "select") {
        let p: ts.Node | undefined = n.parent;
        let inside = false;
        while (p) {
          if (ts.isJsxElement(p) && p.openingElement.tagName.getText(file) === "fieldset") { inside = true; break; }
          p = p.parent;
        }
        inputs[inside ? "inside" : "outside"]++;
      }
    }
  });
  return { saveTokens, editToken, saveFlow, guardArg, fieldsetLock, inputs, formFrozenAtMount };
}

test("the page check flags the old page, and the regressions the review tried", () => {
  const old = `export function CustomerDetailClient({ customer }) {
    const [form, setForm] = useState(() => formFromCustomer(customer));
    function save() { startTransition(async () => { await updateCateringCustomer(customer.id, form); }); }
    return (<div><input value={form.name} /></div>);
  }`;
  assert.deepEqual(pageShape(old), {
    saveTokens: ["(none)"], editToken: null, saveFlow: ["await save"], guardArg: null,
    fieldsetLock: null, inputs: { inside: 0, outside: 1 }, formFrozenAtMount: true,
  });
  // The review's mutant: the answer ignored, and the token taken from the page as it is now, not as the edit began.
  const page = (save: string, guard: string, lock: string, stray = "") => `export function CustomerDetailClient({ customer }) {
    const [isPending, startTransition] = useTransition();
    const [edit, setEdit] = useState(null);
    const dirty = edit !== null && customerFormDirty(edit.form, edit.start);
    useLeaveGuard(${guard});
    function startEdit() { const start = formFromCustomer(customer); setEdit({ form: start, start, token: customer.updated_at }); }
    function handleSave() {
      const sending = edit;
      startTransition(async () => {
        ${save}
        setEdit(null);
        router.refresh();
      });
    }
    return (<div><fieldset disabled={${lock}}><input /><textarea /></fieldset>${stray}</div>);
  }`;
  const ignored = page("const res = await updateCateringCustomer(customer.id, customerPayload(sending.form), customer.updated_at).catch(() => null);", "dirty", "isPending");
  assert.deepEqual(pageShape(ignored), {
    saveTokens: ["customer.updated_at"], editToken: "customer.updated_at",
    saveFlow: ["await save", "setEdit(null);", "router.refresh();"],
    guardArg: "edit !== null && customerFormDirty(edit.form, edit.start)",
    fieldsetLock: "isPending from useTransition()", inputs: { inside: 2, outside: 0 }, formFrozenAtMount: false,
  });
  const checked = `const res = await updateCateringCustomer(customer.id, customerPayload(sending.form), sending.token).catch(() => null);
        if (!res) { setError(1); return; }
        if (!res.ok) { setError(2); return; }`;
  // A guard and a lock wired to false, and an input left outside the lock.
  assert.deepEqual(pageShape(page(checked, "false", "false", "<input />")), {
    saveTokens: ["edit.token"], editToken: "customer.updated_at",
    saveFlow: ["await save", "refuse if !res", "refuse if !res.ok", "setEdit(null);", "router.refresh();"],
    guardArg: "false", fieldsetLock: "false", inputs: { inside: 2, outside: 1 }, formFrozenAtMount: false,
  });
});

test("THE CUSTOMER PAGE sends the token its edit started from, keeps the draft on any refusal, guards an unsaved edit, locks every input until the refresh has landed, and starts each edit from the customer as shown now", () => {
  assert.deepEqual(pageShape(read(CLIENT)), {
    saveTokens: ["edit.token"],
    editToken: "customer.updated_at",
    saveFlow: ["await save", "refuse if !res", "refuse if !res.ok", "setEdit(null);", "router.refresh();"],
    guardArg: "edit !== null && customerFormDirty(edit.form, edit.start)",
    fieldsetLock: "isPending from useTransition()",
    inputs: { inside: 8, outside: 0 },
    formFrozenAtMount: false,
  });
});
