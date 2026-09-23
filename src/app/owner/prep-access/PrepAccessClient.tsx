"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/tabs";
import { grantPrepAccess, revokePrepAccess, grantAllPreps, revokeAllPreps } from "./actions";
import type { PrepAccessRecipe, PrepAccessPerson, PrepAccessGrant } from "@/lib/prep-access";
import { buttonClass } from "@/components/ui/button";
import { thaiDate } from "@/lib/thai-date";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", editor: "Editor", staff: "Staff" };

function fmtDate(iso: string) {
  return thaiDate(iso);
}

/**
 * Rendered from the props, with no local copy of the grants (queue item 17's
 * lesson, learned on the rates screen): every write goes server action ->
 * router.refresh() -> new prop, so the screen can only ever show what the
 * database holds. A mirror here would be worse than on most screens — a ticked
 * box that did not save is a person who cannot see a recipe you believe they
 * can.
 */
export function PrepAccessClient({
  recipes,
  people,
  grants,
}: {
  recipes: PrepAccessRecipe[];
  people: PrepAccessPerson[];
  grants: PrepAccessGrant[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  const key = (prepId: string, personId: string) => `${prepId}:${personId}`;
  const granted = new Map(grants.map((g) => [key(g.prepRecipeId, g.profileId), g]));
  const countByRecipe = new Map<string, number>();
  const countByPerson = new Map<string, number>();
  for (const g of grants) {
    countByRecipe.set(g.prepRecipeId, (countByRecipe.get(g.prepRecipeId) ?? 0) + 1);
    countByPerson.set(g.profileId, (countByPerson.get(g.profileId) ?? 0) + 1);
  }

  // Closed-by-default as a NUMBER rather than an assumption: how many recipes
  // nobody but the owner can see. If this ever reads 0 unexpectedly, someone
  // has been granted everything.
  const unheld = recipes.filter((r) => !countByRecipe.get(r.id)).length;

  // ── Why these handlers catch, and why they use finally ─────────────────
  //
  // Item 12 made EXPECTED failures return a Thai message instead of throwing,
  // because production redacts thrown Server Action messages. It could not do
  // anything about failures BELOW that layer, which still throw: a stale
  // Server Action id after a deploy (the client bundle holds action hashes
  // from the build it was loaded from), a dropped connection, a redeploy while
  // a tab sits open.
  //
  // Without the catch, such a rejection was completely invisible — no message,
  // nothing moved — and because setBusy(null) sat after the await it never
  // ran, leaving that row reading "กำลังบันทึก…" for good. So the finally is
  // not tidiness; it is the half that unsticks the button.
  //
  // This matters more here than on any other screen: once the RLS policies are
  // narrowed, this is the ONLY tool for repairing access, and a repair tool
  // that fails silently is a locked door with no handle.
  //
  // The message names the fix rather than the fault, because refreshing is
  // exactly what resolves the likeliest cause.
  const RETRY_MESSAGE = "บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

  function toggle(prepId: string, personId: string, isGranted: boolean) {
    setError(null);
    setBusy(key(prepId, personId));
    startTransition(async () => {
      try {
        const result = isGranted ? await revokePrepAccess(prepId, personId) : await grantPrepAccess(prepId, personId);
        // The screen moves only on success, so it can never contradict the
        // database — the same rule as everywhere else in this app.
        if (result.status === "error") { setError(result.message); return; }
        router.refresh();
      } catch {
        setError(RETRY_MESSAGE);
      } finally {
        setBusy(null);
      }
    });
  }

  function bulk(person: PrepAccessPerson, mode: "grant" | "revoke", held: number) {
    // Revoking silently is not recoverable by the person it happens to — they
    // simply stop seeing recipes they were working from. Granting is undone by
    // revoking, so only one of these asks.
    if (mode === "revoke" && !confirm(`ปิดสิทธิ์ทั้งหมดของ ${person.fullName} (${held} สูตร) ใช่ไหม?`)) return;
    setError(null);
    setBusy(`all:${person.id}`);
    startTransition(async () => {
      try {
        const result = mode === "grant" ? await grantAllPreps(person.id) : await revokeAllPreps(person.id);
        if (result.status === "error") { setError(result.message); return; }
        router.refresh();
      } catch {
        setError(RETRY_MESSAGE);
      } finally {
        setBusy(null);
      }
    });
  }

  const q = query.trim().toLowerCase();
  const shownRecipes = q ? recipes.filter((r) => r.name.toLowerCase().includes(q)) : recipes;

  const byRecipe = (
    <div className="space-y-3">
      <input
        className="w-full max-w-sm rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        placeholder="พิมพ์ค้นหาชื่อสูตร..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {shownRecipes.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-500">ไม่พบสูตร</p>}
        {shownRecipes.map((r) => {
          const n = countByRecipe.get(r.id) ?? 0;
          const open = openRecipe === r.id;
          return (
            <div key={r.id} className="border-b border-neutral-100 last:border-0">
              <button
                type="button"
                onClick={() => setOpenRecipe(open ? null : r.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 text-sm text-neutral-800">
                  {r.name}
                  {r.category && <span className="ml-2 text-xs text-neutral-500">{r.category}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${n === 0 ? "bg-neutral-100 text-neutral-500" : "bg-success-soft text-success-ink"}`}>
                  {n === 0 ? "ยังไม่เปิดให้ใคร" : `${n} คนเห็น`}
                </span>
              </button>
              {open && (
                <div className="space-y-1 border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
                  {people.length === 0 && <p className="text-sm text-neutral-500">ไม่มีผู้ใช้ที่เปิดสิทธิ์ได้</p>}
                  {people.map((p) => {
                    const g = granted.get(key(r.id, p.id));
                    const k = key(r.id, p.id);
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-2 py-1">
                        <button
                          type="button"
                          disabled={isPending && busy === k}
                          onClick={() => toggle(r.id, p.id, !!g)}
                          className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                            g
                              ? "border-success/30 bg-success-soft text-success-ink hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                              : "border-neutral-300 bg-white text-neutral-600 hover:border-success/30 hover:bg-success-soft hover:text-success-ink"
                          }`}
                        >
                          {busy === k ? "กำลังบันทึก…" : g ? "✓ เห็นสูตรนี้" : "เปิดให้เห็น"}
                        </button>
                        <span className="text-sm text-neutral-700">{p.fullName}</span>
                        <span className="text-xs text-neutral-500">{ROLE_LABEL[p.role] ?? p.role}</span>
                        {g && (
                          <span className="text-xs text-neutral-500">
                            · เปิดเมื่อ {fmtDate(g.grantedAt)}
                            {g.grantedByName ? ` โดย ${g.grantedByName}` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // One line per person, expanded on tap. It used to render every person's
  // full list at once — 8 people against 48 recipes — and Nik's verdict was
  // "กดที่ชื่อเด้งขึ้นมาดีกว่า อย่างนี้ยาวมาก". The counts stay visible while
  // collapsed, because "who can see how much" is the question this view exists
  // to answer at a glance.
  //
  // THE EXPANDED LIST SHOWS ALL 48, NOT ONLY WHAT THE PERSON HOLDS, and that
  // is a fix rather than a flourish. It used to list only granted recipes, so
  // revoking one made its row DISAPPEAR — the action deleted its own undo, and
  // the only way back was เปิดทั้งหมด and start again, which is worse than the
  // mistake. Nik hit it on his first use, revoking ข้าวเหนียวมูน from เวช.
  // Same family as the silent-failure items: the write was correct and its
  // reversal was unreachable from where it happened. Revoking one recipe is
  // also the likelier error by far, so that path is the one that must forgive.
  // Now the row toggles in place.
  //
  // Granted first, then not-granted, each under a count — which also makes
  // this view answer "what can เวช NOT see" without changing tabs. The list is
  // 48 rows for one expanded person, the same length as the ตามสูตร tab, and
  // only ever for one person at a time.
  //
  // ตามสูตร never had this defect in the other direction: it renders every
  // person on every recipe and only changes the button, so granting there
  // leaves the row exactly where it was.
  const byPerson = (
    <div className="space-y-2">
      {people.map((p) => {
        const held = countByPerson.get(p.id) ?? 0;
        const open = openPerson === p.id;
        const allKey = `all:${p.id}`;
        const heldRecipes = recipes.filter((r) => granted.has(key(r.id, p.id)));
        const notHeldRecipes = recipes.filter((r) => !granted.has(key(r.id, p.id)));
        // A plain function, deliberately not a component: called inline, it
        // cannot remount its inputs the way a component declared during render
        // would (see the note in catering/shared.tsx).
        const rowFor = (r: PrepAccessRecipe) => {
          const g = granted.get(key(r.id, p.id));
          const k = key(r.id, p.id);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-neutral-50 px-4 py-2 last:border-0">
              <button
                type="button"
                disabled={isPending && busy === k}
                onClick={() => toggle(r.id, p.id, !!g)}
                className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  g
                    ? "border-success/30 bg-success-soft text-success-ink hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                    : "border-neutral-300 bg-white text-neutral-600 hover:border-success/30 hover:bg-success-soft hover:text-success-ink"
                }`}
              >
                {busy === k ? "กำลังบันทึก…" : g ? "✓ เห็นสูตรนี้" : "เปิดให้เห็น"}
              </button>
              <span className="min-w-0 flex-1 text-sm text-neutral-700">{r.name}</span>
              {g && (
                <span className="shrink-0 text-xs text-neutral-500">
                  เปิดเมื่อ {fmtDate(g.grantedAt)}{g.grantedByName ? ` โดย ${g.grantedByName}` : ""}
                </span>
              )}
            </li>
          );
        };
        return (
          <div key={p.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              {/* The toggle and the bulk buttons are siblings, never nested —
                  a button inside a button is invalid and swallows taps. */}
              <button
                type="button"
                onClick={() => setOpenPerson(open ? null : p.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className={`text-xs text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                <span className="min-w-0 truncate text-sm font-medium text-neutral-800">{p.fullName}</span>
                <span className="shrink-0 text-xs text-neutral-500">{ROLE_LABEL[p.role] ?? p.role}</span>
                <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${held === 0 ? "bg-neutral-100 text-neutral-500" : "bg-success-soft text-success-ink"}`}>
                  {held} / {recipes.length} สูตร
                </span>
              </button>
              {held < recipes.length && (
                <button
                  type="button"
                  disabled={isPending && busy === allKey}
                  onClick={() => bulk(p, "grant", held)}
                  className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:border-success/30 hover:bg-success-soft hover:text-success-ink disabled:opacity-40"
                >
                  {busy === allKey ? "กำลังบันทึก…" : `เปิดทั้งหมด (${recipes.length})`}
                </button>
              )}
              {held > 0 && (
                <button
                  type="button"
                  disabled={isPending && busy === allKey}
                  onClick={() => bulk(p, "revoke", held)}
                  className={buttonClass("secondary", { size: "sm", className: "shrink-0" })}
                >
                  {busy === allKey ? "กำลังบันทึก…" : "ปิดทั้งหมด"}
                </button>
              )}
            </div>
            {open && (
              <div className="border-t border-neutral-100">
                <p className="bg-neutral-50 px-4 py-1.5 text-xs font-medium text-neutral-500">
                  เห็นอยู่ ({held})
                </p>
                {heldRecipes.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-neutral-500">ยังไม่เห็นสูตรของเตรียมใดเลย</p>
                ) : (
                  <ul>{heldRecipes.map(rowFor)}</ul>
                )}
                <p className="bg-neutral-50 px-4 py-1.5 text-xs font-medium text-neutral-500">
                  ยังไม่เห็น ({recipes.length - held})
                </p>
                {notHeldRecipes.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-neutral-500">เห็นครบทุกสูตรแล้ว</p>
                ) : (
                  <ul>{notHeldRecipes.map(rowFor)}</ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-danger/70 hover:text-danger">✕</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-lg bg-neutral-100 px-3 py-1.5 text-neutral-700">สูตรทั้งหมด {recipes.length}</span>
        <span className={`rounded-lg px-3 py-1.5 ${unheld === recipes.length ? "bg-pending-soft text-pending-ink" : "bg-neutral-100 text-neutral-700"}`}>
          ยังไม่เปิดให้ใครเลย {unheld} สูตร
        </span>
        <span className="rounded-lg bg-neutral-100 px-3 py-1.5 text-neutral-700">เปิดสิทธิ์แล้ว {grants.length} รายการ</span>
      </div>

      <Tabs
        tabs={[
          { label: "ตามสูตร (เปิดสิทธิ์)", content: byRecipe },
          { label: "ตามคน (ตรวจสอบ/ปิดสิทธิ์)", content: byPerson },
        ]}
      />
    </div>
  );
}
