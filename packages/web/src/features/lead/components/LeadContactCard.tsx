import type { LeadDetail } from "@sfa/shared";
import {
  Calendar,
  Hash,
  Home,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatPhone } from "@/lib/leads-api";
import { cn } from "@/lib/utils";
import { DetailCard, SectionLabel } from "@/components/common/DetailCard";
import { EditContactDialog } from "./EditContactDialog";
import { LeadSourceSelect } from "./lead-inline-selects";
import { formatAddress, formatDate } from "./lead-display";

interface LeadContactCardProps {
  lead: LeadDetail;
  onSourceChange: (code: string) => void;
  pending: boolean;
}

function Field({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <SectionLabel>{label}</SectionLabel>
        <p className="mt-0.5 break-words text-base text-card-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * Block A — who this lead is and how to reach them.
 *
 * The lead-source control sits in the card header rather than the page header
 * because it is a property of the record, not of its pipeline state — and
 * because it is the one field a share-link lead arrives without.
 */
export function LeadContactCard({
  lead,
  onSourceChange,
  pending,
}: LeadContactCardProps) {
  const contact = lead.primaryContact;

  return (
    <DetailCard
      title="Lead & contact"
      bodyless
      action={
        <>
          <LeadSourceSelect
            value={lead.leadSource}
            onChange={onSourceChange}
            pending={pending}
          />
          {contact && <EditContactDialog leadId={lead.id} contact={contact} />}
        </>
      }
    >
      <div className="grid gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2">
        <Field
          icon={MapPin}
          label="Address"
          value={formatAddress(lead.address)}
        />
        <Field
          icon={Calendar}
          label="Date of Birth"
          value={formatDate(contact?.dateOfBirth ?? null)}
        />
        <Field
          icon={Mail}
          label="Email"
          value={contact?.email ?? lead.emails[0] ?? "—"}
        />
        <Field
          icon={Phone}
          label="Phone"
          value={formatPhone(contact?.phone ?? lead.phones[0] ?? null)}
        />
        {lead.quoteControlNumber && (
          <Field
            icon={Hash}
            label="Quote Control #"
            value={lead.quoteControlNumber}
          />
        )}
        {/*
          * Omitted rather than shown empty — every migrated lead and every one
          * submitted before PAC-56 #2 has none, and a permanent "—" would read
          * as "they wanted nothing" instead of "we never asked".
          */}
        {lead.policiesOfInterest.length > 0 && (
          <div className="flex items-start gap-2.5 sm:col-span-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <SectionLabel>Policies of interest</SectionLabel>
              <ul className="mt-0.5 space-y-0.5">
                {lead.policiesOfInterest.map((policy, index) => (
                  <li
                    key={`${policy.policyType}-${index}`}
                    className="break-words text-base text-card-foreground"
                  >
                    {/* The count only earns its place when it isn't the default
                        1 — "Auto ×1" is noise around the part that matters. */}
                    {policy.itemCount > 1
                      ? `${policy.policyType} ×${policy.itemCount}`
                      : policy.policyType}
                    {/* Each property policy names the building it insures
                        (PAC-56 #14) — the reason a household can hold a home
                        and a landlord policy at once. */}
                    {policy.propertyAddress && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {formatAddress(policy.propertyAddress)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {/*
          The lead-level dwelling. Migrated records and leads captured before
          the address moved onto the policy row are the only ones that have one,
          so it is the fallback rather than the primary display.
        */}
        {lead.propertyAddress && (
          <Field
            icon={Home}
            label="Property Address"
            value={formatAddress(lead.propertyAddress)}
            className="sm:col-span-2"
          />
        )}
      </div>

      {!contact && (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          No contact record is linked to this lead yet, so the details above come
          from the lead itself.
        </p>
      )}
    </DetailCard>
  );
}
