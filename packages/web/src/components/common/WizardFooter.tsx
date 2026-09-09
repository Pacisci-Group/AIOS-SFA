import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WizardFooterProps {
  /** Hidden on the first step — there is nowhere to go back to. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * The optional middle action, e.g. "Skip for now". Sits next to Back rather
   * than next to the primary button, so a step is never accidentally skipped by
   * someone reaching for Continue.
   */
  secondary?: React.ReactNode;
  /**
   * The primary button, usually a `type="submit"` so Enter in a field advances.
   *
   * Optional because one step renders its own submit inside a self-contained
   * form — `SetPasswordForm` owns its button — and still wants a Back control
   * underneath it.
   */
  children?: React.ReactNode;
  disabled?: boolean;
}

/**
 * The footer shared by the app's paginated forms — ghost Back on the left, the
 * primary action on the right, above a hairline.
 *
 * Lifted from `SoldDealWizard`, whose layout the New Lead form had already
 * copied by hand.
 */
export function WizardFooter({
  onBack,
  backLabel = "Back",
  secondary,
  children,
  disabled,
}: WizardFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={disabled}
          >
            <ArrowLeft size={14} />
            {backLabel}
          </Button>
        )}
        {secondary}
      </div>
      {children && <div className="ml-auto">{children}</div>}
    </div>
  );
}
