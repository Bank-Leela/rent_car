"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function filterRows<T>(rows: T[], query: string, keys: (keyof T)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q)),
  );
}

export function ListSearch<T>({
  items,
  keys,
  placeholder,
  render,
}: {
  items: T[];
  keys: (keyof T)[];
  placeholder?: string;
  render: (filtered: T[]) => React.ReactNode;
}) {
  const t = useTranslations("listSearch");
  const [query, setQuery] = useState("");
  const filtered = filterRows(items, query, keys);
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? t("placeholder")}
          className="pl-9"
        />
      </div>
      {render(filtered)}
    </div>
  );
}
