-- !! HELD — DO NOT RUN. It waits for the HR rebuild batch (Nik, 2026-09-16). !!
-- !! Decided (owner-only) and reviewed, not urgent: the screen already       !!
-- !! refuses admins. Ask before running it, even though it looks finished.   !!
-- ============================================================================
-- The q-factor becomes owner-only at the database, as the screen already is.
-- ============================================================================
-- Run once in the Supabase SQL editor. Transactional. Touches NO DATA: one
-- policy on app_settings is dropped and recreated by name. Queue item 23.
--
-- Nik's decision, 2026-09-16: OWNER ONLY, matching updateQFactor's
-- requireOwner().
--
-- WHAT WAS WRONG: 0002_q_factor.sql wrote
--
--   CREATE POLICY app_settings_owner_write ON public.app_settings
--     FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
--
-- and is_owner() has meant owner OR admin since migrations/006_owner_role.sql.
-- So every admin could change the multiplier on every dish cost with a direct
-- API call, while the screen said owner only. It is the prep leak's
-- misreading in a second place (prep_owner_only_predicate_migration.sql),
-- and it is fixed the same way: is_owner_only(), which that file created,
-- and nothing else about is_owner() changes.
--
-- WHAT DOES NOT CHANGE: app_settings_read_all (every signed-in user reads
-- q_factor_pct; the costing of every dish needs it). The only column is
-- q_factor_pct, and the only writer in the app is updateQFactor.
-- ============================================================================

BEGIN;

-- ── Step 0: read what is live, print it, refuse to guess ───────────────────
-- 0002's history is not straightforward (two later migrations record
-- app_settings as missing at the time they were written), so the live
-- policies are checked by name rather than assumed.

DO $do$
DECLARE
  r record;
  v_names text[];
BEGIN
  PERFORM 'public.is_owner_only()'::regprocedure;  -- raises if the function is missing

  FOR r IN
    SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings'
     ORDER BY policyname
  LOOP
    RAISE NOTICE 'existing: % [%] roles % USING % WITH CHECK %',
      r.policyname, r.cmd, r.roles, coalesce(r.qual, '-'), coalesce(r.with_check, '-');
  END LOOP;

  SELECT array_agg(policyname::text) INTO v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings';

  IF v_names IS NULL
     OR NOT (v_names @> ARRAY['app_settings_read_all', 'app_settings_owner_write']
             AND v_names <@ ARRAY['app_settings_read_all', 'app_settings_owner_write']) THEN
    RAISE EXCEPTION 'expected exactly app_settings_read_all and app_settings_owner_write, found %. Nothing changed.', v_names;
  END IF;
END
$do$;

DROP POLICY IF EXISTS app_settings_owner_write ON public.app_settings;

-- FOR ALL applies its USING to SELECT as well; reading stays open through
-- app_settings_read_all, so narrowing this one removes no read.
CREATE POLICY app_settings_owner_write ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_owner_only()) WITH CHECK (public.is_owner_only());

-- ── Step 2: check before COMMIT, from the catalogue ────────────────────────

DO $do$
DECLARE
  v_only boolean;
  v_owner boolean;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
             AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.is_owner_only()'::regprocedure),
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
             AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = 'public.is_owner()'::regprocedure)
    INTO v_only, v_owner
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.app_settings'::regclass AND pol.polname = 'app_settings_owner_write';

  IF v_only IS NOT TRUE OR v_owner IS NOT FALSE THEN
    RAISE EXCEPTION 'app_settings_owner_write: calls is_owner_only() %, calls is_owner() %. Nothing applied.', v_only, v_owner;
  END IF;
  RAISE NOTICE 'self-check passed: app_settings_owner_write calls is_owner_only() and not is_owner()';
END
$do$;

COMMIT;

-- ═══ Verification — run separately, NEGATIVE CONTROL FIRST ═════════════════
--
-- Each block sets the identity first and the role last, prints
-- current_role() in its first column, and rolls back. The UPDATE sets the
-- value to itself, so even the positive control changes nothing.
--
-- 1. NEGATIVE CONTROL — `admin`. Before this file this returned 1 (is_owner()
--    admitted admins), so it can fail for the right reason.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'admin' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     WITH upd AS (UPDATE public.app_settings SET q_factor_pct = q_factor_pct WHERE id = 1 RETURNING 1)
--     SELECT public.current_role()                        AS must_be_admin,
--            (SELECT count(*) FROM upd)                   AS rows_updated_must_be_0,
--            (SELECT count(*) FROM public.app_settings)   AS can_still_read_must_be_1;
--   ROLLBACK;
--
-- 2. POSITIVE CONTROL — the owner can still write.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE role = 'owner'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     WITH upd AS (UPDATE public.app_settings SET q_factor_pct = q_factor_pct WHERE id = 1 RETURNING 1)
--     SELECT public.current_role()      AS must_be_owner,
--            (SELECT count(*) FROM upd) AS rows_updated_must_be_1;
--   ROLLBACK;
--
-- 3. NOT IN SQL: the owner changes the q-factor on /owner/settings and sets
--    it back. It must save both times.
