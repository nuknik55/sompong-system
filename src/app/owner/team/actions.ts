"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toAuthEmail } from "@/lib/identity";
import type { Role } from "@/lib/auth";

export type CreateUserResult = { error?: string };

export async function createUser(
  fullName: string,
  username: string,
  password: string,
  role: Role
): Promise<CreateUserResult> {
  const me = await requireAdmin();

  if (!fullName.trim() || !username.trim() || password.length < 6) {
    return { error: "กรุณากรอกชื่อ, ชื่อผู้ใช้ และรหัสผ่านอย่างน้อย 6 ตัวอักษร" };
  }
  if (role === "owner" && me.role !== "owner") {
    return { error: "เฉพาะ Owner เท่านั้นที่สร้างบัญชี Owner ได้" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: toAuthEmail(username),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName.trim() },
  });

  if (error || !data.user) {
    return { error: error?.message ?? "สร้างบัญชีไม่สำเร็จ" };
  }

  // DB trigger inserts profile with role='staff'; set name/role here
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim(), role })
    .eq("id", data.user.id);

  if (profileError) {
    return { error: `สร้างบัญชีสำเร็จ แต่ตั้งชื่อ/สิทธิ์ไม่สำเร็จ: ${profileError.message}` };
  }

  revalidatePath("/owner/team");
  return {};
}

export type ActionResult = { error?: string };

async function countAdmins(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return count ?? 0;
}

async function countOwners(supabase: Awaited<ReturnType<typeof createClient>>): Promise<number> {
  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");
  return count ?? 0;
}

export async function updateUserRole(userId: string, role: Role): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data: current } = await supabase.from("profiles").select("role").eq("id", userId).single();

  // Promote to owner: owner-only action
  if (role === "owner" && me.role !== "owner") {
    return { error: "เฉพาะ Owner เท่านั้นที่ตั้งสิทธิ์ Owner ได้" };
  }
  // Demote owner: owner-only action
  if (current?.role === "owner" && me.role !== "owner") {
    return { error: "ไม่สามารถเปลี่ยนสิทธิ์บัญชี Owner ได้" };
  }
  // Last-owner guard: blocks everyone including owners
  if (current?.role === "owner" && role !== "owner") {
    if ((await countOwners(supabase)) <= 1) {
      return { error: "ต้องมี Owner อย่างน้อย 1 คนในระบบ ไม่สามารถเปลี่ยนสิทธิ์ Owner คนสุดท้ายได้" };
    }
  }
  // Last-admin guard
  if (role !== "admin" && current?.role === "admin" && (await countAdmins(supabase)) <= 1) {
    return { error: "ต้องมี Admin อย่างน้อย 1 คนในระบบ ไม่สามารถลดสิทธิ์ Admin คนสุดท้ายได้" };
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/owner/team");
  return {};
}

export async function updateUserDetails(
  userId: string,
  fields: { fullName: string; username: string }
): Promise<ActionResult> {
  await requireAdmin();

  if (!fields.fullName.trim() || !fields.username.trim()) {
    return { error: "กรุณากรอกชื่อและชื่อผู้ใช้" };
  }

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: toAuthEmail(fields.username),
  });
  if (authError) return { error: authError.message };

  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fields.fullName.trim() })
    .eq("id", userId);
  if (profileError) return { error: profileError.message };

  revalidatePath("/owner/team");
  return {};
}

/** Owner can change any password; Admin can only change staff/editor passwords. */
export async function changePassword(userId: string, newPassword: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (newPassword.length < 6) return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };

  if (me.role !== "owner" && userId !== me.id) {
    const supabase = await createClient();
    const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).single();
    if (target?.role === "owner" || target?.role === "admin") {
      return { error: "Admin สามารถเปลี่ยนรหัสผ่านได้เฉพาะ Staff, Editor และตัวเองเท่านั้น" };
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };
  return {};
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();

  const { data: current } = await supabase.from("profiles").select("role").eq("id", userId).single();

  // Deleting owner: owner-only action
  if (current?.role === "owner" && me.role !== "owner") {
    return { error: "ไม่สามารถลบบัญชี Owner ได้" };
  }
  // Deleting admin: owner-only action
  if (current?.role === "admin" && me.role !== "owner") {
    return { error: "เฉพาะ Owner เท่านั้นที่ลบบัญชี Admin ได้" };
  }
  // Last-owner guard
  if (current?.role === "owner" && (await countOwners(supabase)) <= 1) {
    return { error: "ต้องมี Owner อย่างน้อย 1 คนในระบบ ไม่สามารถลบ Owner คนสุดท้ายได้" };
  }
  // Last-admin guard
  if (current?.role === "admin" && (await countAdmins(supabase)) <= 1) {
    return { error: "ต้องมี Admin อย่างน้อย 1 คนในระบบ ไม่สามารถลบ Admin คนสุดท้ายได้" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  revalidatePath("/owner/team");
  return {};
}
