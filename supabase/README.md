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
directory, and it gets committed whether or not you have run it yet.

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

The POS backfill has also run: `pos_receipt_deliveries` holds **24,451** rows
(22,805 `day`-precision from the original load, 1,646 `month`-precision
recovered from document numbers on 2026-09-03), spanning 2025-04-01 to
2026-09-01. 11 rows remain unparseable — repeated header artefacts.

### Not applied

| file | waiting on | while it waits |
|---|---|---|
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

## The write-check rule is enforced locally, but nothing runs it

`local/no-unchecked-supabase-write` (in `eslint-rules/`) catches the class of
bug behind most of this file's history: a Supabase write whose error is
discarded. It is set to `"error"` in `eslint.config.mjs` and reports **zero**
violations today.

**Correction to what this section used to say.** It claimed the rule was "not
CI-enforced" because lint was not green, which implied a CI gate existed and was
being held back. There is no CI at all — no `.github/workflows` directory, and
`lint` is not wired into `build`. The rule fires only when someone runs
`npm run lint` by hand. Green lint enforces nothing on its own; something has to
run it.

So there are two separate pieces of work, and finishing the first does not
deliver the second:

1. **Get `npm run lint` to exit 0.** DONE. All nine are fixed or documented;
   the run is 0 errors, 0 warnings.
2. **Add a workflow that runs it.** Not started. Until it exists, the rule
   protects only what someone remembers to check.

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

## Queued work

In order. Nothing here is started unless it says so.

1. ~~Finish the `set-state-in-effect` fixes~~ — DONE.
2. **Add a CI workflow that runs `npm run lint`.** Not started. Lint is green
   as of 2026-09-11, so a gate would pass today. Without it, item 1 buys
   nothing enforceable. See the section above for why this is a separate item
   rather than the tail of item 1.

   **This item's own evidence, earned the hard way.** From 2026-09-10 to
   2026-09-11 `npm run lint` exited 1 for the whole repo and nobody noticed.
   `d4abd73` deleted a 70-line function body from
   `scripts/seed-item-categories.mjs` and replaced it with an import, leaving
   the function's closing `}` behind — a syntax error, confirmed by
   `node --check` against the committed blobs (`bea8cf6` passes, `d4abd73`
   fails). It was found only because an unrelated change ran lint a day later,
   and the line above used to claim lint was green while it was red.

   So the gap this item describes is not hypothetical: **a one-character
   regression survived a commit, a push and a production deploy**, and the
   only thing that would have caught it the same day is the workflow that does
   not exist yet. Fixed in the commit that wrote this paragraph; the item
   stays open, because the fix is the brace, not the gate.
3. **The 5 unwired `isOwner`/`isCreator` signals** in `UNWIRED_FEATURES.md`.
   Investigation first: for each, what it was evidently meant to gate and what
   wiring it would change, so the decision is informed rather than guessed.
4. **`ScheduleClient.tsx:5` static `xlsx` import** — bundle size only, no
   correctness stake. And **retry-from-here on POS chunk failure**.
5. **Menu Engineering should classify within category, not across all menus.**
   Not started, raised by Nik.

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

10. **`fetchAllRows` callers that order by a non-unique column.** Not started,
    not currently biting.

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

11. **Drop the orphaned `pos_coffee_items` table.** File written
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

