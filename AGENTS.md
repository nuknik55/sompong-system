<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:git-staging-rules -->
# Staging rules — these exist because both were violated, with consequences

This repo tends to carry several unrelated in-progress changes at once. Twice in
one session, staging by directory swept pending work into an unrelated commit.
The second time it swept a staged `git mv` into a **production hotfix**: the
rename landed while both importers still pointed at the old path, HEAD did not
build, and the commit meant to restore production could not deploy. It was
caught from `git show --stat` *after* pushing.

1. **Stage explicit paths. Never `git add -A`, `git add .`, or a directory**
   while there is uncommitted work in the tree that is not part of this change.
   `git add src/lib/foo.ts src/lib/bar.ts`, not `git add src/lib`. A file you
   edited an hour ago for a different task is staged too, and its changes appear
   in a commit whose message does not mention them.

2. **Run `git status` and `git diff --staged --stat` BEFORE committing.** Read
   the file list and confirm it matches the intended change exactly — same
   files, no extras. Before, not after: after is a repair, before is a fix.

   **Count the staged files against the number you intended. Do not read the
   list.** Rule 2 fired and was read past: a commit meant to carry seven paths
   was committed with two, and the stat printed exactly that — `2 files
   changed` under a change described as seven. The cause was one `git add`
   given all seven paths at once, two of which had already been removed by
   `git rm`. **`git add` aborts on a pathspec that matches nothing and stages
   NOTHING**, so the five modified files never entered the index; only the two
   deletions, staged earlier by `git rm`, were in it. HEAD then deleted a
   module that two files still imported, and the deploy failed (`24f393d`,
   fixed by `665f458`).

   Two things follow, and the first is the one that would have stopped it:

   - Know the number before you look. "This commit is seven files" then
     `2 files changed` is a mismatch a glance at a file list does not produce
     — skimming names invites recognising them; a count either matches or does
     not.
   - **Stage deletions separately from modifications.** `git rm` already
     staged them; including those paths in a later `git add` is what makes the
     whole call fail. Add the modified paths in their own call.

3. **A hotfix commit contains only the hotfix.** For any production outage,
   first confirm the working tree is clean of unrelated changes, or `git stash`
   them. Never let a hotfix inherit whatever happened to be staged.

4. **Run `npm run build` on the staged state before pushing a hotfix.** A green
   build in a working tree that contains *more* than what is staged proves
   nothing about what is actually shipping. This is exactly what would have
   caught the unbuildable HEAD before it shipped rather than after.

Related: a commit that newly tracks a file (a script, a migration) should say so
in its message. `9d9219f` began tracking `scripts/backfill-pos-deliveries.mjs`
without mentioning it — deliberate, but the same shape of problem: something
riding along in a commit that does not describe it.
<!-- END:git-staging-rules -->

<!-- BEGIN:baseline-rules -->
# Comparing a change against current behaviour

The baseline must be **the shipped code path**, not a reconstruction of it.
Reimplementing the current rule "just for the comparison" measures the
reimplementation. This happened twice in one session, two rounds apart:

- A cross-check confirmed a new pricing module reproduced a reviewed report
  exactly — 238 rows, 0 differences. It compared the module's **pricing** and
  never exercised the server action's **query**, which was silently truncating
  at 1,000 rows and showing 58 of 251 materials. A cross-check that does not
  touch the differing layer proves nothing about that layer.
- A model comparing four vendor-weighting options against a hand-written copy of
  the current rule reported a material as changing. The copy had omitted a
  tiebreak; the real rule already produced the proposed value and nothing there
  changed at all.

So:

1. **Import the real function.** If it cannot be imported, that is a reason to
   extract it, not to retype it.
2. **State which layer the comparison covers**, and assume every layer it does
   not touch is unverified. Pricing verified is not query verified.
3. **Prefer a check that would fail** if the thing you believe were untrue. A
   test that passes under both the old and new behaviour has told you nothing
   about the change.
4. **For SQL, a function's behaviour is its LAST `CREATE OR REPLACE`, not its
   first `CREATE`.** Read it from the database —
   `SELECT pg_get_functiondef('public.is_owner'::regproc);` — or, at the very
   least, grep every migration for later replacements before reasoning from
   one. `is_owner()` is `role = 'owner'` in `0001_init.sql` and
   `role IN ('owner','admin')` since `006_owner_role.sql`. The prep-visibility
   work was designed on the first definition and shipped an admin leak that
   lasted until Nik opened a secret recipe from the `admin` account.

   Two consequences. The NAME is not evidence: where a function's name and
   behaviour disagree and other code depends on the behaviour, add a function
   whose name is true (`is_owner_only()`) rather than changing the old one.
   And the catalogue will not show you the chain: `pg_depend` records the
   functions a POLICY calls, not the functions a `LANGUAGE sql` body calls,
   so test the behaviour by calling it as the people it is about.
5. **A negative control must come from the population the rule is about.**
   The rule was "admins are named, not implicit". The negative control was an
   ungranted EDITOR, for whom the predicate was false whether or not the rule
   held, so it passed for a reason unrelated to the rule. The control was an
   ungranted ADMIN, paired with an admin who HOLDS grants as the positive
   control; the pair tells "admins are excluded" apart from "grants stopped
   working". Then make the control able to fail for the right reason: print
   the identity it actually ran as (`current_role()`), so a failed
   impersonation cannot pass as a zero, and pass ids as literals, so a lookup
   hidden by the very policy under test cannot become NULL and answer "no".
# A migration's own test code follows the rules the migration enforces

`permissions_batch_2026_09_17.sql` tested itself as real accounts and, to
print its results, created a temporary table. The Supabase editor warned
"This query creates a table without enabling Row Level Security", and the
owner cancelled before anything ran. A temporary table is private to its
session, so nothing was exposed; but that is a claim to prove, not to
assert, and a permissions file tripping the open-table check is the very
defect it exists to close. The same file also inserted test rows at the top
level and deleted them again before COMMIT.

So, in any migration:
- **No table for scaffolding, not even a temporary one.** Results that must
  be printed go into a session setting (`set_config(name, value, false)`),
  and the last statement prints them and clears it.
- **Test writes run only inside a block that always rolls back** (raise a
  private SQLSTATE and catch it); never as top-level statements followed by
  a cleanup DELETE. **CARRY THE RESULTS OUT OF THAT BLOCK BY HAND.**
  `set_config` writes a GUC, and a GUC is transactional: its third argument
  decides whether a value survives COMMIT, not whether it survives ABORT. A
  collector written inside the rolling-back block is rolled back with the
  writes, so the file prints the handful of rows emitted outside it and
  raises nothing. `catering_event_menu_items_migration.sql` printed 8 rows of
  31 that way and was applied on that showing (2026-09-19). A PL/pgSQL
  VARIABLE is not transactional — "the local variables remain as they were
  when the error occurred, but all changes to persistent database state
  within the block are rolled back" — so read the log into one on the last
  line before the abort and put it back in the handler.
- **The file counts its own result rows before COMMIT.** Every failure this
  week shared one shape: the file trusted that its checks had run. A survey
  that could not parse, a mapping that could not match, a collector that was
  rolled back — none of them raised. A count catches all three, because
  whatever went wrong, the rows are missing:

  ```sql
  v_rows := pg_temp.logged();
  IF v_rows <> c_expected THEN
    RAISE EXCEPTION 'FAIL the result table holds % rows, expected % ...', v_rows, c_expected;
  END IF;
  ```

  And the static check that counts emitting SITES must be compared against
  that constant, since a site is not a row: nothing else connects what the
  file says it will report to what it reports.
- **Each test write touches one row.**
- **The header lists every statement the editor may call destructive,**
  and says that anything else is unexpected.
- **Never "Run and enable RLS".** A policy the editor invents is not one
  anyone reviewed.
