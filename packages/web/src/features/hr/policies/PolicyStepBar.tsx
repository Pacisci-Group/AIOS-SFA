import { cn } from "@/lib/utils";

/**
 * The policy wizard's progress: one bar per step with its name beneath, the
 * bars filled up to and including the current step — the Gusto layout David
 * pointed at. A step is a button when `onSelect` is given (editing a saved
 * policy, where any step may be revisited); creating walks them in order.
 */
export function PolicyStepBar({
  steps,
  current,
  onSelect,
}: {
  steps: readonly { label: string }[];
  /** 0-based. */
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="flex gap-2">
      {steps.map((step, index) => {
        const reached = index <= current;
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                "block h-1 rounded-full transition-colors",
                reached ? "bg-primary" : "bg-border",
              )}
            />
            <span
              className={cn(
                "mt-2 block text-xs",
                index === current
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {index + 1}. {step.label}
            </span>
          </>
        );
        return (
          <li
            key={step.label}
            className="min-w-0 flex-1"
            aria-current={index === current ? "step" : undefined}
          >
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
