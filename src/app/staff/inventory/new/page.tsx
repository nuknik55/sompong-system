import { requireProfile } from "@/lib/auth";
import { getStations, getIngredientsForOrder, getAllStationTemplates } from "@/lib/inventory-data";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ station?: string; prefill?: string }>;
}) {
  await requireProfile();
  const { station: initialStation, prefill } = await searchParams;

  const [stations, allIngredients, stationTemplates] = await Promise.all([
    getStations(),
    getIngredientsForOrder(),
    getAllStationTemplates(),
  ]);

  return (
    <OrderForm
      stations={stations}
      allIngredients={allIngredients}
      stationTemplates={stationTemplates}
      initialStationId={initialStation ?? ""}
      prefillFromTemplate={prefill === "1"}
    />
  );
}
