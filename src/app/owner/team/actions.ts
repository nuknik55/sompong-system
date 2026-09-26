"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toAuthEmail } from "@/lib/identity";
import { createRefusal, isBanned, lastActiveRefusal, teamRefusal, type TeamAccount } from "@/lib/team-rules";
import { listAllAuthUsers } from "@/lib/auth-users";
import type { Role } from "@/lib/auth";

export type CreateUserResult = { error?: string };

/**
 * profiles.employee_id is UNIQUE, so a second account pointing at the same
 * employee fails with a raw Postgres 23505. Checked up front instead — in
 * createUser especially, the auth.users row is created first, so hitting the
 * constraint later would leave an orphaned login behind.
 */
async function employeeAlreadyLinked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  exceptUserId?: string,
): Promise<boolean> {
  let query = supabase.from("profiles").select("id").eq("employee_id", employeeId);
  if (exceptUserId) query = query.neq("id", exceptUserId);
  const { data } = await query.limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * The account an action is about, for teamRefusal. Fails CLOSED: before
 * item 29, changePassword read the target, discarded the error, and a failed
 * read let the reset through. A target that cannot be read is refused.
 *
 * Whether it holds prep grants is read with the SERVICE ROLE: an admin's
 * own session sees only its own grant rows, so the same read through it
 * would answer "none" for everyone and fail open.
 */
async function readTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ target: TeamAccount; error?: undefined } | { error: string }> {
  const { data, error } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (error) return { error: `ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่ดำเนินการ: ${error.message}` };
  if (!data) return { error: "ไม่พบบัญชีนี้" };
  const { count, error: grantError } = await createAdminClient()
    .from("prep_recipe_access")
    .select("profile_id", { count: "exact", head: true })
    .eq("profile_id", userId);
  if (grantError) return { error: `ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่ดำเนินการ: ${grantError.message}` };
  if (count == null) return { error: "ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่ดำเนินการ" };
  return { target: { id: data.id, role: data.role, holdsPrepGrants: count > 0 } };
}

export async function createUser(
  fullName: string,
  username: string,
  password: string,
  role: Role,
  employeeId: string | null = null
): Promise<CreateUserResult> {
  const me = await requireAdmin();

  if (!fullName.trim() || !username.trim() || password.length < 6) {
    return { error: "กรุณากรอกชื่อ, ชื่อผู้ใช้ และรหัสผ่านอย่างน้อย 6 ตัวอักษร" };
  }
  // Before the login is created: a refusal after it would leave one behind.
  const refusal = createRefusal(me.role, role);
  if (refusal) return { error: refusal };

  const supabaseCheck = await createClient();
  if (employeeId && (await employeeAlreadyLinked(supabaseCheck, employeeId))) {
    return { error: "พนักงานคนนี้ถูกผูกกับบัญชีอื่นแล้ว" };
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

  // DB trigger inserts profile with role='staff'; set name/role/employee here
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim(), role, employee_id: employeeId })
    .eq("id", data.user.id);

  if (profileError) {
    return { error: `สร้างบัญชีสำเร็จ แต่ตั้งชื่อ/สิทธิ์ไม่สำเร็จ: ${profileError.message}` };
  }

  revalidatePath("/owner/team");
  return {};
}

export type ActionResult = { error?: string };

/**
 * The เห็นต้นทุน switch (Nik, 2026-09-26): the OWNER turns it on or off, for
 * an editor only. On, the editor sees purchase prices, the price history,
 * POS receipt costs, prep and dish costs, food-cost % and margin; off (the
 * default), none of them. Written with the owner's own session: the table's
 * policies (owner only, editors only) are the rule, and a refused write is
 * counted, so it is reported instead of shown as done.
 */
export async function setCostAccess(userId: string, on: boolean): Promise<ActionResult> {
  await requireOwner();
  const supabase = await createClient();
  const { data: target, error: readError } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (readError) return { error: `ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่เปลี่ยน: ${readError.message}` };
  if (!target) return { error: "ไม่พบบัญชีนี้" };
  if (target.role !== "editor") return { error: "สวิตช์ “เห็นต้นทุน” ใช้กับบัญชี Editor เท่านั้น (เจ้าของและ Admin เห็นต้นทุนเสมอ)" };
  if (on) {
    const { error } = await supabase.from("profile_cost_access").upsert({ profile_id: userId }, { onConflict: "profile_id", ignoreDuplicates: true });
    if (error) return { error: `เปิดสิทธิ์ดูต้นทุนไม่สำเร็จ: ${error.message}` };
  } else {
    const { error } = await supabase.from("profile_cost_access").delete().eq("profile_id", userId);
    if (error) return { error: `ปิดสิทธิ์ดูต้นทุนไม่สำเร็จ: ${error.message}` };
  }
  // Read back: the answer is what the table now says, not what was sent.
  const { data: now, error: checkError } = await supabase.from("profile_cost_access").select("profile_id").eq("profile_id", userId).maybeSingle();
  if (checkError) return { error: `ตรวจผลไม่สำเร็จ: ${checkError.message}` };
  if ((now !== null) !== on) return { error: "ไม่ได้บันทึก — ฐานข้อมูลไม่อนุญาต" };
  revalidatePath("/owner/team");
  return {};
}

