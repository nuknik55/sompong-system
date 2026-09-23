"use client";

import { useState, type ReactNode } from "react";
import { TAB_ROW, tabClass } from "@/components/ui/tabs";

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      {/* The shared tabs (components/ui/tabs.ts), as buttons: this row
          switches content in place rather than navigating. */}
      <div className={`${TAB_ROW} mb-4`}>
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={tabClass(i === active)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs[active].content}
    </div>
  );
}
