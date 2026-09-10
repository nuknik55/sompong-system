"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The one error screen, used by every segment's error.tsx and by
 * global-error.tsx. Its job is to put THE DIGEST in front of the person
 * who hit the error, in a form they can copy in one tap.
 *
 * Production redacts a thrown Server Component message; the digest is the
 * key that finds the real message in the Vercel logs. Until this existed
 * the only place it appeared was Next's default English page, and the
 * ingredients RSC error (queue item 14) went undiagnosed for want of it.
 *
 * Deliberately minimal: no logging service, no redirect, no "something went
 * wrong" without the facts.
 */
export function RouteError({
  error,
  retry,
  segment,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  segment: string;
}) {
  const pathname = usePathname();
  const [at] = useState(() => new Date());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // The browser console keeps the full object (message, stack, digest).
    console.error(error);
  }, [error]);

  const when = at.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour12: false });
  const digest = error.digest ?? "(ไม่มี digest — error เกิดในเบราว์เซอร์ ไม่ใช่ที่เซิร์ฟเวอร์)";
  const report = [`digest: ${error.digest ?? "-"}`, `route: ${pathname}`, `time: ${when}`, `message: ${error.message}`].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <h1 className="text-lg font-semibold text-neutral-900">หน้านี้เกิดข้อผิดพลาด</h1>
      <p className="text-sm text-neutral-600">
        ระบบไม่ได้ทำอะไรเพิ่ม — ข้อมูลที่บันทึกไปแล้วยังอยู่ กดคัดลอกแล้วส่งข้อความด้านล่างให้ผู้ดูแล
        รหัส digest คือกุญแจที่ใช้หาสาเหตุจริงใน log
      </p>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
        <dt className="text-neutral-500">digest</dt>
        <dd className="break-all font-mono text-neutral-900">{digest}</dd>
        <dt className="text-neutral-500">หน้า</dt>
        <dd className="break-all font-mono text-neutral-900">{pathname}</dd>
        <dt className="text-neutral-500">ส่วน</dt>
        <dd className="text-neutral-900">{segment}</dd>
        <dt className="text-neutral-500">เวลา</dt>
        <dd className="tabular-nums text-neutral-900">{when}</dd>
        <dt className="text-neutral-500">ข้อความ</dt>
        <dd className="break-words text-neutral-700">{error.message}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {copied ? "คัดลอกแล้ว ✓" : "คัดลอกข้อความสำหรับส่งผู้ดูแล"}
        </button>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            ลองใหม่
          </button>
        )}
        <Link href="/" className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          กลับหน้าแรก
        </Link>
      </div>
      {/* The same text, selectable, for a device where the clipboard button is refused. */}
      <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-white p-3 text-xs text-neutral-600">{report}</pre>
    </div>
  );
}