export async function updateUserRole(userId: string, role: Role): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const found = await readTarget(supabase, userId);
  if (found.error !== undefined) return { error: found.error };
  const current = found.target;

  // No last-owner guard is needed here: an owner row's role is never
  // changed (teamRefusal), by the owner or anyone else.
  const refusal = teamRefusal(me, current, { kind: "role", role });
  if (refusal) return { error: refusal };
  // Demoting the last admin who can still sign in: the same rule as
  // deleting and disabling. Counting admin profiles let a disabled admin
  // count as one, so the only admin who could sign in could be demoted.
  if (role !== "admin" && current.role === "admin") {
    const lastActive = await lastActiveCheck(supabase, current, "ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่เปลี่ยนสิทธิ์", "ลดสิทธิ์");
    if (lastActive) return { error: lastActive };
  }

  // Counted: a write the table's policy refuses updates 0 rows and no error.
  const { error, count } = await supabase.from("profiles").update({ role }, { count: "exact" }).eq("id", userId);
  if (error) return { error: error.message };
  if (count !== 1) return { error: "ไม่ได้บันทึกสิทธิ์ — ฐานข้อมูลไม่อนุญาต" };
  revalidatePath("/owner/team");
  return {};
}

export async function updateUserDetails(
  userId: string,
  fields: { fullName: string; username: string; employeeId: string | null }
): Promise<ActionResult> {
  const me = await requireAdmin();

  if (!fields.fullName.trim() || !fields.username.trim()) {
    return { error: "กรุณากรอกชื่อและชื่อผู้ใช้" };
  }

  const supabase = await createClient();
  // Checked BEFORE the login name is rewritten below with the service role,
  // which no table policy sees. Without it an admin could rename the owner's
  // login and lock the owner out (item 29).
  const found = await readTarget(supabase, userId);
  if (found.error !== undefined) return { error: found.error };
  const refusal = teamRefusal(me, found.target, { kind: "edit" });
  if (refusal) return { error: refusal };
  if (fields.employeeId && (await employeeAlreadyLinked(supabase, fields.employeeId, userId))) {
    return { error: "พนักงานคนนี้ถูกผูกกับบัญชีอื่นแล้ว" };
  }

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: toAuthEmail(fields.username),
  });
  if (authError) return { error: authError.message };

  const { error: profileError, count } = await supabase
    .from("profiles")
    .update({ full_name: fields.fullName.trim(), employee_id: fields.employeeId }, { count: "exact" })
    .eq("id", userId);
  if (profileError) return { error: profileError.message };
  if (count !== 1) return { error: "เปลี่ยนชื่อผู้ใช้แล้ว แต่ไม่ได้บันทึกชื่อ/พนักงาน — ฐานข้อมูลไม่อนุญาต" };

  revalidatePath("/owner/team");
  return {};
}

/**
 * The owner can change any password; an admin only its own and those of
 * staff, editor and sales accounts (teamRefusal). Before item 29 an admin
 * could reset an hr password, and a failed target read let any reset through.
 */
export async function changePassword(userId: string, newPassword: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (newPassword.length < 6) return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };

  const supabase = await createClient();
  const found = await readTarget(supabase, userId);
  if (found.error !== undefined) return { error: found.error };
  const refusal = teamRefusal(me, found.target, { kind: "password" });
  if (refusal) return { error: refusal };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };
  return {};
}

/**
 * Whether the account appears anywhere in the supply-order history (item 35,
 * decision 15). The order tables' foreign keys refuse the deletion of such
 * an account; this read is what turns that refusal into an offer to disable
 * instead of a raw constraint error. A failed read counts as history: the
 * deletion is refused, never let through on an unknown.
 */
async function hasOrderHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const reads = await Promise.all([
    supabase.from("order_sessions").select("id", { count: "exact", head: true })
      .or(`created_by.eq.${userId},reviewed_by.eq.${userId},sent_by.eq.${userId},approved_by.eq.${userId},returned_by.eq.${userId},cancelled_by.eq.${userId}`),
    supabase.from("order_items").select("id", { count: "exact", head: true }).eq("received_by", userId),
    supabase.from("order_item_changes").select("id", { count: "exact", head: true }).eq("changed_by", userId),
  ]);
  return reads.some((r) => r.error !== null || (r.count ?? 1) > 0);
}

// Not exported: a "use server" module may export only async functions.
const DISABLE_INSTEAD = "บัญชีนี้มีประวัติในใบสั่งของ จึงลบไม่ได้ — ใช้ ระงับการใช้งาน แทน";

