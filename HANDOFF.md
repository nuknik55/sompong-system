# Restaurant Cost Control — Session Handoff

**วันที่อัปเดต:** 2026-06-30  
**Project path:** `D:\Claud Code\restaurant-cost-system\app`  
**Next.js version:** 16.2.9 (App Router, Turbopack)

---

## 1. โครงสร้างโปรเจกต์

```
D:\Claud Code\restaurant-cost-system\
└── app/                          ← Next.js root (cd here ก่อน npm run dev)
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx          ← redirect → /staff
    │   │   ├── layout.tsx        ← root layout (color-scheme: light fix อยู่ที่นี่)
    │   │   ├── login/
    │   │   │   ├── page.tsx
    │   │   │   └── actions.ts    ← signIn ใช้ toAuthEmail()
    │   │   ├── staff/
    │   │   │   ├── page.tsx      ← รายการเมนูทั้งหมด + สร้างเมนูใหม่
    │   │   │   ├── layout.tsx
    │   │   │   ├── actions.ts    ← saveRecipeItems, getRecipeHistory
    │   │   │   ├── menu/
    │   │   │   │   ├── [id]/page.tsx   ← recipe editor สำหรับเมนู
    │   │   │   │   └── actions.ts      ← createMenu, duplicateMenu, deleteMenu, updateMenuSellingPrice
    │   │   │   └── prep/
    │   │   │       ├── [id]/page.tsx   ← recipe editor สำหรับของเตรียม
    │   │   │       └── actions.ts      ← createPrep, duplicatePrep, updatePrepYield
    │   │   └── owner/
    │   │       ├── page.tsx            ← Dashboard: summary cards + chart + table
    │   │       ├── layout.tsx
    │   │       ├── sales-import-actions.ts   ← previewPosSalesImport, applyPosSalesImport, upsertPosSalesAlias, deletePosSalesAlias, listPosSalesAliases
    │   │       ├── settings/actions.ts        ← updateQFactor
    │   │       ├── team/
    │   │       │   ├── page.tsx
    │   │       │   └── actions.ts    ← createUser, updateUserDetails, updateUserRole, deleteUser
    │   │       └── ingredients/
    │   │           ├── page.tsx      ← จัดการวัตถุดิบ + ของเตรียม + POS import ราคา
    │   │           ├── actions.ts    ← updateIngredientPrice, listPriceHistory, listIngredientUsage
    │   │           └── pos-import-actions.ts  ← previewPosImport, applyPosImport
    │   ├── components/
    │   │   ├── recipe-editor.tsx          ← editor หลัก (staff ใช้)
    │   │   ├── ingredient-combobox.tsx    ← dropdown ค้นหาวัตถุดิบ
    │   │   ├── menu-engineering-chart.tsx ← Recharts scatter chart
    │   │   ├── menu-engineering-table.tsx ← sortable table
    │   │   ├── pos-sales-import.tsx       ← upload + preview + alias tool
    │   │   ├── pos-price-import.tsx       ← upload + preview ราคาวัตถุดิบ
    │   │   ├── ingredient-manager.tsx     ← จัดการวัตถุดิบ/ราคา/ประวัติ/usage
    │   │   ├── team-manager.tsx           ← จัดการ user
    │   │   ├── q-factor-setting.tsx       ← ปรับ Q-factor %
    │   │   ├── prep-yield-editor.tsx      ← แก้ batch yield ของของเตรียม
    │   │   ├── recipe-history.tsx         ← ประวัติการแก้สูตร
    │   │   ├── category-filter-list.tsx   ← list พร้อม search + filter หมวด
    │   │   ├── create-recipe-form.tsx     ← ฟอร์ม create new เมนู/prep
    │   │   ├── duplicate-button.tsx       ← ปุ่ม duplicate + rename
    │   │   ├── delete-recipe-button.tsx
    │   │   ├── tabs.tsx
    │   │   ├── app-header.tsx
    │   │   └── category-select.tsx
    │   ├── lib/
    │   │   ├── costing.ts         ← logic คำนวณต้นทุน + Menu Engineering
    │   │   ├── data.ts            ← fetchAllRows paginator + getters ทั้งหมด
    │   │   ├── pos-import.ts      ← parsePosReceiptReport + parsePosSalesReport
    │   │   ├── auth.ts            ← getCurrentProfile, requireProfile, requireOwner
    │   │   ├── identity.ts        ← toAuthEmail(id)
    │   │   └── supabase/
    │   │       ├── client.ts      ← browser client
    │   │       ├── server.ts      ← server client
    │   │       ├── admin.ts       ← service role client (server-only)
    │   │       └── proxy.ts       ← แทน middleware.ts (Next.js 16 breaking change)
    │   └── proxy.ts               ← entry point ของ proxy (แทน middleware.ts)
    ├── supabase/                       ← SQL ทั้งหมด 42 ไฟล์ (ดู supabase/README.md)
    │   ├── README.md                   ← **สถานะ apply จริง** — เชื่อไฟล์นี้ ไม่ใช่เอกสารอื่น
    │   ├── migrations/                 ← มี 2 ชุดเลข: 0001-0005 และ 004-012
    │   │   ├── 0001_init.sql            ← schema ทั้งหมด + RLS
    │   │   ├── 0002_q_factor.sql        ← app_settings — **ยังไม่ apply**
    │   │   ├── 0003_price_history.sql   ← ingredient_price_history table + trigger
    │   │   ├── 0004_recipe_history.sql  ← recipe_item_history table + trigger
    │   │   ├── 0005_pos_sales_aliases.sql ← pos_sales_aliases table + RLS
    │   │   └── 004…012_*.sql            ← SOP, roles, inventory orders, stations ฯลฯ
    │   ├── schedule_notes_migration.sql ← **ยังไม่ apply**
    │   ├── (อีก ~20 ไฟล์: hr, catering, accounting, POS)
    │   └── seed.sql                     ← ข้อมูลจาก CostControl69.xlsx
    ├── next.config.ts                   ← bodySizeLimit = "15mb" สำหรับ POS upload
    ├── HANDOFF.md                       ← ไฟล์นี้
    ├── AGENTS.md / CLAUDE.md            ← system prompt สำหรับ Claude
    └── package.json
```

