-- ============================================================================
-- Catering: the event-details sheet, the free mark, and set-menu drafts
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. ONE
-- transaction: it records what is live, makes the changes below, tests them
-- AS REAL ACCOUNTS with every test write rolled back, counts its own result
-- rows, and rolls the whole thing back if anything disagrees. Safe to
-- re-run: every ADD is IF NOT EXISTS, every function CREATE OR REPLACE,
-- every policy dropped and re-made, the bucket upserted.
--
-- Needs the catering module as it stands on 2026-09-24:
-- catering_booking_prices_save_migration.sql and
-- catering_event_menu_items_migration.sql (the two functions this file
-- replaces), catering_sales_limits_migration.sql (the lock), and the
-- storage schema. Step 0 stops if any of them is missing.
--
-- WHY (Nik, 2026-09-24, every recommendation of the proposal approved):
--   A. THE EVENT-DETAILS SHEET. Sales makes a second page by hand today and
--      sends it with the quotation: the dishes, the free items, the job's
--      notes, the standard terms of the venue, a room photo, a table-layout
--      diagram. The app makes it now, from a LIBRARY of reusable blocks
--      (terms, photos, diagrams, tagged by the venues they suit) that owner
--      and admin keep, and that sales picks from for a booking and edits
--      there — the library copy never changes.
--   B. THE FREE MARK. A free item is marked "แถมฟรี" on its price-box line,
--      never guessed from a ฿0 price. Only marked lines (and a set's own
--      "free" section, unchanged) print under รายการแถมฟรี.
--   C. SET-MENU DRAFTS. Owner and admin design sets in a workspace: trial
--      sets side by side with their cost. A trial set is a normal set with
--      is_draft = true. Sales must never reach one, and none may reach a
--      booking or a document.
--
-- WHAT IT CHANGES
--   A. catering_detail_blocks — the library: kind (terms | photo |
--      diagram), title, body, image_path (lib/…), venue_tags (free text, no
--      fixed list), sort_order. Owner, admin and sales read it; owner and
--      admin write it.
--      catering_event_detail_blocks — a booking's picked blocks, each a COPY
--      (title, body, image, caption) with the library block it came from
--      (ON DELETE RESTRICT: a library block a booking uses cannot be
--      removed), or a booking's own image (no library block). At most 6
--      images per booking. An image path is the library's (lib/…) or this
--      booking's own folder (evt/<booking id>/…), never another booking's.
--      Owner, admin and sales, under the booking's cost lock, as every
--      booking table.
--      catering_events.sheet_notes — the job's numbered notes, one per line.
--      Bucket catering-details: PRIVATE; JPEG and PNG only, 2 MB a file.
--      Signed-in owner, admin and sales read it (signed URLs); uploads only
--      under the app's names — lib/<digits>-<letters>.jpg|png by owner and
--      admin, evt/<open booking id>/<digits>-<letters>.jpg|png by owner,
--      admin and sales; nobody overwrites or deletes through the API.
--   B. catering_event_charges.is_free, with a CHECK: a free line is ฿0 a
--      unit and ฿0 in all, and not a discount. catering_save_booking_prices
--      is REPLACED with the free mark carried on its lines (a set line
--      cannot be free; a dish marked free is charged ฿0, and gets the dish's
--      own price back when the mark is taken off) and a draft refused as a
--      new set line; everything else in it is as it was.
--   C. catering_set_menus.is_draft. A draft row and its dish rows are
--      readable by owner and admin only (restrictive policies). A trigger
--      refuses a draft on a booking's line or as the source of a booking's
--      copied dishes, for everyone; another refuses turning a real set back
--      into a draft. catering_copy_set_menu is REPLACED with a draft check.
--      A draft's save (name, price and dishes) and its making real are each
--      ONE function, one transaction, under a version check:
--      catering_save_set_draft and catering_make_set_real (owner, admin).
--   A. A booking's sheet is saved by ONE function too,
--      catering_save_event_sheet (owner, admin, sales): its notes and blocks
--      in one transaction, refused when someone saved it since the screen
--      opened, on a cancelled booking, and on a cost-locked one for everyone.
--      Uploads are capped per folder: 30 files for a booking, 500 for the
--      library (catering_detail_folder_has_room), so abandoned uploads cannot
--      grow without end.
--
-- CHANGES NO DATA. Every test write happens inside a block that always rolls
-- back; Step 5 checks every count afterwards. The bucket row is the one
-- thing written outside the tests, and it is part of the change.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: ALTER TABLE ADD COLUMN ×3 and
-- ADD CONSTRAINT ×2 (only when missing); CREATE TABLE ×2 with their indexes;
-- CREATE OR REPLACE FUNCTION ×10 in public (two of them replacements) and the
-- pg_temp helpers; CREATE TRIGGER ×6 (each dropped first if it exists);
-- DROP POLICY IF EXISTS / CREATE POLICY on catering_set_menus,
-- catering_set_menu_items, the two new tables and storage.objects (the
-- caps for THIS bucket only); GRANT and REVOKE on the two new tables and
-- the new functions; INSERT … ON CONFLICT on storage.buckets (the new
-- bucket); after COMMIT, DROP FUNCTION IF EXISTS on the pg_temp helpers;
-- inside the always-aborting test block, the test writes, a probe bucket and
-- a probe policy "probe open" on storage.objects (to prove the caps hold
-- beside an open policy; rolled back with the rest). Anything else is
-- unexpected: stop and send it. Never "Run and enable RLS".
--
-- WHAT SQL CANNOT TEST, AND IS LEFT TO THE APP AND THE CHECKS AFTER:
--   the storage API's own size and type limits (this file sets them on the
--   bucket row and reads them back; only an upload through the API applies
--   them); signed URLs, whose lifetime the CALLER chooses (any owner, admin
--   or sales session can make a long-lived link to any image in the bucket,
--   as it can download the image); signed UPLOAD URLs, whose token the
--   storage server honours on its own (an upsert through one, or a late
--   upload after the booking is locked, is not stopped by these policies);
--   a copy from another bucket (whether the API re-checks type and size);
--   the content of a file (the API trusts the declared type); the browser's
--   resize to 1600 px; a real anonymous HTTP request (tested here as the
--   anon database role).
--
-- RUN IT WHILE NOBODY IS SAVING A BOOKING'S PRICE BOX OR A SET MENU.
--
-- THE RESULT is the table the last statement prints. Copy it back whole.
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('orders.log',
    COALESCE(current_setting('orders.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('orders.log', true), '');
BEGIN
  PERFORM set_config('orders.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.logged()
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)
    FROM regexp_split_to_table(COALESCE(current_setting('orders.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one statement as one account. By default it ALWAYS rolls the
-- statement back (a private SQLSTATE, caught); with p_keep the statement's
-- writes stay, so a later test can build on them (all of it still inside the
-- always-aborting block of Step 3). Returns the identity it actually ran as,
-- first. With p_check, a SELECT run right after the statement as the same
-- account, whose row count is appended as "check=N".
CREATE OR REPLACE FUNCTION pg_temp.probe(p_who uuid, p_sql text, p_check text DEFAULT NULL, p_keep boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_me   text := current_user::text;
  v_role text;
  v_n    bigint;
  v_c    bigint;
BEGIN
  BEGIN
    IF p_who IS NULL THEN
      -- No account: the anon role, as a visitor who is not signed in.
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('role', 'anon', true);
      v_role := CASE WHEN current_user::text = 'anon' THEN 'anon' ELSE 'not-anon' END;
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
      PERFORM set_config('role', 'authenticated', true);
      v_role := CASE WHEN current_user::text = 'authenticated'
                     THEN COALESCE(public.current_role(), 'no-profile')
                     ELSE 'not-authenticated' END;
    END IF;
    IF p_sql ~* '^[[:space:]]*select' THEN
      EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_n;
    ELSE
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    IF p_check IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM (' || p_check || ') q' INTO v_c;
    END IF;
    IF NOT p_keep THEN
      RAISE EXCEPTION USING ERRCODE = 'U0001';
    END IF;
    -- Kept: back to the file's own role by hand (a sub-block that completes
    -- keeps its LOCAL settings).
    PERFORM set_config('role', v_me, true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN v_role || ' rows=' || v_n || CASE WHEN p_check IS NULL THEN '' ELSE ' check=' || v_c END;
  EXCEPTION
    WHEN SQLSTATE 'U0001' THEN
      RETURN v_role || ' rows=' || v_n || CASE WHEN p_check IS NULL THEN '' ELSE ' check=' || v_c END;
    WHEN check_violation THEN
      RETURN COALESCE(v_role, '?') || ' check-refused';
    WHEN foreign_key_violation OR restrict_violation THEN
      RETURN COALESCE(v_role, '?') || ' fk-refused';
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      IF SQLERRM LIKE 'permission denied for table %' THEN
        RETURN COALESCE(v_role, '?') || ' denied:' || substring(SQLERRM from 'permission denied for table ([[:alnum:]_]+)');
      END IF;
      RETURN COALESCE(v_role, '?') || ' error 42501 ' || SQLERRM;
    WHEN raise_exception THEN
      -- The functions' own refusals (P0001). The message is kept aside so
      -- the table stays one word per outcome, and printed where it matters.
      PERFORM set_config('orders.last_refusal', SQLERRM, true);
      RETURN COALESCE(v_role, '?') || ' refused';
    WHEN undefined_function THEN
      -- A function that does not exist (42883): the dropped ones.
      RETURN COALESCE(v_role, '?') || ' no-such-function';
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- The table a write statement names. NO BACKSLASH APPEARS IN THIS PATTERN.
CREATE OR REPLACE FUNCTION pg_temp.sql_target(p_sql text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower((regexp_match(p_sql,
    '(?:insert[[:space:]]+into|update|delete[[:space:]]+from|from)[[:space:]]+(?:[[:alnum:]_]+[.])?([[:alnum:]_]+)',
    'i'))[1]);
$fn$;

-- A refusal counts as 'denied' ONLY when it came from the table the
-- statement writes to; one that cannot be attributed RAISES.
CREATE OR REPLACE FUNCTION pg_temp.classify(p_res text, p_sql text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_table text := pg_temp.sql_target(p_sql);
BEGIN
  IF p_res NOT LIKE 'denied:%' THEN
    RETURN p_res;
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'the harness cannot tell which table this statement writes to, so a refusal cannot be attributed: %', p_sql;
  END IF;
  IF p_res = 'denied:' || v_table THEN
    RETURN 'denied';
  END IF;
  RETURN 'error (a policy on another table) ' || p_res;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_who uuid, p_role text, p_sql text, p_want text[], p_check text DEFAULT NULL, p_keep boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql, p_check, p_keep);
  v_role text := split_part(v_got, ' ', 1);
  v_res  text := pg_temp.classify(substr(v_got, length(split_part(v_got, ' ', 1)) + 2), p_sql);
BEGIN
  IF v_role IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION '% — ran as %, expected %: the impersonation did not take, so the result means nothing. Nothing applied.',
      p_label, v_role, p_role;
  END IF;
  IF NOT (v_res = ANY (p_want)) THEN
    RAISE EXCEPTION 'FAIL    % — as %, got "%" (%), expected one of %. Nothing applied.',
      p_label, v_role, v_res, COALESCE(current_setting('orders.last_refusal', true), '-'), array_to_string(p_want, ' / ');
  END IF;
  PERFORM pg_temp.note(format('ok      %s — as %s, %s', p_label, v_role, v_res));
END
$fn$;

-- A refusal counts only when it was for the rule under test: the message
-- the function raised must name it. Emits no row; raises when it does not.
CREATE OR REPLACE FUNCTION pg_temp.said(p_label text, p_text text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF position(p_text IN COALESCE(current_setting('orders.last_refusal', true), '')) = 0 THEN
    RAISE EXCEPTION 'FAIL    % — refused, but not for the rule under test: "%". Nothing applied.',
      p_label, COALESCE(current_setting('orders.last_refusal', true), '-');
  END IF;
END
$fn$;

-- ── The harness tests ITSELF, before it tests anything else ────────────────

DO $do$
DECLARE
  v_here text := 'UPDATE public.catering_events SET detail_note = NULL WHERE id = NULL';
BEGIN
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'catering_events'
     OR pg_temp.sql_target('insert into catering_event_menus (event_id) values (NULL)') IS DISTINCT FROM 'catering_event_menus'
     OR pg_temp.sql_target('DELETE FROM public.profiles WHERE id = NULL') IS DISTINCT FROM 'profiles' THEN
    RAISE EXCEPTION 'the harness cannot name the table a write statement targets. Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:catering_events', v_here) IS DISTINCT FROM 'denied'
     OR pg_temp.classify('denied:profiles', v_here) NOT LIKE 'error (a policy on another table)%'
     OR pg_temp.classify('rows=1', v_here) IS DISTINCT FROM 'rows=1' THEN
    RAISE EXCEPTION 'the harness misreads a refusal. Nothing applied.';
  END IF;
  IF pg_temp.sql_target('SELECT id FROM public.catering_detail_blocks WHERE id = NULL') IS DISTINCT FROM 'catering_detail_blocks' THEN
    RAISE EXCEPTION 'the harness cannot name the table a read comes from. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X1 the harness names the table a write targets or a read comes from, reads a refusal from it as "denied", and one from another table as an error');
END
$do$;

-- ── Step 0: what is live, and the accounts the tests need ──────────────────

DO $do$
DECLARE
  v_owner  uuid;
  v_admin  uuid;
  v_sales  uuid;
  v_editor uuid;
  v_staff  uuid;
  v_hr     uuid;
  t        text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.catering_events', 'public.catering_event_menus', 'public.catering_event_menu_items',
                           'public.catering_event_charges', 'public.catering_set_menus', 'public.catering_set_menu_items',
                           'public.catering_event_activity_log', 'public.menus', 'storage.objects', 'storage.buckets'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '% is missing. Nothing changed.', t;
    END IF;
  END LOOP;
  BEGIN
    PERFORM 'public.catering_save_booking_prices(uuid, jsonb, jsonb, boolean)'::regprocedure;
    PERFORM 'public.catering_copy_set_menu(uuid)'::regprocedure;
    PERFORM 'public.catering_event_unlocked(uuid)'::regprocedure;
    PERFORM 'public.current_role()'::regprocedure;
    PERFORM 'public.touch_updated_at()'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'a catering function is missing (the booking price box, the set copy, the lock, the role or the updated_at trigger): %. Nothing changed.', SQLERRM;
  END;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'catering_events' AND column_name = 'cost_locked_at') THEN
    RAISE EXCEPTION 'catering_events.cost_locked_at is missing: the cost lock has not been installed. Nothing changed.';
  END IF;

  SELECT id INTO v_owner  FROM public.profiles WHERE role = 'owner'  ORDER BY id LIMIT 1;
  SELECT id INTO v_admin  FROM public.profiles WHERE role = 'admin'  ORDER BY id LIMIT 1;
  SELECT id INTO v_sales  FROM public.profiles WHERE role = 'sales'  ORDER BY id LIMIT 1;
  SELECT id INTO v_editor FROM public.profiles WHERE role = 'editor' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff  FROM public.profiles WHERE role = 'staff'  ORDER BY id LIMIT 1;
  SELECT id INTO v_hr     FROM public.profiles WHERE role = 'hr'     ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL OR v_editor IS NULL OR v_staff IS NULL OR v_hr IS NULL THEN
    RAISE EXCEPTION 'need an owner, admin, sales, editor, staff and hr profile to test as. Nothing changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.menus WHERE selling_price > 0) THEN
    RAISE EXCEPTION 'need one dish with a price to test with. Nothing changed.';
  END IF;
  PERFORM set_config('sheet.owner',  v_owner::text,  false);
  PERFORM set_config('sheet.admin',  v_admin::text,  false);
  PERFORM set_config('sheet.sales',  v_sales::text,  false);
  PERFORM set_config('sheet.editor', v_editor::text, false);
  PERFORM set_config('sheet.staff',  v_staff::text,  false);
  PERFORM set_config('sheet.hr',     v_hr::text,     false);

  PERFORM set_config('sheet.n_events',  (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('sheet.n_sets',    (SELECT count(*) FROM public.catering_set_menus)::text, false);
  PERFORM set_config('sheet.n_setitems',(SELECT count(*) FROM public.catering_set_menu_items)::text, false);
  PERFORM set_config('sheet.n_lines',   (SELECT count(*) FROM public.catering_event_menus)::text, false);
  PERFORM set_config('sheet.n_copies',  (SELECT count(*) FROM public.catering_event_menu_items)::text, false);
  PERFORM set_config('sheet.n_charges', (SELECT count(*) FROM public.catering_event_charges)::text, false);
  PERFORM set_config('sheet.n_log',     (SELECT count(*) FROM public.catering_event_activity_log)::text, false);
  PERFORM set_config('sheet.n_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'catering-details')::text, false);
  PERFORM set_config('sheet.fp_events',
    (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
       FROM public.catering_events), false);
  PERFORM set_config('sheet.fp_charges',
    (SELECT md5(COALESCE(string_agg(id::text || label || unit_price::text || quantity::text || amount::text, ',' ORDER BY id), ''))
       FROM public.catering_event_charges), false);
  PERFORM pg_temp.note(format('before  bookings %s, sets %s (dish rows %s), booking lines %s (copied dishes %s), charges %s, history %s, files in catering-details %s; is_draft exists: %s, is_free exists: %s, library exists: %s (a re-run says true, true, true)',
    current_setting('sheet.n_events'), current_setting('sheet.n_sets'), current_setting('sheet.n_setitems'),
    current_setting('sheet.n_lines'), current_setting('sheet.n_copies'), current_setting('sheet.n_charges'),
    current_setting('sheet.n_log'), current_setting('sheet.n_objects'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catering_set_menus' AND column_name = 'is_draft'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catering_event_charges' AND column_name = 'is_free'),
    to_regclass('public.catering_detail_blocks') IS NOT NULL));
END
$do$;

-- ── Step 1: the columns and the two tables ─────────────────────────────────

ALTER TABLE public.catering_set_menus ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;
ALTER TABLE public.catering_event_charges ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;
ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS sheet_notes text;

DO $do$
DECLARE
  v_added text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.catering_event_charges'::regclass
                    AND conname = 'catering_event_charges_free_is_zero') THEN
    ALTER TABLE public.catering_event_charges ADD CONSTRAINT catering_event_charges_free_is_zero
      CHECK (NOT is_free OR (amount = 0 AND unit_price = 0 AND charge_type <> 'discount'));
    v_added := v_added || 'free is ฿0 a unit and in all, and not a discount'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.catering_events'::regclass
                    AND conname = 'catering_events_sheet_notes_length') THEN
    ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_sheet_notes_length
      CHECK (sheet_notes IS NULL OR char_length(sheet_notes) <= 4000);
    v_added := v_added || 'job notes at most 4000 characters'::text;
  END IF;
  PERFORM pg_temp.note(format('ok      the columns is_draft, is_free and sheet_notes are there; checks added now: %s',
    CASE WHEN cardinality(v_added) = 0 THEN 'none (a re-run)' ELSE array_to_string(v_added, ', ') END));
END
$do$;

COMMENT ON COLUMN public.catering_set_menus.is_draft IS
  'A trial set of the set-menu design workspace (Nik, 2026-09-24): owner and admin only; never on a booking or a document. Only ever cleared (made real), never set on a real set.';
COMMENT ON COLUMN public.catering_event_charges.is_free IS
  'แถมฟรี, marked by hand on a price-box line (Nik, 2026-09-24): a ฿0 line that is not a discount. Never inferred from a ฿0 price.';
COMMENT ON COLUMN public.catering_events.sheet_notes IS
  'The event-details sheet''s job notes, one per line, printed numbered. Customer-facing: never a kitchen note.';

CREATE TABLE IF NOT EXISTS public.catering_detail_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('terms', 'photo', 'diagram')),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  body        text CHECK (body IS NULL OR char_length(body) <= 4000),
  image_path  text CHECK (image_path IS NULL OR image_path ~ '^lib/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png)$'),
  venue_tags  text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(venue_tags) <= 20),
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catering_detail_blocks_shape CHECK (
    (kind = 'terms' AND body IS NOT NULL AND image_path IS NULL)
    OR (kind IN ('photo', 'diagram') AND image_path IS NOT NULL))
);
COMMENT ON TABLE public.catering_detail_blocks IS
  'The event-details sheet''s library (Nik, 2026-09-24): standard terms, room photos, layout diagrams, tagged by the venues they suit. Owner and admin keep it; sales picks copies onto a booking.';

CREATE TABLE IF NOT EXISTS public.catering_event_detail_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  -- The library block this copy came from; NULL for the booking's own image.
  -- RESTRICT: a library block a booking uses cannot be removed.
  block_id    uuid REFERENCES public.catering_detail_blocks(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('terms', 'photo', 'diagram')),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  body        text CHECK (body IS NULL OR char_length(body) <= 4000),
  -- The library's images, or this booking's own folder: never another booking's.
  image_path  text CHECK (image_path IS NULL
                          OR image_path ~ '^lib/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png)$'
                          OR image_path ~ ('^evt/' || event_id::text || '/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png)$')),
  caption     text CHECK (caption IS NULL OR char_length(caption) <= 300),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catering_event_detail_blocks_shape CHECK (
    (kind = 'terms' AND body IS NOT NULL AND image_path IS NULL)
    OR (kind IN ('photo', 'diagram') AND image_path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_catering_event_detail_blocks_event ON public.catering_event_detail_blocks(event_id);
CREATE INDEX IF NOT EXISTS idx_catering_event_detail_blocks_block ON public.catering_event_detail_blocks(block_id);
COMMENT ON TABLE public.catering_event_detail_blocks IS
  'A booking''s event-details sheet blocks: a copy of a library block (edited for this booking only) or the booking''s own image. At most 6 images per booking.';

DO $do$
BEGIN
  PERFORM pg_temp.note('ok      the library (catering_detail_blocks) and a booking''s picks (catering_event_detail_blocks) are there');
END
$do$;

-- ── Step 2: the functions and triggers ─────────────────────────────────────

-- C. A real set never turns back into a draft: a set a booking uses stays real.
CREATE OR REPLACE FUNCTION public.catering_set_menus_draft_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF OLD.is_draft = false AND NEW.is_draft = true THEN
    RAISE EXCEPTION 'ชุดเมนูที่ใช้งานจริงแล้วเปลี่ยนกลับเป็นฉบับร่างไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;

-- C. No draft on a booking, for anyone: not as a line's set, not as the
-- source of a booking's copied dishes. SECURITY DEFINER on purpose: under a
-- sales session a draft row is invisible, and an EXISTS over it would say
-- "no draft" — the check must see every row.
CREATE OR REPLACE FUNCTION public.catering_no_draft_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_set uuid;
BEGIN
  IF TG_TABLE_NAME = 'catering_event_menus' THEN
    v_set := NEW.set_menu_id;
  ELSE
    v_set := NEW.source_set_menu_id;
  END IF;
  IF v_set IS NOT NULL AND EXISTS (SELECT 1 FROM public.catering_set_menus s WHERE s.id = v_set AND s.is_draft) THEN
    RAISE EXCEPTION 'ชุดเมนูนี้ยังเป็นฉบับร่าง ใช้กับงานไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;

-- A. At most 6 images on a booking's sheet. One booking's picks are counted
-- under a transaction lock of their own, so two uploads at once cannot both
-- be the sixth.
CREATE OR REPLACE FUNCTION public.catering_detail_image_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.image_path IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('catering_event_detail_blocks:' || NEW.event_id::text));
  IF (SELECT count(*) FROM public.catering_event_detail_blocks b
       WHERE b.event_id = NEW.event_id AND b.image_path IS NOT NULL AND b.id <> NEW.id) >= 6 THEN
    RAISE EXCEPTION 'ใบรายละเอียดงานมีรูปได้ไม่เกิน 6 รูป';
  END IF;
  RETURN NEW;
END
$fn$;

-- A. Room in the folder an upload goes to: 30 files for a booking, 500 for
-- the library. SECURITY INVOKER on purpose: owner, admin and sales read the
-- whole bucket, so the count is every file there; a role that cannot read
-- it cannot upload either.
CREATE OR REPLACE FUNCTION public.catering_detail_folder_has_room(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN left(p_name, 4) = 'lib/'
      THEN (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'catering-details' AND left(o.name, 4) = 'lib/') < 500
    WHEN left(p_name, 4) = 'evt/'
      THEN (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'catering-details' AND left(o.name, 41) = left(p_name, 41)) < 30
    ELSE false END;
$fn$;

-- A. Who may upload what to catering-details: a name the app makes, tied to
-- a role — the library's images by owner and admin; a booking's by owner,
-- admin and sales, into the folder of a booking that exists, is not
-- cancelled and is not cost-locked. Anything else, nobody.
CREATE OR REPLACE FUNCTION public.catering_detail_upload_allowed(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(CASE
    WHEN p_name ~ '^lib/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png)$'
      THEN public.current_role() IN ('owner', 'admin')
    WHEN p_name ~ '^evt/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png)$'
      THEN public.current_role() IN ('owner', 'admin', 'sales')
       AND EXISTS (SELECT 1 FROM public.catering_events e
                    WHERE e.id = substring(p_name from 5 for 36)::uuid
                      AND e.status <> 'cancelled' AND e.cost_locked_at IS NULL)
    ELSE false END, false);
$fn$;

REVOKE EXECUTE ON FUNCTION public.catering_set_menus_draft_guard(), public.catering_no_draft_on_booking(),
  public.catering_detail_image_cap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.catering_detail_upload_allowed(text), public.catering_detail_folder_has_room(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catering_detail_upload_allowed(text), public.catering_detail_folder_has_room(text) TO authenticated;

DROP TRIGGER IF EXISTS trg_catering_set_menus_draft_guard ON public.catering_set_menus;
CREATE TRIGGER trg_catering_set_menus_draft_guard BEFORE UPDATE OF is_draft ON public.catering_set_menus
  FOR EACH ROW EXECUTE FUNCTION public.catering_set_menus_draft_guard();
DROP TRIGGER IF EXISTS trg_catering_event_menus_no_draft ON public.catering_event_menus;
CREATE TRIGGER trg_catering_event_menus_no_draft BEFORE INSERT OR UPDATE OF set_menu_id ON public.catering_event_menus
  FOR EACH ROW EXECUTE FUNCTION public.catering_no_draft_on_booking();
DROP TRIGGER IF EXISTS trg_catering_event_menu_items_no_draft ON public.catering_event_menu_items;
CREATE TRIGGER trg_catering_event_menu_items_no_draft BEFORE INSERT OR UPDATE OF source_set_menu_id ON public.catering_event_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.catering_no_draft_on_booking();
DROP TRIGGER IF EXISTS trg_catering_event_detail_blocks_image_cap ON public.catering_event_detail_blocks;
CREATE TRIGGER trg_catering_event_detail_blocks_image_cap BEFORE INSERT OR UPDATE OF image_path, event_id ON public.catering_event_detail_blocks
  FOR EACH ROW EXECUTE FUNCTION public.catering_detail_image_cap();
DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.catering_detail_blocks;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.catering_detail_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.catering_event_detail_blocks;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.catering_event_detail_blocks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- C. The set copy refuses a draft itself as well (the trigger above already
-- keeps a draft off every line; this is the function's own word on it). As
-- catering_event_menu_items_migration.sql wrote it, plus the check.
CREATE OR REPLACE FUNCTION public.catering_copy_set_menu(p_event_menu_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role     text := public.current_role();
  v_event    uuid;
  v_set      uuid;
  v_set_name text;
  v_n        integer;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คัดลอกชุดเมนู';
  END IF;

  SELECT m.event_id, m.set_menu_id INTO v_event, v_set
    FROM public.catering_event_menus m WHERE m.id = p_event_menu_id;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'ไม่พบรายการชุดเมนูของงาน';
  END IF;
  IF v_set IS NULL THEN
    RAISE EXCEPTION 'รายการนี้ไม่ได้อ้างอิงชุดเมนูกลาง จึงไม่มีอะไรให้คัดลอก';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_set_menus s WHERE s.id = v_set AND s.is_draft) THEN
    RAISE EXCEPTION 'ชุดเมนูนี้ยังเป็นฉบับร่าง ใช้กับงานไม่ได้';
  END IF;
  IF NOT public.catering_event_unlocked(v_event) THEN
    RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว รายการอาหารถูกตรึงไว้';
  END IF;
  -- A copy that was MADE is the record, however many rows it holds now — an
  -- owner may empty a set to rebuild it, and that must not read as "never
  -- copied". The marker is set_name, stamped below; rows without it (a
  -- direct insert) count too. Never overwritten from here.
  IF (SELECT m.set_name FROM public.catering_event_menus m WHERE m.id = p_event_menu_id) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = p_event_menu_id) THEN
    RETURN 0;
  END IF;

  SELECT s.name INTO v_set_name FROM public.catering_set_menus s WHERE s.id = v_set;

  INSERT INTO public.catering_event_menu_items
    (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
  SELECT v_event, p_event_menu_id, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
    FROM public.catering_set_menu_items i
   WHERE i.set_menu_id = v_set
   ORDER BY i.sort_order, i.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.catering_event_menus SET set_name = COALESCE(set_name, v_set_name, 'ชุดเมนู') WHERE id = p_event_menu_id;
  RETURN v_n;
END
$fn$;

-- B + C. THE PRICE-BOX SAVE, REPLACED: as catering_booking_prices_save_migration.sql
-- wrote it, with the free mark carried on its lines and a draft refused as a
-- new set line. Nothing else in it changes.
CREATE OR REPLACE FUNCTION public.catering_save_booking_prices(
  p_event_id       uuid,
  p_lines          jsonb,
  p_known_menu_ids jsonb   DEFAULT NULL,
  p_dry_run        boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  c_qty_max   constant numeric := 100000;
  c_money_max constant numeric := 100000000;
  c_types     constant text[]  := ARRAY['food', 'drink', 'venue', 'service', 'transport', 'equipment', 'other', 'discount'];
  c_uuid      constant text    := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_nothing   constant text    := ' — ยังไม่ได้บันทึกอะไร';
  v_role     text := public.current_role();
  v_unit     text := 'โต๊ะ';
  v_line     jsonb;
  v_step     jsonb;
  v_plan     jsonb := '[]'::jsonb;
  v_stored   jsonb;
  v_i        integer := 0;
  v_kind     text;
  v_emid     uuid;
  v_ref      uuid;
  v_qty      numeric;
  v_name     text;
  v_label    text;
  v_type     text;
  v_price    numeric;
  v_amount   numeric;
  v_known    uuid[];
  v_sent     uuid[] := ARRAY[]::uuid[];
  v_remove   uuid[] := ARRAY[]::uuid[];
  v_elsewhere uuid[] := ARRAY[]::uuid[];
  v_matches  uuid[];
  v_new_refs text[] := ARRAY[]::text[];
  v_new_names text[] := ARRAY[]::text[];
  v_id       uuid;
  v_msort    integer;
  v_n        integer;
  r          record;
  v_free     boolean;
  v_menu_price numeric;
BEGIN
  -- ── WHO, AND WHAT SHAPE ──────────────────────────────────────────────────
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกรายการราคาของงาน';
  END IF;
  -- Neither a check nor a save: refused, rather than read as one of them
  -- (a NULL would otherwise write without taking the booking's lock).
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (p_dry_run)%', c_nothing;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการในกล่องราคา)%', c_nothing;
  END IF;
  IF p_known_menu_ids IS NOT NULL AND jsonb_typeof(p_known_menu_ids) = 'array' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_known_menu_ids) AS k(v)
                WHERE jsonb_typeof(k.v) IS DISTINCT FROM 'string' OR NOT ((k.v #>> '{}') ~ c_uuid)) THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่หน้าจอเปิดไว้)%', c_nothing;
    END IF;
    v_known := ARRAY(SELECT (k.v #>> '{}')::uuid FROM jsonb_array_elements(p_known_menu_ids) AS k(v));
  ELSIF p_known_menu_ids IS NOT NULL AND jsonb_typeof(p_known_menu_ids) <> 'null' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่หน้าจอเปิดไว้)%', c_nothing;
  END IF;

  -- ── WHICH BOOKING. A new one has no row yet: only a dry run may go without.
  IF p_event_id IS NULL THEN
    IF NOT p_dry_run THEN
      RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
    END IF;
  ELSE
    SELECT CASE e.food_format WHEN 'chinese_table' THEN 'โต๊ะ' WHEN 'box_set' THEN 'กล่อง' ELSE 'ชุด' END
      INTO v_unit
      FROM public.catering_events e WHERE e.id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
    END IF;
    IF NOT p_dry_run THEN
      -- Two booking-screen saves of one booking queue here: the second waits
      -- for the first to commit, then reads the lines it wrote. So does
      -- anything that adds a line or a charge to the booking (the foreign key
      -- takes a share lock on this row). The menu page's price and course
      -- edits do not wait here: README queue item 48.
      PERFORM 1 FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE;
    END IF;
    -- For everyone, owner and admin included, as the app has always done:
    -- they unlock on the cost page first.
    IF NOT public.catering_event_unlocked(p_event_id) THEN
      RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ไขได้';
    END IF;
  END IF;

  -- ── EVERY LINE, CHECKED BEFORE ANYTHING IS WRITTEN ───────────────────────
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
    END IF;
    v_kind := v_line->>'kind';

    IF v_kind IN ('set', 'dish') THEN
      IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (จำนวนของรายการที่ %)%', v_i, c_nothing;
      END IF;
      v_qty := (v_line->>'quantity')::numeric;
      v_emid := NULL;
      v_ref := NULL;
      IF jsonb_typeof(v_line->'eventMenuId') = 'string' THEN
        IF p_event_id IS NULL OR NOT ((v_line->>'eventMenuId') ~ c_uuid) THEN
          RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
        END IF;
        v_emid := (v_line->>'eventMenuId')::uuid;
        -- A LINE THE BOOKING STORES: judged by its STORED kind, named by its
        -- own name.
        SELECT CASE WHEN m.set_menu_id IS NOT NULL OR m.menu_id IS NULL THEN 'set' ELSE 'dish' END,
               COALESCE(m.set_name, s.name, d.name,
                        (SELECT c.label FROM public.catering_event_charges c
                          WHERE c.event_menu_id = m.id ORDER BY c.sort_order, c.id LIMIT 1),
                        'รายการที่ ' || v_i)
          INTO v_kind, v_name
          FROM public.catering_event_menus m
          LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
          LEFT JOIN public.menus d ON d.id = m.menu_id
         WHERE m.id = v_emid AND m.event_id = p_event_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'รายการหนึ่งในกล่องราคาถูกลบหรือเปลี่ยนจากหน้าอื่นหลังจากเปิดหน้านี้ — กดโหลดข้อมูลล่าสุด แล้วทำใหม่%', c_nothing;
        END IF;
        IF v_emid = ANY (v_sent) THEN
          RAISE EXCEPTION 'ชุดเมนูหรือเมนูเดียวกันอยู่ในกล่องราคา 2 บรรทัด — ลบบรรทัดที่ซ้ำก่อนบันทึก%', c_nothing;
        END IF;
        v_sent := v_sent || v_emid;
      ELSIF jsonb_typeof(v_line->'eventMenuId') IS NULL OR jsonb_typeof(v_line->'eventMenuId') = 'null' THEN
        -- A NEW LINE: the set or dish it names must exist.
        IF jsonb_typeof(v_line->'refId') IS DISTINCT FROM 'string' OR NOT ((v_line->>'refId') ~ c_uuid) THEN
          RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
        END IF;
        v_ref := (v_line->>'refId')::uuid;
        IF v_kind = 'set' THEN
          SELECT s.name INTO v_name FROM public.catering_set_menus s WHERE s.id = v_ref;
        ELSE
          SELECT d.name INTO v_name FROM public.menus d WHERE d.id = v_ref;
        END IF;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ไม่พบชุดเมนูหรือเมนูที่เลือก (รายการที่ %) — อาจถูกลบไปแล้ว%', v_i, c_nothing;
        END IF;
        -- A DRAFT never reaches a booking (the set-menu design workspace, Nik
        -- 2026-09-24). Sales never sees one, so for sales it is "not found"
        -- above; owner and admin are told why.
        IF v_kind = 'set' AND (SELECT s.is_draft FROM public.catering_set_menus s WHERE s.id = v_ref) THEN
          RAISE EXCEPTION '"%" ยังเป็นชุดเมนูฉบับร่าง ใช้กับงานไม่ได้%', v_name, c_nothing;
        END IF;
        IF (v_kind || ':' || v_ref::text) = ANY (v_new_refs) THEN
          RAISE EXCEPTION '"%" อยู่ในกล่องราคา 2 บรรทัด — ลบบรรทัดที่ซ้ำก่อนบันทึก%', v_name, c_nothing;
        END IF;
        v_new_refs := v_new_refs || (v_kind || ':' || v_ref::text);
      ELSE
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
      END IF;

      -- THE QUANTITY RULE (booking-lines.ts): a set counts whole tables,
      -- boxes or sets; a dish takes up to three decimals.
      IF v_kind = 'set' THEN
        IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > c_qty_max THEN
          RAISE EXCEPTION '"%": จำนวน%ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป ไม่เกิน 100,000%', v_name, v_unit, c_nothing;
        END IF;
      ELSIF v_qty <= 0 OR v_qty > c_qty_max OR v_qty <> round(v_qty, 3) THEN
        RAISE EXCEPTION '"%": จำนวนต้องมากกว่า 0 ไม่เกิน 100,000 และมีทศนิยมไม่เกิน 3 ตำแหน่ง%', v_name, c_nothing;
      END IF;

      -- THE FREE MARK (Nik, 2026-09-24): marked by hand, never read off a ฿0
      -- price. A set is never free (its free items are its own "free"
      -- section). A dish marked free is CHARGED ฿0 by the mark (step 3): no
      -- screen can price a single dish, so the mark is what makes it ฿0.
      IF jsonb_typeof(v_line->'is_free') IS NOT NULL AND jsonb_typeof(v_line->'is_free') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (แถมฟรี ของ "%")%', v_name, c_nothing;
      END IF;
      v_free := COALESCE((v_line->>'is_free')::boolean, false);
      IF v_free AND v_kind = 'set' THEN
        RAISE EXCEPTION '"%": ชุดเมนูทำเครื่องหมายแถมฟรีไม่ได้ — ของแถมในชุดอยู่ในหมวดรายการแถมฟรีของชุด%', v_name, c_nothing;
      END IF;
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'emid', v_emid, 'ref', v_ref, 'qty', v_qty, 'name', v_name, 'free', v_free));

    ELSIF v_kind = 'charge' THEN
      IF jsonb_typeof(v_line->'label') IS DISTINCT FROM 'string' OR btrim(v_line->>'label') = '' THEN
        RAISE EXCEPTION 'มีรายการที่ยังไม่มีชื่อในกล่องราคา (รายการที่ %) — ใส่ชื่อ หรือลบแถวนั้น%', v_i, c_nothing;
      END IF;
      v_label := btrim(v_line->>'label');
      v_type := v_line->>'charge_type';
      IF v_type IS NULL OR NOT (v_type = ANY (c_types)) THEN
        RAISE EXCEPTION '"%": ประเภทรายการไม่ถูกต้อง%', v_label, c_nothing;
      END IF;
      IF v_type = 'food' THEN
        RAISE EXCEPTION '"%": อาหารต้องเลือกจากชุดเมนูหรือเมนูเดี่ยว — รายการที่พิมพ์เองหรือเลือกจากอัตราใช้ประเภทอาหารไม่ได้%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'unit_price') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_line->'amount') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION '"%": ราคา จำนวน และยอดเงินต้องเป็นตัวเลข%', v_label, c_nothing;
      END IF;
      v_price := (v_line->>'unit_price')::numeric;
      v_qty := (v_line->>'quantity')::numeric;
      v_amount := (v_line->>'amount')::numeric;
      IF abs(v_price) > c_money_max OR abs(v_amount) > c_money_max THEN
        RAISE EXCEPTION '"%": ยอดเงินต้องไม่เกิน 100,000,000 บาท%', v_label, c_nothing;
      END IF;
      IF v_qty < 0 OR v_qty > c_qty_max THEN
        RAISE EXCEPTION '"%": จำนวนต้องอยู่ระหว่าง 0 ถึง 100,000%', v_label, c_nothing;
      END IF;
      IF v_type = 'discount' THEN
        IF v_amount > 0 THEN
          RAISE EXCEPTION '"%": ส่วนลดต้องเป็นยอดติดลบหรือ 0%', v_label, c_nothing;
        END IF;
      ELSIF v_price < 0 OR v_amount < 0 THEN
        RAISE EXCEPTION '"%": ราคาและยอดเงินต้องไม่ติดลบ — ถ้าเป็นส่วนลด ให้ใช้แถวส่วนลด%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'rate_id') = 'string' THEN
        IF NOT ((v_line->>'rate_id') ~ c_uuid)
           OR NOT EXISTS (SELECT 1 FROM public.catering_rates t WHERE t.id = (v_line->>'rate_id')::uuid) THEN
          RAISE EXCEPTION '"%": ไม่พบอัตราที่เลือก — อาจถูกลบไปแล้ว เลือกใหม่ หรือพิมพ์รายการเอง%', v_label, c_nothing;
        END IF;
      ELSIF jsonb_typeof(v_line->'rate_id') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง ("%")%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'note') IS NOT NULL AND jsonb_typeof(v_line->'note') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง ("%")%', v_label, c_nothing;
      END IF;

      IF jsonb_typeof(v_line->'is_free') IS NOT NULL AND jsonb_typeof(v_line->'is_free') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (แถมฟรี ของ "%")%', v_label, c_nothing;
      END IF;
      v_free := COALESCE((v_line->>'is_free')::boolean, false);
      IF v_free AND (v_type = 'discount' OR v_amount <> 0 OR v_price <> 0) THEN
        RAISE EXCEPTION '"%": รายการแถมฟรีต้องเป็น 0 บาท (ราคาต่อหน่วย 0 และยอด 0) และไม่ใช่ส่วนลด%', v_label, c_nothing;
      END IF;

      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'kind', 'charge', 'label', v_label, 'type', v_type, 'price', v_price, 'qty', v_qty,
        'amount', v_amount, 'note', nullif(btrim(v_line->>'note'), ''), 'rate', v_line->>'rate_id', 'free', v_free));
    ELSE
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
    END IF;
  END LOOP;

  -- ── WHAT THE PAYLOAD MEANS FOR THE LINES THE BOOKING STORES ──────────────
  IF p_event_id IS NOT NULL THEN
    -- The lines the screen had and dropped. NULL known ids: every stored line.
    SELECT COALESCE(array_agg(m.id ORDER BY m.id), ARRAY[]::uuid[]) INTO v_remove
      FROM public.catering_event_menus m
     WHERE m.event_id = p_event_id
       AND NOT (m.id = ANY (v_sent))
       AND (v_known IS NULL OR m.id = ANY (v_known));
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_plan) - 1 LOOP
    v_step := v_plan->v_i;
    CONTINUE WHEN v_step->>'kind' = 'charge' OR (v_step->>'emid') IS NOT NULL;
    v_ref := (v_step->>'ref')::uuid;
    v_matches := ARRAY[]::uuid[];
    IF p_event_id IS NOT NULL THEN
      SELECT COALESCE(array_agg(m.id ORDER BY m.id), ARRAY[]::uuid[]) INTO v_matches
        FROM public.catering_event_menus m
       WHERE m.event_id = p_event_id
         AND NOT (m.id = ANY (v_remove))
         AND CASE WHEN v_step->>'kind' = 'set' THEN m.set_menu_id = v_ref ELSE m.menu_id = v_ref END;
    END IF;
    IF v_matches && v_sent THEN
      RAISE EXCEPTION '"%" อยู่ในกล่องราคาแล้ว — แก้จำนวนในบรรทัดเดิมแทน%', v_step->>'name', c_nothing;
    END IF;
    IF cardinality(v_matches) > 1 THEN
      RAISE EXCEPTION '"%" อยู่ในงานนี้มากกว่า 1 บรรทัดแล้ว — กดโหลดข้อมูลล่าสุด แล้วลบบรรทัดที่ซ้ำก่อน%', v_step->>'name', c_nothing;
    END IF;
    IF cardinality(v_matches) = 1 THEN
      -- The booking gained a line for this same set or dish ELSEWHERE since
      -- the screen opened: this line is that one, as the save always treated
      -- it (it used to add to it, then write the screen's quantity over it).
      v_plan := jsonb_set(v_plan, ARRAY[v_i::text, 'emid'], to_jsonb(v_matches[1]::text));
      v_sent := v_sent || v_matches[1];
      CONTINUE;
    END IF;
    IF v_step->>'kind' = 'set' THEN
      -- A5: one set of a name per booking — against every set line that stays
      -- and every other new set of this payload.
      IF lower(btrim(v_step->>'name')) = ANY (v_new_names)
         OR EXISTS (SELECT 1
                      FROM public.catering_event_menus m
                      LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
                     WHERE m.event_id = p_event_id AND m.menu_id IS NULL
                       AND NOT (m.id = ANY (v_remove))
                       AND lower(btrim(COALESCE(m.set_name, s.name,
                             (SELECT c.label FROM public.catering_event_charges c WHERE c.event_menu_id = m.id ORDER BY c.sort_order, c.id LIMIT 1),
                             ''))) = lower(btrim(v_step->>'name'))) THEN
        RAISE EXCEPTION 'งานนี้มีชุดชื่อ "%" อยู่แล้ว — แก้จำนวนในบรรทัดเดิม หรือลบชุดเดิมก่อน%', v_step->>'name', c_nothing;
      END IF;
      v_new_names := v_new_names || lower(btrim(v_step->>'name'));
    END IF;
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'lines', jsonb_array_length(v_plan), 'removed', cardinality(v_remove));
  END IF;

  -- ── THE WRITE: one transaction, so a failure anywhere below undoes all of it
  --
  -- 0. The booking's conflict token moves with its price box. The screen
  --    writes the booking's fields first, in a transaction of their own; a
  --    screen that took the booking between the two held the new token and
  --    the OLD price box, and its save then passed the token check and wrote
  --    its stale price box over this one (review, 2026-09-21).
  UPDATE public.catering_events e SET updated_at = now() WHERE e.id = p_event_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลงาน%', c_nothing;
  END IF;

  -- Each stored line's charge, read BEFORE anything is deleted: a kept line's
  -- label, price and note come from here.
  SELECT COALESCE(jsonb_object_agg(x.event_menu_id::text, jsonb_build_object(
           'label', x.label, 'unit_price', x.unit_price, 'quantity', x.quantity, 'amount', x.amount, 'note', x.note,
           'is_free', x.is_free)),
         '{}'::jsonb)
    INTO v_stored
    FROM (SELECT DISTINCT ON (c.event_menu_id) c.event_menu_id, c.label, c.unit_price, c.quantity, c.amount, c.note, c.is_free
            FROM public.catering_event_charges c
           WHERE c.event_id = p_event_id AND c.event_menu_id IS NOT NULL
           ORDER BY c.event_menu_id, c.sort_order, c.id) x;

  -- 1. The lines the screen dropped, each named in the history by its OWN
  --    name — a custom or copied set's set_name first.
  FOR r IN SELECT m.id,
                  COALESCE(m.set_name, s.name, d.name, v_stored->(m.id::text)->>'label', 'ชุดเมนูของงาน') AS name
             FROM public.catering_event_menus m
             LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
             LEFT JOIN public.menus d ON d.id = m.menu_id
            WHERE m.id = ANY (v_remove)
            ORDER BY m.sort_order, m.id LOOP
    DELETE FROM public.catering_event_menus m WHERE m.id = r.id;
    INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
      VALUES (p_event_id, auth.uid(), 'menu_removed', 'ลบเมนู: ' || r.name);
  END LOOP;

  -- 2. Every charge the payload rewrites. The charges of lines created
  --    ELSEWHERE since the screen opened stay as they are.
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_elsewhere
    FROM public.catering_event_menus m
   WHERE m.event_id = p_event_id AND NOT (m.id = ANY (v_sent));
  DELETE FROM public.catering_event_charges c
   WHERE c.event_id = p_event_id
     AND (c.event_menu_id IS NULL OR NOT (c.event_menu_id = ANY (v_elsewhere)));

  -- 3. The payload, in print order.
  SELECT COALESCE(max(m.sort_order), 0) INTO v_msort FROM public.catering_event_menus m WHERE m.event_id = p_event_id;
  FOR v_i IN 0 .. jsonb_array_length(v_plan) - 1 LOOP
    v_step := v_plan->v_i;
    IF v_step->>'kind' = 'charge' THEN
      INSERT INTO public.catering_event_charges
        (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order, is_free)
      VALUES
        (p_event_id, v_step->>'label', v_step->>'type', (v_step->>'price')::numeric, (v_step->>'qty')::numeric,
         (v_step->>'amount')::numeric, v_step->>'note', NULL, (v_step->>'rate')::uuid, (v_i + 1) * 10,
         COALESCE((v_step->>'free')::boolean, false));
      CONTINUE;
    END IF;

    v_qty := (v_step->>'qty')::numeric;
    IF (v_step->>'emid') IS NOT NULL THEN
      -- A kept line: the quantity sent, and its charge back at THE STORED
      -- PRICE (the menu page edits it; the screen never sends one).
      v_id := (v_step->>'emid')::uuid;
      UPDATE public.catering_event_menus m SET quantity = v_qty WHERE m.id = v_id AND m.quantity IS DISTINCT FROM v_qty;
      IF v_stored ? v_id::text THEN
        v_label := v_stored->(v_id::text)->>'label';
        v_price := (v_stored->(v_id::text)->>'unit_price')::numeric;
        -- Saved at the quantity it had, it keeps the amount it had: a save
        -- that changes nothing changes nothing.
        v_amount := CASE WHEN (v_stored->(v_id::text)->>'quantity')::numeric = v_qty
                         THEN (v_stored->(v_id::text)->>'amount')::numeric
                         ELSE round(v_price * v_qty, 2) END;
        -- THE FREE MARK prices a dish: marked, ฿0; the mark taken off, the
        -- dish's own price again. A set line is never free, so never repriced.
        IF COALESCE((v_step->>'free')::boolean, false) THEN
          v_price := 0;
          v_amount := 0;
        ELSIF COALESCE((v_stored->(v_id::text)->>'is_free')::boolean, false) THEN
          SELECT d.selling_price INTO v_menu_price
            FROM public.catering_event_menus m JOIN public.menus d ON d.id = m.menu_id
           WHERE m.id = v_id;
          IF FOUND THEN
            v_price := COALESCE(v_menu_price, 0);
            v_amount := round(v_price * v_qty, 2);
          END IF;
        END IF;
        INSERT INTO public.catering_event_charges
          (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order, is_free)
        VALUES
          (p_event_id, v_label, 'food', v_price, v_qty, v_amount, v_stored->(v_id::text)->>'note', v_id, NULL, (v_i + 1) * 10,
           COALESCE((v_step->>'free')::boolean, false));
      ELSE
        -- A stored line without a charge (none today): priced from its set or
        -- dish, as when it was picked.
        SELECT COALESCE(m.set_name, s.name, d.name, v_step->>'name'), COALESCE(s.price_per_set, d.selling_price, 0)
          INTO v_label, v_price
          FROM public.catering_event_menus m
          LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
          LEFT JOIN public.menus d ON d.id = m.menu_id
         WHERE m.id = v_id;
        IF COALESCE((v_step->>'free')::boolean, false) THEN
          v_price := 0;
        END IF;
        INSERT INTO public.catering_event_charges
          (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order, is_free)
        VALUES
          (p_event_id, v_label, 'food', v_price, v_qty, round(v_price * v_qty, 2), NULL, v_id, NULL, (v_i + 1) * 10,
           COALESCE((v_step->>'free')::boolean, false));
      END IF;
    ELSE
      -- A NEW line: its row, the booking's own copy of a set, and its charge
      -- at the set's or dish's price.
      v_ref := (v_step->>'ref')::uuid;
      v_msort := v_msort + 10;
      IF v_step->>'kind' = 'set' THEN
        SELECT s.name, s.price_per_set INTO v_label, v_price FROM public.catering_set_menus s WHERE s.id = v_ref;
        INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order)
          VALUES (p_event_id, v_ref, NULL, v_qty, v_msort)
          RETURNING id INTO v_id;
        PERFORM public.catering_copy_set_menu(v_id);
      ELSE
        SELECT d.name, d.selling_price INTO v_label, v_price FROM public.menus d WHERE d.id = v_ref;
        IF COALESCE((v_step->>'free')::boolean, false) THEN
          v_price := 0;
        END IF;
        INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order)
          VALUES (p_event_id, NULL, v_ref, v_qty, v_msort)
          RETURNING id INTO v_id;
      END IF;
      INSERT INTO public.catering_event_charges
        (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order, is_free)
      VALUES
        (p_event_id, v_label, 'food', v_price, v_qty, round(v_price * v_qty, 2), NULL, v_id, NULL, (v_i + 1) * 10,
           COALESCE((v_step->>'free')::boolean, false));
      INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
        VALUES (p_event_id, auth.uid(), 'menu_added', 'เพิ่มเมนู: ' || v_label);
    END IF;
  END LOOP;

  -- 4. Lines created elsewhere keep their charges, printed after the rest.
  v_n := jsonb_array_length(v_plan);
  FOR r IN SELECT c.id FROM public.catering_event_charges c
            WHERE c.event_id = p_event_id AND c.event_menu_id = ANY (v_elsewhere)
            ORDER BY c.sort_order, c.id LOOP
    v_n := v_n + 1;
    UPDATE public.catering_event_charges c SET sort_order = v_n * 10 WHERE c.id = r.id;
  END LOOP;

  -- 5. One history line for the price box, as the save always wrote.
  INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
    VALUES (p_event_id, auth.uid(), 'charges_updated', 'แก้ไขรายการค่าใช้จ่าย');

  RETURN jsonb_build_object('dry_run', false, 'lines', jsonb_array_length(v_plan), 'removed', cardinality(v_remove));
END
$fn$;

COMMENT ON FUNCTION public.catering_save_booking_prices(uuid, jsonb, jsonb, boolean) IS
  'ONE save of the booking screen''s price box (Nik, 2026-09-21): removes the lines the screen dropped '
  '(named in the history by their own name), rewrites every charge of the payload, adds new lines with '
  'the booking''s own copy of a set, and keeps lines created elsewhere since the screen opened — in one '
  'transaction that also moves the booking''s updated_at (the screen''s conflict token), after checking every line. '
  'A kept menu line''s price is the stored one. Owner, admin, sales; refuses a locked booking for everyone. '
  'p_dry_run checks and writes nothing. SECURITY INVOKER. Since 2026-09-24: a line may carry is_free (แถมฟรี: '
  'a ฿0 charge or dish line, never a set or a discount), and a draft set is refused as a new line.';

-- C. A DRAFT'S SAVE: its name, price and dishes in ONE transaction, under a
-- version check (owner and admin share drafts; a save over someone else's
-- newer one is refused, never silently the winner). The set row is locked
-- first, so a concurrent make-real waits for it and the dishes of a set that
-- has just become real are never rewritten from here. SECURITY INVOKER: it
-- runs under the caller's own row security. Returns the new version.
CREATE OR REPLACE FUNCTION public.catering_save_set_draft(p_id uuid, p_seen timestamptz, p_name text, p_price numeric, p_items jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role     text := public.current_role();
  v_is_draft boolean;
  v_version  timestamptz;
  v_item     jsonb;
  v_qty      numeric;
  v_i        integer := 0;
  c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ชุดทดลองได้';
  END IF;
  SELECT s.is_draft, s.updated_at INTO v_is_draft, v_version
    FROM public.catering_set_menus s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_is_draft THEN
    RAISE EXCEPTION 'ไม่พบชุดเมนูฉบับร่างนี้ — อาจถูกทำเป็นชุดจริงหรือลบไปแล้ว';
  END IF;
  IF p_seen IS NULL OR v_version IS DISTINCT FROM p_seen THEN
    RAISE EXCEPTION 'ชุดทดลองนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง' USING HINT = 'conflict';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ใส่ชื่อชุดเมนู (ไม่เกิน 200 ตัวอักษร)';
  END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 10000000 OR p_price <> round(p_price, 2) THEN
    RAISE EXCEPTION 'ราคาต่อโต๊ะไม่ถูกต้อง';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'รายการอาหารไม่ถูกต้อง';
  END IF;

  UPDATE public.catering_set_menus s SET name = btrim(p_name), price_per_set = p_price
   WHERE s.id = p_id
  RETURNING s.updated_at INTO v_version;
  DELETE FROM public.catering_set_menu_items i WHERE i.set_menu_id = p_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'menu_id') IS DISTINCT FROM 'string'
       OR NOT ((v_item->>'menu_id') ~ c_uuid)
       OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
       OR NOT ((v_item->>'section') = ANY (ARRAY['dish', 'dessert', 'drink', 'free']))
       OR COALESCE(jsonb_typeof(v_item->'note'), 'null') NOT IN ('null', 'string')
       OR char_length(COALESCE(v_item->>'note', '')) > 300 THEN
      RAISE EXCEPTION 'รายการอาหารที่ % ไม่ถูกต้อง', v_i;
    END IF;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty <= 0 OR v_qty > 100000 OR v_qty <> round(v_qty, 3) THEN
      RAISE EXCEPTION 'รายการอาหารที่ %: จำนวนต่อชุดต้องมากกว่า 0 ไม่เกิน 100,000 และมีทศนิยมไม่เกิน 3 ตำแหน่ง', v_i;
    END IF;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section, note, sort_order)
    VALUES (p_id, (v_item->>'menu_id')::uuid, v_qty, v_item->>'section', nullif(btrim(v_item->>'note'), ''), v_i * 10);
  END LOOP;
  RETURN v_version;
END
$fn$;

-- C. MAKE IT REAL: the name and the price, then the flag cleared, in ONE
-- transaction with the set row locked, so the checks below see what is
-- committed: the draft has dishes, and no real set has its name (a booking
-- refuses two sets of one name).
CREATE OR REPLACE FUNCTION public.catering_make_set_real(p_id uuid, p_seen timestamptz, p_name text, p_price numeric)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role     text := public.current_role();
  v_is_draft boolean;
  v_version  timestamptz;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่ทำชุดทดลองเป็นชุดจริงได้';
  END IF;
  SELECT s.is_draft, s.updated_at INTO v_is_draft, v_version
    FROM public.catering_set_menus s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_is_draft THEN
    RAISE EXCEPTION 'ไม่พบชุดเมนูฉบับร่างนี้ — อาจถูกทำเป็นชุดจริงหรือลบไปแล้ว';
  END IF;
  IF p_seen IS NULL OR v_version IS DISTINCT FROM p_seen THEN
    RAISE EXCEPTION 'ชุดทดลองนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง' USING HINT = 'conflict';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ใส่ชื่อชุดเมนู (ไม่เกิน 200 ตัวอักษร)';
  END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price > 10000000 OR p_price <> round(p_price, 2) THEN
    RAISE EXCEPTION 'ใส่ราคาต่อโต๊ะก่อนทำเป็นชุดจริง';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = p_id) THEN
    RAISE EXCEPTION 'ชุดนี้ยังไม่มีรายการอาหาร';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_set_menus s
              WHERE NOT s.is_draft AND lower(btrim(s.name)) = lower(btrim(p_name))) THEN
    RAISE EXCEPTION 'มีชุดเมนูจริงชื่อ "%" อยู่แล้ว — ตั้งชื่ออื่น', btrim(p_name);
  END IF;
  UPDATE public.catering_set_menus s SET name = btrim(p_name), price_per_set = p_price, is_draft = false
   WHERE s.id = p_id;
END
$fn$;

-- A. A BOOKING'S SHEET, saved whole: its job notes and its blocks, in the
-- order given, in ONE transaction. Refused on a cancelled booking and on a
-- cost-locked one FOR EVERYONE (the app's rule for the booking's non-price
-- fields), and when the sheet changed since the screen opened it: p_seen is
-- the notes and every block's id and last change as the screen read them.
-- The booking row is locked (not changed) so two saves take turns. A block
-- the sheet holds is updated as a row of THIS booking; a new one is added
-- with the id the screen gave it; one another booking holds is refused. A
-- library image is one a library block holds, or one this booking already
-- shows (a library block may have changed its image since). SECURITY
-- INVOKER: the tables' own policies apply as well. Returns the sheet's new
-- version, read inside the same transaction, so a screen never takes
-- someone else's later save for its own.
CREATE OR REPLACE FUNCTION public.catering_save_event_sheet(p_event_id uuid, p_seen jsonb, p_notes text, p_blocks jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role   text := public.current_role();
  v_status text;
  v_locked timestamptz;
  v_notes  text;
  v_cur    jsonb;
  v_want   jsonb;
  v_b      jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_id     uuid;
  v_path   text;
  v_i      integer := 0;
  c_uuid   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ใบรายละเอียดงาน';
  END IF;
  SELECT e.status, e.cost_locked_at INTO v_status, v_locked FROM public.catering_events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'งานนี้ถูกยกเลิกแล้ว แก้ใบรายละเอียดงานไม่ได้';
  END IF;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ใบรายละเอียดงานได้';
  END IF;
  PERFORM 1 FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE;
  SELECT e.sheet_notes INTO v_notes FROM public.catering_events e WHERE e.id = p_event_id;

  IF jsonb_typeof(p_seen) IS DISTINCT FROM 'object'
     OR jsonb_typeof(COALESCE(p_seen->'blocks', '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ใบรายละเอียดงานนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง' USING HINT = 'conflict';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(b.id::text, b.updated_at) ORDER BY b.id::text), '[]'::jsonb) INTO v_cur
    FROM public.catering_event_detail_blocks b WHERE b.event_id = p_event_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(x->>'id', (x->>'updated_at')::timestamptz) ORDER BY x->>'id'), '[]'::jsonb) INTO v_want
    FROM jsonb_array_elements(COALESCE(p_seen->'blocks', '[]'::jsonb)) x;
  IF v_cur IS DISTINCT FROM v_want OR (p_seen->>'notes') IS DISTINCT FROM v_notes THEN
    RAISE EXCEPTION 'ใบรายละเอียดงานนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง' USING HINT = 'conflict';
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 4000 THEN
    RAISE EXCEPTION 'บันทึกงานยาวเกิน 4,000 ตัวอักษร';
  END IF;
  IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_blocks) > 40 THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง';
  END IF;
  FOR v_b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    IF jsonb_typeof(v_b) IS DISTINCT FROM 'object' OR NOT (COALESCE(v_b->>'id', '') ~ c_uuid) THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง';
    END IF;
    v_id := (v_b->>'id')::uuid;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'มีหัวข้อซ้ำในใบรายละเอียดงาน';
    END IF;
    IF EXISTS (SELECT 1 FROM public.catering_event_detail_blocks b WHERE b.id = v_id AND b.event_id <> p_event_id) THEN
      RAISE EXCEPTION 'หัวข้อนี้เป็นของงานอื่น';
    END IF;
    v_ids := v_ids || v_id;
    IF jsonb_typeof(v_b->'block_id') = 'string' THEN
      IF NOT ((v_b->>'block_id') ~ c_uuid)
         OR NOT EXISTS (SELECT 1 FROM public.catering_detail_blocks l WHERE l.id = (v_b->>'block_id')::uuid) THEN
        RAISE EXCEPTION 'ไม่พบหัวข้อนี้ในคลังแล้ว';
      END IF;
    ELSIF COALESCE(jsonb_typeof(v_b->'block_id'), 'null') <> 'null' THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง';
    END IF;
    v_path := v_b->>'image_path';
    IF left(COALESCE(v_path, ''), 4) = 'lib/'
       AND NOT EXISTS (SELECT 1 FROM public.catering_detail_blocks l WHERE l.image_path = v_path)
       AND NOT EXISTS (SELECT 1 FROM public.catering_event_detail_blocks b WHERE b.event_id = p_event_id AND b.image_path = v_path) THEN
      RAISE EXCEPTION 'ไม่พบรูปนี้ในคลัง';
    END IF;
  END LOOP;

  UPDATE public.catering_events e SET sheet_notes = p_notes
   WHERE e.id = p_event_id AND e.sheet_notes IS DISTINCT FROM p_notes;
  DELETE FROM public.catering_event_detail_blocks b WHERE b.event_id = p_event_id AND NOT (b.id = ANY (v_ids));
  FOR v_b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    v_i := v_i + 1;
    v_id := (v_b->>'id')::uuid;
    UPDATE public.catering_event_detail_blocks b
       SET block_id = (v_b->>'block_id')::uuid,
           kind = v_b->>'kind',
           title = btrim(v_b->>'title'),
           body = CASE WHEN v_b->>'kind' = 'terms' THEN v_b->>'body' END,
           image_path = CASE WHEN v_b->>'kind' = 'terms' THEN NULL ELSE v_b->>'image_path' END,
           caption = CASE WHEN v_b->>'kind' = 'terms' THEN NULL ELSE nullif(btrim(v_b->>'caption'), '') END,
           sort_order = v_i * 10
     WHERE b.id = v_id AND b.event_id = p_event_id;
    IF NOT FOUND THEN
      INSERT INTO public.catering_event_detail_blocks (id, event_id, block_id, kind, title, body, image_path, caption, sort_order)
      VALUES (v_id, p_event_id, (v_b->>'block_id')::uuid, v_b->>'kind', btrim(v_b->>'title'),
              CASE WHEN v_b->>'kind' = 'terms' THEN v_b->>'body' END,
              CASE WHEN v_b->>'kind' = 'terms' THEN NULL ELSE v_b->>'image_path' END,
              CASE WHEN v_b->>'kind' = 'terms' THEN NULL ELSE nullif(btrim(v_b->>'caption'), '') END,
              v_i * 10);
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'notes', (SELECT e.sheet_notes FROM public.catering_events e WHERE e.id = p_event_id),
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'updated_at', b.updated_at) ORDER BY b.id::text)
                         FROM public.catering_event_detail_blocks b WHERE b.event_id = p_event_id), '[]'::jsonb));
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb),
  public.catering_make_set_real(uuid, timestamptz, text, numeric),
  public.catering_save_event_sheet(uuid, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb),
  public.catering_make_set_real(uuid, timestamptz, text, numeric),
  public.catering_save_event_sheet(uuid, jsonb, text, jsonb) TO authenticated;

