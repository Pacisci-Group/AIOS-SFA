import { POLICY_TYPE_OPTIONS } from "@sfa/shared";
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
import type { QuoteRecapFormValues } from "./quote-recap-schema";

const MAX_POLICIES = 12;

/**
 * The quoted-policy rows. One row is always present: the remove button is
 * hidden at a single row, which enforces "at least one policy" as an
 * affordance rather than an error the producer has to read. The zod `.min(1)`
 * remains the actual guarantee.
 */
export function PolicyRowsField() {
  const form = useFormContext<QuoteRecapFormValues>();
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

          <div className="grid gap-3 sm:grid-cols-3">
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
          append({ policyType: "Auto", premium: "", itemCount: "1" })
        }
      >
        <Plus size={14} />
        Add policy
      </Button>
    </div>
  );
}
