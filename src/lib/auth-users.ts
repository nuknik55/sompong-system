import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
export type AuthUserRow = { id: string; email: string | null; banned_until: string | null };

const PER_PAGE = 1000;

/**
 * EVERY login, page by page. `auth.admin.listUsers()` with no arguments
 * returns the first 50 only, which the team page read until 2026-09-23: past
 * 50 accounts, the rest showed no user name and never showed as disabled.
 * Returns null when any page fails, so a caller can refuse rather than act
 * on a partial list.
 */
export async function listAllAuthUsers(admin: AdminClient): Promise<AuthUserRow[] | null> {
  const all: AuthUserRow[] = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data) return null;
    for (const u of data.users) all.push({ id: u.id, email: u.email ?? null, banned_until: u.banned_until ?? null });
    if (data.users.length < PER_PAGE) return all;
  }
  return null; // more than 100,000 logins: not this restaurant; refuse rather than guess
}
