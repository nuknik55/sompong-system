import { requireAdmin, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayIdentity } from "@/lib/identity";
import { TeamManager } from "@/components/team-manager";

export default async function OwnerTeamPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();

  // Name-only column list, same direct-table query the HR pages use. employees
  // carries salary columns, so they are simply never selected here.
  const [{ data: profiles }, { data: usersList }, { data: employees }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, employee_id"),
    admin.auth.admin.listUsers(),
    supabase
      .from("employees")
      .select("id, full_name, nickname")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const emailById = new Map(usersList?.users.map((u) => [u.id, u.email ?? "-"]) ?? []);
  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role as Role,
    username: displayIdentity(emailById.get(p.id) ?? "-"),
    employee_id: p.employee_id as string | null,
  }));

  const employeeOptions = (employees ?? []).map((e) => ({
    id: e.id as string,
    label: (e.nickname as string | null) ?? (e.full_name as string),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">จัดการพนักงาน</h1>
        <p className="text-sm text-neutral-500">เพิ่มบัญชีพนักงานใหม่ และตั้งสิทธิ์การใช้งานได้ที่นี่</p>
      </div>
      <TeamManager users={users} currentUserId={me.id} currentUserRole={me.role} employeeOptions={employeeOptions} />
    </div>
  );
}
