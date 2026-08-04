import type { LeadDetail } from "@sfa/shared";
import { Calendar, Hash, Mail, MapPin, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatPhone } from "@/lib/leads-api";
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
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 break-words text-sm text-card-foreground">
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
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Lead &amp; Contact
        </h2>
        <div className="flex items-center gap-2">
          <LeadSourceSelect
            value={lead.leadSource}
            onChange={onSourceChange}
            pending={pending}
          />
          {contact && <EditContactDialog leadId={lead.id} contact={contact} />}
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-2">
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
      </div>

      {!contact && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          No contact record is linked to this lead yet, so the details above come
          from the lead itself.
        </p>
      )}
    </section>
  );
}
