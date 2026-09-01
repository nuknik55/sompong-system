# Written but never wired up

Six symbols the lint cleanup surfaced; **one is now resolved, five remain.** **None of these is dead code** — each is a
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

## 2–4. `isOwner` passed to three clients and never applied

| file | prop |
|---|---|
| `src/app/owner/accounting/AccountingEntryClient.tsx` | `isOwner: boolean` |
| `src/app/owner/accounting/daily/DailyEntryClient.tsx` | `isOwner: boolean` |
| `src/app/owner/hr/employees/EmployeesClient.tsx` | `isOwner: boolean` |

Each parent computes and passes `isOwner`; each child declares it in its props
type and never reads it.

The two accounting ones are worth a careful look. Sensitive COA accounts are
filtered **server-side** by `profile.role === "owner"` (in `getCoaForEntry`,
`getExpenseEntries` and friends), so this is not an active leak. But a client
being handed `isOwner` strongly suggests an owner-only UI affordance was
intended and never built — most likely showing sensitive accounts or an
owner-only control. Worth confirming with Nik what was meant before deleting.

`EmployeesClient`'s is likelier to be about salary fields, which HR already
gates server-side.

The prop bindings were removed from the destructuring so lint passes; the props
remain in each type with a pointer to this file, so the intent is still visible.

## 5. `isOwner` computed in a page and never used

`src/app/staff/menu/[id]/page.tsx:26` — `const isOwner = profile?.role === "owner"`

Same shape, one level up. Replaced with a comment; nothing was passed anywhere.

## 6. `isCreator` passed to `SessionActions` and never applied

`src/app/staff/inventory/[id]/SessionActions.tsx` — `isCreator: boolean`

An inventory order session knows who created it, and this component is handed
that fact but never uses it. Probably a "only the creator may edit/cancel"
rule that was never implemented. Server-side authorisation for those actions
should be confirmed rather than assumed — `requireProfile()` alone does not
check creatorship.

---

## Why this list exists

This is the same shape as the migration finding: work that was written, looks
present, and does nothing. There the gap was between a `.sql` file and the
database; here it is between a handler and a button. Both are invisible until
someone goes looking, and both were found by a tool rather than by use.

The `handleStatus` case is resolved (deleted). The five `isOwner`/`isCreator`
items remain open and still need a decision: wire up, or delete.
