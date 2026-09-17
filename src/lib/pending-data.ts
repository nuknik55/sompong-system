import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPrepVisibility } from "@/lib/prep-access";

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
 * request nobody could find. (This is the SCREEN's filter. The table's read
 * policy still lets any admin read such a row through the API; queue item
 * 31.)
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

/**
 * Which prep recipe a pending change is about, or null when it is not about
 * one. Used to keep a prep's composition out of the approve queue for an
 * admin who has not been granted that recipe — a recipe_edit payload carries
 * the entire item list.
 */
export function prepIdOfChange(changeType: string, targetId: string, payload: PendingPayload): string | null {
  const p = payload as Record<string, unknown>;
  if (changeType === "recipe_edit") return p.target === "prep" ? (p.parentId as string) ?? targetId : null;
  if (changeType === "prep_yield_edit") return targetId;
  if (changeType === "prep_delete") return (p.prepId as string) ?? targetId;
  // A DUPLICATE is about its source: approving it copies the source's lines,
  // which approveChange refuses unless the approver can see that prep, and
  // the payload carries the source's yield. A plain new prep is about nothing
  // hidden.
  if (changeType === "prep_create") return typeof p.duplicatedFrom === "string" ? p.duplicatedFrom : null;
  return null;
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
      payload: d.payload as PendingPayload,
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
  const { error } = await supabase
    .from("pending_changes")
    .update({ status, admin_note: adminNote ?? null, resolved_at: new Date().toISOString(), resolved_by: adminId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
