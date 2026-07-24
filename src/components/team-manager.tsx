"use client";

import { useState, useTransition } from "react";
import { createUser, deleteUser, updateUserDetails, updateUserRole, changePassword } from "@/app/owner/team/actions";
import type { Role } from "@/lib/auth";

export type TeamUser = {
  id: string;
  full_name: string;
  role: Role;
  username: string;
};

const ALL_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "owner",  label: "Owner (เจ้าของร้าน)" },
  { value: "admin",  label: "Admin (เข้าถึงทุกอย่าง)" },
  { value: "hr",     label: "HR (ฝ่ายบุคคล + แจ้งซ่อม)" },
  { value: "editor", label: "Editor (แก้ได้ รอ Admin อนุมัติ)" },
  { value: "staff",  label: "Staff (ดูได้เท่านั้น)" },
];

const ROLE_LABEL: Record<Role, string> = {
  owner:  "เจ้าของ",
  admin:  "Admin",
  hr:     "HR",
  editor: "Editor",
  staff:  "Staff",
};

export function TeamManager({
  users,
  currentUserId,
  currentUserRole,
}: {
  users: TeamUser[];
  currentUserId: string;
  currentUserRole: Role;
}) {
  const isOwner = currentUserRole === "owner";

  // Role options visible to the current actor
  const roleOptions = isOwner
    ? ALL_ROLE_OPTIONS
    : ALL_ROLE_OPTIONS.filter((o) => o.value !== "owner");

  // ── List state ──────────────────────────────────────────────────────────────
  const [list, setList] = useState(users);
  const [isPending, startTransition] = useTransition();

  // ── Create form ─────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("staff");
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Inline role change ───────────────────────────────────────────────────────
  const [selectedRole, setSelectedRole] = useState<Record<string, Role>>(
    Object.fromEntries(users.map((u) => [u.id, u.role]))
  );
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // ── Edit details (name / username) ──────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");

  // ── Change password (owner-only) ─────────────────────────────────────────────
  const [pwdRowId, setPwdRowId] = useState<string | null>(null);
  const [pwdValue, setPwdValue] = useState("");

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function clearRowErr(id: string) {
    setRowError((prev) => ({ ...prev, [id]: "" }));
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function submitCreate() {
    setCreateError(null);
    startTransition(async () => {
      const result = await createUser(newFullName, newUsername, newPassword, newRole);
      if (result.error) { setCreateError(result.error); return; }
      setNewFullName(""); setNewUsername(""); setNewPassword(""); setNewRole("staff");
      setShowForm(false);
      window.location.reload();
    });
  }

  function applyRole(id: string) {
    const role = selectedRole[id];
    clearRowErr(id);
    startTransition(async () => {
      const result = await updateUserRole(id, role);
      if (result.error) {
        setRowError((prev) => ({ ...prev, [id]: result.error! }));
        setSelectedRole((prev) => ({ ...prev, [id]: list.find((u) => u.id === id)?.role ?? prev[id] }));
        return;
      }
      setList((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    });
  }

  function startEdit(u: TeamUser) {
    setEditingId(u.id);
    setEditFullName(u.full_name);
    setEditUsername(u.username);
    clearRowErr(u.id);
    setPwdRowId(null);
  }

  function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    startTransition(async () => {
      const result = await updateUserDetails(id, { fullName: editFullName, username: editUsername });
      if (result.error) { setRowError((prev) => ({ ...prev, [id]: result.error! })); return; }
      setList((prev) => prev.map((u) => (u.id === id ? { ...u, full_name: editFullName, username: editUsername } : u)));
      setEditingId(null);
    });
  }

  function submitPassword(id: string) {
    clearRowErr(id);
    startTransition(async () => {
      const result = await changePassword(id, pwdValue);
      if (result.error) { setRowError((prev) => ({ ...prev, [id]: result.error! })); return; }
      setPwdRowId(null);
      setPwdValue("");
    });
  }

  function remove(id: string) {
    if (!confirm("ลบบัญชีนี้แน่ใจหรือไม่? จะไม่สามารถ login ได้อีก")) return;
    clearRowErr(id);
    startTransition(async () => {
      const result = await deleteUser(id);
      if (result.error) { setRowError((prev) => ({ ...prev, [id]: result.error! })); return; }
      setList((prev) => prev.filter((u) => u.id !== id));
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <button
        type="button"
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        onClick={() => setShowForm((v) => !v)}
      >
        {showForm ? "ยกเลิก" : "+ เพิ่มบัญชีใหม่"}
      </button>

      {createError && <p className="text-sm text-red-600">{createError}</p>}

      {showForm && (
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
          <input
            placeholder="ชื่อเล่น/ชื่อพนักงาน"
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="ชื่อผู้ใช้สำหรับ login (ภาษาอังกฤษ/ตัวเลข)"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)"
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending}
            onClick={submitCreate}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            สร้างบัญชี
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <th className="px-3 py-2">ชื่อ</th>
              <th className="px-3 py-2">ชื่อผู้ใช้</th>
              <th className="px-3 py-2">สิทธิ์</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const pendingRole = selectedRole[u.id] ?? u.role;
              const isDirty = pendingRole !== u.role;
              const isEditing = editingId === u.id;
              const isChangingPwd = pwdRowId === u.id;
              const isSelf = u.id === currentUserId;
              const isAdmin = currentUserRole === "admin";
              const targetIsLower = u.role === "staff" || u.role === "editor";
              // owner sees action buttons on ALL rows; admin only on staff/editor + own row
              const canActOnRow = isOwner || targetIsLower || isSelf;
              // owner: everyone incl. self; admin: self + staff/editor only
              const canChangePwd = isOwner || (isAdmin && (isSelf || targetIsLower));
              // no self-delete; owner: anyone else (incl. other owners); admin: staff/editor only
              const canDelete = !isSelf && (isOwner || (isAdmin && targetIsLower));

              return (
                <tr key={u.id} className="border-b border-neutral-100 last:border-0 align-top">
                  {isEditing ? (
                    /* ── Edit mode ── */
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          className="w-32 rounded border border-neutral-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="w-44 rounded border border-neutral-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-neutral-400">-</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={saveEdit}
                            className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
                          >
                            บันทึก
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                          >
                            ยกเลิก
                          </button>
                        </div>
                        {rowError[u.id] && (
                          <p className="mt-1 text-right text-xs text-red-600">{rowError[u.id]}</p>
                        )}
                      </td>
                    </>
                  ) : (
                    /* ── Normal mode ── */
                    <>
                      <td className="px-3 py-2">{u.full_name}</td>
                      <td className="px-3 py-2 text-neutral-500">{u.username}</td>

                      {/* Role cell */}
                      <td className="px-3 py-2">
                        {u.role === "owner" ? (
                          <span className="inline-flex items-center rounded-full bg-brand-gold/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                            {ROLE_LABEL.owner}
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              value={pendingRole}
                              onChange={(e) =>
                                setSelectedRole((prev) => ({ ...prev, [u.id]: e.target.value as Role }))
                              }
                              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                            >
                              {roleOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {ROLE_LABEL[o.value]}
                                </option>
                              ))}
                            </select>
                            {isDirty && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => applyRole(u.id)}
                                className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
                              >
                                บันทึก
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Action cell */}
                      <td className="px-3 py-2 text-right">
                        {canActOnRow && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              className="text-neutral-500 hover:text-neutral-900"
                              onClick={() => startEdit(u)}
                            >
                              แก้ไข
                            </button>

                            {canChangePwd && (
                              <button
                                type="button"
                                className="text-blue-500 hover:text-blue-700"
                                onClick={() => {
                                  setPwdRowId((prev) => (prev === u.id ? null : u.id));
                                  setPwdValue("");
                                  clearRowErr(u.id);
                                }}
                              >
                                เปลี่ยนรหัสผ่าน
                              </button>
                            )}

                            {canDelete && (
                              <button
                                type="button"
                                className="text-red-500 hover:text-red-700"
                                onClick={() => remove(u.id)}
                              >
                                ลบบัญชี
                              </button>
                            )}
                          </div>
                        )}

                        {/* Inline password form */}
                        {isChangingPwd && (
                          <div className="mt-2 flex justify-end gap-2">
                            <input
                              type="text"
                              placeholder="รหัสผ่านใหม่"
                              value={pwdValue}
                              onChange={(e) => setPwdValue(e.target.value)}
                              className="w-36 rounded border border-neutral-300 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => submitPassword(u.id)}
                              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              ยืนยัน
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPwdRowId(null); setPwdValue(""); }}
                              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        )}

                        {rowError[u.id] && (
                          <p className="mt-1 text-right text-xs text-red-600">{rowError[u.id]}</p>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
