import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrderSessionDetail } from "@/lib/inventory-data";
import { ReceiveForm } from "./ReceiveForm";

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [, session] = await Promise.all([requireProfile(), getOrderSessionDetail(id)]);

  if (!session) notFound();
  if (session.status !== "approved" && session.status !== "sent") redirect(`/staff/inventory/${id}`);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ReceiveForm session={session} />
    </div>
  );
}
