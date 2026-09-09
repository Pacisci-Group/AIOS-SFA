import { ALL_MODULE_KEYS, ModuleKey, ONBOARDING_DEFAULT_MODULES } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { withForm } from "@/hooks/form";
import { MODULE_CATALOG, MODULE_GROUPS } from "../module-catalog";
import { EMPTY_ONBOARD } from "../onboard-schema";

/**
 * Step 3 — what this agency has switched on.
 *
 * Pre-selected from `ONBOARDING_DEFAULT_MODULES`, the same list the API applies,
 * so the boxes and the entitlements cannot disagree. Adjusted here rather than
 * after creation because the operator knows what was sold, and the alternative —
 * create, then go and edit — is two screens for one decision.
 *
 * A disabled module hides its nav entries and 403s at the API, so this is a real
 * entitlement, not a preference. It stays editable afterwards from the agency's
 * module toggles.
 */
export const ModulesStep = withForm({
  defaultValues: EMPTY_ONBOARD,
  render: function Render({ form }) {
    const selected = useStore(form.store, (s) => s.values.modules);
    const chosen = new Set(selected);

    const setModules = (next: ModuleKey[]) =>
      form.setFieldValue("modules", next);

    const toggle = (key: ModuleKey, on: boolean) =>
      setModules(
        on
          ? // Filtered from the canonical order rather than appended, so the
            // stored array reads the same whatever order they were clicked in.
            ALL_MODULE_KEYS.filter((k) => k === key || chosen.has(k))
          : selected.filter((k) => k !== key),
      );

    return (
      <FormSection
        title="Modules"
        description="A disabled module is hidden from their nav and refused by the API. Changeable at any time."
        action={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setModules([...ONBOARDING_DEFAULT_MODULES])}
            >
              Defaults
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setModules([...ALL_MODULE_KEYS])}
            >
              Select all
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {MODULE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.title}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.modules.map((key) => {
                  const meta = MODULE_CATALOG[key];
                  const id = `module-${key}`;
                  return (
                    <label
                      key={key}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
                    >
                      <Checkbox
                        id={id}
                        checked={chosen.has(key)}
                        onCheckedChange={(next) => toggle(key, next === true)}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <Label
                          htmlFor={id}
                          className="cursor-pointer text-sm font-medium text-foreground"
                        >
                          {meta.label}
                        </Label>
                        <span className="block text-xs text-muted-foreground">
                          {meta.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {selected.length} of {ALL_MODULE_KEYS.length} modules enabled.
        </p>
      </FormSection>
    );
  },
});
