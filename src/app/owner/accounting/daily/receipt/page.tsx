export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getEntriesByIds } from "../../actions";
import { ReceiptClient } from "./ReceiptClient";

export default async function ReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ids?: string }>;
}) {
  await requireAdmin();
  const { date: rawDate, ids: rawIds } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = rawDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? rawDate : today;
  const ids = rawIds ? rawIds.split(",").filter(Boolean) : [];
  const entries = await getEntriesByIds(ids);

  return <ReceiptClient entries={entries} date={date} />;
}
