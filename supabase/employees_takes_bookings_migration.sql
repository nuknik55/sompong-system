-- employees.takes_bookings — who may be the taker (ผู้รับงานจอง) of a
-- catering booking. Catering reduce, commit 2.
--
-- Run after catering_migration.sql (the view below replaces the one it
-- created). Safe to re-run: the column add is IF NOT EXISTS, the view is
-- dropped and recreated identically, nothing else is written.
--
-- ── WHY A FLAG ────────────────────────────────────────────────────────────
--
-- The booking sheet's ผู้รับงานจอง column holds six people across eight
-- months: นิกกี้ (พนักงานเสิร์ฟ, บริการ), วุ้น and เปา (กัปตัน, บริการ),
-- เบ้ (ผู้จัดการ ฝ่ายบริการ), คุณเล็ก (HR) and เฮง (ผู้จัดการ ฝ่ายครัว).
-- Three departments, five positions: no HR attribute selects them, and the
-- old picker offered all 47 employees as chips. One boolean, ticked on the
-- HR employee page, is the honest representation. Nobody is pre-ticked
-- here — two employees share the nickname เล็ก, and a migration guessing
-- by nickname is exactly the kind of silent mistake this file must not
-- make. Nik ticks the six on the HR page.
--
-- The catering picker reads employees ONLY through the
-- catering_staff_options view (sales has no policy on employees itself, so
-- salary columns stay out of reach), so the view gains the column.

BEGIN;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS takes_bookings BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employees.takes_bookings IS
  'TRUE for the people who take catering bookings (the sheet''s ผู้รับงานจอง). '
  'The booking screen''s taker dropdown lists only these, plus whoever is already '
  'saved on the booking. Ticked on the HR employee page; nothing sets it '
  'automatically.';

-- ── The name-only view, recreated with the flag ─────────────────────────────
-- !! The view intentionally relies on the DEFAULT view behaviour
-- !! (security_invoker = false), so it reads employees with the view owner's
-- !! rights and bypasses the employees RLS policies — which is what lets sales
-- !! see names while having NO policy on employees itself. Access is instead
-- !! gated by the WHERE clause below.
-- !! Do NOT "fix" a Supabase linter warning by setting security_invoker = true
-- !! on this view: sales would silently start getting zero rows.

DROP VIEW IF EXISTS public.catering_staff_options;
CREATE VIEW public.catering_staff_options AS
SELECT
  e.id,
  e.nickname,
  e.full_name,
  e.is_active,
  e.sort_order,
  e.takes_bookings,
  d.name AS department_name
FROM public.employees e
LEFT JOIN public.departments d ON d.id = e.department_id
WHERE (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
      IN ('owner', 'admin', 'sales');

REVOKE ALL ON public.catering_staff_options FROM PUBLIC;
GRANT SELECT ON public.catering_staff_options TO authenticated;

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='employees' AND column_name='takes_bookings';
--   -- expect one row: boolean, default false
--   SELECT count(*) FILTER (WHERE takes_bookings) AS takers, count(*) AS employees FROM public.employees;
--   -- expect 0 | 47 immediately after this file; 6 | 47 after Nik ticks them
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='catering_staff_options' ORDER BY ordinal_position;
--   -- expect id, nickname, full_name, is_active, sort_order, takes_bookings, department_name
--   SELECT relname, reloptions FROM pg_class WHERE relname='catering_staff_options';
--   -- reloptions must NOT contain security_invoker=true
