// GENERATED from the sheet's own row names on 2026-09-10 — every key below is
// a verbatim cell value from งบ69, so the map cannot drift from the file by
// a retyped character. Regenerate from the sheet if the sheet changes; do
// not hand-edit a name.
//
// Tiers, so a reader knows which rows rest on what:
//   exact     the CoA name and the sheet name are identical
//   near      spelling / spacing only (ค่าแรงparttime vs ค่าแรง Part-time) — approved 2026-09-10
//   proposed  mapped by meaning in the 2026-09-10 report, taken to Nik as a
//             batch, unamended
//   memo      a sheet line that duplicates another (the CRM half inside Discount);
//             deliberately NOT an entry
//
// A name maps to ONE code. Where the same name appears twice in the sheet
// (e.g. Supply-ส่วนกลาง in two sections) both rows aggregate into that code.

export type MapTier = "exact" | "near" | "proposed" | "memo";

export const BUDGET69_MAP: Record<string, { code: string | null; tier: MapTier }> = {
  "ผักสด": { code: "110", tier: "exact" },
  "- ไข่ไก่": { code: "125", tier: "exact" },
  "- ไข่อื่นๆ": { code: "126", tier: "exact" },
  "ของสด": { code: "120", tier: "exact" },
  "ของแห้ง": { code: "130", tier: "exact" },
  "ข้าวสาร": { code: "140", tier: "exact" },
  "น้ำมันพืช": { code: "145", tier: "exact" },
  "แอลกอฮอล์": { code: "160", tier: "proposed" },
  "วัตถุดิบอื่นๆ": { code: "148", tier: "exact" },
  "เครื่องดื่ม": { code: "160", tier: "near" },
  "น้ำแข็ง": { code: "161", tier: "exact" },
  "ผ้าเย็น": { code: "820", tier: "proposed" },
  "มะม่วง": { code: "150", tier: "exact" },
  "กะทิ": { code: "151", tier: "near" },
  "ถั่วเหลือง": { code: "152", tier: "exact" },
  "ข้าวเหนียวสาร": { code: "153", tier: "exact" },
  "ของฝาก": { code: "174", tier: "exact" },
  "ค่าขนส่งวัตถุดิบ": { code: "170", tier: "exact" },
  "วัสดุหีบห่อ-ใส่อาหารห่อ": { code: "171", tier: "proposed" },
  "วัสดุหีบห่อ-ถุงซีล": { code: "172", tier: "exact" },
  "ผลไม้+ขนม (งานนอก)": { code: "173", tier: "exact" },
  "ค่าแรงparttime (บริการ)": { code: "210", tier: "near" },
  "ค่าแรงparttime (ครัว)": { code: "211", tier: "near" },
  "ค่าแรงparttime (รับรถ)": { code: "212", tier: "near" },
  "ค่าแรงparttime (แม่บ้าน)": { code: "213", tier: "near" },
  "ค่าแรงparttime (ตลาด)": { code: "215", tier: "near" },
  "ค่าอาหารparttime": { code: "214", tier: "near" },
  "ค่าแรงพิเศษ&ออกงานนอก": { code: "215", tier: "near" },
  "ค่าอาหารพนักงานงานนอก": { code: "216", tier: "exact" },
  "เงินเดือนพนักงาน": { code: "220", tier: "exact" },
  "ค่าอาหารพนักงาน": { code: "221", tier: "exact" },
  "ค่าเชียร์อาหาร": { code: "222", tier: "exact" },
  "ประกันสังคม": { code: "230", tier: "exact" },
  "กองทุนเงินประกันสังคม": { code: "231", tier: "exact" },
  "สวัสดิการอื่น ๆ": { code: "240", tier: "near" },
  // Four rows the 2026-09-10 proposals table did not list — proposed here, not yet confirmed:
  "- ข้าวเลี้ยงปีใหม่": { code: "240", tier: "proposed" },          // staff New Year meal → welfare
  "- ค่าดนตรี+ค่าโต๊ะ": { code: "241", tier: "proposed" },          // the labour-section twin of r296
  "- อาหารและเครื่องดื่มเทศกาล": { code: "240", tier: "proposed" },  // festival food & drink for staff → welfare
  "-เครื่องคิดเลข": { code: "780", tier: "proposed" },               // calculators → stationery/office
  "ผ้ากันเปื้อน": { code: "240", tier: "proposed" },
  "หมวกแม่บ้าน": { code: "240", tier: "proposed" },
  "เสื้อ พนง. (แม่บ้าน)": { code: "240", tier: "proposed" },
  "เสื้อ พนง.(ครัว)": { code: "240", tier: "proposed" },
  "เสื้อ พนง.(บริการ)": { code: "240", tier: "proposed" },
  "เอี๊ยม Parttime": { code: "240", tier: "proposed" },
  "เสื้อ พนงอื่นๆ": { code: "240", tier: "proposed" },
  "ที่นอน พนง.": { code: "240", tier: "proposed" },
  "ตรวจสุขภาพ": { code: "240", tier: "proposed" },
  "พนง.หาหมอ": { code: "240", tier: "proposed" },
  "ยา": { code: "240", tier: "proposed" },
  "Bonus69": { code: "225", tier: "proposed" },
  "ค่าเช่าที่ดิน": { code: "310", tier: "exact" },
  "ค่าโทรศัพท์+อินเตอร์เน็ต": { code: "320", tier: "near" },
  "ค่าเช่าเครื่องทำน้ำแข็ง": { code: "330", tier: "exact" },
  "ค่าเช่าอื่นๆ": { code: "340", tier: "exact" },
  "ค่าเบี้ยประกัน": { code: "350", tier: "exact" },
  "ค่าธรรมเนียมอื่นๆ": { code: "360", tier: "proposed" },
  "ค่ายาม": { code: "370", tier: "exact" },
  "ตู้แดง": { code: "380", tier: "proposed" },
  "ใบอนุญาติสะสมอาหาร": { code: "360", tier: "proposed" },
  "ค่าอุปกรณ์ซ่อม": { code: "410", tier: "exact" },
  "ซ่อมบำรุงทั่วไป": { code: "420", tier: "exact" },
  "-เปลี่ยนยางตู้เย็นครัว": { code: "420", tier: "proposed" },
  "- ซ่อมตู้เย็นครัว": { code: "420", tier: "proposed" },
  "- ซ่อมเครื่องล้างจาน": { code: "420", tier: "proposed" },
  "- ซ่อมฮูด": { code: "420", tier: "proposed" },
  "- ซ่อมปั้มออคซิเจน": { code: "420", tier: "proposed" },
  "- ซ่อมห้องน้ำ พนง.": { code: "420", tier: "proposed" },
  "ซ่อมเตาเผา+ติดตั้งเตาทอด": { code: "992", tier: "proposed" },
  "เดินท่อระบบเครื่องกรองน้ำครัว": { code: "420", tier: "proposed" },
  "เทปูนเสริมพื้น": { code: "420", tier: "proposed" },
  "ติดตั้งไฟหน้าห้องน้ำ": { code: "420", tier: "proposed" },
  "เดินสายแลน+ย้ายกล้องวงจรปิด": { code: "420", tier: "proposed" },
  "เปลี่ยนไส้กรองเครื่องกรองน้ำ": { code: "420", tier: "proposed" },
  "ก๊อกน้ำ": { code: "420", tier: "proposed" },
  "ติดตั้งไฟราวแอร์1": { code: "420", tier: "proposed" },
  "ติดตั้งไฟศาล": { code: "420", tier: "proposed" },
  "ล้างแอร์": { code: "450", tier: "exact" },
  "ฉัดปลวก": { code: "460", tier: "proposed" },
  "ดูแลต้นไม้": { code: "470", tier: "exact" },
  "ค่าแก๊ส": { code: "510", tier: "exact" },
  "ถ่านครัว": { code: "515", tier: "exact" },
  "ค่าไฟ": { code: "520", tier: "exact" },
  "ค่าน้ำประปา": { code: "530", tier: "exact" },
  "ค่าเก็บขยะ": { code: "540", tier: "exact" },
  "อาหารถ่ายรูป/1M": { code: "670", tier: "proposed" },
  "TikTok filming/1M": { code: "670", tier: "proposed" },
  "SEO/6M (18,720)": { code: "610", tier: "proposed" },
  "LineOA/6M (11,214)": { code: "640", tier: "proposed" },
  "Hato CRM/12M (32,100)": { code: "640", tier: "proposed" },
  "ค่าจ้างMkt": { code: "620", tier: "near" },
  "Variable MKT": { code: "630", tier: "near" },
  "ของแจก": { code: "630", tier: "proposed" },
  "ของตกแต่งเทศการ": { code: "630", tier: "proposed" },
  "ค่าสิ่งพิมพ์": { code: "610", tier: "proposed" },
  "จ้างทำAW": { code: "610", tier: "proposed" },
  "ค่าโฆษนาอื่นๆ": { code: "610", tier: "proposed" },
  "Discount": { code: "650", tier: "proposed" },
  "ส่วนลด": { code: null, tier: "memo" }, // inside Discount (r134)
  "คะแนนcrm(ต้องเอามาหาร50%)": { code: null, tier: "memo" }, // memo of the CRM half, already inside Discount
  "Supply - ครัว": { code: "810", tier: "proposed" },
  "Supply - บริการ": { code: "820", tier: "proposed" },
  "Supply - บาร์น้ำ": { code: "820", tier: "proposed" },
  "Supply - แม่บ้าน": { code: "840", tier: "proposed" },
  "Supply - ซ่อมบำรุง": { code: "480", tier: "proposed" },
  "ซื้อของเพื่อทดแทน": { code: "430", tier: "exact" },
  "Supply - ส่วนกลาง": { code: "880", tier: "proposed" },
  "Supply - Catering Supplies": { code: "870", tier: "proposed" },
  "Supply - อื่นๆ": { code: "880", tier: "proposed" },
  "เงินเดือนเจ้าของร้าน": { code: "790", tier: "exact" },
  "ค่าทำบัญชี": { code: "710", tier: "exact" },
  "Promise System": { code: "720", tier: "exact" },
  "ของไหว้+ทำบุญ": { code: "730", tier: "proposed" },
  "ของไหว้ตรุษจีน": { code: "730", tier: "proposed" },
  "ค่าอบรม": { code: "240", tier: "proposed" },
  "การกุศล": { code: "740", tier: "exact" },
  "หัก%บัตรเครดิต": { code: "745", tier: "near" },
  "ค่าบริการอื่น ๆ(ที่ปรึกษา)+(พี่อู๋)": { code: "770", tier: "proposed" },
  "ค่าเครื่องเขียน": { code: "780", tier: "exact" },
  "ค่าดนตรี+ค่าโต๊ะ": { code: "241", tier: "proposed" },
  "R&D": { code: "700", tier: "exact" },
  "- ค่าขนส่ง": { code: "751", tier: "near" },
  "- ค่า GP Lineman": { code: "752", tier: "exact" },
  "- ค่า GP Grab": { code: "753", tier: "exact" },
  "- ค่า GP Foodpanda": { code: "754", tier: "exact" },
  "- ค่า GP อื่นๆ": { code: "759", tier: "exact" },
  "ค่าขนส่ง": { code: "751", tier: "near" },
  "ค่าใช้จ่ายยานพาหนะ": { code: "760", tier: "exact" },
  "ค่าอุปกรณ์สิ้นเปลือง": { code: "480", tier: "near" },
  // Three leaves under Supply - ซ่อมบำรุง, which splits because it mixes 430 and 480 — proposed, not yet confirmed:
  "เครื่องมือ + ใช้ (ใช้นาน)": { code: "480", tier: "proposed" },   // maintenance tools/consumables
  "- กล่องไฟป้ายห้องน้ำ": { code: "420", tier: "proposed" },        // an install job
  "- เปลี่ยนปั้มน้ำตู้ปลา": { code: "420", tier: "proposed" },      // a repair job
  "อื่น ๆ": { code: "910", tier: "near" },
  "คืนค่าห้องลูกค้า": { code: "910", tier: "proposed" },
  "ค่าส่งป้ายไฟ": { code: "910", tier: "proposed" },
  "รถส่งงานนอก": { code: "910", tier: "proposed" },
  "สังฆภัณฑ์ (ศาล)": { code: "730", tier: "proposed" },
  "พวงหรีดที่ระลึกงานพ่ออู๋": { code: "910", tier: "proposed" },
  "รถห้องเย็น (ซีเกท)": { code: "910", tier: "proposed" },
  "ค่าส่งเอกสาร": { code: "910", tier: "proposed" },
  "ค่าเย็บผ้าคลุมกระจกรถ": { code: "910", tier: "proposed" },
  "ถ่ายเอกสาร": { code: "910", tier: "proposed" },
  "ค่ารถ+ตรวจสุขภาพพี่หน่อย": { code: "910", tier: "proposed" },
  "ขอเอกสารดับเพลิง": { code: "910", tier: "proposed" },
  "น้ำยาล้างผมไม้": { code: "910", tier: "proposed" },
  "เช่าอุปกรณ์จัดเลี้ยง ซีเกท": { code: "930", tier: "proposed" },
  "ค่ารถส่งซ่อมเครื่องปริ้น": { code: "910", tier: "proposed" },
  "ค่าส่งอื่นๆ": { code: "910", tier: "proposed" },
  "ค่า ภพ.30": { code: "951", tier: "exact" },
  "ค่า ภงด.1,3,53": { code: "952", tier: "exact" },
  "ภาษีป้าย(19200)": { code: "953", tier: "near" },
  "ภาษีที่ดิน": { code: "954", tier: "exact" },
  "สรรพสามิตร(10200)": { code: "955", tier: "near" },
  "ค่าภาษีอื่นๆ (ภงด.50,51,1)": { code: "959", tier: "near" },
  "Supply-ครัว": { code: "810", tier: "proposed" },
  "Supply-บริการ": { code: "820", tier: "proposed" },
  "Supply-POS/ระบบคอม": { code: "994", tier: "proposed" },
  "Supply-แม่บ้าน": { code: "840", tier: "proposed" },
  "เครื่องขัดพื้น": { code: "994", tier: "proposed" },
  "Supply-ส่วนกลาง": { code: "880", tier: "proposed" },
};

/** Written by the POS revenue import from the export itself; the sheet carries the same figures. */
export const POS_OWNED_CODES = ["650", "752", "753"] as const;

/** The sheet's own rows for its revenue and its bottom line, by exact name. */
export const REVENUE_ROW = "ยอดขาย";
export const NET_PROFIT_ROW = "Net Profit";

/**
 * "- ต้นทุนอื่นๆ" is a SUBTOTAL in the COGS section (r27, a parent by
 * arithmetic) and a LEAF in the labour and maintenance sections (r64, r102) —
 * one name, three rows, two meanings. A leaf with this name is its section's
 * "other" account, resolved from the code prefix of the nearest preceding
 * mapped row. Only the two prefixes that occur are listed; any other section
 * leaves it unmapped and blocking, by name.
 */
export const SECTION_OTHER_ROW = "- ต้นทุนอื่นๆ";
export const SECTION_OTHER_BY_CODE_PREFIX: Record<string, string> = { "2": "240", "4": "420" };
