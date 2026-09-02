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
