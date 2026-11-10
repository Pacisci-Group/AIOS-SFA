import { useState } from "react";
import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { defaultStartingBalance } from "@sfa/shared";
import { FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withForm } from "@/hooks/form";
import { hrKeys, listPolicyPeople } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { PeopleStep } from "../../PeopleStep";
import { formatBalance } from "../time-off-display";
import { EMPTY_TIME_OFF, toRules } from "../time-off-form";

/**
 * Step 4 — who is in the policy, and what they start with.
 *
 * The people list is the shared `PeopleStep` (search, select all, the
 * "Moves from …" note per person); the member ids are written into the form
 * through `setFieldValue`. Balances are an object keyed by user id rather
 * than an array field — TanStack array fields and `form.reset` do not get
 * on — and a blank box means the policy's default: the yearly total on a
 * Yearly policy, 0 otherwise. Hidden on Unlimited, which has no balance.
 *
 * `existing` is the activated policy's drawer: people who were in the
 * policy before resume their old balance, so the note says so.
 */
export const EnrollmentStep = withForm({
  defaultValues: EMPTY_TIME_OFF,
  props: { policyId: null as string | null, existingMemberIds: [] as readonly string[] },
  render: function Render({ form, policyId, existingMemberIds }) {
    const type = useStore(form.store, (s) => s.values.timeOffType);
    const memberIds = useStore(form.store, (s) => s.values.memberIds);
    const setBalances = useStore(form.store, (s) => s.values.setBalances);
    const unlimited = useStore(form.store, (s) => s.values.accrualType === "unlimited");
    const values = useStore(form.store, (s) => s.values);
    const people = useQuery({ queryKey: hrKeys.people, queryFn: listPolicyPeople });
    const [bulk, setBulk] = useState("");
    const fallback = defaultStartingBalance(toRules(values));
    const existing = new Set(existingMemberIds);
    const newcomers = memberIds.filter((id) => !existing.has(id));

    const applyToAll = () => {
      if (bulk.trim() === "") return;
      for (const id of newcomers) form.setFieldValue(`startingBalanceHours.${id}`, bulk);
    };

    return (
      <div className="space-y-4">
        <PeopleStep
          type="time_off"
          timeOffType={type}
          policyId={policyId}
          value={memberIds}
          onChange={(next) => {
            form.setFieldValue("memberIds", next);
            void form.validateField("memberIds", "change");
          }}
        />

        {!unlimited && (
          <FormSection
            title="Starting balances"
            description={
              fallback === null
                ? undefined
                : `Everyone starts with ${formatBalance(fallback)} unless you set a balance below.${existing.size ? " Someone who was in this policy before resumes the balance they had." : ""}`
            }
          >
            <form.AppField name="setBalances">
              {(f) => (
                <f.SwitchField label="Set balances" hint="Give some or all of the people a different starting balance.">
                  {newcomers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add people above to set their balances.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="bulk-balance">Edit all balances</Label>
                          <Input
                            id="bulk-balance"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.25"
                            value={bulk}
                            onChange={(event) => setBulk(event.target.value)}
                            className="w-32"
                          />
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={applyToAll}>
                          Apply to everyone
                        </Button>
                      </div>
                      <ul className="divide-y divide-border rounded-lg border border-border">
                        {newcomers.map((id) => {
                          const person = people.data?.people.find((p) => p.id === id);
                          return (
                            <li key={id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                              <span className="min-w-0">
                                <span className="block truncate text-sm">{person?.name ?? NOT_AVAILABLE}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {person?.email ?? ""}
                                </span>
                              </span>
                              <form.AppField name={`startingBalanceHours.${id}`}>
                                {(f) => (
                                  <f.NumberField
                                    placeholder={fallback === null ? "" : String(fallback)}
                                    step="0.25"
                                    min="0"
                                    className="w-32"
                                  />
                                )}
                              </form.AppField>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </f.SwitchField>
              )}
            </form.AppField>
            {!setBalances && <span className="sr-only">Balances use the default.</span>}
          </FormSection>
        )}
      </div>
    );
  },
});
