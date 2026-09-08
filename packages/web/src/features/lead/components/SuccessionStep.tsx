import type { SuccessionRequiredError } from "@sfa/shared";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { ChoiceRow } from "@/components/common/ChoiceRow";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** What the caller sends back with the retried request. */
export interface SuccessionAnswer {
  successorContactId?: string;
  allowNoPrimary?: boolean;
}

/** The sentinel for "leave the household without a primary contact". */
const NO_PRIMARY = "__none__";

interface SuccessionStepProps {
  error: SuccessionRequiredError;
  contactName: string;
  pending: boolean;
  onCancel: () => void;
  onChoose: (answer: SuccessionAnswer) => void;
}

/**
 * "Who takes over this household?" — the second half of marking a household's
 * primary contact deceased (PAC-91 §7).
 *
 * Shown only when the server says it is needed. The API refuses the edit with a
 * **409 `primary_contact_succession_required`** carrying the household and the
 * members eligible to lead it (current members, alive, not already primary of
 * another household), so this renders the server's own answer rather than
 * re-deriving eligibility from whatever roster the page happens to hold.
 *
 * ── Nothing is preselected ──────────────────────────────────────────────────
 * The owner's rule is (a) *name the successor*, falling back to (c) *a
 * deliberate, flagged gap*. Auto-promotion by role precedence — Spouse, then an
 * adult member — was considered and rejected: it guesses at something the
 * producer knows, on the record that decides which policies and which producer
 * this whole family hangs off. A default selection is the same guess wearing a
 * radio button, so there isn't one.
 *
 * ── "No primary contact" is always offered ──────────────────────────────────
 * Even when there are candidates. A household may genuinely be between primary
 * contacts, and the alternative — forcing a name in order to record a death —
 * is how a wrong primary gets written down as fact. It is the **only** option
 * when `candidates` is empty, which is the case §7 calls out: the household's
 * one member is the person who died.
 */
export function SuccessionStep({
  error,
  contactName,
  pending,
  onCancel,
  onChoose,
}: SuccessionStepProps) {
  const [choice, setChoice] = useState<string | null>(null);
  const householdLabel =
    error.householdRef ?? error.householdName ?? "this household";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Who leads {householdLabel} now?</DialogTitle>
        <DialogDescription>
          {contactName} is the primary contact of {householdLabel}. Recording
          the death needs an answer to this in the same step, so the household
          is never left headed by someone who has died.
        </DialogDescription>
      </DialogHeader>

      <div
        role="radiogroup"
        aria-label="New primary contact"
        className="flex flex-col gap-2"
      >
        {error.candidates.map((candidate) => (
          <ChoiceRow
            key={candidate.id}
            selected={choice === candidate.id}
            onSelect={() => setChoice(candidate.id)}
            title={candidate.name}
            caption={candidate.role ?? "Household member"}
          />
        ))}
        <ChoiceRow
          selected={choice === NO_PRIMARY}
          onSelect={() => setChoice(NO_PRIMARY)}
          title="Leave without a primary contact"
          caption={
            error.candidates.length
              ? "Flags the household for the office to come back to."
              : "No other living member to promote. Flags the household for the office."
          }
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
        >
          Back
        </Button>
        <Button
          type="button"
          disabled={pending || !choice}
          onClick={() =>
            onChoose(
              choice === NO_PRIMARY
                ? { allowNoPrimary: true }
                : { successorContactId: choice! },
            )
          }
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}
