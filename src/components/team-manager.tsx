"use client";

import { useState, useTransition } from "react";
import { createUser, deleteUser, updateUserDetails, updateUserRole, changePassword } from "@/app/owner/team/actions";
import type { Role } from "@/lib/auth";
import { assignableRoles, teamRefusal } from "@/lib/team-rules";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";

export type TeamUser = {
  id: string;
  full_name: string;
  role: Role;
  username: string;
  employee_id: string | null;
  holds_prep_grants: boolean;
};

export type EmployeeOption = { id: string; label: string };

const ALL_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "owner",  label: "Owner (เจ้าของร้าน)" },
  { value: "admin",  label: "Admin (เข้าถึงทุกอย่าง)" },
  { value: "hr",     label: "HR (ฝ่ายบุคคล)" },
  { value: "sales",  label: "Sales (รับจองงานจัดเลี้ยง)" },
  { value: "editor", label: "Editor (แก้ได้ รอ Admin อนุมัติ)" },
  { value: "staff",  label: "Staff (ดูได้เท่านั้น)" },
];

const ROLE_LABEL: Record<Role, string> = {
  owner:  "เจ้าของ",
  admin:  "Admin",
  hr:     "HR",
  sales:  "Sales",
  editor: "Editor",
  staff:  "Staff",
};

