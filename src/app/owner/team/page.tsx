import { requireAdmin, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayIdentity } from "@/lib/identity";
import { TeamManager } from "@/components/team-manager";
import { isBanned } from "@/lib/team-rules";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function OwnerTeamPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const admin = createAdminClient();

  // Name-only column list, same direct-table query the HR pages use. employees
  // carries salary columns, so they are simply never selected here.
  // Grant holders, for the team rule (an admin may not act on them). Read
  // with the service role: an admin's session sees only its own grants. A
  // failed read marks EVERY account as a holder, so the screen offers less,
  // never more; the server checks again either way.
  const [{ data: profiles }, { data: usersList }, { data: employees }, grants] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, employee_id"),
    admin.auth.admin.listUsers(),
    supabase
      .from("employees")
      .select("id, full_name, nickname")
      .eq("is_active", true)
      .order("sort_order"),
    admin.from("prep_recipe_access").select("profile_id", { count: "exact" }),
  ]);
  // A read cut short by the 1,000-row cap is treated as a failed one.
  const grantsComplete = !grants.error && grants.count != null && (grants.data ?? []).length === grants.count;
  const grantHolders = grantsComplete ? new Set((grants.data ?? []).map((g) => g.profile_id as string)) : null;

  const emailById = new Map(usersList?.users.map((u) => [u.id, u.email ?? "-"]) ?? []);
  const disabledIds = new Set((usersList?.users ?? []).filter((u) => isBanned(u.banned_until)).map((u) => u.id));
  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role as Role,
    username: displayIdentity(emailById.get(p.id) ?? "-"),
    employee_id: p.employee_id as string | null,
    holds_prep_grants: grantHolders ? grantHolders.has(p.id) : true,
    disabled: disabledIds.has(p.id),
  }));

  const employeeOptions = (employees ?? []).map((e) => ({
    id: e.id as string,
    label: (e.nickname as string | null) ?? (e.full_name as string),
  }));

  return (
    <PageShell>
      <PageHeader title="จัดการพนักงาน" subtitle="เพิ่มบัญชีพนักงานใหม่ และตั้งสิทธิ์การใช้งานได้ที่นี่" />
      <TeamManager users={users} currentUserId={me.id} currentUserRole={me.role} employeeOptions={employeeOptions} />
    </PageShell>
  );
}
