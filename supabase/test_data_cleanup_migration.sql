-- ============================================================================
-- Test data: delete the rows Nik confirmed, by id, and nothing else
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction: it checks that every listed row is still exactly as it was
-- read, deletes the rows by id, checks that exactly the stated rows went and
-- that every other row of every table the deletes can reach is byte for byte
-- as before, counts its own result rows, and rolls the whole thing back if
-- anything disagrees. Safe to re-run: a second run finds all 19 rows already
-- deleted, deletes nothing, checks the same things and says so.
--
-- WHY (Nik, 2026-09-22). Sales uses the catering module informally for real
-- customers (supabase/README.md, "The catering module is in informal use by
-- sales"), so nothing was judged test data from its looks. The rows were read
-- from production, listed for Nik as "clearly test" and "unsure", and Nik
-- confirmed each one; booking 2a96a7a0 was a practice entry, not a real event.
-- The ids and every value checked below come from a read-only production read
-- on 2026-09-22 at 19:06 Bangkok, which matched the 16:31 read row for row.
--
-- WHAT IT DELETES, in this order
--   1. Three bookings, with what cascades from them (ON DELETE CASCADE):
--        c87d2cbd  customer "aaa", 11 Sep     2 charges, 2 menu lines, 0 staff, 0 labour, 16 history lines
--        5f117292  customer "test", 14 Sep    8 charges, 3 menu lines, 1 staff, 3 labour, 18 history lines
--        2a96a7a0  customer "test_(คุณสำรวย)", 17 Sep
--                                             7 charges, 6 menu lines, 1 staff, 5 labour, 20 history lines
--      In all: 3 bookings, 17 charges, 11 menu lines, 0 copied courses,
--      2 staff rows, 8 labour rows, 54 history lines, 0 cost snapshots.
--   2. Twelve customers: test, aaa, test_(คุณสำรวย), aa, ฟฟฟ, กกกก, aiatest,
--      อู๋, หห, พี่ไก่, สหกรณ์, kureha. Once 1 is done none has a booking, so
--      the database sets nothing to NULL.
--   3. The shared set menu test1 (7d9618cc) and its 4 dishes. Its one use,
--      a line of booking 5f117292, went in 1.
--   4. The menu "test" (0194ba9d, ฿0), its SOP and the SOP's 10 steps. It has
--      no recipe lines, POS aliases, SOP ingredient notes or catering use.
--   5. The prep "Test เตรียม": first its own ingredient row (efae4608), then
--      the prep (6af4c4cc) with its 2 access grants. The ingredient goes first
--      so that deleting the prep has nothing to set to NULL.
--
-- WHAT THE DATABASE WRITES BECAUSE OF IT: two lines in
-- prep_recipe_access_history. Its trigger (trg_log_prep_recipe_access_change,
-- provenance_triggers_migration.sql) records every grant and revoke "so no
-- path can bypass it — including SQL run directly", so the 2 grants deleted
-- with the prep are recorded as 2 revokes (prep "Test เตรียม", profiles เวช
-- and เฮง, changed_by empty: the SQL editor). That is the audit trail doing
-- its job; this file does not switch it off. Step 3 checks the 2 lines.
--
-- WHAT IT LEAVES, as Nik decided: the 8 step photos in the sop-photos storage
-- bucket; the 4 approved SOP requests of the menu (pending_changes, no foreign
-- key); the POS category row "test" (pos_item_categories); the 2 grant-history
-- lines already there; the t2000 history lines on booking 232a32c6.
--
-- WHAT IT KEEPS, and checks: booking 232a32c6 (คุณป้อม) and its customer,
-- customer พานาโซนิค, the sets SET-3000, setโต๊ะพรีเมี่ยม and ชุดงานนอก
-- 3000 are present before it deletes, and 232a32c6 with everything of its own
-- is byte for byte the same after. So is every other row of the 30 tables the
-- deletes can reach (Step 3).
--
-- IT REFUSES THE WHOLE FILE, NOTHING DELETED, when:
--   - a listed row changed since it was read: a booking edited (updated_at),
--     now cost-locked, its date, status or customer changed, a charge, menu
--     line, copied course, staff, labour or history row added or removed; a
--     customer renamed or edited; the set, the menu, the prep or the
--     ingredient edited, or anything added under them;
--   - a row outside the list points at a listed row (a customer who gained a
--     booking, a real booking using test1, the menu "test" in a set, the
--     ingredient in a recipe...), checked over EVERY foreign key the database
--     has into these tables, not a list written here;
--   - some listed rows are gone and others are not;
--   - a row Nik said to keep is missing;
--   - the tables it deletes from carry a DELETE trigger other than the three
--     it expects, or either history table carries any trigger;
--   - it runs as a role that row-level security could hide rows from (the
--     editor's role switch); postgres, the editor's default, is right;
--   - any table falls by a different number than stated, or any row not on
--     the list differs by a single byte afterwards;
--   - the result table does not hold the number of lines the file emits.
-- A refusal means the data moved after Nik confirmed it: the file needs
-- revising against a new read, not a second run.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: DELETE ×6 (catering_events,
-- catering_customers, catering_set_menus, menus, ingredients, prep_recipes)
-- and what the database cascades from them, all listed above; CREATE OR
-- REPLACE FUNCTION ×25 on pg_temp helpers that live only as long as this
-- session; after COMMIT, DROP FUNCTION IF EXISTS on 24 of them (the 25th
-- prints the result table). Anything else is unexpected. It creates no table.
--
-- NO TEST WRITES. It adds no function, policy or table to the database, so
-- there is nothing to test as an account: every check is a read, and the only
-- writes are the six DELETEs and what the database does because of them.
--
-- RUN IT WHILE NOBODY IS SAVING ANYTHING IN THE APP, in a fresh SQL editor
-- tab. Step 3 fingerprints 30 whole tables (bookings, menus, ingredients,
-- orders, change requests...), so a save anywhere in them while the file runs
-- makes it roll back: nothing deleted, run it again. The 19 listed rows are
-- locked (FOR UPDATE) from their check to their delete, so nobody can change
-- one in between; a save that touches one waits for the file, then fails.
--
-- THE LESSONS OF 2026-09-19 are kept (AGENTS.md): it creates no object that
-- it names before creating it (check C); it has no regex (check D); it has no
-- always-aborting block (check E); and Step 3 asserts the result table's row
-- count (check F).
-- ============================================================================

BEGIN;

-- ── Scaffolding: the result lines live in a session setting, never a table ──

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('test_data_cleanup.log',
    COALESCE(current_setting('test_data_cleanup.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('test_data_cleanup.log', true), '');
BEGIN
  PERFORM set_config('test_data_cleanup.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

-- How many lines the result table holds RIGHT NOW; Step 3 checks it against
-- the number the file is supposed to emit.
CREATE OR REPLACE FUNCTION pg_temp.logged()
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)
    FROM regexp_split_to_table(COALESCE(current_setting('test_data_cleanup.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- ── What Nik confirmed: every row this file may delete, by id ──────────────
--
-- kind        the row                                owner
-- booking     a booking (catering_events)            -
-- charge      its charge lines                       the booking
-- menu_line   its menu lines                         the booking
-- course      its copied courses (it has none)       the booking
-- staff       its staff rows, by employee id         the booking
-- labour      its labour rows                        the booking
-- history     its history lines                      the booking
-- customer    a customer                             -
-- set         the shared set menu test1              -
-- set_item    its dishes                             the set
-- menu        the menu "test"                        -
-- sop         its SOP                                the menu
-- step        the SOP's steps                        the SOP
-- ingredient  the prep's own ingredient row          -
-- prep        the prep "Test เตรียม"                 -
-- grant       its access grants, by profile id       the prep
CREATE OR REPLACE FUNCTION pg_temp.listed()
RETURNS TABLE (kind text, owner uuid, id uuid)
LANGUAGE sql
IMMUTABLE
AS $fn$
  VALUES
    ('booking'   , NULL::uuid, 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid),  -- customer aaa, 2026-09-11
    ('charge'    , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '0f84e561-3eec-42fe-83a4-cb02f66613e7'::uuid),  -- setโต๊ะพรีเมี่ยม
    ('charge'    , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '5e6d2eec-9e06-4491-a3f3-021ef233d0f8'::uuid),  -- ชุดงานนอก 3000
    ('menu_line' , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '1f21f5c5-0849-4602-be89-06ed818bc7d2'::uuid),
    ('menu_line' , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, 'bbaccc89-fcca-45ff-afc5-ef7bdf22fd5a'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '0eae243a-dd9d-4b30-a3c7-3d9a7c7da139'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '1882d072-8f8c-4ec6-933e-4d6e415bc3e1'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '285e143b-dba0-4181-a23d-9ee49a43b9f2'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '289edc99-2c45-4237-a77a-e9f8f54567da'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '2f11d630-76fc-41ad-a4fa-09102e7ea434'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '2f72486e-e5ac-46cd-9031-024c34e01c01'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '43f7092d-8cf6-4de5-8b62-c8d65ea74272'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '704f6b5c-cd61-4dc5-9f04-3049cb33667f'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '758b9334-694e-4288-a37e-5d0d84f7cc0c'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '7aa48ff0-a8c1-44a4-968d-a65df2bcb616'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '7ae15ed8-39d4-4e70-b8d4-9b29c3e5c2be'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '8023c669-e640-4043-ac27-35395bcacafd'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, '830da344-7680-4e9f-b87f-0309bd0589fd'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, 'ce858b4a-2069-4b9a-9c15-0b760670d497'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, 'ea24eafe-809d-4895-b0a3-633f37e22a04'::uuid),
    ('history'   , 'c87d2cbd-db18-4b9b-90d0-879249a8eeea'::uuid, 'f3ce17f5-04a8-46f9-9a4f-c8b17665e9e8'::uuid),
    ('booking'   , NULL::uuid, '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid),  -- customer test, 2026-09-14
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '1d74f3b1-5de6-4de4-a184-98c8b4ee8027'::uuid),  -- เครื่องดื่มเหมา 100+ ท่าน
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '491e797c-619c-4419-8a3d-1822c684fd2a'::uuid),  -- test1
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '7006ee6a-a06d-47b3-967c-2f9561b28b05'::uuid),  -- ข้าวผัดกุ้ง (กลาง)
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '907b9027-59c0-46a0-b361-a6ee89708847'::uuid),  -- ข้าวเหนียวมะม่วง (เล็ก)
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'c41fe383-8788-41bb-b248-2e4dc377631e'::uuid),  -- เครื่องดื่มเหมา 80-100 ท่าน
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'cff4bd04-b223-4b1a-a64a-e3bfcc50bef2'::uuid),  -- คาราโอเกะ (ร้าน) ชุดมินิ
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'd6f822ad-bb6a-49a3-bbc6-e544e4da26fd'::uuid),  -- เครื่องดื่มเหมา 80-100 ท่าน
    ('charge'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'e059b854-9af6-453d-9da9-ebc257cf1b89'::uuid),  -- ระยะ 11-15 กม.
    ('menu_line' , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '743f7cc2-db84-487a-825e-26c78a124849'::uuid),
    ('menu_line' , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '88291dc1-6192-4817-862f-0a3cb9e2545b'::uuid),
    ('menu_line' , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'a7df3ca8-3e9f-4f4f-b208-01f5cfbc0537'::uuid),
    ('staff'     , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '4909bb30-2a4a-4f9d-87ab-ba2b4eb832ad'::uuid),  -- taker
    ('labour'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '048f3aa9-8a85-418e-9f5c-6d8a080560ad'::uuid),
    ('labour'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '39d21e7c-06e8-47fa-9bb5-b5e95d4fce32'::uuid),
    ('labour'    , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '5d3d1b36-025a-473d-a3a7-1a23414b9139'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '01edbd13-e99c-4eaa-bd39-712a89fb7ea4'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '01f71694-9b99-47c8-ad00-128871643877'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '0cdbef10-94d4-4bb2-907a-323f6b80aec9'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '238a777d-3eaa-4ca1-81ca-0855be89e209'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '39107049-c920-4af5-a409-82a312eedf1d'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '44435867-232b-41cc-871e-1c62ea524245'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '54401a87-6ce3-45ea-873e-83c0f39cadc3'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '61285f2c-a73a-411d-a348-710879582a89'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '65909c64-24d4-405a-ba75-9b0b07a06231'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '675680ab-b1a1-4e1b-b966-65b24a8cccd1'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '6816cfe4-00d5-4212-bc91-f998749cac6c'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '8be8f290-135f-48c5-a32d-b5ec92050295'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '91294769-ad44-43fa-986a-a2aeca34d3d0'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, '96bcc2b5-6b04-48a9-8398-224d401c36a7'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'afd8fe00-982b-4800-8690-bbfe8b62940f'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'e3cc583d-d0c4-44e7-a1ad-5639e34fcea9'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'e5e970ce-77f4-4921-9874-c10117fc660d'::uuid),
    ('history'   , '5f117292-3bc5-44a4-9e58-38acb91455cd'::uuid, 'f9d36956-a68c-4350-97f0-04c61f9be19f'::uuid),
    ('booking'   , NULL::uuid, '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid),  -- customer test_(คุณสำรวย), 2026-09-17
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '124123fc-23c8-4c1a-b40a-521b56fa6cd9'::uuid),  -- ปลาช่อนน้ำตก
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '8b928524-fcc7-4132-aeea-f31d24788db2'::uuid),  -- ยำรวมมิตรทะเล
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'a8c93010-1a0b-4601-af53-46be44a8fbc6'::uuid),  -- ระยะ 1-5 กม.
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'c68713dd-9514-4950-a90a-493ef1fbc9c4'::uuid),  -- ข้าว (โถ)
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'e41564fb-efd4-46e5-b645-71acd8c4ff9d'::uuid),  -- ปลาหมึกไข่นึ่งนาว
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'eedc43ad-67fc-4549-af35-8c89372b6ede'::uuid),  -- ผัดผักสี่สหายน้ำแดง (เล็ก)
    ('charge'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'f9d9be1e-47ac-4824-85bb-12e80d7dee32'::uuid),  -- แกงส้มกุ้งไข่ชะอม(ใหญ่)
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '01038b5b-dc8e-468f-ac3b-20bd61b697b3'::uuid),
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '4c205c17-c580-4e78-aa7d-dde3898241a6'::uuid),
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '590a8a1a-29fd-4983-b89a-011d6b58726a'::uuid),
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '8b41a08f-6341-4d14-9325-79d0370dbeb1'::uuid),
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'e844f288-7ad4-4c17-94ee-9417bbdbce72'::uuid),
    ('menu_line' , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'f209d61b-daa4-449f-ae1b-f25b1cec4cb7'::uuid),
    ('staff'     , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '769c2566-fe0a-4663-b920-ef0f23cdef71'::uuid),  -- taker
    ('labour'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '530248d2-ed5e-4b98-a5e0-ba938dec3133'::uuid),
    ('labour'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '814c0ce4-d6cf-43ea-a3a5-131659bdcfed'::uuid),
    ('labour'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'ce39a326-3563-46be-9978-6146395f373a'::uuid),
    ('labour'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'da923730-d8ca-4242-a882-d865b005590e'::uuid),
    ('labour'    , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'e7ffaad2-efb9-420c-8b52-8bd7874a02c2'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '05d03d30-66cc-4363-b4a9-d9e65e6c4b59'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '1b9cca93-7f28-4784-a699-addda198c6fe'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '1e5e1c41-81f7-48b8-a589-616c80b2d173'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '46d1ba42-d703-472b-8dab-f3c632d88dd5'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '4f244ea0-102e-477a-b1f3-0ed8c33b58d0'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '55c8f007-c844-4cc2-9c9f-d4d515fa0361'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '5b96d352-ed2e-4346-866a-b4dabfceefd8'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '65e8f503-dbb6-4d20-9f8e-f592dfab7afc'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '6af430b3-b8aa-4926-ad2c-328d2ad0221b'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '747d2615-34bb-4b10-bb18-ea9482dfbd90'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '8ce850e4-7991-435e-94de-0aed5d31f026'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, '9dfa594d-1dfc-4db0-8294-d69659a76403'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'b10e068b-d8df-4550-937d-e6c20660f3b4'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'c75f7749-9115-4e6f-84a4-997c9bc2c338'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'cf58f20a-41b7-467c-b799-56f8dc9e3dc8'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'dbdc237a-d073-49f2-b5cc-abef67543561'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'ea4ceadf-b1ca-4ca2-a450-98357b4f6ede'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'efc3c952-8028-4298-8b03-5a66547e2bf7'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'f2c45051-fa7d-4f9f-a270-c2e69ad32543'::uuid),
    ('history'   , '2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1'::uuid, 'fc4af4f1-9014-4e33-98c3-f1a00484b6ee'::uuid),
    ('customer'  , NULL::uuid, 'da3c6ccd-2af9-4f8b-a8d4-2dc8cb0d9ee9'::uuid),  -- test
    ('customer'  , NULL::uuid, 'b14e9d04-0b78-4d86-aa47-80778a657727'::uuid),  -- aaa
    ('customer'  , NULL::uuid, 'ac0ba311-1880-4aa3-8943-f23329e1199f'::uuid),  -- test_(คุณสำรวย)
    ('customer'  , NULL::uuid, 'd6accdbb-fc84-40f1-887e-1b8a342fa62e'::uuid),  -- aa
    ('customer'  , NULL::uuid, '03bbb9a3-d0f9-4355-9f37-f70a65e3ac56'::uuid),  -- ฟฟฟ
    ('customer'  , NULL::uuid, 'f9c47af6-4f3d-45a1-a90b-72344c80bfca'::uuid),  -- กกกก
    ('customer'  , NULL::uuid, '9f4a1a7e-f5dc-499a-886c-f9749d0e8a66'::uuid),  -- aiatest
    ('customer'  , NULL::uuid, '2717a5b6-7dec-4936-9507-afa435b33c98'::uuid),  -- อู๋
    ('customer'  , NULL::uuid, '6bcbb6a8-9b18-4503-83f9-ad8ecbb36e77'::uuid),  -- หห
    ('customer'  , NULL::uuid, '3c1ec050-f86b-4dd3-bffe-946b7d8a3c50'::uuid),  -- พี่ไก่
    ('customer'  , NULL::uuid, 'c79985f5-243a-4e0e-b29e-3fa36e57566e'::uuid),  -- สหกรณ์
    ('customer'  , NULL::uuid, '82d3c81b-ab71-423b-a59e-5a5554565723'::uuid),  -- kureha
    ('set'       , NULL::uuid, '7d9618cc-7696-4a8c-b312-fea5bd10716f'::uuid),  -- test1
    ('set_item'  , '7d9618cc-7696-4a8c-b312-fea5bd10716f'::uuid, '0a98cfa4-f7ce-47ea-8903-19dd69d58780'::uuid),
    ('set_item'  , '7d9618cc-7696-4a8c-b312-fea5bd10716f'::uuid, '4dcd5899-140a-4b9a-997c-1356a871a569'::uuid),
    ('set_item'  , '7d9618cc-7696-4a8c-b312-fea5bd10716f'::uuid, '75f44f90-b0ae-4559-9e4c-c4adeaf086ef'::uuid),
    ('set_item'  , '7d9618cc-7696-4a8c-b312-fea5bd10716f'::uuid, '8b90c9d7-8947-4693-810f-73f42a6abf7d'::uuid),
    ('menu'      , NULL::uuid, '0194ba9d-d673-478b-8b51-e7b010d21e67'::uuid),  -- test
    ('sop'       , '0194ba9d-d673-478b-8b51-e7b010d21e67'::uuid, '48734078-41f8-4401-935d-6a4bd1e94439'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '0076332a-a174-4235-af37-1f46d41bba82'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '074a7dcc-86dd-4952-a2b5-e9f56a2fcabf'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '2e0c79d2-a7da-4ff1-bd75-8584c555f4dc'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '52282406-eb85-41d2-83fe-62940913eaaf'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '822b32b3-746a-4734-8c1a-4eb79ee396df'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, '946a5b80-7322-4b42-a008-bc2d084499c5'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, 'c4583d5e-fddb-4752-8f79-df97ce2da6b8'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, 'c6055b1e-f614-4cb5-b0b3-0859273a1f09'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, 'c6c37aa4-a150-4f9f-a410-abb4de3f0b35'::uuid),
    ('step'      , '48734078-41f8-4401-935d-6a4bd1e94439'::uuid, 'f31c3041-6059-44d0-b6f2-a5dd18adab2f'::uuid),
    ('ingredient', NULL::uuid, 'efae4608-6c64-4115-a183-24cff34190db'::uuid),  -- Test เตรียม
    ('prep'      , NULL::uuid, '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5'::uuid),  -- Test เตรียม
    ('grant'     , '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5'::uuid, '8c4c865a-1ebe-4363-817a-fb3779a3c048'::uuid),  -- เฮง
    ('grant'     , '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5'::uuid, 'ef2075c7-9fbc-4c66-8dd1-6528bb810786'::uuid)  -- เวช
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ids(p_kind text)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(array_agg(l.id ORDER BY l.id), '{}'::uuid[])
    FROM pg_temp.listed() l
   WHERE l.kind = p_kind;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.owned(p_kind text, p_owner uuid)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(array_agg(l.id ORDER BY l.id), '{}'::uuid[])
    FROM pg_temp.listed() l
   WHERE l.kind = p_kind AND l.owner = p_owner;
