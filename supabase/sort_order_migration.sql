-- ===================================================
-- Sort Order & Department Migration
-- Run this in Supabase SQL Editor
-- ===================================================

-- 0. Fix leave_requests date_to bug (timezone issue from import script)
UPDATE leave_requests
SET date_to = date_from
WHERE date_to < date_from;

-- 1. Add sort_order to departments
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 999;

-- 2. Add sort_order to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 999;

-- 3. Insert/update departments with sort_order
INSERT INTO departments (name, is_active, sort_order) VALUES
  ('บริการ',  true, 10),
  ('บาร์',    true, 20),
  ('ขนม',     true, 30),
  ('ครัว',    true, 40),
  ('ซุป',     true, 50),
  ('แม่บ้าน', true, 60),
  ('ครัวทอด', true, 70),
  ('สจ๊วต',  true, 80),
  ('Prep',    true, 90),
  ('รับรถ',   true, 100)
ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order, is_active = true;

-- 4. Update employees department + sort_order by nickname
-- (ใช้ CTE เพื่อ join department name → id)

WITH assignments (nickname_match, dept_name, emp_sort) AS (VALUES
  -- บริการ
  ('ต้อม',    'บริการ',  10),
  ('เปา',     'บริการ',  20),
  ('วุ้น',    'บริการ',  30),
  ('ดาด้า',   'บริการ',  40),
  ('จอย',     'บริการ',  50),
  ('นิกกี้',  'บริการ',  60),
  ('จุ๋ม',    'บริการ',  70),
  ('กิ่ง',    'บริการ',  80),
  ('เก๋',     'บริการ',  90),
  ('กานต์',   'บริการ', 100),
  ('เมย์',    'บริการ', 110),
  ('น้อย',    'บริการ', 120),
  -- บาร์
  ('จูเนียร์','บาร์',    10),
  ('ดา',      'บาร์',    20),
  -- ขนม
  ('ป้านุช',  'ขนม',     10),
  ('เวย์',    'ขนม',     20),
  ('นาง',     'ขนม',     30),
  -- ครัว
  ('วินัย',   'ครัว',    10),
  ('เวช',     'ครัว',    20),
  ('แหงน',    'ครัว',    30),
  ('รานี',    'ครัว',    40),
  ('กล้า',    'ครัว',    50),
  ('ไม้',     'ครัว',    60),
  ('ชายเล็ก', 'ครัว',    70),
  ('เอ',      'ครัว',    90),
  ('Miya',    'ครัว',   100),
  ('ป้าปุ๊',  'ครัว',   110),
  ('เซ็ง',    'ครัว',   120),
  ('แท็ช',    'ครัว',   130),
  ('ไนซ์',    'ครัว',   140),
  -- ซุป
  ('ซุป',     'ซุป',     10),
  -- แม่บ้าน
  ('พริ',     'แม่บ้าน', 20),
  ('เกา',     'แม่บ้าน', 30),
  ('คำแก้ว',  'แม่บ้าน', 40),
  -- ครัวทอด
  ('คาน',     'ครัวทอด', 10),
  -- สจ๊วต
  ('พี่ศรี',  'สจ๊วต',   10),
  -- Prep
  ('สุรัตน์', 'Prep',    10),
  ('แวว',     'Prep',    20),
  -- รับรถ
  ('ไนน์',    'รับรถ',   10)
)
UPDATE employees e
SET
  department_id = d.id,
  sort_order    = a.emp_sort
FROM assignments a
JOIN departments d ON d.name = a.dept_name
WHERE e.nickname = a.nickname_match
  AND e.is_active = true;

-- 5. Handle the two employees named มิว separately (by full_name)
-- มิว ทอด → ครัว (sort_order = 80)
UPDATE employees
SET department_id = (SELECT id FROM departments WHERE name = 'ครัว'),
    sort_order = 80
WHERE nickname = 'มิว'
  AND (full_name ILIKE '%ทอด%' OR position ILIKE '%ทอด%')
  AND is_active = true;

-- มิว Aung → แม่บ้าน (sort_order = 10)
UPDATE employees
SET department_id = (SELECT id FROM departments WHERE name = 'แม่บ้าน'),
    sort_order = 10
WHERE nickname = 'มิว'
  AND (full_name ILIKE '%Aung%' OR full_name ILIKE '%เอ%')
  AND is_active = true;

-- 6. Handle Zarni/ดา in บาร์ (nickname อาจเป็น Zarni หรือ ดา)
UPDATE employees
SET department_id = (SELECT id FROM departments WHERE name = 'บาร์'),
    sort_order = 20
WHERE (nickname ILIKE '%Zarni%' OR nickname ILIKE '%ดา%')
  AND is_active = true
  AND department_id IS DISTINCT FROM (SELECT id FROM departments WHERE name = 'บาร์');

-- 7. ป้านุช / นุช
UPDATE employees
SET department_id = (SELECT id FROM departments WHERE name = 'ขนม'),
    sort_order = 10
WHERE (nickname ILIKE '%นุช%' OR nickname = 'ป้านุช')
  AND is_active = true
  AND sort_order = 999;

-- 8. Saw Naing Aye / ไนน์
UPDATE employees
SET department_id = (SELECT id FROM departments WHERE name = 'รับรถ'),
    sort_order = 10
WHERE (nickname ILIKE '%ไนน์%' OR full_name ILIKE '%Saw Naing%')
  AND is_active = true
  AND sort_order = 999;

-- Check results
SELECT d.name as dept, d.sort_order as d_order, e.nickname, e.sort_order as e_order
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
WHERE e.is_active = true
ORDER BY d.sort_order NULLS LAST, e.sort_order;
