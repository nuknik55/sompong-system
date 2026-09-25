export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageShell } from "@/components/ui/page";
import { getDishCostOptions } from "../dish-costs";
import { DesignClient, type DraftSet } from "./DesignClient";

// ── ออกแบบชุดเมนู — the set-menu design workspace (Nik, 2026-09-24) ──────────
//
// Trial sets side by side, each with its cost per table against its price.
// OWNER AND ADMIN ONLY: it shows cost (requireAdmin, and the per-dish cost is
// computed once on the server by getDishCostOptions, as the set editor's).
// A trial set is a set with is_draft = true: sales never sees one (the
// database hides the row and its dishes), no booking can use one, and no
// document can print one.

export default async function SetMenuDesignPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [draftsRes, realRes, dishOptions] = await Promise.all([
    supabase
      .from("catering_set_menus")
      .select("id, name, price_per_set, updated_at, catering_set_menu_items(menu_id, dish_name, linked_menu_id, quantity, section, note, sort_order)")
      .eq("is_draft", true)
      .order("created_at")
      .order("id"),
    supabase.from("catering_set_menus").select("id, name").eq("is_draft", false).order("name"),
    getDishCostOptions(),
  ]);
  if (draftsRes.error) throw draftsRes.error;
  if (realRes.error) throw realRes.error;

  type Item = { menu_id: string | null; dish_name: string | null; linked_menu_id: string | null; quantity: number; section: string; note: string | null; sort_order: number };
  const drafts: DraftSet[] = (draftsRes.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    price: Number(r.price_per_set ?? 0),
    updated_at: r.updated_at as string,
    items: ((r.catering_set_menu_items as Item[] | null) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => ({ menu_id: it.menu_id, dish_name: it.dish_name, linked_menu_id: it.linked_menu_id, quantity: Number(it.quantity), section: it.section, note: it.note })),
  }));

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />
      {/* Never remounted: the client folds a changed list into its columns
          and keeps every column's unsaved edits (DesignClient merge). */}
      <DesignClient
        drafts={drafts}
        realSets={(realRes.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }))}
        dishOptions={dishOptions}
      />
    </PageShell>
  );
}
