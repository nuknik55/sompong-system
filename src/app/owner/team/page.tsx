import { requireAdmin, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayIdentity } from "@/lib/identity";
import { TeamManager } from "@/components/team-manager";
import { isBanned } from "@/lib/team-rules";
import { listAllAuthUsers } from "@/lib/auth-users";
import { PageHeader, PageShell } from "@/components/ui/page";
import { isMissingRelation } from "@/lib/schema-fallback";

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
  // EVERY login (listUsers() alone returns the first 50). A failed read
  // leaves the user names blank and shows nobody as disabled, as before.
  // The เห็นต้นทุน switches, read with the viewer's own session (owner and
  // admin read every row). Before the migration makes the table, the switch
  // is not offered. Any other failed read offers nothing and says so.
  const [{ data: profiles }, logins, { data: employees }, grants, costRows] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, employee_id"),
    listAllAuthUsers(admin),
    supabase
      .from("employees")
      .select("id, full_name, nickname")
      .eq("is_active", true)
      .order("sort_order"),
    admin.from("prep_recipe_access").select("profile_id", { count: "exact" }),
    supabase.from("profile_cost_access").select("profile_id"),
  ]);
  const costSwitch: "ready" | "not-yet" | "unreadable" = !costRows.error ? "ready" : isMissingRelation(costRows.error) ? "not-yet" : "unreadable";
  const costOn = new Set((costRows.data ?? []).map((r) => r.profile_id as string));
  // A read cut short by the 1,000-row cap is treated as a failed one.
  const grantsComplete = !grants.error && grants.count != null && (grants.data ?? []).length === grants.count;
  const grantHolders = grantsComplete ? new Set((grants.data ?? []).map((g) => g.profile_id as string)) : null;

  const emailById = new Map((logins ?? []).map((u) => [u.id, u.email ?? "-"]));
  const disabledIds = new Set((logins ?? []).filter((u) => isBanned(u.banned_until)).map((u) => u.id));
  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    role: p.role as Role,
    username: displayIdentity(emailById.get(p.id) ?? "-"),
    employee_id: p.employee_id as string | null,
    holds_prep_grants: grantHolders ? grantHolders.has(p.id) : true,
    sees_cost: costOn.has(p.id),
    disabled: disabledIds.has(p.id),
  }));

  const employeeOptions = (employees ?? []).map((e) => ({
    id: e.id as string,
    label: (e.nickname as string | null) ?? (e.full_name as string),
  }));

  return (
    <PageShell>
      <PageHeader title="จัดการพนักงาน" subtitle="เพิ่มบัญชีพนักงานใหม่ และตั้งสิทธิ์การใช้งานได้ที่นี่" />
      <TeamManager users={users} currentUserId={me.id} currentUserRole={me.role} employeeOptions={employeeOptions} costSwitch={costSwitch} />
    </PageShell>
  );
}
