import Link from "next/link";

type Props = {
  categories: string[];
  selected: string; // "all" or a category name
};

/** Renders horizontal scrollable pill tabs for the ME page category filter.
 *  Uses plain Next.js Links so no client-side JS is required. */
export function CategoryTabs({ categories, selected }: Props) {
  const tabs = [{ value: "all", label: "ทั้งหมด" }, ...categories.map((c) => ({ value: c, label: c }))];

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const isActive = tab.value === selected;
        const href = tab.value === "all" ? "/owner" : `/owner?category=${encodeURIComponent(tab.value)}`;
        return (
          <Link
            key={tab.value}
            href={href}
            // The selected tab is the primary tint (a selection, not an action).
            className={`whitespace-nowrap rounded-full border px-3 py-1 font-heading text-sm font-medium transition-colors ${
              isActive
                ? "border-primary/30 bg-primary-soft text-primary"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
