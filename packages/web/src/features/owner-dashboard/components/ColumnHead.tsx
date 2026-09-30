import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ColumnHeadProps {
  label: string;
  /**
   * One sentence saying what the column counts and in which unit. Shown on
   * hover or focus of the help glyph beside the label.
   */
  hint?: string;
  /** Right-aligned columns put the glyph after the label, nearest the margin. */
  align?: "left" | "right";
  className?: string;
}

/**
 * A table header that can explain itself.
 *
 * Two words cannot say "cars, homes and other insured things, summed across
 * every policy sold" — and the owner asked exactly that of "Bound". The label
 * names the thing and the unit ("Items bound"); the hint carries the
 * definition, on a focusable trigger so a keyboard reaches it too.
 */
export function ColumnHead({
  label,
  hint,
  align = "left",
  className,
}: ColumnHeadProps) {
  return (
    <TableHead className={cn(align === "right" && "text-right", className)}>
      {hint ? (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            align === "right" && "flex-row-reverse",
          )}
        >
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-4 text-muted-foreground hover:text-foreground"
                aria-label={`What ${label} means`}
              >
                <CircleHelp aria-hidden className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{hint}</TooltipContent>
          </Tooltip>
        </span>
      ) : (
        label
      )}
    </TableHead>
  );
}
