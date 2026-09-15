-- ============================================================================
-- Grant เฮง access to every prep recipe. RUN THIS NOW.
-- ============================================================================
-- The app half of prep visibility deployed in e34a530, so with no grant rows
-- yet EVERY admin and editor currently sees "ของ prep (0)" and every prep URL
-- 404s — including เฮง and the admin account, who between them made 70 of the
-- 119 recipe edits in the system. The grant SCREEN does not exist yet (it is
-- the next piece of work), so this file is the stopgap that unblocks him.
--
-- Safe to re-run: ON CONFLICT DO NOTHING, so a second run grants nothing new
-- and reports the same totals. It grants ALL prep recipes to ONE person.
--
-- Nik intends to grant a prep-section head — who logs in as an editor — a
-- SUBSET of recipes he has not chosen yet. That is deliberately not in this
-- file: picking a subset by hand in SQL is how the wrong row gets named
-- (น้ำจิ้มซีฟู๊ด is spelled with ู๊, and a typo here would silently grant
-- nothing). The grant screen covers that case, from a picker.
--
-- ── WHY IT RESOLVES NAMES INSTEAD OF TAKING UUIDs ──────────────────────────
--
-- A pasted uuid that does not exist inserts zero rows and reports success —
-- an absence that reads as an answer. Both people are therefore looked up
-- live, and the block RAISES if either lookup does not find EXACTLY ONE row,
-- which aborts the transaction and writes nothing. เฮง is matched on name AND
-- role so that a future person of the same name in another role cannot
-- silently inherit this grant.
--
-- ── WHY THIS IS ALLOWED TO WRITE AT ALL ────────────────────────────────────
--
-- prep_recipe_access permits writes only to the owner (policy
-- prep_recipe_access_write, USING public.is_owner()). This file is run from
-- the Supabase SQL editor as the table owner, which bypasses RLS entirely —
-- that is why it works here and would NOT work from an admin's session in the
-- app. The policy is not being circumvented; it governs the application, and
-- the SQL editor is Nik acting as the database owner.
-- ============================================================================

BEGIN;

DO $do$
DECLARE
  v_heng    uuid;
  v_owner   uuid;
  v_count   int;
  v_preps   int;
  v_before  int;
  v_after   int;
BEGIN
  -- เฮง, by name AND role, exactly one.
  SELECT count(*) INTO v_count FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 profile with full_name=เฮง and role=admin, found %. Nothing written.', v_count;
  END IF;
  SELECT id INTO v_heng FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin';

  -- The owner, for granted_by. Exactly one, or stop.
  SELECT count(*) INTO v_count FROM public.profiles WHERE role = 'owner';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 owner profile, found %. Nothing written.', v_count;
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner';

  SELECT count(*) INTO v_preps  FROM public.prep_recipes;
  SELECT count(*) INTO v_before FROM public.prep_recipe_access WHERE profile_id = v_heng;

  INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id, granted_by)
  SELECT p.id, v_heng, v_owner
    FROM public.prep_recipes p
  ON CONFLICT (prep_recipe_id, profile_id) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.prep_recipe_access WHERE profile_id = v_heng;

  RAISE NOTICE 'prep recipes live        : %', v_preps;
  RAISE NOTICE 'เฮง had before           : %', v_before;
  RAISE NOTICE 'เฮง has now              : %', v_after;
  RAISE NOTICE 'newly granted this run   : %', v_after - v_before;

  -- The postcondition, not a report: after this runs เฮง must hold every prep.
  IF v_after <> v_preps THEN
    RAISE EXCEPTION 'expected เฮง to hold all % preps, holds %. Rolled back.', v_preps, v_after;
  END IF;
END
$do$;

COMMIT;

-- ═══ Verification — run separately, after the COMMIT ═══════════════════════
--
-- 1. Who holds what. Expect ONE row: เฮง, 48.
--
--   SELECT pr.full_name, pr.role, count(*) AS recipes_granted
--     FROM public.prep_recipe_access a
--     JOIN public.profiles pr ON pr.id = a.profile_id
--    GROUP BY pr.full_name, pr.role
--    ORDER BY pr.full_name;
--
-- 2. Nothing was missed. Expect 0 rows.
--
--   SELECT p.name
--     FROM public.prep_recipes p
--    WHERE NOT EXISTS (
--            SELECT 1 FROM public.prep_recipe_access a
--             WHERE a.prep_recipe_id = p.id
--               AND a.profile_id = (SELECT id FROM public.profiles
--                                    WHERE full_name = 'เฮง' AND role = 'admin')
--          );
--
-- 3. Provenance is recorded. Expect granted_by = the owner on all 48.
--
--   SELECT g.full_name AS granted_by, count(*)
--     FROM public.prep_recipe_access a
--     LEFT JOIN public.profiles g ON g.id = a.granted_by
--    GROUP BY g.full_name;
--
-- 4. THE CHECK THAT MATTERS, and it is not in SQL: เฮง opens
--    /owner/ingredients and the tab reads "ของ prep (48)", and a prep page
--    opens instead of 404ing. Anyone else still sees 0 until granted.
