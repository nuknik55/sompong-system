"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@/lib/inventory-data";
import { buttonClass } from "@/components/ui/button";

export function FromTemplateButton({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  function pick(templateId: string) {
    setShow(false);
    router.push(`/staff/inventory/new?template=${templateId}&prefill=1`);
  }

  function handleClick() {
    if (templates.length === 1) {
      pick(templates[0].id);
    } else {
      setShow(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={buttonClass("secondary")}
      >
        สั่งของจาก Template
      </button>

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-3">
            <h2 className="font-semibold text-neutral-800">เลือก Template</h2>
            <p className="text-sm text-neutral-500">เลือก template ที่ต้องการสั่งของ</p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t.id)}
                  className={buttonClass("secondary", { className: "w-full text-left" })}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShow(false)}
              className={buttonClass("secondary", { className: "w-full" })}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </>
  );
}
