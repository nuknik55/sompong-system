-- ============================================================================
-- profiles.employee_id — link a login account to its HR employee record
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (ADD COLUMN IF NOT
-- EXISTS / DROP CONSTRAINT IF EXISTS throughout).
--
-- Until now profiles and employees were entirely unconnected: profiles.full_name
-- was free text typed into the /owner/team form, maintained independently of
-- employees.full_name with nothing keeping the two in sync. This column makes
-- the relationship explicit so the UI can resolve the CURRENT employee name
-- through a join instead of relying on two copies of the same text agreeing.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;

-- NULL-safe: Postgres UNIQUE allows any number of NULL rows, and only enforces
-- uniqueness among rows that actually have a value — so many unlinked logins
-- coexist while a given employee still maps to at most one login.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employee_id_unique;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employee_id_unique UNIQUE (employee_id);

COMMENT ON COLUMN public.profiles.employee_id IS
  'Optional link to the HR employee record for this login. Deliberately nullable: owner/admin accounts (and any other system login) need not correspond to a payroll employee, and an employee need not have a login at all. UNIQUE so one employee maps to at most one account; ON DELETE SET NULL so removing an employee record disables the link without destroying the login.';


-- ── RLS: no change needed ───────────────────────────────────────────────────
-- RLS is row-level: employee_id is a new column on rows whose access is already
-- governed by the existing profiles policies, so it needs no policy of its own.
-- Nothing here widens or narrows who can read a profile row.
--
-- !! Pre-existing, NOT introduced here, and worth verifying separately:
-- !! the only profiles policies in version control (migrations/0001_init.sql)
-- !! are profiles_select_own (id = auth.uid() OR is_owner()) and
-- !! profiles_owner_write (is_owner()) — both owner-only for other people's
-- !! rows. Yet /owner/team is guarded by requireAdmin() and has a non-owner
-- !! admin list, update and delete other users. deleteUser() in
-- !! src/app/owner/team/actions.ts documents an owner_admin_delete_profiles
-- !! policy that was added directly in Supabase and never committed, so the
-- !! live database almost certainly carries additional profiles policies that
-- !! this repo does not describe. Whether a non-owner admin can read another
-- !! user's employee_id therefore depends on live policy, not on this file.
