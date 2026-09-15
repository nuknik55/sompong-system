"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/tabs";
import { grantPrepAccess, revokePrepAccess, grantAllPreps, revokeAllPreps } from "./actions";
import type { PrepAccessRecipe, PrepAccessPerson, PrepAccessGrant } from "@/lib/prep-access";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", editor: "Editor", staff: "Staff" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
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

  function toggle(prepId: string, personId: string, isGranted: boolean) {
    setError(null);
    setBusy(key(prepId, personId));
    startTransition(async () => {
      const result = isGranted ? await revokePrepAccess(prepId, personId) : await grantPrepAccess(prepId, personId);
      setBusy(null);
      // The screen moves only on success, so it can never contradict the
      // database — the same rule as everywhere else in this app.
      if (result.status === "error") { setError(result.message); return; }
      router.refresh();
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
      const result = mode === "grant" ? await grantAllPreps(person.id) : await revokeAllPreps(person.id);
      setBusy(null);
      if (result.status === "error") { setError(result.message); return; }
      router.refresh();
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
        {shownRecipes.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-400">ไม่พบสูตร</p>}
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
                  {r.category && <span className="ml-2 text-xs text-neutral-400">{r.category}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${n === 0 ? "bg-neutral-100 text-neutral-500" : "bg-green-100 text-green-700"}`}>
                  {n === 0 ? "ยังไม่เปิดให้ใคร" : `${n} คนเห็น`}
                </span>
              </button>
              {open && (
                <div className="space-y-1 border-t border-neutral-100 bg-neutral-50/60 px-4 py-3">
                  {people.length === 0 && <p className="text-sm text-neutral-400">ไม่มีผู้ใช้ที่เปิดสิทธิ์ได้</p>}
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
                              ? "border-green-300 bg-green-50 text-green-800 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                              : "border-neutral-300 bg-white text-neutral-600 hover:border-green-400 hover:bg-green-50 hover:text-green-800"
                          }`}
                        >
                          {busy === k ? "กำลังบันทึก…" : g ? "✓ เห็นสูตรนี้" : "เปิดให้เห็น"}
                        </button>
                        <span className="text-sm text-neutral-700">{p.fullName}</span>
                        <span className="text-xs text-neutral-400">{ROLE_LABEL[p.role] ?? p.role}</span>
                        {g && (
                          <span className="text-xs text-neutral-400">
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
  const nameById = new Map(recipes.map((r) => [r.id, r.name]));
  const byPerson = (
    <div className="space-y-2">
      {people.map((p) => {
        const held = countByPerson.get(p.id) ?? 0;
        const mine = grants.filter((g) => g.profileId === p.id);
        const open = openPerson === p.id;
        const allKey = `all:${p.id}`;
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
                <span className={`text-xs text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                <span className="min-w-0 truncate text-sm font-medium text-neutral-800">{p.fullName}</span>
                <span className="shrink-0 text-xs text-neutral-400">{ROLE_LABEL[p.role] ?? p.role}</span>
                <span className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${held === 0 ? "bg-neutral-100 text-neutral-500" : "bg-green-100 text-green-700"}`}>
                  {held} / {recipes.length} สูตร
                </span>
              </button>
              {held < recipes.length && (
                <button
                  type="button"
                  disabled={isPending && busy === allKey}
                  onClick={() => bulk(p, "grant", held)}
                  className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:border-green-400 hover:bg-green-50 hover:text-green-800 disabled:opacity-40"
                >
                  {busy === allKey ? "กำลังบันทึก…" : `เปิดทั้งหมด (${recipes.length})`}
                </button>
              )}
              {held > 0 && (
                <button
                  type="button"
                  disabled={isPending && busy === allKey}
                  onClick={() => bulk(p, "revoke", held)}
                  className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                >
                  {busy === allKey ? "กำลังบันทึก…" : "ปิดทั้งหมด"}
                </button>
              )}
            </div>
            {open && (
              mine.length === 0 ? (
                <p className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-400">ยังไม่เห็นสูตรของเตรียมใดเลย</p>
              ) : (
                <ul className="border-t border-neutral-100">
                  {mine.map((g) => {
                    const k = key(g.prepRecipeId, p.id);
                    return (
                      <li key={g.prepRecipeId} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-50 px-4 py-2 last:border-0">
                        <span className="min-w-0 flex-1 text-sm text-neutral-700">
                          {nameById.get(g.prepRecipeId) ?? g.prepRecipeId}
                          <span className="ml-2 text-xs text-neutral-400">
                            เปิดเมื่อ {fmtDate(g.grantedAt)}{g.grantedByName ? ` โดย ${g.grantedByName}` : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={isPending && busy === k}
                          onClick={() => toggle(g.prepRecipeId, p.id, true)}
                          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        >
                          {busy === k ? "กำลังบันทึก…" : "ปิดสิทธิ์"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-lg bg-neutral-100 px-3 py-1.5 text-neutral-700">สูตรทั้งหมด {recipes.length}</span>
        <span className={`rounded-lg px-3 py-1.5 ${unheld === recipes.length ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-700"}`}>
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
