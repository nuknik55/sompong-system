-- ============================================================================
-- Catering module — quotation feature: rates, document settings, quote numbers
-- ============================================================================
-- Run once in the Supabase SQL editor, after catering_migration.sql and
-- catering_location_migration.sql. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS / ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS throughout).
--
-- catering_rates and catering_settings are seeded with real figures from the
-- restaurant's own written pricing terms (relayed via chat, not pasted from
-- a source file). A few gaps in that source are flagged inline below rather
-- than silently filled in — search this file for "FLAG:".
-- ============================================================================


-- ── 1. catering_rates — adjustable price list ───────────────────────────────
-- Modeled on coa / holidays: a plain editable list, not a singleton.

CREATE TABLE IF NOT EXISTS public.catering_rates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'food_set' added beyond the originally proposed 6 values: the seed data
  -- has 8 food/buffet rows, the single largest category, and the quotation
  -- UI will almost certainly want to list/group them on their own rather
  -- than inside a catch-all 'other' next to five well-named categories.
  rate_type        TEXT NOT NULL
                   CHECK (rate_type IN ('room', 'delivery', 'drink', 'music', 'staff_bonus', 'food_set', 'other')),
  label            TEXT NOT NULL,
  amount           NUMERIC NOT NULL,
  unit             TEXT,                     -- free text, e.g. "ต่อโต๊ะ", "ต่อหัว", "ต่อกม." — nullable
  note             TEXT,                     -- qualifiers that don't belong in the label, e.g. a minimum guest count
  min_distance_km  NUMERIC,                  -- delivery brackets only
  max_distance_km  NUMERIC,                  -- delivery brackets only
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lets the seed inserts below use ON CONFLICT DO NOTHING to stay re-run
  -- safe. id is a random UUID and can't serve that purpose by itself.
  UNIQUE (rate_type, label)
);

CREATE INDEX IF NOT EXISTS idx_catering_rates_type ON public.catering_rates(rate_type);

-- Not coupled to rate_type = 'delivery' — not certain every delivery row is
-- bracket-based (there could be a flat base fee row too). Just enforces the
-- pair makes sense when both are present.
ALTER TABLE public.catering_rates DROP CONSTRAINT IF EXISTS catering_rates_distance_range;
ALTER TABLE public.catering_rates ADD CONSTRAINT catering_rates_distance_range
  CHECK ((min_distance_km IS NULL AND max_distance_km IS NULL)
      OR (min_distance_km IS NOT NULL AND max_distance_km IS NOT NULL AND min_distance_km <= max_distance_km));

DROP TRIGGER IF EXISTS trg_catering_rates_updated_at ON public.catering_rates;
CREATE TRIGGER trg_catering_rates_updated_at BEFORE UPDATE ON public.catering_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.catering_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catering_rates_select" ON public.catering_rates;
CREATE POLICY "catering_rates_select" ON public.catering_rates FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'sales'));

DROP POLICY IF EXISTS "catering_rates_all" ON public.catering_rates;
CREATE POLICY "catering_rates_all" ON public.catering_rates FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));

COMMENT ON TABLE public.catering_rates IS
  'Adjustable sale-price list for quotations: room fees, delivery brackets, food/buffet sets, drink packages, music/band prices, staff bonuses. Sale prices only — never cost. Seeded from the restaurant''s written pricing terms.';
COMMENT ON COLUMN public.catering_rates.unit IS
  'Free text describing how amount applies, e.g. "ต่อโต๊ะ", "ต่อหัว", "ต่อกม." — not a CHECK enum, the quotation UI just displays it next to the amount.';
COMMENT ON COLUMN public.catering_rates.note IS
  'Qualifiers that would clutter the label, e.g. a minimum guest count or "actual charge varies" caveat.';
COMMENT ON COLUMN public.catering_rates.min_distance_km IS
  'Delivery brackets only. Both min and max must be set together (see catering_rates_distance_range) — NULL for any non-distance-based rate.';

-- Room (in-house)
INSERT INTO public.catering_rates (rate_type, label, amount, unit, sort_order) VALUES
  ('room', 'ห้องแอร์ ครึ่งห้อง',            1500, 'ต่องาน (4 ชม.)', 10),
  ('room', 'ห้องแอร์ เต็มห้อง',              3000, 'ต่องาน (4 ชม.)', 20),
  ('room', 'ค่าล่วงเวลาห้อง (เกิน 4 ชม.)',    2000, 'ต่อชม.',         30)
ON CONFLICT (rate_type, label) DO NOTHING;

