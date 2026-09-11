-- catering_events gains a per-event deposit percentage. ONE COLUMN, which is
-- the whole cost of the feature.
--
-- Run before deploying the quote/deposit/invoice route (document C). Safe to
-- re-run: the ADD is guarded and the CHECK is dropped before it is added.
--
-- ── WHY PER EVENT, AND NOT A SETTING ──────────────────────────────────────
--
-- Because the real documents disagree, and neither is wrong. The deposit slip
-- Nik photographed says 30%; the quotation wording already in this repo says
-- 50%. Both are Sompong's. The percentage is negotiated per job — a large
-- internal booking and a full offsite job are not the same risk — so a single
-- number in catering_settings would be wrong for one of them every time, and
-- hardcoding either into the print would be wrong for the other.
--
-- So it sits on the event, beside the deposit_amount it explains.
--
-- ── NULLABLE, AND NO DEFAULT ──────────────────────────────────────────────
--
-- NULL means "nobody has decided yet", which is a real state: a booking exists
-- long before its deposit terms are agreed. It is NOT the same as 0, and the
-- print relies on the difference — NULL leaves the percentage blank on the
-- document for someone to write in, 0 would assert that no deposit is due.
--
-- No DEFAULT for the same reason. Defaulting to 30 or to 50 would make every
-- existing booking silently claim terms nobody agreed to, and both numbers are
-- attested, so there is no neutral choice. The field is filled in by the person
-- who agreed it.
--
-- ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
--
-- It does not compute or store the deposit amount. catering_events already has
-- deposit_amount, which records what was actually RECEIVED, and that stays the
-- authority — a customer may round, pay in two parts, or pay a different figure
-- than the percentage implies. The percentage is the agreed TERM; the amount is
-- the fact. The document shows the computed figure beside the agreed percentage
-- and the received amount separately, rather than reconciling them silently.

BEGIN;

ALTER TABLE public.catering_events
  ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(5,2);

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_deposit_percent_check;
ALTER TABLE public.catering_events
  ADD CONSTRAINT catering_events_deposit_percent_check
  CHECK (deposit_percent IS NULL OR (deposit_percent > 0 AND deposit_percent <= 100));

COMMENT ON COLUMN public.catering_events.deposit_percent IS
  'Agreed deposit percentage for THIS event, 0 < n <= 100. Negotiated per job '
  '— the deposit slip says 30, the quotation wording says 50, and both are '
  'real — so it is not a setting and has no default. NULL means not yet '
  'agreed, which prints as a blank for someone to write in and is not the '
  'same as 0. The amount actually received stays in deposit_amount.';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='catering_events'
--      AND column_name='deposit_percent';
--   -- numeric | YES | (null)
--
--   SELECT count(*) FROM public.catering_events WHERE deposit_percent IS NOT NULL;
--   -- expect 0: no existing booking is given terms it never agreed to
--
-- The CHECK, proven to refuse rather than assumed to. Each is expected to
-- ERROR with 23514, and none of them writes anything:
--   -- UPDATE public.catering_events SET deposit_percent = 0;      -- 0 is not "no deposit"
--   -- UPDATE public.catering_events SET deposit_percent = 101;    -- over 100
--   -- UPDATE public.catering_events SET deposit_percent = -30;    -- negative
--
-- And one that must SUCCEED, then be rolled back:
--   -- BEGIN; UPDATE public.catering_events SET deposit_percent = 30; ROLLBACK;
