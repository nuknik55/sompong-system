import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCostingContext } from "@/lib/data";
import { getCurrentProfile } from "@/lib/auth";
import { RecipeEditor } from "@/components/recipe-editor";
import { PrepYieldEditor } from "@/components/prep-yield-editor";
import { DuplicateButton } from "@/components/duplicate-button";
import { DeleteRecipeButton } from "@/components/delete-recipe-button";
import { duplicatePrep, deletePrep } from "@/app/staff/prep/actions";
import { RecipeHistory } from "@/components/recipe-history";

export default async function StaffPrepEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [profile, prepResult, costingCtx] = await Promise.all([
    getCurrentProfile(),
    (async () => {
      const supabase = await createClient();
      return supabase.from("prep_recipes").select("id, name, category, batch_yield_qty, batch_yield_unit").eq("id", id).single();
    })(),
    getCostingContext(),
  ]);

  const { data: prep } = prepResult;
  if (!prep) notFound();

  const { ingredients, prepRecipes, prepItems, unitCosts } = costingCtx;
  const items = prepItems.filter((it) => it.prep_recipe_id === id);
  const unitCostsObj = Object.fromEntries(unitCosts);
  const categories = [...new Set(prepRecipes.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, "th")
  );

  const isAdmin = profile?.role === "admin";
  const isEditor = profile?.role === "editor";
  const isStaff = profile?.role === "staff";
  const canEdit = isAdmin || isEditor;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{prep.name}</h1>
          {canEdit ? (
            <PrepYieldEditor
              prepId={prep.id}
              prepName={prep.name}
              initialQty={prep.batch_yield_qty}
              initialUnit={prep.batch_yield_unit}
              submitMode={isEditor ? "pending" : "save"}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              ทำได้ {prep.batch_yield_qty.toLocaleString("th-TH")} {prep.batch_yield_unit} ต่อรอบ
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <DuplicateButton
              id={prep.id}
              originalName={prep.name}
              originalCategory={prep.category}
              categories={categories}
              duplicateAction={duplicatePrep}
              hrefPrefix="/staff/prep"
            />
            {isAdmin && (
              <DeleteRecipeButton
                id={prep.id}
                label="ลบของเตรียมนี้"
                confirmMessage={`ลบของเตรียม "${prep.name}" แน่ใจหรือไม่? ลบแล้วกู้คืนไม่ได้`}
                deleteAction={deletePrep}
                redirectTo="/owner/ingredients"
              />
            )}
          </div>
        )}
      </div>
      <RecipeEditor
        target="prep"
        parentId={prep.id}
        parentName={prep.name}
        initialItems={items.map((it) => ({ id: it.id, ingredient_id: it.ingredient_id, quantity: it.quantity, unit: null }))}
        ingredients={ingredients
          .filter((i) => i.prep_recipe_id !== prep.id)
          .map((i) => ({ id: i.id, name: i.name, category: i.category, usage_unit: i.usage_unit, is_prep: i.is_prep }))}
        unitCosts={isStaff ? {} : unitCostsObj}
        readOnly={isStaff}
        submitMode={isEditor ? "pending" : "save"}
        showCosts={!isStaff}
      />
      {!isStaff && (
        <p className="text-xs text-neutral-400">
          ต้นทุนรวมข้างบน คือต้นทุนของเตรียม 1 รอบ ({prep.batch_yield_qty} {prep.batch_yield_unit}) — ต้นทุนต่อหน่วยที่เมนูอื่นใช้
          จะถูกหารด้วยจำนวนนี้โดยอัตโนมัติ
        </p>
      )}
      <RecipeHistory target="prep" parentId={prep.id} />
    </div>
  );
}
