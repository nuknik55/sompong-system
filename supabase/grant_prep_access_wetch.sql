-- ============================================================================
-- Grant เวช (หัวหน้า prep, login wetch2527) every prep recipe.
-- ============================================================================
-- Same purpose and same safety shape as grant_prep_access_heng.sql, with ONE
-- deliberate difference: how the person is identified. Read that part before
-- running this.
--
-- Safe to re-run: ON CONFLICT DO NOTHING. Grants ALL prep recipes to ONE
-- person. The grant screen (/owner/prep-access, owner-only) is live now, so
-- this is the last grant that needs to be SQL at all — a subset for anyone
-- else belongs on that screen, from a picker.
--
-- ── WHICH FIELD IDENTIFIES HIM, AND WHY IT IS NOT THE NAME ─────────────────
--
-- Nik gave the login "wetch2527". That string is NOT in public.profiles —
-- profiles has no username column at all. The login lives in auth.users.email,
-- because the app turns a username into a synthetic address: toAuthEmail() in
-- src/lib/identity.ts lowercases it, strips spaces, and appends "@staff.local".
-- So "wetch2527" is stored as "wetch2527@staff.local", and the join through
-- auth.users is the only way to match on what Nik actually named.
--
-- This file requires ALL THREE to agree on one row:
--
--   auth.users.email  = 'wetch2527@staff.local'   <- the login, unique in auth
--   profiles.full_name = 'เวช'                     <- corroborating
--   profiles.role      = 'editor'                  <- corroborating
--
-- The login alone would be enough to be unique; the other two are there so
-- that a login pointing at an unexpected person ABORTS instead of granting.
-- That matters here more than it did for เฮง: there are four editors, and one
-- of them is a placeholder-looking account literally named "Editor" with the
-- login "editor". Verified live before this file was written —
--
--     แหงน        login sutef
--     เวช         login wetch2527   <- the one we want
--     Editor      login editor      <- one row away, and granting it would
--                                      hand every secret recipe to whoever
--                                      that account belongs to, and look
--                                      exactly like success
--     ธีรวัฒน์     login 8822
--
-- — and the triple matched exactly one row in both directions. The DO block
-- re-checks it at run time anyway, because the table can change between then
-- and now, and an assertion that only ran on my machine is not an assertion.
--
-- auth.users is readable here because the Supabase SQL editor runs as the
-- database owner; the app itself can never read that table.
--
-- ── WHY THE WRITE IS ALLOWED ───────────────────────────────────────────────
--
-- prep_recipe_access permits writes only to the owner (prep_recipe_access_write,
-- USING public.is_owner()). The SQL editor runs as the table owner and
-- bypasses RLS. The policy governs the application, not Nik at the database.
--
-- CORRECTED 2026-09-16: "writes only to the owner" was not true when this
-- ran. is_owner() admits admins too (migrations/006_owner_role.sql). The
-- policy has used is_owner_only() since
-- prep_owner_only_predicate_migration.sql.
-- ============================================================================

BEGIN;

DO $do$
DECLARE
  v_wetch   uuid;
  v_owner   uuid;
  v_count   int;
  v_preps   int;
  v_before  int;
  v_after   int;
BEGIN
  -- The triple, exactly one row, or nothing is written.
  SELECT count(*) INTO v_count
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = 'wetch2527@staff.local'
     AND p.full_name = 'เวช'
     AND p.role = 'editor';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'expected exactly 1 profile where login=wetch2527 AND full_name=เวช AND role=editor, found %. Nothing written.', v_count;
  END IF;

  SELECT p.id INTO v_wetch
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = 'wetch2527@staff.local'
     AND p.full_name = 'เวช'
     AND p.role = 'editor';

  -- The owner, for granted_by. Exactly one, or stop.
  SELECT count(*) INTO v_count FROM public.profiles WHERE role = 'owner';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 owner profile, found %. Nothing written.', v_count;
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner';

  SELECT count(*) INTO v_preps  FROM public.prep_recipes;
  SELECT count(*) INTO v_before FROM public.prep_recipe_access WHERE profile_id = v_wetch;

  INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id, granted_by)
  SELECT p.id, v_wetch, v_owner
    FROM public.prep_recipes p
  ON CONFLICT (prep_recipe_id, profile_id) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.prep_recipe_access WHERE profile_id = v_wetch;

  RAISE NOTICE 'prep recipes live        : %', v_preps;
  RAISE NOTICE 'เวช had before           : %', v_before;
  RAISE NOTICE 'เวช has now              : %', v_after;
  RAISE NOTICE 'newly granted this run   : %', v_after - v_before;

  IF v_after <> v_preps THEN
    RAISE EXCEPTION 'expected เวช to hold all % preps, holds %. Rolled back.', v_preps, v_after;
  END IF;
END
$do$;

COMMIT;

-- ═══ Verification — run separately, after the COMMIT ═══════════════════════
--
-- 1. Who holds what, WITH THE LOGIN SHOWN — the name alone is what this file
--    exists to avoid trusting. Expect two rows: เฮง (admin, heng-ish login)
--    and เวช (editor, wetch2527), 48 each. If "Editor / editor" appears, the
--    wrong account was granted and every recipe must be revoked from it.
--
--   SELECT p.full_name, p.role,
--          replace(u.email, '@staff.local', '') AS login,
--          count(*) AS recipes_granted
--     FROM public.prep_recipe_access a
--     JOIN public.profiles p ON p.id = a.profile_id
--     JOIN auth.users    u ON u.id = p.id
--    GROUP BY p.full_name, p.role, u.email
--    ORDER BY p.full_name;
--
-- 2. Nothing was missed for เวช. Expect 0 rows.
--
--   SELECT p.name
--     FROM public.prep_recipes p
--    WHERE NOT EXISTS (
--            SELECT 1 FROM public.prep_recipe_access a
--             JOIN auth.users u ON u.id = a.profile_id
--             WHERE a.prep_recipe_id = p.id
--               AND lower(u.email) = 'wetch2527@staff.local'
--          );
--
-- 3. THE CHECK THAT MATTERS, and it is not in SQL: เวช logs in as wetch2527,
--    opens /owner/ingredients, and the tab reads "ของ prep (48)" with the
--    recipes opening rather than 404ing. The owner's own grant screen should
--    show him at 48 / 48 under "ตามคน" at the same time.
