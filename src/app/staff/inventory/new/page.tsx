import { getStations, getIngredientsForOrder, getAllStationTemplates } from "@/lib/inventory-data";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage() {
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
    />
  );
}
