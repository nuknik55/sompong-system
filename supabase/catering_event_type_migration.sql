-- ============================================================================
-- ประเภทงาน as a stored, editable field instead of a ruled line
-- ============================================================================
-- Run once in the Supabase SQL editor. Transactional and re-runnable: the
-- CREATE and ADD COLUMN are guarded, and the seed uses ON CONFLICT DO NOTHING.
--
-- Today ประเภทงาน is printed as a dotted rule on BOTH function sheets, for
-- every job, with this comment beside it in FunctionSheetClient.tsx and again
-- in KitchenSheetClient.tsx: "has no column on catering_events — booking_type
-- is จองโต๊ะ/จองห้อง/จองงานจัดเลี้ยง, which is a different question". This
-- migration is that missing column. Both sheets keep printing the rule when
-- the field is empty, so a job booked before anyone asked what the party is
-- for still prints a writable line.
--
-- ── A TABLE, NOT A CHECK CONSTRAINT ────────────────────────────────────────
--
-- Nik must be able to ADD and DELETE types himself. A CHECK-constrained TEXT
-- column would make every new type a migration — a developer, a deploy, and a
-- wait — which is the requirement failing rather than a trade-off. A CHECK
-- also cannot express ปิดใช้: it admits a value or it does not, so retiring a
-- type would orphan the bookings that carry it.
--
-- The cost of the table is one join to print a label, and one more screen to
-- maintain. Both are already the shape of catering_rates, which this mirrors
-- deliberately: same is_active column, same sort_order in tens, same split RLS
-- (read for sales, write for owner/admin).
--
-- ── WHY event_type_id AND NOT A COPIED LABEL ───────────────────────────────
--
-- catering_event_charges copies a rate's label at insert, because a charge is
-- a contract at a moment in time: the amount and the wording were agreed, and
-- renaming the rate afterwards must not rewrite a customer's history.
--
-- A party category is the opposite. If Nik renames "เลี้ยงสัมมนาบริษัท" to
-- "สัมมนา", every booking of that kind IS still that kind and should print the
-- new word. One fact in one place. So this is a foreign key, and the label
-- lives only here.
--
-- ── ON DELETE RESTRICT, WHICH IS NIK'S RULE MADE STRUCTURAL ────────────────
--
-- His rule: a type no booking uses can be deleted outright; a type in use
-- cannot — it becomes ปิดใช้ instead, gone from the picker, still printed on
-- the bookings that carry it.
--
-- RESTRICT makes the database refuse the second case, so the rule holds even
-- if two people race — one deleting a type while another assigns it. The app
-- will still pre-count the bookings so its message can say HOW MANY use it,
-- with the FK as the backstop rather than the only guard.
--
-- This is NOT the convention catering_rates uses for deletion, and the
-- difference is deliberate rather than a second convention invented. A rate is
-- deleted with ON DELETE SET NULL on catering_event_charges.rate_id: the
-- charge keeps its copied label and merely loses its provenance, so deleting
-- costs nothing. Here there is no copied label to fall back on — deleting a
-- type in use would blank ประเภทงาน on real bookings, which is exactly what
-- Nik said must not happen. The repo's existing refusal convention is the one
-- that fits: prep_recipe_items.ingredient_id is ON DELETE RESTRICT, and
-- deletePrep already translates 23503 into a Thai sentence. Same pattern here.
--
-- The is_active half DOES follow catering_rates exactly, including that the
-- picker reads only active rows while the settings screen reads all of them.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.catering_event_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lets the seed below use ON CONFLICT DO NOTHING and stay re-run safe, and
  -- stops two rows reading the same on a printed sheet. Same reason
  -- catering_rates carries UNIQUE (rate_type, label).
  UNIQUE (label)
);

COMMENT ON TABLE public.catering_event_types IS
  'ประเภทงาน — what the party is FOR (งานบุญ, วันเกิด, เลี้ยงสัมมนาบริษัท). '
  'Distinct from catering_events.booking_type, which is จองโต๊ะ/จองห้อง/'
  'จองงานจัดเลี้ยง. Owner-editable: add and delete, or ปิดใช้ when a booking '
  'already uses it.';

ALTER TABLE public.catering_events
  ADD COLUMN IF NOT EXISTS event_type_id UUID
  REFERENCES public.catering_event_types(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.catering_events.event_type_id IS
  'ประเภทงาน, printed on both function sheets where a dotted rule used to be. '
  'NULL is normal and prints the rule: a booking can be taken before anyone '
  'asks what the party is for. RESTRICT, not SET NULL — a type in use must be '
  'deactivated rather than deleted, so this can never be silently blanked.';

CREATE INDEX IF NOT EXISTS idx_catering_events_event_type
  ON public.catering_events(event_type_id);

-- ── RLS, mirroring catering_rates exactly ─────────────────────────────────
-- Read for sales, because sales takes the booking and must see the picker.
-- Write for owner/admin, because the list is settings. The app guards with
-- requireAdmin() on top; neither layer is load-bearing alone.

ALTER TABLE public.catering_event_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catering_event_types_select" ON public.catering_event_types;
CREATE POLICY "catering_event_types_select" ON public.catering_event_types FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'sales'));

DROP POLICY IF EXISTS "catering_event_types_all" ON public.catering_event_types;
CREATE POLICY "catering_event_types_all" ON public.catering_event_types FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));

-- ── Seed: what Nik actually books, in the order he gave ───────────────────
-- The last two are transcribed from the real documents he photographed; the
-- first three are his own answer to "what else do you book". sort_order in
-- tens, as catering_rates does, so a type can be slipped between two later
-- without renumbering.

INSERT INTO public.catering_event_types (label, sort_order) VALUES
  ('งานบุญ',              10),
  ('เลี้ยงพนักงาน',        20),
  ('วันเกิด',              30),
  ('เลี้ยงสัมมนาบริษัท',   40),
  ('เลี้ยงรับรองลูกค้า',    50)
ON CONFLICT (label) DO NOTHING;

COMMIT;

-- ═══ Verification — run separately, after the COMMIT ═══════════════════════
--
-- 1. The five seeded types, in Nik's order. Expect exactly these five, all
--    active, sort_order 10..50.
--
--   SELECT label, sort_order, is_active
--     FROM public.catering_event_types ORDER BY sort_order;
--
-- 2. The column exists and every existing booking is NULL — nothing was
--    guessed on his behalf. Expect 3 rows total, 0 with a type.
--
--   SELECT count(*) AS events, count(event_type_id) AS with_type
--     FROM public.catering_events;
--
-- 3. THE DELETE RULE, proven rather than assumed. Assign a type to a booking
--    inside a transaction, try to delete that type, and watch it refuse with
--    23503 — then roll the whole thing back so nothing is kept.
--
--   BEGIN;
--     UPDATE public.catering_events
--        SET event_type_id = (SELECT id FROM public.catering_event_types WHERE label = 'วันเกิด')
--      WHERE id = (SELECT id FROM public.catering_events LIMIT 1);
--     -- this next statement MUST fail with 23503 foreign_key_violation:
--     DELETE FROM public.catering_event_types WHERE label = 'วันเกิด';
--   ROLLBACK;
--
--   If that DELETE succeeds, RESTRICT is not in place and the app's refusal
--   would be the only guard — report it rather than continuing.
--
-- 4. An UNUSED type deletes cleanly, which is the other half of the rule.
--    Rolled back, so the seed stays intact.
--
--   BEGIN;
--     DELETE FROM public.catering_event_types WHERE label = 'วันเกิด';
--     SELECT count(*) AS should_be_4 FROM public.catering_event_types;
--   ROLLBACK;
