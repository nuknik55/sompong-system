-- ============================================================================
-- Close the two tables anyone on the internet could read (and write).
-- ============================================================================
-- Run once in the Supabase SQL editor. Transactional. Touches NO DATA: four
-- policies replace one on day_swap_requests, two replace one on
-- pos_import_meta. It checks itself before COMMIT.
--
-- ── WHAT WAS WRONG, MEASURED 2026-09-16 ────────────────────────────────────
--
-- Both tables were created from the same template, whose policy is NAMED
-- like a restriction and is none:
--
--   CREATE POLICY "owner can manage day_swap_requests"
--     ON public.day_swap_requests FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY "owner can manage pos_import_meta"
--     ON public.pos_import_meta   FOR ALL USING (true) WITH CHECK (true);
--
-- No TO clause, so it applies to every role, `anon` included, and the anon
-- key ships in the app's JavaScript. A read-only request with that key and
-- no login returned all 7 day_swap_requests rows (employee ids, work and off
-- dates, compensation, notes) and the pos_import_meta row. Of the 63 tables
-- and views the API exposes, these are the only two that answered anon.
-- FOR ALL ... WITH CHECK (true) means writes are open the same way; that was
-- not tested from outside, because a write cannot be rolled back there.
-- Footer check 2 tests it inside a transaction.
--
-- day_swap_requests feeds comp-day balances (getCompDayBalances,
-- getHolidayCompDayBalances), and `compensation = 'extra_pay'` is a payroll
-- input. An anonymous write there is a payroll write.
--
-- Same family as the prep leak and the q-factor policy: a name that says
-- "owner" over a rule that does not. The name is not evidence.
--
-- ── WHAT THEY BECOME ───────────────────────────────────────────────────────
--
-- day_swap_requests — the shape every other HR table already has
-- (hr_role_patch.sql, attendance_daily_migration.sql), by explicit role list,
-- never is_owner():
--   read   owner, hr, admin   (the schedule and attendance pages use
--                              requireHROrAdmin and read swap dates)
--   write  owner, hr          (every writer is requireHR)
--
-- pos_import_meta — date range and time of the last POS sales import:
--   read   any signed-in user (the /owner home page is requireProfile)
--   write  owner, admin       (the only writer is requireAdmin)
--
-- Every new policy is TO authenticated. anon gets nothing from either table.
-- ============================================================================

BEGIN;

-- ── Step 0: read what is live, print it, refuse to guess ───────────────────

DO $do$
DECLARE
  r record;
  v_day  text[];
  v_meta text[];
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('day_swap_requests', 'pos_import_meta')
     ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'existing: %.% [%] roles % USING % WITH CHECK %',
      r.tablename, r.policyname, r.cmd, r.roles, coalesce(r.qual, '-'), coalesce(r.with_check, '-');
  END LOOP;

  SELECT array_agg(policyname::text) INTO v_day
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'day_swap_requests';
  SELECT array_agg(policyname::text) INTO v_meta
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pos_import_meta';

  IF v_day IS DISTINCT FROM ARRAY['owner can manage day_swap_requests'] THEN
    RAISE EXCEPTION 'day_swap_requests: expected only "owner can manage day_swap_requests", found %. Nothing changed.', v_day;
  END IF;
  IF v_meta IS DISTINCT FROM ARRAY['owner can manage pos_import_meta'] THEN
    RAISE EXCEPTION 'pos_import_meta: expected only "owner can manage pos_import_meta", found %. Nothing changed.', v_meta;
  END IF;
END
$do$;


-- ── day_swap_requests ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "owner can manage day_swap_requests" ON public.day_swap_requests;

CREATE POLICY hr_admin_read ON public.day_swap_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'hr', 'admin')));

CREATE POLICY hr_insert ON public.day_swap_requests
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'hr')));

CREATE POLICY hr_update ON public.day_swap_requests
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'hr')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'hr')));

CREATE POLICY hr_delete ON public.day_swap_requests
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner', 'hr')));


-- ── pos_import_meta ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "owner can manage pos_import_meta" ON public.pos_import_meta;

CREATE POLICY pos_import_meta_read ON public.pos_import_meta
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- FOR ALL also grants SELECT to owner/admin; the read policy above already
-- covers them, so that overlap adds nothing.
CREATE POLICY pos_import_meta_write ON public.pos_import_meta
  FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));


-- ── Step 2: check before COMMIT ────────────────────────────────────────────
--
-- Structure, read from the catalogue: exactly the new policies, and every
-- one of them bound to `authenticated` alone. A policy with no TO clause is
-- bound to PUBLIC (role oid 0), which is how the old ones reached anon.

DO $do$
DECLARE
  v_auth oid := 'authenticated'::regrole;
  v_bad  text;
  v_n    int;
BEGIN
  SELECT string_agg(c.relname || '.' || p.polname, ', ') INTO v_bad
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('day_swap_requests', 'pos_import_meta')
     AND p.polroles IS DISTINCT FROM ARRAY[v_auth];
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'policies not bound to authenticated alone: %. Nothing applied.', v_bad;
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'day_swap_requests';
  IF v_n <> 4 THEN RAISE EXCEPTION 'day_swap_requests has % policies, expected 4. Nothing applied.', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pos_import_meta';
  IF v_n <> 2 THEN RAISE EXCEPTION 'pos_import_meta has % policies, expected 2. Nothing applied.', v_n; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.day_swap_requests'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pos_import_meta'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on one of the two tables; policies would be ignored. Nothing applied.';
  END IF;

  RAISE NOTICE 'self-check passed: 6 policies, all TO authenticated, RLS on';
END
$do$;

COMMIT;

-- ═══ Verification — run separately, NEGATIVE CONTROLS FIRST ════════════════
--
-- 1. NOT IN SQL: Claude repeats the anonymous scan — every table and view
--    the API exposes, read with the public anon key and no login. Expected:
--    all 63 return 0 rows, where day_swap_requests returned 7 and
--    pos_import_meta returned 1 before this file.
--
-- 2. The HR access check (Block 2, given separately) run again. The only
--    changes from its first run must be the day_swap_requests columns: sales
--    reads 0 (was 7) and writes 0 (was 7), and anon writes 0 (was 7).
--    Everything else identical.
--
-- 3. The policies as they now read.
--
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('day_swap_requests', 'pos_import_meta')
--    ORDER BY tablename, policyname;
--   -- expect 6 rows, roles {authenticated} on every one.
