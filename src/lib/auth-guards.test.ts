/**
 * Run with: npm test — what each page and action guard in ./auth.ts ACTUALLY
 * admits, run as every role (2026-09-25).
 *
 * AGENTS.md's "App guards" table says who each guard admits, and every page,
 * action and cost rule leans on it. Nothing tested it: a role added to one
 * list (sales to requireAdminOrEditor, say) would have passed tsc, lint, the
 * tests and the build. auth.ts cannot be imported here as it is — it imports
 * "server-only", Next's redirect and the Supabase server client — so the
 * SHIPPED source is transpiled and run with those three replaced by stand-ins
 * (a redirect that throws where it would send the person, and a client that
 * returns the signed-in user and profile under test). The role rules
 * themselves are the file's own code, and order-rules.ts is the real module.
 *
 * The stand-in client answers only what getCurrentProfile asks; any other
 * call throws, so a guard that started reading something else fails here
 * instead of passing on a guess.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as orderRules from "./order-rules.ts";
import * as schemaFallback from "./schema-fallback.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, "auth.ts"), "utf8");

class Redirected extends Error {
  to: string;
  constructor(to: string) { super("redirect " + to); this.to = to; }
}

type Who = { user: { id: string } | null; profile: { id: string; full_name: string; role: string; employee_id: null } | null };

/** The module's exports, built from `source` with the stand-ins; `who` is read at call time. */
function load(source: string, current: { who: Who }) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const client = {
    auth: { getUser: async () => ({ data: { user: current.who.user } }) },
    from(table: string) {
      // The เห็นต้นทุน switch, read for an editor by its own id: off here. No
      // guard depends on it (lib/cost-access.ts decides what cost is shown).
      if (table === "profile_cost_access") {
        const c = {
          select: () => c,
          eq: (col: string, v: string) => {
            if (col !== "profile_id" || v !== current.who.user?.id) throw new Error("the switch was read by an unexpected key");
            return c;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return c;
      }
      if (table !== "profiles") throw new Error("the guard read an unexpected table: " + table);
      const q = {
        select: () => q,
        eq: (col: string, v: string) => {
          if (col !== "id" || v !== current.who.user?.id) throw new Error("the guard read profiles by an unexpected key");
          return q;
        },
        maybeSingle: async () => ({ data: current.who.profile, error: null }),
      };
      return q;
    },
  };
  const stubs: Record<string, unknown> = {
    "server-only": {},
    // React's request cache: a pass-through here, so every call is fresh.
    react: { cache: <T,>(f: T) => f },
    "next/navigation": { redirect: (to: string) => { throw new Redirected(to); } },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/order-rules": orderRules,
    "@/lib/schema-fallback": schemaFallback,
  };
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (!(id in stubs)) throw new Error("auth.ts imports something this test does not stand in for: " + id);
    return stubs[id];
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports as Record<string, (...a: unknown[]) => Promise<unknown>>;
}

const ROLES = ["owner", "admin", "editor", "staff", "hr", "sales"] as const;
const GUARDS = ["requireProfile", "requireOwner", "requireAdmin", "requireAdminOrEditor", "requireHR", "requireHROrAdmin", "requireSales", "requireOrdering"] as const;

const signedIn = (role: string): Who => ({ user: { id: "u-1" }, profile: { id: "u-1", full_name: "x", role, employee_id: null } });

/** guard -> who (a role, "no-profile", "signed-out", "unknown-role") -> "ok" or where it sends them. */
async function matrix(source: string): Promise<Record<string, Record<string, string>>> {
  const current = { who: signedIn("owner") };
  const m = load(source, current);
  const out: Record<string, Record<string, string>> = {};
  const whos: [string, Who][] = [
    ...ROLES.map((r) => [r, signedIn(r)] as [string, Who]),
    ["unknown-role", signedIn("accounting")],
    ["no-profile", { user: { id: "u-1" }, profile: null }],
    ["signed-out", { user: null, profile: null }],
  ];
  for (const g of GUARDS) {
    out[g] = {};
    for (const [label, who] of whos) {
      current.who = who;
      try {
        const p = (await m[g]()) as { role: string };
        assert.equal(p.role, who.profile?.role, `${g} returned another profile than the signed-in one`);
        out[g][label] = "ok";
      } catch (e) {
        if (!(e instanceof Redirected)) throw e;
        out[g][label] = "→" + e.to;
      }
    }
  }
  return out;
}

/** Who each guard admits, as AGENTS.md's "App guards" table states it; everyone else is sent to `away`. */
const EXPECTED: Record<(typeof GUARDS)[number], { admits: string[]; away: string }> = {
  requireProfile:       { admits: ["owner", "admin", "editor", "staff", "hr", "sales", "unknown-role"], away: "/login" },
  requireOwner:         { admits: ["owner"], away: "/owner" },
  requireAdmin:         { admits: ["owner", "admin"], away: "/staff" },
  requireAdminOrEditor: { admits: ["owner", "admin", "editor"], away: "/staff" },
  requireHR:            { admits: ["owner", "hr"], away: "/owner" },
  requireHROrAdmin:     { admits: ["owner", "hr", "admin"], away: "/staff" },
  requireSales:         { admits: ["owner", "admin", "sales"], away: "/staff" },
  requireOrdering:      { admits: ["owner", "admin", "editor", "staff"], away: "/" },
};

function expectedMatrix(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const g of GUARDS) {
    out[g] = {};
    for (const who of [...ROLES, "unknown-role", "no-profile", "signed-out"]) {
      // No session, or a login with no profile row, never gets past requireProfile.
      out[g][who] = who === "no-profile" || who === "signed-out" ? "→/login"
        : EXPECTED[g].admits.includes(who) ? "ok" : "→" + EXPECTED[g].away;
    }
  }
  return out;
}

test("every guard admits exactly the roles AGENTS.md lists, and sends everyone else where it says", async () => {
  assert.deepEqual(await matrix(SOURCE), expectedMatrix());
});

test("a role this app does not know (e.g. accounting, not implemented) passes only requireProfile", async () => {
  const m = await matrix(SOURCE);
  for (const g of GUARDS) assert.equal(m[g]["unknown-role"] === "ok", g === "requireProfile", g);
});

test("sales reaches catering and nothing that guards cost, salary or ordering", async () => {
  const m = await matrix(SOURCE);
  assert.equal(m.requireSales.sales, "ok");
  for (const g of ["requireOwner", "requireAdmin", "requireAdminOrEditor", "requireHR", "requireHROrAdmin", "requireOrdering"]) {
    assert.notEqual(m[g].sales, "ok", `${g} admits sales`);
  }
});

test("the check can fail: a guard widened by one role is caught", async () => {
  // The shape of the mistake this test exists for: sales slipped into a list.
  const widened = SOURCE.replace(`["owner", "admin", "editor"].includes(profile.role)`, `["owner", "admin", "editor", "sales"].includes(profile.role)`);
  assert.notEqual(widened, SOURCE, "the mutation must change the source, or this test proves nothing");
  const m = await matrix(widened);
  assert.equal(m.requireAdminOrEditor.sales, "ok");
  assert.notDeepEqual(m, expectedMatrix());
});

test("the check can fail: a negative check (block one role) admits every role it does not name", async () => {
  const negative = SOURCE.replace(`if (profile.role !== "owner" && profile.role !== "hr") redirect("/owner");`, `if (profile.role === "staff") redirect("/owner");`);
  assert.notEqual(negative, SOURCE);
  const m = await matrix(negative);
  assert.equal(m.requireHR.sales, "ok", "the negative check lets sales into an hr page");
  assert.notDeepEqual(m, expectedMatrix());
});
