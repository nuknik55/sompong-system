"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  deleteAction: (id: string) => Promise<void>;
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
              await deleteAction(id);
              router.push(redirectTo);
            } catch (e) {
              setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
            }
          });
        }}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "กำลังลบ..." : label}
      </button>
      {error && <p className="mt-1 max-w-xs text-xs text-red-600">{error}</p>}
    </div>
  );
}
