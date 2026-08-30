import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Swaps the sort_order of two rows ATOMICALLY.
 *
 * Every reorder in this codebase used to be two separate .update() calls. Each
 * is its own PostgREST request in its own transaction, so if the first landed
 * and the second failed, both rows ended up holding the SAME sort_order — the
 * second row's value was exactly what the first one wrote. ORDER BY then has an
 * undefined tiebreak between them, which the user sees as "the button did
 * nothing". It repairs itself on the next successful reorder and nothing is
 * lost, but it is avoidable.
 *
 * A single upsert carrying both rows is one POST, which PostgREST compiles to
 * one INSERT ... ON CONFLICT DO UPDATE — a single statement, hence a single
 * transaction. Both rows move or neither does.
 *
 * WHY WHOLE ROWS: sending just the primary key and sort_order does not work.
 * Postgres evaluates NOT NULL while forming the tuple, BEFORE ON CONFLICT is
 * resolved, so a partial payload dies with 23502 on the INSERT path even though
 * it would only ever have taken the UPDATE path. Verified against all four
 * tables this is used on.
 *
 * THE COST OF THAT: because whole rows are written back, a reorder is a
 * last-write-wins update of every column. If someone edits the same row between
 * this function's read and its upsert, their edit is reverted. These are
 * admin-only settings pages with one or two concurrent users and the window is
 * sub-second, and the worst case is one label visibly reverting rather than
 * data being lost — an accepted trade, not an oversight.
 *
 * Do NOT reintroduce an rpc() here. `swap_supplier_order` was called by
 * reorderSupplier for a long time and never existed in the database
 * (PGRST202), so its "fallback" ran on every single reorder while looking like
 * the one properly-handled case.
 */
export async function swapSortOrder(
  supabase: Supabase,
  table: string,
  pkColumn: string,
  keyA: string,
  keyB: string,
): Promise<void> {
  const { data: rows, error: readErr } = await supabase
    .from(table)
    .select("*")
    .in(pkColumn, [keyA, keyB]);
  if (readErr) throw new Error(readErr.message);

  const rowA = rows?.find((r) => r[pkColumn] === keyA);
  const rowB = rows?.find((r) => r[pkColumn] === keyB);
  if (!rowA || !rowB) throw new Error("ไม่พบรายการที่จะสลับลำดับ");

  const { error } = await supabase
    .from(table)
    .upsert([
      { ...rowA, sort_order: rowB.sort_order },
      { ...rowB, sort_order: rowA.sort_order },
    ], { onConflict: pkColumn });
  if (error) throw new Error(error.message);
}
