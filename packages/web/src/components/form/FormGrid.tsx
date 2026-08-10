import { cn } from "@/lib/utils";

interface FormGridProps {
  /** Columns from the `sm` breakpoint up; always one column on mobile. */
  columns?: 2 | 3;
  gap?: 3 | 4;
  /** For per-grid tweaks. Field span is set on the field, not here. */
  className?: string;
  children: React.ReactNode;
}

/**
 * The responsive field grid inside a form panel.
 *
 * Closed unions rather than open `columns: number` / `gap: string` props: the 9
 * call sites use exactly three combinations, and an open prop is how a tenth
 * arrives without anyone deciding on it.
 *
 * Fields that span the full width keep saying so themselves (`sm:col-span-2` on
 * the field), because that is a property of the field, not of the grid.
 */
export function FormGrid({
  columns = 2,
  gap = 4,
  className,
  children,
}: FormGridProps) {
  return (
    <div
      className={cn(
        "grid",
        gap === 3 ? "gap-3" : "gap-4",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