- **A probe that names an object the file CREATES must be dynamic.**
  PL/pgSQL plans a whole statement before it evaluates anything inside it, so
  a guard written INTO the statement is not a guard:

  ```sql
  -- fails with 42P01 on a first run, whatever v_has says
  SELECT count(*) FROM catering_event_menus m
   WHERE NOT v_has OR NOT EXISTS (SELECT 1 FROM catering_event_menu_items i ...)
  ```

  `catering_event_menu_items_migration.sql` aborted on its first run exactly
  there (2026-09-19; one transaction, so nothing was applied). The survey
  runs BEFORE the DDL by design — that is what makes it a "before" — so any
  probe naming the new table, column or function goes in an `EXECUTE`
  guarded by `to_regclass`, with a static ELSE branch that states the
  pre-state from tables that already exist. `to_regclass('x')`,
  `'f(uuid)'::regprocedure` and `information_schema` take the name as TEXT
  and are safe anywhere.

  The same trap catches a `LANGUAGE sql` function body, which IS resolved at
  CREATE time; a `LANGUAGE plpgsql` body is not.

# The server/client boundary: `scripts/rsc-boundary.mjs`

tsc, lint, the tests and `next build` all pass two defects that only a
render shows, and the second kind shipped: the order page crashed in
production for every order (`2d4c10f`, fixed in `28f7807`).
- **A server file may import only React components from a "use client"
  module.** Anything else arrives as a client reference: a constant is not
  its value (TH_ROW, 2026-09-23, caught before commit) and a function cannot
  be called ("Attempted to call effectiveQty() from the server"). Put shared
  constants and helpers in a plain module (`ui/table.tsx`,
  `lib/order-rules.ts`) and import them from there on both sides.
- **A "use server" file exports only async functions** (types are fine).
  "Only async functions are allowed to be exported in a 'use server'
  file" (the team page's message constant, 2026-09-23, caught before
  commit): keep constants unexported.

`src/lib/rsc-boundary.test.ts` runs the checker in `npm test`, so the gate
and CI fail on either. It builds the server graph (every page, layout,
template, default, not-found, loading and route file that is not "use
client", every `server-only` file and every "use server" file, then what
they import through relative or `@/` paths, stopping at "use client") and
checks each import that crosses into a "use client" module. **The
heuristic for "a component":** a PascalCase name (upper-case first letter,
a lower-case letter, no underscore) that the module exports as a function
or const; a default import counts as a component. It can miss a PascalCase
export that is not a component, a non-component default export, dynamic
`import()`, and package imports. Its fixtures reproduce all three
incidents; `RSC_SCAN_ROOT=<a tree's src>` runs it on another tree (on
`2d4c10f` it reports the effectiveQty import and fails).

# The SQL checker: `scripts/sqlcheck.mjs`

Every migration is run by hand in the Supabase SQL editor and nothing deploys
it, so this checker is the only look a file gets before Nik runs it. Each
check exists because a file got past without it:

| check | catches | when it was missed |
|---|---|---|
| A | dollar-quote tags unbalanced, `BEGIN;`/`COMMIT;` unpaired, a test label used twice | — |
| B | a `format()` whose placeholders and arguments disagree (the call aborts) | — |
| C | an object the file creates, named in executable SQL before its CREATE: PL/pgSQL plans a statement before running any guard inside it | `catering_event_menu_items_migration.sql`, first run |
| D | a regex whose backslashes a generator ate (`\s+` landing as `s+`) | the same file, second run |
| E | result lines written inside a block that always aborts, so rolled back with it | the same file, third run (8 rows of 31, applied) |
| F | no declared row count (`c_expected`), or one that disagrees with the emitting sites | why E's defect passed every earlier check |
| G | a PL/pgSQL IF/ELSIF condition cut at the THEN of a bare CASE | `test_data_cleanup_migration.sql` (`3057c55`), first run |

**Run it**, from the app folder:
- `node scripts/sqlcheck.mjs supabase/<file>.sql` on every new or changed
  migration BEFORE it goes to Nik. No exception applies: a new file passes
  all seven checks, or it is fixed.
