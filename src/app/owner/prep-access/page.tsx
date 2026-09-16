export const dynamic = "force-dynamic";

import { requireOwner } from "@/lib/auth";
import { getPrepAccessBoard } from "@/lib/prep-access";
import { PrepAccessClient } from "./PrepAccessClient";

// ── สิทธิ์ดูสูตรของเตรียม — OWNER ONLY, DELIBERATELY ────────────────────────
//
// requireOwner(), not requireAdmin(), and it is the only management screen in
// the app that works that way. Nik's decision, 2026-09-14: admins are named on
// prep recipes like everyone else, so the three admin accounts must not be
// able to grant themselves the recipes they have not been given. Changing this
// to requireAdmin() to match the other owner screens would hand every secret
// recipe to anyone who can already reach /owner.
//
// The RLS policy on prep_recipe_access says the same thing (writes are
// is_owner_only()), so this guard and the database agree; neither is load
// bearing alone. Until 2026-09-16 the policy said is_owner(), which also
// admits admins, so for an admin this guard WAS the only layer. See
// supabase/prep_owner_only_predicate_migration.sql.

export default async function PrepAccessPage() {
  await requireOwner();
  const { recipes, people, grants } = await getPrepAccessBoard();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">สิทธิ์ดูสูตรของเตรียม</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          สูตรของเตรียมทุกสูตรถูกปิดไว้ก่อน — เปิดให้ทีละคน ทีละสูตร เจ้าของร้านเห็นทุกสูตรเสมอ
          และเป็นคนเดียวที่เปิดสิทธิ์ให้คนอื่นได้
        </p>
      </div>
      <PrepAccessClient recipes={recipes} people={people} grants={grants} />
    </div>
  );
}