-- Delivery — 8 distance brackets, 1-40 km.
-- FLAG: no bracket covers below 1 km or above 40 km — the source terms don't
-- say what applies there. The quotation UI will need a fallback for
-- out-of-range distances; not something to guess at the DB layer.
INSERT INTO public.catering_rates (rate_type, label, amount, unit, min_distance_km, max_distance_km, sort_order) VALUES
  ('delivery', 'ระยะ 1-5 กม.',   2000, 'เหมา', 1,  5,  10),
  ('delivery', 'ระยะ 6-10 กม.',  2500, 'เหมา', 6,  10, 20),
  ('delivery', 'ระยะ 11-15 กม.', 3000, 'เหมา', 11, 15, 30),
  ('delivery', 'ระยะ 16-20 กม.', 3500, 'เหมา', 16, 20, 40),
  ('delivery', 'ระยะ 21-25 กม.', 4000, 'เหมา', 21, 25, 50),
  ('delivery', 'ระยะ 26-30 กม.', 4500, 'เหมา', 26, 30, 60),
  ('delivery', 'ระยะ 31-35 กม.', 5000, 'เหมา', 31, 35, 70),
  ('delivery', 'ระยะ 36-40 กม.', 5500, 'เหมา', 36, 40, 80)
ON CONFLICT (rate_type, label) DO NOTHING;

-- Food / set menu — per-table or per-head sale prices, not tied to a
-- specific dish.
-- FLAG: "ขั้นต่ำ 30 ท่าน" (minimum 30 guests) was only stated for the 6-menu
-- indoor buffet row. Not applied to the 7-menu or offsite variants below —
-- confirm whether the same minimum actually applies to those too.
INSERT INTO public.catering_rates (rate_type, label, amount, unit, note, sort_order) VALUES
  ('food_set', 'โต๊ะจีน ชุด 3,000',              3000, 'ต่อโต๊ะ', NULL,             10),
  ('food_set', 'โต๊ะจีน ชุด 3,500',              3500, 'ต่อโต๊ะ', NULL,             20),
  ('food_set', 'โต๊ะจีน ชุด 4,000',              4000, 'ต่อโต๊ะ', NULL,             30),
  ('food_set', 'โต๊ะจีน ชุด 4,500',              4500, 'ต่อโต๊ะ', NULL,             40),
  ('food_set', 'บุฟเฟต์ภายใน (6 เมนู)',          350,  'ต่อหัว',  'ขั้นต่ำ 30 ท่าน', 50),
  ('food_set', 'บุฟเฟต์ภายใน (7 เมนู)',          450,  'ต่อหัว',  NULL,             60),
  ('food_set', 'บุฟเฟต์นอกสถานที่ (6 เมนู)',      380,  'ต่อหัว',  NULL,             70),
  ('food_set', 'บุฟเฟต์นอกสถานที่ (7 เมนู)',      480,  'ต่อหัว',  NULL,             80)
ON CONFLICT (rate_type, label) DO NOTHING;

-- Drink — tiered by headcount. No guest-count column here: the quotation UI
-- picks the matching row from guest_count at use-time.
INSERT INTO public.catering_rates (rate_type, label, amount, unit, sort_order) VALUES
  ('drink', 'เครื่องดื่มเหมา 50-80 ท่าน',   100, 'ต่อหัว', 10),
  ('drink', 'เครื่องดื่มเหมา 80-100 ท่าน',  90,  'ต่อหัว', 20),
  ('drink', 'เครื่องดื่มเหมา 100+ ท่าน',    80,  'ต่อหัว', 30)
ON CONFLICT (rate_type, label) DO NOTHING;

-- Music
INSERT INTO public.catering_rates (rate_type, label, amount, unit, sort_order) VALUES
  ('music', 'คาราโอเกะ (ร้าน) ชุดมินิ',            1500, 'เหมา',   10),
  ('music', 'คาราโอเกะ (ร้าน) ชุดมาตรฐาน',          4500, 'เหมา',   20),
  ('music', 'ค่าไฟวงดนตรีลูกค้า (1,000-3,000 ตามจริง)', 1000, 'ขั้นต่ำ', 30)
ON CONFLICT (rate_type, label) DO NOTHING;

-- Staff bonus — informational reference for internal costing; sale-side
-- context, not cost data, so sales can still see it.
INSERT INTO public.catering_rates (rate_type, label, amount, unit, sort_order) VALUES
  ('staff_bonus', 'เบี้ยเลี้ยงพนักงานนอกสถานที่',                 250, 'ต่อคน',  10),
  ('staff_bonus', 'ค่าอาหารพนักงานนอกสถานที่',                    50,  'ต่อคน',  20),
  ('staff_bonus', 'ค่าเบี้ยเลี้ยงโต๊ะจีนภายใน (ตั้งแต่โต๊ะที่ 6)',   100, 'ต่อโต๊ะ', 30)
ON CONFLICT (rate_type, label) DO NOTHING;