DO $do$
BEGIN
  PERFORM pg_temp.note('ok      the functions: the draft guard, the no-draft-on-a-booking trigger, the 6-image cap, the upload rule and the folder room, the set copy and the price-box save (replaced), the draft''s save and make-real, the sheet''s save');
END
$do$;

-- ── Step 3: who may read and write ─────────────────────────────────────────

-- C. A draft and its dish rows: owner and admin only. RESTRICTIVE, so it
-- holds whatever permissive policy the tables have (catering_set_menus_rw
-- and catering_set_menu_items_rw admit sales).
DROP POLICY IF EXISTS catering_set_menus_drafts_hidden ON public.catering_set_menus;
CREATE POLICY catering_set_menus_drafts_hidden ON public.catering_set_menus
  AS RESTRICTIVE FOR SELECT TO public
  USING (NOT is_draft OR public.current_role() IN ('owner', 'admin'));
DROP POLICY IF EXISTS catering_set_menu_items_drafts_hidden ON public.catering_set_menu_items;
CREATE POLICY catering_set_menu_items_drafts_hidden ON public.catering_set_menu_items
  AS RESTRICTIVE FOR SELECT TO public
  USING (public.current_role() IN ('owner', 'admin')
         OR EXISTS (SELECT 1 FROM public.catering_set_menus s WHERE s.id = set_menu_id AND NOT s.is_draft));

