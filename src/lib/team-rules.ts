import type { Role } from "./auth";

/**
 * Who may do what on /owner/team. ONE rule, used by the screen
 * (team-manager.tsx shows only what it allows) and by the server actions
 * (owner/team/actions.ts refuse everything else), so the two cannot drift
 * apart again.
 *
 * Queue item 29, 1–3. The screen already encoded this rule and the server did
 * not. An admin could reset an hr account's password, create an hr login or
 * move an account to hr (hr reads every employee's pay), re-role another
 * admin, and rename the OWNER's login name, which could lock the owner out.
 * None of that was reachable from the screen; all of it was a direct call.
 *
 * An admin also may not act on an account that holds PREP GRANTS, whatever
 * its role. Resetting its password is logging in as it, and a session
 * carries the grants of its account: an admin with no grant could reset
 * เวช's password (an editor holding all 48) and read every secret recipe,
 * against the owner's rule that admins see a prep only when named. Found by
 * the item 29 review, 2026-09-17. Its own row is exempt; its grants are
 * its own.
 *
 * Pure, so every case is a test (team-rules.test.ts). Each function returns
 * the refusal message, or null when the action is allowed.
 */

export type TeamActor = { id: string; role: string };

/** holdsPrepGrants: the account has at least one prep_recipe_access row. */
export type TeamAccount = TeamActor & { holdsPrepGrants: boolean };

export type TeamAction =
  | { kind: "edit" }
  | { kind: "password" }
  | { kind: "delete" }
  | { kind: "role"; role: string };

const ROLES: readonly Role[] = ["owner", "admin", "hr", "sales", "editor", "staff"];

/**
 * The accounts an admin manages. hr is NOT one: an hr login reads every
 * employee's pay. sales is: it reaches customers and bookings, never salary.
 */
const ADMIN_MANAGED: readonly Role[] = ["staff", "editor", "sales"];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** A login is disabled while its ban has not run out (ระงับการใช้งาน). */
export function isBanned(bannedUntil: string | null | undefined, now: number = Date.now()): boolean {
  return !!bannedUntil && new Date(bannedUntil).getTime() > now;
}

/**
 * Disabling the last owner, or the last admin, who can still sign in is
 * refused. "Can sign in" means an account of that role whose login is not
 * banned; one with no login at all counts as unable. Counting profiles
 * instead let an owner disable the only other owner while the first was
 * already disabled (its open session outlives the ban by up to an hour).
 */
export function lastActiveRefusal(
  target: { id: string; role: string },
  accounts: { id: string; role: string; disabled: boolean }[],
): string | null {
  if (target.role !== "owner" && target.role !== "admin") return null;
  const others = accounts.filter((a) => a.role === target.role && a.id !== target.id && !a.disabled);
  if (others.length > 0) return null;
  return target.role === "owner"
    ? "ต้องมี Owner ที่ใช้งานได้อย่างน้อย 1 คน ไม่สามารถระงับ Owner คนสุดท้ายที่ใช้งานได้"
    : "ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน ไม่สามารถระงับ Admin คนสุดท้ายที่ใช้งานได้";
}

/** The roles this actor may give an account, in the screen's order. */
export function assignableRoles(actorRole: string): Role[] {
  if (actorRole === "owner") return [...ROLES];
  if (actorRole === "admin") return ROLES.filter((r) => r !== "owner" && r !== "hr");
  return [];
}

/** May this actor create an account with this role? */
export function createRefusal(actorRole: string, role: string): string | null {
  if (!isRole(role)) return "สิทธิ์ที่เลือกไม่ถูกต้อง";
  if (assignableRoles(actorRole).includes(role)) return null;
  return "เฉพาะ Owner เท่านั้นที่สร้างบัญชี Owner หรือ HR ได้";
}

/**
 * May this actor do this to this account?
 *
 * An account whose role is not a known one is refused for everyone: a rule
 * that cannot place the target does not guess.
 */
export function teamRefusal(actor: TeamActor, target: TeamAccount, action: TeamAction): string | null {
  if (!isRole(actor.role) || !isRole(target.role)) return "ไม่รู้จักสิทธิ์ของบัญชีนี้ จึงยังไม่ดำเนินการ";
  const isSelf = actor.id === target.id;
  const isOwner = actor.role === "owner";
  if (actor.role === "admin" && !isSelf && target.holdsPrepGrants) {
    return "บัญชีนี้ได้รับสิทธิ์ดูสูตรของเตรียม — ให้ Owner เป็นผู้แก้ไข";
  }
  // The rows an actor may act on at all: the owner, every row; an admin, its
  // own row and the accounts it manages; anyone else, none.
  const manages = isOwner || (actor.role === "admin" && (isSelf || ADMIN_MANAGED.includes(target.role)));

  switch (action.kind) {
    case "edit":
      return manages ? null : "Admin แก้ไขได้เฉพาะบัญชี Staff, Editor, Sales และบัญชีของตัวเองเท่านั้น";
    case "password":
      return manages ? null : "Admin เปลี่ยนรหัสผ่านได้เฉพาะบัญชี Staff, Editor, Sales และบัญชีของตัวเองเท่านั้น";
    case "delete":
      if (isSelf) return "ไม่สามารถลบบัญชีของตัวเองได้";
      return isOwner || (actor.role === "admin" && ADMIN_MANAGED.includes(target.role))
        ? null
        : "Admin ลบได้เฉพาะบัญชี Staff, Editor และ Sales เท่านั้น";
    case "role": {
      // An owner row shows a badge, never a role picker, for anyone.
      if (target.role === "owner") return "ไม่สามารถเปลี่ยนสิทธิ์บัญชี Owner ได้";
      if (!manages) return "Admin เปลี่ยนสิทธิ์ได้เฉพาะบัญชี Staff, Editor, Sales และบัญชีของตัวเองเท่านั้น";
      if (!isRole(action.role)) return "สิทธิ์ที่เลือกไม่ถูกต้อง";
      return assignableRoles(actor.role).includes(action.role)
        ? null
        : "เฉพาะ Owner เท่านั้นที่ตั้งสิทธิ์ Owner หรือ HR ได้";
    }
  }
}
