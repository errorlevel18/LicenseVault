import { useState, useMemo, useCallback } from "react";

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  column: string;
  direction: SortDirection;
}

export function useSortableTable<T>(
  data: T[],
  defaultSort?: SortConfig
) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(
    defaultSort ?? null
  );

  const requestSort = useCallback((column: string) => {
    setSortConfig((current) => {
      if (current?.column === column) {
        if (current.direction === "asc") {
          return { column, direction: "desc" };
        }
        // If already desc, clear sort
        return null;
      }
      return { column, direction: "asc" };
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!sortConfig) return data;

    const { column, direction } = sortConfig;

    return [...data].sort((a, b) => {
      const rawA = (a as Record<string, unknown>)[column];
      const rawB = (b as Record<string, unknown>)[column];

      // Use array length for array values
      const aVal = Array.isArray(rawA) ? rawA.length : rawA;
      const bVal = Array.isArray(rawB) ? rawB.length : rawB;

      // Handle nulls/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return direction === "asc" ? -1 : 1;
      if (bVal == null) return direction === "asc" ? 1 : -1;

      // Numeric comparison
      if (typeof aVal === "number" && typeof bVal === "number") {
        return direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const cmp = aStr.localeCompare(bStr);
      return direction === "asc" ? cmp : -cmp;
    });
  }, [data, sortConfig]);

  return { sortedData, sortConfig, requestSort };
}
