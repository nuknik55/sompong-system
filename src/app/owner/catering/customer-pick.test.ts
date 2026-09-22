/**
 * Run with: npm test — the two customer rules that live in the ORDER and the
 * SHAPE of code rather than in a pure function, checked on the parsed source
 * as save-booking-lock.test.ts does, so a comment naming a call cannot satisfy
 * them. Each check first flags the old code's shape.
 *
 *   - Queue item 50: the list's pick is kept. The click handler used to call
 *     onPick, then onQueryChange with the name, and typing clears a pick.
 *   - Queue item 49: a booking save writes no customer's details. Every save
 *     used to write back the address and contact person the screen had
 *     loaded; a new customer now gets the name and phone typed, nothing more.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, f), "utf8");

function functionBody(file: ts.SourceFile, fnName: string): ts.Block | undefined {
  let body: ts.Block | undefined;
  file.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name?.text === fnName) body = n.body; });
  return body;
}

/**
 * In CustomerCombobox: for every click handler that calls onPick, the calls
 * it makes after it. Null when the component is not there.
 */
function callsAfterPick(source: string): string[][] | null {
  const file = ts.createSourceFile("shared.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = functionBody(file, "CustomerCombobox");
  if (!body) return null;
  const handlers: string[][] = [];
  const walk = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.name.getText(file) === "onClick" && n.initializer && ts.isJsxExpression(n.initializer)
        && n.initializer.expression && ts.isArrowFunction(n.initializer.expression)) {
      const calls: string[] = [];
      const collect = (m: ts.Node) => { if (ts.isCallExpression(m) && ts.isIdentifier(m.expression)) calls.push(m.expression.text); m.forEachChild(collect); };
      collect(n.initializer.expression.body);
      const at = calls.indexOf("onPick");
      if (at >= 0) handlers.push(calls.slice(at + 1));
    }
    n.forEachChild(walk);
  };
  walk(body);
  return handlers;
}

const combobox = (pick: string, clear: string) => `export function CustomerCombobox({ onPick, onQueryChange }) {
  return (<div>
    <button type="button" onClick={() => { ${clear} }}>ล้าง</button>
    <button type="button" onClick={() => { ${pick} }}>x</button>
  </div>);
}`;

test("the pick check flags a pick undone by the name, and passes one kept", () => {
  assert.deepEqual(callsAfterPick(combobox("onPick(c); onQueryChange(c.name); setOpen(false);", "onPick(null); onQueryChange(\"\"); setOpen(false);")),
    [["onQueryChange", "setOpen"], ["onQueryChange", "setOpen"]]);
  assert.deepEqual(callsAfterPick(combobox("onPick(c); setOpen(false);", "onPick(null); setOpen(false);")), [["setOpen"], ["setOpen"]]);
  assert.equal(callsAfterPick("export function Other() { return null; }"), null);
});

test("THE LIST'S PICK IS KEPT: nothing the combobox calls after onPick can clear it (queue item 50)", () => {
  const handlers = callsAfterPick(read("shared.tsx"));
  assert.ok(handlers, "CustomerCombobox not found in shared.tsx");
  assert.equal(handlers.length, 2, "a pick and a clear, each calling onPick");
  for (const after of handlers) assert.equal(after.includes("onQueryChange"), false, `after onPick: ${after.join(", ")}`);
});

/** Every write on catering_customers inside `fnName`: the method, and for an insert the keys it writes. */
function customerWrites(source: string, fnName: string): { method: string; keys: string[] | null }[] | null {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const body = functionBody(file, fnName);
  if (!body) return null;
  const out: { method: string; keys: string[] | null }[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
        && ["insert", "update", "upsert", "delete"].includes(n.expression.name.text)) {
      let inner: ts.Expression = n.expression.expression;
      while (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text !== "from") {
        inner = inner.expression.expression;
      }
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "from"
          && inner.arguments[0] && ts.isStringLiteral(inner.arguments[0]) && inner.arguments[0].text === "catering_customers") {
        const arg = n.arguments[0];
        const keys = arg && ts.isObjectLiteralExpression(arg)
          ? arg.properties.map((p) => (p.name ? p.name.getText(file) : "?")).sort()
          : null;
        out.push({ method: n.expression.name.text, keys });
      }
    }
    n.forEachChild(walk);
  };
  walk(body);
  return out;
}

test("the customer-write check flags the old save's update and its wide insert", () => {
  const old = `async function upsertCateringEvent(data) {
    const { data: created } = await supabase.from("catering_customers").insert({ name: n, phone: p, address: data.new_customer.address, contact_person: c }).select("id").single();
    const { error } = await supabase.from("catering_customers").update({ address: a, contact_person: c }).eq("id", customerId);
    const { data: named } = await supabase.from("catering_customers").select("id, name, phone").ilike("name", n);
  }`;
  assert.deepEqual(customerWrites(old, "upsertCateringEvent"), [
    { method: "insert", keys: ["address", "contact_person", "name", "phone"] },
    { method: "update", keys: ["address", "contact_person"] },
  ]);
});

