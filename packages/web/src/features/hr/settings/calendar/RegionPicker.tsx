import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getHolidayRegions, hrKeys } from "@/lib/hr-api";

const NONE = "__none__";

interface RegionPickerProps {
  country: string | null;
  region: string | null;
  onChange: (next: { country: string | null; region: string | null }) => void;
  disabled?: boolean;
  /** `sm:grid-cols-2` by default; the wizard's region line stacks them. */
  className?: string;
}

/**
 * Country and state/province, as `date-holidays` keys them (PAC-161). Feeds
 * the holiday suggestions and the Q4 proposal job and nothing else. Shared by
 * the Working week card and the owner's holiday step, so the two cannot drift
 * on what "where the agency is" means. Changing the country clears the region.
 */
export function RegionPicker({
  country,
  region,
  onChange,
  disabled = false,
  className = "grid gap-4 sm:grid-cols-2",
}: RegionPickerProps) {
  const regionsQuery = useQuery({
    queryKey: hrKeys.regions(country),
    queryFn: () => getHolidayRegions(country),
    enabled: !disabled,
  });

  return (
    <div className={className}>
      <div className="space-y-2">
        <Label htmlFor="hr-country">Country</Label>
        <Select
          value={country ?? NONE}
          disabled={disabled}
          onValueChange={(value) =>
            onChange({ country: value === NONE ? null : value, region: null })
          }
        >
          <SelectTrigger id="hr-country" className="w-full bg-card border-border">
            <SelectValue placeholder="Choose a country" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>Not set</SelectItem>
            {(regionsQuery.data?.countries ?? (country ? [{ code: country, name: country }] : [])).map(
              (option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.name}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="hr-region">State or province</Label>
        <Select
          value={region ?? NONE}
          disabled={disabled || !country}
          onValueChange={(value) =>
            onChange({ country, region: value === NONE ? null : value })
          }
        >
          <SelectTrigger id="hr-region" className="w-full bg-card border-border">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>None</SelectItem>
            {(regionsQuery.data?.regions ?? (region ? [{ code: region, name: region }] : [])).map(
              (option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.name}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
