"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import {
  addCoaGroup,
  addCoaAccount,
  updateCoaAccount,
  deleteCoaAccount,
  reorderCoaAccount,
  type CoaAccount,
} from "../actions";
import { buttonClass } from "@/components/ui/button";

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
        const result = await updateCoaAccount(editing.code, {
          name: editing.name.trim(),
          target_pct: editing.target_pct ? parseFloat(editing.target_pct) : null,
        });
        if (result.status === "error") { setError(result.message); return; }
        setEditing(null);
        flash("แก้ไขสำเร็จ");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ");
      }
    });
  }

  // ── Reorder account ─────────────────────────────────
  function handleReorder(code: string, groupCode: string, direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await reorderCoaAccount(code, groupCode, direction);
        if (result.error) { setError(result.error); return; }
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "เรียงลำดับไม่สำเร็จ");
      }
    });
  }

  // ── Delete ──────────────────────────────────────────
  function handleDelete(code: string, name: string) {
    if (!confirm(`ลบ "${name}" ใช่ไหม?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteCoaAccount(code);
        if (result.status === "error") { setError(result.message); return; }
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
        const result = await addCoaAccount({
          code: addingAccount.code.trim(),
          name: addingAccount.name.trim(),
          group_code: addingAccount.groupCode,
          group_name: addingAccount.groupName,
        });
        if (result.status === "error") { setError(result.message); return; }
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
        const result = await addCoaGroup({
          code: newGroup.code.trim(),
          name: newGroup.name.trim(),
          target_pct: newGroup.target_pct ? parseFloat(newGroup.target_pct) : null,
        });
        if (result.status === "error") { setError(result.message); return; }
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
        <div className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-danger">✕</button>
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-2 text-sm text-success-ink">
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
                      className={buttonClass("primary", { size: "sm" })}>
                      บันทึก
                    </button>
                    <button onClick={() => setEditing(null)}
                      className={buttonClass("secondary", { size: "sm" })}>
                      ยกเลิก
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-mono text-neutral-500 w-12">{g.code}</span>
                    <span className="flex-1 text-sm font-semibold text-neutral-800">{g.name}</span>
                    {g.target_pct != null && (
                      <span className="text-xs text-neutral-500">เป้า {g.target_pct}%</span>
                    )}
                    <button
                      onClick={() => setEditing({ code: g.code, name: g.name, target_pct: String(g.target_pct ?? "") })}
                      className={buttonClass("link", { size: "sm" })}
                    >
                      แก้ไข
                    </button>
                  </>
                )}
              </div>

              {/* Child accounts */}
              <div>
                {children.map((c, idx) => {
                  const isEditingThis = editing?.code === c.code;
                  return (
                    <div key={c.code} className="group flex items-center gap-3 border-b border-neutral-50 px-4 py-2 last:border-0 hover:bg-neutral-50/50">
                      <span className="w-12 font-mono text-xs text-neutral-500">{c.code}</span>
                      {isEditingThis ? (
                        <>
                          <input
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm focus:outline-none"
                            autoFocus
                          />
                          <button onClick={handleUpdate} disabled={isPending}
                            className={buttonClass("primary", { size: "sm" })}>
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)}
                            className={buttonClass("secondary", { size: "sm" })}>
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-neutral-700">{c.name}</span>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => handleReorder(c.code, g.code, "up")}
                              disabled={isPending || idx === 0}
                              className="rounded px-1 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20"
                              title="เลื่อนขึ้น"
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => handleReorder(c.code, g.code, "down")}
                              disabled={isPending || idx === children.length - 1}
                              className="rounded px-1 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20"
                              title="เลื่อนลง"
                            >
                              ▼
                            </button>
                            <span className="mx-1 text-neutral-200">|</span>
                            <button
                              onClick={() => setEditing({ code: c.code, name: c.name, target_pct: "" })}
                              className={buttonClass("link", { size: "sm" })}
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => handleDelete(c.code, c.name)}
                              disabled={isPending}
                              className={buttonClass("link", { size: "sm", dangerHover: true })}
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
                  <div className="flex items-center gap-2 border-t border-blue-100 bg-info-soft/30 px-4 py-2">
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
                      className={buttonClass("primary", { size: "sm" })}>
                      เพิ่ม
                    </button>
                    <button onClick={() => { setAddingAccount(null); setError(null); }}
                      className={buttonClass("secondary", { size: "sm" })}>
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingAccount({ groupCode: g.code, groupName: g.name, code: "", name: "" })}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-success-ink hover:bg-success-soft/50"
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
        <div className="rounded-xl border border-info/30 bg-info-soft/30 p-4 space-y-3">
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
              className={buttonClass("primary")}>
              {isPending ? "กำลังเพิ่ม..." : "เพิ่มกลุ่ม"}
            </button>
            <button onClick={() => { setAddingGroup(false); setError(null); }}
              className={buttonClass("secondary")}>
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingGroup(true)}
          className={buttonClass("secondary", { className: "w-full" })}
        >
          + เพิ่มกลุ่มใหม่
        </button>
      )}
    </div>
  );
}