-- A. The library: owner, admin and sales read; owner and admin write.
ALTER TABLE public.catering_detail_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catering_detail_blocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_detail_blocks TO authenticated;
DROP POLICY IF EXISTS catering_detail_blocks_read ON public.catering_detail_blocks;
CREATE POLICY catering_detail_blocks_read ON public.catering_detail_blocks
  FOR SELECT TO authenticated
  USING (public.current_role() IN ('owner', 'admin', 'sales'));
DROP POLICY IF EXISTS catering_detail_blocks_write ON public.catering_detail_blocks;
CREATE POLICY catering_detail_blocks_write ON public.catering_detail_blocks
  FOR ALL TO authenticated
  USING (public.current_role() IN ('owner', 'admin'))
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

-- A. A booking's picks: owner, admin and sales, under the booking's cost
-- lock exactly as its menu lines and charges are.
ALTER TABLE public.catering_event_detail_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catering_event_detail_blocks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catering_event_detail_blocks TO authenticated;
DROP POLICY IF EXISTS catering_event_detail_blocks_rw ON public.catering_event_detail_blocks;
CREATE POLICY catering_event_detail_blocks_rw ON public.catering_event_detail_blocks
  FOR ALL TO authenticated
  USING (public.current_role() IN ('owner', 'admin', 'sales'))
  WITH CHECK (public.current_role() IN ('owner', 'admin', 'sales'));
