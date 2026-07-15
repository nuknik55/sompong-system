-- ===================================================
-- Accounting Module Migration
-- Run this in Supabase SQL Editor
-- ===================================================

-- 1. Chart of Accounts
CREATE TABLE IF NOT EXISTS public.coa (
  code         TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  group_code   TEXT,
  group_name   TEXT,
  target_pct   NUMERIC,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.coa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coa_select" ON public.coa;
DROP POLICY IF EXISTS "coa_all"    ON public.coa;

CREATE POLICY "coa_select" ON public.coa FOR SELECT TO authenticated USING (true);
CREATE POLICY "coa_all"    ON public.coa FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- 2. Monthly Revenue
CREATE TABLE IF NOT EXISTS public.monthly_revenue (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month   TEXT    NOT NULL,
  revenue_type TEXT    NOT NULL CHECK (revenue_type IN ('food','drink','dessert','delivery','other')),
  amount       NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (year_month, revenue_type)
);

ALTER TABLE public.monthly_revenue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "revenue_select" ON public.monthly_revenue;
DROP POLICY IF EXISTS "revenue_all"    ON public.monthly_revenue;

CREATE POLICY "revenue_select" ON public.monthly_revenue FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "revenue_all"    ON public.monthly_revenue FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- 3. Expense Entries
CREATE TABLE IF NOT EXISTS public.expense_entries (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date     DATE        NOT NULL,
  coa_code       TEXT        NOT NULL REFERENCES public.coa(code),
  amount         NUMERIC     NOT NULL,
  note           TEXT,
  payment_method TEXT        NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','transfer')),
  created_by     UUID        REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_entries_month ON public.expense_entries (to_char(entry_date,'YYYY-MM'));
CREATE INDEX IF NOT EXISTS idx_expense_entries_coa   ON public.expense_entries (coa_code);
CREATE INDEX IF NOT EXISTS idx_expense_entries_date  ON public.expense_entries (entry_date DESC);

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_select" ON public.expense_entries;
DROP POLICY IF EXISTS "expense_all"    ON public.expense_entries;

CREATE POLICY "expense_select" ON public.expense_entries FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "expense_all"    ON public.expense_entries FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ===================================================
-- COA Seed Data
-- ===================================================

INSERT INTO public.coa (code, name, group_code, group_name, target_pct, sort_order, is_sensitive) VALUES
-- ── Group 100: COGS ─────────────────────────────────
('G100','ต้นทุนวัตถุดิบ (COGS)',        NULL,   NULL,                      38,   100, false),
('110', 'ผักสด',                          'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 110, false),
('120', 'ของสด',                          'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 120, false),
('130', 'ของแห้ง',                        'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 130, false),
('140', 'ข้าวสาร',                        'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 140, false),
('145', 'น้ำมันพืช',                      'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 145, false),
('148', 'วัตถุดิบอื่นๆ',                  'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 148, false),
('150', 'มะม่วง',                         'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 150, false),
('151', 'กะทิ (ข้าวเหนียวมะม่วง)',        'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 151, false),
('152', 'ถั่วเหลือง',                     'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 152, false),
('153', 'ข้าวเหนียวสาร',                  'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 153, false),
('160', 'เครื่องดื่ม (ต้นทุน)',           'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 160, false),
('161', 'น้ำแข็ง',                        'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 161, false),
('170', 'ค่าขนส่งวัตถุดิบ',              'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 170, false),
('171', 'วัสดุหีบห่อ-กล่องใส่อาหาร',    'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 171, false),
('172', 'วัสดุหีบห่อ-ถุงซีล',            'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 172, false),
('173', 'ผลไม้+ขนม (งานนอก)',             'G100','ต้นทุนวัตถุดิบ (COGS)',  NULL, 173, false),

-- ── Group 200: Labor ────────────────────────────────
('G200','ต้นทุนแรงงาน (Labor)',          NULL,   NULL,                      20,   200, false),
('210', 'ค่าแรง Part-time (บริการ)',      'G200','ต้นทุนแรงงาน (Labor)',   NULL, 210, false),
('211', 'ค่าแรง Part-time (ครัว)',        'G200','ต้นทุนแรงงาน (Labor)',   NULL, 211, false),
('212', 'ค่าแรง Part-time (รับรถ)',       'G200','ต้นทุนแรงงาน (Labor)',   NULL, 212, false),
('213', 'ค่าแรง Part-time (แม่บ้าน)',    'G200','ต้นทุนแรงงาน (Labor)',   NULL, 213, false),
('214', 'ค่าอาหาร Part-time',            'G200','ต้นทุนแรงงาน (Labor)',   NULL, 214, false),
('215', 'ค่าแรงพิเศษ/ออกงานนอก',        'G200','ต้นทุนแรงงาน (Labor)',   NULL, 215, false),
('216', 'ค่าอาหารพนักงานงานนอก',        'G200','ต้นทุนแรงงาน (Labor)',   NULL, 216, false),
('220', 'เงินเดือนพนักงาน',              'G200','ต้นทุนแรงงาน (Labor)',   NULL, 220, false),
('221', 'ค่าอาหารพนักงาน',              'G200','ต้นทุนแรงงาน (Labor)',   NULL, 221, false),
('222', 'ค่าเชียร์อาหาร',               'G200','ต้นทุนแรงงาน (Labor)',   NULL, 222, false),
('230', 'ประกันสังคม',                   'G200','ต้นทุนแรงงาน (Labor)',   NULL, 230, false),
('231', 'กองทุนเงินประกันสังคม',         'G200','ต้นทุนแรงงาน (Labor)',   NULL, 231, false),
('240', 'สวัสดิการอื่นๆ',               'G200','ต้นทุนแรงงาน (Labor)',   NULL, 240, false),

-- ── Group 300: Occupancy ────────────────────────────
('G300','ค่าเช่า (Occupancy)',            NULL,   NULL,                      8,    300, false),
('310', 'ค่าเช่าที่ดิน',                'G300','ค่าเช่า (Occupancy)',      NULL, 310, false),
('320', 'ค่าโทรศัพท์+อินเทอร์เน็ต',    'G300','ค่าเช่า (Occupancy)',      NULL, 320, false),
('330', 'ค่าเช่าเครื่องทำน้ำแข็ง',      'G300','ค่าเช่า (Occupancy)',      NULL, 330, false),
('340', 'ค่าเช่าอื่นๆ',                 'G300','ค่าเช่า (Occupancy)',      NULL, 340, false),
('350', 'ค่าเบี้ยประกัน',               'G300','ค่าเช่า (Occupancy)',      NULL, 350, false),
('360', 'ค่าธรรมเนียม/ใบอนุญาต',        'G300','ค่าเช่า (Occupancy)',      NULL, 360, false),
('370', 'ค่ายาม',                        'G300','ค่าเช่า (Occupancy)',      NULL, 370, false),

-- ── Group 400: Maintenance ──────────────────────────
('G400','ซ่อมบำรุง (Maintenance)',       NULL,   NULL,                      1.5,  400, false),
('410', 'ค่าอุปกรณ์ซ่อม',              'G400','ซ่อมบำรุง (Maintenance)',  NULL, 410, false),
('420', 'ซ่อมบำรุงทั่วไป',             'G400','ซ่อมบำรุง (Maintenance)',  NULL, 420, false),
('430', 'ซื้อของเพื่อทดแทน',           'G400','ซ่อมบำรุง (Maintenance)',  NULL, 430, false),
('440', 'ค่าล้างท่อปล่องควัน',         'G400','ซ่อมบำรุง (Maintenance)',  NULL, 440, false),
('450', 'ล้างแอร์',                     'G400','ซ่อมบำรุง (Maintenance)',  NULL, 450, false),
('460', 'ฉีดปลวก',                      'G400','ซ่อมบำรุง (Maintenance)',  NULL, 460, false),
('470', 'ดูแลต้นไม้',                   'G400','ซ่อมบำรุง (Maintenance)',  NULL, 470, false),
('480', 'ค่าอุปกรณ์สิ้นเปลือง (Maint.)','G400','ซ่อมบำรุง (Maintenance)', NULL, 480, false),

-- ── Group 500: Utilities ────────────────────────────
('G500','สาธารณูปโภค (Utilities)',       NULL,   NULL,                      3.5,  500, false),
('510', 'ค่าแก๊ส',                      'G500','สาธารณูปโภค (Utilities)', NULL, 510, false),
('515', 'ถ่านครัว',                     'G500','สาธารณูปโภค (Utilities)', NULL, 515, false),
('520', 'ค่าไฟ',                        'G500','สาธารณูปโภค (Utilities)', NULL, 520, false),
('530', 'ค่าน้ำประปา',                  'G500','สาธารณูปโภค (Utilities)', NULL, 530, false),
('540', 'ค่าเก็บขยะ',                   'G500','สาธารณูปโภค (Utilities)', NULL, 540, false),

-- ── Group 600: Marketing ────────────────────────────
('G600','การตลาด (Marketing)',            NULL,   NULL,                      5,    600, false),
('610', 'ค่าโฆษณา/สิ่งพิมพ์',          'G600','การตลาด (Marketing)',      NULL, 610, false),
('620', 'ค่าจ้าง Mkt',                  'G600','การตลาด (Marketing)',      NULL, 620, false),
('630', 'Variable MKT (ของแจก/ads)',     'G600','การตลาด (Marketing)',      NULL, 630, false),
('640', 'Hato CRM / LINE OA',            'G600','การตลาด (Marketing)',      NULL, 640, false),
('650', 'ส่วนลด (Discount)',             'G600','การตลาด (Marketing)',      NULL, 650, false),

-- ── Group 700: G&A ──────────────────────────────────
('G700','บริหาร (G&A)',                  NULL,   NULL,                      2,    700, false),
('710', 'ค่าทำบัญชี',                   'G700','บริหาร (G&A)',             NULL, 710, false),
('720', 'Promise System',                'G700','บริหาร (G&A)',             NULL, 720, false),
('730', 'ของไหว้+ทำบุญ/สังฆภัณฑ์',     'G700','บริหาร (G&A)',             NULL, 730, false),
('740', 'การกุศล',                       'G700','บริหาร (G&A)',             NULL, 740, false),
('745', 'หัก % บัตรเครดิต',             'G700','บริหาร (G&A)',             NULL, 745, false),
('760', 'ค่าใช้จ่ายยานพาหนะ',           'G700','บริหาร (G&A)',             NULL, 760, false),
('770', 'ค่าบริการอื่นๆ (ที่ปรึกษา)',   'G700','บริหาร (G&A)',             NULL, 770, false),
('780', 'ค่าเครื่องเขียน/R&D',          'G700','บริหาร (G&A)',             NULL, 780, false),
('790', 'เงินเดือนเจ้าของร้าน',         'G700','บริหาร (G&A)',             NULL, 790, true),

-- ── Group 750: Delivery & GP ────────────────────────
('G750','Delivery & GP',                  NULL,   NULL,                      2,    750, false),
('751', 'ค่าขนส่ง (ส่งลูกค้า)',          'G750','Delivery & GP',           NULL, 751, false),
('752', 'ค่า GP Lineman',                'G750','Delivery & GP',           NULL, 752, false),
('753', 'ค่า GP Grab',                   'G750','Delivery & GP',           NULL, 753, false),
('754', 'ค่า GP Foodpanda',              'G750','Delivery & GP',           NULL, 754, false),
('759', 'ค่า GP อื่นๆ',                 'G750','Delivery & GP',           NULL, 759, false),

-- ── Group 800: Supply ───────────────────────────────
('G800','อุปกรณ์ (Supply)',               NULL,   NULL,                      1.5,  800, false),
('810', 'Supply - ครัว',                 'G800','อุปกรณ์ (Supply)',        NULL, 810, false),
('815', 'ของใช้สิ้นเปลือง - ครัว',      'G800','อุปกรณ์ (Supply)',        NULL, 815, false),
('820', 'Supply - บริการ',              'G800','อุปกรณ์ (Supply)',        NULL, 820, false),
('825', 'ของใช้สิ้นเปลือง - บริการ',    'G800','อุปกรณ์ (Supply)',        NULL, 825, false),
('830', 'Supply - บาร์น้ำ',             'G800','อุปกรณ์ (Supply)',        NULL, 830, false),
('840', 'Supply - แม่บ้าน',             'G800','อุปกรณ์ (Supply)',        NULL, 840, false),
('850', 'Supply - ซ่อมบำรุง',           'G800','อุปกรณ์ (Supply)',        NULL, 850, false),
('860', 'Supply - ส่วนกลาง',            'G800','อุปกรณ์ (Supply)',        NULL, 860, false),
('870', 'Supply - Catering',             'G800','อุปกรณ์ (Supply)',        NULL, 870, false),
('880', 'Supply - อื่นๆ',               'G800','อุปกรณ์ (Supply)',        NULL, 880, false),

-- ── Group 900: Misc ─────────────────────────────────
('G900','อื่นๆ (Misc)',                  NULL,   NULL,                      1,    900, false),
('910', 'ค่าใช้จ่ายทั่วไป',            'G900','อื่นๆ (Misc)',             NULL, 910, false),
('920', 'ค่าใช้จ่ายจากเซฟ',            'G900','อื่นๆ (Misc)',             NULL, 920, false),
('930', 'เช่าอุปกรณ์จัดเลี้ยง/งานนอก','G900','อื่นๆ (Misc)',             NULL, 930, false),

-- ── Group 950: Tax ──────────────────────────────────
('G950','ภาษี (Tax)',                    NULL,   NULL,                      1,    950, false),
('951', 'ค่า ภพ.30',                    'G950','ภาษี (Tax)',               NULL, 951, false),
('952', 'ค่า ภงด.1,3,53',              'G950','ภาษี (Tax)',               NULL, 952, false),
('953', 'ภาษีป้าย',                     'G950','ภาษี (Tax)',               NULL, 953, false),
('954', 'ภาษีที่ดิน',                   'G950','ภาษี (Tax)',               NULL, 954, false),
('955', 'สรรพสามิตร',                   'G950','ภาษี (Tax)',               NULL, 955, false),
('959', 'ค่าภาษีอื่นๆ',               'G950','ภาษี (Tax)',               NULL, 959, false),

-- ── Group 990: CapEx ────────────────────────────────
('G990','CapEx',                          NULL,   NULL,                      NULL, 990, false),
('991', 'วัสดุอุปกรณ์ก่อสร้าง',        'G990','CapEx',                    NULL, 991, false),
('992', 'Asset Replacement - ครัว',      'G990','CapEx',                    NULL, 992, false),
('993', 'Asset Replacement - บริการ',    'G990','CapEx',                    NULL, 993, false),
('994', 'Asset Replacement - ทั่วไป',    'G990','CapEx',                    NULL, 994, false),
('995', 'Renovation',                     'G990','CapEx',                    NULL, 995, false)

ON CONFLICT (code) DO NOTHING;
