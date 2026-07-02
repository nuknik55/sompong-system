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
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              isActive
                ? "bg-brand-green text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
