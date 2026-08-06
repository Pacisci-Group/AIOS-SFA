import { cn } from "@/lib/utils";

interface FormSubPanelProps {
  /**
   * The small uppercase heading — "Policy 1", "Escrow details", "Which
   * drivers?". Omit for an unlabelled panel (`ProofField` opens with a prompt
   * instead).
   */
  title?: React.ReactNode;
  /**
   * Heading element. `<span>` for array-row labels, which are captions rather
   * than document structure; `<h4>` where the panel is a real subsection.
   */
  titleAs?: "span" | "h4";
  /**
   * Right-aligned slot on the heading row — the remove button on array rows.
   *
   * Passing `null` still reserves the row, which is what the array rows want:
   * `PolicyRowsField` hides its remove button at a single row, and the heading
   * must not reflow when it appears. Omit the prop entirely for panels that
   * never have an action.
   */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A panel nested *inside* a {@link FormSection} — one repeated array row, or a
 * conditional block revealed by a toggle.
 *
 * Replaces the `rounded-lg border border-border bg-background/40 p-3 space-y-3`
 * string pasted at 5 sites, and the `flex items-center justify-between` heading
 * row duplicated in `PolicyRowsField` and `HouseholdMembersField`.
 *
 * Two lookalikes are deliberately **not** routed through this:
 * - `PolicySummaryList`'s `<li>` is a flex row with no `space-y-3`; forcing it
 *   in would mean an `as` prop plus fighting the base spacing off again.
 * - `FileDropzone`'s panel is `rounded-xl … p-4` — a different thing that only
 *   looks similar.
 */
export function FormSubPanel({
  title,
  titleAs: Title = "span",
  action,
  className,
  children,
}: FormSubPanelProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background/40 p-3 space-y-3",
        className,
      )}
    >
      {action !== undefined ? (
        <div className="flex items-center justify-between">
          {title ? (
            <Title className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {title}
            </Title>
          ) : null}
          {action}
        </div>
      ) : title ? (
        <Title className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {title}
        </Title>
      ) : null}
      {children}
    </div>
  );
}
