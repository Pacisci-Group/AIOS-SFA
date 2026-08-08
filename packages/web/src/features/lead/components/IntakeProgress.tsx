import { Progress } from "@/components/ui/progress";

interface IntakeProgressProps {
  /** 1-based. */
  step: number;
  total: number;
  title: string;
}

/**
 * Where the submitter is in the public intake form (PAC-56 #5).
 *
 * Modelled on `features/sold/components/WizardProgress` — same `Progress`
 * primitive, same counter ramp — so the app's two paginated forms read as one
 * thing. It carries the card's title as well as the count because the card
 * below is the only one on screen: the heading and the position are the same
 * piece of information, and splitting them across two places would just repeat
 * it.
 *
 * Sticky, so the answer to "how much is left?" survives a scroll on a phone.
 */
export function IntakeProgress({ step, total, title }: IntakeProgressProps) {
  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-xl border border-border bg-card/95 px-4 py-3 backdrop-blur md:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Step {step} of {total}
        </p>
      </div>
      <Progress
        value={(step / total) * 100}
        aria-label={`Step ${step} of ${total}: ${title}`}
      />
    </div>
  );
}