$fn$;

-- ── The tables the deletes can reach, and which of their rows are listed ───

-- Every table a cascade, a SET NULL or a trigger can reach from the six
-- DELETEs (the live foreign keys, read 2026-09-22), plus the three Nik said
-- to leave: each is counted and fingerprinted before and after.
CREATE OR REPLACE FUNCTION pg_temp.checked_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT ARRAY[
    'catering_events', 'catering_event_charges', 'catering_event_menus', 'catering_event_menu_items',
    'catering_event_staff', 'catering_event_labor', 'catering_event_activity_log', 'catering_event_cost_snapshots',
    'catering_customers', 'catering_set_menus', 'catering_set_menu_items',
    'menus', 'menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes', 'menu_recipe_items', 'pos_sales_aliases',
    'ingredients', 'ingredient_price_history', 'station_ingredients', 'order_items', 'pos_price_aliases', 'template_items',
    'prep_recipes', 'prep_recipe_items', 'prep_recipe_access', 'prep_recipe_access_history',
    'recipe_item_history', 'pending_changes', 'pos_item_categories'];
$fn$;

-- The rows of a table this file deletes: an SQL condition on alias p_alias.
-- 'false' for a table where nothing is listed.
CREATE OR REPLACE FUNCTION pg_temp.doomed_where(p_table text, p_alias text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_table
    WHEN 'catering_events'               THEN p_alias || '.id = ANY (pg_temp.ids(''booking''))'
    WHEN 'catering_event_charges'        THEN p_alias || '.id = ANY (pg_temp.ids(''charge''))'
    WHEN 'catering_event_menus'          THEN p_alias || '.id = ANY (pg_temp.ids(''menu_line''))'
    WHEN 'catering_event_menu_items'     THEN p_alias || '.id = ANY (pg_temp.ids(''course''))'
    WHEN 'catering_event_staff'          THEN p_alias || '.event_id = ANY (pg_temp.ids(''booking''))'
    WHEN 'catering_event_labor'          THEN p_alias || '.id = ANY (pg_temp.ids(''labour''))'
    WHEN 'catering_event_activity_log'   THEN p_alias || '.id = ANY (pg_temp.ids(''history''))'
    WHEN 'catering_event_cost_snapshots' THEN p_alias || '.event_id = ANY (pg_temp.ids(''booking''))'
    WHEN 'catering_customers'            THEN p_alias || '.id = ANY (pg_temp.ids(''customer''))'
    WHEN 'catering_set_menus'            THEN p_alias || '.id = ANY (pg_temp.ids(''set''))'
    WHEN 'catering_set_menu_items'       THEN p_alias || '.id = ANY (pg_temp.ids(''set_item''))'
    WHEN 'menus'                         THEN p_alias || '.id = ANY (pg_temp.ids(''menu''))'
    WHEN 'menu_sops'                     THEN p_alias || '.id = ANY (pg_temp.ids(''sop''))'
    WHEN 'menu_sop_steps'                THEN p_alias || '.id = ANY (pg_temp.ids(''step''))'
    WHEN 'ingredients'                   THEN p_alias || '.id = ANY (pg_temp.ids(''ingredient''))'
    WHEN 'prep_recipes'                  THEN p_alias || '.id = ANY (pg_temp.ids(''prep''))'
    WHEN 'prep_recipe_access'            THEN '(' || p_alias || '.prep_recipe_id = ANY (pg_temp.ids(''prep'')) AND '
                                              || p_alias || '.profile_id = ANY (pg_temp.ids(''grant'')))'
    ELSE 'false'
  END;
$fn$;

-- Rows the database adds because of the deletes: the grant-history lines the
-- trigger writes in this transaction (changed_at defaults to now(), which is
-- the transaction's start time throughout).
CREATE OR REPLACE FUNCTION pg_temp.new_where(p_table text, p_alias text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_table
    WHEN 'prep_recipe_access_history' THEN p_alias || '.changed_at = now()'
    ELSE 'false'
  END;
$fn$;

-- THE STATED COUNTS: how far each table falls on a first run, from the read.
-- Step 0 checks them against the list above; Steps 1 to 3 against the
-- database. A re-run expects 0 everywhere.
CREATE OR REPLACE FUNCTION pg_temp.expected_fall(p_table text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_table
    -- 1. the three bookings and what cascades from them
    WHEN 'catering_events'               THEN 3
    WHEN 'catering_event_charges'        THEN 17   -- 2 + 8 + 7
    WHEN 'catering_event_menus'          THEN 11   -- 2 + 3 + 6
    WHEN 'catering_event_menu_items'     THEN 0    -- no copied courses
    WHEN 'catering_event_staff'          THEN 2    -- 0 + 1 + 1
    WHEN 'catering_event_labor'          THEN 8    -- 0 + 3 + 5
    WHEN 'catering_event_activity_log'   THEN 54   -- 16 + 18 + 20
    WHEN 'catering_event_cost_snapshots' THEN 0
    -- 2. the twelve customers
    WHEN 'catering_customers'            THEN 12
    -- 3. the shared set menu test1 and its dishes
    WHEN 'catering_set_menus'            THEN 1
    WHEN 'catering_set_menu_items'       THEN 4
    -- 4. the menu "test", its SOP and the SOP's steps
    WHEN 'menus'                         THEN 1
    WHEN 'menu_sops'                     THEN 1
    WHEN 'menu_sop_steps'                THEN 10
    -- 5. the prep's ingredient row, the prep and its grants
    WHEN 'ingredients'                   THEN 1
    WHEN 'prep_recipes'                  THEN 1
    WHEN 'prep_recipe_access'            THEN 2
    -- the grant-history trigger writes one revoke per grant: this one GROWS by 2
    WHEN 'prep_recipe_access_history'    THEN -2
    ELSE 0
  END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.label(p_table text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_table
    WHEN 'catering_events'               THEN 'bookings'
    WHEN 'catering_event_charges'        THEN 'charges'
    WHEN 'catering_event_menus'          THEN 'menu lines'
    WHEN 'catering_event_menu_items'     THEN 'copied courses'
    WHEN 'catering_event_staff'          THEN 'staff'
    WHEN 'catering_event_labor'          THEN 'labour'
    WHEN 'catering_event_activity_log'   THEN 'history lines'
    WHEN 'catering_event_cost_snapshots' THEN 'cost snapshots'
    WHEN 'catering_customers'            THEN 'customers'
    WHEN 'catering_set_menus'            THEN 'set menus'
    WHEN 'catering_set_menu_items'       THEN 'set dishes'
    WHEN 'menus'                         THEN 'menus'
    WHEN 'menu_sops'                     THEN 'SOPs'
    WHEN 'menu_sop_steps'                THEN 'SOP steps'
    WHEN 'menu_sop_ingredient_notes'     THEN 'SOP ingredient notes'
    WHEN 'menu_recipe_items'             THEN 'recipe lines'
    WHEN 'pos_sales_aliases'             THEN 'POS aliases'
    WHEN 'ingredients'                   THEN 'ingredients'
    WHEN 'ingredient_price_history'      THEN 'price history'
    WHEN 'station_ingredients'           THEN 'station ingredients'
    WHEN 'order_items'                   THEN 'order items'
    WHEN 'pos_price_aliases'             THEN 'POS price aliases'
    WHEN 'template_items'                THEN 'template items'
    WHEN 'prep_recipes'                  THEN 'preps'
    WHEN 'prep_recipe_items'             THEN 'prep lines'
    WHEN 'prep_recipe_access'            THEN 'access grants'
    WHEN 'prep_recipe_access_history'    THEN 'grant history'
    WHEN 'recipe_item_history'           THEN 'recipe history'
    WHEN 'pending_changes'               THEN 'change requests'
    WHEN 'pos_item_categories'           THEN 'POS categories'
    ELSE p_table
  END;
$fn$;

-- ── Per-row checks: 'match', 'absent', or 'changed: <what>' ────────────────

-- One result line per listed row: present and exactly as read, or already
-- deleted. Anything else stops the whole file.
CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_state text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF p_state = 'match' THEN
    PERFORM set_config('test_data_cleanup.present',
      (current_setting('test_data_cleanup.present')::int + 1)::text, false);
    PERFORM pg_temp.note('ok      ' || p_label || ': present, exactly as read');
  ELSIF p_state = 'absent' THEN
    PERFORM set_config('test_data_cleanup.absent',
      (current_setting('test_data_cleanup.absent')::int + 1)::text, false);
    PERFORM pg_temp.note('ok      ' || p_label || ': already deleted');
  ELSE
    RAISE EXCEPTION 'FAIL    %: %. It changed after it was read (2026-09-22 19:06 Bangkok) and confirmed. Nothing deleted; the file needs revising against a new read.',
      p_label, COALESCE(p_state, '(no state)');
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.booking_state(p_id uuid, p_customer uuid, p_date date, p_status text, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_customer uuid;
  v_date     date;
  v_status   text;
  v_locked   timestamptz;
  v_updated  timestamptz;
  v_why      text := '';
BEGIN
  SELECT e0.customer_id, e0.event_date, e0.status, e0.cost_locked_at, e0.updated_at
    INTO v_customer, v_date, v_status, v_locked, v_updated
    FROM public.catering_events e0
   WHERE e0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_customer IS DISTINCT FROM p_customer THEN v_why := v_why || ' its customer changed;'; END IF;
  IF v_date IS DISTINCT FROM p_date THEN v_why := v_why || ' its event date is now ' || v_date || ';'; END IF;
  IF v_status IS DISTINCT FROM p_status THEN v_why := v_why || ' its status is now ' || v_status || ';'; END IF;
  IF v_locked IS NOT NULL THEN v_why := v_why || ' it is now cost-locked;'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_event_charges x0 WHERE x0.event_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('charge', p_id) THEN
    v_why := v_why || ' its charge lines changed;';
  END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_event_menus x0 WHERE x0.event_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('menu_line', p_id) THEN
    v_why := v_why || ' its menu lines changed;';
  END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_event_menu_items x0 WHERE x0.event_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('course', p_id) THEN
    v_why := v_why || ' its copied courses changed;';
  END IF;
  IF ARRAY(SELECT x0.employee_id FROM public.catering_event_staff x0 WHERE x0.event_id = p_id ORDER BY x0.employee_id)
     <> pg_temp.owned('staff', p_id) THEN
    v_why := v_why || ' its staff changed;';
  END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_event_labor x0 WHERE x0.event_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('labour', p_id) THEN
    v_why := v_why || ' its labour rows changed;';
  END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_event_activity_log x0 WHERE x0.event_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('history', p_id) THEN
    v_why := v_why || ' its history changed;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_cost_snapshots x0 WHERE x0.event_id = p_id) THEN
    v_why := v_why || ' it has a cost snapshot;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.customer_state(p_id uuid, p_name text, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_name    text;
  v_updated timestamptz;
  v_why     text := '';
BEGIN
  SELECT c0.name, c0.updated_at INTO v_name, v_updated
    FROM public.catering_customers c0
   WHERE c0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_name IS DISTINCT FROM p_name THEN v_why := v_why || ' it is now named ' || v_name || ';'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF EXISTS (SELECT 1 FROM public.catering_events e0
              WHERE e0.customer_id = p_id AND NOT (e0.id = ANY (pg_temp.ids('booking')))) THEN
    v_why := v_why || ' it has a booking that is not on the list;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.set_state(p_id uuid, p_name text, p_price numeric, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_name    text;
  v_price   numeric;
  v_updated timestamptz;
  v_why     text := '';
BEGIN
  SELECT s0.name, s0.price_per_set, s0.updated_at INTO v_name, v_price, v_updated
    FROM public.catering_set_menus s0
   WHERE s0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_name IS DISTINCT FROM p_name THEN v_why := v_why || ' it is now named ' || v_name || ';'; END IF;
  IF v_price IS DISTINCT FROM p_price THEN v_why := v_why || ' its price is now ' || v_price || ';'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF ARRAY(SELECT x0.id FROM public.catering_set_menu_items x0 WHERE x0.set_menu_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('set_item', p_id) THEN
    v_why := v_why || ' its dishes changed;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_menus x0
              WHERE x0.set_menu_id = p_id AND NOT (x0.id = ANY (pg_temp.ids('menu_line')))) THEN
    v_why := v_why || ' a booking not on the list uses it;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_menu_items x0
              WHERE x0.source_set_menu_id = p_id AND NOT (x0.event_id = ANY (pg_temp.ids('booking')))) THEN
    v_why := v_why || ' a booking not on the list holds courses copied from it;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.menu_state(p_id uuid, p_name text, p_price numeric, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_name    text;
  v_price   numeric;
  v_updated timestamptz;
  v_why     text := '';
BEGIN
  SELECT m0.name, m0.selling_price, m0.updated_at INTO v_name, v_price, v_updated
    FROM public.menus m0
   WHERE m0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_name IS DISTINCT FROM p_name THEN v_why := v_why || ' it is now named ' || v_name || ';'; END IF;
  IF v_price IS DISTINCT FROM p_price THEN v_why := v_why || ' its price is now ' || v_price || ';'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF ARRAY(SELECT x0.id FROM public.menu_sops x0 WHERE x0.menu_id = p_id ORDER BY x0.id)
     <> pg_temp.owned('sop', p_id) THEN
    v_why := v_why || ' its SOP changed;';
  END IF;
  IF ARRAY(SELECT x0.id FROM public.menu_sop_steps x0 JOIN public.menu_sops o0 ON o0.id = x0.sop_id
            WHERE o0.menu_id = p_id ORDER BY x0.id)
     <> pg_temp.ids('step') THEN
    v_why := v_why || ' its SOP steps changed;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_sop_ingredient_notes x0 JOIN public.menu_sops o0 ON o0.id = x0.sop_id
              WHERE o0.menu_id = p_id) THEN
    v_why := v_why || ' its SOP has ingredient notes;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_recipe_items x0 WHERE x0.menu_id = p_id) THEN
    v_why := v_why || ' it has recipe lines;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pos_sales_aliases x0 WHERE x0.menu_id = p_id) THEN
    v_why := v_why || ' it has POS aliases;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_menus x0 WHERE x0.menu_id = p_id)
     OR EXISTS (SELECT 1 FROM public.catering_set_menu_items x0 WHERE x0.menu_id = p_id)
     OR EXISTS (SELECT 1 FROM public.catering_event_menu_items x0 WHERE x0.menu_id = p_id) THEN
    v_why := v_why || ' a booking or a set menu uses it;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.ingredient_state(p_id uuid, p_name text, p_prep uuid, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_name    text;
  v_is_prep boolean;
  v_prep    uuid;
  v_updated timestamptz;
  v_why     text := '';
BEGIN
  SELECT g0.name, g0.is_prep, g0.prep_recipe_id, g0.updated_at INTO v_name, v_is_prep, v_prep, v_updated
    FROM public.ingredients g0
   WHERE g0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_name IS DISTINCT FROM p_name THEN v_why := v_why || ' it is now named ' || v_name || ';'; END IF;
  IF v_is_prep IS DISTINCT FROM true THEN v_why := v_why || ' it is no longer a prep ingredient;'; END IF;
  IF v_prep IS DISTINCT FROM p_prep THEN v_why := v_why || ' it now belongs to another prep;'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF EXISTS (SELECT 1 FROM public.menu_recipe_items x0 WHERE x0.ingredient_id = p_id)
     OR EXISTS (SELECT 1 FROM public.prep_recipe_items x0 WHERE x0.ingredient_id = p_id) THEN
    v_why := v_why || ' a recipe uses it;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.prep_state(p_id uuid, p_name text, p_updated timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_name    text;
  v_updated timestamptz;
  v_why     text := '';
BEGIN
  SELECT r0.name, r0.updated_at INTO v_name, v_updated
    FROM public.prep_recipes r0
   WHERE r0.id = p_id;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF v_name IS DISTINCT FROM p_name THEN v_why := v_why || ' it is now named ' || v_name || ';'; END IF;
  IF v_updated IS DISTINCT FROM p_updated THEN v_why := v_why || ' it was edited at ' || v_updated || ';'; END IF;
  IF ARRAY(SELECT x0.profile_id FROM public.prep_recipe_access x0 WHERE x0.prep_recipe_id = p_id ORDER BY x0.profile_id)
     <> pg_temp.owned('grant', p_id) THEN
    v_why := v_why || ' its access grants changed;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prep_recipe_items x0 WHERE x0.prep_recipe_id = p_id) THEN
    v_why := v_why || ' it has recipe lines;';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ingredients x0
              WHERE x0.prep_recipe_id = p_id AND NOT (x0.id = ANY (pg_temp.ids('ingredient')))) THEN
    v_why := v_why || ' another ingredient row points at it;';
  END IF;
  RETURN CASE WHEN v_why = '' THEN 'match' ELSE 'changed:' || v_why END;
END
$fn$;

-- The rows Nik said to keep that the list sits next to: '' when all present.
CREATE OR REPLACE FUNCTION pg_temp.kept_missing()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(string_agg(k.what, ', ' ORDER BY k.what), '')
    FROM (VALUES
      ('booking 232a32c6 (คุณป้อม)',
        NOT EXISTS (SELECT 1 FROM public.catering_events WHERE id = '232a32c6-1232-4ae1-84c3-b77780a3f353')),
      ('customer 742102a0 คุณป้อม',
        NOT EXISTS (SELECT 1 FROM public.catering_customers WHERE id = '742102a0-3153-4e8d-8a08-4b2e0010cd82')),
      ('customer 6cc6b2fd พานาโซนิค',
        NOT EXISTS (SELECT 1 FROM public.catering_customers WHERE id = '6cc6b2fd-99a1-45d9-8a12-0e7e9d2e666d')),
      ('set 72e2e256 SET-3000',
        NOT EXISTS (SELECT 1 FROM public.catering_set_menus WHERE id = '72e2e256-5116-44a2-85eb-26f8c4a43ab5')),
      ('set 08fb7a10 setโต๊ะพรีเมี่ยม',
        NOT EXISTS (SELECT 1 FROM public.catering_set_menus WHERE id = '08fb7a10-6e1a-4cbf-ae6d-b1073ffcf05f')),
      ('set d54ff3d4 ชุดงานนอก 3000',
        NOT EXISTS (SELECT 1 FROM public.catering_set_menus WHERE id = 'd54ff3d4-1ff5-4151-853b-ec110e9035bb'))
    ) AS k(what, missing)
   WHERE k.missing;
$fn$;

-- One booking with everything of its own, as one fingerprint: the booking
-- row, its charges, menu lines, copied courses, staff, labour, history, cost
-- snapshot and its customer's row.
CREATE OR REPLACE FUNCTION pg_temp.booking_md5(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT md5(concat_ws(chr(29),
    (SELECT e0::text FROM public.catering_events e0 WHERE e0.id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_charges x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_menus x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_menu_items x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_staff x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_labor x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_activity_log x0 WHERE x0.event_id = p_id),
    (SELECT string_agg(x0::text, chr(10) ORDER BY x0::text) FROM public.catering_event_cost_snapshots x0 WHERE x0.event_id = p_id),
    (SELECT c0::text FROM public.catering_customers c0 JOIN public.catering_events e0 ON e0.customer_id = c0.id
      WHERE e0.id = p_id)));
$fn$;

-- EVERY foreign key the database has into the checked tables, read from the
-- catalogue at run time, not from a list written here: for each, the rows
-- that point at a listed row and are not listed themselves. '' when none.
-- Such a row would be deleted by a cascade, set to NULL, or block a delete.
CREATE OR REPLACE FUNCTION pg_temp.outside_refs()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  r     record;
  v_n   bigint;
  v_fks integer := 0;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT cn.nspname AS cs, cl.relname AS ct, ca.attname AS ccol,
           pl.relname AS pt, pa.attname AS pcol, cardinality(c.conkey) AS width
      FROM pg_constraint c
      JOIN pg_class cl     ON cl.oid = c.conrelid
      JOIN pg_namespace cn ON cn.oid = cl.relnamespace
      JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
      JOIN pg_class pl     ON pl.oid = c.confrelid
      JOIN pg_namespace pn ON pn.oid = pl.relnamespace
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND pn.nspname = 'public'
       AND pl.relname = ANY (pg_temp.checked_tables())
     ORDER BY cn.nspname, cl.relname, ca.attname
  LOOP
    v_fks := v_fks + 1;
    IF r.width <> 1 THEN
      v_bad := v_bad || format(' %s.%s is part of a multi-column key this file does not check;', r.ct, r.ccol);
      CONTINUE;
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM %I.%I c0 WHERE c0.%I IN (SELECT p0.%I FROM public.%I p0 WHERE COALESCE(%s, false)) AND NOT COALESCE(%s, false)',
      r.cs, r.ct, r.ccol, r.pcol, r.pt, pg_temp.doomed_where(r.pt, 'p0'),
      CASE WHEN r.cs = 'public' THEN pg_temp.doomed_where(r.ct, 'c0') ELSE 'false' END)
      INTO v_n;
    IF v_n > 0 THEN
      v_bad := v_bad || format(' %s row(s) of %s.%s point at a listed %s row and are not on the list;', v_n, r.cs, r.ct, r.pt);
    END IF;
  END LOOP;
  PERFORM set_config('test_data_cleanup.fks', v_fks::text, false);
  RETURN v_bad;
END
$fn$;

-- One table: its row count, how many of its rows are listed, how many were
-- added in this transaction, and an md5 of every OTHER row, in a fixed order.
CREATE OR REPLACE FUNCTION pg_temp.fingerprint(p_table text)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_n      bigint;
  v_doomed bigint;
  v_new    bigint;
  v_kept   text;
BEGIN
  EXECUTE format(
    'SELECT count(*), count(*) FILTER (WHERE COALESCE(%s, false)), count(*) FILTER (WHERE COALESCE(%s, false)), '
    || 'md5(COALESCE(string_agg(x0::text, chr(10) ORDER BY x0::text) '
    || 'FILTER (WHERE NOT COALESCE(%s, false) AND NOT COALESCE(%s, false)), %L)) FROM public.%I x0',
    pg_temp.doomed_where(p_table, 'x0'), pg_temp.new_where(p_table, 'x0'),
    pg_temp.doomed_where(p_table, 'x0'), pg_temp.new_where(p_table, 'x0'), '', p_table)
    INTO v_n, v_doomed, v_new, v_kept;
  RETURN jsonb_build_object('n', v_n, 'doomed', v_doomed, 'new', v_new, 'kept', v_kept);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.snapshot()
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_t text;
  v   jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_t IN ARRAY pg_temp.checked_tables() LOOP
    v := v || jsonb_build_object(v_t, pg_temp.fingerprint(v_t));
  END LOOP;
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.counts(p_tables text[])
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_t text;
  v_n bigint;
  v   jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_t IN ARRAY p_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    v := v || jsonb_build_object(v_t, v_n);
  END LOOP;
  RETURN v;
END
$fn$;

-- One delete step: each of its tables fell by exactly the stated amount (0 on
-- a re-run), or the whole file stops. Returns the counts as a sentence.
CREATE OR REPLACE FUNCTION pg_temp.step_report(p_step text, p_tables text[], p_before jsonb, p_after jsonb, p_first boolean)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_t     text;
  v_fell  bigint;
  v_want  bigint;
  v_parts text := '';
BEGIN
  FOREACH v_t IN ARRAY p_tables LOOP
    v_fell := (p_before ->> v_t)::bigint - (p_after ->> v_t)::bigint;
    v_want := CASE WHEN p_first THEN pg_temp.expected_fall(v_t) ELSE 0 END;
    IF v_fell <> v_want THEN
      RAISE EXCEPTION 'FAIL    %: % fell by %, expected %. Nothing deleted.', p_step, v_t, v_fell, v_want;
    END IF;
    v_parts := v_parts || format('%s %s%s, ', pg_temp.label(v_t), CASE WHEN v_fell < 0 THEN '+' ELSE '-' END, abs(v_fell));
  END LOOP;
  RETURN rtrim(v_parts, ', ');
END
$fn$;

-- ── Step 0: the file agrees with itself, and the database has no surprise ──

DO $do$
DECLARE
  v_kinds text;
  v_bad   text;
  v_trig  text;
  c_want_trig constant text :=
    'menu_recipe_items.trg_log_menu_recipe_item_change, prep_recipe_access.trg_log_prep_recipe_access_change, '
    || 'prep_recipe_items.trg_log_prep_recipe_item_change';
BEGIN
  PERFORM set_config('test_data_cleanup.log', '', false);
  PERFORM set_config('test_data_cleanup.present', '0', false);
  PERFORM set_config('test_data_cleanup.absent', '0', false);

  -- The list holds what the header says, once each, and none of the rows to keep.
  SELECT string_agg(k.kind || '=' || k.n, ' ' ORDER BY k.kind COLLATE "C") INTO v_kinds
    FROM (SELECT l.kind, count(*) AS n FROM pg_temp.listed() l GROUP BY l.kind) k;
  IF v_kinds IS DISTINCT FROM
     'booking=3 charge=17 customer=12 grant=2 history=54 ingredient=1 labour=8 menu=1 menu_line=11 prep=1 set=1 set_item=4 sop=1 staff=2 step=10' THEN
    RAISE EXCEPTION 'FAIL    the file''s own list does not hold what its header states: %. Nothing deleted.', v_kinds;
  END IF;
  IF (SELECT count(*) FROM pg_temp.listed())
     <> (SELECT count(*) FROM (SELECT DISTINCT l.kind, l.owner, l.id FROM pg_temp.listed() l) d) THEN
    RAISE EXCEPTION 'FAIL    a row is listed twice. Nothing deleted.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.listed() l WHERE l.id IN (
       '232a32c6-1232-4ae1-84c3-b77780a3f353', '742102a0-3153-4e8d-8a08-4b2e0010cd82', '6cc6b2fd-99a1-45d9-8a12-0e7e9d2e666d',
       '72e2e256-5116-44a2-85eb-26f8c4a43ab5', '08fb7a10-6e1a-4cbf-ae6d-b1073ffcf05f', 'd54ff3d4-1ff5-4151-853b-ec110e9035bb')) THEN
    RAISE EXCEPTION 'FAIL    a row Nik said to keep is on the list. Nothing deleted.';
  END IF;
  -- The stated counts agree with the list.
  SELECT string_agg(m.t || ' ' || pg_temp.expected_fall(m.t) || ' vs ' || cardinality(pg_temp.ids(m.k)), '; ') INTO v_bad
    FROM (VALUES ('catering_events', 'booking'), ('catering_event_charges', 'charge'), ('catering_event_menus', 'menu_line'),
                 ('catering_event_menu_items', 'course'), ('catering_event_labor', 'labour'), ('catering_event_activity_log', 'history'),
                 ('catering_event_staff', 'staff'), ('catering_customers', 'customer'), ('catering_set_menus', 'set'),
                 ('catering_set_menu_items', 'set_item'), ('menus', 'menu'), ('menu_sops', 'sop'), ('menu_sop_steps', 'step'),
                 ('ingredients', 'ingredient'), ('prep_recipes', 'prep'), ('prep_recipe_access', 'grant')) AS m(t, k)
   WHERE pg_temp.expected_fall(m.t) <> cardinality(pg_temp.ids(m.k));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    the stated counts disagree with the list: %. Nothing deleted.', v_bad;
  END IF;
  -- Every check must see every row. The editor's role switch runs the file
  -- under row-level security, which the cascades ignore: refuse it.
  IF NOT (current_user = 'postgres'
          OR COALESCE((SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), false)) THEN
    RAISE EXCEPTION 'FAIL    running as %, from which row-level security could hide rows. Run it as postgres, the SQL editor''s default role. Nothing deleted.', current_user;
  END IF;
  PERFORM pg_temp.note('ok      running as ' || current_user || '; the list holds 128 rows (19 to delete by id, 109 that go with them), and every count this file states agrees with it');

  -- The triggers that fire on a DELETE of the tables it deletes from, and any
  -- trigger at all on the two history tables a trigger could write to.
  SELECT string_agg(c.relname || '.' || tg.tgname, ', ' ORDER BY c.relname, tg.tgname) INTO v_trig
    FROM pg_trigger tg
    JOIN pg_class c     ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT tg.tgisinternal
     AND n.nspname = 'public'
     AND ((c.relname = ANY (ARRAY[
             'catering_events', 'catering_event_charges', 'catering_event_menus', 'catering_event_menu_items',
             'catering_event_staff', 'catering_event_labor', 'catering_event_activity_log', 'catering_event_cost_snapshots',
             'catering_customers', 'catering_set_menus', 'catering_set_menu_items',
             'menus', 'menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes', 'menu_recipe_items', 'pos_sales_aliases',
             'ingredients', 'ingredient_price_history', 'station_ingredients',
             'prep_recipes', 'prep_recipe_items', 'prep_recipe_access'])
           AND (tg.tgtype::integer & 8) <> 0)
          OR c.relname IN ('prep_recipe_access_history', 'recipe_item_history'));
  IF v_trig IS DISTINCT FROM c_want_trig THEN
    RAISE EXCEPTION 'FAIL    the triggers these deletes would fire are not the three expected. Found: %. Nothing deleted.', COALESCE(v_trig, 'none');
  END IF;
  PERFORM pg_temp.note('ok      the delete triggers are the three expected: the two recipe-line history triggers (no recipe line is deleted, so they write nothing) and the grant history (2 revokes); no trigger on either history table');
END
$do$;

-- ── Step 1: every listed row is still exactly as read, and nothing else hangs on it ──

DO $do$
DECLARE
  v_present integer;
  v_absent  integer;
  v_mode    text;
  v_first   boolean;
  v_bad     text;
  v_snap    jsonb;
  v_t       text;
  v_due     text := '';
  v_zero    integer := 0;
BEGIN
  -- Lock the 19 listed rows first, so none can change between its check here
  -- and its delete in Step 2. A save that touches one, or adds a charge, a
  -- menu line or a history line to a listed booking, waits for this file.
  PERFORM 1 FROM public.catering_events x0 WHERE x0.id = ANY (pg_temp.ids('booking')) FOR UPDATE;
  PERFORM 1 FROM public.catering_customers x0 WHERE x0.id = ANY (pg_temp.ids('customer')) FOR UPDATE;
  PERFORM 1 FROM public.catering_set_menus x0 WHERE x0.id = ANY (pg_temp.ids('set')) FOR UPDATE;
  PERFORM 1 FROM public.menus x0 WHERE x0.id = ANY (pg_temp.ids('menu')) FOR UPDATE;
  PERFORM 1 FROM public.ingredients x0 WHERE x0.id = ANY (pg_temp.ids('ingredient')) FOR UPDATE;
  PERFORM 1 FROM public.prep_recipes x0 WHERE x0.id = ANY (pg_temp.ids('prep')) FOR UPDATE;

  PERFORM pg_temp.t('B1 booking c87d2cbd (customer "aaa", event 2026-09-11)',
    pg_temp.booking_state('c87d2cbd-db18-4b9b-90d0-879249a8eeea', 'b14e9d04-0b78-4d86-aa47-80778a657727', '2026-09-11', 'inquiry', '2026-09-11T15:27:05.707574+00:00'));
  PERFORM pg_temp.t('B2 booking 5f117292 (customer "test", event 2026-09-14)',
    pg_temp.booking_state('5f117292-3bc5-44a4-9e58-38acb91455cd', 'da3c6ccd-2af9-4f8b-a8d4-2dc8cb0d9ee9', '2026-09-14', 'inquiry', '2026-09-12T14:21:05.423858+00:00'));
  PERFORM pg_temp.t('B3 booking 2a96a7a0 (customer "test_(คุณสำรวย)", event 2026-09-17)',
    pg_temp.booking_state('2a96a7a0-54d6-4c86-918e-2ee8bc7e88e1', 'ac0ba311-1880-4aa3-8943-f23329e1199f', '2026-09-17', 'confirmed', '2026-09-16T07:57:20.452457+00:00'));
  PERFORM pg_temp.t('C01 customer da3c6ccd "test"',
    pg_temp.customer_state('da3c6ccd-2af9-4f8b-a8d4-2dc8cb0d9ee9', 'test', '2026-09-12T14:21:05.325639+00:00'));
  PERFORM pg_temp.t('C02 customer b14e9d04 "aaa"',
    pg_temp.customer_state('b14e9d04-0b78-4d86-aa47-80778a657727', 'aaa', '2026-09-11T15:27:04.847383+00:00'));
  PERFORM pg_temp.t('C03 customer ac0ba311 "test_(คุณสำรวย)"',
    pg_temp.customer_state('ac0ba311-1880-4aa3-8943-f23329e1199f', 'test_(คุณสำรวย)', '2026-09-16T07:57:20.354176+00:00'));
  PERFORM pg_temp.t('C04 customer d6accdbb "aa"',
    pg_temp.customer_state('d6accdbb-fc84-40f1-887e-1b8a342fa62e', 'aa', '2026-08-24T06:15:24.786503+00:00'));
  PERFORM pg_temp.t('C05 customer 03bbb9a3 "ฟฟฟ"',
    pg_temp.customer_state('03bbb9a3-d0f9-4355-9f37-f70a65e3ac56', 'ฟฟฟ', '2026-08-23T16:18:02.639554+00:00'));
  PERFORM pg_temp.t('C06 customer f9c47af6 "กกกก"',
    pg_temp.customer_state('f9c47af6-4f3d-45a1-a90b-72344c80bfca', 'กกกก', '2026-08-23T16:17:29.457789+00:00'));
  PERFORM pg_temp.t('C07 customer 9f4a1a7e "aiatest"',
    pg_temp.customer_state('9f4a1a7e-f5dc-499a-886c-f9749d0e8a66', 'aiatest', '2026-08-26T07:15:25.776793+00:00'));
  PERFORM pg_temp.t('C08 customer 2717a5b6 "อู๋"',
    pg_temp.customer_state('2717a5b6-7dec-4936-9507-afa435b33c98', 'อู๋', '2026-08-26T06:48:15.964525+00:00'));
  PERFORM pg_temp.t('C09 customer 6bcbb6a8 "หห"',
    pg_temp.customer_state('6bcbb6a8-9b18-4503-83f9-ad8ecbb36e77', 'หห', '2026-09-06T02:59:58.753821+00:00'));
  PERFORM pg_temp.t('C10 customer 3c1ec050 "พี่ไก่"',
    pg_temp.customer_state('3c1ec050-f86b-4dd3-bffe-946b7d8a3c50', 'พี่ไก่', '2026-08-28T06:36:12.874527+00:00'));
  PERFORM pg_temp.t('C11 customer c79985f5 "สหกรณ์"',
    pg_temp.customer_state('c79985f5-243a-4e0e-b29e-3fa36e57566e', 'สหกรณ์', '2026-09-16T08:43:12.047866+00:00'));
  PERFORM pg_temp.t('C12 customer 82d3c81b "kureha"',
    pg_temp.customer_state('82d3c81b-ab71-423b-a59e-5a5554565723', 'kureha', '2026-08-26T07:17:01.878824+00:00'));
  PERFORM pg_temp.t('S1 shared set menu 7d9618cc "test1" (฿2500)',
    pg_temp.set_state('7d9618cc-7696-4a8c-b312-fea5bd10716f', 'test1', '2500', '2026-09-12T07:40:59.755431+00:00'));
  PERFORM pg_temp.t('M1 menu 0194ba9d "test" (฿0)',
    pg_temp.menu_state('0194ba9d-d673-478b-8b51-e7b010d21e67', 'test', '0', '2026-09-05T12:37:54.397692+00:00'));
  PERFORM pg_temp.t('I1 ingredient efae4608 "Test เตรียม" (the prep''s own ingredient row)',
    pg_temp.ingredient_state('efae4608-6c64-4115-a183-24cff34190db', 'Test เตรียม', '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5', '2026-07-13T10:21:19.01569+00:00'));
  PERFORM pg_temp.t('P1 prep 6af4c4cc "Test เตรียม"',
    pg_temp.prep_state('6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5', 'Test เตรียม', '2026-07-13T10:21:18.949469+00:00'));

  v_present := current_setting('test_data_cleanup.present')::integer;
  v_absent  := current_setting('test_data_cleanup.absent')::integer;
  IF v_present = 19 AND v_absent = 0 THEN
    v_mode := 'first run';
  ELSIF v_absent = 19 AND v_present = 0 THEN
    v_mode := 're-run';
  ELSE
    RAISE EXCEPTION 'FAIL    % of the 19 listed rows are there and % are already gone: the data changed after it was read. Nothing deleted.', v_present, v_absent;
  END IF;
  v_first := v_mode = 'first run';
  PERFORM set_config('test_data_cleanup.mode', v_mode, false);
  PERFORM pg_temp.note(CASE WHEN v_first
    THEN 'ok      first run: all 19 listed rows are present and exactly as read on 2026-09-22 19:06; they are deleted below'
    ELSE 'ok      re-run: all 19 listed rows are already deleted; this run deletes nothing' END);

  v_bad := pg_temp.kept_missing();
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL    rows Nik said to keep are missing: %. Nothing deleted.', v_bad;
  END IF;
  PERFORM set_config('test_data_cleanup.kept_booking', pg_temp.booking_md5('232a32c6-1232-4ae1-84c3-b77780a3f353'), false);
  PERFORM pg_temp.note('ok      the rows to keep are present: booking 232a32c6 (คุณป้อม) and its customer, customer พานาโซนิค, and the sets SET-3000, setโต๊ะพรีเมี่ยม and ชุดงานนอก 3000');

  v_bad := pg_temp.outside_refs();
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL    rows outside the list point at listed rows:% Nothing deleted.', v_bad;
  END IF;
  PERFORM pg_temp.note('ok      ' || current_setting('test_data_cleanup.fks')
    || ' foreign keys into the checked tables, read from the database: no row outside the list points at a listed row, so the deletes reach nothing else');

  -- Before: every checked table counted and fingerprinted. The rows due to go
  -- must be exactly the stated counts; nothing may be "new" yet.
  v_snap := pg_temp.snapshot();
  FOREACH v_t IN ARRAY pg_temp.checked_tables() LOOP
    IF (v_snap -> v_t ->> 'doomed')::bigint
       <> (CASE WHEN v_first THEN greatest(pg_temp.expected_fall(v_t), 0) ELSE 0 END)
       OR (v_snap -> v_t ->> 'new')::bigint <> 0 THEN
      RAISE EXCEPTION 'FAIL    % holds % listed rows (% new), expected %. Nothing deleted.',
        v_t, v_snap -> v_t ->> 'doomed', v_snap -> v_t ->> 'new',
        CASE WHEN v_first THEN greatest(pg_temp.expected_fall(v_t), 0) ELSE 0 END;
    END IF;
    IF (v_snap -> v_t ->> 'doomed')::bigint > 0 THEN
      v_due := v_due || pg_temp.label(v_t) || ' ' || (v_snap -> v_t ->> 'doomed') || ', ';
    ELSE
      v_zero := v_zero + 1;
    END IF;
  END LOOP;
  PERFORM set_config('test_data_cleanup.before', v_snap::text, false);
  PERFORM pg_temp.note(format('ok      %s tables counted and fingerprinted before deleting; rows due to go: %s%s other tables none',
    cardinality(pg_temp.checked_tables()), v_due, v_zero));
END
$do$;

-- ── Step 2: the deletes, by id, in Nik's order ─────────────────────────────

DO $do$
DECLARE
  v_first  boolean := current_setting('test_data_cleanup.mode') = 'first run';
  v_verb   text;
  v_tables text[];
  v_before jsonb;
BEGIN
  v_verb := CASE WHEN v_first THEN 'deleted by id' ELSE 'nothing left to delete' END;

  -- 1. The three bookings. Their charges, menu lines, copied courses, staff,
  --    labour, history and cost snapshot go by ON DELETE CASCADE.
  v_tables := ARRAY['catering_events', 'catering_event_charges', 'catering_event_menus', 'catering_event_menu_items',
                    'catering_event_staff', 'catering_event_labor', 'catering_event_activity_log', 'catering_event_cost_snapshots'];
  v_before := pg_temp.counts(v_tables);
  DELETE FROM public.catering_events WHERE id = ANY (pg_temp.ids('booking'));
  PERFORM pg_temp.note('ok      1 bookings ' || v_verb || ', with what cascades from them: '
    || pg_temp.step_report('1 bookings', v_tables, v_before, pg_temp.counts(v_tables), v_first));

  -- 2. The twelve customers. None has a booking left, so nothing is set to NULL
  --    (Step 3 proves it: every other booking row is byte for byte as before).
  v_tables := ARRAY['catering_customers'];
  v_before := pg_temp.counts(v_tables);
  DELETE FROM public.catering_customers WHERE id = ANY (pg_temp.ids('customer'));
  PERFORM pg_temp.note('ok      2 customers ' || v_verb || ': '
    || pg_temp.step_report('2 customers', v_tables, v_before, pg_temp.counts(v_tables), v_first));

  -- 3. The shared set menu test1. Its dishes go by ON DELETE CASCADE.
  v_tables := ARRAY['catering_set_menus', 'catering_set_menu_items'];
  v_before := pg_temp.counts(v_tables);
  DELETE FROM public.catering_set_menus WHERE id = ANY (pg_temp.ids('set'));
  PERFORM pg_temp.note('ok      3 set menu test1 ' || v_verb || ': '
    || pg_temp.step_report('3 set menu', v_tables, v_before, pg_temp.counts(v_tables), v_first));

  -- 4. The menu "test". Its SOP and the SOP's steps go by ON DELETE CASCADE;
  --    the step photos stay in the sop-photos bucket (Nik).
  v_tables := ARRAY['menus', 'menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes', 'menu_recipe_items', 'pos_sales_aliases'];
  v_before := pg_temp.counts(v_tables);
  DELETE FROM public.menus WHERE id = ANY (pg_temp.ids('menu'));
  PERFORM pg_temp.note('ok      4 menu "test" ' || v_verb || ': '
    || pg_temp.step_report('4 menu', v_tables, v_before, pg_temp.counts(v_tables), v_first));

  -- 5. The prep: its own ingredient row first, then the prep, whose 2 grants go
  --    by ON DELETE CASCADE and are logged as 2 revokes by the grant-history
  --    trigger.
  v_tables := ARRAY['ingredients', 'ingredient_price_history', 'station_ingredients', 'order_items', 'pos_price_aliases',
                    'template_items', 'prep_recipes', 'prep_recipe_items', 'prep_recipe_access', 'prep_recipe_access_history'];
  v_before := pg_temp.counts(v_tables);
  DELETE FROM public.ingredients WHERE id = ANY (pg_temp.ids('ingredient'));
  DELETE FROM public.prep_recipes WHERE id = ANY (pg_temp.ids('prep'));
  PERFORM pg_temp.note('ok      5 prep "Test เตรียม" and its ingredient row ' || v_verb || ': '
    || pg_temp.step_report('5 prep', v_tables, v_before, pg_temp.counts(v_tables), v_first));
END
$do$;

-- ── Step 3: exactly the stated rows went, and nothing else moved ───────────

DO $do$
DECLARE
  v_first    boolean := current_setting('test_data_cleanup.mode') = 'first run';
  v_before   jsonb := current_setting('test_data_cleanup.before')::jsonb;
  v_after    jsonb := pg_temp.snapshot();
  v_t        text;
  v_bad      text := '';
  v_moved    text := '';
  v_same     integer := 0;
  v_new      bigint;
  v_revokes  bigint;
  v_profiles uuid[];
  v_rows     bigint;
  -- Every row the file is supposed to emit, counted by hand and asserted
  -- below: Step 0 2, Step 1 19 row checks + 4, Step 2 5, and this step's 4
  -- before the count line. Change a line, change this.
  c_expected constant bigint := 34;
BEGIN
  -- Counts: each table fell by exactly the stated amount, and holds no listed row.
  FOREACH v_t IN ARRAY pg_temp.checked_tables() LOOP
    IF (v_after -> v_t ->> 'n')::bigint
       <> (v_before -> v_t ->> 'n')::bigint - (CASE WHEN v_first THEN pg_temp.expected_fall(v_t) ELSE 0 END) THEN
      v_bad := v_bad || format(' %s went from %s to %s;', v_t, v_before -> v_t ->> 'n', v_after -> v_t ->> 'n');
    END IF;
    IF (v_after -> v_t ->> 'doomed')::bigint <> 0 THEN
      v_bad := v_bad || format(' %s still holds %s listed rows;', v_t, v_after -> v_t ->> 'doomed');
    END IF;
    IF (v_after -> v_t ->> 'new')::bigint
       <> (CASE WHEN v_first AND v_t = 'prep_recipe_access_history' THEN 2 ELSE 0 END) THEN
      v_bad := v_bad || format(' %s gained %s rows;', v_t, v_after -> v_t ->> 'new');
    END IF;
    IF (v_after -> v_t ->> 'n') <> (v_before -> v_t ->> 'n') THEN
      v_moved := v_moved || format('%s %s to %s, ', pg_temp.label(v_t), v_before -> v_t ->> 'n', v_after -> v_t ->> 'n');
    ELSE
      v_same := v_same + 1;
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL    after the deletes:% Nothing deleted.', v_bad;
  END IF;
  PERFORM pg_temp.note(format('ok      row counts moved by exactly the stated amounts: %s%s other tables unchanged; no listed row remains',
    v_moved, v_same));

  -- Every row not on the list, in every checked table, byte for byte.
  FOREACH v_t IN ARRAY pg_temp.checked_tables() LOOP
    IF (v_after -> v_t ->> 'kept') IS DISTINCT FROM (v_before -> v_t ->> 'kept') THEN
      v_bad := v_bad || ' ' || v_t;
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'FAIL    a row not on the list changed in:%. Nothing deleted.', v_bad;
  END IF;
  PERFORM pg_temp.note(format('ok      every row not on the list, in all %s checked tables, is byte for byte as before (an md5 of each table''s other rows, before and after)',
    cardinality(pg_temp.checked_tables())));

  -- The booking to keep, with everything of its own.
  IF pg_temp.booking_md5('232a32c6-1232-4ae1-84c3-b77780a3f353') IS DISTINCT FROM current_setting('test_data_cleanup.kept_booking') THEN
    RAISE EXCEPTION 'FAIL    booking 232a32c6 (คุณป้อม) or something of its own changed. Nothing deleted.';
  END IF;
  PERFORM pg_temp.note('ok      booking 232a32c6 (คุณป้อม): the booking, its customer, charges, menu lines, copied courses, staff, labour and history lines are byte for byte as before');

  -- The grant history: the trigger's 2 revokes, and nothing else.
  SELECT count(*),
         count(*) FILTER (WHERE h.action = 'revoke' AND h.prep_recipe_id = '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5'
                            AND h.prep_recipe_name = 'Test เตรียม'),
         COALESCE(array_agg(h.profile_id ORDER BY h.profile_id), '{}'::uuid[])
    INTO v_new, v_revokes, v_profiles
    FROM public.prep_recipe_access_history h
   WHERE h.changed_at = now();
  IF v_first AND NOT (v_new = 2 AND v_revokes = 2
                      AND v_profiles = pg_temp.owned('grant', '6af4c4cc-00cd-4e65-ba0c-81ec5c54fdc5')) THEN
    RAISE EXCEPTION 'FAIL    the grant history holds % new lines (% of them the expected revokes of "Test เตรียม"), expected 2. Nothing deleted.', v_new, v_revokes;
  END IF;
  IF NOT v_first AND v_new <> 0 THEN
    RAISE EXCEPTION 'FAIL    a re-run wrote % grant-history lines. Nothing deleted.', v_new;
  END IF;
  PERFORM pg_temp.note(CASE WHEN v_first
    THEN 'ok      grant history: the trigger logged the 2 deleted grants of "Test เตรียม" as 2 revokes (เวช, เฮง), as expected; its 2 earlier lines are unchanged'
    ELSE 'ok      grant history: nothing written on a re-run' END);

  -- The file checks that its own checks reported (the 2026-09-19 lesson).
  v_rows := pg_temp.logged();
  IF v_rows <> c_expected THEN
    RAISE EXCEPTION
      'FAIL    the result table holds % rows, expected % — a block ran and reported nothing, or was skipped. Nothing deleted.',
      v_rows, c_expected;
  END IF;
  PERFORM pg_temp.note(format('ok      row count verified: %s evidence rows emitted, as expected (this line makes %s)',
    v_rows, v_rows + 1));
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

DROP FUNCTION IF EXISTS
  pg_temp.step_report(text, text[], jsonb, jsonb, boolean),
  pg_temp.counts(text[]),
  pg_temp.snapshot(),
  pg_temp.fingerprint(text),
  pg_temp.outside_refs(),
  pg_temp.booking_md5(uuid),
  pg_temp.kept_missing(),
  pg_temp.prep_state(uuid, text, timestamptz),
  pg_temp.ingredient_state(uuid, text, uuid, timestamptz),
  pg_temp.menu_state(uuid, text, numeric, timestamptz),
  pg_temp.set_state(uuid, text, numeric, timestamptz),
  pg_temp.customer_state(uuid, text, timestamptz),
  pg_temp.booking_state(uuid, uuid, date, text, timestamptz),
  pg_temp.t(text, text),
  pg_temp.label(text),
  pg_temp.expected_fall(text),
  pg_temp.new_where(text, text),
  pg_temp.doomed_where(text, text),
  pg_temp.checked_tables(),
  pg_temp.owned(text, uuid),
  pg_temp.ids(text),
  pg_temp.listed(),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- 1. จัดเลี้ยง, the booking list and the calendar: only คุณป้อม (18 Sep)
--    remains of the four bookings; the three listed ones are gone.
-- 2. The customer list: คุณป้อม and พานาโซนิค, nobody else.
-- 3. The set menus: SET-3000, setโต๊ะพรีเมี่ยม and ชุดงานนอก 3000; no test1.
-- 4. The menu list has no "test"; the prep list has no "Test เตรียม".
-- 5. Open คุณป้อม's booking: its lines, prices and history read as before.