- `node scripts/sqlcheck.mjs --all` is what CI runs on every push (the "SQL
  migration checks" step), and `npm test` runs it as well
  (`src/lib/sqlcheck.test.ts`). It checks every tracked migration and applies
  `scripts/sqlcheck-exceptions.json`.

**The exceptions are the history, recorded rather than skipped.** 87 files
were written and applied before check F existed (2026-09-19) and declare no
row count (three of them, applied by 2026-08-31, were only committed on
2026-09-23). Two trip check C on top-level DDL that ran cleanly: a `DROP
FUNCTION IF EXISTS` of an old signature before its re-CREATE, and one column
name added to two tables. Each entry names a file and a check letter, with
its reason. **Never add a new file to it: fix the file.** When a check stops
flagging a file, `--all` fails until that entry is deleted, so the list only
shrinks. Checking only the files a push changed was the alternative, and it
was rejected for two reasons. It depends on reconstructing the push's range,
and CI's checkout is shallow and a branch's first push has no "before". And an
edit to an old file's comment would demand row counts retrofitted onto a file
that has already run.

**The lesson behind G (2026-09-22).** PL/pgSQL reads an IF condition only as
far as the first THEN outside brackets (`pl_gram.y`: `expr_until_then` calls
`read_sql_construct`, which counts `(` and `[` and never CASE/END). So
`IF x <> CASE WHEN a THEN 1 ELSE 0 END THEN` is cut at the CASE's own THEN
and fails with "syntax error at end of input". Checks A–F and two reviews
passed it, because all of them read the condition as SQL, where it is valid.
**Inside any IF or ELSIF condition, wrap a CASE in parentheses.** G does not
yet read a CASE statement's WHEN clauses (the same reader) or dynamic SQL.

`scripts/sqlcheck-fixtures/test_data_cleanup_migration.3057c55.sql` is that
failing file, pinned by hash, so the test proves the checker can still fail.
**Do not run it.**

# Role checks: what each one actually admits — the list

Rule 4 above says to read a function's LAST definition before reasoning from
its name. It was not enough on its own: after it was written, `is_owner()`
was still read as owner-only in `costing_tables_rls_migration.sql`, in
`profile_employee_link_migration.sql`, and in the design that leaked every
secret prep to admins. A rule has to be remembered to be applied; a list can
be grepped. **Grep here before trusting a role check's name, and add a row
whenever a check is added or its definition changes.**

## Database functions — every role function the database exposes (2026-09-17)

| function | admits | name reads as | last definition |
|---|---|---|---|
| `public.is_owner()` | **owner, admin** | owner only — **WRONG** | `migrations/006_owner_role.sql` (0001 had owner only); confirmed live 2026-09-16 |
| `public.is_owner_only()` | owner | owner — right | `prep_owner_only_predicate_migration.sql` |
| `public.is_editor_or_above()` | owner, admin, editor | right | `migrations/008_inventory_order_system.sql` |
| `public.is_order_head()` | owner, admin, editor — THE ONE definition of a supply-order head (README item 35, decision 1); narrow heads here and nowhere else. A staff login is never a head | right | `supply_order_approval_migration.sql` (applied 2026-09-23) |
| `public.can_order()` | owner, admin, editor, staff — who may place, edit, receive and cancel supply orders; hr and sales may not (decision 9) | right | the same file |
| `public.order_review_approve(session, seen_version, lines)` | a head approves a waiting order WITH per-line quantities in ONE transaction (lines checked first, each change logged, stale version refused before any write); what the review screen calls | — | `order_review_approve_migration.sql` (applied 2026-09-23, 39 rows) |
| `public.order_create / order_edit / order_set_head_qty / order_approve / order_return / order_mark_sent / receive_order_item / order_cancel` | each checks role, status and creator itself and refuses with a Thai message the screen shows as it is; SECURITY DEFINER; the ONLY way to write the order tables (direct INSERT/UPDATE/DELETE are closed for every app role). `order_approve(session, seen_version)` refuses a stale version. `order_log_change` and `order_touch` are private (EXECUTE revoked). `order_set_head_qty` and `order_approve` are DROPPED, and `order_return` refuses a missing or blank note, by `order_old_functions_and_return_note_migration.sql` (applied 2026-09-24, 29 rows) | — | the same file |
| `public.current_role()` | returns the caller's `profiles.role`; NULL with no session | — | `migrations/0001_init.sql` |
| `public.can_see_prep(id)` | owner by role; anyone else, admins included, only with a grant row for that prep | — | `prep_owner_only_predicate_migration.sql` |
| `public.catering_event_unlocked(id)` | TRUE when the booking exists and `cost_locked_at` is null; used by the lock policies | — | `catering_sales_limits_migration.sql` |
| `public.catering_copy_set_menu(line_id)` | **owner, admin, sales** — copies a shared set's dishes into a booking's set line, verbatim, once; refuses a locked booking. SECURITY DEFINER, so its own checks stand in for the write policies it bypasses. **Replaced** by `catering_typed_dishes_per_head_and_maintenance_migration.sql` (applied 2026-09-25, 83 rows): copies a typed dish's name and link too | — | `catering_event_menu_items_migration.sql` (applied 2026-09-19) |
| `public.catering_save_event_menus(event_id, lines)` | **owner, admin** — ONE save of a booking's own menu: every changed set line whole (courses, THE price per table on the linked charge, a new custom set with its charge), in one transaction; refuses a locked booking, a line of another booking, a single dish, a duplicate set name, and a draft whose conflict token (row ids + price as opened) is stale. SECURITY INVOKER: runs under the caller's own RLS. **Replaced** by `catering_typed_dishes_per_head_and_maintenance_migration.sql` (applied 2026-09-25, 83 rows): a course is a menu dish OR a typed name (owner and admin may link a typed one to a real menu for its cost), and a new custom set may be per head | — | `catering_event_menu_save_migration.sql` (applied 2026-09-19) |
| `public.catering_save_set_draft(id, seen, name, price, items)` | **owner, admin** — a trial set's (is_draft) name, price and dishes in ONE transaction, the set row locked, refused when its updated_at is not `seen` (HINT 'conflict') and for a real set. SECURITY INVOKER. **Replaced** by `catering_typed_dishes_per_head_and_maintenance_migration.sql` (applied 2026-09-25, 83 rows): a draft may hold typed dishes and their links | — | `catering_event_sheet_and_set_drafts_migration.sql` (applied 2026-09-25, 117 rows) |
| `public.catering_save_typed_dishes(line_id, known_item_ids, items)` | **owner, admin, sales** — the TYPED dishes of one set line of a booking (dishes not in the menu list), whole: add, edit (name, section, quantity, note), remove. THE ONLY way sales writes a booking's menu (Nik, 2026-09-25, Q1): never a menu dish, never a link (a typed dish keeps owner/admin's link while its name is unchanged; a rename drops it), rewrites the typed rows so any older screen is refused by the id token, refuses a cancelled or cost-locked booking for everyone and a stale screen (HINT 'conflict'); a line never copied is copied first. SECURITY DEFINER: its checks stand in for the write policy sales does not have | — | `catering_typed_dishes_per_head_and_maintenance_migration.sql` (applied 2026-09-25, 83 rows) |
| `public.maint_create / maint_edit / maint_take / maint_done / maint_cancel` | แจ้งซ่อม, each checking role, status and reporter, SECURITY DEFINER, the ONLY writes (direct INSERT/UPDATE/DELETE revoked, maint_insert and maint_update dropped). create: any signed-in account, as itself. edit: the reporter or owner/admin/editor, while new. take: owner/admin/editor, new to in progress. done: owner/admin/editor, from new or in progress. cancel (instead of delete, Nik 2026-09-25, Q7): the reporter while new; owner/admin/editor while new or in progress; nobody once done; records cancelled_by, cancelled_by_name, cancelled_at, cancel_note | — | `catering_typed_dishes_per_head_and_maintenance_migration.sql` (applied 2026-09-25, 83 rows) |
| `public.handle_new_user()` (trigger on auth.users) | makes a `staff` profile for a new login — **every** new login until `security_fixes_and_menu_save_lock_migration.sql` (applied 2026-09-26), which limits it to `<username>@staff.local` (the team page's). Public sign-up was found ON live on 2026-09-25, and switched off by Nik on 2026-09-26 | — | `migrations/0001_init.sql`; replaced by the file above |
| "signed in" read policies (`menus_read_all`, `maint_read`, `coa_select`, `templates_select`, the SOP reads, the live `auth_read_profiles`, …) | every signed-in login **including one with no profile row** — until `security_fixes_and_menu_save_lock_migration.sql` (applied 2026-09-26) makes each ask `public.current_role() IS NOT NULL` | "signed in" reads as "a user of the app": **WRONG** for a login with no profile | many; the file lists each |
| SOP writes (`menu_sops`, `menu_sop_steps`, `menu_sop_ingredient_notes`) | **every signed-in account** (`"sop … write auth"`, `USING (true)`, 004) until `security_fixes_and_menu_save_lock_migration.sql` (applied 2026-09-26): owner, admin, editor (Nik, 2026-09-26: เวช writes SOPs; per-person narrowing may follow) | — | `migrations/004_sop_module.sql` |
| `ingredient_price_history` read | every signed-in account (0003) until the same file: owner, admin, editor | — | `migrations/0003_price_history.sql` |
| salaries: `employees.base_salary`, `position_allowance`, `social_security_monthly`, `daily_wage` | owner, hr, admin (row policy `admin_read`, hr_role_patch.sql) until `security_fixes_and_menu_save_lock_migration.sql` (applied 2026-09-26): the four columns are closed to every signed-in account and served by the view `employee_pay` to **owner and hr only**; admin keeps the rest of each row (attendance, leave, schedules, the team page). `payroll_periods`, `payroll_entries`: owner, hr (hr_role_patch.sql). App: `readPay()` in `owner/hr/actions.ts`, owner/hr only | — | hr_role_patch.sql; the file above |
| ingredient purchase costs: `ingredients.purchase_cost`, `receive_qty`, `yield_qty`, `prep_unit_costs()`, `pos_receipt_deliveries` | owner, admin, editor, **staff** until the same file: the three columns closed to every signed-in account and served by the view `ingredient_costs` to owner, admin and editor; `prep_unit_costs()` and the receipts drop staff. Staff keep names, units and par levels. App: `readIngredientCosts()` in `lib/data.ts` | — | costing_tables_rls_migration.sql, prep_recipe_access_migration.sql, pos_receipt_deliveries_migration.sql; the file above |
| `suppliers`, `pos_price_aliases` | made outside the repo; policies unknown until the same file prints them and replaces them with owner/admin read and write | — | none (live only) |
| `templates`, `template_items` writes | live policies unknown (the app wrote with the service key) until the same file: owner, admin, editor; `6f84f2b` moves the writes to the user's session | — | none (live only) |
| `public.catering_make_set_real(id, seen, name, price)` | **owner, admin** — clears is_draft with the name and price, one transaction, the row locked; refuses no dishes, a price of 0, a name a real set has, a stale version. SECURITY INVOKER | — | the same file |
| `public.catering_save_event_sheet(event_id, seen, notes, blocks, images)` | **owner, admin, sales** — a booking's event-details sheet whole (notes, picked terms, picked library images with this booking's captions) in ONE transaction; refuses a cancelled booking and a cost-locked one FOR EVERYONE, a stale version (HINT 'conflict'), another booking's row, a block or image the library does not hold, the same image twice, a saved pick turned into another image; returns the new version. SECURITY INVOKER | — | the same file |
| `public.catering_detail_upload_allowed(name)` | the bucket catering-details' upload rule: `lib/<digits>-<letters>.<ext>` (.jpg, .png or .webp), owner and admin, while the bucket holds fewer than 100 CURRENT files (live storage.objects is versioned: archived versions and delete markers do not count, and an upload may be neither). SECURITY INVOKER (counted as the caller, who reads the whole bucket) | — | the same file |
| `public.catering_save_booking_prices(event_id, lines, known_menu_ids, dry_run)` | **owner, admin, sales** — the booking screen's ONE save of a booking's price box: checks every line first, then removes the menu lines the screen dropped, adds new ones (with the booking's own copy of a set), rewrites the charges at THE ONE PRICE and moves the booking's `updated_at` (the screen's conflict token), all in one transaction; refuses a locked booking for everyone. `dry_run` checks and writes nothing; NULL is refused. SECURITY INVOKER: runs under the caller's own RLS. **Replaced** by `catering_event_sheet_and_set_drafts_migration.sql` (applied 2026-09-25): the free mark (`is_free` on a line; a dish marked free charged 0, its own price back when unmarked) and a draft refused as a new set line | — | `catering_booking_prices_save_migration.sql` (applied 2026-09-22) |

**There is no `is_admin()`,** in the repo or in the database (the list of
functions the database exposes, read 2026-09-17). "Owner, admin and editor"
is `is_editor_or_above()`, and that name is accurate.

**Policies that call `is_owner()`, and so admit admins, whatever their name
says** (live by the repo; policy text not read live):
- `app_settings_owner_write` (the q-factor). Meant owner-only (queue item
  23); the fix is written and HELD.
- `profiles_owner_write`. An admin could make itself owner (item 29);
  part A of `permissions_batch_2026_09_17.sql` caps it (applied
  2026-09-17).
- `profiles_select_own`. Admins read every profile, which the team screen
  needs; the name says "own". **And it decides nothing in practice:** the
  live `auth_read_profiles` (`USING true`, created by no file in the repo;
  README item 25) lets every signed-in account read every profile.
- `menus_owner_write`, `pos_sales_aliases_owner_write`: admin writes are
  intended.
- `stations_insert`, `stations_update`, `stations_delete`: admin writes are
  intended (008 says so).

**Policies that call `is_editor_or_above()`:** `order_sessions_update_editor`,
`order_sessions_delete`, `order_items_insert`, `order_items_update_editor`,
`order_items_delete` (008); `station_ingredients_insert`, `_update`,
`_delete` (009). All were written meaning editor and above. One has drifted
from the app since: marking an order sent became admin-only in the app
(`6dd173d`), and `order_sessions_update_editor` still lets an editor do it,
or any other status change, by a direct call. **`supply_order_approval_migration.sql`
(applied 2026-09-23) drops the five order policies and
closes every direct write on the order tables; the app then writes only
through the order functions.** The station policies stay as they are.

## App guards (`src/lib/auth.ts`, `src/lib/prep-access.ts`)

| guard | admits |
|---|---|
| `requireOwner()` | owner |
| `requireAdmin()`, `isAdminOrAbove()` | owner, admin |
| `requireAdminOrEditor()` | owner, admin, editor |
| `requireHR()` | owner, hr |
| `requireHROrAdmin()` | owner, hr, admin. Its pages call `getEmployees`, which gives pay to owner and hr only (`readPay`, `c88c44a`); the database serves pay through `employee_pay` to owner and hr only (applied 2026-09-26). Before that, admin received every salary (README item 28). |
| `requireSales()` | owner, admin, sales |
| `requireOrdering()` | owner, admin, editor, staff — every supply-ordering route (item 35, decision 9); hr and sales go home. `src/lib/order-rules.ts` is the screen's mirror of the database's order rules (who may edit, approve, return, send, receive, cancel, by role, creator and status), tested; the database functions enforce them |
| `requireProfile()` | every signed-in account that has a profile |
| — tested | `src/lib/auth-guards.test.ts` runs the shipped `auth.ts` as every role and checks this table; `src/lib/action-guards.test.ts` fails any exported server action that reaches the database before a guard (exceptions: login, logout) |
| `canSeePrep()`, `getPrepVisibility()` | owner by role; everyone else by grant row only. Never calls the SQL `can_see_prep()`. |
| `eventMenuAccess(role)` (`src/lib/event-menu-access.ts`) | `edit`: owner, admin; `view`: sales; `none`: everyone else. The one rule for a booking's OWN menu (catering per-event menus, item 39): the page renders by it, every write action refuses by it. The cost lock is a separate rule applied on top, with no role exception in the app. |
| `canEditTypedDishes(access)` (`src/lib/event-menu-access.ts`) | `edit` and `view`: owner, admin and sales — TYPED dishes only on a booking's own menu (Nik, 2026-09-25, Q1). It opens nothing else: menu dishes, prices, counts, links and shared sets stay `edit`. The view's `canEditTyped` adds the lock and cancellation; `catering_save_typed_dishes` enforces all of it |
| `canEditReport / canTake / canMarkDone / canCancel` (`src/lib/maintenance-rules.ts`) | the screen's mirror of the maint_* functions (a head is owner, admin or editor), tested role × status × reporter; the functions enforce them |
| `editAccess(role)` (`src/lib/edit-access.ts`) | `direct`: owner, admin; `request`: editor; `view`: everyone else. `!== "view"` is the one rule for who sees a dish's cost and margin: the recipe pages, the SOP editor, and the Star-to-Dog sort on `/staff` (item 37). Menu Engineering on `/owner` is NOT one of them — it is `isAdminOrAbove`, owner and admin. |

**Local checks that name one role and admit every other:**
- `role === "staff"` used to mean "no editing, no costs"
  (`staff/menu/[id]`, `staff/prep/[id]`, `saveRecipeItems`): hr and sales pass
  it. A check that excludes a role admits every role it does not name,
  including roles added later; use an allowlist, as `requireAdminOrEditor`'s
  comment says.
- `isAdmin = role === "admin"` in `sop/[menuId]/page.tsx` leaves the owner
  out; every other local `isAdmin` means owner or admin.

# Anything touching approvals gets an adversarial review before it ships

Item 27 (an editor's duplicate approved as an empty recipe) was designed,
implemented and self-checked with care, and then two review rounds, each
reviewer told to break it and each finding given to a refuter, found four
real problems in it:

- a retry deadlock: a failure between two writes left a half-made copy that
  no retry could finish;
- a guard gap: a request the queue hid could still be approved, its writes
  silently no-ops under RLS, and marked APPROVED;
- **a forgeable id.** The new row took the request's own id so that a retry
  could find it, but a request's id is chosen by whoever inserts it (the
  table's insert policy checks only `editor_id`). A forged request whose id
  equalled an existing menu's would have copied its lines INTO that menu.
  Now a SHA-256 of the id (`approvalRowId`);
- the table's read policy showing every admin what the queue hides
  (item 31).

Writing item 31's SQL twin of the queue's filter then found two more: the
filter and the approval disagreed on which prep a request is about.

**Why approvals, specifically.** A pending request is written by one person
and carried out by another with more rights. Every field of it is input
from the less-trusted side, and the approver's session does the writing.
That is the shape where careful code still goes wrong, because the author
reasons from the requests the app creates, not the ones a direct insert
can create.

So, for any change to `owner/approve/actions.ts`, `lib/pending-data.ts`,
`lib/pending-prep-id.ts`, `lib/approval-id.ts`, or the `pending_changes`
policies:

1. **Treat every column of the request as attacker-chosen:** id,
   `target_id`, `change_type` and every payload key, including its type
   (a JSON null, an array, a number where a string is expected).
2. **The id that was checked is the id that is written.** Derive both from
   one function, never re-read the payload for the write.
3. **Run an adversarial review before committing:** independent reviewers,
   each given one surface and told to break it (a forged request, a retry
   after a partial failure, a hidden prep, a request the app never writes),
   and a refuter for each finding. Fix what is confirmed, and write down
   what is accepted and why.
<!-- END:baseline-rules -->

<!-- BEGIN:secret-printing-rules -->
# Commands that print secrets, not configuration

`git remote -v` printed a Personal Access Token in full. The remote was
`https://user:ghp_...@github.com/...`, the command was run to check the remote's
shape before a push, and the token landed in the transcript. It had to be
revoked and rotated.

**Treat `git remote -v` as a secret-printing command, not a diagnostic one.**
When you need the remote's shape rather than its credential:

```
git remote get-url origin | sed 's|//.*@|//***@|'
```

or read the structure of `.git/config` without echoing credential fields.

The general shape, which is worth recognising before it happens rather than
after: **a command whose output looks like configuration but is partly a
secret, run in a context where every byte of output is transcribed.** The
output being "just settings" is exactly why it does not feel like a disclosure
while you are typing it. Others in this family:

- `env` / `printenv` / `Get-ChildItem Env:` — API keys, service-role keys
- `cat .env`, `.env.local`, `.npmrc`, `~/.aws/credentials`, `~/.netrc`
- `docker inspect`, `kubectl describe` — injected env and mounted secrets
- `curl -v` — Authorization headers echoed back
- any `psql`/`mysql` connection string with an inline password

When a value is needed, read it into a variable and use it; do not echo it. When
only its presence matters, print a boolean, or name its kind in words ("a
classic token", "a legacy JWT"), never the value or any part of it.

And if one does get printed: **say so immediately and recommend rotating**,
before and separately from whatever task it interrupted. A leaked credential
does not become safe because the command that leaked it was well intentioned,
and the person who can revoke it needs to know first, not as a footnote.

## Every search excludes .git, .env* and credential files (Nik, 2026-09-24)

**It happened on 2026-09-24.** A repo-wide grep for `github.com/nuknik55`,
run to see what making the repo private would break, excluded
`node_modules` and `.next` but not `.git`. It matched `.git/config` and
printed the remote URL with its classic token in full. Nik revoked every
classic token the same day, and the remote now holds no credential (Git
Credential Manager signs in instead). `.git/config` is exactly the file the
`git remote -v` rule above is about: a search walked into it by the side door.

**The rule:**
- **Every recursive search excludes `.git`, `.env*` and any credentials
  file** (`.git-credentials`, `.npmrc`, `.netrc`, `auth.json`, a
  `credentials` file anywhere). With grep:
  `--exclude-dir=.git --exclude='.env*' --exclude='*credentials*' --exclude=.npmrc --exclude=.netrc --exclude=auth.json`.
  The Grep tool skips `.git` already, but not `.env*`: exclude it there too.
- **No report and no command output may print a secret-looking value:** a
  token, key or password, or anything shaped like one (`eyJ…`, `sb_…`,
  `ghp_…`, `github_pat_…`, a long random string after `key=` or
  `token=`), **not even partly**: no prefix, no suffix, no "masked" middle.
  A search that could match one prints file names (`grep -l`) or counts, not
  lines. To report on a credential, print a boolean or its kind in words.
- **A git remote URL is printed only when it contains no `@`.**

# The service-role key: read-only against production, and say when it was used

**Nik's rule (2026-09-21).** `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS
policy in this project. It may be used for READ-ONLY queries against
production, and every report must say when it was used and what it read.
It must never be used to write, update or delete anything without Nik's
explicit permission for that specific change.

**Why there is a rule.** Nik did not know the key was secret. From the day
it was issued (2026-06-27) it was typed into commands, passed to
`vercel env add` on the command line, and opened with the Read tool, so it
sits in full in two Claude transcripts, about 120 times between 2026-06-27
and 2026-08-18. It was never committed and never reached the browser
bundle (checked 2026-09-21), but a key that has left the machine in
plaintext is exposed, and rotating it was recommended that day. **The
rotation is OPEN: Nik postponed it on 2026-09-21 (README queue item 45).**

**Using it without leaking it again:**
- Read it from `.env.local` into a variable inside the script. Never print
  it, never paste it into a command line, never open `.env.local` with
  Read or `cat`: each of those writes it into the transcript. To check that
  a variable exists, print its name or a boolean.
- A read-only script calls `select` and nothing else. Before running it,
  grep it for `.insert(`, `.update(`, `.upsert(`, `.delete(` and `.rpc(`,
  and run the same grep once on a line that has one, so the check can fail.
- The report names the tables it read with the key, and when.

<!-- END:secret-printing-rules -->

<!-- BEGIN:editing-and-verification-rules -->
# Editing files, and checking that you edited them correctly

Three traps, all hit in one round of work.

## 1. Deleting by boundary takes the NEXT symbol's comment

Removing a function by slicing from its start to `export async function <next>`
also removes the doc comment that belongs to `<next>`, because that comment sits
*above* the boundary. In a diff it looks like ordinary deleted lines — nothing
marks it as collateral.

This happened deleting `resubmitOrderSession`: `markOrderSent`'s
`/** Admin+ ... */` went with it.

**Check it deliberately.** After a deletion, list the removed comment lines and
confirm each belongs to the thing you meant to remove:

```
git diff -- <file> | grep "^-/\*\*"
```

Every hit should be a comment on the deleted symbol. One that is not is
collateral damage — restore it. Prefer ending the slice at the *next symbol's
comment* rather than at its `export`.

### And the mirror image: deleting dead code can take LIVE documentation

The rule above is about a comment that belongs to the neighbour. This one is
worse, because nothing in the diff looks wrong at all: **a SURVIVING
function's comment points AT the function being deleted**, so the explanation
of a rule that still runs lives inside the code being removed.

Found removing `addExpenseEntry` (queue item 18, a dead export with zero
callers). The surviving `updateExpenseEntry` carries the same permission
check, and its entire comment was:

```
// Fails CLOSED — same reasoning as addExpenseEntry above.
```

The reasoning — that a discarded error leaves `coa` null, so
`coa?.is_sensitive` is undefined, which is falsy, and a non-owner is let
through — existed once, inside the function about to disappear. Deleting it
would have left a live permission check commented with a pointer to nothing,
and the next reader no way to learn why it must fail closed.

**Before deleting a symbol, grep for its name in COMMENTS, not only in code.**
A hit means some other code is documented by reference to the thing you are
removing: move the explanation to where it is still needed BEFORE the
deletion, then assert afterwards that the name appears nowhere AT ALL,
comments included — otherwise the reference is left dangling.

Note the assertion has to be structural, for the reason in section 2: on this
very deletion, checking that `PosSalesAlias` was gone reported it still
present, because it is a substring of the surviving `upsertPosSalesAlias`
(since renamed `createPosSalesAlias`, 2026-09-21).

## 2. A verification check that matches text will match your own prose

Twice now:

- `s.includes("resubmitOrderSession")` failed after a correct deletion, because
  the *comment explaining where the rule went* names the function.
- Counting occurrences of `router.refresh()` reported five calls when there were
  four, because a new comment mentioned it.

Both times the postcondition was right to run and wrong in how it looked. **Match
structure, not text**, and assert the number you expect rather than "none":

```
if (s.includes("export async function resubmitOrderSession")) throw ...
if ((s.split("resubmitOrderSession").length - 1) !== 2) throw ...   // 2 comment refs, by design
```

### Strip comments before asserting on file contents

This has now happened three times, which makes it a missing rule rather than a
mistake. A check that greps a file will match the comment you just wrote
explaining the thing you are checking for:

- `s.includes("resubmitOrderSession")` failed after a correct deletion — the
  comment saying where the rule went names the function.
- Counting `router.refresh()` reported five calls when there were four.
- A migration check counted `WHERE category IS NULL` three times when the SQL
  contained two: the file header quoted the clause while explaining that the
  backfill uses it.

The first two were caught. The third **false-passed two assertions** and was
only noticed because the numbers looked wrong.

So strip comments first, then assert on what actually executes:

```
// SQL
const sql = raw.split(/?
/).filter((l) => !/^s*--/.test(l)).join("
");
// TS/JS — line comments
const code = raw.split(/?
/).filter((l) => !/^s*(//|*|/*)/.test(l)).join("
");
```

Better still, assert on parsed structure — statements, declarations, matched
lines — rather than on substrings anywhere in the file.

Counting statement lines beats counting substrings:

```
lines.filter((l) => l.trim() === "router.refresh();")
```

A check that can false-positive on documentation gets disabled or ignored, which
is worse than not having it.

### The same trap in production data: a note is not the row's contents

The two cases above are code. This one is data, and it reached a real person
before it was caught.

A CoA account was reported as holding a miscoded line because an entry in
`125 ไข่ไก่` had the note `"พี่สมหมาย / ไข่No.1 (15*134) , เยี่ยวม้า (1*385)"` — a
century egg, which belongs in `126 ไข่อื่นๆ`. The report was wrong. The bill had
been split into two entries and split correctly: ฿2,010 to 125 (exactly
15 × 134, the eggs) and ฿385 to 130 (the century egg). **The bookkeeper copies
the whole bill text into the note of every entry the bill is split across**, so
the note describes the BILL, not the row. The amounts were the evidence and they
already agreed.

The shape, and it is the same one as a regex matching its own comment: **a
string that looks like data about the row is really a copy of something else.**
Free-text fields written by humans — `note`, `detail`, `bill_ref` — are
descriptions of context, not a schema. So:

- **Reconcile against the numbers first.** `15 * 134 === 2010` settles what an
  entry contains; the note cannot.
- Treat a note naming several items as evidence of a SPLIT, not of a mixed row.
  Check whether sibling entries on the same date carry the same text.
- Before reporting a data defect to someone who will act on it, state which
  field the claim rests on. If the answer is "the note", it is a hypothesis.

### A query you never actually asked returns a clean, confident absence

Seventh in this family, and the first where the check was not matching the wrong
text but **addressing the wrong thing entirely.**

After pushing `746c50e`, the deploy was polled with
`?sha=746c50e5` — the seven-character short sha from `git log --oneline`, with a
digit appended to make it look like a real one. GitHub has no such commit, so it
answered `[]`. The poll printed:

```
attempt 1: no deployment yet
...
attempt 8: no deployment yet
[exited with code 0]
```

Eight clean lines and exit 0. **That reads exactly like "Vercel has not deployed
yet"** — a normal, patient, correct-looking result. The real deployment had
succeeded before the second attempt.

Take the identifier from the tool that owns it:

```
FULL=$(git rev-parse HEAD)      # never a short sha, never one you assembled
curl -s ".../deployments?sha=$FULL"
```

The general rule, and it is the same one as the regex matching its own comment:
**an absence must be distinguishable from an answer.** A lookup by identifier
should fail loudly when the identifier does not exist, rather than returning an
empty set that the surrounding prose reads as meaningful. Where the API cannot
tell you, assert the precondition yourself — that the sha is 40 characters, that
the row was found, that the file was non-empty — before believing the empty
result.

### A push is verified by TWO greens: the deploy AND the CI run

The same public API family answers both, keyed by the same full sha:

```
FULL=$(git rev-parse HEAD)      # assert 40 characters first, as above
curl -s ".../deployments?sha=$FULL"        # the Vercel deploy
curl -s ".../actions/runs?head_sha=$FULL"  # the CI run (lint + tests)
```

This second check exists because the notifier fired and nobody read it.
`.github/workflows/ci.yml` caught `d4abd73`'s stray brace **63 seconds after
the commit** (committed 2026-09-10T12:30:59Z; run concluded `failure` at
12:32:02Z) — and the red X plus its email, addressed to the account that
pushed, an inbox nobody watches for lint, went unread for a day while every
subsequent push inherited the red. The gate existed and fired; the signal
reached no one who would act on it. The pusher is the one who acts, so the
pusher reads the conclusion.

Reading the answer, with this section's own rule applied to it:

- A run has `status` and `conclusion`. Only `status: "completed"` carries a
  meaningful `conclusion`; `queued`/`in_progress` with `conclusion: null`
  means "not finished yet", never "passed". Poll until completed, as with the
  deploy.
- `total_count: 0` is an absence, not a green. Either the sha is wrong (the
  short-sha trap above) or the commit was not a push head — CI runs once per
  push, on its head, which is why `90e3d01` shows zero runs: it shipped
  mid-push under head `d366869`. After `git push`, HEAD **is** the push head,
  so zero runs is a loud failure to report, never a pass.
- **If CI is red, say so before anything else in the report**, the same way a
  failed deploy is reported. Two greens, or the push is not verified.

### A line-ending count that says CRLF about an LF file

Eighth. In this repo's Git Bash, `grep -c $'\r$' file` counts **every** line
of a pure-LF file: `printf 'a\nb\n'` into a file, then the grep, reports 2.
It was used to confirm that a new migration matched its siblings' CRLF. The
siblings were LF, and the report said the opposite of the truth; the
repository was fine only because `core.autocrlf=true` stores blobs as LF.
Count bytes instead:

```
node -e 'const b=require("fs").readFileSync(f);let cr=0;for(const x of b)if(x===13)cr++;console.log(cr)'
```

and run a counter on a file whose answer you already know before believing
it on one you do not.

### A paged read with no total order returns a steady, wrong total

Ninth. `getMonthlySummary` paged `expense_entries` through `fetchAllRows`
with no ORDER BY. August 2026 has held 1,003 entries since 2026-09-10. On
that day the read gave the right answer; by 2026-09-16 a replay of the
same query returned 1,003 rows of which only 1,000 were distinct: three
accounts doubled, three missing, operating profit 8.8% instead of 7.7%.
It gave the same figure on every run, with no error and no warning, which
is exactly what makes it look like the truth. A queue entry had even
recorded the risk, as "not currently biting", against two queries that
were in fact safe.

**Every paged query ends its ORDER BY on a unique key.** And count
DISTINCT ids when you check one, not rows: the row count was right.

#### What would have caught it, and why nothing did

`fetchAllRows` exists because of the 1,000-row cap, which was hit on the
coffee-items page and on the price-import preview (`a36ae74`, 58 of 251
materials). The rule written then was "any read that can exceed 1,000 rows
goes through this". That rule fixed TRUNCATION and said nothing about
order. The monthly P&L was paged the same way four days later
(`e572736`), and the check that followed compared the paged result with
**another read made the same way**:

- the August P&L was "recomputed the page's way", and that session's
  transcript shows the read it used: the page's own unordered
  `offset`/`limit` paging, with no ORDER BY. It agreed with the page
  because it was the same query.

That is baseline rule 2 broken in the one place it matters most. The
comparison shared the layer under test (the paging), so it could only
confirm it. And the row count, the one number anyone looked at, was
right the whole time.

So, for any read that pages:

1. **Check it against a source that does not page the same way:** the
   database's own `count=exact`, a SQL `sum()`, or a read ordered by the
   primary key. Compare DISTINCT ids and the sum, not the row count.
2. **Make the check fail for the right reason first.** The structural scan
   that found these (every `fetchAllRows` call must end its ORDER BY on
   `id` or the table's primary key) was run against HEAD before the fix.
   It had to flag the known defect, and its first version did not, because
   a query with no ORDER BY compared `undefined === undefined` and passed.
   **It is now `src/lib/paged-reads.test.ts`**, so `npm test`, and CI with
   it, fails any paged read whose ORDER BY does not end on a unique key,
   and any `.range(` outside `fetchAllRows`. Its first tests are inputs it
   must flag, and run against the tree before `ea9a251` it fails on exactly
   the eight reads fixed there.
3. **A rule that says how to page must say how to order.** A rule that
   solves half a problem reads as the whole solution, so the next person
   copies the half.

### A reader that indexes by name cannot see a duplicated part

Tenth. The owner's P&L Excel file gets its frozen panes patched in after the
library has written it, because xlsx-js-style writes no pane. The first patch
ADDED the worksheet part under its own name (`CFB.utils.cfb_add`) instead of
replacing the entry, so the package carried **two** `xl/worksheets/sheet1.xml`
parts: the original without the pane, and the patched one. Reading the file
back through SheetJS reported `pane: true` for both sheets — its reader keys
parts by name, and the last one wins — and the check had been written to
believe exactly that. A zip parsed by hand showed 13 entries where there
should have been 11. What would have shipped is a package Excel is free to
read the other way, or to call damaged.

**A reader that indexes by name cannot tell you whether a name occurs once.**
Whenever a container is produced by editing one rather than rebuilding it — a
zip, a JSON object merged from parts, a set of migrations, a Map — count the
entries with something that can see duplicates, and count them against a
number you knew before you looked. `pl-excel.test.ts` now parses the central
directory itself for that one reason.

### The list itself is the point

Ten instances, all the same shape: **output that reads as an answer when it is
an absence** — or, from the eighth on, when it is a wrong answer. Nobody
recognises the next one from first principles in the moment; they recognise it
because the earlier ones are written down. Add the next one here
rather than assuming it is too obvious to record.

## React resets a `<form action={fn}>` after the action runs — a file input read later is empty

The first production run of the POS revenue import failed at apply: the
preview had rendered, then `fileRef.current.files[0]` was `undefined`. Nothing
was written; the guard refused before the server was called.

The cause is React 19, by design, and it is in react-dom's source rather than
in anything this repo did. `startHostTransition` — the path every
`<form action={fn}>` submission takes — wraps the action as:

```js
function () { requestFormReset$1(formFiber); return action(formData); }
```

so an uncontrolled form is **reset after its action completes**. A file input
is uncontrolled. Submit the form once to build a preview, and the input that
apply then reads is already empty.

**`pos-item-categories` (the route named `coffee-items` until 2026-09-18) has
the identical pattern and only survives because it needs the file once.** The next page that needs a file twice — preview, then commit
the same file — will hit this again unless it does what `revenue-import` now
does:

- capture the `File` into React state in the input's `onChange`, and have
  every later step read state — never the DOM input;
- no `<form action>` around a file input the page will need again; a plain
  button reading state does not trigger the reset;
- when a different file is chosen, invalidate anything derived from the old
  one, and gate the commit step on the held file being the same object the
  preview came from (`import-state.ts`, `canApply`).

Server-side, still re-parse the submitted file and echo-check it against what
the preview returned. Holding the file in state is the client half of that
guard, not a replacement for it.

## 3. A generator eats backslashes: the regex that arrived as `inserts+into`

A patch applied through a JavaScript string layer loses every backslash it
does not double. `\s` in a JS string or template literal **is** `s` — an
unknown escape silently drops the backslash — so this:

```sql
'(?:insert\s+into|update|delete\s+from)\s+(?:\w+\.)?(\w+)'
```

landed in the migration as this:

```sql
'(?:inserts+into|update|deletes+from)s+(?:w+.)?(w+)'
```

which matches nothing, so `regexp_match` returned NULL, `v_table` was NULL,
and every RLS refusal in the harness was attributed to "a policy on another
table". The run aborted on the first negative control
(`catering_event_menu_items_migration.sql`, 2026-09-19, second failed run).

Three things follow, in order of how much they help:

1. **Do not push code through a string layer at all when you can avoid it.**
   Write the replacement text to a FILE and splice it in by line range
   (`replace-lines.cjs` prints the first and last line it is about to
   replace, so the range is checked against what is there). Nothing is
   escaped, so nothing can be de-escaped.
2. **Write the pattern so it needs no backslashes.** POSIX classes say what
   the shorthands say: `[[:space:]]` for `\s`, `[[:alnum:]_]` for `\w`,
   `[.]` for `\.`. A pattern with no backslash in it cannot lose one.
3. **Read back the bytes that landed**, not the bytes you sent. The check
   for this is mechanical — a regex literal (one containing `(?:`, or
   starting with `^`) must not contain a bare `s+`, `w+` or `d+`, which is
   what an eaten `\s+` leaves behind.

**And the reason it survived review:** the harness comparison DID print that
line as a difference from the applied migration it was copied from. The whole
diff was expected to differ — a different test vocabulary, extra exception
handlers — so it was read as "deliberate" wholesale and the corrupted line sat
inside it. **When a diff against a proven file is expected to differ, justify
every differing line individually, or the expected differences will hide the
unexpected one.**

**The mirror image: an escape that is DECODED.** The tools that write files
here (Write and Edit) turn a backslash-u escape — backslash, u, four hex
digits — into the character itself, and leave every other backslash as typed
(tested on a scratch file, 2026-09-22). A zero-width space written as its
escape landed as a real zero-width space inside a regex and in test strings:
the code worked, the source looked innocent, and no backslash count could
see it, because the backslash was gone. So never write that escape through
them; build the character from its code point (`String.fromCharCode(0x200b)`,
a `Set` of code points), and after writing, scan the file for invisible
characters (U+00A0, U+200B–U+200F, U+2060, U+FEFF), not only for backslashes.

## 4. Line endings are mixed in this repo — do not assume `\n`

`src/app/owner/hr/actions.ts` is CRLF while the files around it are LF. Three
anchor-based edits failed with an unhelpful "anchor not found" before the cause
was visible.

Detect and match, per file, rather than assuming:

```
const nl = s.includes("\r\n") ? "\r\n" : "\n";
```

and normalise inserted blocks with `.replace(/\r?\n/g, nl)`. Check a file's
endings by counting bytes, never with `grep -c $'\r$'` (see "A line-ending
count that says CRLF about an LF file" above). When an anchor you copied out of
the file "obviously matches" but does not, check the line endings before
rewriting the anchor. Long box-drawing rules (`─────`) are the other
common cause: the count rarely matches what you typed, so anchor on the code
instead.
<!-- END:editing-and-verification-rules -->

<!-- BEGIN:look-rules -->
# The app's look: one palette, one set of components (Nik, 2026-09-22)

Nik found the app inconsistent: catering used black primary buttons and a
wide left-aligned page, the SOP page green buttons and a narrow centred one;
the back link sat top-left on one page and top-right on another; every button
looked alike. The shared look below comes from the restaurant's brand
guideline (Krua Sompong, "Always Delicious"). **Step 1 (2026-09-22) moved four
pages to it:** the booking list, the booking screen (with the new-booking
page), the customer page and the SOP list, plus the catering sub-nav. **Step 2
(2026-09-23) moved every other page**, after Nik chose design-preview-b from
five samples, **except**: HR (paused for its rebuild: it has only what comes
globally — fonts, tokens, fields, the sidebar), the printed documents (the
quotation, the function sheets, the P&L print, the schedule print, the
receipt, the daily sheet's and the orders' print layouts, the SOP print) and
the Excel exports, which keep their own look. (`/owner/stations`, left out
of it too, was removed on 2026-09-24.) **New work uses these, and invents none of its own.**

## The shell (step 2)

- **Sidebar**: dark green (#2F5A16), the menu under four headings (ครัว,
  งานขาย, บริหาร, ตั้งค่า) grouped by label over each role's own list; the
  active item a gold pill with near-black text (8.8:1; gold TEXT on green is
  4.0:1 and fails). `app-header.tsx`.
- **Page**: off-white #F4F6F2; a bordered white box (a card, a table's box)
  gains a faint shadow on screen only. That rule is in `@layer components`
  and skips button, a and fields: unlayered, it took a secondary button's
  hover, shadow and focus ring, and the dialogs' and dropdowns' own shadows.
  A utility on the element (`shadow-xl`, `hover:bg-*`) wins over it.
  `<main>` is `min-w-0`: a long unbroken row scrolls inside its box
  instead of widening the page.
- **Fields, app-wide in CSS** (`globals.css`, the end): white; border
  #8A8A8A (3.45:1 on white, 3.17:1 on the page; WCAG 1.4.11 asks 3:1) for
  .input-base, .line-input and every field carrying border-neutral-200/300;
  placeholder #737373 (4.74:1); focus is .input-base's blue border and ring.
  A select is never :read-only-grey (it always matches :read-only).
- **neutral-500 is #6B6B6B**, not Tailwind's #737373, which fell to 4.36:1
  on the off-white page (redefined in a plain `@theme`, so every
  neutral-500 utility follows). `neutral-400` text is gone outside HR and
  the prints.

## Palette (tokens in `src/app/globals.css`)

| name | hex | Pantone | use |
|---|---|---|---|
| dark green `brand-green` | #2F5A16 | 2259 C | primary |
| gold `brand-gold` | #DFAF19 | 7406 C | pending, highlight; accent |
| bright green `brand-bright` | #358000 | 2424 C | success; accent |
| navy `brand-navy` | #00365B | 541 C | info; accent |
| teal `brand-teal` | #5DBEB3 | 2227 C | accent |
| red `danger` | #B42318 | (not brand) | delete and errors ONLY |

The guideline prints the dark green's RGB as 28/29/1, which is near-black
(#1C1D01) and contradicts its own HEX: a typo. The HEX is right, and it is
also the green the sidebar badge and active nav item have used all along.

## Colour roles: each has ONE meaning, the same everywhere

| role | means | badge (text on tint) | contrast |
|---|---|---|---|
| primary | the one main action, the active tab, the selected option | #2F5A16 on #EAEFE8 | 6.9:1 |
| pending | waiting on someone (รอมัดจำ), highlight | #5C4300 on #F9F1D6 | 8.2:1 |
| success | confirmed, secured (มัดจำแล้ว) | #2B6600 on #EBF2E6 | 6.1:1 |
| primary-strong | secured, the end of the road (คอนเฟิร์มแล้ว): solid | white on #2F5A16 | 8.1:1 |
| info | a neutral fact worth a colour (สอบถาม) | #00365B on #E6EBEF | 10.4:1 |
| neutral | nothing to flag (เสร็จสิ้น; ยกเลิก struck through) | #404040 on #F5F5F5 | 9.5:1 |
| danger | deleting, errors | #B42318 on #FEF3F2 | 6.1:1 |

**Red is danger and nothing else.** A cancelled booking is not dangerous, so
it is neutral and struck through, not red. **Accents** (the five brand
colours) are for things told apart, not judged: summary tiles, category tags
(`accentFor(key)` gives a key the same accent every time). An accent never
carries a role's meaning.

**Gold and teal FAIL as text on white** (2.0:1 and 2.2:1), and so does white
on them. They are fills, with near-black text (8.8:1 on gold, 8.1:1 on teal)
or their `-ink` colour on their `-soft` tint. The brand's own green-on-gold
is 4.0:1: large text only. **Every text/background pair must reach WCAG AA,
4.5:1** (3:1 for text 24px and up). `neutral-400` text (2.5:1) fails and is
gone outside HR and the prints; the field placeholders and borders that
failed after step 1 are fixed in CSS (see "The shell").

**Booking statuses (Nik, 2026-09-23)**, light to dark as a booking
progresses, through BookingStatusBadge and STATUS_TONE only: สอบถาม navy
(info), รอมัดจำ gold (pending), มัดจำแล้ว LIGHT green (success tint),
คอนเฟิร์มแล้ว DARK green (primary-strong), เสร็จสิ้น grey, ยกเลิก grey
struck through.

Pairs checked (2026-09-22): white on dark green 8.1 and on its hover
#234311 11.2; white on navy 12.5, on bright green 5.0 (AA, just), on red 6.6
and its hover 8.7; dark green on white 8.1; navy on white 12.5; bright green
on white 5.0; red on white 6.6; navy on teal 5.7; neutral-900 on white 17.9,
-700 10.4, -600 7.8, -500 5.3 (#6B6B6B since step 2: 5.1 on the neutral-50
zebra row, 4.9 on the page); neutral-700 on the neutral-200 table header 8.6.

## Fonts (`src/app/layout.tsx`, loaded by next/font, no font CDN)

- **Body text and tables: Noto Sans Thai** (Thai and Latin). Its digits are
  tabular. **Kanit's are not**: with `tabular-nums` on, "111,111.11" measured
  33px against 61px for "888,888.88", so a column of Kanit amounts cannot line
  up. Amounts in tables still carry `tabular-nums`.
- **Headings and buttons: `font-heading`** = Montserrat for Latin letters and
  digits (the brand's English face), Kanit for Thai (the brand's Thai face;
  Light, Medium, Bold in the guideline). `font-kanit` (Kanit alone) stays for
  the headings not yet moved.
- Arpona, the logo's display face, is paid: never loaded. The logo is an
  image.
- The printed catering documents keep Sarabun (`catering/[id]/print-font.ts`).
  **Never set a font on bare `h1`–`h3` globally**: an element's own font rule
  beats the one the document wrapper hands down.

## Buttons: three kinds (`src/components/ui/button.tsx`)

- **primary**: the ONE main action of an area. Filled dark green, a faint
  shadow, darker on hover, sinks 1px when pressed.
- **secondary**: every other action. White, outlined, a lighter shadow.
- **link**: quiet actions and navigation (back links). Plain grey text.
- **danger** turns any kind red, for ลบ. **dangerHover** (link only): ลบ in
  a row of data, grey at rest and red only under the pointer. **Disabled**
  is the same for all: half opacity, no shadow, no hover, never sinks.
- Not every control is one of the three: an underlined link inside a
  sentence (โหลดข้อมูลล่าสุด in a notice) and small icon controls (✕, ▲▼)
  keep their own look.

`<Button kind>` for a `<button>` (type defaults to "button"); `buttonClass(kind)`
for a Link that is an action. Each (kind, danger) pair is ONE complete class
list: two Tailwind classes that set the same property do not override each
other by their order in the string, so never add a colour class on top of
`buttonClass(...)`.

## Page layout (`src/components/ui/page.tsx`)

- **`PageShell`**: every page's container, and the content uses all of it:
  the same width (the booking list's, `max-w-6xl`) and the same left edge on
  every page, forms included. A narrower column for forms was tried and
  dropped: the header's actions floated beyond the content.
- **`PageHeader`**: the back link top LEFT, above the title; the title and a
  subtitle; the page's actions top RIGHT. `back.reload` draws the back link
  as a plain `<a>` (a full page load) for the pages whose back link always
  was one (accounting), so moving them to the header changed nothing.
- **Tables** (`ui/table.tsx`, `ui/row-link.tsx`): every header row is
  `TH_ROW` (neutral-200, neutral-700 semibold, a neutral-400 line, 8.6:1).
  Where a row opens a record, the row is a `RowLink`: click anywhere
  (Ctrl/⌘ and middle click open a new tab), the row is focusable and Enter
  opens it with a visible ring, and a button, link or field inside the row
  (or anything under `data-row-stop`) is its own action. No ดู link. It
  navigates with router.push, which a leave guard does not see: never on a
  page with unsaved-changes protection.
- **Dates** (`src/lib/thai-date.ts`): every date shown on a screen, "18/9/2569"
  (thaiDate), "ศ 18/9/2569" (thaiDateWithDay), "18/9/2569 14:05"
  (thaiDateTime), "18/9" (thaiDayMonth). A calendar date is shown as
  written; a timestamp is read in Asia/Bangkok. Only ISO text is read as a
  date; other text is shown as it came. Text that only looks like a date
  never goes through it: the POS report's period ("สิงหาคม 2569") is the
  report's own words, and new Date() once turned it into "1/1/3112". Not
  for stored values, native date inputs, prints or exports.
- **A floating save bar** (the booking screen): only while there are
  unsaved changes; the same buttons as below the form, verbatim; the body
  gets bottom padding equal to the bar's measured height, so it never
  covers the page; `lg:left-52`, beside the sidebar; z-10, under an open
  list (SearchSelect z-30, the customer box z-20) and the phone menu and
  dialogs (z-40, z-50). The SOP editor's bar also sits beside the sidebar.
- **`ButtonGroup`**: a labelled row of buttons (the booking screen's พิมพ์ and
  ดูข้อมูลเพิ่ม).
- **Tabs** (`ui/tabs.ts`): the sub-navs. The active tab is dark green with a
  green underline.
- **`StatTile`** (`ui/stat-tile.tsx`): a coloured summary tile, filled with an
  accent, the figure large (Nik likes dashboards with coloured tiles).
- **`Badge`** (a role), **`AccentTag`** (an accent), **`Segmented`** (a choice
  of a few options: the selected one is the primary tint, because a
  selection is not an action).

## The brand's graphic elements, for later, sparingly

The guideline also has a shell, sun rays, sea waves and a diamond net
pattern. None is used yet. Where they could go: the login page (the net as a
faint background, the waves along the bottom); empty states such as "no
bookings this month"; the printed quotation's header or footer band; the
sidebar's footer. Never behind data or text a person has to read.
<!-- END:look-rules -->

<!-- BEGIN:local-gate-rules -->
# `tsc` + `lint` is NOT enough before pushing

`npm run build` catches a class of error that neither typecheck nor eslint
reports. Both passed cleanly on a change that failed the build outright:

```
export const NON_OPERATING_GROUPS = ["G950", "G990"] as const;   // in a "use server" file
-> Error: A "use server" file can only export async functions, found object.
```

A `"use server"` file may export **only async functions**. A `const`, a type
object, a class, a plain value — all legal TypeScript, all accepted by eslint,
all fatal at build. The failure surfaces as `Failed to collect configuration
for /route` at page-data collection, once per affected route, which reads as a
routing problem rather than an export problem.

**So run `npm run build` before pushing**, not just `tsc --noEmit` and
`npm run lint`. The CI notifier deliberately does not run the build — Vercel
already gates it on deploy — which means an error of this class is caught
*after* the push, by a failed deployment, rather than before it.

Other things only the build catches: `"use client"` boundary violations,
invalid route segment config exports, and server/client import mixing.

Rule of thumb: **if a change touches a file with `"use server"` or
`"use client"` at the top, the build is part of the local gate**, not optional.
<!-- END:local-gate-rules -->
