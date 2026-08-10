import { POLICY_TYPE_OPTIONS } from "@sfa/shared";
import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkPolicyNumber } from "@/lib/sold-deals-api";
import { DuplicatePolicyNotice } from "./DuplicatePolicyNotice";
import type { PolicyCheckMatch } from "@sfa/shared";
import type { SoldPolicyFormValues } from "./sold-deal-schema";

/**
 * The wizard's individual cards.
 *
 * Each reads the **draft** policy form off context (`useFormContext`), except
 * Card 1, which edits the deal-level sold date and takes it as a prop — that is
 * the one field outside the per-policy loop.
 */

/** Card 1 — one sold date for the whole deal. */
export function SoldDateCard({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormItem>
      <FormLabel>Sold date</FormLabel>
      <FormControl>
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormControl>
      <FormDescription>
        One date for the whole sale, however many policies it covers.
      </FormDescription>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </FormItem>
  );
}

/** Card 2 — the loop's entry point. */
export function PolicyTypeCard() {
  const form = useFormContext<SoldPolicyFormValues>();
  return (
    <FormField
      control={form.control}
      name="policyType"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Policy type</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            {/* Wraps only the trigger — the content renders in a portal. */}
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select a policy type" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {POLICY_TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Card 3 — basic details, plus the duplicate check. */
export function PolicyDetailsCard() {
  const form = useFormContext<SoldPolicyFormValues>();
  const [match, setMatch] = useState<PolicyCheckMatch | null>(null);
  const numberRef = useRef<HTMLInputElement | null>(null);

  const policyNumber = useWatch({ control: form.control, name: "policyNumber" });
  const policyType = useWatch({ control: form.control, name: "policyType" });
  const existingPolicyId = useWatch({
    control: form.control,
    name: "existingPolicyId",
  });

  // Clear a stale warning as soon as the number changes — the old match is
  // about a number the producer is no longer entering.
  useEffect(() => {
    setMatch(null);
    if (existingPolicyId) form.setValue("existingPolicyId", undefined);
    // `form` is stable; re-running on it would clear the link immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyNumber]);

  /**
   * Fired on blur rather than per keystroke: the API's short-window throttle is
   * 60/min, and a request per character would trip it on a single policy number.
   */
  const runCheck = async () => {
    const number = policyNumber?.trim();
    if (!number) return;
    try {
      const result = await checkPolicyNumber(number, policyType);
      setMatch(result.matches[0] ?? null);
    } catch {
      // A failed check must never block the sale. The server re-checks on
      // submit; this is an assist, not a gate.
      setMatch(null);
    }
  };

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="effectiveDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Start date</FormLabel>
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="carrier"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Carrier</FormLabel>
            <FormControl>
              <Input placeholder="Allstate" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="policyNumber"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Policy number</FormLabel>
            <FormControl>
              <Input
                placeholder="ABC-123-456"
                {...field}
                ref={(el) => {
                  field.ref(el);
                  numberRef.current = el;
                }}
                onBlur={() => {
                  field.onBlur();
                  void runCheck();
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {match && (
        <DuplicatePolicyNotice
          match={match}
          linked={Boolean(existingPolicyId)}
          onCorrect={() => {
            setMatch(null);
            numberRef.current?.focus();
          }}
          onLink={() => form.setValue("existingPolicyId", match.id)}
        />
      )}
    </div>
  );
}

/** Card 4 — premium and item count. */
export function PolicyFinancialsCard() {
  const form = useFormContext<SoldPolicyFormValues>();
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="premium"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Premium</FormLabel>
            <FormControl>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...field}
              />
            </FormControl>
            <FormDescription>
              The deal total is summed from every policy — no need to add them up.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="itemCount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Number of items</FormLabel>
            <FormControl>
              <Input type="number" inputMode="numeric" min="1" step="1" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

/** Card 6 — prior insurance. Labels track the policy type. */
export function PriorInsuranceCard() {
  const form = useFormContext<SoldPolicyFormValues>();
  const policyType = useWatch({ control: form.control, name: "policyType" });
  const none = useWatch({ control: form.control, name: "priorInsurance.none" });

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="priorInsurance.none"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </FormControl>
            {/* The spec's "No prior [Type] insurance" toggle. */}
            <FormLabel className="font-normal">
              No prior {policyType} insurance
            </FormLabel>
          </FormItem>
        )}
      />

      {/*
        * Hidden rather than disabled when the toggle is on: there is nothing to
        * read from a field that does not apply, and the values are dropped at
        * the submit boundary anyway.
        */}
      {!none && (
        <>
          <FormField
            control={form.control}
            name="priorInsurance.carrier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prior {policyType} carrier</FormLabel>
                <FormControl>
                  <Input placeholder="Geico" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="priorInsurance.agentName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prior agent</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Optional"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}

/** Card 7 — did the client cancel the prior policy? */
export function CancellationCard() {
  const form = useFormContext<SoldPolicyFormValues>();
  const cancelled = useWatch({
    control: form.control,
    name: "cancellation.cancelled",
  });

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="cancellation.cancelled"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </FormControl>
            <FormLabel className="font-normal">
              The prior insurance has been cancelled
            </FormLabel>
          </FormItem>
        )}
      />

      {cancelled && (
        <FormField
          control={form.control}
          name="cancellation.effectiveDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Effective date of cancellation</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {!cancelled && (
        <p className="text-xs text-muted-foreground">
          Left unticked, the service team is asked to cancel it during onboarding.
        </p>
      )}
    </div>
  );
}
