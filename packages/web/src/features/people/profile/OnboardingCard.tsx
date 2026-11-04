import { ClipboardCheck } from "lucide-react";
import { DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";

/**
 * The one call to action while a profile is pending and the viewer is an HR
 * admin (PAC-162). A sentence and a button, not an inline form: the three
 * steps live in a drawer so the page stays quiet.
 */
export function OnboardingCard({ onStart }: { onStart: () => void }) {
  return (
    <DetailCard
      title="Onboarding"
      icon={ClipboardCheck}
      iconClassName="text-destructive"
      className="border-destructive/40"
    >
      <p className="text-sm text-muted-foreground">
        Confirm the hire date and pick their policies. Nothing is blocked until then — they can be
        invited and sign in meanwhile.
      </p>
      <Button variant="brand" size="sm" className="mt-3" onClick={onStart}>
        Complete onboarding
      </Button>
    </DetailCard>
  );
}