export function TeamManager({
  users,
  currentUserId,
  currentUserRole,
  employeeOptions,
}: {
  users: TeamUser[];
  currentUserId: string;
  currentUserRole: Role;
  employeeOptions: EmployeeOption[];
}) {
  // What this screen offers comes from the same rule the server actions
  // enforce (@/lib/team-rules), so the two cannot disagree (item 29).
  const me = { id: currentUserId, role: currentUserRole };
  const assignable = assignableRoles(currentUserRole);
  const roleOptions = ALL_ROLE_OPTIONS.filter((o) => assignable.includes(o.value));

  // ── List state ──────────────────────────────────────────────────────────────
  const [list, setList] = useState(users);
  const [isPending, startTransition] = useTransition();

  // ── Create form ─────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("staff");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Employees already linked to some account — excluded from the pickers so an
  // admin cannot pick one that would fail the profiles_employee_id_unique
  // constraint. The row being edited keeps its own selection available.
  const linkedEmployeeIds = new Map(
    users.filter((u) => u.employee_id).map((u) => [u.employee_id as string, u.id]),
  );
  function availableEmployees(forUserId?: string): EmployeeOption[] {
    return employeeOptions.filter((e) => {
      const owner = linkedEmployeeIds.get(e.id);
      return !owner || owner === forUserId;
    });
  }
  const employeeLabelById = new Map(employeeOptions.map((e) => [e.id, e.label]));

  // ── Inline role change ───────────────────────────────────────────────────────
  const [selectedRole, setSelectedRole] = useState<Record<string, Role>>(
    Object.fromEntries(users.map((u) => [u.id, u.role]))
  );
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // ── Edit details (name / username) ──────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");

  // ── Change password (who may: teamRefusal in @/lib/team-rules) ──────────────
  const [pwdRowId, setPwdRowId] = useState<string | null>(null);
  const [pwdValue, setPwdValue] = useState("");

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function clearRowErr(id: string) {
    setRowError((prev) => ({ ...prev, [id]: "" }));
  }

  // ── Item 20: a thrown action reaches the row that asked for it ─────────
  //
  // Errors on this screen are per-row (rowError[id]) or per-form
  // (createError), so the runner takes the setter rather than assuming one
  // place to put the message. Without it a throw said nothing anywhere, on
  // the screen that creates logins, changes roles and passwords, and deletes
  // accounts — where "I thought I changed that" is an access question.
  const RETRY_MESSAGE = "ไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

  function runWrite<T extends { error?: string }>(
    fn: () => Promise<T>,
    showError: (message: string) => void,
    opts?: { onOk?: (result: T) => void; revert?: () => void },
  ) {
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.error) { showError(result.error); opts?.revert?.(); return; }
        opts?.onOk?.(result);
      } catch {
        showError(RETRY_MESSAGE);
        opts?.revert?.();
      }
    });
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function submitCreate() {
    setCreateError(null);
    runWrite(
      () => createUser(newFullName, newUsername, newPassword, newRole, newEmployeeId || null),
      (m) => setCreateError(m),
      {
        onOk: () => {
          setNewFullName(""); setNewUsername(""); setNewPassword(""); setNewRole("staff"); setNewEmployeeId("");
          setShowForm(false);
          window.location.reload();
        },
      },
    );
  }

  function applyRole(id: string) {
    const role = selectedRole[id];
    clearRowErr(id);
    // THE ONE SITE ON THIS SCREEN THAT LIES ON A THROW. The dropdown is bound
    // to selectedRole, which the change handler already moved, so a failed
    // write leaves it showing a role the account does not have. The returned
    // error path already put it back; the throw path did not, and now does —
    // the revert runs on both.
    runWrite(
      () => updateUserRole(id, role),
      (m) => setRowError((prev) => ({ ...prev, [id]: m })),
      {
        revert: () => setSelectedRole((prev) => ({ ...prev, [id]: list.find((u) => u.id === id)?.role ?? prev[id] })),
        onOk: () => setList((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u))),
      },
    );
  }

  function startEdit(u: TeamUser) {
    setEditingId(u.id);
    setEditFullName(u.full_name);
    setEditUsername(u.username);
    setEditEmployeeId(u.employee_id ?? "");
    clearRowErr(u.id);
    setPwdRowId(null);
  }

  function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    const employeeId = editEmployeeId || null;
    runWrite(
      () => updateUserDetails(id, { fullName: editFullName, username: editUsername, employeeId }),
      (m) => setRowError((prev) => ({ ...prev, [id]: m })),
      {
        onOk: () => {
          setList((prev) => prev.map((u) => (u.id === id ? { ...u, full_name: editFullName, username: editUsername, employee_id: employeeId } : u)));
          setEditingId(null);
        },
      },
    );
  }

  function submitPassword(id: string) {
    clearRowErr(id);
    // The password field is NOT cleared on failure: it is the one field the
    // person cannot retype from memory if it was generated, and a thrown
    // failure is exactly when they will retry.
    runWrite(
      () => changePassword(id, pwdValue),
      (m) => setRowError((prev) => ({ ...prev, [id]: m })),
      { onOk: () => { setPwdRowId(null); setPwdValue(""); } },
    );
  }

  function remove(id: string) {
    if (!confirm("ลบบัญชีนี้แน่ใจหรือไม่? จะไม่สามารถ login ได้อีก")) return;
    clearRowErr(id);
    runWrite(
      () => deleteUser(id),
      (m) => setRowError((prev) => ({ ...prev, [id]: m })),
      { onOk: () => setList((prev) => prev.filter((u) => u.id !== id)) },
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <button
        type="button"
        className={buttonClass("primary")}
        onClick={() => setShowForm((v) => !v)}
      >
        {showForm ? "ยกเลิก" : "+ เพิ่มบัญชีใหม่"}
      </button>

      {createError && <p className="text-sm text-danger">{createError}</p>}

      {showForm && (
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
          <input
            placeholder="ชื่อเล่น/ชื่อพนักงาน"
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="User — ชื่อสำหรับ login (ภาษาอังกฤษ/ตัวเลข)"
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
          <select
            value={newEmployeeId}
            onChange={(e) => setNewEmployeeId(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">พนักงาน (HR) — ไม่ผูก</option>
            {availableEmployees().map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending}
            onClick={submitCreate}
            className={buttonClass("primary", { className: "w-full" })}
          >
            สร้างบัญชี
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
              <th className="px-3 py-2">ชื่อ</th>
              <th className="px-3 py-2">User</th>
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
              // owner: every row; admin: staff/editor/sales and its own row.
              // sales sits at editor level: it reaches customers and bookings,
              // never salary. hr is protected: it sees every employee's pay.
              // An admin is also kept off any account holding prep grants.
              const account = { id: u.id, role: u.role, holdsPrepGrants: u.holds_prep_grants };
              const canActOnRow = teamRefusal(me, account, { kind: "edit" }) === null;
              const canChangePwd = teamRefusal(me, account, { kind: "password" }) === null;
              // never oneself; owner: anyone else; admin: staff/editor/sales without prep grants
              const canDelete = teamRefusal(me, account, { kind: "delete" }) === null;

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
                      {/* Role is not editable inline here (that has its own
                          save button in normal mode), so this cell carries the
                          employee link picker while editing. */}
                      <td className="px-3 py-2">
                        <select
                          value={editEmployeeId}
                          onChange={(e) => setEditEmployeeId(e.target.value)}
                          className="rounded border border-neutral-300 px-2 py-1 text-sm"
                        >
                          <option value="">พนักงาน (HR) — ไม่ผูก</option>
                          {availableEmployees(u.id).map((e) => (
                            <option key={e.id} value={e.id}>{e.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={saveEdit}
                            className={buttonClass("primary", { size: "sm" })}
                          >
                            บันทึก
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className={buttonClass("secondary", { size: "sm" })}
                          >
                            ยกเลิก
                          </button>
                        </div>
                        {rowError[u.id] && (
                          <p className="mt-1 text-right text-xs text-danger">{rowError[u.id]}</p>
                        )}
                      </td>
                    </>
                  ) : (
                    /* ── Normal mode ── */
                    <>
                      <td className="px-3 py-2">
                        {u.full_name}
                        {u.employee_id && (
                          <div className="text-xs text-neutral-500">
                            HR: {employeeLabelById.get(u.employee_id) ?? "ไม่พบพนักงาน"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-500">{u.username}</td>

                      {/* Role cell */}
                      <td className="px-3 py-2">
                        {u.role === "owner" ? (
                          <span className="inline-flex items-center rounded-full bg-brand-gold/15 px-2.5 py-0.5 text-xs font-semibold text-pending-ink">
                            {ROLE_LABEL.owner}
                          </span>
                        ) : canActOnRow ? (
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
                                className={buttonClass("primary", { size: "sm" })}
                              >
                                บันทึก
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-neutral-500">{ROLE_LABEL[u.role]}</span>
                        )}
                      </td>

                      {/* Action cell */}
                      <td className="px-3 py-2 text-right">
                        {canActOnRow && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              className={buttonClass("link")}
                              onClick={() => startEdit(u)}
                            >
                              แก้ไข
                            </button>

                            {canChangePwd && (
                              <button
                                type="button"
                                className={buttonClass("link")}
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
                                className={buttonClass("link", { dangerHover: true })}
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
                              className={buttonClass("primary", { size: "sm" })}
                            >
                              ยืนยัน
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPwdRowId(null); setPwdValue(""); }}
                              className={buttonClass("secondary", { size: "sm" })}
                            >
                              ยกเลิก
                            </button>
                          </div>
                        )}

                        {rowError[u.id] && (
                          <p className="mt-1 text-right text-xs text-danger">{rowError[u.id]}</p>
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
