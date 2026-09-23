/** Run with: npm test — who may do what on /owner/team (queue item 29, 1–3). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignableRoles, createRefusal, isBanned, lastActiveRefusal, teamRefusal, type TeamAccount, type TeamAction } from "./team-rules.ts";

const account = (id: string, role: string, holdsPrepGrants = false): TeamAccount => ({ id, role, holdsPrepGrants });
const owner = account("owner-1", "owner");
const otherOwner = account("owner-2", "owner");
const admin = account("admin-1", "admin");
const otherAdmin = account("admin-2", "admin");
const grantedAdmin = account("admin-3", "admin", true);
const hr = account("hr-1", "hr");
const sales = account("sales-1", "sales");
const editor = account("editor-1", "editor");
const grantedEditor = account("editor-2", "editor", true);
const grantedStaff = account("staff-2", "staff", true);
const staff = account("staff-1", "staff");

const EDIT: TeamAction = { kind: "edit" };
const PASSWORD: TeamAction = { kind: "password" };
const DELETE: TeamAction = { kind: "delete" };
const toRole = (role: string): TeamAction => ({ kind: "role", role });

const allowed = (actor: TeamAccount, target: TeamAccount, action: TeamAction) => teamRefusal(actor, target, action) === null;

test("THE DEFECTS: an admin cannot reach an hr login, re-role another admin, or rename the owner", () => {
  assert.equal(allowed(admin, hr, PASSWORD), false, "reset an hr password");
  assert.equal(createRefusal("admin", "hr") === null, false, "create an hr login");
  assert.equal(allowed(admin, staff, toRole("hr")), false, "move an account to hr");
  assert.equal(allowed(admin, otherAdmin, toRole("staff")), false, "re-role another admin");
  assert.equal(allowed(admin, owner, EDIT), false, "rename the owner's login");
  assert.equal(allowed(admin, hr, EDIT), false, "rename an hr login");
  assert.equal(allowed(admin, hr, DELETE), false, "delete an hr login");
});

test("an admin manages staff, editor and sales accounts, as the screen shows", () => {
  for (const target of [staff, editor, sales]) {
    assert.equal(allowed(admin, target, EDIT), true);
    assert.equal(allowed(admin, target, PASSWORD), true);
    assert.equal(allowed(admin, target, DELETE), true);
    for (const role of ["admin", "sales", "editor", "staff"]) assert.equal(allowed(admin, target, toRole(role)), true, role);
    for (const role of ["owner", "hr"]) assert.equal(allowed(admin, target, toRole(role)), false, role);
  }
});

test("an admin may edit its own account and password, never delete it or raise it", () => {
  assert.equal(allowed(admin, admin, EDIT), true);
  assert.equal(allowed(admin, admin, PASSWORD), true);
  assert.equal(allowed(admin, admin, DELETE), false);
  assert.equal(allowed(admin, admin, toRole("owner")), false);
  assert.equal(allowed(admin, admin, toRole("hr")), false);
});

test("an admin cannot touch another admin, an hr account or the owner in any way", () => {
  for (const target of [otherAdmin, hr, owner]) {
    const actions: TeamAction[] = [EDIT, PASSWORD, DELETE, toRole("staff"), toRole("admin")];
    for (const action of actions) {
      assert.equal(allowed(admin, target, action), false, `${target.role} ${JSON.stringify(action)}`);
    }
  }
});

test("the owner manages every account, except re-roling an owner row or deleting itself", () => {
  for (const target of [otherOwner, admin, hr, sales, editor, staff]) {
    assert.equal(allowed(owner, target, EDIT), true, target.role);
    assert.equal(allowed(owner, target, PASSWORD), true, target.role);
    assert.equal(allowed(owner, target, DELETE), true, target.role);
  }
  for (const target of [admin, hr, sales, editor, staff]) {
    for (const role of ["owner", "admin", "hr", "sales", "editor", "staff"]) {
      assert.equal(allowed(owner, target, toRole(role)), true, `${target.role} -> ${role}`);
    }
  }
  // The screen shows an owner row's role as a badge, never a picker.
  assert.equal(allowed(owner, otherOwner, toRole("admin")), false);
  assert.equal(allowed(owner, owner, toRole("admin")), false);
  assert.equal(allowed(owner, owner, EDIT), true);
  assert.equal(allowed(owner, owner, PASSWORD), true);
  assert.equal(allowed(owner, owner, DELETE), false);
});

test("the role lists: the owner gives any role, an admin never owner or hr, anyone else none", () => {
  assert.deepEqual(assignableRoles("owner"), ["owner", "admin", "hr", "sales", "editor", "staff"]);
  assert.deepEqual(assignableRoles("admin"), ["admin", "sales", "editor", "staff"]);
  for (const role of ["hr", "sales", "editor", "staff", "", "superuser"]) assert.deepEqual(assignableRoles(role), [], role);
  for (const role of ["owner", "admin", "hr", "sales", "editor", "staff"]) assert.equal(createRefusal("owner", role), null, role);
  for (const role of ["admin", "sales", "editor", "staff"]) assert.equal(createRefusal("admin", role), null, role);
  assert.notEqual(createRefusal("admin", "owner"), null);
});

test("fails closed: an unknown role, on either side or requested, is refused", () => {
  assert.notEqual(createRefusal("owner", "superuser"), null);
  assert.notEqual(teamRefusal(owner, staff, toRole("superuser")), null);
  assert.notEqual(teamRefusal(owner, account("x", "superuser"), EDIT), null);
  assert.notEqual(teamRefusal(account("x", "superuser"), staff, EDIT), null);
});

test("THE REVIEW'S HOLE: an admin cannot act on an account that holds prep grants", () => {
  // A reset password is a login, and a login carries its account's grants.
  const actions: TeamAction[] = [EDIT, PASSWORD, DELETE, toRole("staff"), toRole("editor")];
  for (const target of [grantedEditor, grantedStaff, grantedAdmin]) {
    for (const action of actions) {
      assert.equal(allowed(admin, target, action), false, `${target.id} ${JSON.stringify(action)}`);
    }
  }
  // The control from the same population: the same role WITHOUT grants.
  assert.equal(allowed(admin, editor, PASSWORD), true);
  assert.equal(allowed(admin, staff, PASSWORD), true);
  // The owner still manages a granted account; a granted admin its own row.
  for (const action of [EDIT, PASSWORD, DELETE, toRole("staff")]) {
    assert.equal(allowed(owner, grantedEditor, action), true, JSON.stringify(action));
  }
  assert.equal(allowed(grantedAdmin, grantedAdmin, PASSWORD), true);
  assert.equal(allowed(grantedAdmin, grantedAdmin, EDIT), true);
});

test("roles below admin are refused everything, though requireAdmin stops them first", () => {
  for (const actor of [hr, sales, editor, staff]) {
    const actions: TeamAction[] = [EDIT, PASSWORD, DELETE, toRole("staff")];
    for (const action of actions) {
      assert.equal(allowed(actor, staff, action), false, `${actor.role} ${JSON.stringify(action)}`);
    }
    assert.equal(allowed(actor, actor, DELETE), false);
    assert.notEqual(createRefusal(actor.role, "staff"), null);
  }
});

test("disabling: nobody disables their own account (the delete rule)", () => {
  for (const actor of [owner, admin]) assert.notEqual(teamRefusal(actor, actor, DELETE), null);
});

test("disabling: the last owner or admin who can still sign in cannot be disabled", () => {
  const a = (id: string, role: string, disabled = false) => ({ id, role, disabled });
  // Two owners, both active: either may be disabled.
  assert.equal(lastActiveRefusal(a("o1", "owner"), [a("o1", "owner"), a("o2", "owner")]), null);
  // Two owners, one already disabled: the other is the last active one.
  assert.notEqual(lastActiveRefusal(a("o1", "owner"), [a("o1", "owner"), a("o2", "owner", true)]), null);
  // One owner.
  assert.notEqual(lastActiveRefusal(a("o1", "owner"), [a("o1", "owner")]), null);
  // The same for admins; other roles are never "the last".
  assert.notEqual(lastActiveRefusal(a("a1", "admin"), [a("a1", "admin"), a("a2", "admin", true), a("o1", "owner")]), null);
  assert.equal(lastActiveRefusal(a("a1", "admin"), [a("a1", "admin"), a("a2", "admin")]), null);
  assert.equal(lastActiveRefusal(a("s1", "staff"), [a("s1", "staff")]), null);
});

test("demoting: the last admin who can still sign in keeps the role; a disabled admin does not count", () => {
  const a = (id: string, role: string, disabled = false) => ({ id, role, disabled });
  // THE DEFECT: two admin profiles, the other one disabled. Counting profiles
  // (2) allowed the demotion; only one of them can sign in.
  const refusal = lastActiveRefusal(a("a1", "admin"), [a("a1", "admin"), a("a2", "admin", true)], "ลดสิทธิ์");
  assert.equal(refusal, "ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน ไม่สามารถลดสิทธิ์ Admin คนสุดท้ายที่ใช้งานได้");
  // An owner is not an admin: it does not keep the last admin demotable.
  assert.notEqual(lastActiveRefusal(a("a1", "admin"), [a("a1", "admin"), a("o1", "owner")], "ลดสิทธิ์"), null);
  // Another admin who can sign in: allowed.
  assert.equal(lastActiveRefusal(a("a1", "admin"), [a("a1", "admin"), a("a2", "admin")], "ลดสิทธิ์"), null);
  // Without a verb the refusal still reads as disabling.
  assert.match(lastActiveRefusal(a("o1", "owner"), [a("o1", "owner")]) ?? "", /ไม่สามารถระงับ Owner/);
});

test("disabling: a ban counts until it runs out", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  assert.equal(isBanned("2126-09-23T12:00:00Z", now), true);
  assert.equal(isBanned("2026-09-23T11:00:00Z", now), false);
  assert.equal(isBanned(null, now), false);
  assert.equal(isBanned(undefined, now), false);
});
