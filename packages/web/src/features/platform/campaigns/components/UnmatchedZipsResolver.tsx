import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The unmapped ZIPs a preview found, with somewhere to answer them (PAC-71).
 *
 * Apex's resolver flow, and the reason it exists: an unmapped ZIP is not an
 * error — the row still mails, on the default market and its phone. But that is
 * a piece printed with the wrong local-presence number, and the only person who
 * knows which market a ZIP belongs to is looking at this screen.
 *
 * Answers are saved onto the campaign **and** into the platform ZIP table, so
 * the next campaign starts with them. That is why the save re-previews: the
 * stats, the market split and the phones all change once a ZIP resolves.
 */
export function UnmatchedZipsResolver({
  zips,
  markets,
  saving,
  onSave,
}: {
  zips: string[];
  /** Markets already in play, offered as one-click fills. */
  markets: string[];
  saving: boolean;
  onSave: (resolutions: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const filled = Object.entries(values).filter(([, market]) => market.trim());

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {zips.length.toLocaleString()}{" "}
          {zips.length === 1 ? "ZIP has" : "ZIPs have"} no market. Those rows
          still mail — on the default market and its phone. Naming a market here
          saves it for every campaign after this one.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {zips.map((zip) => (
          <div key={zip} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-sm tabular-nums text-foreground">
              {zip}
            </span>
            <Input
              value={values[zip] ?? ""}
              onChange={(e) =>
                setValues((previous) => ({
                  ...previous,
                  [zip]: e.target.value,
                }))
              }
              placeholder="Market"
              className="h-8 border-border bg-card"
              list="campaign-market-suggestions"
              disabled={saving}
              aria-label={`Market for ZIP ${zip}`}
            />
          </div>
        ))}
      </div>

      {/* A datalist rather than a select: the market vocabulary is open — a new
          one is named the first time a campaign reaches it — so the existing
          names are suggestions, never the full set. */}
      <datalist id="campaign-market-suggestions">
        {markets.map((market) => (
          <option key={market} value={market} />
        ))}
      </datalist>

      <Button
        type="button"
        size="sm"
        disabled={saving || filled.length === 0}
        onClick={() =>
          onSave(
            Object.fromEntries(
              filled.map(([zip, market]) => [zip, market.trim()]),
            ),
          )
        }
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saving
          ? "Saving and re-previewing…"
          : `Save ${filled.length || ""} ${filled.length === 1 ? "market" : "markets"} and re-preview`}
      </Button>
    </div>
  );
}
