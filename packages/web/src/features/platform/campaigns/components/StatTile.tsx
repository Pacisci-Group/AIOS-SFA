/**
 * One number from a campaign run.
 *
 * Lifted from the deleted Add Mailers `ImportReport`, which had exactly this
 * tile and is the layout the campaign screens inherit. Takes a pre-formatted
 * string rather than a number, because half the tiles carry a pair
 * (`19,053 · 95.2%`) or a triple (min · avg · max) and a `value: number` prop
 * would push that formatting back out to every call site.
 */
export function StatTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-sunken px-3 py-2">
      <p className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="text-sm tabular-nums text-foreground">{value}</p>
    </div>
  );
}
