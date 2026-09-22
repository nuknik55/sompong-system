# Database migrations

Every `.sql` file the production database depends on lives in this directory or
in `migrations/`. **Nothing outside the repo.**

## Why that sentence is here

Until 2026-08-30, SQL lived in three places: this directory, and two untracked
sibling directories outside the git root (`restaurant-cost-system/supabase/` and
`restaurant-cost-system/migrations/`, 14 files between them). The repo root is
`app/`, so `git log` could not see either one.

The result was that nobody could tell what had been *written* from what had been
*run*, and three separate bugs traced back to it — code calling a schema object
that never existed:

- `app_settings` — `getQFactorPct()` silently returned a hardcoded 3
- `schedule_notes` — schedule notes appeared saved and vanished on reload
- `swap_supplier_order` — an RPC that never existed, so its unchecked fallback
  ran on every supplier reorder while looking like the handled path

All 14 files were moved in here. If you write a migration, it goes in this
directory, and it gets committed whether or not you have run it yet. Before
it goes to Nik it passes `node scripts/sqlcheck.mjs supabase/<file>.sql`, and
CI runs the same checks over every tracked migration (AGENTS.md, "The SQL
checker").

## Two numbering series — both historical

`migrations/` contains two independent series that were never reconciled:

| series | files | origin |
|---|---|---|
| `0001`–`0005` (four digits) | init, q_factor, price history, recipe history, POS aliases | the original schema |
| `004`–`012` (three digits) | SOP module, roles, owner guards, inventory orders, stations, maintenance, two-stage approval | added later, in the other directory |

They do not collide by filename and neither is a renumbering of the other. Left
as-is rather than renamed, because the numbers appear in commit messages and
`HANDOFF.md`. **Do not start a third series** — new files get a descriptive name
(`<feature>_migration.sql`) in this directory, as everything since 012 has.

## Applied status

Verified against production on 2026-08-31 by probing every table, column, view
and function declared across all 42 files.

**Applied: everything.** All tables, columns, views and functions declared
across the 42 files exist in production.

`app_settings` and `schedule_notes`, listed here as unapplied until
2026-08-31, have both landed. `purchase_cost` was widened to numeric(12,4)
and `menus.fuel_cost` was dropped on the same day.

### What that sweep could not see — policies

**"Applied: everything" was true of what it measured, and that is narrower
than it sounds.** The 2026-08-31 probe covered "every table, column, view and
function". **A POLICY IS NONE OF THOSE.** A migration that only drops and
creates RLS policies changes no structure, so it is invisible to a structural
probe — it would read as applied whether it had run or not, which is the
"absence that reads as an answer" failure this repo keeps rediscovering.

One file is in that class: **`costing_tables_rls_migration.sql`** (committed
`16d7104`, 2026-08-22), which narrows read and write on `ingredients`,
`prep_recipes`, `menu_recipe_items` and `prep_recipe_items`. It declares no
table, column, view or function at all.

**Verified applied 2026-09-15**, by Nik running
`SELECT policyname, cmd, qual FROM pg_policies WHERE tablename IN
('prep_recipes','prep_recipe_items')` — the authoritative source, which no
amount of reading the repo could substitute for:

| | live |
|---|---|
| SELECT | `owner, admin, editor, staff` (policies `prep_recipes_select`, `prep_recipe_items_select`) |
| write | `owner, admin` (`prep_recipes_write`, `prep_recipe_items_write`) |

So **sales and hr already cannot read any recipe or cost data**, and the
population the prep-visibility work restricts is the four editors and the
staff account — exactly the people who can reach the reverse index on
`/owner/ingredients`.

Before this was run, the honest state of knowledge was "unverified, and
unverifiable from here": the service-role key bypasses RLS, so querying with
it proves nothing about policies. Any future policy-only migration needs the
same treatment — a `pg_policies` read, by someone with a real session, named
and dated here.

### Applied since, with dates

| file | ran | effect |
|---|---|---|
| `pos_date_precision_migration.sql` | 2026-09-03 | Added `pos_receipt_deliveries.date_precision` (`day`/`month`) with its CHECK and index. Constraint verified live: rejects `'week'` with 23514. |
| `reset_catering_test_data.sql` | 2026-09-06 | Deleted all 8 test catering events and the 104 cascaded child rows; deleted the `catering_quote_sequences` row so the counter restarts at 1. Customers (9), set menus (3) and set menu items (14) kept. Ran clean — the exactly-8 guard did not fire. **One-off. Do not re-run:** it would delete whatever real events exist by then, and only the guard's count stands between it and that. |
| `fix_quote_number_column_comment.sql` | 2026-09-06 | Corrected the `quote_number` column comment, which still described the format as `QSP-IN{YYMM}` after the prefix became `IN`/`OUT`. Documentation only, safe to re-run. |
| `pos_coffee_items_migration.sql` | 2026-09-07 | Created `pos_coffee_items` (boolean is-coffee per product). Superseded before it ever held a row — see item 11 and `drop_pos_coffee_items_migration.sql`. |
| `pos_item_categories_migration.sql` | 2026-09-08 | Created `pos_item_categories` with the five-value category CHECK, the carve-out CHECK, and owner/admin RLS. |
| `pos_item_categories_souvenir_migration.sql` | 2026-09-08 | Widened the category CHECK to six values (`souvenir`); column comments on `category` and `reviewed_by`. Verified live by Nik: `pg_get_constraintdef` lists six values. |
| `seed_pos_item_categories.sql` | 2026-09-08 | **One-off.** 523 rows from Nik's August split, `reviewed_by IS NULL`. Verified live: 523/523. The file refuses to run on a non-empty table — do not re-seed; new products are classified on the screen. |
| `drop_pos_coffee_items_migration.sql` | 2026-09-08 | Dropped the empty orphan `pos_coffee_items`. Verified live: the table returns 404; `pos_item_categories` still holds 523. Closes queue item 11. |
| `coa_document_ui_created_accounts.sql` | 2026-09-09 | `description` on the ten CoA accounts created through the UI. Verified live: all ten documented, 23 described accounts in total. Sets no other column; every clause keyed on `code`. |
| `coa_add_225_870.sql` | 2026-09-10 | Added **225 โบนัส** (G200) and **870 Supply จัดเลี้ยง** (G800), documented at creation, placed by live-neighbour subquery. 870 not 850: the original migration had 870 as Supply - Catering before the row was deleted through the UI. Verified live: both exist. |
| `budget69_import_schema_rpc.sql` | 2026-09-10 | `budget69_imports` provenance (owner-only writes), partial unique index on `bill_ref LIKE 'B69-%'`, and `import_budget69_month`. Verified live by probing: refuses 650/752/753, refuses 790 from a caller without the owner role, refuses a group header, an unknown code, a zero amount and a malformed month — state unchanged after every probe. |
| `seed_pos_item_categories_catering.sql` | 2026-09-10 | 26 catering/set/buffet products → `food`, 15 beer-by-the-case and mixer items → `drink`, `reviewed_by NULL`. Verified live: 564 rows. 343 genuine dishes remained for the screen across Jan–Jul at that point; by evening the table held 633 and the Feb–Jun exports' union of unreviewed items was 228 (see the classification section). |
| `outsource_import_schema_rpc.sql` | 2026-09-10 | `outsource_imports` provenance (owner-only writes, `expenses_written` flag), partial unique index on `bill_ref LIKE 'OUT-%'`, and `import_outsource_month` — allowlist of 15 codes, `other` required, a budget69-owned month accepts `other` only. Nik reported success; the five refusal probes in the file's footer were not reported back. Verified live by use the same day: August wrote exactly 10 `OUT-` rows and `other` 20,793; Jan–Jul each wrote `other` only with `expenses_written = false`, so the budget69-month rule was exercised seven times in the accepting direction. The refusing direction (entries for an owned month) is exercised only by construction — the page never sends them. |
| `monthly_covers_migration.sql` | 2026-09-10 | `monthly_covers` (bills, customers, cancelled bills and amount per month, non-negative CHECKs, RLS as `pos_revenue_imports`); **drops the seven-parameter `import_pos_month` and creates the eight-parameter one** with `p_covers` required (NULL refused in the body; the DEFAULT NULL exists only so the old call shape fails readably). Nik reported success and did not run the probes. **Behaviour verified, catalog query unrun:** a seven-argument call — the shape the deployed app still sent at that moment — was refused with "covers are required" and wrote nothing; had the old overload survived, that call would have matched it and written a 2099-01 provenance row. The `pg_proc` one-function query in the file's footer has not been run. Then verified by use: July and August re-imported the same evening, each gaining its covers row with the six revenue types and the three POS entries byte-identical to before. |
| `coa_cost_behavior_excluded_migration.sql` | 2026-09-10 | `cost_behavior` CHECK widened to `fixed | variable | excluded`; a second CHECK forbids `excluded` on a group header; `998` set to `excluded`; column comment rewritten with the complete rule. Nik reported success. Verified live by reading the column: `998` is `excluded` and August's fixed total through the break-even function fell by exactly its ฿3,614. The header-refusal probe in the file's footer was not reported back. |
| `employees_takes_bookings_migration.sql` | 2026-09-11 | `employees.takes_bookings BOOLEAN NOT NULL DEFAULT false`; `catering_staff_options` recreated with the column. Nobody pre-ticked, deliberately — two employees share a nickname, so guessing risked flagging the wrong person. Nik ticked six the same day (ดาด้า, จอย, เปา, วุ้น, นิกกี้, ต้อม); the booking sheet's เบ้, เล็ก and เฮง are unticked, raised with him as a question, not a defect. |
| `drop_catering_task_completions_migration.sql` | 2026-09-11 | Dropped the 12-task sales checklist's table behind a zero-row guard; the guard did not fire. Verified live: the table is gone from the schema cache. Supersedes `catering_task_checklist_migration.sql` — never re-run that one. |
| `catering_set_menu_sections_migration.sql` | 2026-09-11 | `catering_set_menu_items.section` (`dish | dessert | drink | free`, DEFAULT `'dish'`) — A0 of the document work, the one schema change all three documents share. Verified live the same day: all 13 rows read `dish`, meaning unchanged; and end-to-end the next day, when Nik set a dessert and the section separated on the printed kitchen sheet. |
| `catering_event_deposit_percent_migration.sql` | 2026-09-12 | One nullable `NUMERIC(5,2)` + CHECK on `catering_events` — the agreed deposit TERM, beside `deposit_amount` which stays the received FACT. No default: both 30% and 50% are attested, so there was no neutral choice. Verified live by selecting the column before C deployed. The original CHECK excluded 0; superseded on that one point by the widening below. |
| `catering_rate_provenance_migration.sql` | 2026-09-12 | `catering_rates.display_label` (customer-facing name, NULL = fall back to the internal label) and `catering_event_charges.rate_id` (FK, ON DELETE SET NULL). One missing fact behind three symptoms — internal rate names on customer documents, the ดนตรี section reconstructed by label regex, ค่าไฟ unfillable. Verified live before the code deployed: both columns select, and charges with rate_id set = 0 — history was not given provenance it never had. Closes queue item 16. |
| `maintenance_resolver_name_migration.sql` | 2026-09-14 | `maintenance_reports.resolver_name TEXT` — who accepted or closed a report, denormalised at write time like `reporter_name`, because `profiles` is select-own under RLS and the list cannot read another user's name. Verified live before the code deployed, with a negative control first (a non-existent column is refused, HTTP 400, so the PASS below is not the API accepting anything): the column selects, and rows carrying a name = 0 — the three `done` rows keep `resolver_id` with no name and print "ไม่ระบุชื่อ", which is the truth of the data. |
| `prep_recipe_access_migration.sql` | 2026-09-15 | Step 1 of prep visibility: `prep_recipe_access` (composite PK, owner-only writes at the policy level), `can_see_prep()` with the owner arm reading the ROLE rather than a grant row, `prep_unit_costs()` as the SECURITY DEFINER cost channel, and the `recipe_item_history` policy replacing 0004's open `auth.uid() is not null`. Deliberately inert on the prep tables. Verified: 48 rows to an impersonated admin / 43 priced / 5 null, **zero rows to an impersonated sales session** (the negative control, run first), and the algebra proven against the shipped `resolveUnitCosts` before it was offered to be run. |
| `grant_prep_access_heng.sql` | 2026-09-15 | Granted เฮง all 48 preps. Both people resolved live (name + role), exactly-one assertions, `ON CONFLICT DO NOTHING`, and a postcondition rolling back unless he ended holding every prep. |
| `grant_prep_access_wetch.sql` | 2026-09-15 | Granted เวช (หัวหน้า prep) all 48. Identified by the TRIPLE login + full_name + role — the login lives in `auth.users.email` as `wetch2527@staff.local`, not in `profiles`, and name alone sat one row from the placeholder account "Editor / editor". |
| `prep_recipe_access_rls_migration.sql` | 2026-09-15 | Step 2: SELECT on `prep_recipes`/`prep_recipe_items` narrowed to `can_see_prep()`, writes to `role IN (owner,admin) AND can_see_prep()` with a WITH CHECK that omits the predicate so creation still works. Step 0 read `pg_policies` at run time and would have aborted on drift. **Verified by Nik, negative control first: an ungranted editor reads 0 recipes and 0 items; เฮง reads 48 and 248; an ungranted editor's direct UPDATE touches 0 rows.** Then the cost channel confirmed against a PRE-REGISTERED expectation — 48 / 43 priced / 5 null / sum 651.387003 / min 0.024527 / max 99.861334, all six matching figures published before the result was seen. No dish cost moved. |
| `provenance_triggers_migration.sql` | 2026-09-16 | Items 21+22. `touch_updated_at()` installed on the **16** tables carrying the column (a DO block asserts the column exists on each before creating anything, then asserts it made 16), and `prep_recipe_access_history` written by an AFTER INSERT/DELETE trigger with the recipe, person and actor names copied at write time. **Verified including the one check SQL cannot do:** the owner granted and revoked through the app, and both rows came back naming him — `grant · Test เตรียม · เฮง · Owner` and `revoke · … · Owner`. That was the whole question item 21 existed to answer, since `changed_by_name` NULL from an app write would have meant the trigger never sees the session. **Two behaviour notes: (a) a bulk migration now moves `updated_at` on every row it touches — a mass timestamp shift after some future backfill is this trigger working, not a defect; (b) the 8 call sites that already stamp `updated_at` by hand are redundant and were deliberately left, since the trigger overwrites with the same `now()`.** |
| `prep_owner_only_predicate_migration.sql` | 2026-09-16 | **The admin leak closed** (see the prep-visibility section). `is_owner_only()` added; `can_see_prep()`'s body replaced in place so the five policies calling it follow; `prep_recipe_access_select`/`_write` and `prep_recipe_access_history_select` recreated on it. `is_owner()` deliberately untouched. Step 0 read the live definitions and policies and would have aborted on drift; step 3 called the predicates AS all 11 profiles against all 48 preps before COMMIT and would have rolled everything back on one disagreement. **Verified at the app, in both directions; footer checks 1–7 were NOT run.** As `admin`, a new prep was created and the prep tab on `/owner/ingredients` (ของ prep) read 0; as owner, the same tab read 49. The section below says what that leaves unwitnessed. |
| `close_open_template_policies_migration.sql` | 2026-09-16 | **Anonymous access closed** on `day_swap_requests` (7 HR rows were readable with the public key and no login) and `pos_import_meta`. Both had a template policy named "owner can manage …" that was `USING (true)` for every role. Replaced by role-listed policies TO authenticated. Self-check before COMMIT: 6 policies, all bound to authenticated, RLS on. **Verified: the anonymous scan returns 0 of 63** (was 2); the service key still sees 7 and 1, which proves no data was lost but, since it bypasses RLS, not signed-in access (see "Anonymous access"). |
| `catering_event_type_migration.sql` | 2026-09-15 | `catering_event_types` (label UNIQUE, sort_order, is_active) + `catering_events.event_type_id` FK **ON DELETE RESTRICT**, seeded with Nik's five: งานบุญ, เลี้ยงพนักงาน, วันเกิด, เลี้ยงสัมมนาบริษัท, เลี้ยงรับรองลูกค้า. RESTRICT rather than SET NULL because there is no copied label to fall back on — see the file header. Nik reported success. |
| `permissions_batch_2026_09_17.sql` | 2026-09-17 | **Four parts.** A `profiles`: restrictive write policies, so an admin can no longer make itself owner, give the hr role, or touch the owner's, hr's or another admin's row. B `expense_entries` + `coa`: restrictive policies and `coa_is_open()`, so only the owner writes an owner-only account (790) or changes such an account; reads unchanged. C `pending_changes`: restrictive read and filing policies, four functions, and UPDATE narrowed to the four columns approval writes. D `sop-photos`: uploads by role and file name, no overwrite or delete through the API; reads stay public. **Verified by the file's own result table, which Nik pasted in full (168 rows):** every judged row ok (A1–A16, B1–B17, the 18-case prep-id check, C1–C19, "none of the 11 synthetic requests remains", D1–D14); no "PART D NOT APPLIED" and no "NOT DEMONSTRATED"; the survey rows list every new policy and none of the three old `sop photos auth …` write policies; `batch_log` count 0. The 15-row check query below was NOT run; that table is the evidence. **Its "before" rows already showed the closed state**, and the survey, which runs before any change, already listed the new policies, so the batch was already in place when this run began: an earlier run had applied it, and this one re-created the same objects, which the file is built to do safely. The first attempt had been cancelled before anything ran (the editor warned about a temporary table); the version that ran creates no table and changes no data. The five app checks at the end of the file are still Nik's to do. |
| `catering_sales_limits_migration.sql` | 2026-09-17 | **Queue item 33.** 18 restrictive policies and `catering_event_unlocked(uuid)`. Only owner and admin write set menus and their items. For everyone else a cost-locked booking's own row, menu lines and charges are read-only, and `cost_locked_at` stays empty on every booking row they write. The history is append-only through the API for every role, and a new line must name its caller and carry the time of its own insert. **Verified by the file's own result table, as Nik reported it: 138 rows** (the header's 130 plus the 8 surveyed policies); every judged row ok (S1–S15, L1–L34 with L25, the cascade test, counted by hand, and H1–H14) and no FAIL; the last row: nothing the tests wrote remains, counts unchanged (set menus 3, items 17, events 3, menu lines 11, charges 17, history 54). No booking was locked at run time. The survey rows and the three app checks at the end of the file were not reported. Not covered, by design: a locked booking's staff list, and two foreign-key actions (the file's header). Changed on one point by `catering_history_owner_edit_migration.sql` (applied the same day, below): the owner may correct and remove history lines. **Survey rows 5 and 6, pasted by Nik 2026-09-17:** `catering_event_cost_snapshots.catering_cost_snapshots_rw` and `catering_event_labor.catering_event_labor_rw` are both PERMISSIVE ALL TO authenticated, USING and WITH CHECK `role IN ('owner','admin')`. The labor policy matches `catering_event_labor_migration.sql`. The snapshot policy matches the untracked `COST_SNAPSHOT_SCHEMA_SQL.md`, NOT `catering_migration.sql`, which still admits sales: the repo drift item 33 supposed, now confirmed live (see item 33). |
| `catering_event_menu_items_migration.sql` | 2026-09-19 | **Queue item 39, catering per-event menus round 1.** `catering_event_menu_items` (RLS on; owner/admin/sales read, owner/admin write, the sales-limits lock shape restrictively on top), `catering_event_menus.set_name`, the one-target CHECK widened to allow a custom set, and `catering_copy_set_menu(uuid)` SECURITY DEFINER. **Verified by the file's own result table, as Nik ran it: 32 rows, every judged row ok** — X1–X2 (the harness proving its own refusal attribution, both directions), the four survey rows, C1–C4, R1–R2, W1–W7, S1, K1–K3, L1–L4, D1, every test write rolled back, counts unchanged (events 4, lines 12, charges 22, copies 0), RLS on, and the row-count assertion confirming 31 evidence rows. It took four runs to get there: three defects, each of which let the file report something other than what happened — see "Three ways a migration lied" below. **Production holds 4 pre-feature set lines with no copy**: they fall back to the shared set menu, exactly as every screen read them before this feature, until someone copies them on the menu page or the booking is locked (locking copies them first). |
| `catering_event_menu_save_migration.sql` | 2026-09-19 | **Queue item 39, catering per-event menus round 2.** `catering_save_event_menus(uuid, jsonb)` — the ONE save of a booking's own menu: every changed set line whole (its courses, THE price per table on the linked charge, a new custom set with its charge), in one transaction, SECURITY INVOKER. **Verified by the file's own result table, as Nik ran it: 30 rows, every judged row ok** — X1–X2, the survey, V1–V18, S1, L1–L2, every test write rolled back, counts unchanged (events 4, lines 15, charges 25, copies 7), and the row-count assertion confirming 29 evidence rows. First run, no failures. It refuses: a caller who is not owner or admin, a booking that does not exist, a cost-locked booking, a line of another booking or a single dish, a new set with no name or no tables, a new set named like a set line the booking already has, a negative price, the same dish twice, an invalid section (the table's CHECK), and a draft whose conflict token — the row ids and price the screen opened with — is stale. **Production holds 3 pre-feature set lines still falling back to the shared set menu**, and 7 stored copies. |
| `catering_history_owner_edit_migration.sql` | 2026-09-17 | **Item 33, follow-up B.** The two policies that refused every history update and delete replaced by two admitting the owner alone (`is_owner_only()`); UPDATE on `catering_event_activity_log` narrowed to `description` for anon and authenticated, so an edit through the app cannot change who wrote a line, when, its kind or its booking. Insert rule unchanged. **Verified by the file's own result table, as Nik reported it: 49 rows, all ok.** P1 after: authenticated may update `description` only, anon nothing. E1–E4 refused for sales and admin; E5–E10 (the owner touching any other column) error 42501; E11/E12 owner rows=1; I1–I5 as expected. Row 49: 54 history lines, checksum unchanged, no probe line left. **App check done by Nik, both directions:** before the run, the owner's edit showed "ทำไม่สำเร็จ — ไม่พบบรรทัดนี้…"; after it, the owner's edit saved. |
| `catering_booking_prices_save_migration.sql` | 2026-09-22 | **Queue item 47.** `catering_save_booking_prices(uuid, jsonb, jsonb, boolean)`, the booking screen's ONE save of a booking's price box: every line checked first; then, in one transaction, the menu lines the screen dropped removed (the history naming each), new ones added with the booking's own copy of a set, every charge rewritten at THE ONE PRICE, and the booking's `updated_at` (the screen's conflict token) moved. A dry run checks and writes nothing. SECURITY INVOKER. **Verified by the file's own result table, as Nik ran it: 46 rows, every judged row ok, first run** ("exists: f") — X1–X2, P1–P33, E1 (all 4 real bookings saved unchanged through the function, as sales and as owner), L1–L2, every test write rolled back, counts unchanged (bookings 4, lines 12, charges 22, copies 9, history 83, set menus 4) with every row byte for byte as before, and the row-count assertion confirming 45 evidence rows + its own = 46. **Nik accepted the file's deliberate break of the one-row-per-test-write rule** (AGENTS.md), which its header states. The code that calls it: `bb94d3a`, deployed the same day. |
| `blue_crab_curry_per_kilo_migration.sql` | 2026-09-21 | **ปูม้าใหญ่ผัดผงกะหรี่ moved to the kilo rule** (see "Dishes sold by weight"): `selling_price` 120.00 → 1200.00, its only recipe line ปูม้าเป็น 1 → 10 ขีด, and a new POS divisor `'ปูม้าใหญ่ผัดผงกะหรี่'` ÷10. **Verified by the file's own result table, as Nik reported it: 15 rows, all ok, first run** ("untouched: converting the three rows"). Nothing else changed: 255 menus, 1,852 recipe lines, 8 divisors, every other checksum equal. Owner and admin, each read as the real account, both read back `1200.00 \| 10.0000 \| 10.0000`, and the row-count assertion held (14 evidence rows + its own = 15). **Two after-effects, both expected:** `recipe_item_history` now holds a 1 → 10 line for 245624d1 with `changed_by` NULL, which is this file, not the quantity-box bug whose ×10 shape it has; and a sold count imported before the run was taken per ขีด, so the dish counts in kilos from the next POS import (it is not in the August file). Since `1b3b94d` the ÷10 also makes it print in kilos on the kitchen and service sheets. |
| `test_data_cleanup_migration.sql` | 2026-09-22 | **The test data Nik confirmed, deleted by id** (listed from a read-only production read, split into "clearly test" and "unsure", every row confirmed by Nik; see "The catering module is in informal use by sales"). Run as committed in `3243e1a`. The first commit of it, `3057c55`, failed at parse time and ran nothing: three PL/pgSQL `IF` conditions held a bare `CASE`, and PL/pgSQL ends an IF condition at the first `THEN` outside brackets, which was the CASE's own; the fix wrapped the three in parentheses, and a new check G in the SQL checker (`scripts/sqlcheck.mjs`, AGENTS.md) now flags that shape. **Verified by the file's own result table, as Nik ran it: 35 rows, all ok, first run** — all 19 listed rows present and exactly as read; 128 rows in the list; 33 foreign keys checked, none from outside the list. Deleted: bookings 3, charges 17, menu lines 11, staff 2, labour 8, history lines 54, customers 12, set menu 1 (test1) with 4 dishes, menu 1 ("test", ฿0) with its SOP and 10 steps, ingredient 1, prep 1 ("Test เตรียม"), access grants 2; grant history +2 (the two expected revokes, written by its trigger). Row counts after: bookings 1, charges 5, menu lines 1, history lines 29, customers 2, set menus 3, menus 256, preps 47. Every other row of the 30 checked tables byte for byte as before, booking 232a32c6 (คุณป้อม) with everything of its own byte for byte as before; the row count 34 + 1 = 35 verified. **Nik checked the app:** only คุณป้อม remains in the booking list, the set menus are right, and คุณป้อม's booking reads as before. Left in place, as Nik decided: the 8 step photos in the `sop-photos` bucket, the 4 approved SOP requests, the POS category row "test", the grant-history lines. |

### Three ways a migration lied, in one file, in one week

`catering_event_menu_items_migration.sql` took four runs to apply. It was
reviewed, checked and reported as ready before each of the first three, and
not one of the three defects was a permission bug or a logic error. Each was
a different way for the file to **report something other than what happened**.

| # | what it did | how it read |
|---|---|---|
| 1 | A survey probe named the table the file was about to create, with an `IF v_has` guard **inside the same statement**. PL/pgSQL plans a whole statement before evaluating anything in it, so the guard never ran. | `ERROR 42P01` on the first run. Loud, and the only one of the three that was. |
| 2 | The pattern that reads which table refused a write was patched in through a JavaScript template literal, where `\s` means `s`. It arrived as `(?:inserts+into|...)`, matched nothing, and left the table NULL. | Every refusal attributed to "a policy on another table". The negative control failed **for the wrong reason**, on a correct refusal. |
| 3 | The result rows were accumulated in a session setting written inside the block that always aborts. `set_config`'s third argument decides whether a value survives COMMIT, not ABORT, so the rows were rolled back with the test writes. | **8 rows of 31, no error, and the file applied on that showing** — twenty permission tests that had run and passed, with nothing to show for them. |

**The rule, which is one rule:** a migration must assert that its own checks
ran. Reviewing the checks is not enough — all three defects survived review,
and the third survived a run. The file now counts its result rows against a
declared constant before COMMIT (`pg_temp.logged()` against `c_expected`),
so a block that runs and reports nothing FAILS the file instead of passing
quietly. **And a static checker must tie its count to that runtime one:** the
check that was supposed to catch #3 counted emitting SITES in the source and
called that the row count. A site is not a row, and nothing connected the two,
so the checker agreed with itself while the run produced eight.

**What is automated now** (the checker lives beside this work, run over every
unapplied file):

| check | covers |
|---|---|
| **A** structure | dollar-quote tags balanced, one BEGIN/COMMIT, unique test labels |
| **B** `format()` arity | placeholders against arguments — a mismatch aborts mid-transaction |
| **C** parse-time references | **defect 1**: any object the file CREATEs, named in executable SQL before its own CREATE. `to_regclass`, `::regprocedure` and `information_schema` take the name as text and are exempt |
| **D** de-escaped regex | **defect 2**: a regex literal containing a bare `s+`, `w+` or `d+`, which is what an eaten `\s+` leaves behind |
| **E** doomed collector | **defect 3**: result lines written inside a block that always aborts, whose handler restores nothing |
| **F** declared row count | **the general rule**: the static count of emitting sites against the constant the file asserts at run time; and a file that asserts no count at all is itself the finding |

Each check was run against the file **as it failed** before being trusted: C
flags the two survey probes, D flags line 167, E flags all 24 lost rows, F
flags the absent assertion. All four are clean on the applied migrations, so
they are not crying wolf. The two older applied catering files do lack the
row-count assertion — they predate the rule, and they did print their
evidence.

The POS backfill has also run: `pos_receipt_deliveries` holds **24,451** rows
(22,805 `day`-precision from the original load, 1,646 `month`-precision
recovered from document numbers on 2026-09-03), spanning 2025-04-01 to
2026-09-01. 11 rows remain unparseable — repeated header artefacts.

### A read-only check for the permissions batch (not run on 2026-09-17)

Written 2026-09-17 from the names `permissions_batch_2026_09_17.sql`
creates, and kept for any later drift check: every row should say OK.
A is row 1; B is rows 2–4; C is rows 5–9; D is row 10 (its function) and
rows 11–13 (its policies); row 14 is the read policy the file leaves in
place; row 15 is the scratch table the first version would have created.

```sql
-- Read-only: is permissions_batch_2026_09_17.sql applied?
-- One row per check: what the file creates (expected) beside what the live
-- database holds (actual). Every row should say OK.
WITH pol AS (
  SELECT schemaname, tablename, policyname, permissive
    FROM pg_policies
   WHERE (schemaname = 'public' AND tablename IN ('profiles', 'expense_entries', 'coa', 'pending_changes'))
      OR (schemaname = 'storage' AND tablename = 'objects')
)
SELECT c.n, c.part, c.check_name, c.expected, c.actual,
       CASE WHEN c.actual = c.expected THEN 'OK' ELSE 'DIFFERENT' END AS verdict
  FROM (VALUES
    (1, 'A profiles', 'restrictive: profiles_scope_insert, _update, _delete', 3,
      (SELECT count(*) FROM pol
        WHERE tablename = 'profiles' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('profiles_scope_insert', 'profiles_scope_update', 'profiles_scope_delete'))::int),
    (2, 'B 790', 'restrictive: expense_open_accounts_insert, _update, _delete', 3,
      (SELECT count(*) FROM pol
        WHERE tablename = 'expense_entries' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('expense_open_accounts_insert', 'expense_open_accounts_update', 'expense_open_accounts_delete'))::int),
    (3, 'B 790', 'restrictive: coa_sensitive_owner_insert, _update, _delete', 3,
      (SELECT count(*) FROM pol
        WHERE tablename = 'coa' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('coa_sensitive_owner_insert', 'coa_sensitive_owner_update', 'coa_sensitive_owner_delete'))::int),
    (4, 'B 790', 'function coa_is_open(text)', 1,
      (SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('public.coa_is_open(text)'))::int),
    (5, 'C pending requests', 'restrictive: pending_prep_visibility, pending_editor_files', 2,
      (SELECT count(*) FROM pol
        WHERE tablename = 'pending_changes' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('pending_prep_visibility', 'pending_editor_files'))::int),
    (6, 'C pending requests', 'functions pending_change_prep_id, prep_recipe_exists, pending_change_visible, pending_change_fileable', 4,
      (SELECT count(*) FROM pg_proc WHERE oid IN (
         to_regprocedure('public.pending_change_prep_id(text, text, jsonb)'),
         to_regprocedure('public.prep_recipe_exists(uuid)'),
         to_regprocedure('public.pending_change_visible(text, text, jsonb)'),
         to_regprocedure('public.pending_change_fileable(text, text, jsonb)')))::int),
    (7, 'C pending requests', 'signed-in users hold UPDATE on the whole table (1 = yes)', 0,
      has_table_privilege('authenticated'::name, 'public.pending_changes', 'UPDATE')::int),
    (8, 'C pending requests', 'columns signed-in users may UPDATE (status, admin_note, resolved_at, resolved_by)', 4,
      (SELECT count(*) FROM pg_attribute a
        WHERE a.attrelid = 'public.pending_changes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND has_column_privilege('authenticated'::name, a.attrelid, a.attnum, 'UPDATE'))::int),
    (9, 'C pending requests', 'synthetic test requests left in the table', 0,
      (SELECT count(*) FROM public.pending_changes WHERE id::text LIKE 'c3100000-0000-4000-8000-%')::int),
    (10, 'D photo bucket', 'function sop_photo_upload_allowed(text)', 1,
      (SELECT count(*) FROM pg_proc WHERE oid = to_regprocedure('public.sop_photo_upload_allowed(text)'))::int),
    (11, 'D photo bucket', 'permissive: sop photos upload by role', 1,
      (SELECT count(*) FROM pol
        WHERE schemaname = 'storage' AND permissive = 'PERMISSIVE'
          AND policyname = 'sop photos upload by role')::int),
    (12, 'D photo bucket', 'restrictive: sop photos upload cap, no overwrite, no delete', 3,
      (SELECT count(*) FROM pol
        WHERE schemaname = 'storage' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('sop photos upload cap', 'sop photos no overwrite', 'sop photos no delete'))::int),
    (13, 'D photo bucket', 'old open write policies: sop photos auth upload, update, delete', 0,
      (SELECT count(*) FROM pol
        WHERE schemaname = 'storage'
          AND policyname IN ('sop photos auth upload', 'sop photos auth update', 'sop photos auth delete'))::int),
    (14, 'D photo bucket', 'read policy kept: sop photos public read', 1,
      (SELECT count(*) FROM pol WHERE schemaname = 'storage' AND policyname = 'sop photos public read')::int),
    (15, '-', 'tables named batch_log', 0,
      (SELECT count(*) FROM pg_class WHERE relname = 'batch_log')::int)
  ) AS c(n, part, check_name, expected, actual)
 ORDER BY c.n;
```
### Not applied

| file | waiting on | while it waits |
|---|---|---|
| `q_factor_owner_only_migration.sql` | HELD for the HR batch (items 23, 28), marked so in its first lines | The q-factor write policy admits admins; the screen and `updateQFactor` are owner only. |
| `catering_event_deposit_percent_zero_migration.sql` | Nik (he has it, 2026-09-12) | Widens the deposit CHECK to allow 0 = "agreed: no deposit". The deployed code does NOT wait for it: reads are unaffected, and the one exposure is someone deliberately typing 0 — the CHECK rejects, the event upsert fails FIRST in `saveBooking`, nothing partial is written, and the form shows the error. New bookings pre-fill 30, so 0 is never typed by accident. |

### The 125/126 boundary, recorded because 126's own entries cannot show it

  The 125/126 boundary is real and is as the names say — Nik confirmed:
  **125 is chicken eggs only; 126 is every other kind** (duck, salted, century).
  Both descriptions name the other account, because 126's own entries are all
  supplier-batch labels (`วัตถุดิบ (ไหน)`) that never say what was bought, so the
  description is the only thing that places a line.

### Two entries to review in the UI — not moved by any migration

Found while documenting 125/126. **Relocating a posted expense between COGS
accounts is Nik's call in the app, not a migration's**, so both are reported
and left alone.

- **2026-07-21 · ฿385 · currently in `130 ของแห้ง`** — the เยี่ยวม้า (century
  egg) half of the พี่สมหมาย bill. By the confirmed rule it belongs in
  `126 ไข่อื่นๆ`.
- **2026-07-22 · ฿40 · currently in `125 ไข่ไก่`** — note reads only
  `วัตถุดิบร้าน (ไหน)`. 126 holds thirteen entries with near-identical notes at
  ฿40–45 from the same supplier, so this one probably belongs there too. **Not
  verifiable from the note** — Nik would have to recognise it.

**A correction worth recording, because the wrong version was acted on
briefly.** An earlier pass reported that 125 contained a miscoded `เยี่ยวม้า
(1*385)` line. It does not. The พี่สมหมาย bill of 2026-07-21 was split into two
entries — ฿2,010 to 125 (exactly 15 × 134, the chicken eggs) and ฿385 to 130
(the century egg) — and **the full bill text was copied into both notes**. The
amounts were split correctly; only the note is shared. Reading an account's
contents from note text rather than from amounts is what produced the false
finding.

### Two hazards in files that have already run

Both stay as they are — an applied migration keeps describing what executed —
but re-running either would not do what it looks like it does.

- **`coa_description_migration.sql` matches on `name`, not `code`.** All ten of
  its clauses are `WHERE name = '...'`, and `name` is user-editable at
  `/owner/accounting/coa` while `code` is the primary key. Rename an account
  and that file silently stops matching it. Any new CoA migration keys on
  `code` — `coa_document_ui_created_accounts.sql` does.
- **`cost_behavior` NULL on an account means INHERIT, not exclude.** An account
  with NULL takes its group header's value; only NULL on a *group header*
  excludes a group from break-even (which is why G950 Tax and G990 CapEx are
  out). Consequence, recorded here because it will matter the moment the
  break-even view is built: **G900 is `fixed`, so `998 ร้านกาแฟ` inherits
  `fixed`** and would enter break-even as a restaurant fixed cost of roughly
  ฿3,600–4,100 a month — money laid out for the coffee shop and reimbursed.
  Excluding it needs a third behaviour value (the CHECK permits only
  `NULL | fixed | variable` today) or a group of its own. Decide it as part of
  the break-even work, not before.

  **Decided and applied 2026-09-10** (`coa_cost_behavior_excluded_migration.sql`):
  the third value exists, `998` is `excluded`, and a second CHECK forbids
  `excluded` on a group header, so the complete rule — NULL inherits the
  header, `excluded` is explicit and never inherited, a NULL header excludes
  the group — is a constraint. This supersedes the "cost_behavior
  deliberately not set" paragraph in the header of
  `coa_document_ui_created_accounts.sql`; that file stays as it ran.

### Removed rather than applied

`ot_rules` was declared in `hr_migration.sql`, never applied, and referenced by
no code. The declaration, its policies, its seed rows, and the matching policy
block in `hr_role_patch.sql` were deleted rather than run.

## The write-check rule is enforced locally, and CI runs it on every push

`local/no-unchecked-supabase-write` (in `eslint-rules/`) catches the class of
bug behind most of this file's history: a Supabase write whose error is
discarded. It is set to `"error"` in `eslint.config.mjs` and reports **zero**
violations today.

**Correction to the correction (2026-09-14).** The paragraph below claimed
"there is no CI at all — no `.github/workflows` directory". That was false
when it was written: `.github/workflows/ci.yml` has existed since `89ebd31`
(2026-09-06) and runs `npm run lint` + `npm test` on every push and PR. The
workflow's absence was asserted, in a commit about verification gaps, without
ever listing `.github/workflows` — check-the-authoritative-source, missed in
the one place it would have been most embarrassing. The paragraph stays as
written, because what it got right (green lint enforces nothing on its own)
is still the point; read its "no CI" sentence as struck.

**Correction to what this section used to say.** It claimed the rule was "not
CI-enforced" because lint was not green, which implied a CI gate existed and was
being held back. There is no CI at all — no `.github/workflows` directory, and
`lint` is not wired into `build`. The rule fires only when someone runs
`npm run lint` by hand. Green lint enforces nothing on its own; something has to
run it.

So there are two separate pieces of work, and — see the correction above —
both turn out to be done:

1. **Get `npm run lint` to exit 0.** DONE. All nine are fixed or documented;
   the run is 0 errors, 0 warnings.
2. **Add a workflow that runs it.** Existed all along — `89ebd31`, five days
   before this list first said "Not started". What the workflow does not do is
   put its red X in front of anyone who acts on it; that gap and its fix are
   queue item 2, closed below.

Do not add `--quiet` or lower the rule severity to get a green run.

### The `set-state-in-effect` problems

All nine are now resolved and `npm run lint` exits 0. Started at 9 across 7
components. They are **not** one repeated pattern — an
earlier note here called them all "the prop-resync pattern" and that was wrong.
They are five distinct shapes, each needing its own fix:

| shape | components | fix |
|---|---|---|
| reset paging on filter change | `category-filter-list`, `ingredient-manager` | move the reset into the handlers that change the filter |
| one-shot init from props | `OrderForm` | lazy `useState` initialiser |
| mirror a prop into state | `SetMenusClient` | render the prop; drop the mirror |
| async fetch into state | `catering/shared.tsx` | documented disable — the effect is correct |
| `localStorage` read on mount | `accounting/daily/receipt/ReceiptClient` | documented disable — cannot read storage during render under SSR |
| genuinely behaviour-changing | catering charges editor, daily accounting entry | one at a time, reviewed individually |

A property worth remembering, because it nearly bit during the
`ingredient-manager` fix: **the lint rule only confirms the effect is gone. It
has no opinion about whether the behaviour that effect provided was carried
over.** Patching the two obvious `onChange` handlers there would have passed
lint and silently regressed paging on the category-delete path.

## Gates a person runs — they cannot run in CI

CI runs `npm run lint` and `npm test`. Neither has database credentials, so
any check that needs live data is a gate a **person** runs, and it is written
here because a gate nobody can find is not a gate.

| gate | when to run it | what it proves |
|---|---|---|
| `scripts/verify-prep-unit-costs.mjs` | after `prep_recipe_access_migration.sql`, and after ANY change to `prep_unit_costs()` **or** to `rawUnitCost()`/`resolveUnitCosts()` in `src/lib/costing.ts` | the SQL cost channel and the TS resolver still agree on all 48 preps |

**Why that gate has to exist.** `prep_unit_costs()` re-implements the prep
nesting rule in SQL, and the app change that follows deletes the TS
prep-resolution branch so the hard part lives in one place. What still exists
twice is `rawUnitCost` — five lines of money arithmetic, in SQL and in
TypeScript. Nothing automatic can catch those two drifting apart, so this does,
and only if someone runs it. A green CI says nothing about it.

### The gate was broken by the very change it existed to guard

**A check nobody runs is not a check**, and this is the sharpest instance of
that in the repo. `scripts/verify-prep-unit-costs.mjs` was written calling
`resolveUnitCosts(ingredients, prepRecipes, prepItems)`. That signature
changed in `e34a530` — the commit the gate exists to guard — and the script
was not changed with it. `scripts/*.mjs` is outside `tsc`, outside eslint and
outside `npm test`, so **five consecutive green gates said nothing**, and it
surfaced only when a person finally ran it, days later.

**What would have caught it:** running the gate as part of the commit that
altered `resolveUnitCosts`'s signature — not later, not "before the next
release". A gate excluded from CI has exactly one moment where it is cheap to
verify, and that is inside the change that could break it.

Repairing it also exposed a second, quieter fault: after `e34a530` the
TypeScript side has **no prep implementation left** — `resolveUnitCosts` takes
the function's answer — so checking `prep_unit_costs()` against it would have
compared the function to itself and **passed for the wrong reason**. The gate
now imports the real `rawUnitCost` (the genuinely duplicated part) and
transcribes the nesting from the CTE in the script itself, which is
deliberately a second implementation because a differential test needs two
sides.

It proved itself on the first repaired run, flagging `ผักคะน้าฮ่องกง(กำ)` at
9.2121 against a captured 3.7323. The inputs were untouched, which left
`batch_yield_qty`, and solving backwards reproduced the old value exactly:
`8 × (95 ÷ 5.5) = 138.1818`, over `37.0230` is `3.732323641569246` to the last
digit, over `15` is `9.212121212121213`. Nik confirmed he had changed that
yield himself.

**The verification that closed step 2 was PRE-REGISTERED**, which is the shape
to copy when a result has to be read back from someone else: the six expected
figures (48 / 43 / 5 / sum 651.387003 / min 0.024527 / max 99.861334) were
published from the TypeScript side *before* the database result arrived, so
agreement could not be retrofitted to whatever came back.

## Queued work

In order. Nothing here is started unless it says so.

1. ~~Finish the `set-state-in-effect` fixes~~ — DONE.
2. ~~**Add a CI workflow that runs `npm run lint`.**~~ **CLOSED 2026-09-14 —
   the workflow already existed when this entry was written.**
   `.github/workflows/ci.yml` (`89ebd31`, 2026-09-06) has run `npm run lint`
   and `npm test` on every push and PR since before item 1 was finished. This
   entry asserted its absence, in a commit about verification gaps, without
   ever listing `.github/workflows` — check-the-authoritative-source, missed
   in the one place it would have been most embarrassing.

   **This item's own evidence, earned the hard way — now corrected, and the
   true version is more useful.** From 2026-09-10 to 2026-09-11
   `npm run lint` exited 1 for the whole repo. `d4abd73` deleted a 70-line
   function body from `scripts/seed-item-categories.mjs` and replaced it with
   an import, leaving the function's closing `}` behind — a syntax error,
   confirmed by `node --check` against the committed blobs (`bea8cf6` passes,
   `d4abd73` fails). This paragraph used to end: "the only thing that would
   have caught it the same day is the workflow that does not exist yet."
   Wrong twice over. The workflow existed, and it caught the brace **the same
   minute**: `d4abd73` was committed at 2026-09-10T12:30:59Z and its CI run
   concluded `failure` at 12:32:02Z, 63 seconds later. The red X and its
   notification email — addressed to the account that pushed, an inbox nobody
   watches for lint — went unread for a day, and every push on 2026-09-11
   inherited the red lint and failed CI too, regardless of its own content,
   until an unrelated change happened to run lint locally.

   **So the gap was never the missing gate; it was that the signal reached no
   one who would act on it.** A one-character regression really did survive a
   commit, a push and a production deploy — with a red X hanging on it the
   whole time. The fix adopted 2026-09-14: the deploy-verification loop also
   reads the CI run's conclusion (`actions/runs?head_sha=`; the rule lives in
   `AGENTS.md` beside the deploy-status rule), so every push reports two
   greens, and a red CI leads the report the way a failed deploy does. The
   upgrade to an actually-blocking gate (PRs + branch protection with
   "Include administrators") is documented in `ci.yml`'s own header —
   recorded, not adopted; a PR flow on a two-person push-to-main team is
   Nik's call.
3. ~~**The 5 unwired `isOwner`/`isCreator` signals** in `UNWIRED_FEATURES.md`.~~
   **CLOSED 2026-09-17. The entry was stale:** `UNWIRED_FEATURES.md` had
   resolved all six on 2026-08-31 and 2026-09-06 (`f8a007e`), and this entry
   was never updated.

   **Re-verified against the code of 2026-09-17** by a read-only sweep: all
   six resolutions HOLD. The `isCreator` fix still runs its
   creator-or-admin check before any write. Two places where that document
   and the code disagree, recorded in the document:
   - It records Nik's decision as **"no indicator"** that hidden accounts
     exist, but the code shows "มีรายการที่ไม่แสดง N รายการ" on the
     accounting entry screens, the daily entry, the summary, the P&L print
     and break-even. **Which is current is Nik's call.**
   - It names `getCoaForEntry` as the filtering reader. No such function
     exists; the reader is `getCoa()`.

   **A fresh sweep for the same shape found six live gaps** where the UI
   refuses something the server does not. Each was confirmed by a separate
   skeptic reading the code. They are recorded as item 29; one of them was
   fixed with item 27.

   Original entry: investigation first. For each, what it was evidently
   meant to gate and what wiring it would change, so the decision is
   informed rather than guessed.
4. **`ScheduleClient.tsx:5` static `xlsx` import** — bundle size only, no
   correctness stake. **Still open, and deliberately untouched**: that page is
   HR, which Nik has paused for a rebuild (2026-09-18), so it waits for the
   rebuild rather than being changed under it.

   ~~**Retry-from-here on POS chunk failure.**~~ **DONE 2026-09-18** on the
   POS side (`pos-price-import.tsx`). A delivery file goes up in chunks of
   2,000 rows, ~12 sequential calls for a full history; a failure on the
   eleventh meant sending all eleven again. The page now keeps the batch id
   and the row the failed chunk began at, and offers **ส่งต่อจากแถวที่ N**
   beside **เริ่มส่งใหม่ทั้งไฟล์**.
   - It resumes AT the chunk that failed, not after it. The ingest upserts on
     `(document_number, material_code)` with `ignoreDuplicates`, so a chunk
     that landed just before the connection broke is re-sent as a no-op —
     which is exactly the case a resume must not get wrong.
   - A thrown failure (connection, a deploy mid-run) resumes from the last
     chunk that ANSWERED; a returned refusal resumes from the chunk it
     refused, because the refusal may be about the batch rather than the row.
   - When every chunk is in and only the preview failed, the resume point is
     the end of the file, so the button reads **ลองดูราคาอีกครั้ง** and sends
     no chunk at all.
   - The resume point is dropped whenever the file or the parse changes: both
     numbers describe that file's rows.
   - **Unchanged:** one upload is still one `import_batch_id`, which a resume
     keeps (a full restart starts a new one). Nothing about the write, the
     validation or the preview moved.
5. ~~**Menu Engineering should classify within category, not across all menus.**~~
   **CLOSED 2026-09-16.** Raised by Nik, decided by Nik the same day.

   **THE HEADLINE, to tell Nik before he opens the new view: 81 of the 197
   dishes with sales change verdict** against the old ทั้งหมด view (and
   `/staff`'s sort). 74 are reclassified and 7 are now unranked.
   - Mix before: Star 32, Horse 28, Puzzle 69, Dog 68.
   - Mix after: Star 32, Horse 33, Puzzle 74, Dog 51, unranked 7.
   - Largest moves: Dog→Puzzle 26, Puzzle→Dog 15, Star→Horse 9,
     Horse→Star 8, Puzzle→Star 5.
   - The category TABS already ranked within their category, so a tab
     reader sees only the 7 unranked dishes change.

   These figures come from the shipped `classifyMenuEngineering` (old) and
   `classifyWithinCategory` (new), run on live data.

   **The worked case: ข้าวผัดเนื้อปูก้อน (ใหญ่), Horse → Star.**
   - The dish: price ฿270, cost ฿150.83, **profit ฿119.17 a plate**, 317 sold.
   - Globally it sat under the pooled profit bar of ฿165.08, so it read as
     "sells well, thin margin: reprice this".
   - Its own category's bar (อาหารจานเดียว) is ฿62.84. Its margin is
     **1.90× its category's average**, and it takes 12.32% of the category's
     sales against a popularity bar of 1.86%. It is a Star, and the old
     verdict was advice to damage one.

   **Nik's three decisions:**
   1. **A category with too few dishes is NOT ranked, and not pooled**; it
      shows ยังจัดอันดับไม่ได้ with the reason. Honesty over a forced
      verdict. The reason reads "หมวด … มีเมนูที่มียอดขาย N รายการ — ต้องมี
      อย่างน้อย 5 จึงจะจัดอันดับได้", distinct from "ยังไม่มียอดขาย", so a
      blank never reads as "no data".
   2. **The floor is 5 dishes WITH SALES** (`MIN_RANKABLE_GROUP`). The 7
      unranked:
      - ของหวาน (2): ข้าวเหนียวมะม่วง (เล็ก), 457 sold, the #3 seller overall
        and formerly a Horse; ขนมบ้าบิ่น (Dog).
      - จานร้อน หม้อไฟ (4): **ออส่วนจีน and ออส่วนสเปเชียล, both formerly
        Stars**; ออส่วนจีนทะเล (Puzzle); ซีฟู๊ดกระทะร้อน (Dog).
      - No category: `test`.
   3. **The ฿0 `test` menu will be deleted by Nik, from the app** (see
      below).

   **How it is built.**
   - `classifyWithinCategory` in `src/lib/costing.ts` groups by
     `menus.category` (a missing category is one group), ranks each group
     with the unchanged spreadsheet formula, and returns rows in input order
     with a typed `unrankedReason`. `unrankedReasonText` gives the one Thai
     sentence every screen uses.
   - `/owner` ranks ALL menus this way and the tab only filters, so a dish
     has one verdict on ทั้งหมด, on its tab and on `/staff`. On ทั้งหมด the
     chart note says colour is within-category and position is share of
     all sales. A tab below the floor shows why in an amber notice.
   - `/staff` (where the class only drives "sort by class") now ranks all
     menus. It used to rank only the dishes a staff member could see, so a
     staff member and the owner could get different verdicts.
   - The table, CSV and tooltip show the Thai label and the reason; the
     table showed the English class name before.
   - Seven tests, the first of which asserts that the same dish is a Horse
     in the global pool, so it proves the switch rather than assuming it.

   **Deleting the `test` menu: what Nik should expect.** It deletes cleanly
   from `/staff/menu/<id>`:
   - It has no recipe lines, no POS sales alias, and is in no catering set
     menu or booking. Those two references are ON DELETE RESTRICT and would
     have blocked it.
   - Its "1 sale" is only `last_period_qty_sold` on the row itself; no
     sales history points at it. If the POS still has a product called
     "test", the next sales import lists it as unmatched, which is
     harmless.
   - **It takes an SOP with it:** 10 steps, 8 with photos, built through 4
     approved requests on 2026-07-03. The cascade deletes the SOP and its
     steps. **The 8 photo files stay in the public `sop-photos` bucket,**
     still reachable by URL; nothing deletes them. If that SOP is a real
     dish's draft, Nik should look at it before deleting.
   - The approvals history keeps its 4 entries, labelled `test` from the
     stored request, and has no link to break.

   **The survey that decided it** (the premise first recorded here was
   wrong):

   **What the data says** (the survey used the real `classifyMenuEngineering`,
   `computeMenuCost` and `resolveUnitCosts` on live data):

   - **There are no drinks in `menus`.** 245 menus, 197 with sales, in 12
     named categories plus 2 that sold nothing (เมนูใหม่, เทศกาลเจ). The only
     dessert category, ของหวาน, has 2 dishes, one of them ข้าวเหนียวมะม่วง, the
     #3 seller. "Drinks lift the popularity average" cannot be happening.
   - **The category tabs on `/owner` already classified within their
     category** (before this change, `owner/page.tsx` classified only the
     visible subset). Only the ทั้งหมด tab, and `/staff` always, used one
     global pool.
   - **The real distortion in the global pool is PRICE TIER, not course.**
     The global profit bar is ฿165.08 a unit, while category bars run from
     ฿62.84 (อาหารจานเดียว) to ฿292.99 (ปู กั้ง). So 27 of 43 one-plate dishes
     are Dogs globally, against 8 within their own category. Across all
     categories **77 of 197 dishes change class** before the floor of 5;
     81 with it (see the headline above).
   - Small categories make the within-category bar meaningless: ของหวาน
     n=2, จานร้อน หม้อไฟ n=4.
   - One junk row: `test`, no category, price ฿0, 1 sold.
   - 0 catering-prefixed rows. `pos_item_categories` is the ACCOUNTING axis
     (coffee, souvenirs and so on), not a menu course, and the wrong
     grouping for this.


   The original entry, whose premise about drinks was wrong:

   Star / Plow Horse / Puzzle / Dog is currently computed against a single
   global average of popularity and margin, mixing food, drinks and desserts in
   one pool. Drinks sell on nearly every table at a lower margin per unit, which
   lifts the popularity average and pushes ordinary food dishes toward "sells
   poorly". Desserts sell far less than mains and would classify as Dogs almost
   by construction. Standard menu-engineering practice analyses within
   course/category, because an average is only meaningful among items that
   actually compete with each other.

   `menus` already carries a `category` column, so the data is probably there.
   **Start the investigation with the data, not the code:** what distinct values
   does `menus.category` hold, how many menus per category, and are those
   categories granular enough to be meaningful groups — or too granular, leaving
   categories of two or three items where an average means nothing. That answer
   decides whether this is a grouping change or needs a coarser
   course-level mapping first.

6. ~~Quote-number prefix is hardcoded to `IN`~~ — **DONE 2026-09-06.**

   `issueCateringQuote` now branches on `location_type`: `IN` for `in_house`,
   `OUT` for `offsite`, and it throws rather than defaulting if it ever sees
   another value. It also selects `location_type`, which it previously did not
   — the data needed to choose was not in scope of the function, which is why
   the hardcoded `IN` read as an omission rather than a decision.

   Nik chose a **shared counter per Buddhist YYMM**, both prefixes drawing from
   it, so `next_catering_quote_seq` kept its signature and no migration was
   needed. Numbers stay unique within a month; each prefix's own run has gaps.

   Verified in production: an offsite event issued `QSP-OUT6909-001`.

   The 5 pre-existing quotes (2 of them offsite and mislabelled `IN`) were all
   test data and were deleted by `reset_catering_test_data.sql` rather than
   renamed, which removed the retroactive-correction question entirely.

   **A quote number is frozen at issue and this is deliberate.** The prefix
   reflects `location_type` at issue time and is never recomputed: the branch
   sits inside `if (!quoteNumber)`, so a re-issue skips it and only bumps
   `quote_revision`. Changing an event from offsite to in-house afterwards
   correctly leaves `QSP-OUT...` in place — the number is a document reference
   printed on paper a customer holds, not a live status label. The same guard
   means a re-issue does not burn a sequence value. `issueCateringQuote` is the
   only writer of `quote_number` anywhere in `src/`; `upsertCateringEvent`
   never touches it.

7. **PayrollClient shows the previous period's data after switching periods.**
   **CONFIRMED BUG**, not started. Paused by Nik 2026-09-06 pending the
   accounting audit.

   This entry used to be a grep-level guess covering two components. It has now
   been investigated and the two split apart.

   **`PayrollClient.tsx:38` — real and reachable.** It mirrors `initialEntries`
   into state, the period switcher is `<button onClick={router.push(...)}>`
   (client-side, same route, different `?period=`), and the parent passes no
   `key`. So the component never remounts, `entries` keeps the previous
   period's rows, while the period pills and header — which read props directly
   — update correctly. Production has 2 payroll periods, so this path is live.

   The table is the least of it. `entries` also feeds `totalNet`/`totalGross`
   and **the xlsx export**, so the export writes the previous period's salary
   figures under the newly-selected period's name. A wrong number in a file
   that leaves the system is worse than a wrong number on screen.

   Fix is one line and the pattern is already used here: `key={selectedPeriodId}`
   on `<PayrollClient>`, exactly as `DailyEntryPage` does with `key={date}`.
   Removing the mirror instead is the WRONG trade — `handleCellSave` edits cells
   optimistically, and a server round-trip per cell on a spreadsheet-style grid
   would be worse than the bug.

   **Also found, separate decision:** `handleCellSave` writes state before
   awaiting the server with no rollback on failure, so a failed
   `upsertPayrollEntry` leaves the cell showing a value the database does not
   have. Same class as the old `SetMenusClient` toggle, on payroll figures.

   **`AccountingEntryClient.tsx:51` — NOT a bug, but fragile.** Same mirror, no
   stale data, because its month switcher is a plain
   `<a href="/owner/accounting?month=...">` rather than `<Link>` — a full
   browser navigation that unmounts the component and re-seeds the state. There
   is no `router.refresh()` in the file either. **Converting those two anchors
   to `<Link>` for a faster transition would silently create the PayrollClient
   bug.** Needs a comment saying so; no code change.

8. **POS-vs-accounting reconciliation.** Not started, deferred — but the
   CONSTRAINT below matters more than the item.

   The system records ingredient purchases twice, in `pos_receipt_deliveries`
   and in accounting `G100`, and nothing compares them. Measured 2026-09-06:

   | month | POS deliveries | accounting G100 | gap |
   |---|---:|---:|---:|
   | 2026-07 | ฿1,396,440 | ฿518,957 | −฿877,483 |
   | 2026-08 | ฿1,864,404 | ฿1,788,631 | −฿75,773 |
   | 2026-09 | ฿81,650 | ฿263,871 | +฿182,221 |

   **DO NOT build this as a monthly-total comparison.** The two sides cover
   different scopes by construction — see "What the accounting module is" above
   — so totals can never agree. A total-vs-total screen would show a permanent
   unexplained gap, and everyone would learn within a week to ignore it. That is
   worse than not building it.

   It must compare **only what flows through the same path**, which realistically
   means **per-vendor or per-account, and per-day rather than per-month**. That
   localises a discrepancy to something actionable instead of confirming one
   exists. Monthly totals are the blurriest possible view of this.

   Nik's hesitation was that the receiving screen is entered inconsistently, so
   he doubts the two sides can be compared. Worth recording the counter-argument
   because it is the reason to build it eventually: **if the POS side were
   reliable, a comparison would be pointless.** It is precisely because one side
   is unreliable that a comparison is the only way to find where. That is how
   the ฿4,320 mango and the 10x mussel error were found.

9. **The ฿20,000 CapEx rule exists nowhere in the system.** Not started.

   The restaurant has a written-down-nowhere rule: a newly purchased asset over
   ฿20,000 is coded to CapEx (`G990`). The bookkeeper coded a ฿29,853 vacuum
   sealer to `810 Supply ครัว` instead — the only miscode of its kind.

   **A naive amount threshold on the entry form would be actively harmful.**
   There are 17 entries ≥ ฿20,000 in the whole database and only one is
   miscoded; the rest are consulting fees, social security, vegetable oil, crab,
   and security-guard invoices. A hint firing on amount alone would be wrong 16
   times out of 17 and be dismissed reflexively within a week.

   The operative words in the rule are *newly purchased asset* — "asset" is the
   part a form cannot infer from a number. If a hint is built, scope it to
   non-food, non-payroll groups (realistically `G400`, `G800`), where it would
   have fired exactly once, correctly.

   Recording the rule somewhere visible matters more than the hint.

   **BUILT 2026-09-18 to Nik's answers, and it warns only.**
   - **The groups: `G400` ซ่อมบำรุง (Maintenance) and `G800` อุปกรณ์ (Supply)**,
     which is what "equipment and supplies" means in this chart of accounts —
     G800 is the literal one (Supply - ครัว/บริการ/บาร์น้ำ…, where the sealer
     was booked) and G400 is where equipment arrives as a repair or a
     replacement (`410 ค่าอุปกรณ์ซ่อม`, `430 ซื้อของเพื่อทดแทน`). Food (G100)
     is out by Nik's instruction; payroll, rent, utilities, marketing, G&A,
     delivery, misc and tax are out because a large amount there is ordinary.
     Of the 17 entries ≥ ฿20,000, these two groups hold exactly one: the
     sealer. The rule is `capex-hint.ts`, tested, and its first test is that
     entry.
   - **Warn only.** An amber note names the row and its amount and asks
     whether it is a new asset. Nothing is blocked, no button is disabled,
     nothing is reclassified, and the person answers by choosing an account.
   - **New and edited entries only** — the note is computed from what is
     being typed on บันทึกรายวัน and from the row open for editing. Saved
     entries are never revisited, and the monthly import is untouched (it is
     a machine path with no one to answer the question).
   - **The threshold is owner-set**, `app_settings.capex_threshold`, default
     20,000, on `/owner` beside the Q-factor — the only settings surface the
     app has, so nothing new was invented for it. An admin sees the figure
     greyed out; `updateCapexThreshold` is `requireOwner()`. **0 turns the
     question off**, said on screen.
   - A row's cash and transfer halves are added up first: they are one
     purchase split across two payment methods.
   - A negative amount never asks — returns and credits are entered that way.
   - **SQL: `capex_threshold_setting_migration.sql`** (one column, a CHECK,
     a comment; no table). **Not applied.**
   - **The gap it leaves:** `app_settings_owner_write` calls `is_owner()`,
     which admits admins, so an admin's direct API call reaches the column —
     as it reaches `q_factor_pct`. Item 23's held migration closes it for the
     whole table at once. The migration's test 5 reports which state is live.

10. ~~**`fetchAllRows` callers that order by a non-unique column.**~~
    **CLOSED 2026-09-16 (`ea9a251`). "Not currently biting" was wrong
    about the risk, but the figures recorded from it held — see the
    correction just below, which supersedes parts of this entry and of
    `ea9a251`'s commit message.**

    **CORRECTION, same day, after recomputing every recorded figure.**
    `ea9a251` and the first version of this entry claimed more than was
    proven:

    - **The August figures recorded on 2026-09-10 are CORRECT.**
      Recomputed from an ordered read, with getMonthlySummary's aggregation
      transcribed and the real `breakEven`, they reproduce to the satang:
      - operating expense 3,581,458.08 (92.3%), operating profit
        299,186.92 = **7.7%**, COGS 46.1%;
      - variable 2,055,097.69, fixed 1,522,746.39, excluded 63,883.60,
        margin 47.0%, **break-even 3,236,967.97 = 83.4%**, safety
        643,677.03, 2,244 bills.

      That match is also what validates the transcription. What Nik was
      told needs no correction.
    - **What the unordered read produces TODAY** (a replay of the exact
      query, run without RLS; the app runs as the owner, and RLS adds only
      an uncorrelated role check):
      - operating expense 3,538,811.77 (91.2%), profit 341,833.23 = 8.8%;
      - tax 0 instead of 30,139.60;
      - Marketing 6.6% (true 4.0%), G&A 3.3% (true 8.6%), Delivery & GP
        3.2% (true 1.7%);
      - break-even 3,074,630.57 = 79.2%, margin 42.9%, safety 806,014.43,
        2,132 bills.

      The ฿72,785.91 is the difference in all expense entries including
      tax. The operating difference is 42,646.31.
    - **When the page showed that is NOT established.** August has held
      1,003 entries since **2026-09-10 11:30 UTC** (the outsource import),
      not from 14:43 as first written: the POS import at 14:43 deleted and
      re-inserted 650/752/753 with the same amounts. Nik's 7.7% was read at
      11:41, over the limit, and was right. So the unordered read gave
      correct pages at least then, and gives wrong ones now. Which query
      plan the owner's page used on any day in between cannot be
      recovered. **Anyone who read an August P&L of about 8.8%, or saw no
      tax line for August, saw the defect.**
    - **The delivery read changed no ingredient cost.** The replay's
      doubled and lost rows are OT203 ค่าขนส่งวัตถุดิบ, which is on the
      non-food list and never priced; KI602, first named here, came from
      a replay that selected fewer columns and so took a different plan.
      Every one of the 108 prices written since that read was paged
      (`a36ae74`, 2026-09-02 12:24 UTC) was recomputed from the deliveries
      that existed at that moment, with the pricing code deployed then
      (taken from git). 106 match exactly. The other 2 have no POS
      deliveries at all and are manual edits: ขิงเส้น 0→105 on 09-12 and
      กะทิขวด 28→165 on 09-16.
    - **Other months:** only August 2026 has more than 1,000 entries (then
      September 435, July 390). July and September recompute identically
      both ways.

    **Enforced from 2026-09-16 by `src/lib/paged-reads.test.ts`**, in
    `npm test` and so in CI. It parses every file in `src` and fails when a
    `fetchAllRows` query does not end its ORDER BY on `id` (or the table's
    primary key), or when a `.range(` sits outside `fetchAllRows`. Its first
    tests are inputs it must flag. Run against the tree before `ea9a251`
    (`PAGED_READ_SCAN_ROOT`), it fails on exactly the eight reads fixed there.

    The rest of this entry as first written:

    **The premise below named the wrong two queries.** `ingredients.name`
    and `prep_recipes.name` are UNIQUE (`0001_init.sql`), so ordering by name
    was already total. The exposure was in calls this entry never listed:

    - **`getMonthlySummary` paged `expense_entries` with NO order at all.**
      August 2026 passed 1,000 entries at **2026-09-10 14:43 UTC**. From
      then on the page boundary returned 650, 752 and 753 twice and dropped
      790 (฿205,000), 951 and 952. The August P&L, its print/xlsx and the
      break-even page read **฿3,568,941.77 instead of ฿3,641,727.68,
      ฿72,785.91 short**: the same wrong figure on every load, and no error
      anywhere. Replayed read-only with the app's exact query; the
      replay ran without RLS while the app runs as the owner, so the
      owner's query plan may differ, but the fix is right either way.
      **Any August P&L printed or exported between then and `ea9a251`
      deploying is wrong for those six accounts**, and so are the August
      break-even figures in the break-even closure below.
    - **The price-import window** (4,079 deliveries ordered by material and
      date, 232 of them in tied groups) doubled 19 rows and lost 19 others,
      all of one material, KI602 เนื้อหมูสันใน.
    - The recent-entries list (date, created_at; an import writes hundreds
      of rows with one created_at) and the two recipe-item reads
      (menu_recipe_items is 1,801 rows; ordered by menu_id, sort_order, with
      no ties today only by luck) were exposed the same way and happened to
      read correctly.

    **All eight now end on `id`**, and `fetchAllRows`' comment states the
    rule. Checked on the parsed code with HEAD as the control: 8 of 12
    calls did not end on a unique key; now 0. The checker's first version
    missed `getMonthlySummary`, the actual defect, because a query with no
    ORDER BY compared `undefined === undefined` and passed. Replayed after
    the fix: 1,003 distinct August rows summing ฿3,641,727.68, and 4,079
    distinct deliveries.

    The original entry:

    `fetchAllRows` issues no `ORDER BY` of its own — it takes a query callback
    and pages it with `.range()`, so a deterministic sort is the caller's
    responsibility ([`src/lib/data.ts:27`](../src/lib/data.ts)). A ranged read
    without a total order can **skip or duplicate rows at page boundaries**,
    and the result looks like a partial read rather than an error — the same
    symptom as the 1,000-row cap, from a different cause.

    Two callers order by a column that is not unique:

    | caller | orders by | risk |
    |---|---|---|
    | `getIngredients` — `src/lib/data.ts:49` | `.order("name")` | two ingredients sharing a name have undefined relative order |
    | prep recipes — `src/lib/data.ts:57` | `.order("name")` | same |

    **Why it is not biting today:** both tables are under 1,000 rows, so
    `fetchAllRows` returns on its first page and no boundary is ever crossed.
    The defect only appears once a table crosses the page size, and then it
    appears silently.

    The fix is to order by the primary key, or to add it as a tiebreak after
    `name` where the display order matters. `pos_coffee_items` already does
    this correctly — it orders by `pos_product_name`, which is its PK.

    Found while reviewing the coffee-item paging fix in `dc0b798`; recorded
    rather than fixed because that round was scoped to one module and this
    touches shared data-access code used by the costing engine.

11. ~~**Drop the orphaned `pos_coffee_items` table.**~~ **DONE 2026-09-08.**
    The applied-migrations table recorded it that day ("Closes queue item
    11") and this entry was never updated. Re-checked 2026-09-16: the
    table answers PGRST205 (not in the schema), and no code in `src`
    references it. The original entry: File written
    (`drop_pos_coffee_items_migration.sql`), Nik to run. One line, but
    it needs to happen or an empty table with a misleading name lives forever.

    `pos_coffee_items` was created for a single boolean question — "is this item
    the coffee shop's?" — and the domain turned out to need five categories.
    It was replaced by `pos_item_categories`
    (`pos_item_categories_migration.sql`).

    **It was replaced rather than renamed on purpose.** Renaming plus widening
    would have been a rename AND four schema changes, which forces a choice
    between a window where deployed code points at a table that no longer
    exists, or code that tolerates both schemas in the revenue path. `RENAME`
    exists to preserve data and this table had ZERO rows, so creating the new
    one fresh removed the choice: additive migration first, deploy second, safe
    in both directions with nothing for anyone to remember.

    The cost of that decision is this orphan. Drop it once the deploy pointing
    at `pos_item_categories` is live:

    ```sql
    DROP TABLE IF EXISTS public.pos_coffee_items;
    ```

    **Check before running:** it must still have zero rows and no code
    references. If either is false, something started writing to the old table
    and that needs understanding first, not dropping.

    Can ride with any later migration batch. Recorded here because an empty
    table nobody remembers the purpose of is exactly the kind of thing that
    survives for years.

12. ~~Defect C — Server Action throws elsewhere in the app~~ —
    **CLOSED 2026-09-13**, five steps, one commit each: staff menu+prep
    (`cc5334c`), accounting (`5ae6f73`), the POS imports (`952180c`),
    the small files incl. coffee-items (`c338f0f`), HR (`0deaac0`).
    Catering was converted during the redesign and skipped here.

    THE TALLY, re-counted per step rather than trusted from this entry's
    own table (which was already stale by step 3 — the import redesign had
    added eight sites):

    | step | sites | converted | kept |
    |---|---:|---:|---:|
    | 1 staff menu+prep | 25 | 24 | 1 |
    | 2 accounting | 37 | 20 | 17 |
    | 3 POS imports | 27 | 25 | 2 |
    | 4 sop/staff/approve/settings/ingredients/coffee-items | 20 | 14 | 6 |
    | 5 HR | 26 | 25 | 1 |
    | **total** | **135** | **108** | **27** |

    THE KEPT-THROW CLASSES, each with its reason at the site:
    - page-load reads — a failed loader is the error boundary's job (16 in
      accounting + monthEnd, whose only callers are two such reads; the two
      alias-list reads; the two history reads; getScheduleWeek).
    - approve's run()/runReturning() — the throw IS the ordering guarantee
      that keeps a failed write from being recorded as approved; the
      exported action already catches into { error }. Converting them would
      have been the conversion defeating its own purpose.
    - a server-component <form action> with no client
      (toggleMenuStaffVisible) — a returned value would be silently
      dropped; the comment names the condition under which it converts.
    - tamper guards (coffee-items' isCategory) — input no user can produce;
      redaction is acceptable and the site says so.
    - the parser layer (parsePosSalesReport) — its messages are the
      parser's, converted there if ever, not in the action.
    The rule that decided every case: WHO SEES THE FAILURE, not "is it a
    throw".

    A FINDING IN ITS OWN RIGHT — the silent-failure family, EIGHT members,
    found only because the conversion forced every catch to be read. Worst
    first:
    - pos-price-import handleDeleteAlias: no handling at all AND the row
      vanished on failure — the screen contradicted the database.
    - duplicate-button: an editor's duplicate navigated to
      /staff/menu/__pending__, a 404 (also retired the __pending__ magic
      string).
    - SuppliersClient toggle, SopListClient delete, q-factor-setting,
      UsageItem qty, EmployeeDetailClient save, ReorderClient save: failures
      swallowed with no message; several showed success UI regardless.
    All eight fixed with the values the conversion made available; the
    pattern is UsageItem's — local state moves only on success, so the
    screen never contradicts the database.

    The HR clients use the okOrThrow adapter (hr-result.ts): their catches
    own optimistic-rollback logic, and a CLIENT-side throw is never
    redacted — only the server->client message was. The module comment
    carries the reasoning.

    Dead exports found along the way went to item 18 (the sweep).

13. ~~**Rename the `coffee-items` route to match its title.**~~ **CLOSED
    2026-09-18.** The route is `/owner/accounting/pos-item-categories`,
    named after the table it edits (`pos_item_categories`) and matching its
    title จัดหมวดสินค้า POS. The 2026-09-09 condition — only when that folder
    is open for another reason — was met: it was batched with three other
    small items.

    | where | what happened |
    |---|---|
    | `src/app/owner/accounting/coffee-items/` | `git mv`d whole, so the history follows: `page.tsx`, `actions.ts`, `categories.ts`, and `CoffeeItemsClient.tsx` → `PosItemCategoriesClient.tsx` |
    | `revalidatePath` in its own `actions.ts` | updated — the one that fails silently (a stale page, no error) |
    | the checklist step (`checklist.ts`), the accounting tool row, the link on the revenue import page | updated; those are every live pointer, and the nav link the old inventory expected on `accounting/page.tsx` is the tool row |
    | `next.config.ts` | redirects the old path, **307 not 308**: Nik has it bookmarked, and a permanent redirect is cached by the browser for good |
    | `scripts/seed-item-categories.mjs` (2) | updated — it generates that instruction text for any future run |
    | `supabase/seed_pos_item_categories.sql` (2) | **left alone, applied.** Both are a comment and a `RAISE EXCEPTION` message; neither is stored in the database |
    | the historical entries in this file and in AGENTS.md | left alone — they describe work done when the route had that name. The live-state mentions (the POS revenue table below, and AGENTS.md's file-input warning) are updated |

    **Checked for a stored path and found none**: no table comment, column
    default or row anywhere holds the route. The only database mentions are
    the two transient ones in the applied seed.

14. ~~**`/owner/ingredients` throws an RSC error on saving a NEW ingredient,
    but the save succeeds.**~~ **CLOSED 2026-09-16 without a root cause, on
    the evidence rather than on the clock** — the entry's own criterion was a
    month without recurrence and it has been one week. Closed deliberately:
    the code cannot settle it, the candidate that could be removed has been,
    and a recurrence now hands over its own digest. Reported 2026-09-09; has
    not recurred.

    **THE STALE-SERVER-ACTION-ID SHAPE DOES NOT FIT THIS, and ruling it out
    is the main thing this pass adds.** That shape was diagnosed on the prep
    grant screen, and the two reports look alike from outside: acted, screen
    said something odd, second attempt clean, both within minutes of a
    deploy. Two independent facts separate them:

    1. **The save SUCCEEDED.** A stale action id means the action never runs
       — the request is rejected before the body executes. Nik's ingredient
       was stored and appeared in the list, so the action ran and its id was
       valid.
    2. **The message is the wrong one.** "An error occurred in the Server
       Components render" is what Next.js shows when a SERVER COMPONENT
       RENDER throws. A rejected action call surfaces as a client-side
       promise rejection, which renders no such page.

    The lesson worth keeping: *once-only failure near a deploy* is a SYMPTOM
    CLASS, not a cause. Almost every transient produces it — a cold lambda, a
    network blip, a revalidation race, deploy skew — so matching two reports
    on that shape alone is matching on nothing.

    **What can now be ruled out that could not be when it was reported**,
    three changes, only the first of which was item-14 work:

    - `window.location.reload()` became `router.refresh()` inside the
      transition (`7a6697b`), removing the reload-fires-during-revalidation
      abort outright.
    - **`createIngredient` was converted by ITEM 12 to RETURN its failures.**
      At the time of the report it threw, so a thrown expected failure was a
      whole candidate class on this path. It no longer exists.
    - The handler has a try/catch (confirmed by item 20's sweep), so a
      client-side rejection now renders a Thai message rather than an error
      page.

    Taken together: **if the same trigger happened today, the visible outcome
    would differ for every candidate except a genuine throw inside the server
    render.** That remaining candidate is the one the code cannot see — a
    transient read failure during the RSC render after revalidation leaves no
    trace in source, only in the digest.

    **IF IT RECURS, what to send** (the error boundary from `9fe11e7` puts all
    of it on screen with one-tap copy, so Vercel is not needed):

    - the **digest** — the key to the real message in the logs
    - the **route** and the **time**
    - whether the ingredient still got saved
    - whether a deploy had just happened

    Without the digest there is nothing further to read: the structural
    investigation already found no throw on that path that fires once and not
    again, every read being identical on both attempts.

    The original report, kept because it is the only first-hand account:

    **Observed, exactly:**

    - Saving a **new** ingredient rendered *"An error occurred in the Server
      Components render. The specific message is omitted in production
      builds…"*
    - **The save SUCCEEDED.** The ingredient was stored and appears in the list
      normally.
    - A **second attempt showed no error at all.**

    **A hypothesis, to be confirmed and not assumed.** Succeeded-but-errored,
    plus a clean second attempt, is consistent with the throw being in the
    post-save re-render path rather than in the mutation, and with whatever
    triggered it being state-dependent. That is a starting point for the
    investigation, not a conclusion — two earlier hypotheses of exactly this
    shape (the coffee-items RSC error) were both dead on inspection, and the
    real cause was found only by reading the digest.

    **Start with the digest, not the code.** This is the same production
    redaction as item 12: the real message exists in the Vercel logs keyed by
    the digest shown to the user. Nik can fetch it when this work starts, and
    it turns a guess into a stack trace. Do not begin by reading
    `owner/ingredients` looking for likely-looking throws.

    Related but not the same: item 12 makes *expected* failures return values.
    This one is an *unexpected* throw, so it is a bug to find rather than a
    message to convert — though the redaction that hides it is the same
    problem.

    **Order agreed 2026-09-09: this is next after the import.** Nik fetches
    the digest from the Vercel logs; nothing starts until it is in hand.

    **2026-09-10, done without the digest, which never arrived — the work
    that makes it unnecessary next time.** (a) Error boundaries (`9fe11e7`):
    `error.tsx` at owner, staff and sop plus `global-error.tsx`, rendering the
    digest, route, time and message with one-tap copy, so the next
    occurrence hands over its key. (b) The post-save path (`7a6697b`): the
    structural investigation found no throw that fires once and not again
    in the server render — every read on the path is identical on both
    attempts — so the once-only failure has two candidates the code cannot
    distinguish: the client's `window.location.reload()` firing while the
    router was still applying the action's revalidation refresh (the only
    thing that differs between a first save and a later load), or a
    transient read failure on the first render after revalidation. The
    reload is replaced by `router.refresh()` inside the transition, which
    removes the first candidate outright; the hypothesis is recorded at the
    site, labelled as one. **Open only to close:** if the error recurs, the
    boundary gives the digest and candidate two is found in the logs; if a
    month passes without it, close this item.

15. **True catering cost — the catering flag on `menus`, and the prefixed
    catering dishes.** Not started, approved by Nik 2026-09-11.

    **Read this part first, because it is the reason the item is small:**

    **THE COST MECHANISM ALREADY EXISTS. Do not re-plan it.**
    `src/app/owner/catering/[id]/cost/page.tsx` already computes an event's
    food cost **from the booking, not from the till**: it reads the event's
    `catering_event_menus`, expands every `set_menu_id` through
    `catering_set_menu_items`, and sums `computeMenuCost(dish) × dishes-per-set
    × number-of-sets`. It has never read POS. So a cost figure exists for every
    event whether or not the till has dish lines, and it reflects what was
    quoted. `hasUnknownFoodCost` propagates from `computeMenuCost`, so an event
    containing a dish with no recipe reads as incomplete rather than quietly
    understated. The expansion loops over every row of the set, so the `free`
    section's rows enter the cost automatically — correct, since free items are
    free to the customer, not to the restaurant.

    **What is left is therefore data entry, not a mechanism**: recipes, by Nik
    and the kitchen. That is the long pole, and no code waits on it.

    **Why per-dish POS data is not the source, from Nik.** Staff ring only the
    table price, and the reason is not laziness or double-ringing — they do not
    double-ring, the till total would exceed what the customer pays. It is that
    **the food served often does not match the set**: guests change dishes per
    event, so the set in the system is not what went out, and nobody edits POS
    settings mid-service. Per-dish catering data from POS will stay sparse and
    unreliable however much is built, because the served menu is negotiated.
    POS stays useful where it lands; it is not the mechanism.

    **The work, in two pieces:**

    **(a) One boolean on `menus`, and one filter.** Catering dishes become
    ordinary `menus` rows named with Nik's existing POS prefix convention —
    `(จีน)ปลากะพง`, the same shape as `(Grab)` / `(LM)` / `(ห่อ)` — each with
    its own recipe and its own `selling_price`. No new table: the prefix does
    the separation, and `pos-parse.ts` already respects it (the stripper is a
    closed whitelist of exactly those three, verified by running it, and
    corroborated by the 8 parenthesised names that survive intact in
    `pos_item_categories`). A separate table was rejected because POS sales
    arrive as names and the sales importer matches `menus.name`; a flag alone
    was rejected because one row holds one recipe, and Nik says catering
    portions are sometimes a different size or recipe.

    The boolean is **stored, never derived from the name.** Deriving it would
    mean matching `name LIKE '(%'`, which already has seven false positives in
    the POS catalogue — six wine bottle numbers `(007)`…`(112)` and
    `(โปร) ขนมบ้าบิ่น 2 ชิ้น` — and would need the known-prefix list maintained
    in a second place. A stored fact does not break when someone edits a name.
    `menus.staff_visible` is the precedent: a boolean gating which surface a row
    appears on, filtered at `src/app/staff/page.tsx:16`.

    **Why it must be excluded from Menu Engineering, with the arithmetic —
    put this in the code comment beside the filter.** Both thresholds in
    `classifyMenuEngineering` (`src/lib/costing.ts:186`) are
    **population-relative**:

    ```
    popularity threshold = (100 / count of menus with sales) × 0.8
    profit threshold     = total profit / total qty        (sales-weighted)
    ```

    197 of 239 menus have sales today, so the bar is **0.406%**. Add ~40
    catering rows with sales and it falls to **0.338%** — a 17% drop applied to
    every à la carte dish, reclassifying ones near the Horse/Dog and
    Star/Puzzle boundaries **because of dishes served at a wedding**. The
    profit threshold is qty-weighted and barely moves; the popularity threshold
    is the damage. And the catering row is misread in the other direction: six
    portions at one wedding is 0.01% popularity, landing it in **Dog /
    ตัวถ่วง** — an argument to drop it from the à la carte menu, drawn from
    sales that were never on the à la carte menu. Menu Engineering asks whether
    a dish earns its place at table; catering qty is not evidence about that.

    **(b) The catering `menus` rows and their recipes.** Nik and the kitchen.
    Note that matching is **exact** on `menus.name`, with `pos_sales_aliases`
    as the only override — so `(จีน)ปลากะพง` receives POS qty only if a `menus`
    row is named exactly that. No fuzzy matching exists, and per the standing
    rule none will be built.

    **Related:** item 5 also changes `classifyMenuEngineering`. Whoever does
    either should read both — the flag narrows the population, item 5 changes
    what the population is averaged within.

16. ~~A `section` column on `catering_event_charges`~~ — **CLOSED 2026-09-12**,
    solved by `rate_id` rather than a section column
    (`catering_rate_provenance_migration.sql`): the charge now knows WHICH
    RATE it came from, which answers the section (rate_type -> section,
    structural), the customer label (display_label with fallback) and — in
    principle — ค่าไฟ, in one fact instead of three patches. The label regex
    in sectionForCharge survives only for pre-migration rows (rate_id NULL
    forever, by design) and dies with them. ค่าไฟ still prints a ruled line:
    identifying THE electricity rate among the music rates needs one more
    decision from Nik, and the field is fillable the day he wants it.

    While the booking screen is open, a charge's price-box section is known
    exactly — the row was added from that section's own rate picker. Nothing
    persists it, so `sectionForCharge` (in `booking-lines.ts` since
    2026-09-21, moved out of `BookingScreen.tsx`) reconstructs it
    from the stored charge, and for ดนตรี that means **a label match**:
    `charge_type` is `'other'` for music, `staff_bonus` and every typed
    อื่นๆ line alike, so the only thing separating them is whether the label
    contains ดนตรี, คาราโอเกะ or วง.

    `af825db` fixed the reachable half of this — the branch had tested
    `charge_type === 'service'`, which no rate ever produces, so every music
    charge from the rate picker reloaded into อื่นๆ and the ดนตรี section was
    unreachable. Measured on all 20 rates: 3 change section, exactly the three
    music rates, zero false positives.

    **What that commit did NOT fix, and cannot:** a music charge labelled with
    none of those three words still lands in อื่นๆ, and an อื่นๆ line someone
    names "ค่าวงดนตรี" lands in ดนตรี. Both are free text a person typed. The
    structural fix is one column holding the section the user actually chose,
    and then `sectionForCharge` reads it instead of guessing.

    Related: the service function sheet's **ค่าไฟ field can never be filled in
    automatically for the same reason** — the band's electricity is a `music`
    rate, so it lands in `'other'` with everything else and prints as a ruled
    line. One column would answer both. Worth raising with Nik as a single
    decision rather than two.

17. ~~**RatesSettingsClient mirrors `rates` into state and never resyncs —
    the reorder buttons show stale order until a full reload.**~~ **CLOSED
    2026-09-14.** The mirror is gone; the component renders from the prop and
    every mutation goes server action → `router.refresh()` → new prop, as
    SetMenusClient does. Done before Nik fills the six display_label words on
    that screen rather than after. Observed 2026-09-13 while adding the
    inline display_label field.

    The symptom was wider than "order-only": the add/edit modal only ever
    called `router.refresh()`, so by the same construction a newly added rate
    did not appear, and an edited one did not change, until a full reload —
    previously unreported. `useState(initialRates)` seeded once and ignored
    every later prop; the handlers that looked correct (delete, toggle,
    display_label) only did because they patched the mirror by hand.

    Dropping the mirror was the right candidate because it carried nothing
    the prop cannot: the inline drafts are their own state, the modal form
    its own. The one thing that needed care is the draft's lifetime across
    the refresh — React 19 does not treat a setState after an `await` as part
    of the transition unless it is wrapped, and an unwrapped clear would have
    shown the old stored value for one round-trip; the comment at the save
    site says so. Toggle also gained the try/catch delete already had: it
    used to patch the mirror whether or not the write succeeded.

18. ~~**Dead-export sweep of the "use server" files — three found so far.**~~
    **The three named below were removed on 2026-09-16 (`0635a99`), and
    this entry was not updated at the time.** `addExpenseEntry`'s
    fail-closed explanation was moved to the surviving
    `updateExpenseEntry` first; see AGENTS.md, "deleting dead code can
    take LIVE documentation".

    **The wider sweep, 2026-09-16: every "use server" file, parsed.** The
    scanner reads each file's exports and every import in `src`: static
    imports, re-exports, and `const { x } = await import(...)`. It was run
    first against `0635a99^`, where it had to list the three above, and did.
    On HEAD, 24 files, 208 exports, 9 imported nowhere:

    - **Deleted, four dead actions:** `updateCateringEventStatus` (the inline
      status control it served went in the booking-screen rebuild), and
      `getAttendancePunches` / `upsertAttendancePunch` /
      `deleteAttendancePunch` with their `AttendancePunch` type (the
      legacy punch input). **`getAttendancePunches` had no auth guard at
      all.** The `attendance_punches` table stays: it exists, holds 0 rows,
      and nothing reads it; dropping it is a separate, trivial migration if
      Nik wants it.
    - **Un-exported, five live helpers:** `upsertCateringEvent`,
      `saveCateringCharges`, `addCateringEventMenu`,
      `removeCateringEventMenu`, `issueCateringQuote`. They are the steps
      of `saveBooking` and are called only there, but as exports they were
      endpoints a sales session could call on their own, outside the
      order `saveBooking` relies on. Behaviour is unchanged;
      `saveBooking`'s comment says not to re-export them.

    After: 199 exports, 0 imported nowhere. None of the deleted names
    appears anywhere in `src`, `supabase` or `AGENTS.md`, comments
    included.

    Found by the item-12 conversions (steps 2 and 3), zero
    callers each:
    - `addExpenseEntry` (owner/accounting/actions.ts)
    - `listPosSalesAliases` and `deletePosSalesAlias` (sales-import-actions.ts).
      `deletePosSalesAlias` came back on 2026-09-21 WITH a caller — the
      divisors page, /owner/pos-divisors — and `upsertPosSalesAlias` became
      the insert-only `createPosSalesAlias`.
    A dead export in a "use server" file is not just clutter — every export
    there is a network-callable endpoint, so unused ones are attack and
    maintenance surface with no consumer to notice a behaviour change. All
    three were converted with their files (in scope, harmless), so the sweep
    deletes consistent code. Before deleting each: check nothing constructs
    the call dynamically — grep found no string references either, but say
    so in the removal commit. Steps 4 and 5 of item 12 may add to this list;
    sweep once at the end rather than per step.

19. **แจ้งซ่อม: push into the repair LINE group.** HELD — Nik's decision
    2026-09-14: in-app badge first, LINE later when convenient; not blocking.
    **Do not build until he says the OA exists.** Route decided: a LINE
    Official Account under his existing Business ID (one Business ID holds up
    to 100 OAs — no new email or phone), Messaging API enabled, the OA invited
    into the normal repair group like any member (not OpenChat). LINE Notify
    is discontinued, so this is the only route. `LINE_OA_SETUP.md` is his
    step-by-step in Thai, marked "when ready": part A (create the OA, enable
    the API, two values into Vercel, invite it into the group) can be done any
    time; part B waits for the app.

    What the app builds when he says go: a webhook route
    (`/api/line/webhook`, signature-verified with `LINE_CHANNEL_SECRET`) that,
    on the keyword `เชื่อมต่อ` from a group source, stores the group id in a
    settings row and replies `เชื่อมต่อแล้ว` — the group id is captured by the
    app, never copied by hand or through a third-party site. Then a push on
    create (photo, location, description, reporter, a link) and on done, so
    the reporter learns of it in LINE. **Failure to push must not fail the
    report** — log it, store the report, say in the UI that the alert did not
    send. Env: `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET`, never
    printed. Quota counts recipients (one push to five members is five
    messages; replies are free), so the group stays small.

20. ~~**A thrown Server Action is invisible in 46 of 120 client
    handlers.**~~ **CLOSED 2026-09-16.** A re-scan reports **0 of 101**
    `startTransition(async …)` blocks with an awaited action and no
    try/catch. Done per file in cost order, not as a sweep, across six
    commits: `83cc517` `cdb6bb6` `bdfdbfd` `8b3b547` `c9283d8` (and
    `211fcc4`, the prep grant screen, which prompted the whole item).

    **Four sites actually lied on a throw** — the tier-1 shape, state moved
    before the write with nothing to put it back:
    `stations/template` (remove, rename, drag-reorder, bulk-move),
    `inventory/template` (remove, reorder, add), `team-manager`'s role
    dropdown, and `TransferCostSettingsClient`'s active toggle.

    **THE TRIAGE TURNED UP THREE DEFECTS WORTH MORE THAN THE CATCHES THAT
    FOUND THEM**, none of which are missing-catch bugs at all:
    - `handleDragEnd` fired its write INSIDE a `setRows` updater. Updaters
      must be pure; React may call one more than once, and each call started
      another transition — **one drag could write the reorder twice**.
    - `handleRenameGroup` and `commitBulkMove` never reverted **even on a
      RETURNED error**: the server refused, the message appeared, and the
      change stayed on screen reading as applied. That is the false-success
      shape hiding behind the silent-failure one.
    - `TransferCostSettingsClient.handleToggleActive` had no handling of any
      kind and patched its mirror regardless.

    **Noted, not fixed:** `TransferCostSettingsClient` still mirrors `rates`
    into state the way `RatesSettingsClient` did before item 17 — the same
    hazard class, queued rather than folded in.

    **Item 12 was scoped to the SERVER side**: expected failures now RETURN a
    Thai message instead of throwing, because production redacts thrown
    Server Action messages. This is the CLIENT half, which was never in that
    scope. A returned error is handled everywhere; a THROWN one — a stale
    Server Action id after a deploy (a client bundle carries the action
    hashes of the build it was loaded from), a dropped connection, a redeploy
    while a tab sits open — rejects the `await` inside the transition, and
    without a catch nothing renders at all.

    **THE RULE THAT MAKES THE REST OF THIS TRIAGE FAST, and it is not the
    obvious one.** The first attempt ranked these by what each handler does
    AFTER the await — navigates away, sets "saved", clears the form — and was
    wrong. WHEN THE AWAIT THROWS, EVERYTHING AFTER IT IS SKIPPED: the handler
    cannot navigate, cannot claim success, cannot clear the form. So none of
    those can lie. **What survives a throw is only what was set BEFORE the
    write**, and that is what decides the cost:

    | tier | a silent failure means | n |
    |---|---|---|
    | 1 | state moved before the write — **the screen disagrees with the database** | 10 |
    | 2 | a flag set before the write never clears — a control sticks, silently | 22 |
    | 3 | nothing moves and nothing is said; the user retries blind | 12 |

    Rank a new site by asking only: *what did this set before the await, and
    what was supposed to undo it afterwards?* A `setBusy` whose reset sits
    after the await is tier 2 — the reset never runs, so the button reads
    "กำลังบันทึก…" for good, which is why every fix puts it in a `finally`.

    Tier 1 turned out to be almost entirely ORDER TEMPLATES, which is the
    stock domain reached by a different route — so the mechanism and the
    domain stakes agree on the order rather than competing.

    **Verify tier 1 by reading, not by trusting the classifier.** Doing so
    corrected it twice: `ingredient-manager`'s `UsageItem` is NOT tier 1
    (localQty moves only on success, so the row stays truthful and the
    item-12 comment there is accurate), and several "stuck" flags are merely
    `setError`, which is harmless.

    ORDER, approved 2026-09-16: stations template → staff inventory template →
    stock movements (SessionActions, ReceiveForm, OrderForm) → team-manager
    (access) → ApproveClient → the accounting imports → the singles.

    Done: `owner/stations/[id]/template/TemplateClient` (`83cc517`), which
    turned up two defects worth more than the catch that found them — a write
    fired inside a state updater, so one drag could reorder twice; and a
    rename and a bulk-move that never reverted even on a RETURNED error, so a
    refusal read as success.

    The split, 2026-09-15:

    - **8 shipped this session** — `MaintenanceForm`,
      `MaintenanceDetailClient` (×2), `RatesSettingsClient`, `ReorderClient`,
      `EmployeeDetailClient`, `q-factor-setting`, `ingredient-manager`.
    - **36 pre-existing**, concentrated in a few files:
      `owner/stations/[id]/template/TemplateClient` (7),
      `staff/inventory/template/TemplateClient` (7),
      `staff/inventory/[id]/SessionActions` (5), `team-manager` (5),
      the three accounting import clients (6), `ApproveClient` (2).
    - **2 already fixed** (`211fcc4`), on the prep grant screen, because
      migration 2 makes that screen the only tool for repairing access and a
      repair tool that fails silently is a locked door with no handle.

21. ~~**`prep_recipe_access` records grants and forgets revocations.**~~
    **CLOSED 2026-09-16** by `provenance_triggers_migration.sql`, together
    with item 22 — one decision about how provenance is recorded, in two
    places. Written by trigger rather than by application code because that
    is already the convention here (recipe_item_history, ingredient_price_history,
    both trigger-written, neither ever written by the app) and because a
    trigger cannot be bypassed: the two grant scripts wrote 96 rows without
    touching application code, and those were precisely the writes needed
    when เวช's ข้าวเหนียวมูน grant went missing. Names are COPIED at write
    time — 40 of recipe_item_history's rows already point at deleted
    accounts — and the table has no foreign keys, since a key to
    prep_recipes would cascade the history away with the recipe. Deleting a
    recipe cascades its grants, and the parent is gone by the time the child
    trigger fires, so the name falls back to the last one this table itself
    recorded; a cascade-revoke still reads as a sentence. Not backfilled, so
    the negative control stayed falsifiable.

    `granted_at` and `granted_by` exist, so a live grant carries its
    provenance — but a DELETE leaves nothing at all. When เวช's
    ข้าวเหนียวมูน grant was reported as succeeding and was absent an hour
    later, the question "did a row exist and get removed?" could only be
    answered from the ABSENCE of a fresh timestamp plus the absence of any
    mechanism that could have deleted one. **That is the second time this
    week an answer rested on absence of evidence rather than on a record**
    (the first: nothing logs reads, so who has already seen the prep recipes
    is unanswerable). This table gates the restaurant's core asset.

    Shape, on the `recipe_item_history` pattern that already works here: a
    `prep_recipe_access_history` table (action `grant | revoke`,
    `prep_recipe_id`, `profile_id`, `changed_by`, `changed_at`), written by a
    SECURITY DEFINER trigger on INSERT and DELETE of `prep_recipe_access`, so
    the record cannot be bypassed by whichever path does the writing — the
    grant screen, a SQL script, or a future bulk action. Owner-only SELECT.

    **Size, both options:**

    - **Migration only — one file, no app change, no deploy.** ~50 lines:
      table, trigger function, trigger, RLS. The history exists from that
      moment and the owner can query it. This is the whole of the value:
      the question becomes answerable.
    - **Plus a panel on the grant screen** — a loader and a history list per
      person or per recipe: roughly half a session on top, and only worth it
      if Nik would actually read it there rather than ask for a query.

    Recommend the migration alone first; the panel can follow if he asks for
    it twice.

22. ~~**`updatePrepYield` does not set `updated_at`, so a yield change
    leaves no timestamp.**~~ **CLOSED 2026-09-16** by
    `provenance_triggers_migration.sql`. NOT the one-line fix this entry
    first proposed: a scan found **58 `.update({` call sites in `src/`, of
    which 8 stamp `updated_at` and 50 do not**, across 27 tables. That is a
    missing mechanism rather than 50 edits, so a generic `touch_updated_at()`
    BEFORE UPDATE trigger went on the 16 tables that have the column — every
    future write is correct by default. **A bulk migration now moves
    `updated_at` on every row it touches**, which is correct semantics and
    is recorded here so a mass timestamp shift after some later backfill is
    read as the trigger working. The 8 hand-stamping sites were left alone:
    the trigger overwrites with the same `now()`, so they are redundant and
    harmless, and eight edits for zero behaviour change is not worth it.
    Found the hard way — dating ผักคะน้าฮ่องกง's 37.0230 → 15 required
    solving the arithmetic backwards.

    `prep_recipes` has `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — a
    DEFAULT, not a trigger — and `updatePrepYield` writes
    `{ batch_yield_qty, batch_yield_unit }` without touching it. So changing
    a batch yield, which changes the cost of every dish using that prep,
    records nothing about when it happened or by whom.

    It surfaced when `ผักคะน้าฮ่องกง(กำ)` was found to have moved 2.47×: the
    change could only be DATED BY SOLVING THE ARITHMETIC BACKWARDS (138.1818
    over 37.0230 reproduces the old value exactly), because the row's
    `updated_at` still read 08:00 that morning and was therefore useless as
    evidence. Same class as item 21 — an answer resting on inference rather
    than a record.

    The one-line fix is adding `updated_at: new Date().toISOString()` to that
    update, as the maintenance actions already do. **Worth checking the other
    write paths in the same pass**, since nothing enforces this repo-wide:
    a trigger on the tables that matter would be the durable answer, and is
    the same decision as item 21's.

23. **The q-factor write policy admits admins; the app says owner-only.**
    **Nik's answer, 2026-09-16: OWNER ONLY**, matching the screen. A
    migration was written the same day and committed HELD (`54e0f39`,
    `q_factor_owner_only_migration.sql`, with HELD in its first three
    lines): the policy moves to `is_owner_only()`, and its negative control
    is an admin's no-op update, which must touch 0 rows. It is
    **HELD to ride with the HR rebuild**: not urgent, since the screen already
    refuses admins. Same class as the prep leak, and pre-existing.

    **DECIDED BY NIK, 2026-09-18 — the gap stays as it is for now, and the
    file is NOT to be run early.** It rides with the HR rebuild as planned.
    **It is now a second setting behind the same gap:** `capex_threshold`
    (queue item 9) was added to `app_settings` on 2026-09-18, so an admin's
    direct PostgREST update reaches the CapEx warning's threshold as well as
    the q-factor. Both are refused on screen — `updateQFactor` and
    `updateCapexThreshold` are `requireOwner()`, and both inputs render
    read-only for an admin — and the exposure is an admin changing a number
    they are already trusted with, through an API call they would have to
    construct by hand. **When the held migration does run, one policy closes
    both**, because it is the table's write policy and not a column's.
    `capex_threshold_setting_migration.sql`'s test 5 prints which of the two
    states is live, so this does not have to be remembered.
    `0002_q_factor.sql`'s `app_settings_owner_write` is
    `USING (is_owner()) WITH CHECK (is_owner())`, and `is_owner()` has meant
    owner OR admin since `006`. `updateQFactor` is guarded by
    `requireOwner()`, so on screen only the owner can change it, but a
    direct PostgREST UPDATE from an admin's session succeeds. The q-factor
    multiplies every dish cost. **Size: one small migration** moving that
    policy to `is_owner_only()`, with an admin as the negative control and
    the owner as the positive. **One question for Nik first:** is the
    q-factor meant to be owner-only, or was `requireOwner()` stricter than
    he intended? If admins should change it, the fix is the guard, not the
    policy.

24. ~~**`createPrep` silently overwrites a live prep when the name
    matches.**~~ **CLOSED 2026-09-16, the same day it was found.** Only a
    TRUE orphan is reused now. The decision is `planPrepCreate`
    (`src/lib/prep-create.ts`), a pure function with 10 tests, the first
    named after the defect. "Orphan" comes from the schema:
    `ingredients.prep_recipe_id` is ON DELETE SET NULL, so a non-null value
    proves the prep exists even when RLS hides it from the caller.

    **Verified against live data with the real function** (read-only):
    - all 48 existing prep names are refused: `live_prep` for someone who can
      see the prep, `name_taken` for someone who cannot;
    - the old branch would have rewritten all 48;
    - all 378 raw ingredient names still get the raw-ingredient refusal.

    The lookups' errors are now checked. A failed lookup read as "nothing
    found" would have inserted a prep and then failed on the ingredient's
    UNIQUE name. **Confirmed in the app by Nik, 2026-09-16:** creating a
    prep named น้ำจิ้มซีฟู๊ด refused with the can-see message (มีของเตรียมชื่อ
    "…" อยู่แล้ว — ใช้ชื่ออื่น หรือเปิดสูตรเดิมเพื่อแก้ไข), and the existing
    recipe was untouched. That was the one part marked unconfirmed.

    **The same class, smaller, FOLDED IN the same day.** `duplicatePrep`
    and approving a `prep_create` did not check the name first. They
    inserted the prep, then the ingredient row, and a name already held by
    an ingredient failed the second insert. That left an ORPHAN prep plus
    an error, or a change stuck pending that no retry could approve. Both
    now check the name before any write, through one shared lookup
    (`lookupPrepName` in `src/lib/prep-name.ts`, with one set of refusal
    messages). The approval uses create mode; `duplicatePrep` uses a new
    COPY mode, where an orphan prep is refused (the copied items would land
    on its own) and an orphan ingredient is still relinked. Six more tests.
    Found while doing it: queue item 27.

    The original entry:

    The "reuse orphan" branch finds a `prep_recipes` row by name and updates
    its category and batch yield, then rewrites the matching `ingredients`
    row's category and usage unit. It never checks that either is an orphan.
    On 2026-09-16 there are **0 orphans**: all 48 preps have their ingredient
    row and every name matches. So every name match this branch can reach
    today is a LIVE prep, and 205 menus use at least one prep (296 recipe
    lines).

    Anyone who can see a prep (the owner; เฮง) who types its name into
    สร้างของ prep ใหม่ with the default yield of 1 กรัม replaces that prep's
    yield. That changes the cost of every dish using it, and they then land
    on the prep's page as though it were new. Only `updated_at` (item 22's
    trigger) records it; there is no yield history.

    Not exposed: editors, whose request becomes a `prep_create` whose insert
    refuses a taken name, and, since `bb4000f`, an admin who cannot see the
    prep (Thai name-taken message).

    **Size: small, one commit, no migration.** Reuse only a true orphan (a
    prep that no `ingredients` row points at), and relink only an `is_prep`
    ingredient whose recipe is missing. Every other name match refuses with
    มีของเตรียมชื่อนี้อยู่แล้ว. The decision is a pure function of the two
    lookups, so it can be extracted and unit-tested on four cases: no match,
    orphan prep, orphan ingredient, live match. About 30 lines plus tests.

25. ~~**HYPOTHESIS, not verified: `profiles`' own policies may explain how an
    admin manages `/owner/team`.**~~ **CLOSED 2026-09-17** by the Step 0
    survey of `permissions_batch_2026_09_17.sql`, rows 19–25 of the result
    table Nik pasted. **Seven live policies on `profiles`, recorded
    2026-09-17:**

    | policy | kind | to | rule | defined in |
    |---|---|---|---|---|
    | `auth_read_profiles` | PERMISSIVE SELECT | authenticated | USING `true` | **no file in the repo**; its name appears nowhere in it |
    | `owner_admin_delete_profiles` | PERMISSIVE DELETE | authenticated | USING `EXISTS (SELECT 1 FROM profiles p1 WHERE p1.id = auth.uid() AND p1.role IN ('owner','admin'))` | **no file in the repo**; only QUOTED, in a comment in `deleteUser()` (`src/app/owner/team/actions.ts`), and named in the comments of `profile_employee_link_migration.sql` |
    | `profiles_owner_write` | PERMISSIVE ALL | public | USING and WITH CHECK `is_owner()` | `migrations/0001_init.sql` |
    | `profiles_select_own` | PERMISSIVE SELECT | public | USING `id = auth.uid() OR is_owner()` | `migrations/0001_init.sql` |
    | `profiles_scope_delete`, `_insert`, `_update` | RESTRICTIVE | | part A | `permissions_batch_2026_09_17.sql` |

    What the two that no repo file creates mean:
    - **Every signed-in account reads every profile** (name, role and
      employee link) through `auth_read_profiles`, whatever
      `profiles_select_own` says; that policy alone would limit a
      non-admin to its own row. Wider than the repo showed; not changed.
    - **An admin may delete profiles** through `owner_admin_delete_profiles`
      (and through `profiles_owner_write`, since `is_owner()` admits
      admins). Part A's restrictive `profiles_scope_delete` caps both, and
      A1–A16 passed live as the real accounts, so the effective write rule
      is the tested one.

    The entry as first written: **Not started.**
    `profile_employee_link_migration.sql` recorded a puzzle: the only
    `profiles` policies in the repo are `id = auth.uid() OR is_owner()`
    (select) and `is_owner()` (write), described there as owner-only, yet a
    non-owner admin lists, updates and deletes users, so the live database
    "almost certainly" carries uncommitted policies. Since `is_owner()`
    admits admins, those two policies alone may explain it. `deleteUser()`
    documents an `owner_admin_delete_profiles` policy, which is a separate
    question. **Size: one `pg_policies` read for `profiles`, which Nik
    runs**, then this entry updated; no code unless the read finds something.
    Worth settling because `getPrepAccessBoard` and every admin screen rest
    on what `profiles` returns to an admin.

    **2026-09-17: the write half no longer waits on this.** Part A of
    `permissions_batch_2026_09_17.sql` adds RESTRICTIVE policies, which
    cap whatever permissive ones exist live, so an unknown policy cannot
    reopen what it narrows. Its Step 0 prints every live `profiles`
    policy, so running it also answers this entry. It ran on 2026-09-17,
    and the rows were read back the same day (above).
    What the repo's two
    policies allow is worse than this entry supposed: see item 29.

26. ~~**A question for Nik: delete `/owner/catering/status`, or link it?**~~
    **CLOSED 2026-09-17:** Nik kept it. สถานะ is back on the catering sub-nav
    (`1e3ab8e`), after ปฏิทิน, for every role that sees the nav: every page
    that renders it is `requireSales` or `requireAdmin`, and the status page
    is `requireSales`. The question as first written: nothing linked to it
    since it was deliberately taken off the sub-nav, because the booking
    list already filters by status, so deletion was the likelier answer.

27. ~~**An editor's DUPLICATE is approved as an EMPTY recipe.**~~ **CLOSED
    2026-09-17.** Found 2026-09-16.

    **What approving a duplicate does now** (`approveChange`):
    - It copies the original the way the admin paths do. A menu gets its
      recipe lines. A prep gets the original's CURRENT yield, unit and
      note, its ingredient row's usage unit, and its lines. Everything is
      read before any write, and a deleted original is refused.
    - A prep duplicate's name is planned in COPY mode, so an orphan prep
      holding the name is refused.
    - The approval card says the copy uses the original's lines, and for a
      prep its yield, as they are at approval time. It no longer shows the
      yield saved in the request.

    **Visibility, closing item 29 #6.**
    - `approveChange` AND `rejectChange` now refuse any request the queue
      hides, using the same `prepIdOfChange`. Before, a hidden request
      could still be approved: RLS turned its writes into no-ops and the
      change was marked APPROVED.
    - `prepIdOfChange` now maps a prep duplicate to its SOURCE, since
      approving it copies the source.
    - The header badge counts only what the queue shows, and never
      throws.

    **Retry-safe.** Before, a transient failure between two writes left a
    half-made copy (food cost 0) that no retry could finish, because the
    name was then taken. Now:
    - The created row's id is derived from the change id by SHA-256
      (`approvalRowId`, `src/lib/approval-id.ts`, with tests). It is NOT
      the raw change id: `pending_changes`' insert policy checks only
      `editor_id`, so a caller can choose the id. A forged id equal to an
      existing menu's or prep's would have made that row look like the
      approval's own work, and the copied lines would have landed in it.
    - A retry finds its own row and finishes the job. A prep hidden from
      an admin is found through `prep_unit_costs()` rather than by reading
      error text. Lines are counted before they are copied. An approver
      who cannot see the new prep to count its lines is told to have the
      owner approve again.

    **Found by two adversarial review rounds** (three lenses each, a
    refuter per finding):
    - round 1: the retry deadlock and the guard gap;
    - round 2: the forgeable id, the orphan-reuse limit below, and the
      table read policy (item 31).

    **Known limits, accepted:**
    - (a) An approval that TOOK OVER an orphan prep cannot resume once its
      ingredient row is linked; there are 0 orphan preps.
    - (b) Two overlapping approvals of the same duplicate can both copy
      the lines. The status check is not atomic, which was already true
      of every change type.
    - (c) If the original is deleted between a failed attempt and its
      retry, the retry refuses, and the partial copy stays for the owner to
      remove.

    **Not witnessed in the app:** none of the requests on record carries
    `duplicatedFrom`.

    The original entry, found 2026-09-16: When an editor duplicates a menu or a prep, the
    request is saved as `menu_create` / `prep_create` with
    `duplicatedFrom`, and `approveChange` ignores that field: it creates
    the header (and, for a prep, the ingredient row) but copies none of
    the original's recipe lines. The editor believes they copied a recipe,
    and the approver sees nothing wrong. **Size: small, one commit, no
    migration.** Copy the lines from `duplicatedFrom` on approval, the way
    the admin paths already do; for a prep, only if the APPROVER may see
    the original (`canSeePrep`), since copying is reading. **Nothing has hit
    it yet:** none of the pending changes on record carries `duplicatedFrom`,
    and editors' requests last came on 2026-08-22.

28. **Exported server actions with NO auth guard: 24 reads, 22 of them HR,
    with RLS as their only layer.** Found 2026-09-16. **HELD for the HR
    rebuild** (Nik, 2026-09-16): HR is not in use yet, and the module will
    be rebuilt and audited as a whole rather than fixed piecemeal. Held with
    it: the guards, the guard scan as a CI test, the live HR access check
    recorded at the end of this entry, and the q-factor migration (item
    23). NOT held: the anonymous hole in `day_swap_requests` (see
    "Anonymous access" below).

    **`getAttendancePunches` had no guard at all.** It was a
    network-callable endpoint that any signed-in session could call, and it
    was removed (`570f331`) because it was DEAD, not because anyone noticed
    the guard was missing. So the rest were scanned.

    **The scan** parses every "use server" export and counts as guarded any
    function that calls `require*()` or `getCurrentProfile()`, directly or
    through a helper in the same file. Run first on the tree before
    `570f331`, where it listed `getAttendancePunches`. Of the 199 exports
    left, 26 have no guard on any path:

    - `login` and `logout`, correctly;
    - `getCateringEventTypes` and `getPosImportMeta`;
    - **22 reads in `owner/hr/actions.ts`**, among them `getEmployees`,
      `getEmployee`, `getPayrollEntries`, `getEmployeePayrollHistory`,
      `getPayrollPeriods` and `getLeaveQuotas`.

    A page's own guard does not cover these: an export is callable without
    the page. **What protects them is RLS alone.** `hr_role_patch.sql`
    limits `payroll_*` to owner and hr by an explicit role list (not
    `is_owner()`), and `employees` to hr plus admin read, and the
    2026-07-31 HR audit recorded that as checked. It has not been
    re-verified live since. That is the one-layer arrangement the prep leak
    showed to be fragile, on salary data.

    **Size: small, in two parts.**
    (a) Nik runs one `pg_policies` read for the HR tables and a negative
    control (the sales account reading `payroll_entries` must get 0):
    minutes.
    (b) Give each of the 22 HR reads the guard its pages already use. The
    schedule, attendance, leave and HR-home pages use `requireHROrAdmin`;
    employees, payroll, day-swap and settings use `requireHR`. Match each
    read to its callers rather than blanket-applying one guard. Then make the
    scan a test like `paged-reads.test.ts`, so CI fails an exported action
    with no guard. One commit each.

    **The live HR access check, kept for the rebuild** (not run). Block 1
    reads the live policies:

    ```sql
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_on,
           p.policyname, p.cmd, p.roles, p.qual, p.with_check
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('payroll_entries','payroll_periods','employees','departments','leave_types',
                         'leave_requests','holidays','attendance_daily','day_swap_requests',
                         'schedule_notes','attendance_punches')
     ORDER BY c.relname, p.policyname;
    ```

    Block 2 runs once per account, negative controls first (sales, then
    `admin`, then HR and owner). It prints the account in its first column
    and rolls back:

    ```sql
    BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', <WHO>)::text, true);
      SELECT set_config('role', 'authenticated', true);
      WITH upd AS (UPDATE public.day_swap_requests SET note = note RETURNING 1)
      SELECT public.current_role() AS who,
             (SELECT count(*) FROM public.payroll_entries)   AS payroll_entries,
             (SELECT count(*) FROM public.payroll_periods)   AS payroll_periods,
             (SELECT count(*) FROM public.employees)         AS employees,
             (SELECT count(*) FROM public.holidays)          AS holidays,
             (SELECT count(*) FROM public.attendance_daily)  AS attendance_daily,
             (SELECT count(*) FROM public.day_swap_requests) AS day_swap_read,
             (SELECT count(*) FROM upd)                      AS day_swap_written;
    ROLLBACK;
    ```

    Expected on 2026-09-16, from the repo:
    - payroll 0/0 for sales AND admin (admins are the population most
      likely to be let in by mistake), 2/2 for HR and owner;
    - employees 0 for sales, 47 for admin (which includes `base_salary`,
      by the current design);
    - holidays 0 for admin.

    Row counts change, so re-derive them first; a check against an empty
    table passes for nothing.

    **For the rebuild, found by the role sweep of 2026-09-17** (each
    confirmed by a second reader; nothing changed, HR is held):
    - **Salary columns reach admins' browsers.** `getEmployees` selects
      `base_salary`, `position_allowance`, `social_security_monthly` and
      `daily_wage`, and the attendance, leave and schedule pages call it
      behind `requireHROrAdmin`, which admits admins, then pass the rows
      to client components. Two comments say otherwise: `auth.ts` calls
      those pages "no salary data", and `hr/actions.ts` says every route
      reaching these reads is behind `requireHR`. Commit `5913585` says
      "Admin blocked from salary pages". The table policy lets admins read
      whole rows (`hr_role_patch.sql`), which this entry recorded above as
      "by the current design". Which is intended is Nik's call.
    - **Admins see no public holidays** on the schedule, print and
      attendance pages: `holidays` is owner and hr only, and the read
      returns nothing without an error. Inferred, not witnessed.
    - **Admins are shown what they cannot use:** the day-swap link (its
      page is `requireHR`), and edit controls on attendance, leave and
      schedule, whose every write is `requireHR`. The first edit bounces
      them to /owner.


29. ~~**The UI refuses it, the server does not: six live gaps, found
    2026-09-17.**~~ **CLOSED 2026-09-17.** 1–3 fixed in the app (`af3bc69`)
    and at the database (part A of the permissions batch, applied, A1–A16
    ok); 4 fixed in the app (`af3bc69`) and at the database (part B,
    applied, B1–B17 ok); 5 moved to item 35; 6 fixed with item 27. The
    `deleteUser` observation below stays recorded, unchanged. A sweep for
    item 3's shape, each finding confirmed by a second reader trying to
    refute it.

    **Status, 2026-09-17, after Nik's answers:**
    - **1–3, fixed in the app.** `src/lib/team-rules.ts` is now the ONE
      rule: the team screen shows only what it allows, and every action
      in `owner/team/actions.ts` refuses the rest. The target is read
      before any service-role call and a failed read refuses; role and
      detail writes are counted, so a refusal by the table is reported,
      not shown as success. Tests, and a control: a copy of the rule that
      lets admins manage hr fails two of them.
    - **Found by the review, the same kind of path: prep grants.** A
      session carries its account's grants, so an admin with none could
      reset the password of เวช (an editor holding all 48) and read every
      secret recipe. It was on the screen before, so not a regression, but
      it defeats the owner's rule that admins see a prep only when named.
      Now an admin may not act on ANY other account that holds a grant;
      the owner does that. The grants are read with the service role,
      because an admin's own session sees only its own.
    - **Seen, not changed:** deleting an account deletes its login first,
      which by cascade already removes the profile, so the delete that
      follows counts 0 and the screen may say "ลบไม่สำเร็จ" for an account
      that is gone. Existing behaviour, read from the code, not witnessed.
    - **Worse than 1–3, found designing the database half:** the repo's
      only write policy on `profiles` is `is_owner()`, which admits
      admins. So an admin can set its OWN role to owner with one direct
      call (the 007 triggers guard only a row that is already owner),
      and then, as an owner, demote or delete the real one. Part A of
      `permissions_batch_2026_09_17.sql` closes it (applied 2026-09-17).
    - **4, fixed in the app.** All six writes that touch an entry or an
      account refuse a non-owner on an owner-only account, fail closed:
      insert, update (the entry's current account AND the new one),
      delete, display order, and renaming or deleting the account.
      `getAllCoa` no longer lists 790 to admins, and reordering skips it.
      Two cases are deliberately not refusals: deleting an entry that is
      already gone reports success, as before; and the display-order
      update, which the daily page calls AFTER its new rows are saved,
      skips entries deleted since the page loaded and refuses silently.
      Throwing there would show a failed save for rows that were written,
      and a second press would insert them twice (found by the review).
      **Also found:** `coa_all` lets an admin clear 790's `is_sensitive`
      flag directly and then write it freely. Part B closes that and the
      entry writes at the database (applied 2026-09-17). Reads are deliberately
      unchanged; see item 32.
    - **5, Nik decided 2026-09-17: staff WILL place orders, with a head
      approving them.** So the fix is an approval step, not a permission
      wall that would lock out the people the flow serves, and it is its
      own piece of work (item 35), not part of this security batch. The table
      policies also admit every editor to every column of every order line
      at any status; that belongs to the same piece of work.
    - **6, fixed with item 27**, and two more mismatches of the same kind
      closed with item 31.

    **Team management (`owner/team/actions.ts`). These are paths from an
    admin to an hr login, and so to payroll data:**
    1. `changePassword` refuses a non-owner only when the target is owner
       or admin. An admin can reset an **hr** account's password and log in
       as hr, although the screen hides that button. It also fails open: if
       reading the target fails, the reset goes ahead.
    2. `createUser` and `updateUserRole` refuse only the role `owner` for
       a non-owner. An admin can create an **hr** login, or move any
       account to hr, although the dropdown hides it.
    3. `updateUserDetails` has no check on the target at all, and rewrites
       the target's auth email (the login name) with the service role. An
       admin can rename the **owner's** or an hr user's login and lock them
       out. `updateUserRole` lets an admin re-role another admin or hr, and
       `deleteUser` does not refuse hr targets.

    **Owner-only account 790:**
    4. `bulkInsertEntries` and `deleteExpenseEntry` never check
       `is_sensitive`. `updateExpenseEntry` checks only the NEW account,
       not the row's current one. The `expense_all` policy admits admins,
       so an admin can write or delete 790 entries by direct call.
       `getAllCoa` is unfiltered, so the CoA page shows 790's name to
       admins.

    **Supply orders (`staff/inventory/actions.ts`):**
    5. `saveEditorItemEdit` runs on the service role behind only
       `requireProfile()`, with no status or role check. ANY signed-in
       account (staff, sales, hr) can set `editor_qty_ordered` on any item
       of any session, and that value overrides the reviewer's quantity on
       the printed order and on the receive form. The UI can never reach
       that branch. `saveReviewerItemEdit` has no status check either. A
       wrong item and session pair updates 0 rows and reports success.

    **Approvals:**
    6. ~~`approveChange` checked prep visibility only for duplicates, so a
       request the queue hid could still be approved, with RLS turning its
       writes into no-ops marked APPROVED~~: **fixed with item 27.**

    **Unclear, not adversarially checked:** `getRecipeHistory` serves a
    staff-hidden menu's history to any signed-in user; `returnOrderSession`
    lets an editor return an order the UI only lets admins return.

    **Size:** 1–3 are one small commit: make the server enforce the tier
    rule the screen already encodes, and fail closed. 4 is one small
    commit (owner-only, per the decision already recorded). 5 needs Nik's
    word first: its docstring says "any authenticated" on purpose.

30. ~~**Uploaded photos are never deleted, and anyone can list them.**~~
    **CLOSED 2026-09-17.** Reads stay public (Nik); writes narrowed by part
    D of the permissions batch (applied, D1–D14 ok, no "NOT DEMONSTRATED");
    the cleanup is deferred, with its figures below. Found 2026-09-17
    (queue list item 6).

    **Measured, read-only, 2026-09-17** (bucket `sop-photos`, which SOP steps
    and maintenance reports share):
    - **392 files, 113.2 MB.**
    - 280 are referenced by live rows (`menu_sop_steps.photo_url`,
      `maintenance_reports.photo_before/after`).
    - 26 are referenced ONLY by old approved SOP requests, meaning they
      were replaced after approval.
    - **86 are referenced by nothing at all (44.6 MB)**: 78 SOP and 8
      maintenance, created 2026-07-08 to 2026-08-17.
    - No referenced file is missing.

    **Nothing ever deletes a file.** There is no `storage.remove` anywhere,
    no SQL on `storage.objects` beyond the policies, and no cleanup job. A
    file is orphaned when:
    - it is uploaded as soon as it is picked, and the form is then
      abandoned or the photo replaced before saving;
    - a saved SOP is re-saved, since the save deletes and re-inserts every
      step;
    - an SOP or its menu is deleted (the `test` menu will add 8);
    - an editor's SOP request is rejected;
    - a stale SOP snapshot is approved over newer photos;
    - a maintenance before-photo is changed, or "done" is sent twice.

    **Exposure, CONFIRMED:** the bucket is public, and the public key alone
    can LIST it. A read-only listing with that key returned the same 335
    root entries as the service key. Every photo, including 15 maintenance
    photos and all the orphans, can be enumerated and downloaded by anyone.
    **Also by policy, not tested:** any signed-in account can upload,
    overwrite or delete any file in the bucket (`004_sop_module.sql`).

    **Nik's decisions, 2026-09-17:**
    - **Reads stay public.** Kitchen SOPs and repair photos are not
      secrets, and SOP may move to dedicated devices later.
    - **Writes are narrowed** (decision 2 below): part D of
      `permissions_batch_2026_09_17.sql` (applied 2026-09-17). Uploads are
      allowed by role AND by the file names the app generates: SOP photos
      for owner, admin and editor; report photos for every role; "done"
      photos for owner, admin and editor. Nobody overwrites or deletes
      through the API.
    - **The cleanup is DEFERRED** (decision 3). The figures it was weighed
      on: 86 files referenced by nothing, 44.6 MB of the bucket's
      113.2 MB, plus 26 referenced only by old approved requests. That is
      not worth a medium job, and a cleanup that miscounts one reference
      deletes a live photo. The count grows with every abandoned pick,
      SOP re-save and rejected request; deleting the `test` menu will add
      8, still reachable by URL.

    **Also found, 2026-09-17:** 58 of the 392 files sit in
    `sop-<uuid>/` folders with `.png` names, which no app code writes (a
    script's upload, by the look of the names). Part D does not let the
    app write that shape; a script using the service key is unaffected.

    **Size and decisions, as first reported.**
    1. Nik decides whether SOP and maintenance photos should be public at
       all. A private bucket means signed URLs in two readers.
    2. Narrow the bucket's write policies to the roles that edit SOPs and
       file maintenance reports. One migration.
    3. Any cleanup must be REFERENCE-COUNTED, because one URL can sit in
       several step rows and several request payloads. That means a script
       a person runs, dry-run first, over the live rows plus pending (not
       resolved) payloads. Medium.
    4. Removing an old file when a photo is replaced needs the same
       counting. Not worth doing before 3.

31. ~~**`pending_changes`: any admin can read every request through the API,
    including a hidden prep's recipe.**~~ **CLOSED 2026-09-17:** part C of
    the permissions batch applied (C1–C19 ok, the 18-case prep-id check ok,
    none of the 11 synthetic requests remains). Found 2026-09-17 by item
    27's review. **Latent at the time:** none of the 157 rows was about a
    prep.

    **Status, 2026-09-17: part C of `permissions_batch_2026_09_17.sql`**
    (applied 2026-09-17). A RESTRICTIVE read policy, so it caps "pending read"
    and anything else live. **Editors are gated too:** an editor whose
    grant was revoked no longer reads that prep's requests, their own
    included. Every editor save path checks `canSeePrep` first, so the
    save's read-back is refused only in the moment a grant is revoked.
    None of the live rows exercises it, so the file tests eleven synthetic
    requests, inserted only inside a block that is rolled back; none is
    ever committed.

    **Writing the SQL twin found two more mismatches, closed in the app.**
    The queue's filter and the approval disagreed on which prep a
    request is about:
    - a `recipe_edit` whose target was anything but exactly `"prep"`
      skipped the check, yet approval writes every non-`"menu"` target
      to the prep tables;
    - a `prep_yield_edit` was checked on `target_id` and written to
      `payload.parentId`.

    `prepIdOfChange` (now `src/lib/pending-prep-id.ts`) returns the prep
    each approval branch WRITES, and `approveChange` writes to the id it
    checked. A JSON-null payload no longer throws in the queue's filter,
    and the queue passes any non-object payload to the page as empty.

    The SQL function `pending_change_prep_id` and the TS function are held
    together by one table of 18 cases, run by `npm test` and by the
    migration's self-check; the test fails against the previous mapping.
    The payload is chosen by whoever inserts the row, so a forged request
    could have used either gap, although an admin could already write
    lines into a hidden prep directly: the prep tables' WITH CHECK omits
    `can_see_prep` by design.

    **The review of this batch (two rounds) added:**
    - an empty-string prep id skipped the guard (a truthiness test); it is
      now `!== null`, and the case is in both twins' tables;
    - a `recipe_edit`'s deletes and updates took line ids from the request
      without limiting them to the recipe that was checked. They are
      limited now. A line no longer in that recipe (deleted since the
      request was filed, or never its own) is skipped, as a deleted line
      always was, and the skip is written into the request's note when it
      is approved. (Refusing the whole request instead, tried first, would
      have blocked every other pending edit of a recipe once one line was
      deleted.)
    - marking a request approved or rejected is counted, so a status write
      the table refuses is reported, not shown as success;
    - **part C would have broken a normal approval:** when an admin with the
      grant approves a prep's deletion, the cascade removes the grant, and
      the request would then be hidden from the admin marking it approved.
      A deletion whose prep no longer exists is therefore readable (it
      carries only the id and name); the file tests exactly that case. The
      app does not mirror this, on purpose: a leftover deletion request
      stays with the owner (`pending-prep-id.ts`);
    - **only editors file requests now,** and only about preps they can
      see at that moment (part C's insert policy, which leaves out the
      deleted-prep exception: with it, an editor could file a deletion for
      a prep that does not exist yet). Until now any signed-in account
      could insert any request, and an insert that does not read the row
      back is not checked against a read policy. A filed request can no
      longer be rewritten: UPDATE is granted only on the four columns
      approval writes. `saveRecipeItems` refuses a target other than
      `menu` or `prep`.
    - **Not changed, recorded:** the approval card shows the name written
      in the request, not the name of the prep the approval will write.
      With filing limited to editors who can see the prep, a misleading
      name can only come from an editor who could already ask for that
      prep's change under its right name.

    The entry as first written:

    The queue, the badge and both approval actions hide or refuse a request
    about a prep the viewer cannot see. The table's own read policy
    ("pending read", `migrations/006_owner_role.sql`) admits every admin and
    owner to every row. A `recipe_edit` request for a prep carries the whole
    item list, so an admin without a grant could read a hidden prep's
    composition from its requests with a direct API call. Same family as
    the prep leak: a rule the app applies and the database does not.

    **Size: one migration.** The SELECT policy must exclude a prep-related
    row for a caller who fails `can_see_prep` on the prep it is about,
    using the same mapping as `prepIdOfChange`, written in SQL:
    - `recipe_edit` with target prep → `parentId`;
    - `prep_yield_edit` → `target_id`;
    - `prep_delete` → `prepId`;
    - `prep_create` with `duplicatedFrom` → `duplicatedFrom`.

    **Also recorded:** the insert policy checks only `editor_id`, so a
    request's id and payload are chosen by the caller. The approval code
    must keep treating them as untrusted input, which is why
    `approvalRowId` exists.

32. ~~**A question for Nik: "no indicator", or the notices?**~~ **CLOSED
    2026-09-17.** Nik's answers: hide owner-only rows from non-owners
    silently, then give the money pages one neutral line.
    - `6416e9b`: the "มีรายการที่ไม่แสดง N รายการ" notices are gone from
      all six places that had them (the month list, the daily page on
      screen and in print, the payment voucher, the P&L summary, the P&L
      print page and its Excel file, break-even), and the counts behind
      them are no longer computed or sent to the browser. No total
      changed: every figure was already built only from the rows a
      non-owner may see.
    - `3b4a83a`: break-even, the P&L summary, the P&L print page and its
      Excel file showed every non-owner "ตัวเลขฉบับเต็มดูได้ที่บัญชีเจ้าของร้าน".
      **Superseded the same day by item 37:** no non-owner reaches those
      four outputs any more, so the line and `owner-only-note.ts` are gone.
    - **Still partial and silent for an admin, by this item's decision:**
      the month list's ยอดรวมเดือน and the daily page's totals on a day
      that carries a 790 lump leave that lump out and say nothing.
    - **Item 36** (admins can still READ 790's rows through the API, and
      the transfer slip counts them) is deferred.

    The question as first written:
    `UNWIRED_FEATURES.md` records his decision as **no indicator** for
    rows a non-owner may not see (790). Yet five screens show
    "มีรายการที่ไม่แสดง N รายการ" (`withheldCount`) beside totals that
    leave those rows out. Which is current? The answer decides two
    things:
    - whether the notices are removed;
    - whether admins keep READING 790's rows. Part B of
      `permissions_batch_2026_09_17.sql` leaves that read in place on
      purpose, because the notices count them. With no indicator, the
      read can be closed too, and the reduced totals then carry no label.

33. ~~**Catering: what sales can do by direct call that the app keeps from
    them.**~~ **CLOSED 2026-09-17** by `catering_sales_limits_migration.sql`
    (applied; see the table above) and `9f11a8b` (deleteCateringEvent checks
    the lock and returns the refusal), apart from its follow-ups:
    - **A, done:** `saveBooking` checks the lock before any write
      (`f4bdabd`). A later step always refused a locked booking, but by
      then step 1 had rewritten the staff list, created a typed-in
      customer and added a history line, and for owner and admin saved
      the booking's own fields.
    - **B, Nik's choice 2026-09-17: the owner may correct and remove
      history lines** from buttons on the booking page, since he cannot
      use the Supabase dashboard. The buttons shipped in `c060670` (owner
      only; delete asks first; errors returned, and "no row changed"
      reported as a refusal). `catering_history_owner_edit_migration.sql`
      lets the database allow them; **applied 2026-09-17** (the table
      above), and the buttons work.
    - **The repo-drift bullet below, confirmed live 2026-09-17** from
      the survey rows Nik pasted: `catering_cost_snapshots_rw` is owner
      and admin only in the database, as `COST_SNAPSHOT_SCHEMA_SQL.md`
      says and `catering_migration.sql` does not. Not a hole. The repo
      still lacks the file that made it so; copying that SQL into
      `supabase/` as a record is a small, separate change, not done.
      `catering_event_labor_rw` matches its migration.

    Found 2026-09-17 by the role sweep, each point confirmed by a
    second reader.
    - **Set menus.** `catering_set_menus_rw` and
      `catering_set_menu_items_rw` admit sales to writes. Every set-menu
      write in the app is `requireAdmin` (`de72798` made them admin-only
      and judged only what sales may READ). A sales session can reprice,
      change or delete a set menu, and those prices feed new quotations.
    - **The cost lock.** `catering_events_rw`, `catering_event_menus_rw`
      and `catering_event_charges_rw` have no predicate on
      `cost_locked_at`, which the app says only the admin lock and unlock
      set. A sales session can clear the lock, or change a locked event's
      menus and charges. **In the app too:** `deleteCateringEvent`
      (`requireSales`) does not call `assertCostNotLocked`, so sales can
      delete a locked event, and its frozen P&L goes with it.
    - **The activity log.** `catering_event_activity_log_rw` is FOR ALL
      for owner, admin and sales, so any of them can rewrite or delete an
      event's history; the check does not pin the actor to the caller.
      The app only inserts and reads.
    - **Repo drift, not a hole:** `catering_cost_snapshots_rw` in
      `catering_migration.sql` admits sales to the cost snapshots, but the
      SQL that later made it owner and admin only is in the untracked
      `COST_SNAPSHOT_SCHEMA_SQL.md`, not in `supabase/`. The deployed lock
      writes columns only that file adds, so it ran. A `pg_policies` read
      would confirm it.

    **Size: one migration** (restrictive policies: set menus written by
    owner and admin; events, menus and charges of a locked event written
    by owner and admin only, and the lock column by them alone; the log
    insert-only with the actor pinned), **plus one line in the app** (the
    lock check in `deleteCateringEvent`).

34. ~~**Role checks in the app that name one role and admit the others.**~~
    **CLOSED 2026-09-17** (`6ae1847`) **and fully closed 2026-09-18**:
    `editAccess()` (`src/lib/edit-access.ts`, tested) decides the recipe
    pages, `saveRecipeItems` and the SOP page, and the stale comments are
    corrected. The last bullet — `staff/page.tsx` filtering hidden menus
    for staff and editor BY NAME, so hr, sales and any role added later
    were shown every hidden menu's name — is now an allowlist: owner and
    admin see them, everyone else gets the filtered list. The menu PAGE
    already refused all of them (`staff/menu/[id]` notFounds a hidden menu
    outside `editAccess` "direct"), so what leaked was the names on the
    list while the page behind them was shut; its comment, which still
    said "block staff/editor", is corrected to match.
    Found 2026-09-17 by the role sweep. Small.
    - `saveRecipeItems` refuses only staff and routes only editors to a
      request, so hr and sales reach the direct-save branch; the table
      policy refuses the write, and the screen then says it saved.
      `staff/menu/[id]` and `staff/prep/[id]` treat only `staff` as
      read-only and cost-free, so hr and sales get an editable editor and
      an (empty) cost panel. Already recorded as C1 in
      `CORE_COSTING_AUDIT.md`.
    - `staff/page.tsx` filters hidden menus for staff and editor only.
      Sales already reads every menu by design; hr sees their names.
    - `sop/[menuId]/page.tsx` defines `isAdmin` as the admin role only,
      so the owner gets no edit pencil there.
    - Stale comments: `team-manager.tsx` calls password changes
      "owner-only"; `requireAdmin`'s comment lists only editor and staff
      as redirected.

35. **Supply orders: an approval flow, not a permission wall** (item 29
    #5). Nik, 2026-09-17: staff will place orders and a head approves
    them. Investigated the same day; its own piece of work, waiting on
    Nik's answers. **Most of the flow exists:** staff submit (the button
    already reads "ส่งให้หัวหน้าตรวจ"), an editor, admin or owner
    reviews, an admin or owner marks it sent, anyone receives. What is
    missing:
    - **who a head is:** any editor, admin or owner approves any order,
      including their own; nothing ties a station to a person, and an
      order's station is optional;
    - **who may change a quantity, and when:** the reviewer's quantity is
      saved at any status; the purchaser's adjustment by ANY signed-in
      account (no screen calls it); at `reviewed` the head and the
      purchaser write the same column; no line records who changed it;
    - **the database:** editors may change any column of any order or
      line at any status, including marking an order sent (the app made
      that admin-only in `6dd173d`), and delete any order; a creator may
      insert lines with the approved quantities already filled in;
    - **smaller:** status moves report success when they change nothing;
      a failed read in `receiveOrderItems` marks the order received;
      returning an order overwrites the staff note; an all-zero reviewed
      order shows no lines and no buttons; the line-count read is capped
      at 1,000 rows.

    **Recommended shape:** each stage owns one quantity column, and every
    order write goes through a single-purpose database function that
    checks role, status and creator (the `receive_order_item` pattern),
    with direct writes, inserts and deletes closed. Who counts as a head
    is ONE replaceable function, global to start, so per-station heads can
    follow without touching the order code. **Size: upper medium,
    11–13 files, a large self-testing migration, and an adversarial
    review.** A request queue per quantity change was weighed and is
    larger, slower for staff, and still needs the same lockdown.

    **Questions for Nik:** who is a head (every editor, or named people;
    one who is on a staff login?); per station or for all, and who
    approves an order with no station or when the head is off; may a
    head change quantities, and before or after approving; may anyone
    approve their own order; is the purchaser owner and admin, and at
    which step; staff edits while submitted, or only when returned; may
    editors return a reviewed order; who receives, and may hr and sales
    order at all; cancelling or withdrawing an order; a badge for heads.
    **Before any migration:** `pg_policies` for the order and station
    tables, and counts of orders by status, self-reviewed orders, orders
    with no station, order lines, and lines with each override set.

36. **Admins can still READ account 790's rows through the API.**
    **DEFERRED by Nik, 2026-09-17, and again on 2026-09-18: the admin is
    trusted and non-technical.** Not started; kept here for when it is wanted. The
    app hides the rows (item 32); the database does not (part B of the
    permissions batch left the read in place; its test B15). What it
    takes, from the 2026-09-17 report:
    - **One restrictive SELECT policy on `expense_entries`:**
      `is_owner_only() OR coa_is_open(coa_code)`, the shape of part B's
      write policies; `coa_is_open()` is already live. No app change:
      every screen already drops these rows for non-owners, and
      `ownerOnlyEntryRefusal` already refuses an id it cannot find.
    - **The import logs give the amount away by subtraction.**
      `budget69_imports` and `outsource_imports` are readable by admins,
      and their `written_total` includes 790 (budget69 maps
      เงินเดือนเจ้าของร้าน, and the outsource file เงินเดือนออฟฟิศ, to 790),
      so a month's 790 lump is `written_total` minus the lumps an admin
      can see. The app never reads those totals. Options: owner-only rows
      (the admin's start-of-month checklist reads `imported_at` from
      them), withholding only the total columns from non-owners (check
      against the import functions), or the totals in an owner-only
      table.
    - **The transfer slip** counts 790 rows in its "พบ N รายการ…
      ที่ยังไม่ได้เลือกซัพ" line for an admin, and its supplier totals would
      include a 790 line entered with a supplier. Left alone until this
      item (Nik, 2026-09-17): the policy above corrects both.
    - Optional: the 790 row of `coa` itself (a name, no amount).
    - Tested like part B, as the real admin and owner.

37. ~~**Shop-level profit is the owner's; the head chef controls food
    cost.**~~ **CLOSED 2026-09-18**, and checked in the app by Nik: the
    owner's two-sheet Excel is right, catering history times are right, an
    admin no longer sees break-even or the P&L, daily entry and the month
    list still work, and an editor no longer sees Menu Engineering. The
    system is for cost control, and its main user is the head chef (an
    admin) checking his own food cost each month.
    - **Owner only:** the P&L summary, the P&L print page and its Excel
      file, and break-even (`requireOwner` on the three pages and on
      `getMonthlySummary`, the endpoint behind them; the accounting tool
      row shows the two links to the owner alone).
    - **Owner and admin:** the shop-level cards on `/owner` (POS sales,
      recipe cost and food-cost % added up over the dishes shown), the POS
      sales import, and **`/owner/accounting/food-cost`, the page that
      replaces the P&L for the head chef** (`4ee3ab1`, 2026-09-18 — until it
      shipped an admin had no way to see COGS at all). Sales for the month, the G100 (COGS)
      total booked against them, that as a percentage, and how far it sits
      from `coa.target_pct` on the G100 header (38%) in points and in baht,
      plus the G100 accounts biggest first. `getFoodCostMonth` reads G100
      and nothing else; `food-cost.ts` throws away anything that is not an
      open G100 account, which `food-cost.test.ts` covers; and the page is a
      server component with no client child, so nothing but that result
      reaches the browser — which the tests CANNOT see, and which was checked
      instead by reading the route’s built client-reference manifest during
      the 2026-09-18 review. It says in Thai that this is what was BOUGHT, so
      it will not agree with the recipe-based % on `/owner`.
    - **A group total now counts an account that nets negative** — the P&L
      summary, the print page and both Excel sheets, matching the food-cost
      page (Nik approved, 2026-09-18). Until then the group total and the
      operating total were added up from the DISPLAY list, which dropped
      anything not strictly positive, so a delivery credited back in full
      reduced nothing and the month read as more expensive than it was.
      Now every account in the group is counted, credits included, and only
      the display leaves one out — an account with nothing in it at all.
      The rule moved out of `getMonthlySummary` into `monthly-summary.ts`
      so it could be tested rather than asserted; the first test in
      `monthly-summary.test.ts` is the defect itself.

      **MEASURED 2026-09-18, and the answer is zero.** Nik ran the
      read-only query over April–September 2026: **no account netted
      negative in any of the six months**, so `opex_overstated_by` was
      0.00 every month and **no P&L figure anyone has read was wrong**.
      Nothing to restate and no month to re-issue. The fix is PREVENTIVE:
      it decides what happens the first time a delivery is credited back
      in full, which has not happened yet. That also means the rule has
      never been exercised against real data — `monthly-summary.test.ts`
      is the only thing standing behind it.
    - **Owner, admin and editor:** per-dish margin, on the recipe pages
      (already, item 34) and in the Star-to-Dog sort on `/staff`, which
      staff, hr and sales no longer get: that order IS the margin,
      ranked. Both use `editAccess()`.
      **Menu Engineering on `/owner` stays owner and admin** — corrected
      2026-09-18. It was briefly opened to editors here, which Nik had
      never asked for: he said only that per-dish margin need not be
      hidden from the roles that already see it. Reverted before the
      commit, so no editor ever had it.
    - **Unchanged for an admin:** daily entry, the payment voucher, the
      transfer slip, the month list, the revenue import.
    - **The owner's Excel file has two sheets:** ฉบับเต็ม, with the 790 row
      and every figure containing it (its group, operating expense,
      operating profit) painted red; and สำหรับประชุม, with 790 removed and
      every total and percentage recomputed, unpainted, saying nothing
      about a removal (`pl-workbook.ts`, tested). Painting needs
      `xlsx-js-style`, added as a dependency: the community `xlsx` writes
      no cell styles.
      **Both sheets read as tables rather than raw cells since 2026-09-18:**
      a filter over the expense list (Excel allows ONE filter range per
      sheet, and that is the long list a person sorts), with รวม and กำไร
      left outside it where a filter cannot hide them; a dark header band
      on all three section headers; the title, any warning and the column
      header frozen at the top; column widths computed from the contents,
      so no number shows as ####; amounts with thousands separators and two
      decimals, counts without decimals, and the percentages exactly as
      they were. **The red fill is applied LAST**, over the row's own style
      and replacing only its fill, so a marked total keeps its bold AND its
      mark. Two things the library cannot do, checked against the installed
      copy rather than assumed: a real Excel TABLE (a ListObject — it has
      no `tableParts` at all) and freeze panes (it writes `<sheetView>`
      with no `<pane>`), so the panes are patched into the file after it is
      written. `pl-excel.test.ts` builds the file through the same function
      the button calls and reads the bytes back: the filter ranges, the
      panes, the widths, the number formats, the band, and the red fill on
      exactly the marked rows — resolved through `styles.xml`, not through
      the style object it passed in. It parses the zip by hand as well,
      because the first version of the pane patch ADDED a second copy of
      each sheet part instead of replacing it, which every reader that
      indexes by name — SheetJS's own included — hides completely. And it
      re-checks สำหรับประชุม at the file level: nothing about what was
      taken out, in a cell, in shared strings, or in the one defined name
      the filter creates (`_xlnm._FilterDatabase`, a plain range per
      sheet).
      **Column B carries the group name (หมวด) on every account row**, added
      2026-09-18 so the filter range can be SORTED without the hierarchy
      falling apart: each line still says which group it belongs to wherever
      it lands. The group lines leave หมวด empty — their own name is in
      column A — which is what identifies them as totals once the list has
      been reordered, and Excel carries the bold with the row when it sorts.
      The indent in column A is unchanged. Nik confirmed in Excel that the
      frozen header, the filter and the red fill all behave.
    - **Catering per-event profit and cost** (`/owner/catering/[id]/cost`,
      owner and admin; sales sees quoted totals and deposits only) is
      reported and NOT changed: Nik decides.
    - Also in the same change: a booking history's timestamps are
      formatted in Bangkok time by name on server and browser alike
      (`log-time.ts`, tested); they used the runtime's zone, UTC on
      Vercel, so every booking page with history mismatched on load.

    **Decided by Nik on 2026-09-18 after the visibility sweep reported
    them — settled, not to be reopened:**
    - **The month list keeps its ยอดรวมเดือน for an admin.** That total,
      with the stored revenue an admin can also read on the revenue
      import page, approximates operating profit. Nik accepts it: the
      head chef is trusted, and the figure is the one he books himself.
    - **Catering per-event profit and loss stays with admin**
      (`/owner/catering/[id]/cost`): the head chef costs the events.
      Sales still sees quoted totals and deposits only.
    - **The neutral note stays removed everywhere**, the month list and
      the daily page included, where an admin's totals silently leave a
      790 lump out. Silent is what he wants.
    - **Item 36 stays deferred** (the admin is trusted and
      non-technical).
    - **The food-cost target stays editable by an admin** at จัดการหมวด
      (`coa.target_pct` on the G100 header). Nik accepts that the head
      chef can move the target he is measured against.
    - **A negative expense amount stays allowed, with no warning.**
      Returns and credits are entered that way, and a warning on a normal
      entry is a warning people learn to click past. This is the same rule
      the group totals now follow (above).

    **The month navigator was building months from a local-time `Date`**
    — fixed 2026-09-18, Nik approved. `new Date(y, m - 2, 1)
    .toISOString().slice(0, 7)` builds the date in the runtime's zone and
    reads it back in UTC. In UTC the two agree, which is why it survived
    on Vercel; on a machine in Bangkok, August's previous month came out
    as June and its next month as August itself. Seven lines across four
    files: four ‹ › links, on the P&L summary and on break-even, and three
    defaults that took the month from the UTC clock (the summary, the
    print page and the month list), which is the previous month for the
    first seven hours of every Bangkok month. All now use the pure string
    helpers the food-cost page already used — `previousMonth`,
    `nextMonth` and `bangkokYearMonth`, which moved into `checklist.ts`
    because a `"use server"` file may export only async functions.
    `date-strings.test.ts` (named `month-strings.test.ts` until the day half
    below) reads the SOURCE of every page under `src/app` and fails on either
    shape; run against the pre-fix files it flags exactly those seven lines,
    and its own first test is the shapes it must catch.

    **THE SAME DEFECT A DAY AT A TIME — fixed 2026-09-19, Nik approved.**
    `new Date().toISOString().slice(0, 10)` is the UTC day, so for the first
    seven hours of every Bangkok day it is yesterday. Found on
    `daily/page.tsx` while reporting the month fix; the sweep for it found
    **24 lines in 14 files**, and the pre-fix control flags every one.
    - **What it did:** บันทึกรายวัน and its receipt opened on yesterday's
      entries; the month list's "+ บันทึกวันนี้" pointed at yesterday and its
      navigator compared against the UTC month; the transfer slip opened on
      the week before (it read the clock as UTC *and* the weekday in the
      server's zone); the HR schedule and its print page opened on last week;
      probation alerts, both comp-day balances and the day-swap status labels
      compared against the wrong day; the POS price window started and ended
      a day early; the SOP form pre-filled yesterday; the menu-cost CSV was
      named for yesterday.
    - **The other half is arithmetic**, and it was fixed with it, because a
      correct day fed into local `setDate` arithmetic comes back wrong:
      `new Date(ds + "T00:00:00")` parses in the runtime's zone and
      `toISOString` reads UTC, so the HR week start was a Monday early west
      of Greenwich, and every `d.setDate(d.getDate() + n)` that was read back
      with `toISOString` had the same property.
    - **One home now:** `src/lib/bangkok-date.ts` — `bangkokToday`,
      `bangkokYearMonth` (moved out of `checklist.ts`), `shiftDay`,
      `dayOfWeek`, `startOfWeek`. The clock is read through a named zone;
      everything else is string math, so no answer depends on where the code
      runs. Tested in `bangkok-date.test.ts`, whose second test is the
      18:00Z instant that is 01:00 tomorrow in Bangkok.
    - **Deliberately left:** `pos-delivery-validation.ts`'s `tomorrow` bound,
      which is a documented allowance for exactly this offset (an export made
      late in the Bangkok evening carries a date UTC has not reached) and
      whose `today` is a parameter; and `thaiDateShort`/`thaiDateFull`, which
      build locally and read locally, so both halves agree.

38. **April and May 2026 hold almost no revenue, against a normal month of
    expenses.** Found 2026-09-18 in the output of the negative-account
    query, and **NOT investigated** — recorded here for Nik, who will
    check the revenue import page himself.
    - `monthly_revenue` holds about **50,000** for `2026-04` and for
      `2026-05`, where June, July and August hold **3.1–3.9 million**.
      Expenses in those two months are a normal **~2.9 million**.
    - Most likely the POS revenue import was simply never run for them.
      That is the hypothesis, not a finding: the amounts that ARE there
      have not been traced to a source.
    - Everything downstream inherits it. Both months read as enormous
      losses on the P&L, on break-even and on the food-cost page, and
      every percentage-of-revenue in them is meaningless. The arithmetic
      is right; the revenue side is not there.
    - **Do not backfill from a guess.** The POS export is the source, and
      `import_pos_month` writes revenue and covers in one call.
    - Until it is settled, treat April and May 2026 as months with no
      revenue booked — not as months that lost money.

39. ~~**Catering per-event menus, round 1 of 2**~~ (Nik, 2026-09-19).
    **ROUND 1 DONE AND APPLIED.** The migration ran clean on 2026-09-19 (32
    rows, every judged row ok — the applied table above).

    **ROUND 2 (copy from a past booking, the save model, the price per
    table, and Nik's simplifications) — DONE, APPLIED AND SHIPPED
    2026-09-19/20.** `catering_event_menu_save_migration.sql` ran clean on
    its first run (30 rows, every judged row ok — the applied table above).
    Printing a menu card is still not started, and is the only part of
    round 2 that is not built.

    **SEVEN THINGS TO KNOW ABOUT THE SHIPPED BEHAVIOUR** — not defects,
    recorded because each will look like one to whoever meets it first:

    1. **The price per table is edited on the menu page now, and the price
       box's input for a set line is disabled.** It is one stored number
       (`catering_event_charges.unit_price` on the charge linked to the set
       line), and the menu page is where it is typed. The price box shows
       it and says so in the input's tooltip. Changing it there changes the
       booking screen, the quotation and every total.
    2. **A quotation already issued does not follow a later price change
       until it is re-issued.** The printed document reads the live charge
       rows, so it shows the new figure at once; `quoted_total` — the
       number the cost page and the lock snapshot use — is the total of the
       last ISSUED revision and stays until บันทึกและออกใบเสนอราคาใหม่ on the
       booking screen. The menu page says exactly that beside a changed
       price when a quotation exists. Two figures, both correct, for the
       same booking.
    3. **Production holds 3 pre-feature set lines with no copy** (7 copies
       exist, from the run's counts). They fall back to the shared set
       menu, exactly as every screen read them before this feature, until
       someone saves them on the menu page or the booking is locked
       (locking copies them first).
    4. **Swapping one set for another AT THE SAME PRICE leaves the
       staleness guard silent** (Nik, 2026-09-20, accepted). The guard
       compares one figure: the issued total against the current one. Swap
       ชุด A at ฿4,500 for ชุด B at ฿4,500 after the quotation was issued
       and the totals still match, so locking is allowed — correctly, since
       the revenue figure really is unchanged. What IS out of date is the
       printed quotation, which names the old set. The document reads the
       live charge rows, so it prints B's name as soon as the save lands;
       the PAPER the customer already holds still says A. Total-only is
       deliberate: a guard on "anything changed" would refuse every
       harmless edit and would be turned off within a week. If the set name
       on the customer's copy matters, re-issue.
    5. **Unlocking a booking that was locked with a STALE total is a
       one-way door until the quotation is re-issued** (Nik, 2026-09-20,
       accepted). The lock's staleness guard is new; bookings locked before
       it are untouched and their snapshots stand. But the unlock clears
       the snapshot, and the re-lock then meets the guard — so such a
       booking cannot be re-locked until บันทึกและออกใบเสนอราคาใหม่ has run on
       the booking screen. Unlock one of these only when ready to re-issue.
       The query that finds any booking in that state is with the lock
       precondition below.
    6. **The copy chooser's source list is read once per visit** (Nik,
       2026-09-20, accepted). Opening คัดลอกชุดจากที่อื่น fetches the standard
       set menus and every past booking once, and keeps that list for as
       long as the menu page stays open. A standard set created — or
       renamed, or deactivated — in another tab meanwhile does not appear
       until the page is loaded again. Refreshing (F5) is the whole cure.
       Re-fetching on every open would cost a round trip on a list that
       changes a few times a year, and re-fetching in the background would
       move a list under someone's cursor mid-pick.
    7. **Every unsaved-changes guard uses the browser's own confirm dialog,
       and a browser that has suppressed further dialogs defeats them all**
       (Nik, 2026-09-21, known and accepted). Chrome and Firefox offer a
       "prevent this page from creating additional dialogs" checkbox, and
       it can be ticked on the very dialog these guards raise. From then on
       every `confirm()` on that page returns `false` without showing
       anything, and every guard — the in-app links, ออกจากระบบ — reads that
       as a cancel, so the person stays put and is not told why. A reload
       clears the suppression. Only an in-app modal in place of
       `window.confirm` would remove it, and Nik is not asking for that.
       (A prompt that returns anything OTHER than `false` — undefined from a
       stub or an embedded webview — fails open and lets the person through;
       only the explicit `false` traps.)

    **THE GAP NIK FOUND AFTER `ebba2cc`: a set could be created on the menu
    page and not removed there** (2026-09-20). He made three test sets named
    t2000 with สร้างชุดเมนูเอง and had no way to delete them from that screen.

    - **How deletion already worked, and still does.** The ✕ at the end of a
      set's row in the price box on the booking screen. Round 2 neither
      disabled nor hid it: its only `disabled` is `isPending`, and the price
      INPUT beside it was already disabled for set lines before round 2 —
      that pass changed the input's tooltip and nothing else on that row.
      Removing the row and saving takes `saveBooking` down the
      `removeCateringEventMenu` path, which deletes the
      `catering_event_menus` row. It works for a custom set and a shared-set
      line alike. **The gap was one of place, not of capability:** the only
      delete lived on the other screen, so someone working where the set is
      created had nothing to press.
    - **The fix: ลบชุดนี้ on the card itself**, through the draft model like
      every other edit — pressing it marks the line, ยกเลิก clears the mark,
      บันทึก commits it, and a set that has courses is confirmed by name
      first. Sales never sees the control (`canEdit`) and the action refuses
      it; a cost-locked booking refuses it for everyone, through the same
      `assertCostNotLocked` as every other edit on this screen.
    - **NO MIGRATION.** `catering_save_event_menus` cannot express a
      deletion — its payload is a list of lines to create-or-update, there
      is no delete verb, and the obvious encoding is taken: a line with an
      empty `items` array means "keep the line, remove its courses", which
      is a tested state. So the deletion is a plain scoped DELETE on
      `catering_event_menus`, the same statement the price box has always
      used, and the two ON DELETE CASCADE constraints take the food charge
      and the copied courses with it. **What that costs:** the deletions are
      not in the same transaction as the edits. The save therefore runs the
      function FIRST and deletes afterwards, so a refused save deletes
      nothing; the reverse order could remove a set while the edits it came
      with were refused. **What a migration would buy, if Nik ever wants
      it:** a `p_remove uuid[]` argument on the function, making the whole
      save one transaction, at the cost of a second migration on a function
      that has just been applied. Not written, not proposed for now.
    - **One consequence, worth knowing:** reusing the name of a set that is
      marked for deletion has to be two saves, because the function creates
      before the deletions run. The screen says so rather than letting the
      function refuse it.
    - **The review of the deletion path (one reader, three questions,
      2026-09-20) confirmed the three it was asked** — no orphan charge, the
      delete cannot reach another booking or a single-dish line, and a
      locked booking refuses it — **and found seven defects in the new code,
      all fixed before this record:** the quotation warning lived on the
      card, so a booking whose only set was marked showed no warning at all
      (it is now one warning for the booking); a failed save did not refresh,
      so a half-landed save left the screen arguing with the server; the
      conflict token did not travel with a deletion, so deleting a set
      someone else had just rewritten discarded their work silently (it
      travels now, and the save refuses a stale one); a partial deletion
      reported success; the confirmation told a pre-feature line's owner that
      N courses would be deleted when those courses belong to the shared set
      and are untouched; the id list was not checked for UUID shape, so a
      malformed one surfaced a raw Postgres message; and the payload was
      validated before the caller was authenticated.
    - **TWO PRE-EXISTING DEFECTS THE REVIEW FOUND, NOT FIXED HERE, both
      reachable today through the price box's own delete** — they are Nik's
      to decide, and the second touches a customer document:
      1. **Locking a booking after a set is removed freezes an overstated
         profit.** `quoted_total` is the last issued revision's total, the
         cost page uses it as revenue, and the lock snapshots it — so
         between removing a set and re-issuing the quotation, the cost page
         shows the old revenue against the new, smaller food cost, and
         locking makes that the permanent record. The menu page now warns to
         re-issue before locking; nothing enforces it.
      2. **A deposit already received can print a negative balance.**
         `quote-doc.ts` recomputes the deposit due from the new, smaller
         total and prints `balance = total − deposit_received`; if the total
         falls below what the customer has paid, the ใบแจ้งหนี้ prints a
         negative ยอดคงเหลือ rather than an overpayment. Not touched, because
         the printed documents are Nik's.
    - **THE CHARGE CASCADE, VERIFIED LIVE 2026-09-20** — recorded here
      because the migration that should have created it has NO APPLIED ROW,
      so the repo could not answer it. The deletion leans on
      `catering_event_charges.event_menu_id` being `ON DELETE CASCADE`. The
      repo declares it (`catering_event_menu_link_migration.sql`), but that
      file was written with `ADD COLUMN IF NOT EXISTS … REFERENCES`, which
      creates no constraint when the column already exists — so the
      declaration was not evidence (AGENTS.md rule 4). Nik read the
      catalogue:

      ```sql
      SELECT conname, confdeltype FROM pg_constraint
       WHERE conrelid = 'public.catering_event_charges'::regclass AND contype = 'f';
      ```

      | constraint | `confdeltype` | means |
      |---|---|---|
      | `catering_event_charges_event_id_fkey` | `c` | CASCADE — deleting the booking takes its charges |
      | `catering_event_charges_event_menu_id_fkey` | `c` | **CASCADE — deleting a set line takes its food charge** |
      | `catering_event_charges_rate_id_fkey` | `n` | SET NULL — deleting a rate leaves the charge, unlinked |

      So the cascade is real and the deletion is sound: no charge is left
      pointing at a line that is gone, and none is left behind as a
      `charge_type = 'food'` row with no link, which is the shape that would
      jam the price box. The sibling cascade on `catering_event_menu_items`
      was already proven live by round 1's D1. **Nik also confirmed the
      price box's ✕ still deletes a set line correctly** (2026-09-20).
    - **The same class, checked across the screen.** Everything else this
      page creates, it can already remove: a course added to a set has its
      own ลบ, a set added to the draft but not yet saved has its ✕, a fill
      from the chooser is replaced or cleared, and an edited price is typed
      back. The one thing that is still one-way is MAKING A COPY: once a
      pre-feature line has been saved as the booking's own list, there is no
      "go back to reading the shared set". That is the design — the copy is
      the record — and it is now recoverable anyway, by deleting the set
      line and picking the set again in the price box.

    **THE TWO PRE-EXISTING DEFECTS, NOW DECIDED AND FIXED** (Nik,
    2026-09-20; built locally, NOT COMMITTED, no migration).

    **A. A stale quotation cannot be cost-locked.**
    - **STALE means one thing:** `catering_events.quoted_total` — the total
      recorded the last time the quotation was ISSUED — no longer equals the
      sum of the booking's current charge rows, by more than half a satang
      (`quoteIsStale` in `src/lib/quote-doc.ts`). Not the time, not the
      revision, not which lines moved. That one figure is exactly what the
      cost page reports as revenue and what the lock freezes forever.
    - **Why it must be refused:** revenue is `quoted_total ?? live`, so
      between changing the lines and re-issuing there is a window where
      revenue is the OLD total and the food cost is the NEW one. Remove a
      set and the profit is overstated by the whole set. Locking in that
      window makes it the permanent record, and the cost page then reads the
      snapshot instead of recomputing, so nothing detects it afterwards.
    - **Every path checked, not just the button.** `lockCateringEventCost`
      is the ONLY place in the app that sets `cost_locked_at`
      (`upsertCateringEvent`'s payload is a hard-coded literal with no such
      key, and its parameter type has no such field; no other action, route
      or RPC writes the column). The guard sits before every write, so a
      refusal lands nothing. The cost page's button is disabled with the
      same predicate and prints the reason. **At the database the check can
      still be walked around:** the lock policies let owner and admin UPDATE
      any column of `catering_events`, so a direct PATCH can stamp it. That
      is the same latitude those roles have everywhere else here, and the
      half-lock repair below is what keeps it recoverable.
    - **Rounding cannot trip it.** Both totals sum the same stored `amount`
      values, so the float dust in a stored `unit_price × quantity` cancels;
      only summation ORDER differs. Measured over 200,000 randomised
      bookings (2–41 rows, satang precision, a negative discount row half
      the time) the worst divergence was **3.7e-9 baht**, about a million
      times below the half-satang tolerance.
    - **Bookings ALREADY locked with a stale total are not touched.** The
      guard runs only inside the lock action, and a locked booking shows
      ปลดล็อก, not ล็อก. Their snapshots stand exactly as written. The one
      change for them: **unlocking is now a one-way door until the quotation
      is re-issued** — the unlock clears the snapshot, and the re-lock is
      refused until `quoted_total` matches the lines again. To find any that
      are in that state:

      ```sql
      SELECT e.id, e.quote_number, e.quoted_total,
             COALESCE(SUM(c.amount), 0) AS live_total,
             e.quoted_total - COALESCE(SUM(c.amount), 0) AS difference
        FROM catering_events e
        LEFT JOIN catering_event_charges c ON c.event_id = e.id
       WHERE e.cost_locked_at IS NOT NULL
       GROUP BY e.id, e.quote_number, e.quoted_total
      HAVING abs(e.quoted_total - COALESCE(SUM(c.amount), 0)) > 0.005;
      ```

    **B. An overpayment is printed as one, not as a negative balance.** Only
    the ใบแจ้งหนี้ (invoice) carries a balance row, so that is the only
    document changed. When the deposit received exceeds the current total —
    a set removed after the deposit was taken — it now prints
    **ชำระเกิน — ต้องคืนลูกค้า** with the positive figure, instead of
    "ยอดคงเหลือ −2,500.00", which read as money the customer owed with a
    stray minus in front of it. `DocMoney.balance` keeps the signed
    arithmetic; only the printed row changes. Exactly settled still prints
    ยอดคงเหลือ 0.

    **The review of the lock precondition (one reader, two questions,
    2026-09-20) confirmed the guard is unreachable-around and that rounding
    cannot trip it, and found five things, four fixed:**
    - **The guard created a dead end.** The cost page called a booking
      "locked" from the SNAPSHOT while every write guard reads
      `cost_locked_at`. In the half-written state that the lock's own
      docstring designs for — stamped, snapshot gone — the page showed the
      Lock button, the new guard refused it for staleness, the cure was
      refused by the lock itself, and no Unlock button rendered. Fixed:
      either half now counts as locked so ปลดล็อก is always offered, a
      banner names the half-written state, an already-stamped booking is
      exempt from the staleness guard, and the copy loop is skipped when
      stamped (it refuses a locked booking and would have thrown first).
    - **The refusal could not reach the person.** Production redacts a
      thrown Server Action message. `lockCateringEventCost` now RETURNS its
      refusals, like `saveBooking` — which also fixes the two older
      preconditions, whose messages had the same problem.
    - **A booking with every set line deleted could never clear the block:**
      live total 0 against a recorded total, and the re-issue button was
      disabled on an empty price box. An empty box may now be re-issued when
      the booking already has a quote number.
    - **Not fixed, reported:** a room conflict can refuse the re-issue
      outright (`saveBooking` throws before writing, and the rule counts a
      missing time as a conflict), so a booking in that state stays
      unlockable — but it also cannot be edited at all, which is the larger
      pre-existing problem and Nik's call. Also accepted as a decision:
      swapping one 4,500 set for another after issuing leaves the totals
      equal and the guard silent, which is right for the revenue figure and
      wrong for the printed set name. Total-only is deliberate.
    - **Could not confirm:** the live RLS on
      `catering_event_cost_snapshots` (the repo records drift there). If a
      reader is ever hidden a snapshot row, they would see the half-locked
      state without any partial failure having occurred.

    **Decided, not a gap: the browser's Back button leaves a dirty page
    without warning** (Nik, 2026-09-20). Every other way out asks first —
    closing or reloading the tab, a typed URL, and every in-app link
    including the nav bar, caught in the capture phase. `popstate` cannot
    be refused, and the workaround (pushing a history entry to swallow the
    first Back) breaks the button for everyone in exchange. Nik accepts it.
    Do not reopen this.

    **TWO DEAD ENDS ON AN EMPTY OR UNSAVED BOOKING** (Nik, 2026-09-20;
    built locally, NOT COMMITTED, no migration).

    1. **A booking with no set lines had no way to copy.** He deleted every
       set line; the menu page then showed the empty-state text and the
       create button, and nothing else — because คัดลอกรายการอาหารจาก… lived
       ON a set card, and there were no cards. The only route back was the
       price box on the other screen: a dead end on the screen that owns the
       menu. **The chooser is now the BOOKING's, not a card's**, and a pick
       has two modes. Aimed at a card it replaces that card's list, as
       before. Aimed at the booking (+ คัดลอกชุดจากที่อื่น, always present)
       it CREATES the set line: the source's name, the source's price per
       table (a standard set's `price_per_set`, or a past booking's own
       negotiated `unit_price`), and the courses with their provenance. The
       save writes the line, its food charge and its courses in one
       transaction — which is exactly what puts it in the price box, where
       the table count stays editable. **The table count:** the booking's
       own จำนวนโต๊ะ when it has no sets yet (it is being set up), and 1 when
       it already has one (an extra set, like Nik's ten normal tables plus
       two vegetarian, where the booking-wide count would be plausible and
       wrong). The empty state now names all three routes, and only the ones
       the reader's role has.
    2. **A brand-new booking said nothing about the menu.** On บันทึกการจองใหม่
       there is no รายการอาหารของงาน button and there cannot be — the menu
       belongs to a booking and there is no id yet — but a screen that
       simply lacks something reads as a screen that is broken. The create
       form now says to save first, and that the button appears straight
       afterwards. **Both landing screens confirmed:** บันทึกอย่างเดียว lands
       on the booking page, which carries the button twice (header and the
       row under the form); บันทึกและออกใบเสนอราคา lands on the QUOTATION,
       which had no menu route at all — a link was added to its no-print
       toolbar, so paper is unchanged.

    **The review of the empty-booking copy path (one reader, three
    questions, 2026-09-20) confirmed all three** — the new line cannot exist
    without its charge (both inserts are unconditional in one statement, and
    a refusal on the second of two lines rolls back the first), no duplicate
    name can slip past the four checks, and the price box and the menu page
    cannot disagree (both counts are written as the same `v_tables`, and the
    booking screen's round trip is identity) — **and found five things,
    four fixed:**
    - **The price box could still make the duplicate.** A set copied in is
      stored as the booking's OWN set (`set_menu_id` NULL), so the picker's
      "one line per set" test, which matches on the referenced id, could not
      see it — picking the same standard set there made a SECOND line with
      the same label and price, the set printed twice and the total doubled.
      That is Nik's three-t2000 complaint reached through the new door. Both
      sides now compare by NAME as well: the picker refuses it with a
      message, and `addCateringEventMenu` refuses it server-side, folding
      the name exactly as the save function's own check does.
    - **บันทึก was not blocked while a chooser pick was in flight**, so
      saving mid-pick dropped the copied line under a "saved" notice. Both
      buttons now follow the same busy flag as everything else.
    - **A pick aimed at a card removed meanwhile closed as if it worked.**
      It now says the card is gone.
    - **The picker refused a duplicate silently**; it says why now.
    - **Not fixed, recorded:** the chooser's source list is fetched once per
      visit, so a standard set created in another tab appears only after a
      reload; and the booking screen has no unsaved-changes guard, so an
      unsaved จำนวนโต๊ะ is lost on the way to the menu page and the copy uses
      the SAVED count — the chooser's wording now says "ที่บันทึกไว้".

    **THE BOOKING SCREEN WARNS BEFORE LOSING UNSAVED WORK** (Nik,
    2026-09-20; built locally, NOT COMMITTED, no migration). The same model
    as the menu page: the browser's own navigation through `beforeunload`,
    and every in-app link caught in the capture phase. It closes the loss
    recorded above — จำนวนโต๊ะ typed and then lost on the way to the menu
    page. Browser Back stays uncaught, as decided.

    **What makes it safe to put on the screen sales uses most:** the
    baseline is a snapshot taken from THE SAME VALUES the screen initialises
    its state with, not a re-derivation of them, so at mount the two strings
    are equal by construction and only an edit can separate them. It is
    re-baselined in exactly two places — when the device's remembered taker
    is seeded (a default this screen chose, not something anyone typed) and
    after a save succeeds. `bookingSnapshot` enumerates the form's own keys,
    so a field added later is watched without anyone remembering to add it.
    **The chooser's wording about the saved table count is trimmed but not
    removed:** it no longer has to warn about a number that could be lost,
    but it still has to say which screen the number comes from.

    **The review of the guard (one reader, three questions, 2026-09-20)
    confirmed it cannot fire on an untouched form, cannot block a save, and
    misses no field the save writes — and found six things, four fixed:**
    - **A ctrl-click or middle-click was treated as leaving.** Those open a
      new tab and leave the page where it is, so the prompt was a lie, and
      cancelling it swallowed the new tab instead. Fixed on this guard and
      on the menu page's, which it was modelled on.
    - **Float dust was saved and then read as an edit for ever.** The price
      box wrote `333.33 × 3` as `999.9899999999999`; it now rounds to the
      satang, which fixes the stored figure as well as the flag.
    - **The taker seed gated its two writes differently**, so they could in
      principle disagree about whether the seed had happened. One condition
      now.
    - **Two comments claimed more than the code did** — about why the
      re-baseline after a save is needed, and about trailing spaces in
      notes, which the server trims anyway.
    - **NOT FIXED, and both are the same hole:** a remount discards unsaved
      work without asking. The booking page keys this screen on its charge
      rows so that a save cannot leave stale state behind; if a refresh
      lands while another writer has changed those rows — the menu page in
      another tab, or a second sales login — the key changes, the screen
      re-initialises from the server, and the typing is gone with the guard
      reporting clean. Typing into the form while a save is in flight loses
      the same way (the price box disables itself during a save; the form
      does not). The menu page already solves this properly: it refuses to
      adopt new server data while dirty and says the data moved instead.
      Doing the same here means moving that decision inside the booking
      screen rather than keying it from the parent — a real change to the
      most-used screen, not attempted in this pass.
    - **Also not caught, recorded beside the Back button:** ออกจากระบบ in the
      header is a form submit ending in a redirect, so neither the click
      guard nor `beforeunload` sees it.

    **ออกจากระบบ NOW RESPECTS THE GUARDS** (Nik, 2026-09-20; built locally,
    NOT COMMITTED, no migration). It was the one exit no page guard could
    see: a form submit that ends in a server-side redirect, so no anchor is
    clicked and the document is never unloaded. A module-level COUNT of
    dirty screens (`src/lib/unsaved-changes.ts`) is the smallest thing that
    lets the header ask, because the header knows nothing about the page
    under it and its layout does not re-render when that page's state
    changes. Each screen registers from the SAME effect that arms its own
    guard, so the two can never disagree, and releases in that effect's
    cleanup. **Cancelling does nothing at all and leaves the person exactly
    where they were:** React passes the action to `startHostTransition` only
    when the submit event was not default-prevented, which was read out of
    the React source rather than assumed.

    **It is the only such control.** The shell has exactly one `<form>`, and
    `logout` is imported and submitted in exactly one place; every other way
    out of those screens is a link, which the capture-phase guards already
    catch.

    **The review of it (one reader, two questions, 2026-09-20) confirmed the
    count cannot leak on any unmount path** — normal unmount, the keyed
    remount, the route change after a save, an error boundary and React's
    development double-invocation all run the cleanup, and unmount effects
    flush before mount effects — **and that the sign-out still completes
    after a confirm. It found six things, all fixed:**
    - **A `confirm` returning anything but a boolean stranded the person.**
      A stub or an embedded webview returning `undefined` read as a cancel,
      so sign-out became impossible from a dirty catering screen with
      nothing on screen to say why. It now FAILS OPEN: only an explicit
      `false` cancels.
    - **The missing-`confirm` guard was dead and could throw** from the very
      expression that was meant to be guarded. The lookup is now a separate
      `resolveAsk`, which returns null instead of throwing.
    - **No test could go red for either**, because every test injected its
      own prompt. `resolveAsk` is exported and tested against a window with
      no `confirm`, a non-function `confirm`, and one that needs its
      receiver.
    - **The unsaved badge was hidden during a save while the guard was
      armed**, so the prompt could appear with nothing on screen to explain
      it. Both now read the same condition.
    - **The menu editor was not keyed on the booking**, so navigating from
      one booking's menu to another would have carried the first one's
      drafts across. Unreachable by any link today; closed anyway.
    - **NOT FIXED, recorded:** the recipe editor and the SOP form track
      their own edits but do not register, so signing out still discards
      those silently — two lines each, left until their dirty models have
      been reviewed for false positives. And a deploy landing under an open
      tab turns the post-confirm redirect into a full page load, which
      raises the browser's own "Leave site?" on top of ours; cancelling that
      leaves the person signed out server-side but still in the app.
    - **A limit no code can remove:** a browser whose "prevent this page
      from creating additional dialogs" checkbox has been ticked returns
      `false` from every `confirm`, which reads as a cancel. Only an in-app
      modal instead of `window.confirm` would fix it, on this guard and on
      the two page guards alike.

    **THE RECIPE EDITOR AND THE SOP FORM NOW GUARD UNSAVED WORK** (Nik,
    2026-09-21; built locally, NOT COMMITTED, no migration). These are used
    daily by the head chef and the prep head — far more than any catering
    screen — so a false warning costs more here, and both DIRTY MODELS WERE
    FIXED BEFORE ANYTHING WAS WIRED TO THEM.

    **What was wrong with each, before this pass:**
    - **Both used a flag, set by the first edit and cleared only by a
      save**, so neither could recover: a quantity typed and put back, a row
      or step added and removed, a note typed and deleted — all read as
      unsaved for the rest of the visit. Each now compares WHAT A SAVE WOULD
      WRITE against what was last clean (`recipe-dirty.ts`, `sop-dirty.ts`,
      both tested), mirroring its own save field by field — the recipe save
      drops rows with no ingredient; the SOP save trims the video link and
      the notes, writes no blank note, and drops blank steps.
    - **The recipe price was compared as TEXT**, so "180.00" over 180 read
      as a change — and went on reading as one after the save that stored
      it. It is compared as the number sent, rounded the way the
      `numeric(12,2)` column rounds.
    - **Which already had a page guard:** both had `beforeunload`; NEITHER
      had the in-app link guard, and neither was registered with
      ออกจากระบบ. Both now use `useLeaveGuard` (`src/lib/use-leave-guard.ts`),
      the same guard as the booking screen and the menu page, factored into
      a hook. The two catering screens still carry their own inline copies,
      which predate it; they differ only in treating a non-boolean `confirm`
      as a cancel. Browser Back stays uncaught, as everywhere else.

    **The review (one reader, two questions, 2026-09-21) found three real
    bugs in this pass's own work, all fixed:**
    - **The first recipe model still warned on a re-picked ingredient.** The
      pages load every saved row with unit NULL, and a pick — even of the
      same ingredient — fills it in; the model compared the unit. Its tests
      passed because their rows carried a unit the pages never load with. The
      unit is now left out (it is derived from the ingredient, and no screen
      shows a row's stored unit), the fixtures load the way the pages do, and
      the first model was run against them to show the test now separates
      the two.
    - **A saved row with its ingredient cleared was silently kept** — a
      PRE-EXISTING save bug the new baseline made look settled. The save
      skipped it, the screen dropped it, and it came back on reload with its
      old ingredient. It is now deleted on save, sent with the removed rows
      through the path ลบ already uses, which the direct save and the
      approval both honour. The on-screen hint says so.
    - **ดู SOP was a button calling `router.push`**, which no link guard can
      see, so it left with the edits and asked nothing. It is a link now.
    - **Also fixed:** คัดลอกสูตรนี้ could leave the page from unsaved edits,
      and copies the SAVED recipe rather than the screen — it now asks first,
      in words true for every outcome. And rows edited while a recipe save
      was in flight were overwritten by the saved ones and marked clean; the
      table is locked during a save, as the booking screen's price box is.

    **Found, pre-existing, and none of them in the guard** — the first
    fixed the same day, the other three queued as items 42–44:
    - **The recipe quantity box turned 1.5 into 15 — FIXED 2026-09-21, in
      the commit after this work.** It showed `String(quantity)`, so a
      trailing "." was dropped while typing: backspace the 5 of 1.5 and the
      box showed "1", type 5 and it was 15; typed from empty, 0.5 became 5
      and 1.05 became 105. The unsaved warning was right, but the chef
      believed they had typed it back: a tenfold quantity, silently
      corrupting the recipe's cost. The box now shows exactly what is typed
      ("1.", "0.", "1.50", or nothing) and the number is read from that
      text (`src/lib/decimal-input.ts`; its test types into it key by key,
      and fails 8 of 11 against the old box). The ingredient manager's
      number boxes (price, pack size, yield, par level) held the number the
      same way and share the fix; a lone "." there showed NaN.
      **It did no damage — checked 2026-09-21.** It shipped on 2026-07-19
      (`7c0909e`, the switch to a text box); the ingredient boxes had it
      from the first commit. Nik ran two read-only queries. Every recipe
      line the first one flagged has `could_be_this_bug = false`; the
      three it flagged as tenfold edits (1 → 10 ขีด on 29 Jun) were
      deliberate — see "Dishes sold by weight". The second found one
      ingredient hit: กรรเชียงปู 2,100 → 21,000 on 29 Jun at 14:01, put
      back to 2,100 at 14:02, and no catering booking has a cost lock, so
      nothing froze the wrong price. How the check worked:
      `recipe_item_history` records every change to a line's quantity
      (old, new, who, when), so an edit that multiplied a quantity by
      exactly 10 or 100 shows there; a line typed wrong when first added
      does not, and only the comparison with other recipes can flag it.
      `updated_at` cannot narrow it: every save rewrites every line.
      **Every numeric input in the app was checked — 72, found by parsing
      the code.** Besides these two, 55 hold the typed text and are safe.
      15 of type="number" hold a number: the supplier sort order, and the
      HR attendance, salary, payroll and leave boxes. Chrome never reports
      a half-typed "1." to a number box, so it stays on screen (tested on
      a plain number box). Safari and Firefox are untested; in a browser
      that reports "1." as empty, the 12 of them that turn empty into 0
      would show "0" mid-typing — OT hours and the pay multiplier are the
      two that take decimals.
    - **A step photo upload can undo other edits in the same section.** The
      upload finishes against the list as it was when the file was picked,
      so a step typed, removed or moved meanwhile is reverted — and the
      comparison then faithfully reports the reverted state as clean.
    - **A blank step's photo is dropped on save**, photo and all; the
      comparison mirrors the save, so adding a photo to an empty step is not
      a change, because saving would not keep it either.
    - **The prep yield editor has no guard at all**, and its own unsaved
      check compares text ("8.0" stays unsaved after saving 8), so it would
      need the same treatment before a guard could go on it.

    **Item 40 came out of this work's review and is NOT part of it** — a
    booking a room conflict has frozen cannot be re-issued, and so cannot be
    locked. Pre-existing; Nik left it for later.

    **What Nik found using round 1, and what changed:**
    - *"2,977.06 is wrong."* It was not: quantity is PORTIONS PER TABLE
      (confirmed), so 250 × 5 = 1,250 and the total was right. The row
      showed the unit price and the quantity in two columns and never their
      product, so the rows could not be added up to the total under them.
      Every row now shows `฿250.00 × 5 = ฿1,250.00` (`dishLineTotalText`),
      and the total is the sum of those same row figures by construction,
      tested on his four courses.
    - *"It works, but you have to be familiar with it."* One flat list per
      set in the order courses were added, ONE picker with เพิ่ม, no
      section groupings and no "— ไม่มี —" placeholders; สร้างชุดเมนูเอง
      behind a button, closed by default, with a name and a price only (a
      new set is one table; the count is set in the price box). A new set
      may not take a name another set line of the booking already has (he
      had three "t2000" at three prices, all counting toward one total) —
      refused on the screen and in the function; his existing rows are left
      for him to delete. More than one set per booking stays (ten normal
      tables and two vegetarian).
    - **The section column stays** (dish / dessert / drink / free). Checked
      before the groupings were removed: the kitchen sheet and the function
      sheet group by it (`groupBySection`), the quotation orders dish names
      by it, and the shared set editor assigns it; the cost page and the
      lock snapshot ignore it; NOTHING prices a section differently — "free"
      is a print heading only. A copied course keeps its section; a course
      added on the menu page is a `dish`, so it prints under รายการอาหาร on
      all three documents. That is the one thing the screen can no longer
      say, and it is a screen decision, not a schema one.
    - **The save model.** Edits are held on the screen (`LineDraft`, tested:
      what counts as a change, what ยกเลิก returns to, what the payload
      carries); the figures update live; one บันทึก sends every CHANGED line
      whole to `catering_save_event_menus`, which writes them in ONE
      transaction — a payload lands entirely or not at all (V5 in the file
      proves the first line stays untouched when the second is refused).
      Leaving with unsaved changes asks first (beforeunload, and the back
      link's own confirm). The editor is keyed on a fingerprint of the
      server view, so a refresh after a save remounts it clean and a
      refresh that brings the same data leaves the draft alone.
    - **The chooser** (คัดลอกรายการอาหารจาก…): standard set menus, and every
      other booking with a set line, newest first, searched by customer
      name, no window (`fetchAllRows`, ordered event_date desc, id). A
      booking's line gives THAT booking's own list (its copy, or its
      fallback) — never the shared set behind it — and each course records
      `source_event_menu_id`. Filling replaces the line's list after a
      confirm; nothing is written until บันทึก.
    - **THE price per table** is `catering_event_charges.unit_price` on the
      charge linked to the set line — one stored number. The menu page edits
      it; the price box shows it (its input for a set line stays disabled and
      now says where to edit). It stays consistent because the booking
      screen's save takes a set line's unit_price from the database row it
      RE-READS, never from its own state (`event-menu.test.ts` reads
      `saveBooking` as source to hold that), so a stale booking tab cannot
      write the old price back. A cost-locked booking: the menu page shows
      the frozen banner, no controls, the save refuses (app and function).
      The recorded quotation is NOT re-issued by the menu page: the printed
      quotation reads live charges and follows at once; `quoted_total` is
      the last ISSUED revision's total until บันทึกและออกใบเสนอราคาใหม่ on the
      booking screen — the same rule the price box follows. The screen says
      so beside a changed price when a quote exists.
    - **The price box shows the dish names** under each set line: comma-
      separated, in section order, clamped to two rows by CSS with the whole
      list in the tooltip — cut by the space it has, never by a count.
    - **The comparison** is "ราคาอาหารชุดเทียบกับสั่งแยกจาน": the headline
      is "สูงกว่าสั่งแยกจาน 51.16%" or "ต่ำกว่าสั่งแยกจาน 6.25%", the line
      under it gives both totals, the direction in words, and the
      difference in baht and in percent of the à-la-carte total. No
      "menu incomplete" state. Same wording on the set-menu screen.
    - **Removed:** the six per-edit server actions of round 1 (add, swap,
      re-count, remove, create custom, copy) — every export of a "use
      server" file is an endpoint, and the screen that called them is gone.
      The lock still copies a never-copied line through
      `catering_copy_set_menu` before snapshotting.
    - **Unchanged and re-verified:** owner/admin edit, sales view;
      `buildEventMenuView` drops the per-dish cost map for any access but
      "edit" and the test holds a sales view up to `JSON.stringify` (no
      cost figure, no `unit_cost` key); copies never write back (S1 in the
      file); the 10% swap warning is untouched.

    **The adversarial review (four independent readers, 2026-09-19, one
    question each), and what it changed:**
    - *Can unsaved state be lost or partially saved?* Partial: **no** — one
      transaction, no branch persists before a refusal (V5). Lost: **three
      real ways, all fixed.** (1) Two admins on one line: the second save
      silently won. Every line now carries a CONFLICT TOKEN — the copy's row
      ids and the price the page opened with; every save rewrites a line's
      rows, so anyone else's save shows as different ids or price and the
      function refuses that line (V16–V18), the whole payload with it. (2)
      The editor was keyed on a hash of the whole view, cost map included;
      a session-cookie refresh re-rendering the page mid-edit, or an
      ingredient price changing anywhere, remounted it and threw the draft
      away. The hash now covers the lines, the lock and the access only,
      and new server data is adopted only when the draft is clean or the
      change is the person's own save landing; otherwise the draft stays and
      a banner says the data moved. (3) Only the back link asked before
      leaving; the nav bar did not. Every click on an internal link is now
      caught in the capture phase while dirty. **Still not caught, and
      accepted by Nik (2026-09-20, above):** the browser's Back button
      (popstate cannot be refused) and a session that expires during the
      save (the auth helper redirects to /login). Also
      fixed: the chooser and the ✕ on a new set could change the draft
      during the save's own pending window.
    - *Does the shared price stay consistent?* Server-side **yes**:
      `saveBooking` writes a set line's unit_price from the row it re-reads
      (tested on the source). **But two PRE-EXISTING price-box defects
      became destructive once the menu page could edit the line, both
      fixed:** (1) after บันทึกอย่างเดียว the booking screen kept the state it
      was saved FROM — a set added in that session still read "not yet
      created" — so the NEXT save removed and re-created the line, deleting
      the copy and the menu page's price; the screen is now keyed on the
      charge rows and remounts when they change. (2) A loaded set line
      carried no reference to its set, so the same set could be picked
      again and the save wrote TWO charge rows for one line — the set
      printed twice and the total doubled; `CateringCharge.event_menu_ref`
      now lets the picker refuse it, and `saveBooking` refuses a payload
      with one line twice. Also reworded: the warning beside a changed price
      when a quotation exists said the issued quotation "stays the old
      total" — true of `quoted_total` (the cost page's figure), false of the
      printed document, which reads live rows. Accepted, already recorded:
      removing a set and re-adding it in one price-box save discards the
      copy and comes back at the shared set's price.
    - *Did removing the sections break a document?* **No** — every write
      path yields a valid section, a copied or swapped course keeps its
      group, the lock and cost page never read it, `sort_order` is
      relabelled order-preservingly. One degradation remains, by design and
      recorded: the screen lists a set in the order courses were added
      while every document groups by section, so the on-screen numbers can
      differ from the kitchen sheet's. The other — that a course added on
      the menu page was always a `dish`, so a booking-specific dessert or
      free item could not be filed as one — **was fixed by Nik's decision
      of 2026-09-20: every row carries a small section selector.** The list
      stays flat and in insertion order; the selector is a field of the
      row, like จำนวน, and needs nothing new from the save function (the
      payload has always carried `section` per item, `validateDrafts` and
      `validateSavePayload` check it, and V10 in the migration proves the
      table's CHECK refuses an invalid one). A new course starts as
      รายการอาหาร; a copied one keeps what it came with. The print order had
      two definitions; it now has one (`EVENT_MENU_SECTION_LIST`).
    - *Can sales reach a cost figure?* **No** — every prop of the page, the
      three new server actions (refused before any read), the function
      (role check first, SECURITY INVOKER, RLS denies sales writes), the
      set-menu screen (`requireAdmin`), and the error messages were traced;
      nothing cost-bearing reaches a sales session.

    **Why.** Sompong Catering sells four standard Chinese-banquet sets
    (3,000 / 3,500 / 4,000 / 4,500 a table, 9–10 courses). In practice
    sales swaps courses for a customer, or a customer wants a 4,500 table
    chosen from scratch. A booking picked a set BY REFERENCE, so there was
    nowhere to record what would actually be served — and since item 33,
    sales cannot edit the shared sets at all.

    **The design, as Nik decided it, and how it is built:**
    1. Shared set menus stay reference data, owner/admin-edited (item 33's
       policies, unchanged).
    2. **Picking a set for a booking COPIES its dishes into the booking**:
       new table `catering_event_menu_items`, one row per course, keyed by
       the booking's set line (`catering_event_menus.id`), carrying
       `menu_id, quantity (per table), section, sort_order, note` and two
       provenance columns — `source_set_menu_id` (the shared set it came
       from, ON DELETE SET NULL) and `source_event_menu_id` (round 2, see
       below). The copy is made by ONE database function,
       `catering_copy_set_menu(uuid)`, SECURITY DEFINER, callable by owner,
       admin and sales: it copies verbatim, stamps the set's name onto the
       line (`catering_event_menus.set_name`, new), refuses a locked
       booking and a line that is not a shared set, and returns 0 for a
       line that already has a copy — it never overwrites. The app calls
       it from `addCateringEventMenu` the moment a set line is created.
       **A custom set** is a set line with `set_name` and neither
       `set_menu_id` nor `menu_id` — the one-target CHECK widened to allow
       exactly that third shape — created from the menu page with a name,
       a price per table and a table count, together with the food charge
       every set line has, so the price box and the quotation treat it as
       any set.
    3. **The copy is the record.** Every screen that expands a set — the
       kitchen sheet, the function sheet, the quotation, the cost page,
       the lock's snapshot and the new menu page — reads ONE resolver,
       `getEventMenuDishes`, which returns the booking's copy, or, for a
       set line from before this feature, the shared set as before
       (`source: "shared"`). Nothing is materialised behind anyone's back:
       the menu page marks such a line ยังใช้ชุดเมนูกลาง and offers
       คัดลอกมาเป็นของงานนี้ to owner and admin. **Round 1 does switch the
       existing three documents to the copy** — otherwise the kitchen
       would print the shared set while the booking's own menu said
       something else, which is the contradiction decision 3 forbids.
    4. **Round 2 fits without a rewrite.** Copy from a past booking =
       INSERT…SELECT from that booking's line into a new line, recording
       `source_event_menu_id` (already a column). Printing a menu card =
       a new print page over the same rows, which already carry section,
       order, note and the dish name; nothing to add to the schema.

    **Who may do what — ONE PLACE:** `eventMenuAccess(role)` in
    `src/lib/event-menu-access.ts` (tested): owner/admin `edit`, sales
    `view`, everyone else `none`. The page reads it to decide what to
    render and every write action reads it to decide whether to refuse;
    the database's own rule is the table's policies (owner/admin write,
    three roles read). Nik may open editing to sales later: one line
    there, one policy here. **The cost lock applies on top**, for everyone
    including owner and admin, through `assertCostNotLocked` in every
    action; at the database the RESTRICTIVE lock policies exempt
    owner/admin, exactly as item 33's do for menus and charges, so unlock
    still works.

    **The figures.** Discount against the dishes' own selling prices
    (4,800 of dishes sold as a 4,500 set = 6.25%) — sales may see it, both
    inputs being customer prices. Food cost and food-cost % (2,000 against
    4,500 = 44.44%) — owner and admin only, **not computed for anyone
    else**: the page enters the costing branch only for `edit`, and
    `buildEventMenuView` drops a cost for any other access as a second
    lock, which `event-menu.test.ts` holds up to `JSON.stringify` (the
    payload). The same two figures now sit on the set-menu management
    screen, which is `requireAdmin` and whose ต้นทุนรวม column sales
    could never open — checked, nothing to hide.

    **The 10% swap warning:** swapping a course for a dish more than 10%
    dearer or cheaper shows a warning (`swapPriceWarning`, exactly 10% is
    not "more than"); the confirm button stays. **Course options** are
    NOT built: a set stores its usual dish per course and the swap is how
    an alternative is chosen, as Nik decided.

    **Decisions made here because Nik had not, chosen for reversibility:**
    the copy hangs on the set LINE (a booking with 8 tables of one set and
    2 of another keeps two lists); the copy is per booking and not shared
    between bookings; a line from before the feature falls back rather
    than being auto-copied; the copy function is SECURITY DEFINER rather
    than a sales write policy (a policy cannot express "verbatim only");
    `set_name` is written by the database and read by no screen (the
    charge label names a custom set), so the code needs no new column to
    exist and can deploy before the SQL — every reader treats a missing
    table or function as "no copies".

    **The adversarial review (three independent readers, 2026-09-19, each
    told to break one thing):**
    - *Can sales reach a cost figure anywhere?* **No.** Every sales-reachable
      read selects names, counts, sections and customer prices by explicit
      column list; no sales-reachable path calls `getCostingContext()` or
      `computeMenuCost()`; the page's cost branch is entered for `edit`
      only and `buildEventMenuView` drops a cost for anything else. Noted,
      not a leak: the copy function admits sales by design (the picker
      needs it), which the table comment now states.
    - *Does the copy ever write back to the shared set?* **No** — the only
      writers of `catering_set_menus`/`_items` are the pre-existing admin
      editor, and the function only SELECTs from them. **But two real
      holes in the copy's own behaviour, both fixed before this record:**
      (1) a copy emptied to zero rows was indistinguishable from "never
      copied" and silently fell back to the CURRENT shared set on every
      screen, with a false legacy banner and no way to add a dish — the
      marker is now the line's `set_name` (stamped by the function), read
      by the resolver, the function and the add action; a copied line with
      no rows is a copy with no rows (`resolveDishes`, tested; migration
      test C4). (2) The price box's save removed every stored set line the
      screen did not send, so a custom set created on the menu page in a
      second tab was deleted, copy and charge with it, by an unrelated save
      — `saveBooking` now takes the ids the screen loaded with and drops
      only those; a line it never saw is kept, charge included. Also fixed:
      a line's displayed name followed the shared set's CURRENT name; the
      snapshot `set_name` now wins.
    - *Does a locked booking stay frozen?* **Yes, on every path** — the app
      refuses everyone (`assertCostNotLocked` first in every action, the
      event checked against the row's own event), the database refuses
      sales, and the function checks the lock itself. **One real gap,
      fixed:** a pre-feature booking's shared-set fallback stayed live after
      locking, and the lock then refused the cure. `lockCateringEventCost`
      now copies every never-copied set line first, while the booking is
      still unlocked, and snapshots from the copy.
    - **Accepted as theoretical, recorded so they are not rediscovered:**
      dish NAMES and PRICES in a copy are live joins to `menus` (the dish
      set is frozen, its label and price are not — round 2 could snapshot
      them); removing a set line and re-adding the same set in one save
      discards the edited copy and re-copies today's shared set (what was
      asked, literally, with no warning); a sales session can call the copy
      function directly on a never-copied line (it freezes what the screen
      already showed, unlogged); `source_set_menu_id`'s SET NULL is
      unreachable while the line exists (`set_menu_id` is RESTRICT); the
      check-then-write race under two simultaneous admins is the one menus
      and charges already have.

    **THE FIRST RUN FAILED, 2026-09-19 — nothing applied, rolled back
    clean.** `ERROR 42P01: relation "public.catering_event_menu_items" does
    not exist`, from the Step 0 survey. Two probes named the table this file
    creates, each with an `IF v_has` guard inside the same statement, and a
    guard inside a statement is not a guard: PL/pgSQL plans the whole thing
    before evaluating anything in it. Both are now `EXECUTE`, run only when
    `to_regclass` has already found the table, with a static ELSE that
    reports the pre-feature state (no copies, so every set line falls back).
    The rule is in AGENTS.md; a structural check now scans a migration for
    any object it creates being named in executable SQL before its own
    CREATE, and flags exactly those two lines on the file as Nik ran it.

    **THE SECOND RUN FAILED TOO, on the harness change the first fix
    brought in — nothing applied, rolled back.** `FAIL W3 sales adds a
    course — got "error (a policy on another table)
    denied:catering_event_menu_items", expected one of denied`. The refusal
    came from exactly the right table. The cause was not logic but
    ESCAPING: the pattern that reads the table out of a statement was
    patched in through a JavaScript template literal, where `\s` means `s`,
    so it arrived as `(?:inserts+into|update|deletes+from)s+...`, matched
    nothing, and left `v_table` NULL — after which every refusal fell to the
    "another table" branch. The failure direction was over-strict, never
    lax: a `denied:` result could only FAIL the run, never pass it.

    Fixed three ways at once, none of them a loosening: the pattern now uses
    POSIX classes (`[[:space:]]`, `[[:alnum:]_]`, `[.]`) and contains no
    backslash to lose; the attribution moved into `pg_temp.classify`, which
    RAISES when a refusal cannot be attributed to any table rather than
    guessing; and the file now **tests its own harness before it tests
    anything else** — X1 proves a refusal from the table under test reads as
    `denied` (insert, update and delete shapes, with and without the schema
    qualifier), X2 proves a refusal from another table does not, that an
    unattributable one raises, and that a non-refusal passes through
    untouched. Both run before the first test write, on the same function
    the probes use.

    Only one probe expects a bare `denied` (W3, the one that failed); six
    INSERT probes could receive a `denied:` result at all, and the broken
    mapping was wrong for every one of them. AGENTS.md carries the rule.

    **THE THIRD RUN COMPLETED, APPLIED THE OBJECTS, AND PROVED NOTHING.** It
    printed **8 rows of 31** and raised no error, so the table, `set_name`,
    the five policies and `catering_copy_set_menu` are LIVE in production
    with no evidence that any policy behaves correctly. The missing 23 rows
    are every permission test (C1–C4, R1–R2, W1–W7, K1–K3, L1–L4) plus S1
    and D1 — everything written inside the block that always aborts.

    **Why:** `pg_temp.note` accumulates into a session setting, and a session
    setting is TRANSACTIONAL. `set_config`'s third argument decides whether a
    value survives COMMIT, not whether it survives ABORT. The test block ends
    in a deliberate `RAISE ... 'U0002'` — that is how its writes are undone —
    and it took the record of the tests down with them. The eight survivors
    are exactly the rows written outside that block: the two self-tests, the
    four survey rows, the handler's line and Step 3's.

    **What it does NOT mean:** the tests were not skipped. The handler traps
    `U0002` alone, so any failed assertion would have propagated and aborted
    the file; reaching the abort proves all twenty passed. But that rests on
    reading the code, which is the standard this repo exists to refuse — so
    it counts for nothing until the re-run prints them.

    **Fixed:** the log is read into a PL/pgSQL variable on the last line
    before the abort and put back in the handler (a variable is not
    transactional), and **Step 3 now asserts the row count** against a
    declared constant, so a block that runs and reports nothing FAILS the
    file instead of passing quietly. The static checker no longer counts
    emitting sites in isolation: it compares its count with that constant,
    and it flags result lines written inside an always-aborting block whose
    handler restores nothing. Run against the file as production received
    it, the checker reports all three of this week's defects.

    **The next production run re-tests against the live objects and needs
    nothing undone first.** Every DDL statement is idempotent (IF NOT
    EXISTS, OR REPLACE, DROP-then-CREATE by name); the CHECK is dropped and
    re-added, which re-validates the existing rows; Step 2 clones a booking,
    runs all twenty probes against the live table and policies, and rolls
    back. If a policy is in fact wrong, the run FAILS and rolls back —
    leaving the already-applied objects exactly as they are, which is the
    information that is currently missing. `copies already stored: 0` and
    the app is not deployed, so nothing real depends on the table yet.

    **Verified locally:** typecheck, lint, 328 tests (19 new), build — no
    application file changed for any of the three migration fixes. The migration is
    re-checked for structure, `format()` arity, parse-time references, and
    now de-escaped regex literals (a check that flags the broken file and
    leaves the two applied harnesses alone), plus a line-by-line comparison
    against the applied `catering_history` harness with every difference
    justified. Its pattern was also simulated against all 20 probe
    statements: 13 writes, every table read correctly; 7 reads, which never
    produce a `denied:` result. **The file prints 31 result rows.** It is
    still unexecuted — no production access from here.

**Closed 2026-09-10 — break-even page** (`e64be14` migration, `8235094`,
`7d516e0`; item 3 of the original handoff, the reason `cost_behavior` was
migrated). `/owner/accounting/break-even`: four figures — contribution
margin, fixed costs, break-even revenue, safety margin — plus bills to break
even from `monthly_covers`, and one sentence of basis. Pure
`break-even.ts` with tests carries the resolution rule; the page reuses
`getMonthlySummary`. **Counts what the rule says, not what the grouping
says:** Tax, CapEx and `998` are excluded, and the excluded amount is shown.
**Fixed is fixed BY HEADER for seven groups** (Occupancy, Maintenance,
Utilities, Marketing, G&A, Supply, Misc; only labour is split per account),
so the page names them and calls the margin an approximation of a known
shape — the true margin is somewhat lower, the true break-even somewhat
higher. For an admin, 790 is withheld, so the page says in the same
sentence as the count that the break-even shown is *lower* than the true
one and the safety margin *higher*. August 2569 with 998 excluded: margin
47.0%, fixed 1,522,746, break-even 3,236,968 = 83.4% of revenue, safety
643,677, 2,244 bills (≈73/day against 87). July: margin 50.3%, break-even
90.3%, safety 309,510. No table, no chart, no trend — a history or per-day
view is a different item and was not started.

**The August figures above were re-verified on 2026-09-16 and are
CORRECT** (item 10's correction), so an earlier note calling them suspect
was wrong. They reproduce to the satang from an ordered read. What the
unordered read produces today is break-even 3,074,631 = 79.2%, and that
is what the page would have shown whenever the query plan matched the
replay.

**Closed 2026-09-10 — `monthly_covers`, bills and customers per month**
(`dd24e2c` migration, `3bd7eec`, `545e14f`, was item 15). Written by
`import_pos_month` in the SAME call as the revenue — `p_covers` is required
and NULL is refused — so covers and revenue can never come from different
exports; the delete-and-insert rule covers the tenth row. **Counts are
stored, averages are not:** the POS's own ฿/bill and ฿/head divide its
net-of-discount total including the coffee shop (3,881,934 in August); the
summary divides the app's own revenue by the counts, so August reads
≈1,442.62 ฿/bill and 580.41 ฿/customer against the POS's 1,443.10 and
580.61 — one basis on one screen. The old seven-parameter RPC overload was
dropped explicitly (CREATE OR REPLACE with a new parameter list would have
left both in place, the old one silently accepting calls without covers),
and `pos_revenue_import_rpc.sql` now opens with a DO NOT RE-RUN box for the
same reason. Display is the minimum: one line under the summary's KPI cards
(hidden when the month has no row, never zeros) and two count rows on the
print P&L and its xlsx. A month imported before covers existed gains its
row on re-run; the preview says "จะเพิ่มให้". July and August were re-run
2026-09-10 (July 2,346 bills / 5,655 customers / 23 cancelled ฿75,471;
August 2,690 / 6,686 / 19 ฿52,974). **June 2569 was POS-imported the same
day before commit 1 deployed and has no covers row until re-run.** Nothing
else in the app counts bills or customers; catering's "customers" are
booking contacts, a different thing.

**Closed 2026-09-10 — upload UX, one pattern everywhere** (`051dcd4`,
`8a9ef2b`; was item 17, renumbered 16 when the tool row closed). Every owner upload is now select → อ่านไฟล์, with
the File held in state and a new selection dropping what the old one
produced, the shape `import-state.ts` established. Dashboard sales import:
used to parse on select. Classification screen: used `<form action>`; a
new file after decisions were made now confirms first, because dropping
touched rows silently would be its own failure. Price importer, its own
plan because it changed a write trigger: it used to **write deliveries on
select, before any confirm**; now select → อ่านไฟล์ (parse only, shows rows,
materials and **the date range the file covers**, the one moment coverage is
visible since the checklist cannot verify it) → *บันทึกประวัติรับของ N แถว
แล้วดูราคา*, the one write, same chunked idempotent ingest, server action
untouched → preview → ยืนยัน. SOP photos are not an owner import and stay
as they are.

**Closed 2026-09-10 — the tool row and start-of-month checklist** (`34b4489`,
was item 16). One `ToolRow` on the month view, บันทึกรายวัน and สรุปรายเดือน,
grouped ทุกวัน | ทุกเดือน (dependency order) | ตั้งค่า; the owner-only import
link renders only for the owner, because an admin had been shown a link that
bounced them. The checklist (`checklist.ts`, pure, tested) has **five** steps
for the month that just closed, not the six once planned: the accountant's
file (step 5) writes `other`, so the "typed `other`" step no longer exists.
Each step is derived from evidence — prices: the deliveries record reaches
past month end (`imported_at` cannot be used, the importer upserts and keeps
the first insert); sales: the single `pos_import_meta` row, a later month
shown as a date, never a tick; classification: implied by the revenue import;
revenue and the accountant's file: exact per-month rows, a budget69-only
month reads as partial. Panel expands with three or more open steps, one line
otherwise, hidden when all done. Verified on live evidence for August before
and after Nik's import.

40. **A booking a room conflict has frozen cannot be edited at all — so it
    cannot be re-issued, and so it cannot be cost-locked** (found by the
    review of the lock precondition, 2026-09-20). **NOT STARTED. Nik's
    decision is to leave it for later. PRE-EXISTING — no part of it was
    caused by the per-event menu work or by the lock precondition**, which
    only made one of its consequences visible.

    `saveBooking` calls `upsertCateringEvent` first, and that throws on a
    room conflict before anything is written; the booking screen's own save
    button is disabled by the same rule. So a booking in conflict cannot be
    saved by any route through the app. Two things follow, and the second
    is the new one:

    - **Nothing about it can be corrected** — not the customer, not the
      note, not the price box — until the conflict is gone. The cure for a
      conflict is editing one of the two bookings, and if the OTHER one is
      the one that should move, this one is simply stuck meanwhile.
    - **It therefore cannot be re-issued**, because `quoted_total` is only
      written through `saveBooking`. With the staleness guard in place, a
      frozen booking whose lines changed before it froze can no longer be
      cost-locked either, and there is no way out inside the app.

    **What makes it wider than it sounds:** `findRoomConflict` treats a
    MISSING start or end time on either side as a same-day conflict. So a
    finished in-house booking in room_v1 can be frozen by an unrelated
    "inquiry" on the same date that nobody has put times on yet. The
    server-side rule was added after the client-side one, so bookings
    already in this state may exist.

    **Not designed.** The obvious repairs each have a cost: letting a
    `done` booking save through a conflict weakens the rule exactly where
    double-booking would be most expensive; an admin override needs a place
    to live and a record of who used it; a separate "record the revenue
    total" action avoids the whole save path but adds a second writer of
    `quoted_total`. Nik picks the shape when he picks it up.

41. **A remount discards unsaved work on the booking screen without asking**
    (found by the review of the unsaved-changes guard, 2026-09-20).
    **DONE with item 47: committed `bb94d3a`, deployed 2026-09-22.** Nik had
    decided to leave it until the booking screen was more settled and to do
    it before sales starts using the module for real; he asked for it on
    2026-09-21. What was built is under item 47; the problem as found:

    `[id]/page.tsx` keys `BookingScreen` on its charge rows, so that a save
    cannot leave the screen holding the state it was saved FROM — the defect
    that used to delete a set line and its copy on the next save. The cost
    is that ANY change to those rows re-initialises the screen. If a
    `router.refresh()` lands while another writer has changed them — the
    menu page in a second tab, which is a second writer of set lines by
    design, or a second sales login — the key changes, `form`, `lines` and
    the guard's own baseline are all rebuilt from the server, the person's
    typing is gone, and the guard reports clean because its baseline moved
    with it. The in-page trigger already exists: the activity log refreshes.

    **Typing into the form while a save is in flight loses the same way.**
    The price box disables itself during a save; the booking form does not,
    so anything typed in that window is baselined as saved and then thrown
    away by the remount that follows.

    **The menu page already solves this shape** (`EventMenuClient`): it
    keeps a fingerprint of the server view, adopts new data only when the
    draft is clean or the change is the person's own save landing, and
    otherwise holds the draft and says the data moved. **The fix here is to
    move that decision INSIDE the booking screen** rather than keying it
    from the parent — which is a real change to the most-used screen in the
    module, which is why it is queued rather than done.

42. **An SOP step-photo upload can undo other edits in the same section**
    (found by the review of the SOP form's guard, 2026-09-21). **NOT
    STARTED. Pre-existing — not caused by the guard.** The upload in
    `sop-photo-upload.tsx` calls back into `sop-step-list.tsx` with the
    list as it stood WHEN THE FILE WAS PICKED, and `sop-form.tsx` replaces
    the whole section with that list. Resizing and uploading takes seconds;
    a step typed, removed or moved in the same section meanwhile is
    reverted when the upload lands. The unsaved-changes comparison then
    faithfully reports the reverted state, so nothing warns. The fix is to
    update the photo by the step's `tempId` against the CURRENT list (let
    the step list call `set(prev => …)`), or to lock the section while an
    upload is in flight.

43. **A step whose text is blank loses its photo on save** (found by the
    same review, 2026-09-21). **NOT STARTED. Pre-existing.** `upsertSop`
    keeps only lines whose text is not blank
    (`.filter((s) => s.text.trim())`), photo or not, so a step that is only
    a photo is dropped whole. The unsaved-changes comparison mirrors the save
    on purpose — adding a photo to an empty step is not a change, because
    saving would not keep it either — so the head chef loses the photo
    whether they save or leave, with no warning. Either the save keeps a
    step that has a photo, or the screen refuses to save one without text
    and says why. Nik's call.

44. **The prep yield editor has no unsaved-changes guard, and its own dirty
    check compares text** (found by the same review, 2026-09-21). **NOT
    STARTED.** `prep-yield-editor.tsx` (on the prep recipe page, beside the
    recipe editor) loses an edited batch yield silently on any in-app link,
    on sign-out and on closing the tab. Its unsaved check compares the typed
    text with the props, so "8.0" stays unsaved after saving 8, and nothing
    clears it after ส่งขออนุมัติ. That check has to become a comparison of
    the number a save would send against what was last saved — the recipe
    editor's model — BEFORE `useLeaveGuard` goes on it, or the guard will
    warn on a form nobody changed.

45. **Rotate the Supabase keys — OPEN AND IMPORTANT. Postponed by Nik on
    2026-09-21.** The service-role key bypasses every RLS policy. It sits in
    full in two Claude transcripts on this PC, about 120 times between
    2026-06-27 and 2026-08-18, so it has left the machine in plaintext. It
    was never committed and never reached the browser bundle (checked
    2026-09-21; AGENTS.md). Until it is rotated, AGENTS.md's rule holds:
    read-only use against production, reported each time. The steps, in
    order: Supabase → Project Settings → API Keys → create a secret key
    (`sb_secret_…`) and use the publishable key (`sb_publishable_…`); put
    them in `app/.env.local` and in the Vercel project **sompong-system**
    (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`);
    redeploy; check that the app works (sign in, `/owner/team`); only THEN
    deactivate the legacy keys, which can be undone. The old Vercel project
    **app** (app-five-orpin-49.vercel.app) holds the key too until it is
    deleted.

46. **Nik or the head chef: three menus sold by weight** (Nik, 2026-09-21).
    Named exactly as in the POS, per kilo:
    - ปูม้าใหญ่ผัดพริกไทยดำ — ฿1,200 a kilo; ปูม้าเป็น 10 ขีด + the sauce
      for a kilo.
    - กั้งกระดานนึ่ง — ฿1,300 a kilo; กั้งกระดาน 1 โล.
    - กั้งกระดานทอดกระเทียม — ฿1,300 a kilo; กั้งกระดาน 1 โล + the
      garlic-fry ingredients.
    Each needs ÷10 on its POS name at the next import (หาร in the import).
    Later, a menu for "กุ้งแม่น้ำ Salt 4 lines", a different dish from
    กุ้งแม่น้ำเผา 4 ขีด.

47. **The booking screen's price box is saved in ONE transaction, every line
    checked first** (Nik, 2026-09-21). **DONE: its migration
    `catering_booking_prices_save_migration.sql` applied 2026-09-22 (see
    "Applied since"); the code committed `bb94d3a` and deployed the same
    day. A booking tab left open across that deploy has to be reloaded.**
    Closes the two data-loss risks Nik named before sales uses the module
    for real:
    - **A bad line emptied the price box.** saveBooking removed dropped
      menu lines, added new ones, then deleted EVERY charge row of the
      booking and inserted the new list — so one line the insert refused
      (no amount, a string, an overflowing figure, a negative price on a
      typed line) left the booking with no price lines. Now every line is
      checked on the screen (naming it), again in saveBooking
      (`bookingLinesProblem`, booking-lines.ts), and again by the database
      in a DRY RUN before anything at all is written; then the booking's own
      fields are written (compare-and-set on `updated_at`), then the whole
      price box by `catering_save_booking_prices` in one transaction, which
      moves `updated_at` again. A failure in the middle of that write undoes
      all of it — the migration proves it by breaking a new set's copy AFTER
      the charges were deleted and six rewritten (P10), and re-saves every
      real booking unchanged, touching nothing outside it, rolled back (E1).
      The booking's own fields and the price box are two transactions: if
      the second fails, the price box is exactly as it was, the screen says
      the fields were saved, and a retry saves the same booking.
    - **Item 41, done with it.** The page keys the screen on the booking
      alone; new server data is taken when the form is clean or the
      person's own save lands, and otherwise held with a banner
      (`serverViewAction`, booking-dirty.ts); the whole form locks from the
      click until the saved data is on screen. A save sends the booking's
      `updated_at` as the screen took it, so a second booking-screen save
      in between is refused rather than written over. A failed save keeps
      the draft on screen with "โหลดข้อมูลล่าสุด" beside the message, and so
      does a save that brings no answer at all — a dropped connection, a
      deploy mid-session, a sign-in that has ended — which used to replace
      the screen, draft and all.
    - **The history names what was removed** — "ลบเมนู: <set_name>" for a
      custom or copied set, where it used to read "ลบเมนู: -". The three
      old "-" lines are left as they are.
    - **Nik's two quantity decisions:** the whole-count refusal names the
      booking's own unit (โต๊ะ / กล่อง / ชุด, the kitchen sheet's word), and
      a dish quantity takes at most three decimals — on the booking screen,
      the menu page and the set-menu screen — so the quote and the sheets
      print the same number, and below 0.001 is refused, not printed blank.
    - **The adversarial review (four reviewers, 2026-09-21)** found one
      blocker, fixed: after a partial save, the screen took the booking's
      CURRENT menu lines as the ones its draft was based on, so the retry
      removed a set the menu page had added meanwhile, with its charge and
      courses (`seenAfter`, booking-dirty.ts; reproduced on the real screen
      before the fix, gone after). Also fixed from it: the price box moving
      the token (above); a failure after the booking row but before the
      price box (the staff list) reported with the booking's id and token;
      a save whose price box landed but whose quotation failed taken like a
      successful one; no automatic refresh after a failed save except a
      conflict; a lost answer on a new booking saying to look in the list
      before saving again; a new booking's retry no longer clashing with its
      own room; charges loaded
      in a fixed order (`sort_order`, then id); a NULL dry-run flag refused;
      and the migration's own checks widened (E1 compares every other
      booking, the copied courses and the sort order; Step 3 covers booking
      rows and asserts one function of the name). Recorded, not fixed:
      items 48–50.
    - **Still open, deliberately:** the browser's Back button loses a draft
      without asking (decided for the menu page, for the same reason);
      `upsertCateringEvent` still replaces the staff list by
      delete-then-insert, and a new customer typed on a save that is then
      refused as a conflict stays as a customer (a race: the conflict is
      checked before any write first). The function's EXECUTE is left at
      the default, as `catering_save_event_menus`'s is: a caller with no
      profile role is refused before anything is read. Rare and visible,
      recorded by the check of the fixes: when a save's answer is lost after
      its price box landed, a line it created and the person then removes is
      kept (it is not yet the screen's own) and shows again when the next
      save lands; a page load that straddles another screen's save by
      milliseconds can take the new token with the old price box (the page
      reads both at once); on the new-booking page a conflict after a
      partial save has no "โหลดข้อมูลล่าสุด" (open the booking's own page).
    - **The migration ran 2026-09-22**, first time, 46 rows all ok (the
      table under "Applied since"). A re-run must also be made while nobody
      is saving a booking: Step 3 compares whole-table checksums, so a save
      during the run rolls the whole file back. Its tests break the
      one-row-per-test-write rule on purpose, all inside the rolled-back
      block; Nik accepted that for this file.

48. **The menu page's save does not wait for the booking screen's**
    (review of item 47, 2026-09-21). **NOT STARTED. Existed before item 47,
    which narrows it.** `catering_save_booking_prices` locks the booking
    row; `catering_save_event_menus` does not, and its price and course
    updates take no lock that waits for it. If a menu-page save lands while
    a booking-screen save is between deleting and re-writing the charges,
    the menu page finds its set's charge gone and inserts another: the set
    prints twice, the total counts it twice, and the next booking-screen
    save is refused ("the same line twice") until someone removes one.
    Landing just before the delete, its new price is written back to the
    old one. The window is milliseconds (it used to be the whole time the
    screen was open). The fix: `catering_save_event_menus` takes the same
    `FOR UPDATE` on the booking row first — a CREATE OR REPLACE of an
    applied function, so read its live definition first (AGENTS.md, rule 4).

49. **The booking screen writes the customer's address and contact back on
    every save** (review of item 47, 2026-09-21). **DONE: approved by Nik,
    committed `fd160fd`, deployed 2026-09-22. Existed before item 47.** The
    screen has no inputs for them, but `formToUpsertPayload`
    always sent `customer_edits`, so a change made on the customer page
    while a booking was open was undone by that booking's next save.
    **Fixed by writing none, deliberately:** the screen never let anyone
    edit a customer's address, contact person, LINE or company, so all it
    could send back was what it had loaded — and a customer picked, then
    renamed, handed that customer's address and contact to the new one. The
    form holds no customer details now (`booking-form.ts`); the payload
    sends the picked id, or the name and phone typed; and
    `upsertCateringEvent` ignores anything more from an older screen, its
    one customer write being a new customer's name and phone
    (`customer-pick.test.ts` checks the source). The customer page is the
    one place a customer's details change. Should the booking screen ever
    get such an input, it sends what was edited, never what was loaded.

50. **Picking a customer from the list never keeps the pick** (review of
    item 47, 2026-09-21). **DONE: approved by Nik, committed `fd160fd`,
    deployed 2026-09-22. Existed before item 47.** `CustomerCombobox`
    (shared.tsx) called `onPick`, then `onQueryChange` with the name, and
    the booking screen's `onQueryChange` clears `customerId`, so every pick
    reached the save as a typed name with no phone, and the save took the
    FIRST customer of that name (no phone could match an empty one). Now a
    pick is one update, the id and the name together (`pickCustomer`), the
    list calls nothing after it, and the save attaches exactly that id,
    checked to exist. A TYPED name follows one rule on the screen and in
    the save (`matchTypedCustomer`, customer-match.ts), which the save runs
    against every customer on file: the one customer whose name AND phone
    match; a new customer when nobody has the name, or when every namesake
    has another real phone; otherwise refused before anything is written,
    saying the way out — no phone typed, a namesake with no phone on file
    (the phone cannot tell them apart: pick, or make the name distinct),
    namesakes sharing the phone, or a phone number typed as the name. A
    line under the name box says which it will be before the save. A name
    is the same name after NFC, zero-width characters dropped, whitespace
    as one space, trimmed, case aside; a phone is its digits, Thai digits
    and +66 read as what they are, and under 9 digits it proves nothing, so
    a placeholder like "000" can never make two people one. A new customer
    is added only after the room check, right before the booking row, and
    any failure hands the save's customer back, so the retry sends it as a
    pick instead of meeting it as a second of the name. The review
    (2026-09-22, two reviewers) found no wrong attachment; its findings
    were fixed as above, or are item 51.
    **Production, read-only 2026-09-22:** 14 customers, no two share a
    name, and all 4 bookings are attached as their creation shows (three
    customers made in the same minute as their booking, one existing
    "test"), so the bug had nothing to misattach yet. Two test customers
    share an address and contact ("อู๋", "aiatest", 26 Aug, no bookings),
    and two share a 3-digit phone ("พี่ไก่", "aa").

51. **A customer-page edit can still be lost — to the customer page itself**
    (review of items 49–50, 2026-09-22). **DONE: asked for by Nik,
    committed `2a3b52f`, deployed 2026-09-22. Existed before; no booking
    save is involved.** `CustomerDetailClient` fills its form
    once, when the page opens, and `updateCateringCustomer` writes all eight
    fields with no conflict check (and takes a zero-row answer as success),
    so an older copy of the page — a second tab, a second login, or one
    brought back by the browser's Back button — writes its stale values over
    a newer edit, silently; nothing records customer changes, so no trace
    is left. The page also has no unsaved-changes guard, and typing while it
    saves is dropped.
    **What shipped (no SQL).**
    - The save is a compare-and-set on the `updated_at` the edit started
      from; `catering_customers.updated_at` is stamped by its BEFORE UPDATE
      trigger.
    - If someone else saved in between, the save is refused and nothing is
      written. The page shows a Thai message and a โหลดข้อมูลล่าสุด button,
      and the draft is kept.
    - An edit starts from the page's current data when แก้ไข is pressed.
    - `useLeaveGuard` guards an unsaved edit, the same model as the booking
      screen and the menu page; Back stays uncaught.
    - The whole form is locked through the save and the refresh.
    - `customer-page.test.ts` checks the save and the page on parsed
      source. It fails on the old files and on each regression the review
      tried.

    **Review (2026-09-22, independent, adversarial): no blocker.**
    Accepted, not fixed:
    - `requireSales()` inside the save redirects a caller whose role was
      changed away, or whose profile is gone, and that navigation drops an
      open draft without asking. Rare, and it existed before.
    - On phones, closing the tab or the OS discarding it shows no leave
      prompt, as on the booking screen.
    - After a conflict, the only way to the latest data is to discard the
      draft; the page asks first.
    - Unchecked: whether a tab opened before a deploy can still reach the
      old, unchecked save. That depends on Vercel's Skew Protection and on
      `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Sales reloads open tabs after
      each deploy either way.

**Checked and closed 2026-09-09, not queued:** every `page.tsx` under
`src/app/owner` has at least one link to it. The one grep miss,
`/owner/hr/schedule/print`, is opened through a computed `printUrl` in
`ScheduleClient.tsx`. `/owner/accounting/revenue-import` was linked from the
accounting tool row in the same commit that created it (`d56a5ee`).

**Stale two days later — found 2026-09-16.** `665f458` (2026-09-11) took
ต้นทุนภายใน off the catering sub-nav and wrote a comment saying the page was
linked from a booking's cost page. No such link existed, so
`/owner/catering/cost-settings` was reachable only by typing its URL until
the **ตั้งค่าต้นทุนภายใน** link beside + เพิ่มต้นทุน was added. Nik looked for it
on that page and could not find it. A one-time check stays true only until
the next change. Re-run on 2026-09-16 as a scan of the parsed code (every
string in `src` that could navigate to each of the 44 owner pages,
`revalidatePath` arguments excluded). It was run against HEAD first, where
it must find cost-settings. Its first version did not: a `${...}`
placeholder matched a fixed path segment, so `/owner/catering/${id}`
counted as a link to cost-settings. Fixed, it finds 2 on HEAD and 1 after
the link: `/owner/catering/status`, queued as item 26.

## The catering module is in informal use by sales (Nik, 2026-09-22)

As of 2026-09-22 sales is using the catering module informally, for real
customers, and any booking may be edited or redone at any time. So a small
or odd-looking booking may be real. What follows from that:

- **Never assume a row is test data from how it looks.** Anything to delete
  is listed for Nik first — what it is, why it looks like a test, who made it
  and when, what depends on it and what deleting it takes along — split into
  "clearly test" and "unsure", and deleted only by id, in one migration, after
  he has confirmed each row. A booking that could be a real informal one is
  "unsure".
- **Every deploy lands while bookings are being taken.** A booking or
  customer tab left open across a deploy must be reloaded; tell sales after
  each push that touches the catering screens.

**The test data: CLOSED 2026-09-22.** Listed that day from a read-only
production read (16:31, re-read 19:06), confirmed by Nik row by row, and
deleted by id by `test_data_cleanup_migration.sql` (applied 2026-09-22, see
"Applied since"): 3 bookings, 12 customers, the shared set test1, the ฿0
menu "test" and the prep "Test เตรียม", with everything that hung on them.
What remains is real: one booking (คุณป้อม, 232a32c6), two customers
(คุณป้อม, พานาโซนิค) and three set menus. Any later clean-up follows the
rule above: list first, delete by id after Nik confirms.

## The three catering documents — built 2026-09-11/12

The whole customer- and staff-facing paper of the catering module, rebuilt
against the documents Nik's team actually uses. His team booked on Excel and
paper because the module had too many pages and fields; the direction was
REDUCE, and the paper was the spec.

Confirmation stands where it stands: **B is confirmed on paper by Nik**
(after two corrections his screenshots caught — the multiplier and the
missing table head). A's grouping is proven through the same expansion B
prints. **C has not been printed by him yet** — he is printing all three
states after running the widening migration below.

| | route | reader | commits |
|---|---|---|---|
| **A** ใบฟังก์ชั่นงาน — ฝ่ายบริการ | `[id]/function-sheet` | the floor | `d366869` (+ editor `af825db`) |
| **B** ใบฟังก์ชั่นงาน — ฝ่ายครัว | `[id]/kitchen-sheet` | the kitchen | `0f14a7f`, corrected `62cd336` |
| **C** ใบเสนอราคา / ใบมัดจำ / ใบแจ้งหนี้ | `[id]/quote?doc=` | the customer | `0b35334` |

All three group a package's food the same way, from ONE expansion
(`groupBySection` over the rows `getEventMenuDishes` returns — since
2026-09-19 the booking's OWN copy of its set, `catering_event_menu_items`,
or the shared `catering_set_menu_items` for a booking from before the copy
existed; queue item 39): the customer, the floor and the kitchen cannot be
told three different things. **The print
contract:** a section with no rows prints nothing at all — no heading, no
blank row. Verified end-to-end by Nik: setting one dessert made ขนมหวาน
separate on the printed sheet.

### The rules that are NOT obvious from the layouts

- **B's ราคา column is a PORTION SIZE, not money** — the selling price
  alone ("1,000/กก." for a dish sold by weight), never multiplied. The COUNT
  has its own จำนวน column since 2026-09-21: per-set quantity × sets
  ordered = the whole job ("0.5 กก. × 20 โต๊ะ = 10 กก.", "1 × 10 โต๊ะ =
  10"), rounded to three decimals, the unit โต๊ะ / กล่อง / ชุด by food
  format, and service sheet A prints the same cell through the same
  function (dishAmount). It used to be one "price x plates" cell, and half
  a kilo a table for 20 tables read "1,000 x 10": ten one-kilo plates.
  A dish prints in kilos when a POS divisor of 10 points at it — the
  marker of Nik's kilo rule (see "Dishes sold by weight"). THE MULTIPLIER
  (plates for the whole job, `plateCount()`) TOOK THREE READINGS — table
  count, then per-set count alone, both shipped and both wrong on paper;
  the paper's "590 x 6" was 1 × 6 sets, which all three readings happened
  to equal, so only Nik's real 10-set booking could tell them apart. The
  full history is beside plateCount() in src/lib/kitchen-sheet.ts. No row
  total, no grand total — the dishes deliberately do not sum to the package
  price. Extras print their price and count too, never a blank. EXCEPT a buffet:
  `food_format = 'buffet'` blanks the ราคา and จำนวน columns, because Nik's
  paper buffet sheet has no per-dish prices — a buffet is cooked to the
  header's guest count. That is the only buffet rule built; how a buffet
  booking is shaped, and what its จำนวน column should say, waits for the
  first REAL buffet booking — deliberately, because the multiplier's three
  readings showed what guessing from one example costs.
- **Header colours carry meaning.** B: blue = งานภายใน, red = งานภายนอก;
  an unknown location_type reads as ภายนอก (nobody loads a van for a job they
  think is in-house). C: the green band, white on green. All of them set
  `print-color-adjust` on the element itself, because a browser that drops
  the colour drops the meaning.
- **C is one number across three states.** quote/deposit/invoice are the same
  agreement at three moments; the deposit and invoice add money rows, never a
  new reference.
- **The deposit has three states** (`deposit_percent`): NULL = not yet
  discussed, prints `______%` to write in; **0 = agreed no deposit**, every
  deposit clause and row omitted (not "0%", not a blank), the 7-day notice
  kept without its no-refund tail; 1–100 = agreed, printed. The booking form
  pre-fills 30 on NEW bookings only — a form default, never a column default.
  The invoice deducts what was RECEIVED (`deposit_amount`), never what the
  percentage implies: term and fact are two fields on purpose.
- **C's conditions wording is Nik's, read off photographs of ONE job's
  paperwork** — 15 days' validity, deposit to confirm, 7 days' notice. Not a
  stated policy document; he is confirming or amending the final text. It
  replaced text that was invented outright (30 days / 50%), which was worse.
- Fields with no column print as ruled lines to write on, stated at each
  site: **ประเภทงาน** (A and B) and **ค่าไฟ** (A — see queue item 16, the
  same missing column as the music routing).

The rules live in `src/lib/function-sheet.ts`, `kitchen-sheet.ts` and
`quote-doc.ts` — pure, ~40 tests — because the pages sit behind login and the
module held almost no data while they were built; fixtures exercised what the
database could not. What that leaves UNVERIFIED is layout: A4 fit, long
labels, page breaks — the verification pass (points 7/8/9 of the original
plan) is queued as its own item.

Still open from this stream: item 15 (catering cost — recipes are data entry,
the mechanism already exists), item 16 (now ready to put to Nik — B and C are
done), and the verification pass.

**Dates on the booking form (held fallback).** The native date input renders
in the BROWSER's locale — measured on an en-US Chromium: `lang="th"` at page,
wrapper and input level all still print 09/14/2026, so no markup forces
dd/mm/yyyy. Shipped fix: the Thai reading (`thDate`) prints under the field.
Advice to Nik: set the device/browser display language to Thai and every date
input renders dd/mm/yyyy natively. HELD fallback, only if he still trips
after both: a masked dd/mm/yyyy text input. It is held because staff would
type the Buddhist year into it — the accountant's 2-digit-BE-read-as-1968 bug
again, paid per screen — so it needs a year>2300 ⇒ −543 guard and an app-wide
rollout to be worth having.

## Anonymous access: `day_swap_requests` and `pos_import_meta`, found 2026-09-16

**Demonstrated.** A read-only request with the public anon key (it ships in
the app's JavaScript) and no login returned:

- all 7 `day_swap_requests` rows: employee ids, work and off dates, swap
  type, compensation, notes;
- the one `pos_import_meta` row: the last POS sales import's date range
  and time.

Every table and view the API exposes (63) was read the same way; these were
the only two that answered.

**Inferred, not tested: anonymous WRITES.** Both policies were
`FOR ALL USING (true) WITH CHECK (true)` with no `TO` clause, so they applied
to `anon` as well. A write made from outside cannot be rolled back, so none
was tried. The `compensation` column accepts `extra_pay`, which is a payroll
input; all 7 current rows are `bank_day`.

**Why it has not mattered: HR is not in use yet** (Nik, 2026-09-16). The 7
rows date from 2026-07-26/27, entered in the module's first week.

**The template is the defect.** Both policies were named "owner can manage
<table>": a restriction by name and none by rule. Same family as
`is_owner()`: the name is not evidence. Closed by
`close_open_template_policies_migration.sql` (`3248e39`), which Nik ran on
2026-09-16; it was NOT held for the HR rebuild. `day_swap_requests` gets
the other HR tables' shape (read owner/hr/admin, write owner/hr);
`pos_import_meta` is read by any signed-in user and written by owner/admin.
Every new policy is TO authenticated.

**Verified the same day, and what that proves.**

- The anonymous scan returns **0 of 63**, against 2 before.
- Read with the service key, the rows are still there (7 and 1). The
  service key BYPASSES RLS, so this proves no data was lost, and NOT that
  signed-in users can still read. A migration that shut everyone out
  would show the same 7 and 1.
- The signed-in side rests on two things. First, the migration's own
  pre-COMMIT check: six policies, all TO authenticated, RLS on. Second,
  for `pos_import_meta`, the "last import" line on the `/owner` home page,
  which any signed-in account sees.
- A signed-in read of `day_swap_requests` is the HR access check, held for
  the rebuild.

### Did the 2026-07-31 HR audit predate the table, or miss it? It MISSED it.

**The table came first.**
- 2026-07-24: `hr_role_patch.sql` (`5913585`) rewrote the policies of every
  HR table that existed that day.
- 2026-07-25: `day_swap_requests` arrived with the day-swap page
  (`30550da`), in its own file (`day_swap_migration.sql`) and with the old
  open template.
- 2026-07-26/27: its 7 rows were written.
- 2026-07-30/31: the audit ran.

**The audit knew the table.** Its own record notes day-swap data ("not
imported for 15 service dept employees"), and the session worked with it
at length.

**It missed the policy for two reasons,** both visible in that session's
transcript:

1. **It never read the live database.** Querying `pg_policies` through the
   REST API failed ("RLS status was UNKNOWN because we couldn't query
   pg_policies via REST"), so it read the migration FILES instead, and
   `hr_role_patch.sql` does not contain the day-swap policy. The result was
   recorded as "RLS policies ✓" without saying it came from the files. A
   check that falls back to a weaker source and reports as the stronger one
   is the same shape as the August P&L recomputation that shared the page's
   paging.
2. **Its conclusion was wider than its scope.** It checked four tables
   (employees, payroll_entries, payroll_periods, leave_requests) and
   recorded "staff role has no access to any HR table".

**For the rebuild's single audit:**

1. **Whenever a check falls back to a weaker source, SAY SO IN ITS
   RESULT.** This comes first because it is the general form of everything
   that went wrong this week:
   - this audit recorded "RLS ✓" from migration files after the live
     query failed;
   - the August P&L was "recomputed the page's way" with the page's own
     paging;
   - the prep design read `is_owner()`'s first definition instead of the
     live one.

   Each time, a weaker check was reported as if it were the stronger one.
   The result must name its source, e.g. "from the files, not live", or
   it is not a result.
2. Read the LIVE policies (`pg_policies`, plus `pg_class.relrowsecurity`).
3. Take the table list from the catalogue or from the code's `.from(`
   calls, not from memory.
4. Run the anonymous scan (every exposed relation, public key, no login).
   It is cheap, and it is the check that found this.
## Prep-recipe visibility — closed 2026-09-15 in four steps; OPEN TO ADMINS until 2026-09-16

The 48 prep recipes are the restaurant's actual asset: a dish recipe is
useless to a competitor without น้ำจิ้มซีฟู๊ด, น้ำนึ่งซีอิ๊ว and the rest.
Nik's review of staff permissions concluded that almost nothing else needs
restricting — nobody has misused access, the head-of-department group works
across each other's areas deliberately, SOPs and dish recipes can be copied
out anyway — so **no role was added**. Six is enough. This is a third
instance of the existing capability-flag idea (`employees.takes_bookings`,
`coa.is_sensitive`), not a new mechanism.

**His two rules.** Closed by default: all 48 start hidden and he opens them
one at a time to named people, with a prep created later hidden from the
moment it exists. And no name leak: someone without access does not see the
row at all — absent from the list, and the URL does not serve it.

**Why it took four steps rather than one.** Flipping the RLS policies first
would have hidden `prep_recipe_items` from the session the server components
run as, so `resolveUnitCosts` would have computed NULL for those preps and
**112 of 244 dishes** would have reported an incomplete cost to exactly the
people meant to keep working. A cost is a number and a recipe is a list; only
the list is restricted. So:

| step | what | commit |
|---|---|---|
| 1 | `prep_recipe_access`, `can_see_prep()`, `prep_unit_costs()`, and the `recipe_item_history` policy. Inert on the prep tables. | `706cc82` |
| 2 | The app: cost path onto the RPC with the TS prep-resolution branch deleted, and every leak surface filtered. | `e34a530` |
| 3 | Grants — เฮง and เวช, by script, then the owner-only grant screen so no third person needs SQL. | `104188b`, `cada5bb`, `ae8a88f` |
| 4 | The RLS policies narrowed, closing direct PostgREST reads. | `659791b` |
| 5 | **The owner bypass made owner-only** — steps 1–4 had shipped it on `is_owner()`, which admits admins. The app layer made independent; the creates stop reading back. See below. | `ef796b6`, `bb4000f` |

**The leak that would have defeated it was not on a prep screen.**
`/owner/ingredients` shipped a `usageMap` to the browser containing, per raw
ingredient, which preps use it AND in what quantity — transposed, that is all
248 `prep_recipe_items` rows, every secret recipe rebuildable from the
ingredients tab without opening a prep page. Two more full copies existed:
`recipe_item_history` (open to every authenticated role, never narrowed since
0004) and a direct PostgREST read, which no amount of app-layer filtering can
close. That last one is why RLS had to be the enforcement. The app layer is
not merely the presentation, though: since 2026-09-16 it applies the rule
itself rather than asking RLS's own predicate (below).

**What decision 3 bought.** Prep NAMES stay on dish recipes and in the
ingredient picker — a cook must know the dish contains the sauce — and that
cost nothing, because a dish line's prep name comes from `ingredients` (the
`is_prep` row), never from `prep_recipes`. Rules 2 and 3 land on different
tables and never compete.

**Two things deliberately left as they are.** An admin who creates a prep
recipe cannot open it until the owner grants it — the WITH CHECK omits
`can_see_prep` so creation works at all, which makes the rule "you may
create, but you may not modify or delete what you cannot see". Nobody felt
that until 2026-09-16, because of the leak below; since then the create form
says so. And
`getCostingContext()` returns prep items FILTERED FOR DISPLAY beside unit
costs COMPLETE FOR ARITHMETIC; that inconsistency is the design, is the most
fixable-looking thing in it, and carries a comment saying so.

**Found along the way, both queued rather than folded in:** a thrown Server
Action is invisible in 46 of 120 client handlers (item 20), and
`prep_recipe_access` records grants but forgets revocations (item 21).

### The admin leak, 2026-09-16 — the inventory was right; the premise was wrong

Nik, logged in as `admin` (zero grants), opened กะทิราดข้าวเหนียว and saw its
whole ingredient list with quantities and per-line costs. The route,
`/staff/prep/[id]`, was in the leak map, and its guard was deployed. The
guard ran and said yes. Nothing went around RLS: RLS returned the rows,
because `can_see_prep()` said yes to every admin.

**`is_owner()` does not mean owner.** `0001_init.sql` defines it as
`role = 'owner'`; `migrations/006_owner_role.sql` replaced it with
`role IN ('owner','admin')`, because the older policies use it to let admins
write. Nik confirmed the live definition with `pg_get_functiondef`. Every
part of this work that asked `is_owner()` — `can_see_prep()`, both
`prep_recipe_access` policies, the grant-history policy — admitted admins.
From the day the visibility work shipped, อู๋ and `admin` could read, change
and delete all 48 preps; every admin could grant and revoke at the database,
so rule 5 held only on screen; and the prep tab on `/owner/ingredients`
showed admins all 48 too. เฮง holds all 48 anyway, which is part of why nobody noticed.

**How it was missed — three failures, all of method.**

1. **The first definition was read, not the live one.** Designing
   `can_see_prep()`, a check of `current_role()`'s security mode printed the
   top of `0001_init.sql`, where `is_owner()` sits beside it as `= 'owner'`,
   and that was taken as current. A later `CREATE OR REPLACE` had superseded
   it, and nobody looked for one. It is the baseline rule — the shipped code
   path, not a reconstruction — missed for SQL, by the session that had
   already written into this README that policies are invisible to a
   structural sweep.
2. **The negative control tested the wrong role.** Nik's decision was
   specifically *admins are named, not implicit*, and migration 2's negative
   control was ธีรวัฒน์, an EDITOR — for whom `is_owner()` is false whether or
   not the rule holds. It passed for a reason unrelated to the rule and could
   never have caught this. The control was an ungranted ADMIN; อู๋ and
   `admin` were both in the pre-check's own account list. **A negative
   control has to come from the population the rule is about.**
3. **The defence in depth was one layer.** The app layer and RLS were
   presented as independent, and approved as defence in depth. They were
   not. `canSeePrep` called the same SQL `can_see_prep()` that RLS calls, and
   `getPrepVisibility` trusted `prep_recipe_access`'s SELECT policy —
   `profile_id = auth.uid() OR is_owner()` — to narrow its read, under a
   comment claiming *even a mistake in the role check here cannot widen what
   comes back*. For an admin it returned all 96 grant rows. That comment was
   approved and signed off as written. **Two layers calling the same
   predicate are one layer.** One misreading opened both.

**A fourth thing the leak was hiding, and the most valuable find.**
`createPrep`, `duplicatePrep` and approving a `prep_create` read the new row
back (`INSERT … RETURNING`), and Postgres checks a returned row against the
SELECT policy. A new prep has no grant row, so once admins were excluded,
those inserts failed for every admin, เฮง included. They had only ever
worked because `can_see_prep()` said yes to everyone with the admin role.
Migration 2's header reasoned carefully about WITH CHECK for creation and
missed RETURNING, and no test could have caught it while every admin passed.
It would have been found by เฮง, in production.

**The name is a live trap for others too.** `costing_tables_rls_migration.sql`
said `is_owner()` is "owner ONLY" and "has always rejected admin's own
writes"; `profile_employee_link_migration.sql` called its `is_owner()`
policies owner-only. Both were wrong, and both now carry a correction where
they are read. Meanwhile `006` and `008_inventory_order_system.sql` state the
truth plainly: the knowledge was in the repo, and the name overrode it.

**The fix** (`ef796b6` migration, `bb4000f` code).

- `is_owner()` is left exactly as it is. q-factor, `pos_sales_aliases`,
  inventory and profiles depend on it meaning owner-or-admin, as `006` warns.
  A new `is_owner_only()` carries the prep surfaces.
  **Corrected 2026-09-17:** the admin writes that are INTENDED through it
  are `menus`, `pos_sales_aliases`, the station tables and the team
  screen's profile reads. The q-factor is not one: Nik decided it is owner
  only (item 23), so its policy admitting admins is a defect with a HELD
  fix. Neither is the profiles WRITE policy (item 29, part A of the
  permissions batch). The full list is in `AGENTS.md`, "Role checks".
- The migration checks itself before COMMIT by calling the predicates AS
  every profile against every prep. Behaviour, not structure: `pg_depend`
  records the functions a policy calls, but not the functions a
  `LANGUAGE sql` body calls, so nothing in the catalogue connects
  `can_see_prep()` to `is_owner()`.
- The app layer applies the rule itself, in TypeScript: owner by role, else
  an explicit grant row filtered by `profile_id`. The two layers now share
  data and not logic.
- The three creates generate their id in the app and never read back. When
  the creator cannot see the result, the form says it waits for the owner's
  grant instead of opening a not-found page. **Nik has been told that a new
  prep is invisible to its creator, เฮง included, until he grants it.**
- `prep_recipe_access_migration.sql` and `provenance_triggers_migration.sql`
  both say "safe to re-run" and would now reopen the leak; both carry DO NOT
  RE-RUN. Migration 2's wrong negative control is corrected in the file.

**Verified at the app, in both directions, on 2026-09-16. The SQL footer
checks 1–7 were NOT run, and nothing here should be read as saying they
passed.**

- **As `admin`:** Nik created `ทดสอบสิทธิ์`. The create succeeded, the form
  said the prep waits for the owner's grant, and the ของ prep tab read **0**.
  So the create path works without reading the row back, and the creator
  cannot see what they made.
- **As owner:** the same tab read **49** (48 plus the new one). So the owner's
  access is the role, not a grant row.
- The test prep was then deleted.

Those two results cover what matters most: an admin is closed out of the
list, an admin can still create, and the owner is not locked out. The
migration's own pre-COMMIT sweep also passed, since "success" means it did
not roll back, so the predicates agree with the rule for all 11 people × 48
preps.

**What is NOT witnessed, because the footer was not run:**
- RLS on the tables as an admin's session sees them (recipes, items, the
  grant table, both history tables);
- the detail page from the original screenshot, reopened as `admin`;
- the write half (an admin revoking or granting at the database);
- เฮง as the same-role positive control;
- the RETURNING demonstration.

The code and the sweep both say these hold; nobody has looked.

**A cosmetic defect, found by the same test.** The "waits for the owner"
message first rendered as bare `text-amber-600`, which is `#dd7400` in
Tailwind 4, sitting exactly where the form's red error sits. Nik read it as
an error. It is now a boxed amber notice, the shape the app's other notices
use; the duplicate button's notice changed with it. A success message in
error colours teaches people to distrust the colour.

## The accounts — who has had access is not answerable from the profile list

Checked 2026-09-15 by activity, not by name, while scoping prep visibility.
The guess from the names inverts:

| account | role | activity |
|---|---|---|
| **admin** | admin | **34 recipe edits, 41 approvals resolved, 11 order sessions** — the second-busiest account in the system |
| เฮง | admin | 36 recipe edits, 43 pending changes submitted, 6 order sessions |
| Owner | owner | 115 approvals resolved, 11 order sessions, 2 maintenance rows |
| เวช | editor | 13 pending changes, last 2026-08-14 |
| ธีรวัฒน์ | editor | 4 maintenance rows, 1 order session |
| Editor | editor | 2 pending changes, last 2026-08-22 — lightly used, but used |
| อู๋ | admin | 1 approval resolved |
| แหงน, Staff, HR, sale | editor/staff/hr/sales | **no activity anywhere** |

**`admin` looks like a placeholder and is not one.** It needs a real name, not
retirement; retiring it would take out whoever is behind 34 recipe edits and 41
approvals. `Editor` is lightly used. `Staff`, `HR` and `sale` show nothing at
all, and are the safe ones to retire before any grant is made.

**Two accounts (เฮง and `admin`) account for 70 of the 119 recipe edits.** The
realistic pool of people to name on a prep recipe is far smaller than eleven
rows suggests.

**And the limit of all of the above:** 99 of 157 pending changes, and 13 of 42
order sessions, were submitted by profile ids **that no longer exist** —
accounts deleted at some point, with their work still referenced. So the
current profile list cannot answer who has had access historically, and
nothing in the schema can: there is no view or access log on any table (the
only recipe-related log, `recipe_item_history`, records edits, not reads).
Whoever has already read the prep recipes, has already read them; this work
closes the door from here on, and cannot audit what went through it.

## แจ้งซ่อม — reviewed 2026-09-14, and the premise the data corrected

Nik asked for a review on the premise that nobody uses it. The live table
said otherwise: six rows — two Owner test entries from launch day
(2026-07-09) and **four real reports from one editor, ธีรวัฒน์**, three of
them open: หลังคาสโตร์ 1 น้ำรั่ว โดนกล้อง (2026-08-09, "กำลังซ่อม" since 08-17
with nobody named), อ่างล้างมือห้องน้ำคนพิการ ปูนยาแนวหลุด and
เครื่องกรองน้ำพนักงาน (both 2026-09-01, never acknowledged). The feature is not
unused; it is unanswered. The one person who used it got no response three
times — the strongest lesson the rest of the staff could be taught about it.
Those three were handed to Nik as the first action, before any code.

What the review found, in the order that matters:

- **Nobody is told.** No notification, no assignment, no badge — the fixer
  learned of a report only by opening the page on their own initiative. That
  was the whole gap; the form (eight taps and typing on a phone, against
  LINE's five and a buzz) was not.
- **"แจ้งแล้ว" meant both unseen and ignored**, and "กำลังซ่อม" recorded no
  name: `resolver_id` was written only at done.
- **An empty report was accepted** — no field was required — and listed as
  "อื่นๆ — ไม่ระบุจุด".
- The HR role's label promised แจ้งซ่อม ("ฝ่ายบุคคล + แจ้งซ่อม") while the
  update policy admits only owner/admin/editor.
- Staff have no logins yet; only the head group is on trial. The intended
  reporters (kitchen and service staff on a phone) cannot report until they
  do — a fact about accounts, not about the form.

Nik's decisions (2026-09-14): the form stays roughly as it is — he does not
think the form is the problem; people shout because shouting is easier, and
the cost of shouting is that the fixer forgets, which is why the feature
exists. The fixer is a designated person with an admin/editor login who calls
an outside technician for hard jobs; Nik is not in the loop. **In-app badge
first, LINE later** (queue item 19). Delete nothing until the loop is proven
to close — tabs, detail page, after-photo, urgent, category all stay.

Shipped 2026-09-14, after `maintenance_resolver_name_migration.sql`: a red
count on the แจ้งซ่อม nav entry for the roles that act (open = new +
in_progress; the layouts pass 0 for everyone else, so reporters see no
count); "รับเรื่อง" records who took it (`resolver_name`, denormalised at
write time like `reporter_name`, because `profiles` is select-own under RLS
and the list cannot read another user's name) and the name prints on the card
and the detail — rows accepted before the column existed read "ไม่ระบุชื่อ",
which is the truth; `capture="environment"` on the report photo as a prop of
the shared upload component, off by default so SOP gallery picks stay;
location OR description required on client and server; the HR label fixed
rather than the policy widened — a grant with no consumer is surface, and the
policy path is four places (RLS + three inline arrays) that can drift. Those
three inline copies of the role list still exist beside the new
`canManageMaintenance`; consolidating them is a follow-up, not done now.

## The coffee-shop reimbursement, and why it is deliberately not corrected

Sompong buys supplies for the coffee shop, pays up front, and is reimbursed at
month end. **This is a receivable being settled, not revenue** — and the system
books it as revenue anyway. That is a known, measured, deliberate decision, not
an oversight. Do not "fix" it in code.

**The flow, as the data holds it:**

| | |
|---|---|
| purchase side | CoA **998 ร้านกาแฟ**, group G900 (operating) — July ฿4,073, August ฿3,614, Sept-to-date ฿1,235. Almost all ผักสี่มุมเมือง |
| reimbursement side | inside `monthly_revenue.other`, as a single typed number |
| contra / receivable | **none.** Zero negative rows exist in `expense_entries`; no receivable table exists |

**Why it is not corrected.** `other` is not Nik's figure. The outsourced
accountant and the in-house bookkeeper compile it and hand him one total, which
he types into the revenue box. Changing how this app treats the flow would put
the app's number out of step with what they send — worse than the distortion it
fixes. If it is ever corrected, that is a conversation with the accountants,
not a code change.

**The size, so nobody re-litigates it from intuition.** August, on stored
figures: removing the ฿3,614 pass-through from both sides moves COGS from
53.07% to 53.13% and operating profit from 32.414% to 32.449% — about
**0.06 and 0.035 percentage points**. For scale, correcting August's
under-entered revenue (฿3,370,423.52 → the export's restaurant gross
฿3,859,852) moves COGS 53.07% → 46.34% and profit 32.41% → 40.98%. The revenue
import matters roughly a hundred times more than this does.

**Follows from the above:** the import **never touches `other`** — not
overwrite, not add to, not reconcile against. It owns food / drink / dessert /
delivery / souvenir and nothing else. And souvenir therefore cannot be folded
into `other`; it gets its own `revenue_type`.

One thing the data cannot settle: identified purchases are ฿3,614 in August
while non-POS `other` is ฿99,021.50, so either the reimbursement really is
~฿4k and the rest is scrap and used-oil sales (both real revenue, never in the
POS), or more coffee-shop purchases sit unseparated inside G100. Fourteen
separate August postings to 998 suggest the bookkeeper does separate them.

## budget69.xlsx is the source of a third of the restaurant's costs — every month

**The app's ledger has never held the monthly-billed costs.** Salaries, the
owner's salary, land rent, electricity, water, the accountant, card fees —
nobody pays them at the till, so the bookkeeper's daily entries never include
them. In July 2569 that is **≈฿1,032,000**. August's operating profit of 38.7%
was computed without any of it; with July's figures as the estimate it is
nearer **12.8%**, and budget69's own July bottom line is 3.5%.

So `/owner/accounting/import` (which replaced the never-run อู๋ importer) is
**a monthly step, not a history load**: Nik fills the green ACTUAL column of
`งบ69` after each month closes and imports it. Jan–Jul 2569 first, then
August onward, forever.

**Superseded the same day for August onward** — see the next section. Jan–Jul
2569 stay as imported from budget69 (Nik's decision, 2026-09-10) and this
section remains the record of how those seven months were written. The
budget69 importer is still on the page, folded away, for those months only.

### The rule that governs every write

`lump(code, month) = sheet actual − Σ app entries for that code and month
that are not themselves lumps.` Jan–Jun: the whole sheet figure. July: the
1–16 remainder (the bookkeeper began daily entries on the 17th). August on:
whatever the daily entries did not cover. A negative remainder is clamped to
zero and reported — budget69 is the authority on the month, the daily entries
on the days. July's two: 610 ฿3,658 and 780 ฿442 stand as small overstatements.

Every lump: `payment_method = accrual`, `supplier_id NULL` (the transfer slip
filters on supplier, not on method — see the RPC), dated the **1st**,
`bill_ref = B69-<code>-YYYY-MM`. Dating on the 1st is what clears the
incomplete-month marker: once Jan–Jul are in, `MIN(entry_date)` is 1 January
and July is a full month.

### What the import refuses, by construction

- **650 / 752 / 753** — the POS revenue import writes these from the export;
  the sheet carries the same figures and writing them here too would double
  every month's discount. The RPC refuses them; the preview shows them as
  "from POS".
- **790 from a non-owner.** The page and both actions are `requireOwner`;
  the RPC checks the caller's role as the second lock. Probed live: refused.
- **A month that does not reconcile by explanation.** `revenue − Net Profit`
  (+ rows the sheet's own subtotals skip) must equal Σ entries + Σ POS-owned
  + Σ unmapped, to the baht. Otherwise the preview goes red, confirm is
  disabled, and the server refuses regardless — this is a third of the costs.

### What the real sheet taught the parser — four properties, all handled by rule

1. **Subtotal formulas skip a row, per column.** `- ต้นทุนอื่นๆ` includes
   ของฝาก in June and omits it in July. Nik's own bottom line is ฿4,340 (Jun)
   and ฿2,570 (Jul) short because of it. Detection recognises a parent with
   one child left out and **names** the skipped row so the stop check
   reconciles by explanation, not tolerance. Nik has been told.
2. **One name, two meanings.** `- ต้นทุนอื่นๆ` is a subtotal at r27 and a
   leaf at r64/r102; `ผ้าเย็น` and `ซื้อของเพื่อทดแทน` each appear twice. A
   leaf with the subtotal's name takes its section's "other" account from
   the nearest preceding code prefix (2xx→240, 4xx→420); a parent splits only
   when a child maps to a *different* code.
3. **The revenue row is a "parent" of the whole sheet** — revenue = Σ costs +
   Net Profit is an identity. Revenue and Net Profit are structural: never
   parents, never members. Rows keep their innermost parent.
4. The parent is *smaller* when a child is skipped, so the gap is negative.
   A sign error there was caught by the data-layer proof, not by reading.

`src/lib/budget69-map.ts` is generated from the sheet's own row names: 51
exact, 21 near, 86 proposed (approved as a batch 2026-09-10, seven of them
added during implementation and marked), 2 memo. Regenerate from the sheet if
it changes; never hand-edit a name.

### Verified on the real file, Jan–Jul 2569

Every month reconciles to its own bottom line to the baht, no unmapped rows.
July lumps equal the report: ผักสด 57,607 · ของสด 539,826 · 220 580,846 ·
310 120,000 · 520 83,642.30 · 790 205,000. January, the first month Nik
runs: 66 entries, ฿3,224,000.57, POS-owned 650 95,898 · 752 42,783.

### Two things in budget69 itself, recorded so they are not chased as bugs

- **April and June `ยอดขาย` are net of discount; the other five months are
  gross-minus-coffee.** The import takes revenue from the POS export, so this
  affects only reconciliation targets — but a comparison against those two
  months will be ฿107k / ฿65k off for that reason.
- **The app holds a ฿50,000 CapEx (993) dated 17–31 July that the sheet does
  not show anywhere.** Held, untouched, Nik's to decide; the import lists it
  under "in the app, not in the sheet".

## The outsourced accountant's file is the source from August 2569

`69-08.xlsx` from the outsourced accountant — one growing file per year
(`69-09.xlsx` next, `70-01.xlsx` the year after). Nik's decision of
2026-09-10, replacing budget69 for August onward. Parser `src/lib/outsource.ts`,
RPC `import_outsource_month`, page `/owner/accounting/import` (owner only).

### What is read, and from where

Sheet `รับ-จ่าย<yy>` holds every month top to bottom: a daily table, a row
with `รวม` in column A, the card fee in column C of the next row, receipts,
`หักจ่ายสด` and the **cash-paid block** to the first blank row, then **the
monthly block** (`ค่าแรงพนักงาน … รวมคชจ.`, labels in C, amounts in F). The
importer takes the monthly block and the card fee. Located by position, never
by label: **three labels occur in both blocks** — ค่าแรงพนักงาน (Aug 604,970
monthly vs 78,497 cash-paid), ค่าอาหารพนักงาน (71,080 vs 27,725), ค่าเช่า
(120,000 vs 9,120). The cash-paid block is already in the app as the
bookkeeper's daily entries; the preview shows each twin beside its monthly
figure as *จ่ายสดรายวัน (มีในระบบแล้ว)* so 604,970 next to 78,497 reads as two
things, not a mismatch.

The month sheet (`สค.69` …) contributes **one cell: F7 รายได้อื่นๆ**, written
to `monthly_revenue.other`. This import owns `other` — it is the accountants'
figure and this is their file; the POS import never touches it. July's typed
113,070 became 18,165, August's 121,195.50 became 20,793.

### The identity, the stop, and the year

`รวมคชจ. = หักจ่ายสด + Σ(monthly block)` holds to 0.00 in nine of nine months
(Dec 2568 → Aug 2569) and is the first stop: a month where it fails is
refused. Then: an unknown label in the block is a named stop (row, label,
amount) — the map is exact-string, 14 labels, no fuzzy matching; a missing
F7 is a stop, never a zero (March's F7 is a genuine typed 0 and is a value).

**The year comes from the daily table's date column, never from a sheet or
file name, and the cells are 57 years off, not 543.** The accountant typed a
two-digit Buddhist year (`1/12/68`) and Excel read it as **1968**. Rule: a
stored year 1900–1999 is BE 2500+yy → CE; ≥2400 is a four-digit BE; 2000–2399
is already CE. Verified on every block; the 70-series fixture in the tests
proves the rollover (`ธค.69` → 2026-12, `มค.70` → 2027-01, distinct from
2025-12). Month sheets are tied to their block by the F7 formula pointing
into the block's rows, and by name; disagreement is a stop. The
abbreviations กย/ตค/พย for Sep–Nov are unseen until those files arrive; the
formula tie does not depend on them.

### Written in full, not by remainder — and what is never written

Unlike budget69, **no daily entries are subtracted**: the file's own
arithmetic makes the monthly figures distinct from the cash-paid ones, and
the daily entries are the cash-paid side. Subtracting would have written
61,720 for a line the accountant states as 71,080. The app's daily is shown
beside each line for information. Accepted and named: ค่าภ.ง.ด.1 (฿10–20)
sits in the cash-paid block and reaches 952 as a daily entry, so 952 runs
฿10 over the file's ภงด.3,53.

Every lump: accrual, `supplier_id NULL`, dated the 1st, `bill_ref =
OUT-<code>-YYYY-MM`. Codes: ค่าแรงพนักงาน 220 · เงินเดือนออฟฟิศ 790 ·
**ค่าอาหารพนักงาน 221** (Nik wrote 214; seven months of budget69 evidence say
221, and 214 is the part-time meal account — treated as a slip, he can veto)
· ค่าเช่า 310 · ค่าไฟ 520 · ค่าน้ำประปา 530 · ค่าภงด.3,53 952 · ค่า ภพ.30 951
· ค่าทำบัญชี (+ค่าสอบบัญชี) 710 · โบนัส 225 · ค่าภงด.50 959 · ค่าภาษีที่ดิน 954
· card fee 745. The RPC allowlist is those 13 plus 953/955 for the months
they appear; everything else is refused by name.

Never written, shown under *ตรวจแล้ว ไม่บันทึก*:
- **ค่าประกันสังคม** — in the cash-paid block, already a daily entry (Aug
  2569: 231 = 36,360, exactly the file). A check row against the app's
  230+231, warning on mismatch. For Jan–Jul the app figure includes the B69
  lumps, so it reads "=".
- **จ่ายคืนร้านกาแฟ** (Aug 128,625) — revenue already excludes coffee-shop
  sales; booking their return as an expense would double-count. Same
  standing as 998.
- Everything else in the file. Nik: "other figures may differ because they
  look at different things — what I entered in the app is primary."

### One source per month, guarded in both directions

A month is budget69 **or** the accountant's file. The RPC refuses expense
entries for a month with a `budget69_imports` row and accepts `other` only;
`applyBudget69Import` counts `OUT-` lumps in `expense_entries` before its RPC
and refuses if any exist — evidence, not the provenance flag. December 2568
parses cleanly and is skipped: the ledger begins 2026-01.

### Jan–Jul against the budget69 lumps, recorded

Same code, file minus lump: equal in every month for 790, 310, 520, 530, 951,
710, 225, 954, 959 and 221. Two real differences, reported to Nik, no action:
**220 January** file 558,120 vs lump 496,062 (+62,058); **745 March** file
19,998.49 vs lump 4,710 (+15,288.49). 952 is −10 Jan–May and −20 Jun (the
ภ.ง.ด.1 line above). Jan–Jul stay budget69.

### August 2569, after the outsource import (confirmed from the tables)

10 `OUT-` rows, 1,171,308.99, all dated 2026-08-01, accrual, no supplier;
`other` 20,793; no B69 rows. Revenue **3,880,645.00**, operating expense
**3,581,458.08 = 92.3%**, operating profit **299,186.92 = 7.7%**, COGS 46.1%
against a 43% target. The 38.7% is gone. ภพ.30 and ภงด.3,53 (30,139.60) sit
in the Tax group below the line, which is why operating expense is that much
less than the lumps plus the daily entries.

## July 2569 is half a month of expenses against a full month of revenue

`expense_entries` begins **2026-07-17**. There are zero rows for 1–16 July.
July was the trial month while this app was being built; the documents exist
(also in `budget69.xlsx`) and **Nik has decided not to backfill them**. So
July's figures are wrong permanently and on purpose:

| | July (shown) | August |
|---|---|---|
| operating expense | ฿676,547 = **21.8%** | 67.6% |
| COGS | ฿518,957 = **16.7%** vs a 43% target | 53.1% |
| operating profit | ฿2,428,853 = **78.2%** | 32.4% |

Nothing marks this. The summary page's only guard is `totalRevenue === 0`, and
July has revenue, so every percentage renders exactly as August's does —
including a green profit highlight at 78.2% and a COGS bar reading far under
target. It also **exports to xlsx** from the print P&L, where it stops being
obviously screen-bound and can reach the outsourced accountant as fact.

September is protected only by accident: it has entries but no revenue row yet,
so `totalRevenue` is 0 and the amber warning fires.

**Update 2026-09-10 — this section describes the state before two things
landed.** `3845de1` added the marker (July shows *ข้อมูลไม่ครบ*, its 78.2%
loses its green, and the xlsx carries the warning as a cell). And the
budget69 import fills July's 1–16 per account with the remainder rule above,
dated 1 July, so once Jan–Jul are imported `MIN(entry_date)` is 1 January,
**the marker clears by itself, and July is a full month** — without anyone
backfilling the daily detail Nik decided not to enter. What July will still
not have is the per-day, per-supplier detail for 1–16; it has the month.

**Landed 2026-09-10.** Nik imported Jan–Jul from budget69 (July: 61 lumps,
2,269,534.31 — the 1–16 remainder plus the monthly items), `MIN(entry_date)`
is now 2026-01-01 and the marker has cleared. Later the same day he ran the
July POS revenue import (seven types, 650/752/753 present) and the
accountant's file set `other` to 18,165. July now computes to revenue
3,206,394, operating expense 3,054,857.38, **operating profit 151,536.62 =
4.7%**.

### July: the app vs budget69's July, reconciled once so nobody re-derives it

Reconciled group by group on 2026-09-10 against งบ69's July actual column
(ยอดขาย 3,187,878, Net Profit 110,511.32). **G100, G200, G300, G500, G800 and
Tax are equal to the baht.** Everything that differs is a definition or a
decision, not a missing step:

| where | app − sheet | why |
|---|---|---|
| revenue, six POS types | +351 | coffee-boundary carve-out/rounding, not chased |
| revenue, `other` | +18,165 | the sheet has no other-income line |
| G400 | +123 | 480, a daily entry the sheet has no row for |
| G600 | +3,658 | 610 daily 5,658 > sheet 2,000, lump clamped, entries kept |
| G700 | +442 | 780 daily 14,306 > sheet 13,864, same |
| G750 | −2,556.80 | GP basis: per-platform rate on non-coffee delivery vs the sheet's own GP |
| G900 | +4,073 | 998, deliberately in the ledger, never in the sheet |
| G990 CapEx | +50,000 | 993, in the app, not in the sheet — Nik's open decision |
| ของฝาก 2,570 | in the app, in the sheet's rows, **not in its Net Profit** | the sheet's own subtotal skips it |

Operating profit 151,536.62 vs Net Profit 110,511.32 = +41,025.30 = +18,516
revenue + 30,818.50 tax (the sheet subtracts it; the app shows it below the
line) − 5,739.20 the expense overages above − 2,570 ของฝาก. CapEx is outside
both figures.

**The July 993, pulled 2026-09-10 for Nik's decision.** One entry, id
`a1549313…`: dated **2026-07-18**, ฿50,000, `payment_method = cash`, no
supplier, no bill_ref, note **"เด"** — two characters, a truncated typo, so
the row itself does not say what was bought. Created 2026-07-18 20:21
Bangkok. Untouched until he decides.

## Item categories — what survives each month, and what does not

`pos_item_categories` holds one row per POS product: which of six revenue
categories it belongs to. It was seeded once from Nik's hand-built August
split, and Nik's own question about it is the right one: *will it get confused
when things change?* The honest shape:

### What is live every month

| | |
|---|---|
| the table (523 seeded rows, 564 after the catering seed, 633 by 2026-09-10 evening, 690 by 2026-09-11, growing as items are reviewed) | live |
| the screen at `/owner/accounting/pos-item-categories` | live |
| the "no row = not yet reviewed" check | live |

### What was one-time seed machinery, and the one piece that now runs monthly

The named exception list, the four-step precedence and the seven-sheet
reading live in `scripts/seed-item-categories.mjs` and nowhere in `src/`.
The application never imports the script.

**The 11-group POS mapping is the exception, since 2026-09-10** (`d4abd73`).
It lives in `src/lib/pos-group-category.ts` — one definition, two callers:
the seed imports it as its LM/Grab fallback, and the classification screen
uses it as a **suggestion**. This reverses the earlier decision (no
suggestion on the screen), which was made against a monthly trickle of new
items; Nik reversed it against a 228-item backlog where the POS group
already said the answer.

What survives the reversal, unchanged: **a suggestion is not a decision.** A
new item whose group resolves (อาหาร, เครื่องดื่ม with ::ของหวาน → dessert,
ร้านกาแฟ, กลุ่มของฝาก, ตรุษจีน, อาหารเจ, Comment Menu, Lineman) loads
pre-selected, amber, badged *แนะนำ — ยังไม่ยืนยัน*, `decided` false, and
**save skips it**. One button, *ยืนยันตามที่ระบบแนะนำ (N รายการ)*, confirms and
marks those rows decided (never touched); บันทึก is still the only write and
still writes decided rows only. Groups with no default — Other,
ออเดอร์พนักงาน, อื่นๆ — arrive blank, same list as the seed's; an item under
two groups that disagree (พุดดิ้งมะพร้าวอ่อน: ร้านกาแฟ + Lineman) gets none.

Measured on the real exports before shipping: across Feb–Jun the union of
unreviewed items was **228, of which 81 get a suggestion and 145 sit in
Other** with nothing to suggest. The button saves a third of the clicks, not
the backlog; Nik was told so.

### The seed is one-time, and the file enforces it

`seed_pos_item_categories.sql` refuses to run if the table holds any row. This
is not caution for its own sake: `ON CONFLICT DO NOTHING` protects rows that
already exist, but a re-run against a later month would insert every product
new since August with a category decided by the seed's rules rather than by a
person — silently bypassing the review the screen exists for. New products are
classified on the screen, never by re-seeding.

**Provenance:** the seed does not set `reviewed_by`, so a seeded row is
`reviewed_by IS NULL` while a human decision carries a UUID. It is the only
way to tell the two apart. Never backfill it.

### The three realistic futures

- **50 new items next month** — they have no row, surface as `ใหม่`, Nik picks
  a category for each. ~50 dropdowns, not 523.
- **An item is in the wrong category** — change it on the screen; `touched`
  makes it a real review event and the seed can never overwrite it. The screen
  has a product-name search for exactly this.
- **A second carve-out** — the `coffee_share_per_unit` box is editable on the
  screen, with help text stating the direction (below), because the rule is
  the thing most likely to be misread.

### The thing most likely to be misunderstood: `coffee_share_per_unit`

A row reads `category='dessert', coffee_share_per_unit=15` for an item that
is *partly coffee*. Three wrong readings are all natural, and the right one is
the least obvious:

> **The category is where the money goes. The carve-out is what LEAVES for the
> coffee shop.** ไอติมข้าวเหนียวมะม่วง sells at ฿129 → ฿114 stays in dessert,
> ฿15 goes to coffee.

Not "coffee with a ฿15 share" — that would strand the other ฿114. The CHECK
forbids a carve-out on a row whose category is already `coffee`, because
carving coffee out of coffee is meaningless. Written in the column comment,
the migration header, and the screen's help text.

### Two findings for Nik, from the catering investigation — NOT code defects

Both were measured on 2026-09-11 while investigating how catering sales reach
the system. Neither is a bug in this repo, and neither is being fixed here:
one is an accounting question for Nik and his accountant, the other is POS
data entry. They are recorded so they are not rediscovered as bugs, and so
whoever acts on them has the figures.

**1. `มัดจำงานเลี้ยง` — a deposit — is categorised `food`.**

`DINE_IN_TYPE` maps `food` → revenue type `food`, on `line.gross`. So a
catering deposit is booked as **food revenue in the month it is taken**, and
the event it belongs to may fall in a later month — or not happen. Whether
that is right is a revenue-recognition question, not a technical one: it is
Nik's to settle with his accountant, and the answer might legitimately be "yes,
that is how we book it".

Not quantified. `pos_item_categories` holds no amounts, so the size of this
needs a product-level POS export — find the `มัดจำงานเลี้ยง` line and read
รวมราคา. Until then the direction is known and the magnitude is not.

If the answer turns out to be "it should not be revenue", the change is one
row's category on `/owner/accounting/pos-item-categories`, not code — there is no
revenue type for a liability, and inventing one is a much larger decision.

**2. Fourteen products exist under two spellings differing only in whitespace.**

Measured across all 690 rows by comparing names with whitespace removed —
**a measurement for this note, not a matcher, and nothing like it is or will be
built into the system** (see the standing rule against name normalisation and
fuzzy matching):

```
กุ้งแก้ว (เล็ก)          vs  กุ้งแก้ว(เล็ก)
ข้าวไข่ดาว 2 ฟอง        vs  ข้าวไข่ดาว2ฟอง
ข้าวเหนียวมะม่วง (เล็ก)   vs  ข้าวเหนียวมะม่วง(เล็ก)
ทอดมันกุ้ง (เล็ก)        vs  ทอดมันกุ้ง(เล็ก)
ทอดมันปลา (เล็ก)        vs  ทอดมันปลา(เล็ก)
ปลาหมึกแดดเดียว (เล็ก)   vs  ปลาหมึกแดดเดียว(เล็ก)
ปูนิ่มทอดกระเทียม (เล็ก)  vs  ปูนิ่มทอดกระเทียม(เล็ก)
ยำถั่วพู (เล็ก)          vs  ยำถั่วพู(เล็ก)
ราดหน้ากุ้ง (เล็ก)       vs  ราดหน้ากุ้ง(เล็ก)
หอยแครงเผา (เล็ก)       vs  หอยแครงเผา(เล็ก)
หอยแครงลวก (เล็ก)       vs  หอยแครงลวก(เล็ก)
หอยตลับผัดโหรพา (เล็ก)   vs  หอยตลับผัดโหรพา(เล็ก)
อาหารชุด3000            vs  อาหารชุด 3000
อาหารชุด4000            vs  อาหารชุด 4000
```

**Revenue is unaffected.** All fourteen pairs agree on category, so both
spellings land in the same bucket and the month's totals are right. This is
not a money error.

**Menu Engineering is affected, and that is the real finding.** The sales
importer matches `menus.name` exactly, with `pos_sales_aliases` as the only
override. Of the fourteen:

| | |
|---|---|
| exactly one spelling reaches a `menus` row | **11** |
| neither spelling does | 3 (`ข้าวไข่ดาว`, and both `อาหารชุด` pairs, which are packages and have no `menus` row by design) |
| both do | 0 |

So for **eleven à la carte dishes**, every sale rung on the orphan button falls
into `unmatched` and never reaches `last_period_qty_sold`. Those dishes are
understated in Menu Engineering — which decides Star / Horse / Puzzle / Dog,
so a dish can be reading as a Dog because half its sales are on the other
button. How much is lost is not known from here; it needs a product-level
export, where the orphan spelling's qty column is the answer.

Two remedies, both already available, neither requiring code:

- **At the POS** — merge the duplicate buttons. Fixes it at the source and
  stops it recurring, but does not recover the split history.
- **In this app** — one `pos_sales_aliases` row per orphan spelling, divisor 1,
  pointing at the same menu. That table exists for exactly this and holds 7
  rows today (all weight cases, e.g. `กุ้งก้ามกรามเผา 5 ขีด` ÷ 2). Each row is
  a human decision about one specific name, which is why it is not the fuzzy
  matching the standing rule forbids.

## Reconciliation baselines against Nik's August split — read the axis first

**His sheets and the category split are on different axes, and comparing them
directly gives a wrong answer that looks like a bug.** His `อาหาร` sheet is
*food sold dine-in* (Eat In + อาหารห่อ); his delivery food lives in the
separate LM and Grab sheets. Category-food spans every channel. Set them side
by side without knowing this and food disagrees by **฿202,056** — purely the
axis. Someone recomputing this without the axis in mind will get that wrong
answer again; it happened once already, with full context.

Measured from the August 2569 raw export
(`SaleData_20260908_194017.xls`, 777 lines, 523 products). **Every line values
out to exactly ฿3,989,129, the export's own gross** — nothing dropped or
double-counted. That check would have failed loudly if the classification
were wrong.

| category | dine-in | delivery | total |
|---|---:|---:|---:|
| food | **3,136,226** | 200,196 | 3,336,422 |
| drink | 303,092 | 90 | 303,182 |
| dessert | 188,199 | 10,640 | 198,839 |
| coffee | 126,982 | 1,530 | 128,512 |
| souvenir | 3,024 | 0 | 3,024 |
| other | 19,150 | 0 | 19,150 |

**Three expected differences from his sheets — deliberate, with reasons, so
nobody chases them as reconciliation failures:**

- **Dine-in food ฿3,136,226 is ฿4,279 below his `อาหาร` ฿3,140,505.** That is
  souvenir (฿3,024) and the บ้าบิ่น lines leaving food — both moved out on
  purpose. All 15 `กลุ่มของฝาก` products sat inside his food sheet, so this is a
  correction to his COGS denominator, not a discrepancy.
- **Delivery ฿212,456 is ฿12,170 above his LM+Grab ฿200,286.** His delivery
  sheets exclude desserts and coffee, which he pulls into `ของหวาน`/`กาแฟ`. The
  category split keeps them as dessert and coffee *in the delivery channel*.
  Same money, different axis: ฿10,640 delivery dessert + ฿1,530 delivery
  coffee = ฿12,170 exactly.
- **Coffee ฿128,512 is pre-carve-out.** Add the ไอติม carve-out (฿15 × 51 =
  ฿765) → **฿129,277**, his `กาแฟ` sheet gross. Less ฿193 discount and ฿459
  platform GP → **฿128,625**, the figure he enters. Three numbers, three bases,
  all correct.

### Do not compare the import's `delivery` row against ฿212,456

The ฿212,456 above is the **delivery column of the table**, every category
including coffee. The revenue import excludes coffee entirely, so the
`delivery` row it writes is **฿210,926** — the same figure less the ฿1,530 of
coffee sold through Grab and LineMan.

Both numbers are right on their own basis and neither is a typo. They are
recorded together because the first person to check an import against this
section will otherwise find a ฿1,530 gap and start looking for a bug that is
not there. What the import writes, for August 2569:

| revenue_type | amount | |
|---|---:|---|
| `food` | 3,136,226 | dine-in |
| `drink` | 303,092 | dine-in |
| `dessert` | **187,434** | dine-in, **less** the ฿765 carve-out — not the 188,199 in the table above |
| `souvenir` | 3,024 | dine-in |
| `pos_other` | 19,150 | dine-in |
| `delivery` | **210,926** | all non-coffee Grab + LineMan |
| **total** | **3,859,852** | = export gross 3,989,129 − coffee side 129,277 |

`dessert` differs from the table for the same reason `delivery` does: the
table is the raw category split, while the import moves the ฿765 carve-out
out of dessert and into the excluded coffee side. Two rows, one cause.

### The 650 / 752 / 753 entries include coffee's share — about ฿620 a month

Revenue excludes coffee to the baht. **The three expense entries do not**, and
that asymmetry is deliberate rather than an oversight. August 2569:

| entry | amount written | of which coffee's |
|---|---:|---:|
| `650` ส่วนลด | 102,876.25 | ~193 |
| `752` GP LineMan + `753` GP Grab | 59,477.44 | ~430 |
| | | **~฿620, or 0.016% of revenue** |

**Why it is not split.** These figures are what the bank account and the
platform statements actually show — the full discount the POS recorded, the
full commission Grab and LineMan withheld. And Sheet3 reports discounts **by
type** (ส่วนลด 20%, พ้อยท์, Birthday …), not by item, so apportioning coffee's
share would mean allocating a total the file never breaks down. That is
inventing precision the source does not have, in order to make a booked figure
disagree with the statement it should reconcile to.

Same treatment as the CRM half: a measured approximation, written down with
its size so nobody has to rediscover it. **If you are comparing the 650 entry
against a per-category coffee split and find roughly ฿620, that is this — not
a bug.**

### August 2569 was imported on 2026-09-09 — what landed, verified from the tables

First production run of `/owner/accounting/revenue-import`, from
`SaleData_20260908_194017.xls`. The first attempt failed before writing
anything (see AGENTS.md, "React resets a `<form action>`"); the second wrote
exactly the projection above. Read back from the database, not from the
screen:

| what | landed |
|---|---|
| six revenue rows | food 3,136,226 · drink 303,092 · dessert 187,434 · delivery 210,926 · souvenir 3,024 · pos_other 19,150 — **every figure equal to the projection** |
| `other` | **121,195.50, untouched** |
| total revenue | **3,981,047.50** (the six + `other`) |
| three expense entries, dated 2026-08-31 | 650 ฿102,876.25 · 752 ฿34,047.34 · 753 ฿25,430.10 — all `payment_method = accrual`, all `supplier_id NULL`, all with a `POS-…-2026-08` bill_ref |
| `pos_revenue_imports` | one row: gross 3,989,129, restaurant 3,859,852, source file recorded |

**What the summary page computes for August now**, and why one figure is
below what was forecast:

| | before import | after |
|---|---:|---:|
| COGS % of revenue | 53.07% | **44.93%** |
| operating expense | 2,277,935 | 2,440,288.69 |
| operating profit % | 32.41% | **38.70%** |

The earlier forecast of "about 41%" profit was revenue ÷ *existing* expenses.
The import also **adds ฿162,353.69 of expense** — the discount and the two GP
entries that had never been posted — so profit is 38.70%, not 42.78%. That is
the import working, not a shortfall: those costs were always real, and they
were previously missing from the ledger entirely. The 44.9% COGS forecast
holds because COGS itself did not change, only the revenue it is divided by.

## What the accounting module is — and deliberately is not

**Read this before auditing `/owner/accounting`.** Without it, the module's
scope reads as a list of defects. It is not one.

This is an **internal management ledger for finding leaks and structural
problems**. It is not a complete set of books and does not try to be. Statutory
accounting is done by an outsourced firm and filed separately.

### Three money paths, only one of which lands here

| path | recorded in this app? |
|---|---|
| through the in-house bookkeeper | **yes** |
| paid directly by a director (utilities, accounting fees) — the bookkeeper sees the amount but the money never passes through them | **no** — goes straight to the outsourced firm |
| director salaries — nobody in the restaurant sees these, including the bookkeeper | **no** — straight to the outsourced firm |

Nik also exports from this app and combines it in Excel, deliberately keeping
some costs outside the system entirely.

### What follows from that, and what NOT to build

**No month in this system is a complete P&L, by design.** Not July (which was
also the trial period and is partial for that reason too), and not August
(whose correct sales figure has not been entered yet). **Treat no month
currently present as a trustworthy P&L.**

- **Do NOT build a per-month completeness signal** that compares entry counts
  against a rolling average. Every month would trip it. A warning that always
  fires is noise, and worse than none — it teaches people to dismiss warnings.
  If completeness is ever wanted it has to be **per-path**, not per-month.

- **Do NOT reconcile POS against accounting on monthly totals.** The two sides
  cover different scopes by construction, so a total-vs-total comparison
  produces a permanent unexplained gap and teaches everyone to ignore the
  screen. Any reconciliation must compare **only what flows through the same
  path** — realistically per-vendor or per-account, which also localises a
  discrepancy instead of merely proving one exists. See the queue.

### The ceiling, framed against this scope

A cashbook records **flows**, not **balances**. Everything asked of it so far is
flow-shaped or presentational — CapEx separation, period close, a scoped
reconciliation — and fits without strain. Four things sit above that line, and
they are **consequences of scope, not defects**:

| | why it does not fit |
|---|---|
| depreciation | needs an asset register — an object with state across periods, not an expense row |
| accounts payable | expenses appear when money moves, so unpaid invoices are invisible |
| cash position | cash vs transfer is recorded per entry but never accumulates to a balance |
| **true COGS** | `G100` is *what was bought*, not *what was consumed*. Real COGS is opening stock + purchases − closing stock. With no inventory valuation these diverge exactly when stock swings — which is when the number matters most |

**Recommendation on direction: do not convert this to double-entry.** Its value
is the self-checking property, and that only exists if *everything* flows
through it consistently. Nobody at the restaurant has accounting knowledge, and
a half-adopted double-entry system is worse than a well-kept cashbook because it
looks authoritative while being unbalanced. When a balance concept is genuinely
needed, add one narrow table for that one thing and keep the cashbook as the
spine.

The one thing that would change that answer: statutory financial statements. A
cashbook cannot produce them, and that is not an increment — it is different
software. This system's job is management insight; keep it pointed there.

### Findings recorded but not fixed

- **Negative and ungrouped accounts vanish from totals.** In
  `getMonthlySummary`, `accounts.filter((a) => a.total > 0)` runs *before* the
  group total is summed, so an account with a net-negative total (a refund or
  correction) is dropped from the display **and** excluded from the group total,
  silently understating expenses. Same for an account whose `group_code` matches
  no `G*` header. **Latent:** production has 0 negative amounts and 0 orphans.
  Not fixed because changing what a total includes is a modelling decision, not
  a bug fix. Recommendation when it comes up: show negative totals rather than
  hiding them — a refund that vanishes is worse than a refund that looks odd.

- **`coa_select` is `USING (true)`.** Any authenticated user, including `staff`,
  can read the whole `coa` table via PostgREST — including the row flagged
  `is_sensitive` (`790 เงินเดือนเจ้าของร้าน`). Only the **name** leaks; amounts
  are protected by `expense_select`, which requires owner/admin. The
  application-level filter is applied consistently across all four read paths.
  **Zero impact today** — that account has 0 entries — but the first time a
  salary is recorded there, owner and admin will see different profit for the
  same month with nothing on screen explaining why. Worth tightening the RLS to
  match the app filter eventually; separate migration, not urgent.

- **No audit trail and no period locking.** `expense_entries` has `updated_at`
  but no history table, so any amount can be changed after the fact with no
  record of what it was — while the system *does* keep price history and recipe
  history elsewhere. And unlike payroll, which has `is_closed`, no accounting
  month is ever final. Both are additions rather than corrections.

### `coa.target_pct` — one source of truth, and it is user-editable

The percent-of-revenue target on each COA group lives in **`coa.target_pct` and
nowhere else that the application reads.** It is not hardcoded in any TypeScript
file; every consumer — the entry form, `getMonthlySummary`, the printed P&L —
reads the column.

**It is changed through the app, at `/owner/accounting/coa`.** The CoA manager
screen has a target field wired to `updateCoaAccount`. No SQL is needed and none
should be written.

**Do not set `target_pct` from a migration.** An earlier draft of
`coa_cost_behavior_migration.sql` carried
`UPDATE public.coa SET target_pct = 43 WHERE code = 'G100'`, and that line was
removed before the file was ever run. The reason is worth keeping: the file
declares itself safe to re-run, and re-running it would have silently reset a
figure someone had since tuned through the UI. **A migration must not re-assert
a value the application lets a human change** — the two are then in a race that
the migration wins invisibly.

Two places still hold the number and are NOT the source of truth:

| where | value | why it is left alone |
|---|---|---|
| `accounting_migration.sql` seed line for `G100` | 38 | Already applied. Editing an applied migration makes the file stop describing what actually ran, which is the divergence this whole README exists to prevent. It only matters if someone seeds a fresh database, and this note is the mitigation. |
| Nik's `budget69.xlsx` / Cost Structure workbook | 43-45 stated as the real range | Outside the system entirely. Reconciled by decision, not by code. |

**G100's COGS target was shipped at 38% and the restaurant actually runs 43-45%
(August 2569 measured 46.3% against corrected revenue).** `pctBar()` colours a
group red once actual exceeds target + 3, so at 38 the COGS bar was red every
single month — an indicator that always fires carries no information, the same
failure as a warning that always fires. Nik changes it to 43 through the CoA
screen.

## Dishes sold by weight — one app unit is one kilo (Nik, 2026-09-21)

**The rule: for a dish sold by weight, one unit in this app is one kilo.**
Its recipe is written per kilo and `menus.selling_price` is the price per
kilo: กุ้งก้ามกรามเผา is ฿1,000 with a recipe of 10 ขีด of prawn. The
reason is Menu Engineering: a hundred customers eating a ขีด each count as
10 units, not 100, so a weight-sold dish's popularity stays meaningful
beside a plated one. The three recipes changed from 1 to 10 ขีด on
2026-06-29 (กุ้งก้ามกรามเผา, ปูม้าใหญ่นึ่ง, กุ้งก้ามกรามซอสมะขาม) did
exactly this and are correct. Do not propose changing them.

**What it asks of the POS sales import.** The POS does not count these
dishes in kilos. A dish rung up per ขีด records half a kilo as 5, and a
fixed-weight button (…5 ขีด, …1 กก.) records one per portion. The import
turns either into kilos only through a `pos_sales_aliases` row for that
exact POS product name: ÷10 for a per-ขีด name, ÷2 for a half-kilo
button, ÷1 for a kilo button. A POS name that matches a menu exactly and
has no alias is counted as it stands, ÷1.

**The one exception: river prawn (Nik, 2026-09-21).** River prawn is
always sold as one prawn of 4 ขีด per plate, so for กุ้งแม่น้ำเผา 4 ขีด one
app unit is ONE 4-ขีด PLATE: the recipe is กุ้งแม่น้ำ 4 ขีด, the price ฿800 a
plate, and the POS, which counts it in ขีด, is divided by 4. Set up on
2026-06-29 and correct as it stands; do not move it to kilos.

**Where each weight-sold dish stands (2026-09-21).**
- Per kilo and complete: กุ้งก้ามกรามเผา (÷10, and ÷1 / ÷2 for the kilo
  and half-kilo buttons), กุ้งก้ามกรามซอสมะขาม ÷10, ปูม้าใหญ่นึ่ง ÷10, and
  ปูม้าใหญ่ผัดผงกะหรี่ ÷10 (฿1,200, ปูม้าเป็น 10 ขีด; converted from per
  ขีด by `blue_crab_curry_per_kilo_migration.sql`, applied 2026-09-21).
- No menu yet, so their POS sales are not counted: ปูม้าใหญ่ผัดพริกไทยดำ
  (฿120 a ขีด at the POS), กั้งกระดานนึ่ง and กั้งกระดานทอดกระเทียม (฿130).
  **Nik or the head chef creates them** (queue item 46): each named
  exactly as in the POS, per kilo, with ÷10 on its POS name at the next
  import.
- Left uncounted by Nik's decision: ข้าวเหนียว (ขีด) and มะม่วง (ขีด), ฿25 a
  ขีด, which have no menu.
- **"กุ้งแม่น้ำ Salt 4 lines" (FD3003-12, ฿200) is a DIFFERENT dish from
  กุ้งแม่น้ำเผา 4 ขีด** (Nik, 2026-09-21). Do not tie it to that menu or
  its ÷4. Nik will create its menu later; until then its sales stay
  uncounted.

**Decided 2026-09-21 (Nik), so they are not reopened:**
- **÷10 stays the marker of a dish sold by weight.** There is no separate
  "sold by weight" setting for now: the kitchen and service sheets print a
  dish in kilos when a POS divisor of 10 points at its menu
  (`getWeightSoldMenuIds`).
- **หาร stays available on a POS name that has no divisor yet**, one name
  at a time. A name that has one shows it instead, and it is changed on
  `/owner/pos-divisors`.

## Known limits of the POS pricing rule

`src/lib/pos-pricing.ts` prices each ingredient from a median over deliveries
from its dominant vendor. Two limits are structural rather than bugs, and both
are invisible from the review screen.

**The `⚠` unsettled flag cannot see the window itself.** It fires when the top
two vendors inside the 90-day window are within 10% of each other. It cannot
fire when the *choice of window* is what decides the answer.

`พริกขี้หนูสวน` is the worked example: over full history พี่แจ๋ว leads
ตลาดสี่มุมเมือง 130–120, but inside the 90-day window ตลาดสี่มุมเมือง holds 63%
and wins comfortably — so no flag appears, and the attribution looks settled
when a different window would answer differently. Anyone reading an unflagged
vendor should read it as "dominant in this window", not "the vendor we buy
from".

**Month-precision dates will make this worse.** Recovered dates (see the date
recovery round) carry a month but no day, so a delivery near the window
boundary is inside or outside depending on which day is assumed. That makes
window membership itself fuzzy for those rows, on top of the window already
being the deciding factor for some materials. Settle the day convention before
recovered rows are allowed into the pricing window, not after.

**21% of prices come from a single delivery.** The escalating fallback ends at
`latest-delivery` when the pool is thin, which was 52 of 242 ingredients when
last modelled. The preview labels those `ล่าสุด (ข้อมูลน้อย)` and shows the
pool size, and the run summary states the count — nobody should assume every
price is median-backed.

## Ceilings this system runs into

Written down because the last one — Vercel's request-body limit — cost a day
of debugging that a note would have saved.

| ceiling | value | where it bites | status |
|---|---|---|---|
| Vercel request body | **4.5 MB**, not raisable by tier or config | a POS `.xls` posted to a Server Action. Rejected *before* the function runs, so it surfaces as "An unexpected response was received from the server" with nothing in the logs | **fixed** — the browser parses and uploads validated rows 2,000 at a time, so the request never carries the file |
| `serverActions.bodySizeLimit` | 15 MB (set in `next.config.ts`) | Next's own limit. **Not** the one that bit us — it is well above Vercel's | fine |
| Vercel function duration | **90 s** | `buildPosImportPreview` reads a delivery window and recomputes the preview. Bounded today by `pos_import_settings.window_days` (90), so a few thousand rows | fine, but this is the next wall of this kind. If the window grows, move the aggregation into SQL rather than raising anything |
| **PostgREST response rows** | **1,000**, and `.limit()` does NOT lift it | any `select()` over a table with more than 1,000 rows. It returns **200 with a short body** and no error, so a truncated read is indistinguishable from a complete one | `lib/data.ts` exports `fetchAllRows` — use it. See below |
| `npm run lint` not green | 9 `react-hooks/set-state-in-effect` | blocks CI enforcement of `local/no-unchecked-supabase-write` | open, see below |

### The 1,000-row cap, and which reads are near it

This one is worth its own section because it lies quietly. A capped read is a
`200` with fewer rows than exist — nothing throws, nothing logs, and the
caller cannot tell. It cost a review screen that showed 58 of 251 materials
and looked complete.

**Any read of a table that can exceed 1,000 rows must page**, via
`fetchAllRows` in `lib/data.ts`. Do not add a `.limit()` and assume it helps:
the cap is enforced by the server, above whatever the client asks for.

Tables currently over the cap:

| table | rows | how it is read |
|---|---:|---|
| `pos_receipt_deliveries` | 22,805 | paged in `buildPosImportPreview`; counted with `head: true` elsewhere |
| `menu_recipe_items` | 1,777 | paged by `getMenuRecipeItems`; elsewhere only `.eq("menu_id")`, so one menu at a time |
| `expense_entries` | 1,368 | only bounded month/week ranges — see the known limit below |

**Known limit, not currently reachable:** `getRecentEntries` and
`getMonthlySummary` in `owner/accounting/actions.ts` read `expense_entries` for
one month without paging (the first also carries an explicit `.limit(500)`).
At roughly 80 entries a month they are nowhere near either bound. They would
begin truncating silently — a short P&L with no error — if a single month ever
passed 500, and again at 1,000. Recorded rather than fixed, because changing
them today would be churn; the point is that it is written down before anyone
has to rediscover it from a wrong total.

## Where two changes actually landed

Two pieces of work were folded into commits whose messages do not mention
them, because whole files were staged that already carried pending edits.
Recorded here so searching for them finds something:

| change | landed in | commit subject |
|---|---|---|
| **POS 4dp** — `newCost` rounded to 4 decimals instead of 2, paired with `purchase_cost_4dp_migration.sql` | `c6ea9a7` | "Let admins run the POS price import, and stop silent logouts" |
| **schedule_notes cleanup** — removed the `eslint-disable`, checked `upsertScheduleNote`'s write and `getScheduleWeek`'s read | `3df70cd` | "Delete the leave approve/reject path that was never wired up" |

## Verifying applied status yourself

A table or column: request it and read the error code.

```
GET /rest/v1/<table>?select=*&limit=1     PGRST205 = table absent
GET /rest/v1/<table>?select=<column>&limit=1   42703 = column absent
```

Do **not** use `head: true` for this — a missing table can come back as
`{ count: null, error: null }`, which reads as success.

Functions are harder, and two traps cost real time:

- **Trigger functions are invisible over REST.** Anything `RETURNS TRIGGER` is
  not callable via `/rpc/`, so it returns `PGRST202` whether or not it exists.
  Confirm those by their *effects* instead (does the history table have rows? is
  `updated_at` diverging from `created_at`?).
- **PostgREST resolves by name *and* parameter list.** Calling `/rpc/<fn>` with
  `{}` returns `PGRST202` for any function that takes arguments — which looks
  identical to the function being absent.

And do not call an unfamiliar function against production just to see whether it
exists. `next_catering_quote_seq` allocates and returns a sequence number; a
probe of it wrote a junk row that had to be deleted. Read the definition in this
directory first.
