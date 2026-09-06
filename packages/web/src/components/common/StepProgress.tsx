import { Progress } from "@/components/ui/progress";

interface StepProgressProps {
  /** 1-based. */
  step: number;
  total: number;
  title: string;
  /** Optional sub-line under the title, for a step that needs a sentence. */
  description?: React.ReactNode;
  /**
   * Stick to the top of the scroll container. On by default — the answer to
   * "how much is left?" should survive a scroll on a phone. Off for a wizard
   * rendered inside a card that scrolls with the page.
   */
  sticky?: boolean;
}

/**
 * Where someone is in a paginated form.
 *
 * Generalised out of `features/lead/components/IntakeProgress` (PAC-56 #5) when
 * agency onboarding (PAC-69) became the app's third paginated form. The two
 * existing ones — the public lead intake and the Sold wizard — had already
 * converged on the same counter-plus-bar treatment, and a third private copy is
 * how three forms end up reading as three products.
 *
 * `IntakeProgress` is now a thin wrapper over this, so the public form's
 * rendering is unchanged.
 */
export function StepProgress({
  step,
  total,
  title,
  description,
  sticky = true,
}: StepProgressProps) {
  return (
    <div
      className={
        "space-y-2 rounded-xl border border-border bg-card/95 px-4 py-3 backdrop-blur md:px-5" +
        (sticky ? " sticky top-0 z-10" : "")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {step} of {total}
        </p>
      </div>
      <Progress
        value={(step / total) * 100}
        aria-label={`Step ${step} of ${total}: ${title}`}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
