# Written but never wired up

Six symbols the lint cleanup surfaced. **All six are now resolved** — four
deleted deliberately, one wired up, one (leave approve/reject) deleted earlier. **None of these is dead code** — each is a
complete implementation with nothing calling it. They are listed here rather
than deleted, because deleting them silently discards a decision someone made,
and two of them look like permission gates.

Each needs one of two answers: **wire it up**, or **delete it deliberately**.

---

## 1. ~~Leave approve/reject~~ — RESOLVED, deleted 2026-08-31

Nik’s decision: **no approval workflow.** HR is for record-keeping and
communication (who is on leave when) to make payroll and scheduling easier;
it is not in active use yet because the data is not ready.

So the code now matches reality. Deleted: `LeaveClient.handleStatus` and the
`updateLeaveStatus` server action it was the only caller of.
`upsertLeaveRequest` keeps its hardcoded `status: "approved"` — every request
is approved on submission, deliberately.

The `status` column, its filter and its badge stay: they still render, and
they leave the door open if an approval step is ever wanted.

## 2–4. ~~`isOwner` passed to three clients and never applied~~ — RESOLVED 2026-09-06, all three deleted

| file | outcome |
|---|---|
| `src/app/owner/accounting/AccountingEntryClient.tsx` | deleted |
| `src/app/owner/accounting/daily/DailyEntryClient.tsx` | deleted |
| `src/app/owner/hr/employees/EmployeesClient.tsx` | deleted |

**The two accounting ones were genuinely redundant.** Sensitive COA accounts
are filtered server-side — `getCoaForEntry` drops `is_sensitive` rows for
non-owners, and both entry readers filter them too. A non-owner client never
receives those rows, so wiring `isOwner` could not have changed what is
visible; at most it could have displayed a "some accounts are hidden" notice.
Nik's decision: **no indicator.** Security is identical either way; this is
purely about disclosure, and he would rather not disclose that hidden accounts
exist.

**The HR one was based on a false claim in this file, which is corrected
below.**

### Correction: salary fields were never server-gated

An earlier version of this document said `EmployeesClient`'s `isOwner` was
"likelier to be about salary fields, which HR already gates server-side."

**That was wrong.** `getEmployees()` and `getEmployee()` select `base_salary`,
`position_allowance` and `social_security_monthly` with **no role branch at
all**. What gates them is page access: `requireHR()` admits `owner` **and**
`hr`. So an `hr` user has always seen full salary data, identically to an
owner. There was no owner-vs-hr distinction anywhere to wire `isOwner` up to.

Nik decided the access is correct — **`hr` SHOULD see salaries, because payroll
is their job** — so `isOwner` was deleted rather than wired. The decision is now
recorded as a comment above `getEmployees()` in `src/app/owner/hr/actions.ts`,
where someone auditing an ungated salary select will actually find it. Without
that, the next audit sees a missing filter and "fixes" it, breaking payroll.

This is the third time in this project that a status document asserted
something the code contradicted, and each time the document understated what
was true — the direction that causes someone to redo work or undo a decision.

## 5. ~~`isOwner` computed in a page and never used~~ — RESOLVED 2026-09-06, deleted

`src/app/staff/menu/[id]/page.tsx` — the page already computes
`isAdmin = admin || owner` and gates on that, and cost visibility is gated by
`isStaff`. Owner and admin are treated identically throughout, so there was no
owner-only behaviour to attach it to. The comment and the unused constant are
gone.

## 6. ~~`isCreator` passed to `SessionActions` and never applied~~ — RESOLVED 2026-09-06, wired up

**This one was not cosmetic. It was a live authorisation gap**, and the rule it
should have enforced was already written down — in a function nothing called.

`resubmitOrderSession()` captured the profile, compared `created_by`, and
rejected non-creators with "เฉพาะผู้กรอกเดิมเท่านั้นที่ส่งซ้ำได้". It had **no
callers anywhere**. What the UI actually called was
`updateItemsAndResubmit()`, which did strictly more (it rewrites quantities as
well as resubmitting), ran on the SERVICE ROLE client so RLS did not apply,
selected `created_by` and **never compared it**. The orphaned select was the
fossil of someone starting the check and stopping.

Reachable by any authenticated user of any role: the session page is only
`requireProfile()`, and the returned-edit form rendered with no gate at all.

Fixed together with a second gap found while reading the same file:
`saveEditorItemEdit` and `saveReviewerItemEdit` both updated `.eq("id", itemId)`
without scoping to the session, so any item in the database could be edited by
passing its id. Both are now scoped to `session_id`.

`resubmitOrderSession` was deleted — after the fix it is a strict subset of
`updateItemsAndResubmit`. The rule moved; it did not disappear.

**Policy note:** the original written rule was creator-only with no exception.
It was deliberately relaxed to creator-OR-admin/owner, because a restaurant
supply order has a same-day deadline and creator-only leaves a returned order
blocked until that staff member's next shift. Recorded in the code so nobody
"restores" the stricter rule thinking it was lost by accident.

---

## Why this list exists

This is the same shape as the migration finding: work that was written, looks
present, and does nothing. There the gap was between a `.sql` file and the
database; here it is between a handler and a button. Both are invisible until
someone goes looking, and both were found by a tool rather than by use.

All six are closed. Five were deleted after being confirmed redundant or
decided against; one — `isCreator` — turned out to be a live authorisation gap
and was wired up.

The lesson worth carrying: **four of six were cosmetic and one was a real
security hole, and they looked identical from the lint output.** The only way
to tell them apart was reading each one and checking what the server actually
enforced. A list like this cannot be triaged by pattern.
