"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import {
  addCoaGroup,
  addCoaAccount,
  updateCoaAccount,
  deleteCoaAccount,
  type CoaAccount,
} from "../actions";

type EditState = { code: string; name: string; target_pct: string };
type AddAccountState = { groupCode: string; groupName: string; code: string; name: string };

export function CoaManagerClient({ coa }: { coa: CoaAccount[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [addingAccount, setAddingAccount] = useState<AddAccountState | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ code: "", name: "", target_pct: "" });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const groups = coa.filter((c) => c.group_code === null);
  const leaves = coa.filter((c) => c.group_code !== null);

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  }

  // ── Edit account ────────────────────────────────────
  function handleUpdate() {
    if (!editing) return;
    startTransition(async () => {
      try {
        await updateCoaAccount(editing.code, {
          name: editing.name.trim(),
          target_pct: editing.target_pct ? parseFloat(editing.target_pct) : null,
        });
        setEditing(null);
        flash("แก้ไขสำเร็จ");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ");
      }
    });
  }

  // ── Delete ──────────────────────────────────────────
  function handleDelete(code: string, name: string) {
    if (!confirm(`ลบ "${name}" ใช่ไหม?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteCoaAccount(code);
        flash("ลบสำเร็จ");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  // ── Add account ─────────────────────────────────────
  function handleAddAccount() {
    if (!addingAccount) return;
    if (!addingAccount.code.trim() || !addingAccount.name.trim()) {
      setError("กรุณากรอกรหัสและชื่อหมวด");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addCoaAccount({
          code: addingAccount.code.trim(),
          name: addingAccount.name.trim(),
          group_code: addingAccount.groupCode,
          group_name: addingAccount.groupName,
        });
        setAddingAccount(null);
        flash("เพิ่มหมวดย่อยสำเร็จ");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ");
      }
    });
  }

  // ── Add group ───────────────────────────────────────
  function handleAddGroup() {
    if (!newGroup.code.trim() || !newGroup.name.trim()) {
      setError("กรุณากรอกรหัสและชื่อกลุ่ม");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addCoaGroup({
          code: newGroup.code.trim(),
          name: newGroup.name.trim(),
          target_pct: newGroup.target_pct ? parseFloat(newGroup.target_pct) : null,
        });
        setNewGroup({ code: "", name: "", target_pct: "" });
        setAddingGroup(false);
        flash("เพิ่มกลุ่มสำเร็จ");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "เพิ่มกลุ่มไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {msg}
        </div>
      )}

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((g) => {
          const children = leaves.filter((c) => c.group_code === g.code);
          const isEditingGroup = editing?.code === g.code;

          return (
            <div key={g.code} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              {/* Group header */}
              <div className="flex items-center gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
                {isEditingGroup ? (
                  <>
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm font-medium focus:outline-none"
                    />
                    <div className="flex items-center gap-1 text-xs text-neutral-500">
                      <span>เป้า</span>
                      <input
                        type="number"
                        value={editing.target_pct}
                        onChange={(e) => setEditing({ ...editing, target_pct: e.target.value })}
                        placeholder="0"
                        className="w-16 rounded border border-neutral-300 px-2 py-1 text-right focus:outline-none"
                      />
                      <span>%</span>
                    </div>
                    <button onClick={handleUpdate} disabled={isPending}
                      className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                      บันทึก
                    </button>
                    <button onClick={() => setEditing(null)}
                      className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200">
                      ยกเลิก
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-mono text-neutral-400 w-12">{g.code}</span>
                    <span className="flex-1 text-sm font-semibold text-neutral-800">{g.name}</span>
                    {g.target_pct != null && (
                      <span className="text-xs text-neutral-400">เป้า {g.target_pct}%</span>
                    )}
                    <button
                      onClick={() => setEditing({ code: g.code, name: g.name, target_pct: String(g.target_pct ?? "") })}
                      className="text-xs text-neutral-400 hover:text-neutral-700"
                    >
                      แก้ไข
                    </button>
                  </>
                )}
              </div>

              {/* Child accounts */}
              <div>
                {children.map((c) => {
                  const isEditingThis = editing?.code === c.code;
                  return (
                    <div key={c.code} className="group flex items-center gap-3 border-b border-neutral-50 px-4 py-2 last:border-0 hover:bg-neutral-50/50">
                      <span className="w-12 font-mono text-xs text-neutral-400">{c.code}</span>
                      {isEditingThis ? (
                        <>
                          <input
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm focus:outline-none"
                            autoFocus
                          />
                          <button onClick={handleUpdate} disabled={isPending}
                            className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)}
                            className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200">
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-neutral-700">{c.name}</span>
                          <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => setEditing({ code: c.code, name: c.name, target_pct: "" })}
                              className="text-xs text-neutral-400 hover:text-neutral-700"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => handleDelete(c.code, c.name)}
                              disabled={isPending}
                              className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-30"
                            >
                              ลบ
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Add account row */}
                {addingAccount?.groupCode === g.code ? (
                  <div className="flex items-center gap-2 border-t border-blue-100 bg-blue-50/30 px-4 py-2">
                    <input
                      type="text"
                      placeholder="รหัส (เช่น 126)"
                      value={addingAccount.code}
                      onChange={(e) => setAddingAccount({ ...addingAccount, code: e.target.value })}
                      className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm font-mono focus:outline-none"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="ชื่อหมวด"
                      value={addingAccount.name}
                      onChange={(e) => setAddingAccount({ ...addingAccount, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && handleAddAccount()}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm focus:outline-none"
                    />
                    <button onClick={handleAddAccount} disabled={isPending}
                      className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50">
                      เพิ่ม
                    </button>
                    <button onClick={() => { setAddingAccount(null); setError(null); }}
                      className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200">
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingAccount({ groupCode: g.code, groupName: g.name, code: "", name: "" })}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-green-700 hover:bg-green-50/50"
                  >
                    + เพิ่มหมวดย่อย
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add new group */}
      {addingGroup ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 space-y-3">
          <p className="text-sm font-medium text-neutral-700">เพิ่มกลุ่มใหม่</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="รหัสกลุ่ม (เช่น G1000)"
              value={newGroup.code}
              onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value })}
              className="w-36 rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:outline-none"
              autoFocus
            />
            <input
              type="text"
              placeholder="ชื่อกลุ่ม"
              value={newGroup.name}
              onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              className="flex-1 min-w-48 rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                placeholder="เป้า %"
                value={newGroup.target_pct}
                onChange={(e) => setNewGroup({ ...newGroup, target_pct: e.target.value })}
                className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-sm text-right focus:outline-none"
              />
              <span className="text-sm text-neutral-500">%</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddGroup} disabled={isPending}
              className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
              {isPending ? "กำลังเพิ่ม..." : "เพิ่มกลุ่ม"}
            </button>
            <button onClick={() => { setAddingGroup(false); setError(null); }}
              className="rounded-lg border border-neutral-200 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingGroup(true)}
          className="w-full rounded-xl border border-dashed border-neutral-300 py-3 text-sm text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"
        >
          + เพิ่มกลุ่มใหม่
        </button>
      )}
    </div>
  );
}
