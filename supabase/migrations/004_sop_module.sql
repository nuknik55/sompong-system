-- ================================================================
-- Kitchen SOP module — migration 004
-- Run this in Supabase SQL Editor
-- ================================================================

-- ── 1. Tables ────────────────────────────────────────────────────

CREATE TABLE menu_sops (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id        UUID        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  author_name    TEXT,
  updated_at     DATE        NOT NULL DEFAULT CURRENT_DATE,
  demo_video_url TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_id)
);

CREATE TABLE menu_sop_ingredient_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id        UUID NOT NULL REFERENCES menu_sops(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  note          TEXT NOT NULL DEFAULT '',
  UNIQUE (sop_id, ingredient_id)
);

CREATE TABLE menu_sop_steps (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id     UUID    NOT NULL REFERENCES menu_sops(id) ON DELETE CASCADE,
  section    TEXT    NOT NULL CHECK (section IN ('prep', 'cook', 'plating', 'checklist')),
  sort_order INTEGER NOT NULL,
  text       TEXT    NOT NULL,
  photo_url  TEXT
);

CREATE INDEX menu_sop_steps_sop_id_section_sort
  ON menu_sop_steps (sop_id, section, sort_order);

-- ── 2. RLS ───────────────────────────────────────────────────────

ALTER TABLE menu_sops ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_sop_ingredient_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_sop_steps ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read SOP data (needed for staff player view)
CREATE POLICY "sop read all"
  ON menu_sops FOR SELECT TO authenticated USING (true);
CREATE POLICY "sop notes read all"
  ON menu_sop_ingredient_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "sop steps read all"
  ON menu_sop_steps FOR SELECT TO authenticated USING (true);

-- Write operations: auth check is enforced in server actions (requireOwner).
-- Policies permit any authenticated user at DB level so the server-side
-- session client (which runs as the logged-in user, not service role) can write.
CREATE POLICY "sop write auth"
  ON menu_sops FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sop notes write auth"
  ON menu_sop_ingredient_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sop steps write auth"
  ON menu_sop_steps FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Supabase Storage bucket ───────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sop-photos',
  'sop-photos',
  true,
  5242880,   -- 5 MB max (raw upload before client-side resize; resize targets ~300 KB)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read (photos served from CDN without auth)
CREATE POLICY "sop photos public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'sop-photos');

-- Authenticated users can upload
CREATE POLICY "sop photos auth upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sop-photos');

-- Authenticated users can update / replace
CREATE POLICY "sop photos auth update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sop-photos');

-- Authenticated users can delete
CREATE POLICY "sop photos auth delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sop-photos');
