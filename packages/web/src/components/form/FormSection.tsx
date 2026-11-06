import { cn } from "@/lib/utils";

interface FormSectionProps {
  /**
   * The panel's heading, in sentence case. Omit for a bare panel — `SoldDealWizard`'s
   * shell has its own progress header instead.
   */
  title?: React.ReactNode;
  /**
   * Sub-line under the heading. Stands on its own without a `title` — the
   * paginated intake form names each card in its progress header, so the card
   * itself is a bare panel that still has something to explain.
   */
  description?: React.ReactNode;
  /**
   * Rendered to the right of the heading, on the same row. `LeadContextHeader`
   * puts the lead-status badge here.
   */
  action?: React.ReactNode;
  /** Heading element. `PolicySummaryList` is an `h3` under the page's `h2`. */
  titleAs?: "h2" | "h3";
  /** Merged over the base — `PolicySummaryList` tightens to `space-y-3`. */
  className?: string;
  children: React.ReactNode;
}

/**
 * A form panel — the card that groups one set of related fields.
 *
 * Replaces the `rounded-xl bg-card border border-border p-4 md:p-5 space-y-4`
 * string that was pasted at 12 `<section>` sites, and the `SectionHeading`
 * helper that was defined byte-identically in both `LeadIntakeForm` and
 * `QuoteRecapForm`.
 *
 * **Library-agnostic on purpose.** This tier knows nothing about the form
 * library — that seam is what keeps a binding-layer change (react-hook-form →
 * TanStack Form) from touching layout. Field binding lives in `./fields`.
 *
 * A `<section>` rather than shadcn's `Card`: these are landmarks, `Card` renders
 * a `<div>` with no `asChild`, and `/f/lead/:token` is a public page where the
 * landmark structure is the one accessibility affordance the form has.
 */
export function FormSection({
  title,
  description,
  action,
  titleAs: Title = "h2",
  className,
  children,
}: FormSectionProps) {
  return (
    <section
      className={cn(
        "rounded-xl bg-card border border-border p-4 md:p-5 space-y-4",
        className,
      )}
    >
      {title || description || action ? (
        // The heading block is always one child of `space-y-4`, so the vertical
        // rhythm is the same whether or not there is a description. Heading and
        // sub-line stack on the left; `action` sits on the right of the same
        // row — `LeadContextHeader` puts a status badge there, the review
        // steps an Edit button.
        <div
          className={
            action ? "flex items-start justify-between gap-3" : undefined
          }
        >
          <div className="min-w-0">
            {title ? (
              // The card-title role from `styles/TYPOGRAPHY.md`. This was a
              // 10px uppercase muted micro-label, which read as a field label
              // rather than the heading of the panel.
              <Title className="text-base font-semibold text-card-foreground">
                {title}
              </Title>
            ) : null}
            {description ? (
              // `mt-1` only when it is sitting under a heading; on its own it
              // is the first thing in the panel and needs no lead-in.
              <p
                className={cn(
                  "text-sm text-muted-foreground",
                  title && "mt-1",
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
