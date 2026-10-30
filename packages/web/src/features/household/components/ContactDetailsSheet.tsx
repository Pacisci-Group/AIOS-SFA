import type { ContactSummary } from "@sfa/shared";
import { Cake, Mail, Phone, Shield, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPhone } from "@/lib/leads-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";

/**
 * A date of birth or death for display, read **in UTC**.
 *
 * Both are calendar dates stored at UTC midnight (`parseDateOfBirth`), so
 * formatting one in the browser's zone is how a US user sees the birthday a
 * day early. A date-only string (`deceasedAt`) is pinned to UTC midnight for
 * the same reason.
 */
export function formatCalendarDate(value: string | null): string {
  if (!value) return NOT_AVAILABLE;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Whole years between a date of birth and `on` (today, or the date of death).
 * Null when either date is unusable, or for a birth date in the future.
 */
export function ageInYears(
  dateOfBirth: string | null,
  on: Date = new Date(),
): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime()) || Number.isNaN(on.getTime())) return null;
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < born.getUTCMonth() ||
    (on.getUTCMonth() === born.getUTCMonth() &&
      on.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

function fullName(contact: ContactSummary) {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    "Unnamed contact"
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block break-words text-sm font-medium text-foreground">
          {value}
        </span>
      </span>
    </>
  );
  const className = "flex items-start gap-2.5 rounded-md bg-muted px-3 py-2";
  return href ? (
    <a href={href} className={cn(className, "transition-colors hover:bg-accent")}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * One household member's details — opened by clicking them in the roster.
 *
 * Everything the household read already carries for a contact: role,
 * date of birth and age, phone, email, and the date of death where there is
 * one. Read-only on purpose: editing a contact still goes through the Lead
 * Detail page's Edit Contact, whose rules (succession on a death, the identity
 * check) belong to that flow.
 *
 * A deceased member keeps every detail on screen — they are on this household's
 * record — but the phone and email stop being links, the same rule the profile
 * column follows for a deceased primary.
 */
export function ContactDetailsSheet({
  contact,
  onOpenChange,
}: {
  /** The member to show; `null` closes the sheet. */
  contact: ContactSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const deceased = Boolean(contact?.deceasedAt);
  const age = contact
    ? ageInYears(
        contact.dateOfBirth,
        contact.deceasedAt ? new Date(`${contact.deceasedAt}T00:00:00Z`) : undefined,
      )
    : null;

  return (
    <Sheet open={contact !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {contact && (
          <>
            <SheetHeader>
              <SheetTitle>{fullName(contact)}</SheetTitle>
              <SheetDescription>
                {contact.roleInHousehold ?? "Household member"}
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {contact.isPrimary && (
                  <Badge size="sm" variant="ghost" className="gap-1 bg-primary/12 text-primary">
                    <Shield aria-hidden className="size-3" />
                    Primary contact
                  </Badge>
                )}
                {deceased && (
                  <Badge size="sm" variant="ghost" className="gap-1 bg-muted text-muted-foreground">
                    <UserX aria-hidden className="size-3" />
                    Deceased
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-2 px-4 pb-4">
              <DetailRow
                icon={Cake}
                label="Date of birth"
                value={
                  contact.dateOfBirth
                    ? `${formatCalendarDate(contact.dateOfBirth)}${
                        age !== null ? ` · ${deceased ? "aged" : "age"} ${age}` : ""
                      }`
                    : NOT_AVAILABLE
                }
              />
              {deceased && (
                <DetailRow
                  icon={UserX}
                  label="Date of death"
                  value={formatCalendarDate(contact.deceasedAt)}
                />
              )}
              <DetailRow
                icon={Phone}
                label={deceased ? "Phone · do not call" : "Phone"}
                value={formatPhone(contact.phone)}
                href={
                  contact.phone && !deceased
                    ? `tel:${contact.phone.replace(/[^\d+]/g, "")}`
                    : undefined
                }
              />
              <DetailRow
                icon={Mail}
                label={deceased ? "Email · do not email" : "Email"}
                value={contact.email ?? NOT_AVAILABLE}
                href={contact.email && !deceased ? `mailto:${contact.email}` : undefined}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
