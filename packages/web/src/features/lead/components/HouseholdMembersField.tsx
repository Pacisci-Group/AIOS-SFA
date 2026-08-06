import { HOUSEHOLD_MEMBER_ROLES } from "@sfa/shared";
import { Plus, X } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { FormGrid, FormSubPanel } from "@/components/form";
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
import type { LeadIntakeFormValues } from "./lead-intake-schema";

const MAX_MEMBERS = 10;

/**
 * The dynamic "additional household members" array.
 *
 * All four relationship roles are offered, **including Child** — the `sfaforms`
 * prototype omits it, and a household with children is the common case for the
 * auto policies these leads become.
 */
export function HouseholdMembersField() {
  const form = useFormContext<LeadIntakeFormValues>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "members",
  });

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No additional members yet — add a spouse, child, or other driver.
        </p>
      ) : null}

      {fields.map((field, index) => (
        <FormSubPanel
          key={field.id}
          title={`Member ${index + 1}`}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-foreground"
              onClick={() => remove(index)}
              aria-label={`Remove member ${index + 1}`}
            >
              <X size={14} />
            </Button>
          }
        >
          <FormGrid gap={3}>
            <FormField
              control={form.control}
              name={`members.${index}.firstName`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>First name</FormLabel>
                  <FormControl>
                    <Input className="bg-card border-border" {...f} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`members.${index}.lastName`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Last name</FormLabel>
                  <FormControl>
                    <Input className="bg-card border-border" {...f} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`members.${index}.dateOfBirth`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Date of birth</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
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
              name={`members.${index}.role`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Relationship</FormLabel>
                  <Select value={f.value} onValueChange={f.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {HOUSEHOLD_MEMBER_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGrid>
        </FormSubPanel>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length >= MAX_MEMBERS}
        onClick={() =>
          append({ firstName: "", lastName: "", dateOfBirth: "", role: "Spouse" })
        }
      >
        <Plus size={14} />
        Add member
      </Button>
    </div>
  );
}
