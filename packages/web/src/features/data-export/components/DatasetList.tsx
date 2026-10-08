import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DataExportDatasetDescriptor,
  DataExportDatasetKey,
} from "@/lib/data-export-api";
import { cn } from "@/lib/utils";

interface DatasetListProps {
  datasets: readonly DataExportDatasetDescriptor[];
  selected: DataExportDatasetKey;
  onSelect: (key: DataExportDatasetKey) => void;
}

/**
 * The dataset picker: a list on wide screens, where each dataset's one-line
 * description helps choose, and a select on narrow ones, where a list of six
 * cards would push the filters off the first screen.
 */
export function DatasetList({ datasets, selected, onSelect }: DatasetListProps) {
  return (
    <>
      <div className="lg:hidden">
        <Select
          value={selected}
          onValueChange={(value) => onSelect(value as DataExportDatasetKey)}
        >
          <SelectTrigger className="w-full" aria-label="Dataset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {datasets.map((dataset) => (
              <SelectItem key={dataset.key} value={dataset.key}>
                {dataset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <nav
        aria-label="Datasets"
        className="hidden flex-col gap-1 rounded-xl border border-border bg-card p-2 lg:flex"
      >
        <p className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Datasets
        </p>
        {datasets.map((dataset) => {
          const active = dataset.key === selected;
          return (
            <Button
              key={dataset.key}
              variant="ghost"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(dataset.key)}
              className={cn(
                "h-auto w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left whitespace-normal",
                active && "bg-accent",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <Database
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="text-sm font-semibold">{dataset.label}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {dataset.columns.length} cols
                </span>
              </span>
              <span className="pl-6 text-xs font-normal text-muted-foreground">
                {dataset.description}
              </span>
            </Button>
          );
        })}
      </nav>
    </>
  );
}
