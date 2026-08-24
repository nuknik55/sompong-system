// Static per-event task checklist template — 11 fixed steps, not editable
// via UI this round (see catering_task_checklist_migration.sql). No
// "use client"/"use server" directive: pure data + pure functions, imported
// directly by both the client checklist component and (if ever needed)
// server code.

export type ChecklistStep = {
  key: string;
  label: string;
  /** Date to display next to this step, if any — computed from event_date. */
  date?: (eventDate: string) => string;
  /** True only for a real deadline (currently just table_count_deadline) — an unchecked step past its date() renders overdue. event_day has a date() too but is informational, not a deadline. */
  isDeadline?: boolean;
  /** When set, this step only applies to events matching the predicate (currently: site_visit → offsite only). */
  showFor?: (locationType: string) => boolean;
};

function daysBefore(eventDate: string, days: number): string {
  const d = new Date(eventDate + "T00:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const CHECKLIST_STEPS: ChecklistStep[] = [
  { key: "contact",               label: "รับข้อมูลเบื้องต้นจากลูกค้า" },
  { key: "capture_info",          label: "บันทึกรายละเอียดงาน" },
  { key: "manager",               label: "ส่งต่อผู้จัดการ/หัวหน้างาน" },
  { key: "quotation",             label: "ออกใบเสนอราคา" },
  { key: "confirm_deposit",       label: "ยืนยันการจอง + รับมัดจำ" },
  { key: "site_visit",            label: "นัดดูสถานที่", showFor: (locationType) => locationType === "offsite" },
  { key: "table_count_deadline",  label: "ปิดรับแจ้งเพิ่มจำนวนโต๊ะ", date: (eventDate) => daysBefore(eventDate, 5), isDeadline: true },
  { key: "prep_brief",            label: "เตรียมงาน + brief ทีม" },
  { key: "event_day",             label: "วันจัดงาน", date: (eventDate) => eventDate },
  { key: "packdown_count",        label: "เก็บงาน + นับอุปกรณ์" },
  { key: "thank_you_survey",      label: "โทรขอบคุณ + ส่งแบบสอบถามความพึงพอใจ" },
];
