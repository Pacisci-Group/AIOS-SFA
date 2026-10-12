/**
 * Chart colours (PAC-152, part 2 — the first charts in the app).
 *
 * The five `--chart-*` theme tokens, in a **fixed order**: series 1 is always
 * `--chart-1`. They are validated as a categorical palette against `--card` in
 * both themes (lightness band, chroma, colour-blind and normal-vision
 * separation, 3:1 contrast — see the dark block of `theme.css`). A sixth
 * series is never a generated hue: it folds into "Other", drawn in the muted
 * ink so it reads as the remainder rather than as a peer.
 *
 * Colour carries identity only. Every chart has a legend (two or more series)
 * and the table beneath it, so nothing is told by colour alone.
 */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** The remainder, and the comparison period. */
export const MUTED_COLOR = "var(--muted-foreground)";

export const MAX_SERIES = SERIES_COLORS.length;

/** A CSS-safe chart key for a series index — `ChartConfig` keys become CSS variables. */
export const seriesKey = (index: number) => `s${index}`;
export const OTHER_KEY = "other";

export interface ChartSeries {
  /** The data key in a chart row. */
  dataKey: string;
  label: string;
  color: string;
  /** The API keys this series stands for — several for "Other". */
  members: (string | null)[];
}

/**
 * The first `MAX_SERIES` series in the order given (the server orders them by
 * premium, the null bucket last), then everything else as one "Other".
 */
export function foldSeries(
  series: readonly { key: string | null; label: string }[],
): ChartSeries[] {
  const shown = series.length > MAX_SERIES ? series.slice(0, MAX_SERIES - 1) : series;
  const folded: ChartSeries[] = shown.map((entry, index) => ({
    dataKey: seriesKey(index),
    label: entry.label,
    color: SERIES_COLORS[index],
    members: [entry.key],
  }));
  if (series.length > MAX_SERIES) {
    folded.push({
      dataKey: OTHER_KEY,
      label: "Other",
      color: MUTED_COLOR,
      members: series.slice(MAX_SERIES - 1).map((entry) => entry.key),
    });
  }
  return folded;
}
