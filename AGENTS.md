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
  a cleanup DELETE.
- **Each test write touches one row.**
- **The header lists every statement the editor may call destructive,**
  and says that anything else is unexpected.
- **Never "Run and enable RLS".** A policy the editor invents is not one
  anyone reviewed.

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
| `public.current_role()` | returns the caller's `profiles.role`; NULL with no session | — | `migrations/0001_init.sql` |
| `public.can_see_prep(id)` | owner by role; anyone else, admins included, only with a grant row for that prep | — | `prep_owner_only_predicate_migration.sql` |

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
or any other status change, by a direct call. That belongs to the
supply-order approval work (README item 35).

## App guards (`src/lib/auth.ts`, `src/lib/prep-access.ts`)

| guard | admits |
|---|---|
| `requireOwner()` | owner |
| `requireAdmin()`, `isAdminOrAbove()` | owner, admin |
| `requireAdminOrEditor()` | owner, admin, editor |
| `requireHR()` | owner, hr |
| `requireHROrAdmin()` | owner, hr, admin. **Its pages DO receive salary columns** (attendance, leave, schedule call `getEmployees`); its comment "no salary data" is wrong. README item 28. |
| `requireSales()` | owner, admin, sales |
| `requireProfile()` | every signed-in account that has a profile |
| `canSeePrep()`, `getPrepVisibility()` | owner by role; everyone else by grant row only. Never calls the SQL `can_see_prep()`. |

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
only its presence matters, print a boolean or a masked prefix, never the value.

And if one does get printed: **say so immediately and recommend rotating**,
before and separately from whatever task it interrupted. A leaked credential
does not become safe because the command that leaked it was well intentioned,
and the person who can revoke it needs to know first, not as a footnote.
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
present, because it is a substring of the surviving `upsertPosSalesAlias`.

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

### The list itself is the point

Nine instances, all the same shape: **output that reads as an answer when it is
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

**`coffee-items` has the identical pattern and only survives because it needs
the file once.** The next page that needs a file twice — preview, then commit
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

## 3. Line endings are mixed in this repo — do not assume `\n`

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
