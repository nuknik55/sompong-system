-- ============================================================================
-- Link catering_event_charges to the catering_event_menus row that created it
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (ADD COLUMN IF NOT
-- EXISTS / DROP CONSTRAINT IF EXISTS throughout).
--
-- Today addCateringEventMenu() inserts a catering_event_menus row (what was
-- ordered) and a matching catering_event_charges row (the quotation line) as
-- two independent inserts with no link between them. Removing the menu row
-- currently leaves its charge behind — this migration adds the FK so a
-- future removeCateringEventMenu() can rely on the database to clean up
-- correctly instead of reimplementing that logic in application code.
-- ============================================================================

ALTER TABLE public.catering_event_charges
  ADD COLUMN IF NOT EXISTS event_menu_id UUID REFERENCES public.catering_event_menus(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_catering_event_charges_event_menu ON public.catering_event_charges(event_menu_id);

COMMENT ON COLUMN public.catering_event_charges.event_menu_id IS
  'Set only by addCateringEventMenu() when it creates the matching charge line. NULL for every other charge (rate picker, "+ เพิ่มรายการ", hand-typed) — those have no catering_event_menus row to link to. ON DELETE CASCADE: deleting a catering_event_menus row deletes every charge linked to it. A single menu row can end up linked to MULTIPLE charge rows over time, because re-adding the same dish/set bumps quantity on the existing catering_event_menus row but always inserts a fresh catering_event_charges row (see addCateringEventMenu''s comment in actions.ts) — cascade correctly removes all of them, not just the most recent.';
