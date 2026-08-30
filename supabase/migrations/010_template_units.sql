-- Add kitchen and freezer unit columns to station_ingredients template
ALTER TABLE station_ingredients ADD COLUMN IF NOT EXISTS kitchen_unit TEXT;
ALTER TABLE station_ingredients ADD COLUMN IF NOT EXISTS freezer_unit TEXT;

-- Rename station ครัวใหญ่ → ครัว
UPDATE stations SET name = 'ครัว' WHERE name = 'ครัวใหญ่';
