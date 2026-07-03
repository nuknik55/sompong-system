import { notFound } from "next/navigation";
import { requireAdminOrEditor } from "@/lib/auth";
import { getStations, getStationTemplate, getIngredientsForOrder } from "@/lib/inventory-data";
import { TemplateClient } from "./TemplateClient";

export default async function StationTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdminOrEditor();

  const [stations, templateRows, allIngredients] = await Promise.all([
    getStations(),
    getStationTemplate(id),
    getIngredientsForOrder(),
  ]);

  const station = stations.find((s) => s.id === id);
  if (!station) notFound();

  const templateIngIds = new Set(templateRows.map((r) => r.ingredientId));
  const availableIngredients = allIngredients.filter((i) => !templateIngIds.has(i.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <TemplateClient
        station={station}
        allStations={stations}
        initialRows={templateRows}
        availableIngredients={availableIngredients}
      />
    </div>
  );
}
