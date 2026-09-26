"use client";

import { useState, useTransition } from "react";
import { Eye, Lock } from "lucide-react";
import { setSopVisibility } from "@/app/sop/actions";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SOP_VISIBILITY_LABEL, type SopVisibility } from "@/lib/sop-visibility";

export type SopTeamMember = { id: string; full_name: string; role: string };

const ROLE_LABEL: Record<string, string> = { editor: "Editor", staff: "Staff", hr: "HR", sales: "Sales" };

/**
 * "ใครเห็น SOP นี้" — owner and admin only (Nik, 2026-09-26). Everyone
 * (the default), or the accounts ticked here; owner and admin always see
 * every SOP, so they are not listed. One save, through the database's
 * sop_set_visibility (the setting and the list together).
 */
export function SopVisibilityPanel({
  sopId,
  menuId,
  initialVisibility,
  initialViewerIds,
  team,
}: {
  sopId: string;
  menuId: string;
  initialVisibility: SopVisibility;
  initialViewerIds: string[];
  team: SopTeamMember[];
}) {
  const [saved, setSaved] = useState({ visibility: initialVisibility, viewerIds: [...initialViewerIds].sort() });
  const [visibility, setVisibility] = useState<SopVisibility>(initialVisibility);
  const [picked, setPicked] = useState<Set<string>>(new Set(initialViewerIds));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const viewerIds = visibility === "chosen" ? [...picked].sort() : [];
  const dirty = visibility !== saved.visibility || viewerIds.join(",") !== (saved.visibility === "chosen" ? saved.viewerIds.join(",") : "");

  function toggle(id: string, on: boolean) {
    setMessage(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setSopVisibility(sopId, menuId, visibility, viewerIds);
        if (result.status === "error") { setMessage({ ok: false, text: result.message }); return; }
        setSaved({ visibility, viewerIds });
        setMessage({ ok: true, text: "บันทึกแล้ว" });
      } catch {
        setMessage({ ok: false, text: "บันทึกไม่สำเร็จ — กรุณารีเฟรช (F5) แล้วลองใหม่" });
      }
    });
  }

  const summary = saved.visibility === "all"
    ? "ทุกคน"
    : `เฉพาะ ${saved.viewerIds.length} คนที่เลือก (และเจ้าของร้าน ผู้จัดการ)`;

  return (
    <details className="no-print mx-4 mt-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-neutral-800">
        {saved.visibility === "chosen" ? <Lock className="h-4 w-4 text-pending-ink" aria-hidden="true" /> : <Eye className="h-4 w-4 text-neutral-500" aria-hidden="true" />}
        ใครเห็น SOP นี้: {summary}
      </summary>
      <div className="mt-3 space-y-3 pb-2">
        <Segmented<SopVisibility>
          label="ใครเห็น SOP นี้"
          value={visibility}
          options={[
            { value: "all", label: SOP_VISIBILITY_LABEL.all },
            { value: "chosen", label: SOP_VISIBILITY_LABEL.chosen },
          ]}
          onChange={(v) => { setVisibility(v); setMessage(null); }}
        />
        {visibility === "chosen" && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-500">เจ้าของร้านและผู้จัดการเห็นทุก SOP อยู่แล้ว — เลือกคนอื่นที่ให้เห็น:</p>
            {team.length === 0 && <p className="text-xs text-neutral-500">ยังไม่มีบัญชีอื่นให้เลือก</p>}
            <ul className="grid gap-1 sm:grid-cols-2">
              {team.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={picked.has(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
                    <span>{m.full_name}</span>
                    <span className="text-xs text-neutral-500">{ROLE_LABEL[m.role] ?? m.role}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="primary" size="sm" disabled={!dirty || isPending} onClick={save}>
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
          {message && <span className={`text-xs ${message.ok ? "text-success-ink" : "text-danger"}`}>{message.text}</span>}
        </div>
      </div>
    </details>
  );
}
