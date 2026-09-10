export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireSales } from "@/lib/auth";
import { getCateringCustomers, getStaffOptions, getCateringRates, getCateringSetMenuOptions, getCateringDishOptions } from "../actions";
import { BookingScreen } from "../BookingScreen";

/** A new booking: the one screen, empty. Replaces the create modal on the list page. */
export default async function NewBookingPage() {
  const profile = await requireSales();
  const [customers, staffOptions, rates, setMenuOptions, dishOptions] = await Promise.all([
    getCateringCustomers(), getStaffOptions(), getCateringRates(), getCateringSetMenuOptions(), getCateringDishOptions(),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">บันทึกการจองใหม่</h1>
        <Link href="/owner/catering" className="text-sm text-neutral-500 hover:text-neutral-800">← รายการจอง</Link>
      </div>
      <BookingScreen
        event={null}
        initialCharges={[]}
        customers={customers}
        staffOptions={staffOptions}
        rates={rates}
        setMenuOptions={setMenuOptions}
        dishOptions={dishOptions}
        defaultStaffId={profile.employee_id}
      />
    </div>
  );
}