---

## 2. การเชื่อมต่อภายนอก

### Supabase
- **Project URL:** เก็บใน env var `NEXT_PUBLIC_SUPABASE_URL`
- **Anon key:** `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Service role key:** `SUPABASE_SERVICE_ROLE_KEY` (server-only, สำหรับ admin user management)
- **Migration ไม่ได้อยู่ที่ 5 ไฟล์แล้ว และไม่ได้ apply ครบทุกตัว** — ดู `app/supabase/README.md`
  ซึ่งเป็นแหล่งข้อมูลจริงเรื่องสถานะการ apply
  - บรรทัดเดิมตรงนี้เขียนว่า "5 ไฟล์ apply แล้วทุกตัว" ซึ่ง**ไม่จริง**:
    `0002_q_factor.sql` ไม่เคยถูก apply เลย (`app_settings` ไม่มีใน production)
    ทำให้ `getQFactorPct()` คืนค่า 3 แบบเงียบ ๆ มาตลอด — และเพราะเอกสารบอกว่า
    apply แล้ว จึงไม่มีใครตรวจสอบอีกเลย (แก้ 2026-08-30)
  - ตอนนี้ไฟล์ SQL ทั้งหมด 42 ไฟล์อยู่ใน `app/supabase/` และถูก track ใน git
    (เดิมกระจายอยู่ 3 ที่ โดย 2 ที่อยู่นอก git root)
- seed.sql รันแล้ว (411 ingredients, 45 preps, 236 menus)

### Vercel
- Deploy แล้ว (production URL ไม่ได้บันทึกไว้ — ดูใน Vercel dashboard)
- Env vars set ผ่าน `vercel env add` ทาง Bash (ไม่ใช้ PowerShell — BOM bug)
- ถ้าต้อง set env var ใหม่ **ใช้ Bash + printf เท่านั้น:**
  ```bash
  printf '%s' "VALUE_HERE" | vercel env add VAR_NAME production
  ```

### GitHub
- ไม่ได้ใช้ — deploy โดยตรงผ่าน `vercel --prod` หรือ Vercel Git integration

---

## 3. Database Schema สรุป

### Tables หลัก
| Table | หน้าที่ |
|-------|---------|
| `profiles` | 1 row/user — เก็บ full_name, role (owner/staff) |
| `ingredients` | วัตถุดิบทั้งหมด รวม prep items (is_prep=true) |
| `prep_recipes` | header ของของเตรียม (batch_yield_qty/unit) |
| `prep_recipe_items` | รายการวัตถุดิบในของเตรียม |
| `menus` | เมนูขาย (selling_price, last_period_qty_sold) |
| `menu_recipe_items` | รายการวัตถุดิบในเมนู |
| `app_settings` | id=1, q_factor_pct (default 3%) |
| `ingredient_price_history` | log การเปลี่ยนราคาวัตถุดิบ |
| `recipe_item_history` | log การแก้ recipe line items (trigger-driven) |
| `pos_sales_aliases` | mapping ชื่อ POS → menu_id + divisor ถาวร |

### RLS Rules
- **owner:** read/write ทุก table
- **staff:** read ทุก table, write เฉพาะ `menu_recipe_items` และ `prep_recipe_items`

### Cost Calculation (lib/costing.ts)
- `rawUnitCost(ing)` = purchase_cost / yield_qty (ถ้ามี yield) หรือ / receive_qty
- `resolveUnitCosts()` = multi-pass loop แก้ prep-within-prep nesting
- `computeMenuCost()` = Σ(qty × unitCost) × (1 + qFactorPct/100)
- `classifyMenuEngineering()` = threshold: popularity = (100/count)×0.8, profit = weighted avg

---

## 4. Logic สำคัญ

### fetchAllRows (lib/data.ts)
Supabase default cap = 1000 rows. ระบบมี ~1,770 menu_recipe_items แล้ว ใช้ paginator นี้:
```typescript
async function fetchAllRows<T>(query): Promise<T[]> {
  // loops .range(from, to) จนได้ page ที่สั้นกว่า PAGE_SIZE (1000)
}
```
**สำคัญ:** ทุก query ที่ดึง recipe items ต้องผ่าน fetchAllRows เสมอ

### toAuthEmail (lib/identity.ts)
Staff login ไม่มี email — แปลง username → `username@staff.local`  
ถ้า input มี "@" แล้วใช้ as-is (สำหรับ owner ที่ sign up ด้วย email จริง)

### Q-factor
แทน fuel_cost per-dish เดิม — global % uplift (default 3%) ใช้กับทุกเมนู  
ดึงจาก `app_settings` (id=1)

### POS Sales Import (pos-import.ts → sales-import-actions.ts)
1. parse ไฟล์ "รายงานการขายตามสินค้า" (HTML-as-.xls, SheetJS อ่านได้)
2. strip prefix: `(Grab|LM|ห่อ)` + suffix `**` จากชื่อสินค้า
3. ตรวจ `pos_sales_aliases` ก่อน (alias → divisor), แล้ว direct name match
4. accumulate qty ต่อ menu_id (หลาย POS row รวมเป็น 1 เมนูได้)
5. update `menus.last_period_qty_sold`

### POS Price Import (pos-import.ts → pos-import-actions.ts)
- parse "ใบรับสินค้าตรง" report (HTML-as-.xls)
- forward-fill material code/name
- เอาเฉพาะวันที่ล่าสุดต่อวัตถุดิบ (หลาย receipt ในวันเดียวกัน sum รวม)
- detect unit mismatch (UnitName POS vs purchase_unit_label ใน DB) → flag แดง, uncheck by default

---

## 5. สิ่งที่ยังเหลือต้องทำ (Pending)

### P1 — กุ้งก้ามกรามเผา alias ยังไม่ครบ
ผู้ใช้ลบ 2 alias ออกแล้ว (เพื่อแก้ที่ผิด) ต้องทำใหม่:

1. ไปที่ **Owner Dashboard → "นำเข้ายอดขายจาก POS"**
2. อัปโหลด SaleData ไฟล์ใหม่
3. ในตาราง **matched** หาแถว "กุ้งก้ามกรามเผา":
   - กรอก `10` ในช่องหาร → กด **"หาร"** (สร้าง alias ถาวร: bare name ÷10)
4. ในส่วน **ไม่พบในระบบ** (unmatched):
   - "กุ้งก้ามกรามเผา 1 กก." → เลือก target = กุ้งก้ามกรามเผา, ÷ = `1` → กด **"ผูกเข้าเมนู"**
   - "กุ้งก้ามกรามเผา 5 ขีด" → เลือก target = กุ้งก้ามกรามเผา, ÷ = `2` → กด **"ผูกเข้าเมนู"**
5. อัปโหลดไฟล์ใหม่อีกรอบ → เลือกเฉพาะแถว กุ้งก้ามกรามเผา → ยืนยัน

**Logic ÷:**  
- bare "กุ้งก้ามกรามเผา" POS นับเป็นขีด → ÷10 (10 ขีด = 1 จาน)
- "กุ้งก้ามกรามเผา 1 กก." = 1 จาน (÷1)
- "กุ้งก้ามกรามเผา 5 ขีด" = ½ จาน (÷2)

### P2 — ตรวจสอบ Scale ×10/×4 ที่รันไปแล้ว
SQL นี้ควรรันไปแล้ว (ถ้ายังไม่ได้รัน ให้รันใน Supabase SQL editor — รันได้ครั้งเดียวเท่านั้น ไม่ idempotent):
```sql
update public.menus set selling_price = selling_price * 10 where name = 'ปูม้าใหญ่นึ่ง';
update public.menus set selling_price = selling_price * 10 where name = 'กุ้งก้ามกรามเผา';
update public.menus set selling_price = selling_price * 10 where name = 'กุ้งก้ามกรามซอสมะขาม';
update public.menus set selling_price = selling_price * 4  where name = 'กุ้งแม่น้ำเผา 4 ขีด';
update public.menu_recipe_items set quantity = quantity * 10
  where menu_id = (select id from public.menus where name = 'ปูม้าใหญ่นึ่ง');
