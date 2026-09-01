import { Phone, Mail, MapPin, Star, Shield, Car } from "lucide-react";
import type { ContactSummary, HouseholdView } from "@sfa/shared";
import {
  isActiveHouseholdStatus,
  normalizeHouseholdStatus,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Member {
  name: string;
  role: string;
  initials: string;
  tone: string;
  tint: string;
  isPrimary?: boolean;
  isDriver?: boolean;
}

/**
 * No backing data on the Household schema, so these are demo-only. Deriving
 * them (Multi-Policy from policy count, Renewal Due from the earliest
 * renewalDate) is tracked separately; Auto-Pay / Paperless need new fields.
 */
const demoTags = ["Multi-Policy", "Auto-Pay", "Paperless", "Renewal Due: Aug"];

/**
 * Avatar accents, cycled by roster position.
 *
 * Paired classes rather than the raw hex these used to be — the tiles were
 * built as `${hex}20` / `${hex}40` string concatenations in an inline `style`,
 * which Tailwind cannot see and the theme cannot re-tint.
 */
const MEMBER_ACCENTS = [
  { tone: "text-sky-600 dark:text-sky-400", tint: "bg-sky-400/12" },
  { tone: "text-success", tint: "bg-success/12" },
  { tone: "text-amber-600 dark:text-amber-500", tint: "bg-amber-500/15" },
  { tone: "text-violet-600 dark:text-violet-400", tint: "bg-violet-400/12" },
  { tone: "text-pink-600 dark:text-pink-400", tint: "bg-pink-400/12" },
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function fullName(contact: ContactSummary | undefined): string | null {
  if (!contact) return null;
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null
  );
}

function toMembers(household: HouseholdView): Member[] {
  return household.contacts.map((contact, i) => {
    const name = fullName(contact) ?? "Unnamed";
    const role = contact.roleInHousehold ?? "Household Member";
    return {
      name,
      role,
      initials: initialsOf(name),
      ...MEMBER_ACCENTS[i % MEMBER_ACCENTS.length],
      isPrimary: contact.isPrimary,
      isDriver: /driver/i.test(role),
    };
  });
}

function addressLines(address: Record<string, unknown> | null) {
  const get = (key: string) =>
    typeof address?.[key] === "string" ? (address[key] as string) : "";
  const line1 = get("line1");
  const rest = [get("city"), get("state"), get("postalCode")]
    .filter(Boolean)
    .join(", ");
  return { line1, rest };
}

/**
 * The green "live" treatment is only honest for a genuinely active record.
 *
 * `isActiveHouseholdStatus` rather than a bare `/active/i` (PAC-80): 2,095 of
 * 2,519 migrated households store the code `b5qvJ`, which the regex never
 * matched — so every one of them rendered grey and read as inactive.
 */
function statusClass(status: string | null) {
  return isActiveHouseholdStatus(status)
    ? "bg-success/12 text-success"
    : "bg-muted text-muted-foreground";
}

/** Contact rows are links only when there is something to link to. */
function ContactRow({
  icon: Icon,
  iconTone,
  value,
  caption,
  href,
}: {
  icon: typeof Phone;
  iconTone: string;
  value: string;
  caption: string;
  href?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden className={cn("size-4 shrink-0", iconTone)} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {value}
        </span>
        <span className="block text-xs text-muted-foreground">{caption}</span>
      </span>
    </>
  );

  const className =
    "flex items-center gap-2.5 rounded-md bg-muted px-3 py-2 text-left";
  if (!href) {
    return <div className={className}>{body}</div>;
  }
  return (
    <a
      href={href}
      className={cn(className, "transition-colors hover:bg-accent")}
    >
      {body}
    </a>
  );
}

interface HouseholdProfileProps {
  household: HouseholdView;
  /**
   * Enables the blocks with no backing data (tags, retention score). Live
   * records omit them rather than showing invented values.
   */
  isDemo?: boolean;
}

export function HouseholdProfile({ household, isDemo = false }: HouseholdProfileProps) {
  const primaryContact = household.contacts.find((c) => c.isPrimary);

  // Normalised, not raw (PAC-80): most migrated records carry an opaque code
  // rather than a word. The name and the `HH-…` record number are rendered by
  // the page header, so neither is recomputed here.
  const status = normalizeHouseholdStatus(household.status) || "Unknown";
  // Falling back to the primary contact is real data, not a placeholder.
  const contactName =
    household.primaryContactName ?? fullName(primaryContact) ?? "—";
  const phone = household.primaryPhones[0] ?? primaryContact?.phones[0] ?? null;
  const email = household.primaryEmails[0] ?? primaryContact?.emails[0] ?? null;
  const members = toMembers(household);
  const address = addressLines(household.propertyAddress);

  return (
    // Same as the portfolio column: a scrolling block rather than a flex
    // column, so these sections stack at their natural height instead of
    // compressing to fit.
    <div className="h-full min-h-0 overflow-y-auto">
      {/* Status. The household's name *and* its `HH-…` record number are both
          in the page header, so neither is repeated here. */}
      <div className="border-b border-border px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Status</SectionLabel>
          <Badge size="sm" variant="ghost" className={cn("gap-1.5", statusClass(household.status))}>
            {isActiveHouseholdStatus(household.status) && (
              <span
                aria-hidden
                className="size-2 animate-pulse rounded-full bg-success"
              />
            )}
            {status}
          </Badge>
        </div>

        {isDemo && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {demoTags.map((tag) => (
              <Badge key={tag} size="sm" variant="outline" className="text-muted-foreground">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Primary Contact */}
      <div className="border-b border-border px-4 py-4 md:px-5">
        <SectionLabel className="mb-3">Primary contact</SectionLabel>

        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
          >
            {initialsOf(contactName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">
              {contactName}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {primaryContact?.roleInHousehold ?? "Account holder"}
            </p>
          </div>
          {primaryContact && (
            <Star
              aria-label="Primary contact"
              className="ml-auto size-4 shrink-0 fill-amber-500 text-amber-600 dark:fill-amber-400 dark:text-amber-400"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <ContactRow
            icon={Phone}
            iconTone="text-primary"
            value={phone ?? "—"}
            caption={phone ? "Mobile · Click to call" : "No phone on file"}
            href={phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined}
          />
          <ContactRow
            icon={Mail}
            iconTone="text-success"
            value={email ?? "—"}
            caption={email ? "Primary email" : "No email on file"}
            href={email ? `mailto:${email}` : undefined}
          />
          <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2">
            <MapPin
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {address.line1 || "—"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {address.rest || "—"}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Household Roster */}
      <div className="border-b border-border px-4 py-4 md:px-5">
        <SectionLabel className="mb-3">Household roster</SectionLabel>
        <div className="flex flex-col gap-2">
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">No contacts on file.</p>
          )}
          {members.map((m) => (
            <div
              key={m.name}
              className="flex items-center gap-3 rounded-md border border-border bg-muted px-3 py-2.5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  m.tint,
                  m.tone,
                )}
              >
                {m.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {m.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.role}
                </p>
              </div>
              {m.isPrimary && (
                <Shield
                  aria-label="Primary insured"
                  className="size-4 shrink-0 text-primary"
                />
              )}
              {m.isDriver && (
                <Car
                  aria-label="Driver"
                  className="size-4 shrink-0 text-amber-600 dark:text-amber-500"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Retention Score — decorative, nothing computes it. Demo only: it reads
          as a risk metric an agent could act on, so a live record must not
          show a number we did not calculate. */}
      {isDemo && (
        <div className="px-4 py-4 md:px-5">
          <SectionLabel className="mb-3">Retention score</SectionLabel>
          <div className="mb-2 flex items-end gap-2">
            <span className="text-3xl font-semibold tabular-nums text-success">
              87
            </span>
            <span className="mb-1 text-sm text-muted-foreground">
              / 100 · High
            </span>
          </div>
          <Progress value={87} className="h-1.5" />
          <p className="mt-2 text-sm text-muted-foreground">
            Last renewal: Aug 2024 · No lapses
          </p>
        </div>
      )}
    </div>
  );
}
