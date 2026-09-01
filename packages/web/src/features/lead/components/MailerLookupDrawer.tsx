import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH,
  mailerControlNumberKey,
} from "@sfa/shared";
import type { MailerLookupView } from "@sfa/shared";
import {
  CheckCircle2,
  ExternalLink,
  Search,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatAddress } from "@/lib/format-address";
import { logMailerLead, lookupMailer } from "@/lib/mailers-api";
import {
  formatCurrency,
  formatCurrencyExact,
  formatDate,
} from "./lead-display";

/** The query key, exported so the mutation and the drawer cannot disagree. */
export function mailerLookupKey(key: string) {
  return ["mailer-lookup", key] as const;
}

interface MailerLookupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Look a mail piece up by its Quote Control Number and log it as a lead
 * (PAC-61).
 *
 * Replaces legacy's three screens — a Mailers search page, a mailer detail
 * page, and a *Log Lead* button — with one drawer on the page the producer is
 * already on.
 *
 * ## What is deliberately not rendered
 *
 * Contact rows for `email`, `phone` and `dateOfBirth` appear **only when the
 * mailer has them**, which is usually never: measured on the real file, email
 * and date of birth are empty on 100% of rows and phone is present on 4.4%. A
 * permanent row of em-dashes reads as data that failed to load, when it is data
 * that will never arrive. Same for `address.county`, which the API returns as
 * `null` when it cannot resolve the FIPS code to a name.
 *
 * ## The premium
 *
 * `yearly` is the headline and `total` sits below it under a source label. They
 * are two different figures — they never agree on a single row of the real file
 * — and which one a producer should quote is still an open product question, so
 * neither is labelled "our quote". `yearly` leads because it is the mailed
 * offer and the only premium the legacy app ever displayed, which makes it the
 * number producers have been quoting all along.
 *
 * The layout comes from the `SidecarMailer` prototype in `management-alt`, but
 * none of its markup: that is a throwaway dashboard built on raw
 * `emerald-*`/`sky-*` values with no light theme.
 */
