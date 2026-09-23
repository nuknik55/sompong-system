import { requireProfile } from "@/lib/auth";
import { getStations, getIngredientsForOrder, getTemplateItems } from "@/lib/inventory-data";
import { OrderForm } from "./OrderForm";
import { PageShell } from "@/components/ui/page";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; prefill?: string }>;
}) {
  await requireProfile();
  const { template: templateId, prefill } = await searchParams;

  const [stations, allIngredients] = await Promise.all([
    getStations(),
    getIngredientsForOrder(),
  ]);

  const templateItems = templateId ? await getTemplateItems(templateId) : [];

  return (
    <PageShell>
      <OrderForm
        stations={stations}
        allIngredients={allIngredients}
        templateItems={templateItems}
        prefillFromTemplate={prefill === "1"}
      />
    </PageShell>
  );
}