DROP POLICY IF EXISTS catering_event_detail_blocks_lock_insert ON public.catering_event_detail_blocks;
CREATE POLICY catering_event_detail_blocks_lock_insert ON public.catering_event_detail_blocks
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));
DROP POLICY IF EXISTS catering_event_detail_blocks_lock_update ON public.catering_event_detail_blocks;
CREATE POLICY catering_event_detail_blocks_lock_update ON public.catering_event_detail_blocks
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id))
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));
DROP POLICY IF EXISTS catering_event_detail_blocks_lock_delete ON public.catering_event_detail_blocks;
CREATE POLICY catering_event_detail_blocks_lock_delete ON public.catering_event_detail_blocks
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

-- A. The bucket: private, JPEG and PNG, 2 MB a file (the storage API applies
-- these two limits; SQL can only set them).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catering-details', 'catering-details', false, 2097152, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Reading: signed-in owner, admin and sales. Uploading: the app's names only.
-- The caps are RESTRICTIVE and name only this bucket: whatever other policy
-- storage.objects has, these hold for catering-details, and nothing else
-- changes for any other bucket.
DROP POLICY IF EXISTS "catering details read" ON storage.objects;
CREATE POLICY "catering details read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'catering-details' AND public.current_role() IN ('owner', 'admin', 'sales'));
DROP POLICY IF EXISTS "catering details upload" ON storage.objects;
CREATE POLICY "catering details upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catering-details' AND public.catering_detail_upload_allowed(name) AND public.catering_detail_folder_has_room(name));
DROP POLICY IF EXISTS "catering details read cap" ON storage.objects;
CREATE POLICY "catering details read cap" ON storage.objects
  AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'catering-details' OR public.current_role() IN ('owner', 'admin', 'sales'));
