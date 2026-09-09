import { Phone, Mail, MapPin, Star, Shield, Car, UserCog } from "lucide-react";
import type { ContactSummary, HouseholdView } from "@sfa/shared";
import {
  isActiveHouseholdStatus,
  normalizeHouseholdStatus,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/leads-api";

interface Member {
  id: string;
  name: string;
  role: string;
  initials: string;
  tone: string;
  tint: string;
  isPrimary?: boolean;
  isDriver?: boolean;
  isDeceased?: boolean;
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
      id: contact.id,
      name,
      role,
      initials: initialsOf(name),
      ...MEMBER_ACCENTS[i % MEMBER_ACCENTS.length],
      isPrimary: contact.isPrimary,
      isDriver: /driver/i.test(role),
      // Still on the roster (PAC-91 §7) — they are on this household's
      // policies and its history. Marked, not hidden.
      isDeceased: Boolean(contact.deceasedAt),
    };
  });
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
  /**
   * Opens the "change primary contact" dialog (PAC-91 §7). Omitted — and the
   * control not rendered — when the caller cannot write, or on the demo
   * household, which is not a real record to write against.
   */
  onChangePrimaryContact?: () => void;
}

export function HouseholdProfile({
  household,
  isDemo = false,
  onChangePrimaryContact,
}: HouseholdProfileProps) {
  const primaryContact = household.contacts.find((c) => c.isPrimary);
  /*
   * The primary contact has died (PAC-91 §7).
   *
   * Their name goes on rendering — this is the household's record and they led
   * it — but the two rows below stop being ways to reach anybody: no
   * click-to-call, no mailto. That is the distinction §7 draws between history,
   * which keeps the name, and anything forward-looking, which does not.
   */
  const primaryDeceased = Boolean(
    household.primaryContactDeceasedAt ?? primaryContact?.deceasedAt,
  );

  // Normalised, not raw (PAC-80): most migrated records carry an opaque code
  // rather than a word. The name and the `HH-…` record number are rendered by
  // the page header, so neither is recomputed here.
  const status = normalizeHouseholdStatus(household.status) || "Unknown";
  /*
   * All three arrive resolved from `GET /households/:id`, which follows the
   * household's `primaryContactId` (see `pickPrimaryContact`). The API is the
   * only layer that can see that ref, and since PAC-91 §4 it is the only source
   * of these values — the household stores no copy of them, so there is no
   * stale name left to fall back past.
   */
  const contactName = household.primaryContactName ?? "—";
  const phone = household.primaryPhone;
  const email = household.primaryEmail;
  const members = toMembers(household);
  /*
   * Already coerced server-side. This block used to read `line1`/`postalCode`
   * off the raw `propertyAddress`, and `postalCode` is a key no writer produces
   * while `line1` only matches the demo seed — so every migrated household
   * showed two em dashes here.
   */
  const address = household.address;
  const cityLine = address
    ? [address.city, address.state, address.zip].filter(Boolean).join(", ")
    : "";

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
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionLabel>Primary contact</SectionLabel>
          {/* The operation that did not exist before PAC-91 §7. Offered whether
              or not the household has a primary today, because "nobody leads
              this yet" is one of the states it fixes. */}
          {onChangePrimaryContact && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onChangePrimaryContact}
            >
              <UserCog size={12} />
              Change
            </Button>
          )}
        </div>

        {/* Two different absences, said differently. `no_primary` means somebody
            decided to leave the seat open — usually after a death with nobody
            to promote — and it is a task for the office. A household that
            simply never had a primary is not flagged and reads as the em dash
            below. */}
        {household.dataQuality === "no_primary" && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-foreground">
            This household is deliberately without a primary contact and needs
            one named.
          </p>
        )}

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
              {primaryDeceased
                ? "Deceased"
                : (primaryContact?.roleInHousehold ?? "Account holder")}
            </p>
          </div>
          {primaryContact && !primaryDeceased && (
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
            // Formatted on read: a migrated contact's phone is stored as digits
            // (PAC-91 §1 normalises every writer), so the raw value would show
            // as `9188082556`.
            value={formatPhone(phone)}
            caption={
              primaryDeceased
                ? "On file for this record — do not call"
                : phone
                  ? "Mobile · Click to call"
                  : "No phone on file"
            }
            href={
              phone && !primaryDeceased
                ? `tel:${phone.replace(/[^\d+]/g, "")}`
                : undefined
            }
          />
          <ContactRow
            icon={Mail}
            iconTone="text-success"
            value={email ?? "—"}
            caption={
              primaryDeceased
                ? "On file for this record — do not email"
                : email
                  ? "Primary email"
                  : "No email on file"
            }
            href={email && !primaryDeceased ? `mailto:${email}` : undefined}
          />
          <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2">
            <MapPin
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {address?.street || "—"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {cityLine || "—"}
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
              // Keyed by id, not name: two members of one household can share a
              // name (a junior), and a duplicate React key drops one of them.
              key={m.id}
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
                  {m.isDeceased ? `${m.role} · Deceased` : m.role}
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
