"use client";

export function PrintButtons() {
  return (
    <div className="no-print" style={{ position: "fixed", top: 12, right: 12, display: "flex", gap: 8, zIndex: 100 }}>
      <button
        onClick={() => window.history.back()}
        style={{ padding: "6px 14px", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", background: "#fff", fontSize: 13 }}
      >
        ← กลับ
      </button>
      <button
        onClick={() => window.print()}
        style={{ padding: "6px 14px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
      >
        🖨 พิมพ์ / บันทึก PDF
      </button>
    </div>
  );
}