12. **Defect C — Server Action throws elsewhere in the app.** Not started
    as a whole. Done page by page so far: coffee-items (`77877f9`),
    revenue-import (returns values from the start), and on 2026-09-10 the
    ingredients page (`7a6697b`: its four write actions return
    `{ status: "error", message }` — `deleteIngredient` had been building a
    Thai foreign-key message and then throwing it, so production redacted
    it). **The remainder is this item: about 139 throws across 12 files**,
    to be converted where a user can trigger them and left where they are
    unexpected-input paths. The error boundaries (`9fe11e7`) now show the
    digest for whatever still throws.

    The coffee-items page is done: `77877f9` returned the preview's expected
    failures as values, and the follow-up commit added the parse plausibility
    guard (`checkPosExportPlausibility` in `src/lib/pos-parse.ts` — Defect B,
    measured 24 genuine exports passing / 12 refused on named rules) and
    reworded the save-path throw, which stays: it is an unexpected-input path
    the screen cannot produce.

    Next.js redacts a thrown Server Action message in production; the client
    sees "An error occurred in the Server Components render" instead of the
    Thai text. **Every throw a user can trigger** — wrong file, stale form,
    empty input — needs to become a `{ ok: false, error }` return. Throws a
    user cannot trigger (Supabase `error.message` rethrows, tamper guards) may
    stay.

    `throw new Error(` per `"use server"` file, comments stripped, measured
    2026-09-09 — 143 in total. An earlier estimate of ~25 counted only the
    Thai-message subset; re-derive which are user-triggerable when this
    starts rather than trusting either number:

    | file | throws |
    |---|---:|
    | `owner/accounting/actions.ts` | 32 |
    | `owner/hr/actions.ts` | 26 |
    | `owner/ingredients/pos-import-actions.ts` | 16 |
    | `staff/prep/actions.ts` | 15 |
    | `owner/sales-import-actions.ts` | 11 |
    | `staff/menu/actions.ts` | 10 |
    | `owner/ingredients/actions.ts` | 8 |
    | `owner/catering/actions.ts` | 7 |
    | `sop/actions.ts` | 6 |
    | `staff/actions.ts` | 5 |
    | `owner/approve/actions.ts` | 3 |
    | `owner/catering/[id]/cost/actions.ts` | 3 |
    | `owner/settings/actions.ts` | 1 |

    The nav link landed in `91a503a`; item 11's DROP file is written. Next is
    the unified revenue import.

13. **Rename the `coffee-items` route to match its title.** Deferred —
    **conditional, not standalone.** The page is titled จัดหมวดสินค้า POS and
    covers six categories; the route still says `coffee-items` from when it
    covered one. Decided 2026-09-09: do it only the next time that folder is
    touched for another reason. The return is cosmetic, and two applied SQL
    files will carry the old path permanently either way.

    Inventory, so the rename is one commit when it happens:

    | where | what |
    |---|---|
    | `src/app/owner/accounting/coffee-items/` | `git mv` the folder; `page.tsx`, `actions.ts`, `CoffeeItemsClient.tsx`, `categories.ts` move with it |
    | `coffee-items/actions.ts` — `revalidatePath("/owner/accounting/coffee-items")` | the one that breaks silently if missed: stale page, no error |
    | `src/app/owner/accounting/page.tsx` | the nav link |
    | `next.config` | add a redirect from the old path — Nik has the URL bookmarked |
    | `supabase/seed_pos_item_categories.sql` (2 mentions) | **applied — leave as is.** An applied migration keeps describing what executed |
    | `scripts/seed-item-categories.mjs` (2) | generates that SQL text; one-time tooling, update or leave |
    | this README (3) and the memory note (1) | text |
    | `CoffeeItemsClient` identifier | cosmetic; rename in the same commit or not at all |

14. **`/owner/ingredients` throws an RSC error on saving a NEW ingredient, but
    the save succeeds.** Not started. Reported by Nik from production,
    2026-09-09.

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
    persists it, so `sectionForCharge` in `BookingScreen.tsx` reconstructs it
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

**Checked and closed 2026-09-09, not queued:** every `page.tsx` under
`src/app/owner` has at least one link to it. The one grep miss,
`/owner/hr/schedule/print`, is opened through a computed `printUrl` in
`ScheduleClient.tsx`. `/owner/accounting/revenue-import` was linked from the
accounting tool row in the same commit that created it (`d56a5ee`).

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
(`groupBySection` over `catering_set_menu_items.section`): the customer, the
floor and the kitchen cannot be told three different things. **The print
contract:** a section with no rows prints nothing at all — no heading, no
blank row. Verified end-to-end by Nik: setting one dessert made ขนมหวาน
separate on the printed sheet.

### The rules that are NOT obvious from the layouts

- **B's ราคา column is a PORTION SIZE, not money.** `selling_price x
  plates-for-the-whole-job` (per-set count × sets ordered — `plateCount()`),
  literal, never multiplied. THE MULTIPLIER TOOK THREE READINGS — table
  count, then per-set count alone, both shipped and both wrong on paper;
  the paper's "590 x 6" was 1 × 6 sets, which all three readings happened
  to equal, so only Nik's real 10-set booking could tell them apart. The
  full history is beside plateCount() in src/lib/kitchen-sheet.ts. No row
  total, no grand total — the dishes deliberately do not sum to the package
  price. Extras print price × count too, never a blank. EXCEPT a buffet:
  `food_format = 'buffet'` blanks the whole ราคา column, because Nik's
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
| the screen at `/owner/accounting/coffee-items` | live |
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
row's category on `/owner/accounting/coffee-items`, not code — there is no
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