DROP POLICY IF EXISTS "catering details upload cap" ON storage.objects;
CREATE POLICY "catering details upload cap" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (bucket_id <> 'catering-details' OR (public.catering_detail_upload_allowed(name) AND public.catering_detail_folder_has_room(name)));
DROP POLICY IF EXISTS "catering details no overwrite" ON storage.objects;
CREATE POLICY "catering details no overwrite" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id <> 'catering-details')
  WITH CHECK (bucket_id <> 'catering-details');
DROP POLICY IF EXISTS "catering details no delete" ON storage.objects;
CREATE POLICY "catering details no delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO public
  USING (bucket_id <> 'catering-details');

DO $do$
BEGIN
  PERFORM pg_temp.note('ok      the policies: drafts hidden from sales (sets and their dish rows), the library, a booking''s picks under the cost lock, and the bucket (read, upload, and caps: no overwrite, no delete)');
END
$do$;

-- ── Step 4: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  owner_  uuid := current_setting('sheet.owner')::uuid;
  admin_  uuid := current_setting('sheet.admin')::uuid;
  sales_  uuid := current_setting('sheet.sales')::uuid;
  editor_ uuid := current_setting('sheet.editor')::uuid;
  staff_  uuid := current_setting('sheet.staff')::uuid;
  v_open   uuid;   -- an open booking
  v_bk2    uuid;   -- a second open booking (the free mark, the image cap)
  v_locked uuid;   -- a cost-locked booking
  v_cancel uuid;   -- a cancelled booking
  v_dish   uuid;   -- a dish with a price
  v_real   uuid;   -- a real set
  v_draft  uuid;   -- a draft set
  v_block  uuid;   -- a library terms block
  v_line   uuid;   -- the booking line C1 makes
  v_draft3 uuid;   -- a draft for its save and make-real
  v_draft4 uuid;   -- a draft with no dishes
  v_emid   uuid;   -- the dish line B8 makes
  v_seen   jsonb;  -- a sheet's version, as a screen holds it
  v_newpick uuid := gen_random_uuid();
  v_other  uuid;   -- a block of another booking
  v_i      integer;
  v_log    text;
  v_body   text := 'ข้อกำหนดทดสอบ';
