import "server-only";
import { createClient } from "@/lib/supabase/server";

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

export async function getPendingCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("pending_changes")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
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

  return data.map((d) => ({
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
