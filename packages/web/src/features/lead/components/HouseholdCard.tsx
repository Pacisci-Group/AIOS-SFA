import { Users, ChevronRight, Car, Home, Umbrella } from "lucide-react";

interface HouseholdMember {
  name: string;
  relation: string;
  dob: string;
  initials: string;
  color: string;
  policies: string[];
}

const members: HouseholdMember[] = [
  {
    name: "Anurodh Vaidya",
    relation: "Primary",
    dob: "04/12/1978",
    initials: "AV",
    color: "var(--sky)",
    policies: ["Auto"],
  },
  {
    name: "Meena Vaidya",
    relation: "Spouse",
    dob: "09/03/1980",
    initials: "MV",
    color: "#8b5cf6",
    policies: ["Auto"],
  },
  {
    name: "Priya Vaidya",
    relation: "Dependent",
    dob: "02/14/2008",
    initials: "PV",
    color: "var(--amber)",
    policies: [],
  },
];

const policyIcons: Record<string, React.ElementType> = {
  Auto: Car,
  Home: Home,
  Umbrella: Umbrella,
};

export function HouseholdCard() {
  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-muted-foreground" />
          <h3 className="text-sm text-card-foreground" style={{ fontWeight: 600 }}>Household</h3>
        </div>
        <button className="flex items-center gap-1 text-xs hover:opacity-80 transition-opacity" style={{ color: "var(--sky)" }}>
          View all <ChevronRight size={12} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2">
        {members.map((m) => (
          <div
            key={m.name}
            className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <div
              className="size-8 rounded-full flex items-center justify-center text-white shrink-0"
              style={{ background: m.color, fontSize: 11, fontWeight: 700 }}
            >
              {m.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-card-foreground truncate" style={{ fontWeight: 500 }}>{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.relation} · DOB {m.dob}</p>
            </div>
            <div className="flex gap-1">
              {m.policies.map((p) => {
                const Icon = policyIcons[p] || Car;
                return (
                  <div key={p} className="size-5 rounded flex items-center justify-center" style={{ background: "var(--muted)" }}>
                    <Icon size={10} className="text-muted-foreground" />
                  </div>
                );
              })}
              {m.policies.length === 0 && (
                <span className="text-xs text-muted-foreground/60 italic">No policies</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
