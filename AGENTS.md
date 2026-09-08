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

## 3. Line endings are mixed in this repo — do not assume `\n`

`src/app/owner/hr/actions.ts` is CRLF while the files around it are LF. Three
anchor-based edits failed with an unhelpful "anchor not found" before the cause
was visible.

Detect and match, per file, rather than assuming:

```
const nl = s.includes("\r\n") ? "\r\n" : "\n";
```

and normalise inserted blocks with `.replace(/\r?\n/g, nl)`. When an anchor you
copied out of the file "obviously matches" but does not, check the line endings
before rewriting the anchor. Long box-drawing rules (`─────`) are the other
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