export async function deleteUser(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();

  // Checked BEFORE the login is deleted below with the service role. Before
  // item 29 an admin could delete an hr login, and a failed read of the
  // target skipped every check.
  const found = await readTarget(supabase, userId);
  if (found.error !== undefined) return { error: found.error };
  const current = found.target;
  const refusal = teamRefusal(me, current, { kind: "delete" });
  if (refusal) return { error: refusal };
  // An account with order history is disabled, not deleted (item 35,
  // decision 15). The database refuses the deletion as well; this check is
  // what the person sees instead of the constraint's message.
  if (await hasOrderHistory(supabase, userId)) return { error: DISABLE_INSTEAD };
  // The last owner or admin who can still sign in: the same rule as
  // disabling (counting profiles let a disabled owner count as one).
  const lastActive = await lastActiveCheck(supabase, current, "ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่ลบ", "ลบ");
  if (lastActive) return { error: lastActive };

  // THE LOGIN FIRST, and its answer read (audit, 2026-09-25). It used to be
  // "best-effort": a failed call — above all a missing or rotated
  // SUPABASE_SERVICE_ROLE_KEY in Vercel (queue item 45) — was ignored, the
  // profile below was deleted, and the screen said done while the login
  // could still sign in and read every table whose policy asks only "signed
  // in". Now a failure stops here and nothing is deleted. A login that is
  // already gone (user_not_found) goes on, so an orphaned profile can still be removed.
  const adminClient = createAdminClient();
  const { error: authErr } = await adminClient.auth.admin.deleteUser(userId);
  if (authErr && authErr.code !== "user_not_found") {
    return { error: `ลบบัญชีเข้าระบบไม่สำเร็จ — ยังไม่ได้ลบอะไร: ${authErr.message}` };
  }

  // The profile. profiles.id references auth.users ON DELETE CASCADE
  // (0001_init.sql), so it is normally gone already and this deletes 0 rows:
  // that is success, not the failure it used to be reported as. What counts
  // is that no profile is left. The delete runs under the live policy the
  // README and profile_employee_link_migration.sql refer to:
  //   CREATE POLICY owner_admin_delete_profiles ON profiles FOR DELETE TO authenticated
  //   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin')));
  const { error: profileErr } = await supabase.from("profiles").delete().eq("id", userId);
  if (profileErr) return { error: `ลบโปรไฟล์ไม่สำเร็จ: ${profileErr.message}` };
  const { data: left, error: leftErr } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (leftErr) return { error: `ตรวจผลการลบไม่สำเร็จ: ${leftErr.message}` };
  if (left) return { error: "ลบบัญชีเข้าระบบแล้ว แต่โปรไฟล์ยังอยู่ — แจ้งเจ้าของร้าน" };

  revalidatePath("/owner/team");
  return {};
}

/**
 * Disable or re-enable a login (item 35, decision 15): the account keeps
 * its profile and its place in every order's history, and can no longer
 * sign in (a ban through the auth admin API; a session it already holds
 * ends when its token expires, within the hour). Who may: the same rule as
 * deleting (teamRefusal "delete"), with the same last-owner and last-admin
 * guards, since a disabled account is one that cannot act.
 */
/**
 * The last owner, or admin, who can still SIGN IN may not be removed —
 * disabled, deleted or demoted (not "the last profile of that role": a
 * disabled owner is still a profile). Reads the role's profiles and EVERY login fresh; a
 * failed or incomplete read refuses rather than guesses. Returns the refusal,
 * or null.
 */
async function lastActiveCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  target: { id: string; role: string },
  refusedRead: string,
  /** The action the refusal names: ลบ, ระงับ, ลดสิทธิ์. */
  verb: string,
): Promise<string | null> {
  if (target.role !== "owner" && target.role !== "admin") return null;
  const { data: sameRole, error } = await supabase.from("profiles").select("id, role").eq("role", target.role);
  if (error || !sameRole) return refusedRead;
  const logins = await listAllAuthUsers(createAdminClient());
  if (!logins) return refusedRead;
  const banned = new Map(logins.map((u) => [u.id, isBanned(u.banned_until)]));
  return lastActiveRefusal(
    target,
    sameRole.map((p) => ({ id: p.id as string, role: p.role as string, disabled: banned.get(p.id as string) ?? true })),
    verb,
  );
}

export async function setUserDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  const supabase = await createClient();
  const found = await readTarget(supabase, userId);
  if (found.error !== undefined) return { error: found.error };
  const current = found.target;
  const refusal = teamRefusal(me, current, { kind: "delete" });
  if (refusal) return { error: refusal };
  const admin = createAdminClient();
  if (disabled) {
    const lastActive = await lastActiveCheck(supabase, current, "ตรวจสอบบัญชีไม่สำเร็จ จึงยังไม่ระงับ", "ระงับ");
    if (lastActive) return { error: lastActive };
  }
  // 100 years, or "none" to lift it: what the auth API calls a ban.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disabled ? "876000h" : "none" });
  if (error) return { error: `${disabled ? "ระงับ" : "เปิดใช้งาน"}ไม่สำเร็จ: ${error.message}` };
  revalidatePath("/owner/team");
  return {};
}
