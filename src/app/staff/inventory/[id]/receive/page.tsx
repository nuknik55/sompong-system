import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrderSessionDetail } from "@/lib/inventory-data";
import { ReceiveForm } from "./ReceiveForm";
import { PageShell } from "@/components/ui/page";

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [, session] = await Promise.all([requireProfile(), getOrderSessionDetail(id)]);

  if (!session) notFound();
  if (session.status !== "sent") redirect(`/staff/inventory/${id}`);

  return (
    <PageShell>
      <ReceiveForm session={session} />
    </PageShell>
  );
}
