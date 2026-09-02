import { StepProgress } from "@/components/common/StepProgress";

interface IntakeProgressProps {
  /** 1-based. */
  step: number;
  total: number;
  title: string;
}

/**
 * Where the submitter is in the public intake form (PAC-56 #5).
 *
 * Now a thin wrapper over `components/common/StepProgress`, which is the same
 * treatment generalised for the app's other paginated forms (PAC-69). Kept as a
 * named component because the public form is the one screen an outside prospect
 * sees, and a wrapper is the cheapest place to diverge if it ever needs to.
 */
export function IntakeProgress({ step, total, title }: IntakeProgressProps) {
  return <StepProgress step={step} total={total} title={title} />;
}
