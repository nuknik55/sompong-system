-- ============================================================================
-- Provenance by trigger: updated_at everywhere, and a grant/revoke history
-- ============================================================================
-- Queue items 21 and 22, which are one decision in two places: HOW DOES THIS
-- REPO RECORD WHO DID WHAT, AND WHEN.
--
-- Run once in the Supabase SQL editor. Transactional, re-runnable (every
-- CREATE is OR REPLACE or guarded, every trigger is dropped first), and it
-- REWRITES NO DATA — no row's updated_at moves as a result of running this.
--
-- NO APPLICATION CODE CHANGES WITH THIS, and nothing needs deploying. That is
-- the point of choosing a trigger: there is nothing left for the code to do.
--
-- ── WHY A TRIGGER, WHEN THE QUESTION WAS "TRIGGER OR HAND-WRITTEN" ─────────
--
-- Because a trigger is already this repo's convention for exactly this
-- concern, two times out of two: recipe_item_history is written by
-- log_recipe_item_change() (0004) and ingredient_price_history by
-- log_ingredient_price_change() (0003), both SECURITY DEFINER, both capturing
-- auth.uid(). The application has never inserted a history row anywhere.
--
-- And because a trigger cannot be bypassed. The two grant scripts of
-- 2026-09-15 wrote 96 rows to prep_recipe_access without touching application
-- code at all — writes a hand-written trail would have missed entirely, and
-- precisely the ones we later needed to reason about when เวช's
-- ข้าวเหนียวมูน grant went missing. The same is true of any future SQL, any
-- bulk action, and grantAllPreps.
--
-- ── DOES auth.uid() RESOLVE INSIDE A TRIGGER? MEASURED, 2026-09-16 ────────
--
--   recipe_item_history        119 rows, 110 name a person,   9 NULL
--   ingredient_price_history   290 rows, 289 name a person,   1 NULL
--
-- Yes, for every ordinary server-action session. The NULLs are the
-- service-role / SQL-editor path, and for prep_recipe_access that path is
-- only Nik at the database — where NULL is informative rather than lossy: it
-- means the owner did it directly, which is true. Every application writer of
-- prep_recipe_access and prep_recipes uses the user-session client; the
-- createAdminClient files (maintenance, stations, team, inventory) touch
-- neither table.
--
-- ── WHY THE NAMES ARE COPIED, NOT JOINED ──────────────────────────────────
--
-- 40 of those 119 recipe_item_history rows attribute to an account that no
-- longer exists: a live uuid with nothing behind it. A history that cannot be
-- read six months later is not much of a history, so this table copies the
-- names at write time, as maintenance_reports does with reporter_name. Three
-- names: the recipe, the person who gained or lost access, and whoever did it.
--
-- It follows that this table has NO FOREIGN KEYS. A key to prep_recipes would
-- cascade the history away with the recipe, which is the opposite of the
-- point.
--
-- The one case where a name cannot be read live is a CASCADE: deleting a prep
-- recipe removes its grants, and by the time the child trigger fires the
-- parent row is already gone, so the lookup returns NULL. The trigger
-- therefore falls back to THE LAST NAME THIS TABLE ITSELF RECORDED for that
-- id — the grant row wrote it while the recipe existed — so a cascade-revoke
-- still reads as a sentence. Same fallback for a deleted person.
--
-- ── DELIBERATELY NOT BACKFILLED ───────────────────────────────────────────
--
-- The 96 live grants already carry granted_at and granted_by on their own
-- rows, so nothing is lost by starting empty — and an empty table is what
-- makes check 1 in the footer mean anything. A backfill would make "two rows
-- appeared" unfalsifiable.
--
-- ── ONE BEHAVIOUR CHANGE, RECORDED SO IT IS NOT READ AS A DEFECT LATER ────
--
-- After this runs, A BULK DATA MIGRATION WILL MOVE updated_at ON EVERY ROW IT
-- TOUCHES. Today such a migration leaves the column alone. That is correct
-- semantics — the rows were updated — but a mass timestamp shift after some
-- future backfill is this trigger working, not something breaking.
--
-- The 8 call sites that already set updated_at by hand are left as they are:
-- the trigger overwrites with the same now(), so they are redundant and
-- harmless, and eight edits for zero behaviour change is not worth the churn.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- ITEM 22 — updated_at, maintained by the database
-- ════════════════════════════════════════════════════════════════════════════
--
-- 58 .update({...}) call sites in src/; 8 stamp updated_at and 50 do not. That
-- is not a gap to close by hand — it is a mechanism that was missing. Dating
-- ผักคะน้าฮ่องกง's yield change from 37.0230 to 15 required solving the
-- arithmetic backwards because updatePrepYield is one of the 50.
--
-- Only 16 tables have the column at all; the other 46 need nothing. The DO
-- block below ASSERTS the column exists on each named table before creating
-- its trigger, so a typo or a renamed table aborts the migration rather than
-- installing a trigger that would fail on every write.

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.touch_updated_at() IS
  'BEFORE UPDATE: stamps updated_at. Installed on every table that has the '
  'column, because 50 of 58 application update paths did not set it.';