BEGIN
  PERFORM set_config('sheet.n_blocks', (SELECT count(*) FROM public.catering_detail_blocks)::text, false);
  PERFORM set_config('sheet.n_picks',  (SELECT count(*) FROM public.catering_event_detail_blocks)::text, false);
  BEGIN
    -- ── Setup, as the file's own role; the block always rolls back ──
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-02-01', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-sheet') RETURNING id INTO v_open;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-02-02', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-sheet') RETURNING id INTO v_bk2;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note, cost_locked_at)
    VALUES (DATE '2099-02-03', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-sheet', now()) RETURNING id INTO v_locked;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-02-04', 'in_house', 'air_shared', 'catering', 'cancelled', 'probe-sheet') RETURNING id INTO v_cancel;
    SELECT id INTO v_dish FROM public.menus WHERE selling_price > 0 ORDER BY id LIMIT 1;
    INSERT INTO public.catering_set_menus (name, price_per_set) VALUES ('probe-real-set', 1000) RETURNING id INTO v_real;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section) VALUES (v_real, v_dish, 1, 'dish');
    INSERT INTO public.catering_set_menus (name, price_per_set, is_draft) VALUES ('probe-draft-set', 2000, true) RETURNING id INTO v_draft;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section) VALUES (v_draft, v_dish, 1, 'dish');
    INSERT INTO public.catering_detail_blocks (kind, title, body, venue_tags) VALUES ('terms', 'probe-terms', v_body, ARRAY['ภายในร้าน'])
      RETURNING id INTO v_block;
    INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'lib/1700000000000-probe.jpg');
    FOR v_i IN 1 .. 6 LOOP
      INSERT INTO public.catering_event_detail_blocks (event_id, kind, title, image_path)
      VALUES (v_bk2, 'photo', 'probe-image-' || v_i, format('evt/%s/17000000000%s0-probe.jpg', v_bk2, v_i));
    END LOOP;
    INSERT INTO public.catering_set_menus (name, price_per_set, is_draft) VALUES ('probe-draft-d', 1500, true) RETURNING id INTO v_draft3;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section) VALUES (v_draft3, v_dish, 1, 'dish');
    INSERT INTO public.catering_set_menus (name, price_per_set, is_draft) VALUES ('probe-draft-empty', 1500, true) RETURNING id INTO v_draft4;
    -- A booking folder already holding 30 files: the next upload has no room.
    FOR v_i IN 1 .. 30 LOOP
      INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', format('evt/%s/1700000000%s-fill.jpg', v_bk2, lpad(v_i::text, 3, '0')));
    END LOOP;
    SELECT id INTO v_other FROM public.catering_event_detail_blocks WHERE event_id = v_bk2 ORDER BY id LIMIT 1;
    PERFORM pg_temp.note('ok      test data made: four bookings (open, open, cost-locked, cancelled), a real set and three drafts (one empty), a library block, a library image, six images and thirty files on one booking; all rolled back');

    -- ── C. Drafts: sales never reaches one ──
    PERFORM pg_temp.t('C1 owner puts the REAL set on a booking through the price box (kept)', owner_, 'owner',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_open,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_real, 'quantity', 2))::text),
      ARRAY['rows=1'], NULL, true);
    SELECT id INTO v_line FROM public.catering_event_menus WHERE event_id = v_open AND set_menu_id = v_real;
    IF v_line IS NULL OR NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = v_line) THEN
      RAISE EXCEPTION 'FAIL    C1 the real set did not reach the booking with its dishes: the replaced functions are broken. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      C1 read back: the replaced price-box save and set copy still put a real set on a booking, with its dishes');
    PERFORM pg_temp.t('C2 sales reads the draft set', sales_, 'sales',
      format($q$SELECT id FROM public.catering_set_menus WHERE id = %L$q$, v_draft), ARRAY['rows=0']);
    PERFORM pg_temp.t('C3 sales reads the draft''s dish rows', sales_, 'sales',
      format($q$SELECT id FROM public.catering_set_menu_items WHERE set_menu_id = %L$q$, v_draft), ARRAY['rows=0']);
    PERFORM pg_temp.t('C4 sales reads the real set (the control)', sales_, 'sales',
      format($q$SELECT id FROM public.catering_set_menus WHERE id = %L$q$, v_real), ARRAY['rows=1']);
    PERFORM pg_temp.t('C5 sales reads the real set''s dish rows (the control)', sales_, 'sales',
      format($q$SELECT id FROM public.catering_set_menu_items WHERE set_menu_id = %L$q$, v_real), ARRAY['rows=1']);
    PERFORM pg_temp.t('C6 admin reads the draft set', admin_, 'admin',
      format($q$SELECT id FROM public.catering_set_menus WHERE id = %L$q$, v_draft), ARRAY['rows=1']);
    PERFORM pg_temp.t('C7 owner reads the draft''s dish rows', owner_, 'owner',
      format($q$SELECT id FROM public.catering_set_menu_items WHERE set_menu_id = %L$q$, v_draft), ARRAY['rows=1']);
    PERFORM pg_temp.t('C8 editor reads the draft set', editor_, 'editor',
      format($q$SELECT id FROM public.catering_set_menus WHERE id = %L$q$, v_draft), ARRAY['rows=0']);
    PERFORM pg_temp.t('C9 sales renames the draft', sales_, 'sales',
      format($q$UPDATE public.catering_set_menus SET name = 'x' WHERE id = %L$q$, v_draft), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('C10 sales puts the draft on a booking by a direct INSERT', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order) VALUES (%L, %L, NULL, 1, 999)$q$, v_bk2, v_draft),
      ARRAY['refused']);
    PERFORM pg_temp.note('        (C10 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('C11 owner puts the draft on a booking by a direct INSERT', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order) VALUES (%L, %L, NULL, 1, 999)$q$, v_bk2, v_draft),
      ARRAY['refused']);
    PERFORM pg_temp.t('C12 sales puts the draft on a booking through the price box', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_draft, 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.t('C13 owner puts the draft on a booking through the price box', owner_, 'owner',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_draft, 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.note('        (C13 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('C14 owner copies the draft''s dishes into a booking''s set', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, quantity, section, sort_order, source_set_menu_id) VALUES (%L, %L, %L, 1, 'dish', 999, %L)$q$,
        v_open, v_line, v_dish, v_draft),
      ARRAY['refused']);
    PERFORM pg_temp.t('C15 owner points a booking''s line at the draft', owner_, 'owner',
      format($q$UPDATE public.catering_event_menus SET set_menu_id = %L WHERE id = %L$q$, v_draft, v_line), ARRAY['refused']);
    PERFORM pg_temp.t('C16 owner turns the real set (on a booking) into a draft', owner_, 'owner',
      format($q$UPDATE public.catering_set_menus SET is_draft = true WHERE id = %L$q$, v_real), ARRAY['refused']);
    PERFORM pg_temp.t('C17 admin makes the draft real (kept)', admin_, 'admin',
      format($q$UPDATE public.catering_set_menus SET is_draft = false WHERE id = %L$q$, v_draft), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('C18 sales reads it once it is real', sales_, 'sales',
      format($q$SELECT id FROM public.catering_set_menu_items WHERE set_menu_id = %L$q$, v_draft), ARRAY['rows=1']);

    -- ── D. A draft's save and its making real: each ONE transaction ──
    PERFORM pg_temp.t('D1 admin saves a draft: name, price and dishes at once (kept)', admin_, 'admin',
      format($q$SELECT public.catering_save_set_draft(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), 'probe-draft-d2', 2500, %L::jsonb)$q$,
        v_draft3, v_draft3, jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'quantity', 2, 'section', 'dessert', 'note', NULL))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_set_menus s JOIN public.catering_set_menu_items i ON i.set_menu_id = s.id WHERE s.id = %L AND s.name = 'probe-draft-d2' AND s.price_per_set = 2500 AND i.quantity = 2 AND i.section = 'dessert'$q$, v_draft3),
      true);
    PERFORM pg_temp.t('D2 sales saves a draft through it', sales_, 'sales',
      format($q$SELECT public.catering_save_set_draft(%L, now(), 'x', 1, '[]'::jsonb)$q$, v_draft3), ARRAY['refused']);
    PERFORM pg_temp.said('D2', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('D3 owner saves over a newer version (a stale screen)', owner_, 'owner',
      format($q$SELECT public.catering_save_set_draft(%L, TIMESTAMPTZ '2000-01-01 00:00:00+00', 'x', 1, '[]'::jsonb)$q$, v_draft3), ARRAY['refused']);
    PERFORM pg_temp.said('D3', 'ถูกแก้จากที่อื่น');
    PERFORM pg_temp.t('D4 owner saves the REAL set through it', owner_, 'owner',
      format($q$SELECT public.catering_save_set_draft(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), 'x', 1, '[]'::jsonb)$q$, v_real, v_real),
      ARRAY['refused']);
    PERFORM pg_temp.said('D4', 'ไม่พบชุดเมนูฉบับร่าง');
    PERFORM pg_temp.t('D5 owner saves a dish of quantity 0: refused whole', owner_, 'owner',
      format($q$SELECT public.catering_save_set_draft(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), 'probe-draft-d3', 2500, %L::jsonb)$q$,
        v_draft3, v_draft3, jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'quantity', 0, 'section', 'dish'))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D5', 'จำนวนต่อชุด');
    PERFORM pg_temp.t('D6 the refused save changed nothing: D1''s name and dish stand', owner_, 'owner',
      format($q$SELECT 1 FROM public.catering_set_menus s JOIN public.catering_set_menu_items i ON i.set_menu_id = s.id WHERE s.id = %L AND s.name = 'probe-draft-d2' AND i.quantity = 2$q$, v_draft3),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('D7 owner makes the draft real under a real set''s name', owner_, 'owner',
      format($q$SELECT public.catering_make_set_real(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), ' PROBE-real-set ', 3000)$q$, v_draft3, v_draft3),
      ARRAY['refused']);
    PERFORM pg_temp.said('D7', 'มีชุดเมนูจริงชื่อ');
    PERFORM pg_temp.t('D8 owner makes a draft with no dishes real', owner_, 'owner',
      format($q$SELECT public.catering_make_set_real(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), 'probe-empty', 3000)$q$, v_draft4, v_draft4),
      ARRAY['refused']);
    PERFORM pg_temp.said('D8', 'ยังไม่มีรายการอาหาร');
    PERFORM pg_temp.t('D9 admin makes the draft real, with its name and price', admin_, 'admin',
      format($q$SELECT public.catering_make_set_real(%L, (SELECT updated_at FROM public.catering_set_menus WHERE id = %L), 'probe-made-real', 3000)$q$, v_draft3, v_draft3),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_set_menus WHERE id = %L AND NOT is_draft AND name = 'probe-made-real' AND price_per_set = 3000$q$, v_draft3));

    -- ── B. The free mark ──
    PERFORM pg_temp.t('B1 owner writes a free line of ฿100 directly', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, is_free) VALUES (%L, 'probe', 'drink', 100, 1, 100, true)$q$, v_bk2),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('B2 owner writes a free discount of ฿0 directly', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, is_free) VALUES (%L, 'probe', 'discount', 0, 1, 0, true)$q$, v_bk2),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('B3 sales saves a ฿0 drinks line marked แถมฟรี', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe-free', 'charge_type', 'drink', 'unit_price', 0,
          'quantity', 1, 'amount', 0, 'rate_id', NULL, 'note', NULL, 'is_free', true))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges WHERE event_id = %L AND label = 'probe-free' AND is_free$q$, v_bk2));
    PERFORM pg_temp.t('B4 sales saves a ฿0 line WITHOUT the mark (an older screen): stored as not free', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe-zero', 'charge_type', 'drink', 'unit_price', 0,
          'quantity', 1, 'amount', 0, 'rate_id', NULL, 'note', NULL))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges WHERE event_id = %L AND label = 'probe-zero' AND NOT is_free$q$, v_bk2));
    PERFORM pg_temp.t('B5 sales saves a ฿50 line marked แถมฟรี', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe', 'charge_type', 'drink', 'unit_price', 50,
          'quantity', 1, 'amount', 50, 'rate_id', NULL, 'note', NULL, 'is_free', true))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('B5', 'รายการแถมฟรีต้องเป็น 0 บาท');
    PERFORM pg_temp.t('B6 sales saves the mark as text ("yes")', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe', 'charge_type', 'drink', 'unit_price', 0,
          'quantity', 1, 'amount', 0, 'rate_id', NULL, 'note', NULL, 'is_free', 'yes'))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('B6', 'แถมฟรี');
    PERFORM pg_temp.t('B7 sales marks a SET line แถมฟรี', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_real, 'quantity', 1, 'is_free', true))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('B7', 'ชุดเมนูทำเครื่องหมายแถมฟรีไม่ได้');
    PERFORM pg_temp.t('B8 sales marks a priced dish แถมฟรี: charged ฿0 (kept)', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'dish', 'refId', v_dish, 'quantity', 1, 'is_free', true))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges c JOIN public.catering_event_menus m ON m.id = c.event_menu_id WHERE m.event_id = %L AND m.menu_id = %L AND c.is_free AND c.unit_price = 0 AND c.amount = 0$q$, v_bk2, v_dish),
      true);
    SELECT id INTO v_emid FROM public.catering_event_menus WHERE event_id = v_bk2 AND menu_id = v_dish;
    PERFORM pg_temp.t('B9 sales marks a ฿0 discount แถมฟรี', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe', 'charge_type', 'discount', 'unit_price', 0,
          'quantity', 1, 'amount', 0, 'rate_id', NULL, 'note', NULL, 'is_free', true))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('B9', 'ไม่ใช่ส่วนลด');
    PERFORM pg_temp.t('B10 sales marks a ฿5,000 × 0 line แถมฟรี', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'charge', 'label', 'probe', 'charge_type', 'venue', 'unit_price', 5000,
          'quantity', 0, 'amount', 0, 'rate_id', NULL, 'note', NULL, 'is_free', true))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('B10', 'ราคาต่อหน่วย 0');
    PERFORM pg_temp.t('B11 sales takes the mark off B8''s dish: the dish''s own price again', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, NULL, false)$q$, v_bk2,
        jsonb_build_array(jsonb_build_object('kind', 'dish', 'refId', v_dish, 'eventMenuId', v_emid, 'quantity', 1, 'is_free', false))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges c JOIN public.menus d ON d.id = %L WHERE c.event_menu_id = %L AND NOT c.is_free AND c.unit_price = d.selling_price AND c.amount = d.selling_price$q$, v_dish, v_emid));
    PERFORM pg_temp.t('B12 owner writes a free line of ฿100 × 0 directly', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, is_free) VALUES (%L, 'probe', 'drink', 100, 0, 0, true)$q$, v_bk2),
      ARRAY['check-refused']);

    -- ── A. The library ──
    PERFORM pg_temp.t('A1 owner adds a terms block', owner_, 'owner',
      $q$INSERT INTO public.catering_detail_blocks (kind, title, body, venue_tags) VALUES ('terms', 'probe', 'probe', ARRAY['นอกสถานที่'])$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('A2 admin adds a photo block with a library image', admin_, 'admin',
      $q$INSERT INTO public.catering_detail_blocks (kind, title, image_path) VALUES ('photo', 'probe', 'lib/1700000000000-probe.jpg')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('A3 sales adds a library block', sales_, 'sales',
      $q$INSERT INTO public.catering_detail_blocks (kind, title, body) VALUES ('terms', 'probe', 'probe')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('A4 sales changes a library block', sales_, 'sales',
      format($q$UPDATE public.catering_detail_blocks SET body = 'x' WHERE id = %L$q$, v_block), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('A5 sales reads the library', sales_, 'sales',
      format($q$SELECT id FROM public.catering_detail_blocks WHERE id = %L$q$, v_block), ARRAY['rows=1']);
    PERFORM pg_temp.t('A6 editor reads the library', editor_, 'editor',
      format($q$SELECT id FROM public.catering_detail_blocks WHERE id = %L$q$, v_block), ARRAY['rows=0']);
    PERFORM pg_temp.t('A7 an anonymous visitor reads the library', NULL, 'anon',
      format($q$SELECT id FROM public.catering_detail_blocks WHERE id = %L$q$, v_block), ARRAY['denied', 'rows=0']);
    PERFORM pg_temp.t('A8 admin gives a library block a booking''s image', admin_, 'admin',
      format($q$INSERT INTO public.catering_detail_blocks (kind, title, image_path) VALUES ('photo', 'probe', 'evt/%s/1700000000000-probe.jpg')$q$, v_open),
      ARRAY['check-refused']);

    -- ── A. A booking's sheet ──
    PERFORM pg_temp.t('A9 sales picks the library block onto a booking (a copy) (kept)', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_detail_blocks (event_id, block_id, kind, title, body) VALUES (%L, %L, 'terms', 'probe-terms', %L)$q$, v_open, v_block, v_body),
      ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('A10 sales edits the booking''s copy: the library copy does not change', sales_, 'sales',
      format($q$UPDATE public.catering_event_detail_blocks SET body = 'แก้สำหรับงานนี้' WHERE event_id = %L AND block_id = %L$q$, v_open, v_block),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_detail_blocks WHERE id = %L AND body = %L$q$, v_block, v_body));
    PERFORM pg_temp.t('A11 owner removes the library block a booking uses', owner_, 'owner',
      format($q$DELETE FROM public.catering_detail_blocks WHERE id = %L$q$, v_block), ARRAY['fk-refused']);
    PERFORM pg_temp.t('A12 sales picks a block onto the cost-locked booking', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_detail_blocks (event_id, block_id, kind, title, body) VALUES (%L, %L, 'terms', 'probe', 'probe')$q$, v_locked, v_block),
      ARRAY['denied']);
    PERFORM pg_temp.t('A13 editor picks a block onto a booking', editor_, 'editor',
      format($q$INSERT INTO public.catering_event_detail_blocks (event_id, block_id, kind, title, body) VALUES (%L, %L, 'terms', 'probe', 'probe')$q$, v_open, v_block),
      ARRAY['denied']);
    PERFORM pg_temp.t('A14 staff reads a booking''s sheet', staff_, 'staff',
      format($q$SELECT id FROM public.catering_event_detail_blocks WHERE event_id = %L$q$, v_open), ARRAY['rows=0']);
    PERFORM pg_temp.t('A15 sales puts ANOTHER booking''s image on this sheet', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_detail_blocks (event_id, kind, title, image_path) VALUES (%L, 'photo', 'probe', 'evt/%s/1700000000000-probe.jpg')$q$, v_open, v_bk2),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('A16 sales adds a 7th image to a booking that has 6', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_detail_blocks (event_id, kind, title, image_path) VALUES (%L, 'photo', 'probe', 'evt/%s/1700000000077-probe.jpg')$q$, v_bk2, v_bk2),
      ARRAY['refused']);
    PERFORM pg_temp.t('A17 sales writes the job notes of an open booking', sales_, 'sales',
      format($q$UPDATE public.catering_events SET sheet_notes = 'จัดโต๊ะก่อน 2 ชั่วโมง' WHERE id = %L$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('A18 sales writes the job notes of the cost-locked booking', sales_, 'sales',
      format($q$UPDATE public.catering_events SET sheet_notes = 'x' WHERE id = %L$q$, v_locked), ARRAY['rows=0', 'denied']);

    -- ── E. A booking's sheet, saved whole: ONE transaction, under a version check ──
    SELECT jsonb_build_object('notes', e.sheet_notes, 'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'updated_at', b.updated_at))
             FROM public.catering_event_detail_blocks b WHERE b.event_id = e.id), '[]'::jsonb))
      INTO v_seen FROM public.catering_events e WHERE e.id = v_open;
    PERFORM pg_temp.t('E1 sales saves the sheet: notes, a new block, the old one dropped (kept)', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, %L::jsonb, 'เข้าจัดสถานที่ 15.30 น.', %L::jsonb)$q$, v_open, v_seen::text,
        jsonb_build_array(jsonb_build_object('id', v_newpick, 'block_id', v_block, 'kind', 'terms', 'title', 'probe-e1',
          'body', 'แก้สำหรับงานนี้', 'image_path', NULL, 'caption', NULL))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_events e WHERE e.id = %L AND e.sheet_notes = 'เข้าจัดสถานที่ 15.30 น.' AND (SELECT count(*) FROM public.catering_event_detail_blocks b WHERE b.event_id = e.id) = 1 AND EXISTS (SELECT 1 FROM public.catering_event_detail_blocks b WHERE b.id = %L AND b.title = 'probe-e1')$q$, v_open, v_newpick),
      true);
    PERFORM pg_temp.t('E2 sales saves over a newer version (a stale screen)', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, %L::jsonb, 'x', '[]'::jsonb)$q$, v_open, v_seen::text), ARRAY['refused']);
    PERFORM pg_temp.said('E2', 'ถูกแก้จากที่อื่น');
    PERFORM pg_temp.t('E3 sales saves a cancelled booking''s sheet', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, '{"notes": null, "blocks": []}'::jsonb, 'x', '[]'::jsonb)$q$, v_cancel), ARRAY['refused']);
    PERFORM pg_temp.said('E3', 'ยกเลิก');
    PERFORM pg_temp.t('E4 owner saves the cost-locked booking''s sheet', owner_, 'owner',
      format($q$SELECT public.catering_save_event_sheet(%L, '{"notes": null, "blocks": []}'::jsonb, 'x', '[]'::jsonb)$q$, v_locked), ARRAY['refused']);
    PERFORM pg_temp.said('E4', 'ล็อก');
    SELECT jsonb_build_object('notes', e.sheet_notes, 'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'updated_at', b.updated_at))
             FROM public.catering_event_detail_blocks b WHERE b.event_id = e.id), '[]'::jsonb))
      INTO v_seen FROM public.catering_events e WHERE e.id = v_open;
    PERFORM pg_temp.t('E5 sales shows a library image no library block holds', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, %L::jsonb, 'x', %L::jsonb)$q$, v_open, v_seen::text,
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'block_id', NULL, 'kind', 'photo', 'title', 'probe',
          'body', NULL, 'image_path', 'lib/1700000000999-nope.jpg', 'caption', NULL))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('E5', 'ไม่พบรูปนี้ในคลัง');
    PERFORM pg_temp.t('E6 sales saves ANOTHER booking''s block into this sheet', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, %L::jsonb, 'x', %L::jsonb)$q$, v_open, v_seen::text,
        jsonb_build_array(jsonb_build_object('id', v_other, 'block_id', NULL, 'kind', 'terms', 'title', 'probe',
          'body', 'x', 'image_path', NULL, 'caption', NULL))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('E6', 'เป็นของงานอื่น');
    PERFORM pg_temp.t('E7 sales saves seven images on one sheet', sales_, 'sales',
      format($q$SELECT public.catering_save_event_sheet(%L, %L::jsonb, 'x', %L::jsonb)$q$, v_open, v_seen::text,
        (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'block_id', NULL, 'kind', 'photo', 'title', 'probe-' || g,
           'body', NULL, 'image_path', format('evt/%s/1700000001%s00-eeee.jpg', v_open, g), 'caption', NULL))
           FROM generate_series(1, 7) g)::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('E7', '6 รูป');

    -- ── A. The image bucket ──
    PERFORM pg_temp.t('S1 sales uploads into an open booking''s folder', sales_, 'sales',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000001-abcd.jpg')$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('S2 sales uploads a library image', sales_, 'sales',
      $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'lib/1700000000002-abcd.jpg')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('S3 admin uploads a library image (PNG)', admin_, 'admin',
      $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'lib/1700000000003-abcd.png')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('S4 sales uploads into a cancelled booking''s folder', sales_, 'sales',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000004-abcd.jpg')$q$, v_cancel), ARRAY['denied']);
    PERFORM pg_temp.t('S5 owner uploads into the cost-locked booking''s folder', owner_, 'owner',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000005-abcd.jpg')$q$, v_locked), ARRAY['denied']);
    PERFORM pg_temp.t('S6 owner uploads a GIF', owner_, 'owner',
      $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'lib/1700000000006-abcd.gif')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('S7 sales uploads a forged path (../lib)', sales_, 'sales',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/../lib/1700000000007-abcd.jpg')$q$, v_open), ARRAY['denied']);
    PERFORM pg_temp.t('S8 editor uploads into an open booking''s folder', editor_, 'editor',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000008-abcd.jpg')$q$, v_open), ARRAY['denied']);
    PERFORM pg_temp.t('S9 an anonymous visitor uploads', NULL, 'anon',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000009-abcd.jpg')$q$, v_open), ARRAY['denied']);
    PERFORM pg_temp.t('S10 sales reads a library image', sales_, 'sales',
      $q$SELECT id FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('S11 staff reads it', staff_, 'staff',
      $q$SELECT id FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    PERFORM pg_temp.t('S12 an anonymous visitor reads it', NULL, 'anon',
      $q$SELECT id FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('S13 admin overwrites it', admin_, 'admin',
      $q$UPDATE storage.objects SET name = name WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    -- Newer storage versions refuse ANY direct delete unless this is set, so
    -- the policy is what the test reads, not that guard.
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    PERFORM pg_temp.t('S14 owner deletes it', owner_, 'owner',
      $q$DELETE FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    PERFORM set_config('storage.allow_delete_query', '', true);
    PERFORM pg_temp.t('S15 sales uploads into a booking folder that already holds 30 files', sales_, 'sales',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'evt/%s/1700000000999-abcd.jpg')$q$, v_bk2), ARRAY['denied']);

    -- ── S. The caps hold beside an OPEN policy (made here, rolled back) ──
    -- Without it, S11, S13 and S14 would pass with or without the caps: no
    -- permissive policy admits those reads and writes to begin with.
    INSERT INTO storage.buckets (id, name, public) VALUES ('probe-other', 'probe-other', false);
    INSERT INTO storage.objects (bucket_id, name) VALUES ('probe-other', 'probe.jpg');
    CREATE POLICY "probe open" ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
    PERFORM pg_temp.t('S16 staff reads a catering-details file beside an open policy', staff_, 'staff',
      $q$SELECT id FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    PERFORM pg_temp.t('S17 staff reads another bucket''s file beside it (the control: the open policy works)', staff_, 'staff',
      $q$SELECT id FROM storage.objects WHERE bucket_id = 'probe-other' AND name = 'probe.jpg'$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('S18 admin renames a catering-details file beside it', admin_, 'admin',
      $q$UPDATE storage.objects SET name = 'lib/1700000000888-abcd.jpg' WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    PERFORM pg_temp.t('S19 owner deletes a catering-details file beside it', owner_, 'owner',
      $q$DELETE FROM storage.objects WHERE bucket_id = 'catering-details' AND name = 'lib/1700000000000-probe.jpg'$q$, ARRAY['rows=0']);
    PERFORM set_config('storage.allow_delete_query', '', true);
    PERFORM pg_temp.t('S20 sales uploads a name the app never makes, beside it', sales_, 'sales',
      $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'anything.jpg')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('S21 admin upserts over a library file (the API''s upsert), beside it', admin_, 'admin',
      $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('catering-details', 'lib/1700000000000-probe.jpg') ON CONFLICT (bucket_id, name) DO UPDATE SET owner = NULL$q$,
      ARRAY['denied']);

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the bookings, the sets, the lines and copies, the charges, the library, the picks, the files)');
  END;
END
$do$;

-- ── Step 5: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows bigint;
  v_bucket record;
  v_missing text[];
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 97;
BEGIN
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('sheet.n_events')
     OR (SELECT count(*) FROM public.catering_set_menus)::text <> current_setting('sheet.n_sets')
     OR (SELECT count(*) FROM public.catering_set_menu_items)::text <> current_setting('sheet.n_setitems')
     OR (SELECT count(*) FROM public.catering_event_menus)::text <> current_setting('sheet.n_lines')
     OR (SELECT count(*) FROM public.catering_event_menu_items)::text <> current_setting('sheet.n_copies')
     OR (SELECT count(*) FROM public.catering_event_charges)::text <> current_setting('sheet.n_charges')
     OR (SELECT count(*) FROM public.catering_event_activity_log)::text <> current_setting('sheet.n_log')
     OR (SELECT count(*) FROM storage.objects WHERE bucket_id = 'catering-details')::text <> current_setting('sheet.n_objects')
     OR (SELECT count(*) FROM public.catering_detail_blocks)::text <> current_setting('sheet.n_blocks')
     OR (SELECT count(*) FROM public.catering_event_detail_blocks)::text <> current_setting('sheet.n_picks')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
           FROM public.catering_events) <> current_setting('sheet.fp_events')
     OR (SELECT md5(COALESCE(string_agg(id::text || label || unit_price::text || quantity::text || amount::text, ',' ORDER BY id), ''))
           FROM public.catering_event_charges) <> current_setting('sheet.fp_charges') THEN
    RAISE EXCEPTION 'FAIL    a count or a fingerprint changed: a test write survived. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_menus m JOIN public.catering_set_menus s ON s.id = m.set_menu_id WHERE s.is_draft) THEN
    RAISE EXCEPTION 'FAIL    a draft set is on a booking. Nothing applied.';
  END IF;

  SELECT public, file_size_limit, allowed_mime_types INTO v_bucket FROM storage.buckets WHERE id = 'catering-details';
  IF v_bucket IS NULL OR v_bucket.public IS DISTINCT FROM false OR v_bucket.file_size_limit IS DISTINCT FROM 2097152
     OR v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png'] THEN
    RAISE EXCEPTION 'FAIL    the bucket catering-details is not private, 2 MB, JPEG and PNG. Nothing applied.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.catering_detail_blocks'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.catering_event_detail_blocks'::regclass)
     OR has_table_privilege('anon', 'public.catering_detail_blocks', 'SELECT')
     OR has_table_privilege('anon', 'public.catering_event_detail_blocks', 'SELECT')
     OR has_function_privilege('anon', 'public.catering_detail_upload_allowed(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.catering_detail_upload_allowed(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catering_make_set_real(uuid, timestamptz, text, numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catering_save_event_sheet(uuid, jsonb, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catering_detail_folder_has_room(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL    row security or a privilege on the new tables or the upload rule is not as written. Nothing applied.';
  END IF;
  SELECT array_agg(p) INTO v_missing FROM unnest(ARRAY[
    'catering_set_menus_drafts_hidden', 'catering_set_menu_items_drafts_hidden',
    'catering_detail_blocks_read', 'catering_detail_blocks_write',
    'catering_event_detail_blocks_rw', 'catering_event_detail_blocks_lock_insert',
    'catering_event_detail_blocks_lock_update', 'catering_event_detail_blocks_lock_delete',
    'catering details read', 'catering details upload', 'catering details read cap',
    'catering details upload cap', 'catering details no overwrite', 'catering details no delete']) AS p
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = p);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    policies missing: %. Nothing applied.', v_missing;
  END IF;
  SELECT array_agg(g) INTO v_missing FROM unnest(ARRAY[
    'trg_catering_set_menus_draft_guard', 'trg_catering_event_menus_no_draft', 'trg_catering_event_menu_items_no_draft',
    'trg_catering_event_detail_blocks_image_cap']) AS g
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = g AND NOT tgisinternal);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    triggers missing: %. Nothing applied.', v_missing;
  END IF;
  PERFORM pg_temp.note(format('ok      counts and fingerprints as before (bookings %s, sets %s, lines %s, charges %s, history %s, files %s); no draft on a booking; the bucket private, 2 MB, JPEG and PNG; row security on, anon shut out; 14 policies and 4 guard triggers in place',
    current_setting('sheet.n_events'), current_setting('sheet.n_sets'), current_setting('sheet.n_lines'),
    current_setting('sheet.n_charges'), current_setting('sheet.n_log'), current_setting('sheet.n_objects')));

  v_rows := pg_temp.logged();
  IF v_rows <> c_expected THEN
    RAISE EXCEPTION
      'FAIL    the result table holds % rows, expected % — a block ran and reported nothing, or was skipped. Nothing applied.',
      v_rows, c_expected;
  END IF;
  PERFORM pg_temp.note(format('ok      row count verified: %s evidence rows emitted, as expected (this line makes %s)',
    v_rows, v_rows + 1));
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

DROP FUNCTION IF EXISTS
  pg_temp.t(text, uuid, text, text, text[], text, boolean),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text, text, boolean),
  pg_temp.logged(),
  pg_temp.said(text, text),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs ════════════════════════════════════════════════════════
--
-- Nothing changes on screen until the code that uses it is pushed (it waits
-- for this file). Then, in the app: the set-menu design workspace (owner,
-- admin), the free mark in the price box, the library and a booking's
-- event-details sheet, printed after the quotation. One upload through the
-- app checks what SQL cannot: the size and type limits and a signed URL.