test("A BOOKING SAVE WRITES NO CUSTOMER'S DETAILS: its one customer write adds a new customer with the name and phone (queue item 49)", () => {
  assert.deepEqual(customerWrites(read("actions.ts"), "upsertCateringEvent"), [{ method: "insert", keys: ["name", "phone"] }]);
});

/** Every top-level function of a file, by name. */
function functionNames(source: string): string[] {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  file.forEachChild((n) => { if (ts.isFunctionDeclaration(n) && n.name) names.push(n.name.text); });
  return names;
}

test("THE CUSTOMER PAGE IS THE ONE PLACE A CUSTOMER'S DETAILS CHANGE: no other function in the catering actions writes a customer", () => {
  // Wider than the booking save alone (review, 2026-09-22): a customer write
  // added to saveBooking, or to a helper it calls, is caught here too.
  const src = read("actions.ts");
  const writers = Object.fromEntries(functionNames(src)
    .map((fn) => [fn, customerWrites(src, fn) ?? []] as const)
    .filter(([, w]) => w.length > 0));
  assert.deepEqual(writers, {
    updateCateringCustomer: [{ method: "update", keys: ["address", "company_name", "contact_person", "line_id", "name", "note", "phone", "tax_id"] }],
    upsertCateringEvent: [{ method: "insert", keys: ["name", "phone"] }],
  });
});

test("AND NO OTHER FILE in src writes the customers table", () => {
  const srcRoot = path.resolve(here, "../../..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.ts$/.test(e.name) || p === path.join(here, "actions.ts")) continue;
      const text = fs.readFileSync(p, "utf8");
      if (!text.includes("catering_customers")) continue;
      const file = ts.createSourceFile(e.name, text, ts.ScriptTarget.Latest, true, e.name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["insert", "update", "upsert", "delete"].includes(n.expression.name.text)
            && n.expression.getText(file).includes("catering_customers")) offenders.push(`${path.relative(srcRoot, p)}: .${n.expression.name.text}`);
        n.forEachChild(visit);
      };
      visit(file);
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, []);
});

/** In `fnName`: where the room-conflict check, the new customer's insert and the booking row's write start. */
function customerInsertOrder(source: string, fnName: string): { roomCheck: number; customerInsert: number; bookingWrite: number } | null {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const body = functionBody(file, fnName);
  if (!body) return null;
  let roomCheck = -1, customerInsert = -1, bookingWrite = -1;
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "findRoomConflict" && roomCheck < 0) roomCheck = n.getStart(file);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["insert", "update"].includes(n.expression.name.text)) {
      const chain = n.expression.expression.getText(file);
      if (chain.includes("\"catering_customers\"") && n.expression.name.text === "insert" && customerInsert < 0) customerInsert = n.getStart(file);
      if (chain.includes("\"catering_events\"") && bookingWrite < 0) bookingWrite = n.getStart(file);
    }
    n.forEachChild(walk);
  };
  walk(body);
  return { roomCheck, customerInsert, bookingWrite };
}

test("A SAVE REFUSED BEFORE ITS BOOKING ROW ADDS NOBODY: the new customer is inserted after the room check, right before the row", () => {
  // The control: the old order, customer first.
  const old = `async function upsertCateringEvent(data) {
    const { data: c } = await supabase.from("catering_customers").insert({ name: n, phone: p }).select("id").single();
    const conflict = findRoomConflict(v, s, e, candidates);
    await supabase.from("catering_events").update(payload).eq("id", id);
  }`;
  const o = customerInsertOrder(old, "upsertCateringEvent")!;
  assert.ok(o.customerInsert < o.roomCheck, "the control has the customer first");
  const now = customerInsertOrder(read("actions.ts"), "upsertCateringEvent");
  assert.ok(now, "upsertCateringEvent not found");
  assert.ok(now.roomCheck >= 0 && now.customerInsert >= 0 && now.bookingWrite >= 0, JSON.stringify(now));
  assert.ok(now.roomCheck < now.customerInsert && now.customerInsert < now.bookingWrite, JSON.stringify(now));
});

/** The functions `fnName` calls, by name. */
function callsIn(source: string, fnName: string): string[] | null {
  const file = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const body = functionBody(file, fnName);
  if (!body) return null;
  const names: string[] = [];
  const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.push(n.expression.text); n.forEachChild(walk); };
  walk(body);
  return names;
}

test("A TYPED NAME IS MATCHED BY THE ONE RULE against every customer — never the first customer of the name (queue item 50)", () => {
  const calls = callsIn(read("actions.ts"), "upsertCateringEvent");
  assert.ok(calls, "upsertCateringEvent not found");
  assert.ok(calls.includes("matchTypedCustomer"), "the typed name goes through matchTypedCustomer");
  assert.ok(calls.includes("fetchAllRows"), "over every customer on file, paged, not a LIKE pattern");
  // The control: the old save called neither.
  const old = `async function upsertCateringEvent(data) { const m = await db.from("catering_customers").select("id").ilike("name", n); const existing = m.find((x) => x.phone === p) ?? m[0]; }`;
  const oldCalls = callsIn(old, "upsertCateringEvent") ?? [];
  assert.equal(oldCalls.includes("matchTypedCustomer") || oldCalls.includes("fetchAllRows"), false);
});