DO $do$
DECLARE
  t text;
  v_missing text[] := ARRAY[]::text[];
  v_made int := 0;
  -- Every table in this schema carrying an updated_at column, 2026-09-16.
  v_tables text[] := ARRAY[
    'catering_customers', 'catering_event_types', 'catering_events',
    'catering_rates', 'catering_set_menus', 'catering_settings',
    'catering_transfer_cost_rates', 'expense_entries', 'ingredients',
    'maintenance_reports', 'menu_recipe_items', 'menu_sops', 'menus',
    'order_sessions', 'prep_recipe_items', 'prep_recipes'
  ];
BEGIN
  -- Assert first, create second: no trigger is installed unless every named
  -- table really has the column.
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      v_missing := v_missing || t;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'these tables have no updated_at column: %. Nothing installed.', v_missing;
  END IF;

  FOREACH t IN ARRAY v_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'updated_at triggers installed on % tables', v_made;
  IF v_made <> 16 THEN
    RAISE EXCEPTION 'expected 16 triggers, made %. Rolled back.', v_made;
  END IF;
END
$do$;


-- ════════════════════════════════════════════════════════════════════════════
-- ITEM 21 — who gained or lost sight of a prep recipe, and when
-- ════════════════════════════════════════════════════════════════════════════
--
-- prep_recipe_access records granted_at and granted_by on the row itself, so a
-- LIVE grant carries its provenance — but a DELETE leaves nothing at all. When
-- เวช's ข้าวเหนียวมูน grant was reported as succeeding and was absent an hour
-- later, the only available answer came from the ABSENCE of a fresh timestamp
-- plus the absence of any mechanism that could have removed one. For the table
-- that gates the restaurant's core asset, that is too thin.

CREATE TABLE IF NOT EXISTS public.prep_recipe_access_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action           TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  -- No foreign keys anywhere in this table, on purpose: a key to prep_recipes
  -- would cascade the history away with the recipe.
  prep_recipe_id   UUID NOT NULL,
  prep_recipe_name TEXT,
  profile_id       UUID NOT NULL,
  profile_name     TEXT,
  changed_by       UUID,
  changed_by_name  TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prep_access_history_recipe ON public.prep_recipe_access_history(prep_recipe_id);
CREATE INDEX IF NOT EXISTS idx_prep_access_history_profile ON public.prep_recipe_access_history(profile_id);

COMMENT ON TABLE public.prep_recipe_access_history IS
  'Every grant and revoke on prep_recipe_access, written by trigger so no '
  'path can bypass it — including SQL run directly, which is how 96 of the '
  'first grants were made. Names are copied at write time because 40 of '
  'recipe_item_history''s rows already point at deleted accounts.';

CREATE OR REPLACE FUNCTION public.log_prep_recipe_access_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prep    uuid;
  v_profile uuid;
  v_action  text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_prep := NEW.prep_recipe_id; v_profile := NEW.profile_id; v_action := 'grant';
  ELSE
    v_prep := OLD.prep_recipe_id; v_profile := OLD.profile_id; v_action := 'revoke';
  END IF;

  INSERT INTO public.prep_recipe_access_history (
    action, prep_recipe_id, prep_recipe_name, profile_id, profile_name, changed_by, changed_by_name
  ) VALUES (
    v_action,
    v_prep,
    -- Live name first; on a CASCADE the parent is already gone, so fall back
    -- to the last name this table recorded for that id. The grant row wrote
    -- it while the recipe still existed, which is what keeps a cascade-revoke
    -- readable as a sentence.
    COALESCE(
      (SELECT name FROM public.prep_recipes WHERE id = v_prep),
      (SELECT h.prep_recipe_name FROM public.prep_recipe_access_history h
        WHERE h.prep_recipe_id = v_prep AND h.prep_recipe_name IS NOT NULL
        ORDER BY h.changed_at DESC LIMIT 1)
    ),
    v_profile,
    COALESCE(
      (SELECT full_name FROM public.profiles WHERE id = v_profile),
      (SELECT h.profile_name FROM public.prep_recipe_access_history h
        WHERE h.profile_id = v_profile AND h.profile_name IS NOT NULL
        ORDER BY h.changed_at DESC LIMIT 1)
    ),
    auth.uid(),
    -- NULL when the write came from the SQL editor. That is Nik at the
    -- database rather than a person in the app, and saying so is honest.
    (SELECT full_name FROM public.profiles WHERE id = auth.uid())
  );

  RETURN COALESCE(NEW, OLD);
