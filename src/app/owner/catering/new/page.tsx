export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireSales } from "@/lib/auth";
import { getCateringCustomers, getStaffOptions, getCateringRates, getCateringEventTypes, getCateringSetMenuOptions, getCateringDishOptions } from "../actions";
import { BookingScreen } from "../BookingScreen";

/** A new booking: the one screen, empty. Replaces the create modal on the list page. */
export default async function NewBookingPage() {
  const profile = await requireSales();
  const [customers, staffOptions, rates, eventTypes, setMenuOptions, dishOptions] = await Promise.all([
    getCateringCustomers(), getStaffOptions(), getCateringRates(), getCateringEventTypes(),
    getCateringSetMenuOptions(), getCateringDishOptions(),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">บันทึกการจองใหม่</h1>
        <Link href="/owner/catering" className="text-sm text-neutral-500 hover:text-neutral-800">← รายการจอง</Link>
      </div>

      {/* WHY THERE IS NO รายการอาหารของงาน BUTTON HERE (Nik, 2026-09-20: he
          went looking for it). The menu belongs to a booking, and a booking
          has no id until it is saved, so the button cannot exist yet. That is
          correct behaviour and it was silent — a screen that simply lacks
          something reads as a screen that is broken. */}
      <p className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-600">
        บันทึกการจองก่อน แล้วจึงตั้งรายการอาหารของงานได้ — ปุ่ม <b>รายการอาหารของงาน</b> จะขึ้นในหน้าการจองทันทีหลังบันทึกครั้งแรก
        (เลือกชุดเมนูในกล่องราคาด้านล่างตอนนี้ก็ได้ รายการอาหารของชุดจะถูกคัดลอกมาให้เอง)
      </p>
      <BookingScreen
        event={null}
        initialCharges={[]}
        customers={customers}
        staffOptions={staffOptions}
        rates={rates}
        eventTypes={eventTypes}
        setMenuOptions={setMenuOptions}
        dishOptions={dishOptions}
        defaultStaffId={profile.employee_id}
      />
    </div>
  );
}
