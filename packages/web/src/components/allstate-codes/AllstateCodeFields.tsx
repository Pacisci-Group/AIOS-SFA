import { ALLSTATE_CODE_LABELS } from "@sfa/shared";
import { FormGrid } from "@/components/form";
import { withFieldGroup } from "@/hooks/form";
import { cn } from "@/lib/utils";
import {
  EMPTY_ALLSTATE_CODES,
  type AllstateCodesValues,
} from "./allstate-codes-schema";

/** Where people find their codes. Same words on every form that asks. */
const SOURCE_HINT = "From Allstate Dash / Gateway";

/**
 * The Allstate Bind ID and sub-producer code inputs (PAC-173), shared by the
 * invite dialog, the accept-invite wizard, the profile page, the owner's
 * "Edit details" dialog and platform onboarding.
 *
 * A `withFieldGroup` for the same reason as `AddressFields`: the two paths
 * are written once, here, relative to the group, and each call site maps them
 * onto its own schema through `fields` — a flat form passes
 * `{ allstateBindId: "allstateBindId", allstateSubProducerCode: "…" }`,
 * onboarding passes `"owner"`. Validation is the parent form's zod schema,
 * which spreads `allstateCodesShape`.
 *
 * The Bind ID renders upper-case because that is how Dash prints it and how
 * the server stores it; the value itself is sent as typed and normalised
 * server-side.
 */
export const AllstateCodeFields = withFieldGroup({
  defaultValues: EMPTY_ALLSTATE_CODES as AllstateCodesValues,
  /*
   * Cast to genuinely optional keys — see the same cast in `AddressFields`:
   * without it every call site would have to pass every prop.
   */
  props: {
    inputClassName: undefined,
    markOptional: false,
    columns: 2,
  } as {
    /** On each `<input>` — the dialogs and cards use `bg-card border-border`. */
    inputClassName?: string;
    /** Append "(optional)" to the labels, for forms whose other fields are required. */
    markOptional?: boolean;
    /**
     * Side by side (default) or stacked. Stack them in a narrow container — a
     * `sm:max-w-md` dialog, the employee's accept-invite card — where the
     * labels and hint would wrap unevenly and push one input below the other.
     */
    columns?: 1 | 2;
  },
  render: function Render({ group, inputClassName, markOptional, columns }) {
    const label = (text: string) => (markOptional ? `${text} (optional)` : text);

    const fields = (
      <>
        <group.AppField name="allstateBindId">
          {(f) => (
            <f.TextField
              label={label(ALLSTATE_CODE_LABELS.allstateBindId)}
              description={SOURCE_HINT}
              placeholder="e.g. SOK5PE0T"
              autoComplete="off"
              inputClassName={cn(
                "uppercase placeholder:normal-case",
                inputClassName,
              )}
            />
          )}
        </group.AppField>
        <group.AppField name="allstateSubProducerCode">
          {(f) => (
            <f.TextField
              label={label(ALLSTATE_CODE_LABELS.allstateSubProducerCode)}
              description={SOURCE_HINT}
              placeholder="e.g. 034"
              inputMode="numeric"
              autoComplete="off"
              inputClassName={inputClassName}
            />
          )}
        </group.AppField>
      </>
    );

    return columns === 1 ? (
      <div className="grid gap-4">{fields}</div>
    ) : (
      <FormGrid>{fields}</FormGrid>
    );
  },
});
