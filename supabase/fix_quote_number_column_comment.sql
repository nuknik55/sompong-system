-- Correct the quote_number column comment: the prefix is not always "IN".
--
-- Documentation only. No schema change, no data change, safe to re-run, and
-- safe to run at any point relative to everything else.
--
-- WHY THIS IS ITS OWN FILE. catering_quotation_migration.sql set this comment
-- when it ran, and its text is now wrong. Editing that file would make a
-- tracked migration stop describing what was actually executed, which is the
-- exact divergence supabase/README.md exists to prevent — the applied file
-- stays as-run, and the correction arrives as a new statement.
--
-- WHAT WAS WRONG. The original comment read:
--
--   'Assigned once, on first issue, format QSP-IN{Buddhist YYMM}-{3-digit
--    sequence}, e.g. QSP-IN6908-001 ...'
--
-- The "IN" was baked into the description because it was baked into the
-- generator: issueCateringQuote() hardcoded it and did not even select
-- location_type, so every offsite quote came out labelled in-house. Fixed in
-- src/app/owner/catering/actions.ts — the prefix is now IN for in_house and
-- OUT for offsite.

COMMENT ON COLUMN public.catering_events.quote_number IS
  'Assigned once, on first issue, format QSP-{IN|OUT}{Buddhist YYMM}-{3-digit '
  'sequence}. IN for location_type = in_house, OUT for offsite — chosen in '
  'issueCateringQuote(), which throws rather than defaulting if it sees any '
  'other location_type. e.g. QSP-IN6908-001, QSP-OUT6908-006. Never reassigned '
  'on re-issue. The sequence is SHARED per Buddhist YYMM across both prefixes, '
  'so each prefix''s own run has gaps: an offsite quote issued after IN-005 is '
  'OUT-006. Generated via catering_quote_sequences, not a plain COUNT(*), to '
  'stay race-safe under concurrent issues.';

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Expect the text above, mentioning {IN|OUT} rather than IN:
--   SELECT col_description(
--            'public.catering_events'::regclass,
--            (SELECT attnum FROM pg_attribute
--              WHERE attrelid = 'public.catering_events'::regclass
--                AND attname = 'quote_number'));
