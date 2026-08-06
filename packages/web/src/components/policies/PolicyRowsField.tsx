import { POLICY_TYPE_OPTIONS, type PolicyType } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  FormControl,
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

const MAX_POLICIES = 12;

/**
 * The slice of form state these rows own, under the field name `policies`.
 *
 * Declared here rather than imported from either feature so the component can
 * be shared: `useFormContext<PolicyRowsFormValues>()` is an independent
 * instantiation, and both the Quote Recap form and the New Lead form register
 * these exact paths. Premium is optional because the New Lead form omits it.
 *
 * Premium and item count stay **strings** in form state and are converted at
 * each form's submit boundary.
 */
export interface PolicyRowsFormValues {
  policies: {
    policyType: PolicyType;
    premium?: string;
    itemCount: string;
  }[];
}

interface PolicyRowsFieldProps {
  /**
   * The Quote Recap records what a policy costs; the New Lead form (PAC-56 #2)
   * asks the same question *before* a quote exists, where nobody — least of all
   * a prospect — can answer it. Type and item count are common to both.
   */
  showPremium?: boolean;
}

/**
 * The policy rows, shared by the Quote Recap form (PAC-39) and the New Lead
 * form's policies of interest (PAC-56 #2).
 *
 * One row is always present: the remove button is hidden at a single row, which
 * enforces "at least one policy" as an affordance rather than an error the user
 * has to read. Each form's zod `.min(1)` remains the actual guarantee.
 */
export function PolicyRowsField({ showPremium = true }: PolicyRowsFieldProps) {
  const form = useFormContext<PolicyRowsFormValues>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "policies",
  });

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="rounded-lg border border-border bg-background/40 p-3 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Policy {index + 1}
            </span>
            {fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => remove(index)}
                aria-label={`Remove policy ${index + 1}`}
              >
                <X size={14} />
              </Button>
            )}
          </div>

          <div
            className={
              showPremium
                ? "grid gap-3 sm:grid-cols-3"
                : "grid gap-3 sm:grid-cols-2"
            }
          >
            <FormField
              control={form.control}
              name={`policies.${index}.policyType`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Policy type</FormLabel>
                  <Select value={f.value} onValueChange={f.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full bg-card border-border">
                        <SelectValue />
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
            {showPremium && (
              <FormField
                control={form.control}
                name={`policies.${index}.premium`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Premium ($)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        className="bg-card border-border"
                        {...f}
                        value={f.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name={`policies.${index}.itemCount`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Item count</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="bg-card border-border"
                      {...f}
                      value={f.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length >= MAX_POLICIES}
        onClick={() =>
          append(
            showPremium
              ? { policyType: "Auto", premium: "", itemCount: "1" }
              : { policyType: "Auto", itemCount: "1" },
          )
        }
      >
        <Plus size={14} />
        Add policy
      </Button>
    </div>
  );
}
