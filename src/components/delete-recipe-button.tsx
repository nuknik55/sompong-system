"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";

export function DeleteRecipeButton({
  id,
  label,
  confirmMessage,
  deleteAction,
  redirectTo,
}: {
  id: string;
  label: string;
  confirmMessage: string;
  deleteAction: (id: string) => Promise<{ status: "ok" } | { status: "error"; message: string }>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="inline-block text-right">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(confirmMessage)) return;
          setError(null);
          startTransition(async () => {
            try {
              const result = await deleteAction(id);
              if (result.status === "error") { setError(result.message); return; }
              router.push(redirectTo);
            } catch (e) {
              // Unexpected only — expected failures come back as values now.
              setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
            }
          });
        }}
        className={buttonClass("secondary", { danger: true })}
      >
        {isPending ? "กำลังลบ..." : label}
      </button>
      {error && <p className="mt-1 max-w-xs text-xs text-danger">{error}</p>}
    </div>
  );
}
