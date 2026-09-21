-- ============================================================================
-- ปูม้าใหญ่ผัดผงกะหรี่ to the kilo rule: recipe ×10, price ×10, POS divisor ÷10
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction. It judges the three rows TOGETHER: all three untouched → it
-- converts them; all three already converted → a re-run, it changes nothing
-- and says "already"; anything else (someone changed one of them since) →
-- FAIL, naming each value, and nothing is applied.
--
-- WHY (Nik, 2026-09-21). Every dish sold by weight counts ONE APP UNIT AS
-- ONE KILO: the recipe per kilo, the price per kilo, and a POS divisor that
-- turns the POS count into kilos (supabase/README.md, "Dishes sold by
-- weight"). River prawn is the one exception. This dish was still set per
-- ขีด: a recipe of 1 ขีด of crab, ฿120, and no divisor, so a POS sale of
-- 5 ขีด would have counted as 5 units.
--
-- THE THREE ROWS IT CHANGES — every one, before → after:
--   1. menus  cdaf6295-4a67-4a79-8cd8-c27e113775b1  ปูม้าใหญ่ผัดผงกะหรี่
--        selling_price     120.00  →  1200.00
--   2. menu_recipe_items  245624d1-6e31-4f23-a1dd-77f24f3f88d5
--        ปูม้าเป็น (f0fe4b77-4eb3-4f89-a17d-0bfa0c949b58), the recipe's ONLY line
--        quantity          1 ขีด  →  10 ขีด
--   3. pos_sales_aliases  NEW ROW
--        pos_product_name 'ปูม้าใหญ่ผัดผงกะหรี่' → menu cdaf6295-…, divisor 10
-- Nothing else is written. As with any save from the app, the
-- recipe_item_history trigger logs row 2 (1 → 10, changed_by NULL) — the
-- exact ×10 pattern the 2026-09-21 quantity-box audit flags, so record the
-- run in the README — and touch_updated_at stamps rows 1 and 2.
--
-- ON A FIRST RUN IT REFUSES (read 2026-09-21 13:38 Bangkok: none of these
-- held) when: the recipe has more lines than ปูม้าเป็น; the crab is not
-- counted in ขีด; the dish is on any catering set, booking course or booking
-- dish line (its quantities would mean ten times as much crab); a recipe
-- edit or a copy of the dish awaits approval (approving it afterwards would
-- write the old per-ขีด recipe back); or any POS divisor already names the
-- dish.
-- It prints the sold count: a count imported before this file was taken per
-- ขีด, so import POS sales again after it.
--
-- The POS text: the name matches the POS export of 01 Jan 2568 – 26 Jul 2569
-- exactly (LINE MAN code LV04); the dish has not sold since, and is not in
-- the August file. With the catering print change (D) applied, the ÷10 also
-- makes this dish print in kilos on the kitchen and service sheets.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: UPDATE ×2, one row each;
-- INSERT ×1; and one DROP FUNCTION IF EXISTS of the file's three temporary
-- pg_temp helpers. Anything else is unexpected. It creates no table and
-- deletes no row.
--
-- Checks built in (AGENTS.md): nothing is named before it exists (check C);
-- no regex with a backslash (check D); the reads made AS REAL ACCOUNTS roll
-- back inside pg_temp.read_as and carry their answer out in a variable,
-- never in the result log (check E); the file counts its own result rows
-- before COMMIT (check F).
-- ============================================================================

BEGIN;

-- A result log left over in this session — from a run that committed but
-- never reached its final SELECT — would be counted as this run's: start
-- empty.
SELECT set_config('crab_per_kilo.log', '', false);

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('crab_per_kilo.log',
    COALESCE(current_setting('crab_per_kilo.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('crab_per_kilo.log', true), '');
BEGIN
  PERFORM set_config('crab_per_kilo.log', '', false);
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
    FROM regexp_split_to_table(COALESCE(current_setting('crab_per_kilo.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one SELECT AS ONE REAL ACCOUNT and ALWAYS rolls the impersonation back
-- (a private SQLSTATE, caught). The answer leaves in a variable, which is not
-- transactional; nothing is written to the result log inside the block, so
-- the rollback cannot take a result line with it (check E). The identity it
-- ran as comes first, and reads "not-authenticated" unless the switch to the
-- authenticated role really took, so a failed impersonation — which would
-- read as postgres with RLS bypassed — cannot pass as an answer. STRICT: no
-- row, or more than one, is an answer of its own, never a silent first row.
CREATE OR REPLACE FUNCTION pg_temp.read_as(p_who uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_out text;
  v_who text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
    PERFORM set_config('role', 'authenticated', true);
    v_who := CASE WHEN current_user::text = 'authenticated'
                  THEN COALESCE(public.current_role(), '(no role)')
                  ELSE 'not-authenticated' END;
    EXECUTE p_sql INTO STRICT v_out;
    v_out := v_who || ' sees ' || COALESCE(v_out, 'NULL');
    RAISE EXCEPTION USING ERRCODE = 'P0C01';
  EXCEPTION
    WHEN SQLSTATE 'P0C01' THEN
      NULL;
    WHEN no_data_found THEN
      v_out := COALESCE(v_who, '?') || ' sees NO ROW';
    WHEN too_many_rows THEN
      v_out := COALESCE(v_who, '?') || ' sees MORE THAN ONE ROW';
  END;
  RETURN v_out;
END
$fn$;

DO $do$
DECLARE
  c_menu     constant uuid   := 'cdaf6295-4a67-4a79-8cd8-c27e113775b1';
  c_line     constant uuid   := '245624d1-6e31-4f23-a1dd-77f24f3f88d5';
  c_crab     constant uuid   := 'f0fe4b77-4eb3-4f89-a17d-0bfa0c949b58';
  c_name     constant text   := 'ปูม้าใหญ่ผัดผงกะหรี่';
  c_expected constant bigint := 14;
  c_read     constant text :=
    'SELECT m.selling_price::text || '' | '' || i.quantity::text || '' | '' || a.divisor::text'
    || ' FROM public.menus m'
    || ' JOIN public.menu_recipe_items i ON i.menu_id = m.id AND i.id = ''245624d1-6e31-4f23-a1dd-77f24f3f88d5'''
    || ' JOIN public.pos_sales_aliases a ON a.menu_id = m.id AND a.pos_product_name = ''ปูม้าใหญ่ผัดผงกะหรี่'''
    || ' WHERE m.id = ''cdaf6295-4a67-4a79-8cd8-c27e113775b1''';
  v_name     text;
  v_price    numeric;
  v_sold     numeric;
  v_qty      numeric;
  v_line_menu uuid;
  v_line_ing uuid;
  v_line_unit text;
  v_usage    text;
  v_lines    bigint;
  v_divs     bigint;
  v_divs_text text;
  v_exact_menu uuid;
  v_exact_div numeric;
  v_sets     bigint;
  v_courses  bigint;
  v_dishes   bigint;
  v_pending  bigint;
  v_pos_seen text;
  v_state    text;
  v_menus_n  bigint;
  v_items_n  bigint;
  v_alias_n  bigint;
  v_menus_md5 text;
  v_items_md5 text;
  v_alias_md5 text;
  v_added    int := 0;
  v_owner    uuid;
  v_admin    uuid;
  v_seen     text;
  v_rows     bigint;
BEGIN
  -- ── Step 0: read everything, change nothing ─────────────────────────────
  SELECT name, selling_price, last_period_qty_sold INTO v_name, v_price, v_sold
    FROM public.menus WHERE id = c_menu FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL    menu % does not exist. Nothing applied.', c_menu;
  END IF;
  IF btrim(v_name) <> c_name THEN
    RAISE EXCEPTION 'FAIL    menu % is named "%", not "%". Nothing applied.', c_menu, v_name, c_name;
  END IF;

  SELECT i.quantity, i.menu_id, i.ingredient_id, i.unit, g.usage_unit
    INTO v_qty, v_line_menu, v_line_ing, v_line_unit, v_usage
    FROM public.menu_recipe_items i
    JOIN public.ingredients g ON g.id = i.ingredient_id
   WHERE i.id = c_line
     FOR UPDATE OF i
     FOR SHARE OF g;
  IF NOT FOUND OR v_line_menu IS DISTINCT FROM c_menu OR v_line_ing IS DISTINCT FROM c_crab THEN
    RAISE EXCEPTION 'FAIL    recipe line % is missing, or no longer ปูม้าเป็น on this menu. Nothing applied.', c_line;
  END IF;
  SELECT count(*) INTO v_lines FROM public.menu_recipe_items WHERE menu_id = c_menu;

  -- Every divisor that points at this dish OR whose POS name contains it:
  -- a ÷1 "…1 กก." button, a stray spelling, one saved with a trailing space.
  SELECT count(*),
         COALESCE(string_agg(format('"%s" → %s ÷%s', pos_product_name,
                    CASE WHEN menu_id = c_menu THEN 'this dish' ELSE menu_id::text END, divisor),
                  '; ' ORDER BY pos_product_name), 'none')
    INTO v_divs, v_divs_text
    FROM public.pos_sales_aliases
   WHERE menu_id = c_menu OR position(c_name IN pos_product_name) > 0;
  SELECT menu_id, divisor INTO v_exact_menu, v_exact_div
    FROM public.pos_sales_aliases WHERE pos_product_name = c_name;

  SELECT count(*) INTO v_sets FROM public.catering_set_menu_items WHERE menu_id = c_menu;
  SELECT count(*) INTO v_courses FROM public.catering_event_menu_items WHERE menu_id = c_menu;
  SELECT count(*) INTO v_dishes FROM public.catering_event_menus WHERE menu_id = c_menu;

  -- A pending recipe edit or copy of the dish carries its recipe as it was
  -- when the request was made; approving it after this file would write
  -- 1 ขีด back. Only those two: an SOP edit or a deletion also names the
  -- menu in target_id, and neither touches the recipe.
  SELECT count(*) INTO v_pending
    FROM public.pending_changes
   WHERE status = 'pending'
     AND change_type IN ('recipe_edit', 'menu_create')
     AND (target_id = c_menu::text
          OR payload->>'parentId' = c_menu::text
          OR payload->>'duplicatedFrom' = c_menu::text);

  IF to_regclass('public.pos_item_categories') IS NULL THEN
    v_pos_seen := 'table absent';
  ELSE
    EXECUTE 'SELECT CASE WHEN EXISTS (SELECT 1 FROM public.pos_item_categories WHERE pos_product_name = $1) THEN ''yes'' ELSE ''no (not classified: not sold since the categories were set up, or not classified yet)'' END'
      INTO v_pos_seen USING c_name;
  END IF;

  -- ── Step 1: the three rows, judged TOGETHER ──────────────────────────────
  IF v_price = 120 AND v_qty = 1 AND v_divs = 0 THEN
    v_state := 'before';
  ELSIF v_price = 1200 AND v_qty = 10 AND v_divs = 1
        AND v_exact_menu IS NOT DISTINCT FROM c_menu AND v_exact_div = 10 THEN
    v_state := 'after';
  ELSE
    RAISE EXCEPTION 'FAIL    neither untouched nor converted: price %, ปูม้าเป็น % ขีด, divisors: %. Someone changed the dish after 2026-09-21: check it by hand. Nothing applied.',
      v_price, v_qty, v_divs_text;
  END IF;

  -- These refuse a CONVERSION. On a re-run they are information only: a
  -- line or a catering use added after the conversion is already in kilos.
  IF v_state = 'before' THEN
    IF v_lines <> 1 THEN
      RAISE EXCEPTION 'FAIL    the recipe has % lines; this file converts exactly one (ปูม้าเป็น). Every line must go ×10, so it must be rewritten for the lines the recipe has now. Nothing applied.', v_lines;
    END IF;
    IF v_usage IS DISTINCT FROM 'ขีด' OR (v_line_unit IS NOT NULL AND v_line_unit <> 'ขีด') THEN
      RAISE EXCEPTION 'FAIL    the crab is not counted in ขีด (ingredient unit %, line unit %): ×10 would not make a kilo. Nothing applied.', v_usage, v_line_unit;
    END IF;
    IF v_sets + v_courses + v_dishes > 0 THEN
      RAISE EXCEPTION 'FAIL    the dish is on % catering set line(s), % booking course(s) and % booking dish line(s). Converting its unit would make those quantities mean ten times as much crab: change them first. Nothing applied.', v_sets, v_courses, v_dishes;
    END IF;
    IF v_pending > 0 THEN
      RAISE EXCEPTION 'FAIL    % recipe edit(s) or cop(ies) of this dish await approval; approving one after this file would write the per-ขีด recipe back. Approve or reject them first. Nothing applied.', v_pending;
    END IF;
  END IF;

  PERFORM pg_temp.note(format('before  menu %s: selling_price %s; sold in the last POS import %s%s', c_name, v_price, v_sold,
    CASE WHEN v_state = 'before' AND v_sold <> 0 THEN ' — counted per ขีด: import POS sales again after this file' ELSE '' END));
  PERFORM pg_temp.note(format('before  recipe: ปูม้าเป็น %s %s (ingredient unit %s); %s line(s) on the dish',
    v_qty, COALESCE(v_line_unit, '(no line unit)'), COALESCE(v_usage, '(none)'), v_lines));
  PERFORM pg_temp.note('before  POS divisors on this dish or its name: ' || v_divs_text);
  PERFORM pg_temp.note(format('before  catering: in %s set menus, %s booking courses, %s booking dish lines', v_sets, v_courses, v_dishes));
  PERFORM pg_temp.note(format('before  pending recipe edits or copies of this dish awaiting approval: %s', v_pending));
  PERFORM pg_temp.note(format('before  POS name "%s" in pos_item_categories: %s', c_name, v_pos_seen));
  PERFORM pg_temp.note(CASE WHEN v_state = 'before'
    THEN 'state   untouched: converting the three rows'
    ELSE 'state   already converted: a re-run, nothing to change' END);

  -- ── Step 2: fingerprint everything else, BEFORE changing anything ───────
  SELECT count(*) INTO v_menus_n FROM public.menus;
  SELECT md5(COALESCE(string_agg(id::text || ':' || name || ':' || selling_price::text || ':' || last_period_qty_sold::text, ',' ORDER BY id), ''))
    INTO v_menus_md5 FROM public.menus WHERE id <> c_menu;
  SELECT count(*) INTO v_items_n FROM public.menu_recipe_items;
  SELECT md5(COALESCE(string_agg(id::text || ':' || menu_id::text || ':' || ingredient_id::text || ':' || quantity::text, ',' ORDER BY id), ''))
    INTO v_items_md5 FROM public.menu_recipe_items WHERE id <> c_line;
  SELECT count(*) INTO v_alias_n FROM public.pos_sales_aliases;
  SELECT md5(COALESCE(string_agg(id::text || ':' || pos_product_name || ':' || menu_id::text || ':' || divisor::text, ',' ORDER BY id), ''))
    INTO v_alias_md5 FROM public.pos_sales_aliases WHERE pos_product_name <> c_name;

  -- ── Step 3: the three changes, only when all three are untouched ────────
  IF v_state = 'before' THEN
    UPDATE public.menus SET selling_price = 1200 WHERE id = c_menu AND selling_price = 120;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'FAIL    the price update touched % rows, expected 1. Nothing applied.', v_rows;
    END IF;
    UPDATE public.menu_recipe_items SET quantity = 10 WHERE id = c_line AND quantity = 1;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'FAIL    the recipe update touched % rows, expected 1. Nothing applied.', v_rows;
    END IF;
    INSERT INTO public.pos_sales_aliases (pos_product_name, menu_id, divisor) VALUES (c_name, c_menu, 10);
    v_added := 1;
  END IF;
  PERFORM pg_temp.note('change  menu price: ' || CASE WHEN v_state = 'before'
    THEN '120.00 → 1200.00 (changed)' ELSE 'already 1200.00 (unchanged)' END);
  PERFORM pg_temp.note('change  recipe line: ' || CASE WHEN v_state = 'before'
    THEN 'ปูม้าเป็น 1 ขีด → 10 ขีด (changed)' ELSE 'already ปูม้าเป็น 10 ขีด (unchanged)' END);
  PERFORM pg_temp.note('change  POS divisor: ' || CASE WHEN v_state = 'before'
    THEN 'none → ÷10 (added)' ELSE 'already ÷10 (unchanged)' END);

  -- ── Step 4: the after state, and nothing else touched ────────────────────
  SELECT selling_price INTO v_price FROM public.menus WHERE id = c_menu;
  SELECT quantity INTO v_qty FROM public.menu_recipe_items WHERE id = c_line;
  SELECT count(*) INTO v_divs FROM public.pos_sales_aliases
   WHERE menu_id = c_menu OR position(c_name IN pos_product_name) > 0;
  SELECT menu_id, divisor INTO v_exact_menu, v_exact_div
    FROM public.pos_sales_aliases WHERE pos_product_name = c_name;
  IF v_price IS DISTINCT FROM 1200 OR v_qty IS DISTINCT FROM 10 OR v_divs <> 1
     OR v_exact_menu IS DISTINCT FROM c_menu OR v_exact_div IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL    after the change: price %, quantity %, % divisor(s), exact-name divisor ÷% to menu % — not 1200 / 10 / one ÷10 to this menu. Nothing applied.',
      v_price, v_qty, v_divs, v_exact_div, v_exact_menu;
  END IF;
  PERFORM pg_temp.note(format('ok      after (as postgres): price %s, ปูม้าเป็น %s ขีด, one divisor ÷%s to this menu', v_price, v_qty, v_exact_div));

  IF (SELECT count(*) FROM public.menus) <> v_menus_n
     OR (SELECT count(*) FROM public.menu_recipe_items) <> v_items_n
     OR (SELECT count(*) FROM public.pos_sales_aliases) <> v_alias_n + v_added
     OR (SELECT md5(COALESCE(string_agg(id::text || ':' || name || ':' || selling_price::text || ':' || last_period_qty_sold::text, ',' ORDER BY id), ''))
           FROM public.menus WHERE id <> c_menu) <> v_menus_md5
     OR (SELECT md5(COALESCE(string_agg(id::text || ':' || menu_id::text || ':' || ingredient_id::text || ':' || quantity::text, ',' ORDER BY id), ''))
           FROM public.menu_recipe_items WHERE id <> c_line) <> v_items_md5
     OR (SELECT md5(COALESCE(string_agg(id::text || ':' || pos_product_name || ':' || menu_id::text || ':' || divisor::text, ',' ORDER BY id), ''))
           FROM public.pos_sales_aliases WHERE pos_product_name <> c_name) <> v_alias_md5 THEN
    RAISE EXCEPTION 'FAIL    a count or a checksum of the OTHER rows moved: this file touched something else, or another session saved a menu, a recipe or a divisor while it ran — run it again. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      nothing else changed: %s menus, %s recipe lines, %s divisors (%s added); every other row''s checksum is equal',
    v_menus_n, v_items_n, v_alias_n + v_added, v_added));

  -- ── Step 5: what the app's own accounts read ─────────────────────────────
  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'FAIL    no owner or no admin account to read as. Nothing applied.';
  END IF;
  v_seen := pg_temp.read_as(v_owner, c_read);
  IF v_seen IS DISTINCT FROM 'owner sees 1200.00 | 10.0000 | 10.0000' THEN
    RAISE EXCEPTION 'FAIL    as the owner the app reads "%", expected "owner sees 1200.00 | 10.0000 | 10.0000". Nothing applied.', v_seen;
  END IF;
  PERFORM pg_temp.note(format('ok      as the owner %s: %s (price | ขีด of crab | divisor)', v_owner, v_seen));
  v_seen := pg_temp.read_as(v_admin, c_read);
  IF v_seen IS DISTINCT FROM 'admin sees 1200.00 | 10.0000 | 10.0000' THEN
    RAISE EXCEPTION 'FAIL    as an admin the app reads "%", expected "admin sees 1200.00 | 10.0000 | 10.0000". Nothing applied.', v_seen;
  END IF;
  PERFORM pg_temp.note(format('ok      as an admin %s: %s (price | ขีด of crab | divisor)', v_admin, v_seen));

  -- ── Step 6: the file checks that its own checks reported ─────────────────
  v_rows := pg_temp.logged();
  IF v_rows <> c_expected THEN
    RAISE EXCEPTION
      'FAIL    the result table holds % rows, expected % — a step ran and reported nothing, or was skipped. Nothing applied.',
      v_rows, c_expected;
  END IF;
  PERFORM pg_temp.note(format('ok      row count verified: %s evidence rows emitted, as expected (this line makes %s)',
    v_rows, v_rows + 1));
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

DROP FUNCTION IF EXISTS
  pg_temp.read_as(uuid, text),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs ══════════════════════════════════════════════════════════
--
-- 1. Open ปูม้าใหญ่ผัดผงกะหรี่: ราคาขาย ฿1,200 and ปูม้าเป็น 10 ขีด; the cost
--    per unit is now the cost of a kilo.
-- 2. The next POS sales import divides this dish's POS count by 10: its row
--    shows ÷10 as already set, with no หาร box.
-- 3. Record the run in supabase/README.md ("Dishes sold by weight"). Its
--    recipe_item_history row (1 → 10, changed_by NULL) is the tenfold pattern
--    the quantity-box audit query flags — expected, not an error.
