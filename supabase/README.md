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

### Not applied

| object | file | status |
|---|---|---|
| `pos_receipt_deliveries` backfill | `scripts/backfill-pos-deliveries.mjs` | The table and `pos_import_settings` exist and are empty. Nothing in `src/` reads or writes them yet — the Path 2 persistence is still unimplemented. |

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

1. **Get `npm run lint` to exit 0.** In progress — see the queue below.
2. **Add a workflow that runs it.** Not started. Until it exists, the rule
   protects only what someone remembers to check.

Do not add `--quiet` or lower the rule severity to get a green run.

### The `set-state-in-effect` problems

Started at 9 across 7 components. They are **not** one repeated pattern — an
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

1. **Finish the `set-state-in-effect` fixes** (in progress — see above).
2. **Add a CI workflow that runs `npm run lint`.** Not started. Without it,
   item 1 buys nothing enforceable. See the section above for why this is a
   separate item rather than the tail of item 1.
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

6. **Quote-number prefix may not branch on location.** Not started, raised by
   Nik.

   Quote numbers use a `QSP-IN` / `QSP-OUT` convention — `IN` for in-house
   events, `OUT` for offsite. Nik confirms that is the intended meaning.

   The only live quote number is `QSP-IN6908-003`, so the `OUT` branch has
   never been observed. **Investigate whether `next_catering_quote_seq` or
   `issueCateringQuote` actually branches on `location_type` to choose the
   prefix, or whether `IN` is hardcoded.** If it is hardcoded, every offsite
   quotation issued so far carries the wrong prefix on a customer-facing
   document.

   Read the function definition in this directory first — do NOT probe
   `next_catering_quote_seq` against production to find out. It allocates and
   returns a sequence number; an earlier probe wrote a junk row that had to be
   deleted. See "Verifying applied status yourself" below.

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
