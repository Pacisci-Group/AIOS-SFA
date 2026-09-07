import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { MailerCampaign } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { useAppForm, withForm } from "@/hooks/form";
import type { PlatformAgency } from "@/lib/platform-api";
import { CampaignSettingsForm } from "./CampaignSettingsForm";
import {
  EMPTY_CAMPAIGN_FORM,
  campaignFormSchema,
  fromCampaign,
  type CampaignFormValues,
} from "../campaign-schemas";

/**
 * Step 1's settings, re-opened on a campaign that has already been previewed
 * (PAC-71).
 *
 * ## Why this exists
 *
 * The preview is where the settings are first tested against the real file, and
 * it is the only place their consequences are visible: an unmatched carrier
 * agency code, a floor that raises 95% of rows, a ZIP with no market. Every one
 * of those is a reason to change what step 1 collected — and until this, the
 * only way to act on one was to abandon the campaign and upload the 23 MB file
 * again. The API has allowed the edit since PR2 (`PATCH …/:id`, and
 * `EDITABLE_STATUSES` = `uploaded | previewed | failed`); nothing offered it.
 *
 * Saving takes the campaign back to `uploaded` and re-runs the preview
 * server-side, so the numbers on screen always describe the settings that
 * produced them. That is also why there is no "save without re-previewing":
 * a stored preview that describes settings the campaign no longer has is
 * exactly what the commit gate refuses to act on.
 *
 * ## What it deliberately does not offer
 *
 * **The file.** A campaign is its file — the storage key is stamped at create
 * and `PATCH` will not take another. Replacing it means a new campaign, which
 * is the honest thing for the record to say.
 *
 * **The carrier.** `PATCH` accepts `carrierId`, but changing it silently
 * re-points every carrier-agency-code match at a different catalog row. Nothing
 * in the wizard collects it today (it defaults to Allstate) and inventing a
 * control for it here would be the first place in the product where that is a
 * casual edit.
 */
interface EditCampaignSettingsProps {
  campaign: MailerCampaign;
  agencies: readonly PlatformAgency[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: CampaignFormValues) => void;
}

export function EditCampaignSettings({
  campaign,
  agencies,
  saving,
  onCancel,
  onSubmit,
}: EditCampaignSettingsProps) {
  /*
   * Frozen at mount, not tracked.
   *
   * ⚠ The page polls, so `campaign` arrives as a new object on every tick. A
   * `defaultValues` whose identity moves on a form nobody has touched yet makes
   * `FormApi.update` rewrite the form's values — and the discount bands and
   * market phones are `mode="array"` fields, which subscribe to nothing but
   * their own array version and would keep rendering the rows they mounted
   * with. See `docs/tanstack-form-spike-findings.md`, Trap 3.
   */
  const [defaultValues] = useState(() => fromCampaign(campaign));

  const form = useAppForm({
    defaultValues,
    validators: { onBlur: campaignFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  return (
    <EditForm
      form={form}
      agencies={agencies}
      // The campaign's own source, never the URL's: a run resumed by id carries
      // no `?source=`, and showing a processed import the pricing controls it
      // ignores is how somebody comes to believe they changed its floor.
      source={campaign.source === "processed" ? "processed" : "vendor"}
      saving={saving}
      onCancel={onCancel}
    />
  );
}

const EditForm = withForm({
  defaultValues: EMPTY_CAMPAIGN_FORM,
  props: {
    agencies: [] as readonly PlatformAgency[],
    source: "vendor" as "vendor" | "processed",
    saving: false,
    onCancel: () => {},
  },
  render: function Render({ form, agencies, source, saving, onCancel }) {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <CampaignSettingsForm
          form={form}
          agencies={agencies}
          source={source}
          disabled={saving}
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : "Save and read the file again"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <p className="text-sm text-muted-foreground">
            The file is not re-uploaded, and no mailers are written.
          </p>
        </div>
      </form>
    );
  },
});
