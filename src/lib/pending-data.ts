import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPrepVisibility } from "@/lib/prep-access";
import { prepIdOfChange } from "@/lib/pending-prep-id";

export { prepIdOfChange };

export type ChangeType =
  | "recipe_edit"
  | "prep_yield_edit"
  | "menu_create"
  | "menu_delete"
  | "prep_create"
  | "prep_delete"
  | "ingredient_edit"
  | "ingredient_create"
  | "ingredient_delete"
  | "ingredient_category_delete"
  | "sop_upsert"
  | "sop_delete";

// Payload shapes per change_type — stored as JSONB in DB
export type PendingPayload = Record<string, unknown>;

export type PendingStatus = "pending" | "approved" | "rejected";

export type PendingChange = {
  id: string;
  editorId: string;
  editorName: string;
  changeType: ChangeType;
  targetId: string;
  payload: PendingPayload;
  status: PendingStatus;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export async function savePendingChange(
  editorId: string,
  changeType: ChangeType,
  targetId: string,
  payload: PendingPayload
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pending_changes")
    .insert({ editor_id: editorId, change_type: changeType, target_id: targetId, payload })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * The header badge. It counts what the approve queue would show this
 * person, with the same filter: a request about a prep they cannot see is
 * neither listed nor counted, since counting it would show a pending
 * request nobody could find. (This is the SCREEN's filter. The table's own
 * read policy hides the same rows once
 * supabase/permissions_batch_2026_09_17.sql has run; queue item 31.
 * The one difference is described in pending-prep-id.ts.)
 *
 * Never throws: the owner layout renders it on every page. If visibility
 * cannot be worked out, prep requests are simply not counted.
 */
export async function getPendingCount(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pending_changes")
    .select("change_type, target_id, payload")
    .eq("status", "pending");
  if (!data || data.length === 0) return 0;
  const prepIds = data.map((r) => prepIdOfChange(r.change_type as string, r.target_id as string, r.payload as PendingPayload));
  // Most requests are about no prep; skip the grant read then, since the
  // owner layout calls this on every page.
  if (prepIds.every((x) => x === null)) return data.length;
  let canSee: (id: string) => boolean = () => false;
  try {
    canSee = (await getPrepVisibility()).canSee;
  } catch {
    // leave canSee closed
  }
  return prepIds.filter((x) => x === null || canSee(x)).length;
}

export async function getPendingList(): Promise<PendingChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pending_changes")
    .select("id, editor_id, change_type, target_id, payload, status, admin_note, created_at, resolved_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const editorIds = [...new Set(data.map((d) => d.editor_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", editorIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const prepVisibility = await getPrepVisibility();

  return data
    .filter((d) => {
      const prepId = prepIdOfChange(d.change_type as string, d.target_id, d.payload as PendingPayload);
      return prepId === null || prepVisibility.canSee(prepId);
    })
    .map((d) => ({
      id: d.id,
      editorId: d.editor_id,
      editorName: nameById.get(d.editor_id) ?? "ไม่ทราบชื่อ",
      changeType: d.change_type as ChangeType,
      targetId: d.target_id,
      // Only an object is a payload the screen can read; anything else is
      // shown as empty rather than breaking the page for every approver.
      payload: (d.payload && typeof d.payload === "object" && !Array.isArray(d.payload) ? d.payload : {}) as PendingPayload,
      status: d.status as PendingStatus,
      adminNote: d.admin_note,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
    }));
}

export async function resolvePendingChange(
  id: string,
  status: "approved" | "rejected",
  adminId: string,
  adminNote?: string
): Promise<void> {
  const supabase = await createClient();
  // Counted: a status write the table's policies refuse updates 0 rows with
  // no error, and a change must not look resolved when it is not.
  const { error, count } = await supabase
    .from("pending_changes")
    .update({ status, admin_note: adminNote ?? null, resolved_at: new Date().toISOString(), resolved_by: adminId }, { count: "exact" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (count !== 1) throw new Error("ฐานข้อมูลไม่อนุญาตให้เปลี่ยนสถานะคำขอนี้");
}
