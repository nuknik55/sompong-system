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

Verified against production on 2026-08-30 by probing every table, column, view
and function declared across all 42 files.

**Applied: everything except the two below.** All tables, columns and views exist.

### Not applied

| object | file | status |
|---|---|---|
| `app_settings` | `migrations/0002_q_factor.sql` | **Live bug.** `getQFactorPct()` in `src/lib/data.ts` silently falls back to a hardcoded 3; `updateQFactor()` throws. Waiting on the real kitchen q-factor figure before running. |
| `schedule_notes` | `schedule_notes_migration.sql` | Reviewed, ready to run. The schedule-notes feature does not work until it lands, and `upsertScheduleNote` carries the codebase's only `eslint-disable` for `local/no-unchecked-supabase-write` until then. |

### Removed rather than applied

`ot_rules` was declared in `hr_migration.sql`, never applied, and referenced by
no code. The declaration, its policies, its seed rows, and the matching policy
block in `hr_role_patch.sql` were deleted rather than run.

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
