import React from "react";
import { TableHead } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortConfig } from "@/hooks/use-sortable-table";

interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  column: string;
  sortConfig: SortConfig | null;
  onSort: (column: string) => void;
  children: React.ReactNode;
}

export function SortableTableHead({
  column,
  sortConfig,
  onSort,
  children,
  className,
  ...props
}: SortableTableHeadProps) {
  const isActive = sortConfig?.column === column;

  return (
    <TableHead
      className={cn("cursor-pointer select-none hover:bg-muted/50", className)}
      onClick={() => onSort(column)}
      {...props}
    >
      <div className="flex items-center gap-1">
        {children}
        {isActive ? (
          sortConfig.direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-foreground" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-foreground" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}
