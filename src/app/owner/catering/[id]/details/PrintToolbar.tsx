"use client";

/**
 * The sheet's own print page's toolbar and print rules: the same page setup
 * as the quotation, so the sheet printed alone matches the pages it prints
 * as after the quotation.
 */
export function PrintToolbar({ eventId }: { eventId: string }) {
  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm 16mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          main { padding: 0 !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <a href={`/owner/catering/${eventId}`} className="text-sm text-neutral-500 hover:text-neutral-800">← กลับ</a>
          <a href={`/owner/catering/${eventId}/details`} className="text-sm text-neutral-500 hover:text-neutral-800">แก้ใบรายละเอียดงาน</a>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          พิมพ์
        </button>
      </div>
    </>
  );
}
