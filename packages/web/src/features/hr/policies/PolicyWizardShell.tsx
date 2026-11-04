import { Link } from "react-router-dom";
import type { HrPolicyType } from "@sfa/shared";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { POLICY_TYPE_META } from "./policy-display";

/**
 * The page frame every policy wizard and policy page sits in: the settings
 * page chrome, a back link to the filtered list, and the breadcrumb.
 */
export function PolicyWizardShell({
  type,
  title,
  caption = "HR policies",
  action,
  children,
}: {
  type: HrPolicyType | null;
  title: string;
  caption?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = type ? POLICY_TYPE_META[type] : null;
  return (
    <SettingsPage
      title={title}
      caption={caption}
      icon={meta?.icon ?? POLICY_TYPE_META.holiday.icon}
      backTo={type ? `/settings/hr-policies?type=${type}` : "/settings/hr-policies"}
      action={action}
    >
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link to="/settings/hr-policies" className="text-primary underline-offset-4 hover:underline">
            HR policies
          </Link>
          {meta && (
            <>
              {" / "}
              <span className="capitalize">{meta.singular}</span>
            </>
          )}
        </nav>
        {children}
      </div>
    </SettingsPage>
  );
}
