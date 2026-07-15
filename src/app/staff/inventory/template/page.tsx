import { requireAdminOrEditor, isAdminOrAbove } from "@/lib/auth";
import { getTemplates, getTemplateItems, getIngredientsForOrder } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import { TemplateClient } from "./TemplateClient";

export default async function TemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t: templateId } = await searchParams;
  const profile = await requireAdminOrEditor();

  const [templates, allIngredients] = await Promise.all([
    getTemplates(),
    getIngredientsForOrder(),
  ]);

  const selectedId = templateId ?? templates[0]?.id ?? null;
  const items = selectedId ? await getTemplateItems(selectedId) : [];
  const itemIngIds = new Set(items.map((i) => i.ingredientId));
  const availableIngredients = allIngredients.filter((i) => !itemIngIds.has(i.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate canReview={true} canSend={isAdminOrAbove(profile.role)} />
      <TemplateClient
        key={selectedId ?? "none"}
        templates={templates}
        selectedTemplateId={selectedId}
        initialItems={items}
        availableIngredients={availableIngredients}
      />
    </div>
  );
}
