import { Phone, Mail, MapPin, Star, Shield, Car } from "lucide-react";
import type { HouseholdView } from "@sfa/shared";

interface Member {
  name: string;
  role: string;
  initials: string;
  color: string;
  isPrimary?: boolean;
  isDriver?: boolean;
}

const mockMembers: Member[] = [
  { name: "Jessica Cobb", role: "Primary Insured", initials: "JC", color: "#3b82f6", isPrimary: true },
  { name: "Tyler Cobb", role: "Spouse", initials: "TC", color: "#10b981" },
  { name: "Driver Token", role: "Teen Driver · Excluded", initials: "DT", color: "#f59e0b", isDriver: true },
];

/** No backing data on the Household schema — kept static rather than fabricated. */
const tags = ["Multi-Policy", "Auto-Pay", "Paperless", "Renewal Due: Aug"];

const MEMBER_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ec4899"];

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function toMembers(household: HouseholdView): Member[] {
  return household.contacts.map((contact, i) => {
    const name =
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      "Unnamed";
    const role = contact.roleInHousehold ?? "Household Member";
    return {
      name,
      role,
      initials: initialsOf(name),
      color: MEMBER_COLORS[i % MEMBER_COLORS.length],
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

interface HouseholdProfileProps {
  /** Live record. When omitted the component renders its original mock data. */
  household?: HouseholdView;
}

export function HouseholdProfile({ household }: HouseholdProfileProps) {
  const name = household?.name ?? "The Cobb Household";
  const status = household?.status ?? "Active";
  const recordLabel = household
    ? `HH-${household.id.slice(-6).toUpperCase()}`
    : "HH-2614 · Allstate Agency";
  const contactName = household?.primaryContactName ?? "Jessica Cobb";
  const phone = household?.primaryPhones[0] ?? "(404) 555-0182";
  const email = household?.primaryEmails[0] ?? "jessica.cobb@email.com";
  const members = household ? toMembers(household) : mockMembers;

  const address = household
    ? addressLines(household.propertyAddress)
    : { line1: "412 Magnolia Lane", rest: "Alpharetta, GA 30022" };

  return (
    <div className="flex flex-col gap-0 h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      {/* Header */}
      <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-xs font-mono" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
              {recordLabel}
            </p>
            <h1 className="mt-0.5" style={{ color: "var(--foreground)" }}>{name}</h1>
          </div>
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "#052e16", color: "#4ade80", border: "1px solid #166534" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {status}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded text-xs" style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Primary Contact */}
      <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
          Primary Contact
        </p>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#1e3a5f", border: "2px solid #3b82f6" }}>
            <span className="text-sm font-semibold text-blue-400">{initialsOf(contactName)}</span>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{contactName}</p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {household ? "Account holder" : "Account Holder since 2018"}
            </p>
          </div>
          <div className="ml-auto">
            <Star size={14} className="text-amber-400 fill-amber-400" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors hover:bg-white/5 group"
            style={{ background: "var(--muted)" }}
          >
            <Phone size={14} style={{ color: "#3b82f6" }} />
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{phone}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Mobile · Click to call</p>
            </div>
          </a>
          <a
            href={`mailto:${email}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
            style={{ background: "var(--muted)" }}
          >
            <Mail size={14} style={{ color: "#10b981" }} />
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{email}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Primary email</p>
            </div>
          </a>
          <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg" style={{ background: "var(--muted)" }}>
            <MapPin size={14} style={{ color: "var(--muted-foreground)", marginTop: "2px" }} />
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{address.line1 || "—"}</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{address.rest || "—"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Household Roster */}
      <div className="p-5 border-b" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
          Household Roster
        </p>
        <div className="flex flex-col gap-2">
          {members.length === 0 && (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              No contacts on file.
            </p>
          )}
          {members.map((m) => (
            <div
              key={m.name}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-white/5"
              style={{ border: "1px solid var(--border)", background: "var(--muted)" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                style={{ background: `${m.color}20`, color: m.color, border: `1px solid ${m.color}40` }}
              >
                {m.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{m.name}</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{m.role}</p>
              </div>
              {m.isPrimary && <Shield size={12} style={{ color: "#3b82f6" }} />}
              {m.isDriver && <Car size={12} style={{ color: "#f59e0b" }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Account Score — decorative, no backing data. */}
      <div className="p-5">
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
          Retention Score
        </p>
        <div className="flex items-end gap-2 mb-2">
          <span className="text-3xl font-semibold" style={{ color: "#4ade80", fontFamily: "'JetBrains Mono', monospace" }}>87</span>
          <span className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>/ 100 · High</span>
        </div>
        <div className="w-full h-1.5 rounded-full" style={{ background: "var(--secondary)" }}>
          <div className="h-full rounded-full" style={{ width: "87%", background: "linear-gradient(90deg, #3b82f6, #4ade80)" }} />
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)" }}>Last renewal: Aug 2024 · No lapses</p>
      </div>
    </div>
  );
}