update public.menu_recipe_items set quantity = quantity * 10
  where menu_id = (select id from public.menus where name = 'กุ้งก้ามกรามเผา');
update public.menu_recipe_items set quantity = quantity * 10
  where menu_id = (select id from public.menus where name = 'กุ้งก้ามกรามซอสมะขาม');
update public.menu_recipe_items set quantity = quantity * 4
  where menu_id = (select id from public.menus where name = 'กุ้งแม่น้ำเผา 4 ขีด');
```
ตรวจสอบ: ใน Owner Dashboard ราคาขาย ปูม้าใหญ่นึ่ง, กุ้งก้ามกรามเผา, กุ้งก้ามกรามซอสมะขาม ควรเพิ่ม ×10, กุ้งแม่น้ำเผา 4 ขีด ควรเพิ่ม ×4

### P3 — pos_sales_aliases management UI ยังไม่มี
ปัจจุบัน owner ต้องลบ alias ผ่าน Supabase dashboard โดยตรง  
ควรเพิ่มหน้าหรือ modal สำหรับดู/ลบ aliases (ใช้ `listPosSalesAliases()` + `deletePosSalesAlias()` ที่มีอยู่แล้ว)

---

## 6. Bugs/Issues ที่แก้ไปแล้ว (อย่าทำซ้ำ)

### BOM character ใน Vercel env vars
- **อาการ:** login ล้มเหลว — "Cannot convert argument to ByteString... character at index 7 has value 65279"
- **สาเหตุ:** PowerShell piping ใส่ BOM (U+FEFF) เข้า env var
- **แก้:** ใช้ `printf '%s' "VALUE" | vercel env add KEY production` ผ่าน Bash

### 1000-row truncation
- **อาการ:** cost คำนวณผิด เพราะ menu_recipe_items โหลดมาแค่ 1000 จาก ~1770
- **แก้:** `fetchAllRows()` ใน lib/data.ts

### SQL trigger CASE expression
- **อาการ:** `record "new" has no field "menu_id"` เวลา trigger ทำงานบน prep_recipe_items
- **แก้:** เปลี่ยนจาก `CASE` expression เป็น `IF/ELSIF` ใน `log_recipe_item_change()` (0004_recipe_history.sql)
- **หลักการ:** ใน PL/pgSQL trigger function อย่าใช้ CASE เพื่อ access field ของ record ที่ต่าง table กัน เพราะ type-check ทำตอน parse

### Chart outliers ซ่อน
- **อาการ:** เมนูขายดีที่สุดหาย off-chart
- **แก้:** `fullDomain()` ใน menu-engineering-chart.tsx (min/max + 8% padding ไม่ clip)

### Server action as closure
- **อาการ:** ส่ง `(price) => updateMenuSellingPrice(menu.id, price)` เป็น prop ให้ Client Component ไม่ได้
- **แก้:** ส่ง `updateMenuSellingPrice` ตรง และเปลี่ยน signature เป็น `(menuId, price)`

---

## 7. Decisions ที่ตกลงกันแล้ว

| Decision | เหตุผล |
|----------|--------|
| Q-factor แทน fuel_cost per-dish | fuel_cost per-dish บิดเบือน cost ของเมนูถูก/ทำเร็ว |
| fetchAllRows paginator | Supabase default cap 1000 rows, DB มี >1000 recipe items |
| IF/ELSIF แทน CASE ใน trigger | CASE ใน PL/pgSQL ไม่ safe สำหรับ field access ข้าม record type |
| fullDomain() แทน percentile clip | outlier ต้องเห็นบน chart เสมอ |
| pos_sales_aliases เป็น persistent | ผูกครั้งเดียว ใช้ได้ทุก import ต่อไป |
| Scale 4 เมนูน้ำหนัก ×N | ปรับ selling_price + recipe quantities ให้แทน "1 จานเต็ม" แทน per-weight-unit |
| ไม่มี email login สำหรับ staff | toAuthEmail() → username@staff.local |
| service role key server-only | createAdminClient() ใน supabase/admin.ts — ห้าม import ใน client code |

---

## 8. สูตรปรับ scale เมนู (command format)

"ปรับสเกลเมนู [ชื่อ] ×[N]" = รัน SQL นี้ใน Supabase (ครั้งเดียว ไม่ idempotent):
```sql
update public.menus set selling_price = selling_price * N where name = 'ชื่อเมนู';
update public.menu_recipe_items set quantity = quantity * N
  where menu_id = (select id from public.menus where name = 'ชื่อเมนู');