END
$fn$;

DROP TRIGGER IF EXISTS trg_log_prep_recipe_access_change ON public.prep_recipe_access;
CREATE TRIGGER trg_log_prep_recipe_access_change
  AFTER INSERT OR DELETE ON public.prep_recipe_access
  FOR EACH ROW EXECUTE FUNCTION public.log_prep_recipe_access_change();

-- Owner-only reading, matching who may grant in the first place. No INSERT
-- policy: the trigger is SECURITY DEFINER and writes as the function owner.
ALTER TABLE public.prep_recipe_access_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prep_recipe_access_history_select ON public.prep_recipe_access_history;
CREATE POLICY prep_recipe_access_history_select ON public.prep_recipe_access_history
  FOR SELECT TO authenticated
  USING (public.is_owner());

COMMIT;

-- ═══ Verification — run separately, NEGATIVE CONTROL FIRST ═════════════════
--
-- 1. THE NEGATIVE CONTROL, and it has to come first or nothing below counts.
--    The history table must be EMPTY. If it already holds rows, then "two
--    rows appeared" in check 2 proves nothing, and something has written here
--    that this migration did not account for.
--
--   SELECT count(*) AS must_be_zero FROM public.prep_recipe_access_history;
--
-- 2. A grant and a revoke, logged with readable names — inside a transaction
--    that is rolled back, so no real access changes. Expect TWO rows, one
--    'grant' and one 'revoke', both naming the recipe and the person.
--    changed_by_name will be NULL here because the SQL editor has no
--    auth.uid(); from the app it is filled, which check 4 is for.
--
--   BEGIN;
--     INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id)
--     SELECT (SELECT id FROM public.prep_recipes WHERE name = 'Test เตรียม'),
--            (SELECT id FROM public.profiles WHERE role = 'staff' LIMIT 1);
--     DELETE FROM public.prep_recipe_access
--      WHERE prep_recipe_id = (SELECT id FROM public.prep_recipes WHERE name = 'Test เตรียม')
--        AND profile_id = (SELECT id FROM public.profiles WHERE role = 'staff' LIMIT 1);
--     SELECT action, prep_recipe_name, profile_name, changed_by_name
--       FROM public.prep_recipe_access_history ORDER BY changed_at;
--   ROLLBACK;
--
--   -- expect exactly:
--   --   grant  | Test เตรียม | Staff | NULL
--   --   revoke | Test เตรียม | Staff | NULL
--
-- 3. updated_at now moves on its own. Rolled back, so no yield really changes.
--
--   BEGIN;
--     SELECT name, batch_yield_qty, updated_at AS before
--       FROM public.prep_recipes WHERE name = 'Test เตรียม';
--     UPDATE public.prep_recipes SET batch_yield_qty = batch_yield_qty
--      WHERE name = 'Test เตรียม';
--     SELECT name, updated_at AS after_
--       FROM public.prep_recipes WHERE name = 'Test เตรียม';
--   ROLLBACK;
--
--   -- after_ must be later than before. Note the UPDATE sets the column to
--   -- its own value: the timestamp moves because the ROW was updated, which
--   -- is exactly the behaviour change recorded in the header.
--
-- 4. NOT IN SQL, and the one that proves auth.uid() reaches the trigger from
--    a real session: the owner opens /owner/prep-access, grants one recipe to
--    one person and revokes it again. Then —
--
--   SELECT action, prep_recipe_name, profile_name, changed_by_name, changed_at
--     FROM public.prep_recipe_access_history ORDER BY changed_at DESC LIMIT 2;
--
--   -- both rows must name the OWNER in changed_by_name. If that column is
--   -- NULL for a write made through the app, the trigger is not seeing the
--   -- session and item 21 has not delivered what it promised.
--
-- 5. The trigger count, in case a later migration drops one by accident.
--
--   SELECT count(*) AS should_be_16 FROM pg_trigger
--    WHERE tgname = 'trg_touch_updated_at' AND NOT tgisinternal;