-- ── 2. catering_settings — singleton quotation document header ─────────────
-- Standalone from app_settings per your confirmation that table isn't live.
-- Same singleton shape regardless: id=1, CHECK enforces it.

CREATE TABLE IF NOT EXISTS public.catering_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  company_name         TEXT,
  address              TEXT,
  tax_id               TEXT,
  phone                TEXT,
  bank_name            TEXT,
  bank_account_name    TEXT,
  bank_account_number  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catering_settings_singleton CHECK (id = 1)
);

DROP TRIGGER IF EXISTS trg_catering_settings_updated_at ON public.catering_settings;
CREATE TRIGGER trg_catering_settings_updated_at BEFORE UPDATE ON public.catering_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.catering_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catering_settings_select" ON public.catering_settings;
CREATE POLICY "catering_settings_select" ON public.catering_settings FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'sales'));

DROP POLICY IF EXISTS "catering_settings_write" ON public.catering_settings;
CREATE POLICY "catering_settings_write" ON public.catering_settings FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));

COMMENT ON TABLE public.catering_settings IS
  'Singleton (id=1) quotation document header — company name, address, tax ID, phone, and the bank account customers pay into.';

-- ON CONFLICT DO NOTHING (not DO UPDATE): if this migration is re-run after
-- someone has already edited this row through a future settings UI, a blind
-- re-run must not clobber their live edits.
INSERT INTO public.catering_settings (id, company_name, address, tax_id, phone, bank_name, bank_account_name, bank_account_number)
VALUES (
  1,
  'ห้างหุ้นส่วนจำกัด สวนอาหารสมพงศ์ (สำนักงานใหญ่)',
  '27/15 หมู่ 5 ต.บางเมือง อ.เมือง จ.สมุทรปราการ 10270',
  '0113539002790',
  '0942428682 / 027032496',
  'ธนาคารไทยพาณิชย์',
  'ห้างหุ้นส่วนจำกัด สวนอาหารสมพงศ์',
  '468-1-00117-2'
)
ON CONFLICT (id) DO NOTHING;


-- ── 3. catering_events: quote_number + quote_revision ───────────────────────
-- quote_number is assigned once, on first issue, and never changes on a
-- re-issue — only quote_revision increments and quoted_total/quoted_at (from
-- catering_migration.sql) get overwritten. No revision history is kept, per
-- your confirmed rule: the latest issue is authoritative.

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS quote_number TEXT;
ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS quote_revision INTEGER NOT NULL DEFAULT 0;

-- NULL-safe: Postgres UNIQUE allows any number of NULL rows (most events
-- never reach quotation stage), and only enforces uniqueness once assigned.
ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_quote_number_unique;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_quote_number_unique UNIQUE (quote_number);

COMMENT ON COLUMN public.catering_events.quote_number IS
  'Assigned once, on first issue, format QSP-IN{Buddhist YYMM}-{3-digit sequence}, e.g. QSP-IN6908-001 for the 1st quote issued in August 2569. Never reassigned on re-issue. Generated via catering_quote_sequences, not a plain COUNT(*), to stay race-safe under concurrent issues.';
COMMENT ON COLUMN public.catering_events.quote_revision IS
  'Increments on each re-issue of an already-quoted event. No history of prior revisions is kept — quoted_total/quoted_at/quote_revision together describe only the latest issue.';


-- ── 4. catering_quote_sequences — atomic per-month counter ──────────────────
-- Not in your list, added because a COUNT(*)-based sequence has a race
-- condition: two quotes issued in the same YYMM at close to the same time
-- could compute the same "next" number before either INSERT commits. This
-- table sidesteps that: the generation step (next round, in actions.ts) does
--   INSERT INTO catering_quote_sequences (yymm, last_seq) VALUES ($1, 1)
--   ON CONFLICT (yymm) DO UPDATE SET last_seq = catering_quote_sequences.last_seq + 1
--   RETURNING last_seq;
-- which is a single atomic statement — Postgres's row lock on the conflicting
-- row serializes concurrent callers correctly.

CREATE TABLE IF NOT EXISTS public.catering_quote_sequences (
  yymm     TEXT PRIMARY KEY,   -- Buddhist YY + MM, e.g. '6908' for August 2569
  last_seq INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.catering_quote_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catering_quote_sequences_all" ON public.catering_quote_sequences;
CREATE POLICY "catering_quote_sequences_all" ON public.catering_quote_sequences FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'sales'));

COMMENT ON TABLE public.catering_quote_sequences IS
  'Internal counter only — no customer data, no prices. One row per Buddhist YYMM; last_seq is the last sequence number issued that month. Incremented atomically via INSERT ... ON CONFLICT DO UPDATE ... RETURNING, not read-then-write, to stay race-safe.';
