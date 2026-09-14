-- "แจ้งแล้ว" with nobody named is the defect the live data shows: the roof
-- leak reported 2026-08-09 has read "กำลังซ่อม" since 08-17 with no name on
-- it, because resolver_id is only written when a report reaches 'done'.
-- Accepting a report ("รับเรื่อง") will now record who took it, and the name
-- must be printable on the list for every logged-in user.
--
-- Why a column and not a join: profiles is select-own under RLS
-- (profiles_select_own, 0001_init.sql), so the list page cannot read another
-- user's full_name at render time. reporter_name already solves the same
-- problem the same way — denormalised at write time — and this mirrors it
-- exactly, beside resolver_id, which stays the identity.
--
-- Safe to re-run: the ADD is guarded; nothing existing is rewritten. The six
-- rows that exist keep resolver_name NULL — the two 'done' rows were closed
-- before the column existed and are not given a name after the fact. The
-- code that writes it deploys only after this has run (untyped client).

BEGIN;

ALTER TABLE public.maintenance_reports
  ADD COLUMN IF NOT EXISTS resolver_name TEXT;

COMMENT ON COLUMN public.maintenance_reports.resolver_name IS
  'full_name of the person who accepted or closed the report, copied at '
  'write time like reporter_name. NULL for reports closed before the column '
  'existed. resolver_id remains the identity; this is what the list prints.';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'maintenance_reports' AND column_name = 'resolver_name';
--   -- resolver_name: text, YES
--
--   SELECT count(*) FROM public.maintenance_reports WHERE resolver_name IS NOT NULL;
--   -- expect 0: no existing row is given a name after the fact