```

---

## 9. Features ที่ complete แล้วทั้งหมด

- [x] Auth + Role system (owner/staff) + non-email login
- [x] Staff: recipe editor พร้อม ingredient dropdown, live cost, %food cost, profit
- [x] Staff: explicit Save button + beforeunload guard
- [x] Staff: สร้างเมนู/ของเตรียมใหม่ (owner only)
- [x] Staff: duplicate เมนู/ของเตรียม + rename form
- [x] Staff: ลบเมนู/ของเตรียม
- [x] Staff: แก้ batch yield ของเตรียม
- [x] Staff: recipe history (ดู log 30 รายการล่าสุด)
- [x] Owner: Dashboard — summary cards, ME chart (scatter), ME table (sortable)
- [x] Owner: Q-factor setting
- [x] Owner: จัดการวัตถุดิบ (ราคา/ประวัติราคา/usage lookup)
- [x] Owner: ของเตรียม (อยู่ใน ingredient management tab)
- [x] Owner: Team management (create/edit/delete/role change + safety)
- [x] Owner: POS price import ("ใบรับสินค้าตรง") + unit mismatch detection
- [x] Owner: POS sales import ("รายงานการขายตามสินค้า") + prefix/suffix strip
- [x] Owner: pos_sales_aliases — persistent mapping + divisor

---

## 10. Dev Commands

```bash
cd "D:\Claud Code\restaurant-cost-system\app"
npm run dev          # localhost:3000
npm run build        # build check
vercel --prod        # deploy production
```

**ข้อควรระวัง:**  
- `middleware.ts` ไม่ใช้ใน Next.js 16 — ใช้ `proxy.ts` แทน  
- อ่าน `node_modules/next/dist/docs/` ก่อนเขียน Next.js code (AGENTS.md บอกไว้)
- Server Action ใน file ต้องมี `"use server"` ที่บรรทัดแรก
- Client Component ใน file ต้องมี `"use client"` ที่บรรทัดแรก
