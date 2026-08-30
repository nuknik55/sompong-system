/**
 * Flags a Supabase write whose error is discarded.
 *
 * WHY THIS RULE EXISTS. The Supabase client does not throw on a failed write —
 * it RESOLVES with `{ data, error }`. So this compiles, type-checks, passes
 * review, and silently does nothing when the write fails:
 *
 *     await supabase.from("attendance_daily").upsert(rows);
 *
 * An audit of src/ found 133 call sites discarding errors this way. The damage
 * was not hypothetical: an approval flow marked changes APPROVED after writes
 * that never landed; three delete-then-insert "replace" functions could append
 * instead of replace, producing a quotation with every line item twice; a leave
 * request could be saved while the attendance_daily rows that payroll actually
 * reads were not; and a permission check that failed open let a non-owner write
 * a sensitive account. Every one of those looked like success at the call site.
 *
 * SCOPE: writes only — insert / update / upsert / delete. Reads are excluded on
 * purpose. Plenty of reads are RIGHT to fall back (lib/auth.ts resolving to null
 * and redirecting to /login is the safe direction), so a rule covering reads
 * would be mostly false positives. Reads whose result GATES a write are the
 * dangerous ones, and no linter can tell those apart — that judgement stays
 * human.
 *
 * WHAT COUNTS AS CHECKED: destructuring `error`. The rule does not verify you
 * then act on it — `@typescript-eslint/no-unused-vars` covers destructuring it
 * and ignoring it. Passing the query somewhere else (into a helper like
 * approve/actions.ts's `run()`, into `Promise.all([...])`, or returning it) is
 * also accepted, since the caller is then responsible.
 */

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** True for `supabase.from("t")…insert|update|upsert|delete(…)…` in any chain order. */
function isSupabaseWriteChain(node) {
  let hasWrite = false;
  let hasFrom = false;
  let cur = node;
  while (cur && cur.type === "CallExpression") {
    const callee = cur.callee;
    if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") break;
    const name = callee.property.name;
    if (WRITE_METHODS.has(name)) hasWrite = true;
    if (name === "from") hasFrom = true;
    cur = callee.object;
  }
  return hasWrite && hasFrom;
}

/** True if the destructuring pattern binds `error` (renamed or not), or is not an object pattern. */
function patternBindsError(pattern) {
  if (!pattern || pattern.type !== "ObjectPattern") return true;
  return pattern.properties.some(
    (p) =>
      p.type === "RestElement" ||
      (p.type === "Property" && p.key.type === "Identifier" && p.key.name === "error"),
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the error of a Supabase write to be destructured; a failed write resolves rather than throwing, so an unchecked one fails silently.",
    },
    schema: [],
    messages: {
      unchecked:
        "ผลลัพธ์ของการเขียนฐานข้อมูลนี้ถูกทิ้ง — Supabase ไม่ throw เมื่อเขียนไม่สำเร็จ จึงล้มเหลวแบบเงียบ ๆ. " +
        "Discarded Supabase write result. A failed write RESOLVES with { error } rather than throwing, so this " +
        "silently does nothing on failure. Destructure `const { error } = await …` and act on it.",
    },
  },

  create(context) {
    return {
      AwaitExpression(node) {
        if (node.argument?.type !== "CallExpression") return;
        if (!isSupabaseWriteChain(node.argument)) return;

        // Walk out through constructs that just forward the value along, so the
        // ternary form `const { error } = x ? await a : await b` is recognised.
        let cur = node;
        let parent = cur.parent;
        while (
          parent &&
          (parent.type === "ConditionalExpression" ||
            parent.type === "TSAsExpression" ||
            parent.type === "TSNonNullExpression")
        ) {
          cur = parent;
          parent = parent.parent;
        }
        if (!parent) return;

        // Bare statement — the result goes nowhere at all.
        if (parent.type === "ExpressionStatement") {
          context.report({ node, messageId: "unchecked" });
          return;
        }
        if (parent.type === "VariableDeclarator" && parent.init === cur) {
          if (!patternBindsError(parent.id)) context.report({ node, messageId: "unchecked" });
          return;
        }
        if (parent.type === "AssignmentExpression" && parent.right === cur) {
          if (!patternBindsError(parent.left)) context.report({ node, messageId: "unchecked" });
          return;
        }
        // Returned, passed as an argument, or put in an array — someone else owns it.
      },
    };
  },
};
