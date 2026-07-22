"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { upsertSupplier, reorderSupplier, deleteSupplier, type Supplier } from "../actions";

type DraftRow = Omit<Supplier, "id"> & { id?: string };

const BLANK: DraftRow = {
  name: "",
  bank: "",
  account_number: "",
  description: "",
  credit: true,
  payment_mode: "transfer",
  internal_account: "",
  sort_order: 9999,
  is_active: true,
};

const BANKS = ["K-Bank", "SCB", "กรุงไทย", "Bangkok", "ออมสิน", "ทหารไทย", "LH", "อื่นๆ"];

// Zebra colors per category type
const ROW_BG: Record<string, { even: string; odd: string }> = {
  "c-transfer": { even: "bg-blue-50",   odd: "bg-white" },
  "c-cash":     { even: "bg-purple-50", odd: "bg-white" },
  "i-transfer": { even: "bg-orange-50", odd: "bg-white" },
};

function rowTypeKey(s: Supplier) {
  return s.credit ? `c-${s.payment_mode}` : "i-transfer";
}

function pill(credit: boolean, mode: string) {
  if (!credit) return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">โอนทันที</span>;
  if (mode === "cash") return <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">เครดิต/สด</span>;
  return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">เครดิต/โอน</span>;
}

// Confirm dialog state
type ConfirmState = { id: string; name: string } | null;

