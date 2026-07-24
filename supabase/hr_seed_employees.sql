-- ===================================================
-- HR Seed: Departments + Employees
-- Run AFTER hr_migration.sql AND hr_patch.sql
-- ===================================================

-- ─── Departments ─────────────────────────────────────────────────────────────
INSERT INTO public.departments (name, is_active) VALUES
  ('บริการ',         true),
  ('เดินอาหาร',      true),
  ('ขนมหวาน',        true),
  ('Host & Cashier', true),
  ('ครัวใหญ่',       true),
  ('ครัว Prep',      true),
  ('สจ๊วต',          true),
  ('บาร์น้ำ',        true),
  ('รับรถ',          true),
  ('ฝ่ายจัดการ',     true)
ON CONFLICT DO NOTHING;

-- ─── Employees ───────────────────────────────────────────────────────────────
INSERT INTO public.employees
  (employee_code, department_id, full_name, nickname, position,
   employment_type, weekly_day_off, hire_date, citizenship_type, is_active)
VALUES

-- ── บริการ ───────────────────────────────────────────────────────────────────
('SP-SV 01', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณอดิศักดิ์ กันทะมา',       'ต้อม',    'ที่ปรึกษา บริการ',       'full_time', 'จันทร์',    '2016-02-11', 'thai',    true),
('SP-SV 02', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณอลิษา เล้าประเสริฐ',      'เปา',     'กัปตัน',                'full_time', 'อังคาร',    '2012-04-14', 'thai',    true),
('SP-SV 03', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณนาฏยาภรณ์ ศรีปัญญา',     'วุ้น',    'กัปตัน',                'full_time', 'จันทร์',    '2014-04-01', 'thai',    true),
('SP-SV 04', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณทิศหมอน ลาซะสาน',        'นิกกี้',  'พนักงานเสิร์ฟ',          'full_time', 'จันทร์',    '2025-12-16', 'thai',    true),
('SP-SV 05', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณ TEKE ดาด้า',             'ดาด้า',   'พนักงานเสิร์ฟ',          'full_time', 'อังคาร',    '2025-12-01', 'foreign', true),
('SP-SV 07', (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณพริดา สุขสัมผัส',         'จุ๋ม',    'พนักงานเสิร์ฟ',          'part_time', 'พฤหัสบดี',  NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='บริการ'),          'คุณบัณฑิต',                  'จอย',     'พนักงานเสิร์ฟ',          'full_time', 'พุธ',       '2026-05-05', 'thai',    true),

-- ── เดินอาหาร ────────────────────────────────────────────────────────────────
('SP-FR 01', (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'คุณกิ่ง แก้วอาสา',           'กิ่ง',    'เดินอาหาร',             'full_time', 'จันทร์',    '2025-06-04', 'thai',    true),
('SP-FR 02', (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'น.ส.ปวีณา ป้อมทะเล',         'เมย์',    'เดินอาหาร',             'full_time', NULL,        NULL,         'thai',    true),
('SP-FR 03', (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'คุณน้อย',                    'น้อย',    'เดินอาหาร',             'full_time', 'พุธ',       '2026-05-26', 'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'นาย จักรพงษ์ เงินสมบัติ',   'เต๊ะ',    'เดินอาหาร',             'full_time', 'พุธ',       NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'คุณจรรยพร บุตรวงษ์',         'เดือน',   'Bus Boy',               'full_time', 'พุธ',       NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='เดินอาหาร'),       'น.ส.พัด สีหาวง',             'มะปราง',  'พนักงานเสิร์ฟ',          'full_time', NULL,        NULL,         'thai',    true),

-- ── ขนมหวาน ──────────────────────────────────────────────────────────────────
('SP-DS 01', (SELECT id FROM public.departments WHERE name='ขนมหวาน'),         'คุณนุสรีย์ พ่วงเจริญ',        'ป้านุช',  'ขนมหวาน',               'full_time', 'พฤหัสบดี',  '2016-02-11', 'thai',    true),

-- ── Host & Cashier ────────────────────────────────────────────────────────────
('SP-H/C 01',(SELECT id FROM public.departments WHERE name='Host & Cashier'),  'คุณเพ็ญแข สิงหฬ',            'เก๋',     'Host & Cashier',        'full_time', 'พุธ',       '2016-02-11', 'thai',    true),
('SP-H/C 02',(SELECT id FROM public.departments WHERE name='Host & Cashier'),  'นาย อดิศักดิ์ ศรีอนันต์',   'กานต์',   'Host & Cashier',        'full_time', NULL,        NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='Host & Cashier'),  'คุณเปิ้ล',                   'เปิ้ล',   'แคชเชียร์',              'full_time', 'จันทร์',    NULL,         'thai',    true),

-- ── ครัวใหญ่ ─────────────────────────────────────────────────────────────────
('SP-KC 02', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณเวชยันต์ สิงห์ทอง',       'เวช',     'ครัวใหญ่ (กระทะ 1)',     'full_time', 'พุธ',       '2014-04-01', 'thai',    true),
('SP-KC 03', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณสุเทพ อุดมผล',             'แหงน',    'ครัวใหญ่ (กระทะ 3)',     'full_time', 'อังคาร',    '2005-07-01', 'thai',    true),
('SP-KC 04', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณเลียง เสียวสวาท',          'กล้า',    'ครัวใหญ่ (เขียง)',       'full_time', 'พุธ',       '2017-06-16', 'foreign', true),
('SP-KC 05', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Chit',                   'ชายเล็ก', 'ครัวใหญ่ (เขียง)',       'full_time', 'พฤหัสบดี',  '2023-09-01', 'foreign', true),
('SP-KC 06', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณมิว (ครัว)',               'มิว',     'ครัวทอด',               'full_time', 'อังคาร',    '2025-01-01', 'foreign', true),
('SP-KC 07', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณราณี ราชาธิราช',           'ป้าณี',   'เช็คเกอร์',              'full_time', 'พุธ',       '2003-05-02', 'thai',    true),
('SP-KC 08', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Myat Shwe Zin',          'มีญ่า',   'ครัวข้าว + มูนเหนียว',  'full_time', 'พฤหัสบดี',  '2024-04-01', 'foreign', true),
('SP-KC 09', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Aye Chin Myint Moore',   'เอ',      'ครัว ยำ',               'full_time', 'อังคาร',    '2025-04-16', 'foreign', true),
('SP-KC 10', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Sa Naing Zaw Linn',      'ไนซ์',    'ครัวทอด',               'full_time', 'จันทร์',    '2025-10-01', 'foreign', true),
('SP-KC 11', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'นาย Su Badu',                'ซุป',     'ครัวเผา',               'full_time', 'พุธ',       '2026-06-16', 'foreign', true),
('SP-KC 12', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Saw Sunny Tun',          'ไม้',     'ครัวเผา',               'full_time', 'พุธ',       '2017-04-09', 'foreign', true),
('SP-KC 13', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณ Sa Khant Htee Khlaing', 'คาน',     'ครัวเผา',               'full_time', 'พฤหัสบดี',  '2026-03-22', 'foreign', true),
('SP-KC 14', (SELECT id FROM public.departments WHERE name='ครัวใหญ่'),        'คุณต้า',                     'ต้า',     'ครัวทอด',               'full_time', 'พุธ',       '2023-05-01', 'thai',    false),

-- ── ครัว Prep ────────────────────────────────────────────────────────────────
('SP-PP 01', (SELECT id FROM public.departments WHERE name='ครัว Prep'),       'คุณอุทัยวรรณ โพธิ์แสงทอง',  'ป้าปุ๊',  'ครัว ยำ',               'full_time', 'จันทร์',    '2025-05-16', 'thai',    true),
('SP-PP 02', (SELECT id FROM public.departments WHERE name='ครัว Prep'),       'คุณ Saw Htet',               'แท็ช',    'ครัว Prep',             'full_time', 'อังคาร',    '2026-06-16', 'foreign', true),
('SP-PP 04', (SELECT id FROM public.departments WHERE name='ครัว Prep'),       'คุณสุรัตน์',                 'สุรัตน์', 'ครัว Prep',             'full_time', 'จันทร์',    NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='ครัว Prep'),       'คุณแวว',                     'แวว',     NULL,                    'full_time', 'จันทร์',    NULL,         'thai',    true),

-- ── สจ๊วต ────────────────────────────────────────────────────────────────────
('SP-ST 02', (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณ Aung MYO',               'มิว',     'สจ๊วต - ล้างจาน',       'full_time', 'อังคาร',    NULL,         'foreign', true),
('SP-ST 03', (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณ KAUNG BA',               'เกา',     'สจ๊วต - ล้างจาน',       'full_time', 'พฤหัสบดี',  '2026-01-07', 'foreign', true),
('SP-ST 05', (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณ Khankham Dengloy',       'คำแก้ว',  'สจ๊วต - ล้างจาน',       'full_time', 'พุธ',       '2026-01-29', 'foreign', true),
('SP-ST 06', (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณยุคล รอดจันทร์',           'ป้าขาว',  'สจ๊วต - ล้างจาน',       'part_time', 'พฤหัสบดี',  NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณเวย์',                    'เวย์',    NULL,                    'full_time', 'จันทร์',    NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='สจ๊วต'),           'คุณนาง',                     'นาง',     NULL,                    'full_time', 'จันทร์',    NULL,         'thai',    true),

-- ── บาร์น้ำ ──────────────────────────────────────────────────────────────────
('SP-BV 01', (SELECT id FROM public.departments WHERE name='บาร์น้ำ'),         'คุณ Naw Lar Mue',            'แก้ว',    'หัวหน้า บาร์น้ำ',        'full_time', 'จันทร์',    NULL,         'foreign', true),
('SP-BV 03', (SELECT id FROM public.departments WHERE name='บาร์น้ำ'),         'น.ส. ซา นิ อู',              'ดา',      'สจ๊วต - ล้างแก้ว',      'full_time', 'พุธ',       NULL,         'foreign', true),

-- ── รับรถ ────────────────────────────────────────────────────────────────────
('SP-VP 01', (SELECT id FROM public.departments WHERE name='รับรถ'),           'คุณ Saw Naing Aye',          'ไนน์',    'รับรถ',                 'full_time', 'พุธ',       '2026-04-04', 'foreign', true),

-- ── ฝ่ายจัดการ ───────────────────────────────────────────────────────────────
(NULL,        (SELECT id FROM public.departments WHERE name='ฝ่ายจัดการ'),     'คุณนัฎ เพิ่มภักดีสกุล',      'เฮง',     'ผู้จัดการ ฝ่ายครัว',    'full_time', 'พฤหัสบดี',  NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='ฝ่ายจัดการ'),     'คุณชาลิตา ชาปัญญา',          'เบ้',     'ผู้จัดการ ฝ่ายบริการ',  'full_time', 'อังคาร',    NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='ฝ่ายจัดการ'),     'คุณพรเพ็ญ เกียรติวีระกุล',  'เล็ก',    'HR',                    'full_time', 'อาทิตย์',   NULL,         'thai',    true),
(NULL,        (SELECT id FROM public.departments WHERE name='ฝ่ายจัดการ'),     'คุณแม็ก',                    'แม็ก',    'ผู้ช่วยจัดซื้อ & ขับรถ', 'full_time', 'จันทร์',    NULL,         'thai',    true)

ON CONFLICT (employee_code) WHERE employee_code IS NOT NULL DO NOTHING;
