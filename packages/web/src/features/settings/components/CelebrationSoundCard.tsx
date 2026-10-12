import { useState } from 'react';
import { PartyPopper, Volume2 } from 'lucide-react';
import { DetailCard } from '@/components/common/DetailCard';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  isCelebrationSoundEnabled,
  previewCelebrationSound,
  setCelebrationSoundEnabled,
} from '@/lib/celebrate';

/**
 * The "Celebration sound" switch on `/settings/profile` (PAC-158).
 *
 * Per device, not per account — it lives in `localStorage`, beside the theme
 * and the sidebar state, because it is a convenience about *this* desk (a
 * shared office, a muted meeting room) rather than a fact about the user. It
 * governs only the sound: the confetti keeps firing either way, and keeps its
 * own reduced-motion skip, because motion and audio are different preferences.
 *
 * "Preview" plays the clip regardless of the switch, so a rep can hear what
 * they are deciding about without booking a sale to find out.
 */
export function CelebrationSoundCard() {
  const [enabled, setEnabled] = useState(isCelebrationSoundEnabled);

  function toggle(next: boolean) {
    setCelebrationSoundEnabled(next);
    setEnabled(next);
  }

  return (
    <DetailCard title="Celebrations" icon={PartyPopper}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="celebration-sound" className="text-sm font-medium">
            Celebration sound
          </Label>
          <p className="text-sm text-muted-foreground">
            A party-popper pop when you book a sale, along with the confetti.
            Per device — turn it off here on a shared desk; the confetti stays
            either way.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={previewCelebrationSound}
          >
            <Volume2 className="size-4" />
            Preview
          </Button>
        </div>
        <Switch
          id="celebration-sound"
          checked={enabled}
          onCheckedChange={toggle}
        />
      </div>
    </DetailCard>
  );
}