export function SuppliersClient({ initialSuppliers }: { initialSuppliers: Supplier[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<DraftRow>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmState>(null);

  const visible = showInactive ? suppliers : suppliers.filter((s) => s.is_active);

  // count within each type group for alternating rows
  const typeCounter: Record<string, number> = {};
  function nextRowBg(s: Supplier) {
    const key = rowTypeKey(s);
    typeCounter[key] = (typeCounter[key] ?? 0) + 1;
    const idx = typeCounter[key]!;
    const colors = ROW_BG[key] ?? { even: "bg-neutral-50", odd: "bg-white" };
    return idx % 2 === 0 ? colors.even : colors.odd;
  }

  // ── Draft helpers ────────────────────────────────────────────────

  function openEdit(s: Supplier) {
    setDraft({ ...s });
    setEditId(s.id);
    setError(null);
  }

  function openNew() {
    const maxOrder = suppliers.reduce((m, s) => Math.max(m, s.sort_order), 0);
    setDraft({ ...BLANK, sort_order: maxOrder + 10 });
    setEditId("new");
    setError(null);
  }

  function set<K extends keyof DraftRow>(k: K, v: DraftRow[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function cancelEdit() { setEditId(null); setError(null); }

  // ── Save ─────────────────────────────────────────────────────────

  function handleSave() {
    if (!draft.name.trim()) { setError("กรุณาใส่ชื่อซัพ"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await upsertSupplier({
          id: editId !== "new" ? editId ?? undefined : undefined,
          name: draft.name.trim(),
          bank: draft.bank?.trim() || null,
          account_number: draft.account_number?.trim() || null,
          description: draft.description?.trim() || null,
          credit: draft.credit,
          payment_mode: draft.payment_mode,
          internal_account: draft.internal_account?.trim() || null,
          sort_order: Number(draft.sort_order) || 0,
          is_active: draft.is_active,
        });
        setEditId(null);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  // ── Reorder ──────────────────────────────────────────────────────

  function handleReorder(id: string, dir: "up" | "down") {
    const activeIds = visible.map((s) => s.id);
    startTransition(async () => {
      try {
        await reorderSupplier(id, dir, activeIds);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
      }
    });
  }

  // ── Toggle active ────────────────────────────────────────────────

  function handleToggleActive(s: Supplier) {
    startTransition(async () => {
      try {
        await upsertSupplier({ ...s, is_active: !s.is_active });
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
      }
    });
  }

  // ── Delete ───────────────────────────────────────────────────────

  function handleDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    startTransition(async () => {
      try {
        await deleteSupplier(id);
        setSuppliers((prev) => prev.filter((s) => s.id !== id));
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  // ── Edit form row ─────────────────────────────────────────────────

  function EditForm({ isNew }: { isNew?: boolean }) {
    return (
      <tr className={`border-t-2 ${isNew ? "border-green-300 bg-green-50/60" : "border-amber-300 bg-amber-50/60"}`}>
        <td className="px-2 py-2 w-8" />
        <td className="px-2 py-2 w-14">
          <input type="number" value={draft.sort_order}
            onChange={(e) => set("sort_order", Number(e.target.value))}
            className="w-14 rounded border border-neutral-300 px-1.5 py-1 text-xs text-right focus:border-blue-400 focus:outline-none" />
        </td>
        <td className="px-1.5 py-2">
          <input type="text" autoFocus placeholder="ชื่อซัพ *" value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
        </td>
        <td className="px-1.5 py-2">
          <input type="text" placeholder="รายละเอียด/ชื่อเล่น" value={draft.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
        </td>
        <td className="px-1.5 py-2 w-28">
          <select value={draft.bank ?? ""} onChange={(e) => set("bank", e.target.value || null)}
            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-sm focus:border-blue-400 focus:outline-none bg-white">
            <option value="">—</option>
            {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </td>
        <td className="px-1.5 py-2 w-36">
          <input type="text" placeholder="เลขบัญชี" value={draft.account_number ?? ""}
            onChange={(e) => set("account_number", e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm tabular-nums focus:border-blue-400 focus:outline-none" />
        </td>
        <td className="px-1.5 py-2 w-36">
          <select value={`${draft.credit ? "c" : "i"}-${draft.payment_mode}`}
            onChange={(e) => {
              const [c, m] = e.target.value.split("-") as ["c" | "i", "transfer" | "cash"];
              set("credit", c === "c");
              set("payment_mode", m);
            }}
            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-sm focus:border-blue-400 focus:outline-none bg-white">
            <option value="c-transfer">เครดิต / โอน</option>
            <option value="c-cash">เครดิต / สด</option>
            <option value="i-transfer">โอนทันที</option>
          </select>
        </td>
        <td className="px-1.5 py-2 w-40">
          {!draft.credit ? (
            <input type="text" placeholder="K-Bank_Sompong / SCB_Sompong" value={draft.internal_account ?? ""}
              onChange={(e) => set("internal_account", e.target.value)}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none" />
          ) : (
            <span className="text-xs text-neutral-300">—</span>
          )}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          <div className="flex gap-1.5">
            <button onClick={handleSave} disabled={isPending}
              className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50">
              {isPending ? "..." : "บันทึก"}
            </button>
            <button onClick={cancelEdit}
              className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
              ยกเลิก
            </button>
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </td>
      </tr>
    );
  }

  // ── Render ───────────────────────────────────────────────────────

  // Reset counter before render
  Object.keys(typeCounter).forEach((k) => delete typeCounter[k]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-500 cursor-pointer select-none">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded" />
          แสดงที่ปิดใช้งาน
        </label>
        <button onClick={openNew} disabled={editId !== null}
          className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-40">
          + เพิ่มซัพใหม่
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">{pill(true, "transfer")} เครดิต โอน</span>
        <span className="flex items-center gap-1.5">{pill(true, "cash")} เครดิต จ่ายสด</span>
        <span className="flex items-center gap-1.5">{pill(false, "transfer")} โอนทันที (บัญชีร้าน)</span>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-800 text-xs text-neutral-100">
                <th className="px-2 py-2.5 w-8" />
                <th className="px-2 py-2.5 text-left w-14">ลำดับ</th>
                <th className="px-3 py-2.5 text-left">ชื่อซัพ</th>
                <th className="px-3 py-2.5 text-left">รายละเอียด</th>
                <th className="px-3 py-2.5 text-left w-28">ธนาคาร</th>
                <th className="px-3 py-2.5 text-left w-36">เลขบัญชี</th>
                <th className="px-3 py-2.5 text-left w-36">ประเภท</th>
                <th className="px-3 py-2.5 text-left w-40">บัญชีร้าน</th>
                <th className="px-2 py-2.5 w-36" />
              </tr>
            </thead>
            <tbody>
              {editId === "new" && <EditForm isNew />}

              {visible.map((s, i) => {
                const isFirst = i === 0;
                const isLast = i === visible.length - 1;
                const bg = nextRowBg(s);

                if (editId === s.id) {
                  return <EditForm key={s.id} />;
                }

                return (
                  <tr key={s.id}
                    className={`border-t border-neutral-200 transition-colors ${!s.is_active ? "opacity-35" : ""} ${bg} hover:brightness-95`}>
                    {/* Reorder */}
                    <td className="px-1 py-2">
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => handleReorder(s.id, "up")} disabled={isPending || isFirst}
                          className="h-4 w-5 text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs leading-none">▲</button>
                        <button onClick={() => handleReorder(s.id, "down")} disabled={isPending || isLast}
                          className="h-4 w-5 text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs leading-none">▼</button>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-neutral-400 tabular-nums">{s.sort_order}</td>
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{s.name}</td>
                    <td className="px-3 py-2.5 text-neutral-500 text-xs">{s.description ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-neutral-600">{s.bank ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-neutral-600 tabular-nums">{s.account_number ?? "—"}</td>
                    <td className="px-3 py-2.5">{pill(s.credit, s.payment_mode)}</td>
                    <td className="px-3 py-2.5 text-xs text-blue-600">{s.internal_account ?? "—"}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-right">
                      <button onClick={() => openEdit(s)} disabled={editId !== null}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:border-amber-400 hover:text-amber-700 disabled:opacity-30">
                        แก้ไข
                      </button>
                      <button onClick={() => handleToggleActive(s)} disabled={isPending || editId !== null}
                        className={`ml-1 rounded border px-2.5 py-1 text-xs disabled:opacity-30 ${
                          s.is_active
                            ? "border-neutral-300 text-neutral-400 hover:border-red-300 hover:text-red-500"
                            : "border-green-400 text-green-700 hover:bg-green-50"
                        }`}>
                        {s.is_active ? "ปิด" : "เปิด"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete({ id: s.id, name: s.name })}
                        disabled={isPending || editId !== null}
                        className="ml-1 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-100 disabled:opacity-30">
                        ลบ
                      </button>
                    </td>
                  </tr>
                );
              })}

              {visible.length === 0 && editId === null && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-neutral-400">
                    ยังไม่มีซัพพลายเออร์
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-neutral-400">
        {suppliers.filter((s) => s.is_active).length} รายการที่ใช้งาน · {suppliers.filter((s) => !s.is_active).length} ปิดใช้งาน
      </p>

      {/* ── Confirm Delete Dialog ─────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelete(null)} />
          {/* Dialog */}
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl mx-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-red-500 text-xl">⚠️</span>
              <h2 className="text-base font-semibold text-neutral-900">ยืนยันการลบ</h2>
            </div>
            <p className="mt-2 text-sm text-neutral-600">
              ต้องการลบ <strong className="text-neutral-900">"{confirmDelete.name}"</strong> ออกจากระบบถาวร?
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              รายการบันทึกรายวันที่เชื่อมกับซัพนี้จะยังอยู่ แต่ชื่อซัพจะหายไป
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50">
                ยกเลิก
              </button>
              <button onClick={handleDelete} disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {isPending ? "กำลังลบ..." : "ลบถาวร"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
