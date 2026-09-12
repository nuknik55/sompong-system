-- One missing fact, three symptoms: a charge does not know where it came
-- from. Two nullable columns fix all three. CLOSES QUEUE ITEM 16.
--
-- Run after catering_quotation_migration.sql. Safe to re-run: both ADDs are
-- guarded; nothing existing is rewritten.
--
-- ── THE THREE SYMPTOMS, ONE CAUSE ─────────────────────────────────────────
--
-- catering_event_charges copies the rate's label at insert and keeps no
-- reference back. Because of that:
--
--   1. CUSTOMER LABELS (Nik, from the real quote): the customer reads
--      "เครื่องดื่มเหมา 80-100 ท่าน" and "ระยะ 11-15 กม." — internal rate
--      names staff pick from, not what a customer document should say. With
--      no way back to the rate, a customer-facing name had nowhere to live.
--   2. THE ดนตรี SECTION ON RELOAD (queue item 16): the booking screen
--      reconstructs a stored charge's price-box section from charge_type,
--      and rate_type 'music' maps to 'other' — so it falls back to matching
--      the label text, which is free text.
--   3. ค่าไฟ ON THE SERVICE SHEET: the band's electricity is a 'music' rate
--      landing in 'other', indistinguishable from เบี้ยเลี้ยง, so the sheet
--      prints a ruled line where it could print the figure.
--
-- ── WHAT EACH COLUMN IS ───────────────────────────────────────────────────
--
-- catering_rates.display_label: the CUSTOMER-FACING name, shown on the
-- quote / deposit / invoice ONLY. NULL means "use the internal label" — the
-- fallback, so nothing changes until Nik fills a row in on the rates screen.
-- The internal label stays what staff pick from and what the booking screen
-- and both function sheets print; two names for one rate is the point, not
-- duplication ("เครื่องดื่มเหมา 80-100 ท่าน" internally, "เครื่องดื่มเหมา"
-- to the customer).
--
-- catering_event_charges.rate_id: which rate produced this charge. Set by
-- the insert path from the rate picker; NULL for every other kind of row —
-- menu lines (which have event_menu_id), hand-typed lines and discounts
-- never had a rate, BY CONSTRUCTION, and their typed text is always kept.
-- Existing charges stay NULL and keep printing their stored label: history
-- is not rewritten with provenance it never had.
--
-- ON DELETE SET NULL: deleting a rate must neither delete a customer's
-- charge nor be blocked by one. The charge keeps its copied label and simply
-- loses the reference — exactly the pre-migration behaviour.

BEGIN;

ALTER TABLE public.catering_rates
  ADD COLUMN IF NOT EXISTS display_label TEXT;

ALTER TABLE public.catering_event_charges
  ADD COLUMN IF NOT EXISTS rate_id UUID REFERENCES public.catering_rates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.catering_rates.display_label IS
  'Customer-facing name, printed on the quote/deposit/invoice only. NULL = '
  'fall back to label. The internal label stays on the booking screen and '
  'both function sheets.';

COMMENT ON COLUMN public.catering_event_charges.rate_id IS
  'The rate this charge came from (rate picker inserts only). NULL for menu '
  'lines, hand-typed lines and discounts, and for every charge from before '
  'this column existed. Gives the quote its display_label and the price box '
  'its section without matching label text.';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE (table_name='catering_rates' AND column_name='display_label')
--       OR (table_name='catering_event_charges' AND column_name='rate_id');
--   -- display_label: text, YES | rate_id: uuid, YES
--
--   SELECT count(*) FROM public.catering_event_charges WHERE rate_id IS NOT NULL;
--   -- expect 0: no existing charge is given provenance it never had
--
-- The FK, proven to refuse rather than assumed to (expect 23503, writes nothing):
--   -- UPDATE public.catering_event_charges SET rate_id = gen_random_uuid()
--   --  WHERE id = (SELECT id FROM public.catering_event_charges LIMIT 1);
