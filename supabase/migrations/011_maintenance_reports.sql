-- Maintenance / repair report system
CREATE TABLE maintenance_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    UUID        NOT NULL REFERENCES auth.users(id),
  reporter_name  TEXT        NOT NULL DEFAULT '',
  category       TEXT        NOT NULL DEFAULT 'อื่นๆ',
  location       TEXT        NOT NULL DEFAULT '',
  description    TEXT        NOT NULL DEFAULT '',
  is_urgent      BOOLEAN     NOT NULL DEFAULT FALSE,
  photo_before   TEXT,
  photo_after    TEXT,
  status         TEXT        NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  resolver_id    UUID        REFERENCES auth.users(id),
  resolver_note  TEXT
);

ALTER TABLE maintenance_reports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read all reports
CREATE POLICY "maint_read" ON maintenance_reports
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can create a report (as themselves)
CREATE POLICY "maint_insert" ON maintenance_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Only editor / admin / owner can update status
CREATE POLICY "maint_update" ON maintenance_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin', 'editor')
    )
  );
