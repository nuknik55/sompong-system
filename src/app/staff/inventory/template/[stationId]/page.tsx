import { notFound } from "next/navigation";
import { requireAdminOrEditor } from "@/lib/auth";
import { getStations, getStationTemplate, getIngredientsForOrder } from "@/lib/inventory-data";
// TemplateClient lives in the owner/stations route directory but is importable as a shared component
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- directory name contains brackets; TypeScript path resolution still works
import { TemplateClient } from "@/app/owner/stations/[id]/template/TemplateClient";
import { InventorySubNav } from "@/components/inventory-sub-nav";

export default async function InventoryTemplateStationPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;
  await requireAdminOrEditor();

  const [stations, templateRows, allIngredients] = await Promise.all([
    getStations(),
    getStationTemplate(stationId),
    getIngredientsForOrder(),
  ]);

  const station = stations.find((s) => s.id === stationId);
  if (!station) notFound();

  const templateIngIds = new Set(templateRows.map((r) => r.ingredientId));
  const availableIngredients = allIngredients.filter((i) => !templateIngIds.has(i.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate canReview={true} />
      <TemplateClient
        station={station}
        allStations={stations}
        initialRows={templateRows}
        availableIngredients={availableIngredients}
        stationBaseHref="/staff/inventory/template"
        stationHrefSuffix=""
        backHref="/staff/inventory"
      />
    </div>
  );
}
