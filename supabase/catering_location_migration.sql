-- ============================================================================
-- Catering module — location/venue restructure + customer + created_by
-- ============================================================================
-- Run once in the Supabase SQL editor, after catering_migration.sql.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS
-- throughout). ALTER TABLE only, against the live catering_events /
-- catering_customers tables — no new tables.
--
-- Does NOT assume catering_events is still empty: the booking page has been
-- live since commit 1ffbdc6, so the location_type backfill below reads each
-- row's existing venue value instead of assuming every row is in-house —
-- any real 'offsite' booking already entered lands correctly.
-- ============================================================================


-- ── 1. location_type first, venue narrowed to in-house only ────────────────
-- in-house vs off-site are genuinely different shapes (a room pick vs an
-- address + distance), so location_type becomes its own column and is asked
-- first in the form. venue keeps its existing room values but drops
-- 'offsite' and is no longer required — an offsite booking has no venue.

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS location_type TEXT;

-- Backfill from the existing venue value before venue is narrowed, so any
-- offsite row already in the table gets location_type = 'offsite' instead
-- of being silently mis-tagged 'in_house'.
UPDATE public.catering_events
   SET location_type = CASE WHEN venue = 'offsite' THEN 'offsite' ELSE 'in_house' END
 WHERE location_type IS NULL;

-- An offsite row can't carry a venue value once venue is narrowed below —
-- clear it first.
UPDATE public.catering_events SET venue = NULL WHERE venue = 'offsite';

ALTER TABLE public.catering_events ALTER COLUMN location_type SET NOT NULL;

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_location_type_check;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_location_type_check
  CHECK (location_type IN ('in_house', 'offsite'));

ALTER TABLE public.catering_events ALTER COLUMN venue DROP NOT NULL;

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_venue_check;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_venue_check
  CHECK (venue IS NULL OR venue IN ('air_shared', 'room_v1', 'room_v2', 'room_v1_v2'));

-- Not explicitly requested, but follows directly from keeping "venue for
-- in-house only": without this, an in_house row could silently save with no
-- room, or an offsite row could carry a stale venue. Drop this constraint if
-- you'd rather allow that during early data entry.
ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_location_venue_consistency;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_location_venue_consistency
  CHECK ((location_type = 'in_house' AND venue IS NOT NULL)
      OR (location_type = 'offsite'  AND venue IS NULL));


-- ── 2. room_portion — room_v1 / room_v2 only, individually ──────────────────
-- Confirmed: half/full applies per-room to room_v1 and room_v2, never to
-- air_shared (no partition) or room_v1_v2 (both rooms already combined).

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS room_portion TEXT;

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_room_portion_check;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_room_portion_check
  CHECK (room_portion IS NULL OR (room_portion IN ('half', 'full') AND venue IN ('room_v1', 'room_v2')));


-- ── 3. off-site details ──────────────────────────────────────────────────────
-- Not forced NOT NULL for offsite rows — an inquiry-stage booking can be
-- offsite before the exact address is known, same as guest_count/table_count
-- staying loose until confirmed.

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS offsite_address TEXT;
ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS offsite_distance_km NUMERIC;
ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS floor_level NUMERIC;   -- NUMERIC to match table_count/guest_count's house style


-- ── 4. music ─────────────────────────────────────────────────────────────────

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS music_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS music_note TEXT;

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_music_type_check;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_music_type_check
  CHECK (music_type IN ('none', 'karaoke_shop', 'own_band', 'other'));


-- ── 5. food_format: add box_set (อาหารกล่อง) ─────────────────────────────────

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_food_format_check;
ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_food_format_check
  CHECK (food_format IN ('chinese_table', 'buffet', 'a_la_carte', 'set_menu', 'box_set'));


-- ── 6. created_by ─────────────────────────────────────────────────────────────
-- profiles and employees are unconnected tables (verified: no FK either
-- direction anywhere in supabase/*.sql). profiles.full_name is the display
-- name. created_by follows the existing "who did this" pattern already used
-- twice in this codebase — expense_entries.created_by and
-- leave_requests.approved_by, both UUID REFERENCES public.profiles(id), both
-- set from the server action's own requireXxx() result, never a DB default
-- and never a dropdown. created_by must be set the same way: profile.id from
-- requireSales(), in upsertCateringEvent, only on create.

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);
CREATE INDEX IF NOT EXISTS idx_catering_events_created_by ON public.catering_events(created_by);


-- ── 7. catering_customers: quotation-form fields ────────────────────────────

ALTER TABLE public.catering_customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.catering_customers ADD COLUMN IF NOT EXISTS contact_person TEXT;


-- ── Column documentation ────────────────────────────────────────────────────

COMMENT ON COLUMN public.catering_events.location_type IS
  'Asked first in the form. in_house keeps using venue for which room; offsite clears venue and uses offsite_address / offsite_distance_km / floor_level instead.';
COMMENT ON COLUMN public.catering_events.venue IS
  'Room choice for in_house bookings only. NULL when location_type = offsite (see catering_events_location_venue_consistency).';
COMMENT ON COLUMN public.catering_events.room_portion IS
  'half/full partition of room_v1 or room_v2 individually. NULL for air_shared (no partition) and room_v1_v2 (both rooms already combined). Enforced by catering_events_room_portion_check.';
COMMENT ON COLUMN public.catering_events.floor_level IS
  'Offsite only. Terms charge extra for 2nd floor and above; stored as the raw floor number so the surcharge bracket lives in code, not the schema.';
COMMENT ON COLUMN public.catering_events.music_type IS
  'Drives both the charge line (karaoke_shop / own_band price separately) and the setup checklist. music_note carries the free-text detail (which shop, band size, etc).';
COMMENT ON COLUMN public.catering_events.created_by IS
  'Set once from requireSales()''s profile.id when the event is first created — never a dropdown, never derived from employees (profiles and employees have no FK link). NOTE: profiles RLS (profiles_select_own) only lets a user read their own profile row, so rendering "created by <name>" for events taken by someone else will need a name-only view or a loosened profiles policy, same fix already used for catering_staff_options. Not solved here.';

COMMENT ON COLUMN public.catering_customers.address IS
  'Customer/company address. Also the likely prefill source for offsite_address on new bookings once the form is built.';
COMMENT ON COLUMN public.catering_customers.contact_person IS
  'The person to call, when different from name (e.g. name is the company). name stays the primary display value on the customer record either way.';