export function MailerLookupDrawer({
  open,
  onOpenChange,
}: MailerLookupDrawerProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");

  // Debounce the raw input and derive the key from it, so `#abc…` and `ABC…`
  // resolve to one cache entry instead of two requests.
  const debounced = useDebouncedValue(input, 300);
  const key = mailerControlNumberKey(debounced) ?? "";
  const isSearchable = key.length >= MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH;

  const query = useQuery({
    queryKey: mailerLookupKey(key),
    queryFn: () => lookupMailer(key),
    enabled: open && isSearchable,
    staleTime: 5 * 60_000,
  });

  const mailer = query.data ?? null;

  const logLead = useMutation({
    mutationFn: () => logMailerLead(mailer?.controlNumber ?? key),
    onSuccess: (result) => {
      toast.success(
        result.alreadyExisted
          ? "This mailer is already logged as a lead."
          : "Lead created from mailer.",
      );

      if (result.alreadyExisted) {
        // The existing lead may belong to another producer, in which case the
        // API withholds its id. Refetch rather than guess, so the footer offers
        // "View lead" only when the link would actually resolve.
        void queryClient.invalidateQueries({ queryKey: mailerLookupKey(key) });
      } else {
        // We created it, so it is ours and definitely reachable.
        queryClient.setQueryData(
          mailerLookupKey(key),
          (previous: MailerLookupView | null | undefined) =>
            previous
              ? {
                  ...previous,
                  alreadyLogged: true,
                  linkedLeadId: result.leadId,
                }
              : previous,
        );
      }

      // The new lead belongs on the list behind the drawer and in the Priority
      // Contact List. Nothing else caches leads by this control number.
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["hot-leads"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Couldn't log this mailer as a lead.");
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Cancel writes nothing and leaves nothing behind — reopening starts on
      // an empty field rather than on whoever was looked up last week.
      setInput("");
      logLead.reset();
    }
    onOpenChange(next);
  };

  const addressLine = mailer
    ? formatAddress({
        street: mailer.address.street ?? undefined,
        city: mailer.address.city ?? undefined,
        state: mailer.address.state ?? undefined,
        zip: mailer.address.zip ?? undefined,
      })
    : null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[440px] sm:max-w-[440px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <SheetTitle>Mailer lookup</SheetTitle>
          <SheetDescription>
            Enter the Quote Control Number printed on the mail piece.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="mailer-qcn"
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              Quote Control Number
            </Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="mailer-qcn"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="e.g. 0000bbbbbbbb"
                autoComplete="off"
                spellCheck={false}
                className="pl-9 font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Either the short code or the full number works.
            </p>
          </div>

          {!isSearchable && input.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Keep typing — a control number is at least{" "}
              {MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH} characters.
            </p>
          )}

          {isSearchable && query.isPending && <LookupSkeleton />}

          {isSearchable && query.isError && (
            <div className="space-y-3 rounded-xl border border-border bg-card px-5 py-4">
              <p className="text-sm text-destructive">
                Couldn't look that number up.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          )}

          {isSearchable && !query.isPending && !query.isError && !mailer && (
            <div className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No mailer found for{" "}
                <span className="font-mono text-foreground">{key}</span>.
              </p>
            </div>
          )}

          {mailer && (
            <>
              <MailerCard title="Recipient">
                <p className="text-base leading-tight font-semibold">
                  {mailer.name ?? "Name not on file"}
                </p>
                {addressLine && (
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">
                    {addressLine}
                  </p>
                )}

                {(mailer.doNotCall || mailer.doNotMail) && (
                  <SuppressionNotice
                    doNotCall={mailer.doNotCall}
                    doNotMail={mailer.doNotMail}
                  />
                )}

                {/*
                 * Only what the mailer actually has. Email and date of birth
                 * are empty on every real row and phone on all but 4% of them,
                 * so a row of dashes here would be three lies about missing
                 * data rather than one honest silence.
                 */}
                {(mailer.phone || mailer.email || mailer.dateOfBirth) && (
                  <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
                    {mailer.phone && <Row label="Phone" value={mailer.phone} />}
                    {mailer.email && <Row label="Email" value={mailer.email} />}
                    {mailer.dateOfBirth && (
                      <Row
                        label="Date of birth"
                        value={formatDate(mailer.dateOfBirth)}
                      />
                    )}
                  </dl>
                )}
              </MailerCard>

              <MailerCard title="Property">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fact label="Year built" value={mailer.yearBuilt} />
                  <Fact
                    label="Square footage"
                    value={
                      mailer.squareFeet
                        ? mailer.squareFeet.toLocaleString("en-US")
                        : null
                    }
                  />
                  {/* Omitted, not dashed, when the FIPS code has no name. */}
                  {mailer.address.county && (
                    <Fact label="County" value={mailer.address.county} />
                  )}
                </div>
              </MailerCard>

              {hasCoverage(mailer) && (
                <MailerCard title="Quoted coverage">
                  <dl className="space-y-1.5">
                    <Money
                      label="Dwelling (Cov A)"
                      value={mailer.coverage.dwelling}
                    />
                    <Money
                      label="Other structures (B)"
                      value={mailer.coverage.otherStructures}
                    />
                    <Money
                      label="Loss of use (D)"
                      value={mailer.coverage.lossOfUse}
                    />
                    <Money
                      label="Guest medical"
                      value={mailer.coverage.guestMedical}
                    />
                    <Money
                      label="Family liability"
                      value={mailer.coverage.familyLiability}
                    />
                  </dl>
                </MailerCard>
              )}

              <PremiumCard premium={mailer.premium} />

              <MailerCard title="Campaign">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    {mailer.campaign.weekNumber
                      ? `Week ${mailer.campaign.weekNumber}`
                      : "Week not recorded"}
                  </span>
                  {mailer.campaign.policyType && (
                    <span>· {mailer.campaign.policyType}</span>
                  )}
                  {mailer.campaign.product && (
                    <span>· {mailer.campaign.product}</span>
                  )}
                  {mailer.quoteDate && (
                    <span>· quoted {formatDate(mailer.quoteDate)}</span>
                  )}
                  {/*
                   * Only when the record genuinely carries one — the column
                   * exists in BigQuery and not in an uploaded file. Legacy
                   * invented a hard-coded 'Pending' here.
                   */}
                  {mailer.campaign.status && (
                    <Badge size="sm" variant="secondary">
                      {mailer.campaign.status}
                    </Badge>
                  )}
                </div>
              </MailerCard>
            </>
          )}
        </div>

        {mailer && (
          <SheetFooter className="shrink-0 gap-3 border-t border-border px-5 py-4">
            {mailer.alreadyLogged ? (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircle2 className="size-4" />
                  Logged to your pipeline
                </div>
                {mailer.linkedLeadId ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/leads/${mailer.linkedLeadId}`}>View lead</Link>
                  </Button>
                ) : (
                  // Someone else's lead. Saying so beats a link that would 404.
                  <p className="text-sm text-muted-foreground">
                    Already logged by another producer.
                  </p>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="brand"
                className="w-full"
                disabled={logLead.isPending}
                onClick={() => logLead.mutate()}
              >
                <Zap className="size-4" />
                {logLead.isPending ? "Logging…" : "Log lead into my pipeline"}
              </Button>
            )}

            {addressLine && (
              <Button asChild variant="outline" className="w-full">
                <a
                  href={`https://www.zillow.com/homes/${encodeURIComponent(addressLine)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-4" />
                  View property on Zillow
                </a>
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Whether any coverage figure came back — the card is hidden when none did. */
function hasCoverage(mailer: MailerLookupView): boolean {
  return Object.values(mailer.coverage).some((value) => value != null);
}

function MailerCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <h3 className="border-b border-border px-5 py-3 text-sm font-semibold text-card-foreground">
        {title}
      </h3>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm break-words">{value}</dd>
    </div>
  );
}

function Money({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{formatCurrency(value)}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value ?? "—"}</p>
    </div>
  );
}

/**
 * The suppression flags.
 *
 * A row rather than a badge, deliberately: a badge beside a name is something
 * you scan past, and a producer cold-calling a suppressed record is a real
 * compliance problem rather than a display detail. It does **not** block the
 * save — logging a lead is record-keeping, not outreach, and blocking it would
 * only push the producer into typing the prospect into the New Lead form by
 * hand, which loses the suppression signal entirely.
 */
function SuppressionNotice({
  doNotCall,
  doNotMail,
}: {
  doNotCall: boolean;
  doNotMail: boolean;
}) {
  const flags = [doNotCall && "call", doNotMail && "mail"].filter(Boolean);
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="text-sm text-destructive">
        Do not {flags.join(" or ")} — this record is on the suppression list.
      </p>
    </div>
  );
}

/**
 * Both premiums, with the mailed offer leading.
 *
 * `total` is not a restatement of `yearly` — across the whole reference file
 * they never match on a single row and the ratio spans 0.46–2.95 — so it is
 * shown rather than hidden, under a label that says where it came from. Exact
 * cents on purpose: `formatCurrency` rounds to whole dollars and would print
 * `$1,963` where the piece in the prospect's hand says `$1,962.87`.
 */
function PremiumCard({ premium }: { premium: MailerLookupView["premium"] }) {
  if (
    premium.yearly == null &&
    premium.monthly == null &&
    premium.total == null
  ) {
    return null;
  }

  return (
    <MailerCard title="Premium (as mailed)">
      <div className="flex items-baseline gap-3">
        <p className="text-lg font-semibold tabular-nums">
          {premium.yearly != null
            ? `${formatCurrencyExact(premium.yearly)} / year`
            : "Not on the mail file"}
        </p>
        {premium.monthly != null && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {formatCurrencyExact(premium.monthly)} / month
          </p>
        )}
      </div>

      {premium.total != null && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Also on the mail file
          </p>
          <dl className="mt-1.5">
            <Money label="Total premium" value={premium.total} />
          </dl>
        </div>
      )}
    </MailerCard>
  );
}

function LookupSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl border border-border bg-card px-5 py-4"
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
