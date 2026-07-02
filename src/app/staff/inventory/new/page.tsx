import { getStations, getIngredientsForOrder } from "@/lib/inventory-data";
import { OrderForm } from "./OrderForm";

export default async function NewOrderPage() {
  const [stations, ingredients] = await Promise.all([
    getStations(),
    getIngredientsForOrder(),
  ]);

  return <OrderForm stations={stations} ingredients={ingredients} />;
}
