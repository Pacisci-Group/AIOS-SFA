import type { OwnerLobMix } from "@/lib/owner-dashboard-api";
import { cn } from "@/lib/utils";

/**
 * Slice fills, largest first. Tokens only, stepping down in weight, so the bar
 * reads in both themes; "Other" is the neutral surface because it is the
 * remainder, not a fourth line of business.
 */
const SLICE_FILLS = ["bg-primary", "bg-success", "bg-primary/40"] as const;

/**
 * Line-of-business mix: the top three policy types by share of **policies**
 * sold, plus everything else (PAC-135).
 *
 * The mockup's bar had two segments that always filled it. Three named types do
 * not add up to 100, so the rest is drawn as "Other" — a bar that silently
 * stretched three slices to full width would overstate every one of them.
 */
export function LobMixBar({ mix }: { mix: OwnerLobMix }) {
  if (mix.policyCount === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No policies sold in this period.
      </p>
    );
  }

  const slices = [
    ...mix.top.map((slice, index) => ({
      label: slice.policyType,
      pct: slice.pct,
      fill: SLICE_FILLS[index] ?? "bg-muted-foreground/30",
    })),
    ...(mix.otherPct > 0
      ? [{ label: "Other", pct: mix.otherPct, fill: "bg-muted-foreground/30" }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={slices.map((s) => `${s.label} ${s.pct}%`).join(", ")}
      >
        {slices.map((slice) => (
          <div
            key={slice.label}
            className={slice.fill}
            style={{ width: `${slice.pct}%` }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {slices.map((slice) => (
          <li
            key={slice.label}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className={cn("size-2 rounded-full", slice.fill)} />
            {slice.label}{" "}
            <span className="font-medium text-foreground tabular-nums">
              {slice.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
