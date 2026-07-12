"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Station } from "@/lib/inventory-data";

export function FromTemplateButton({ stations }: { stations: Station[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  function pick(stationId: string) {
    setShow(false);
    router.push(`/staff/inventory/new?station=${stationId}&prefill=1`);
  }

  function handleClick() {
    if (stations.length === 1) {
      pick(stations[0].id);
    } else {
      setShow(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
      >
        สั่งของจาก Template
      </button>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3">
            <h2 className="font-semibold text-neutral-800">เลือกแผนก</h2>
            <p className="text-sm text-neutral-500">เลือกแผนกที่ต้องการสั่งของ</p>
            <div className="space-y-2">
              {stations.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s.id)}
                  className="w-full text-left rounded-lg border border-neutral-200 px-4 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
                >
                  {s.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShow(false)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </>
  );
}
