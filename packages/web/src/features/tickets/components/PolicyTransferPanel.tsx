import type { PolicyTransferRef } from "@sfa/shared";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

interface PolicyTransferPanelProps {
  transfer: PolicyTransferRef;
}

/**
 * The transfer booked from this ticket, read-only.
 *
 * Read-only on purpose, and unlike the onboarding and renewal panels beside it
 * there is nothing to act on: a transfer is written once. It replaces the
 * "Policy Transfer" action in the header rather than sitting alongside it —
 * one transfer per ticket, so once it exists the action is spent.
 *
 * The premium delta is the number the CSR actually reports back to the client,
 * so it leads. Negative is a saving, which is the usual reason for a transfer.
 */
export function PolicyTransferPanel({ transfer }: PolicyTransferPanelProps) {
  const delta = transfer.premiumDelta;
  const saving = delta !== null && delta < 0;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Policy transfer
        </h3>
        <span className="text-xs text-muted-foreground">
          {shortDate(transfer.transferDate)}
        </span>
      </div>

      <div className="space-y-2">
        {transfer.pairs.map((pair) => (
          <div
            key={pair.toPolicyId}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-muted-foreground line-through">
                {pair.fromPolicyNumber ?? "No number"}
              </span>
              <span className="block text-muted-foreground">
                {money(pair.fromPremium)}
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-right">
              <span className="block truncate font-medium text-foreground">
                {pair.toPolicyNumber ?? "No number"}
              </span>
              <span className="block text-muted-foreground">
                {money(pair.toPremium)}
              </span>
            </span>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Transferred premium</dt>
          <dd className="font-medium text-foreground">
            {money(transfer.premium)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Change</dt>
          <dd
            className={`font-medium ${saving ? "text-success" : "text-foreground"}`}
          >
            {delta === null
              ? "—"
              : `${delta > 0 ? "+" : ""}${money(delta)}${saving ? " saved" : ""}`}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Recorded by</dt>
          <dd className="text-foreground">
            {transfer.recordedByName} · {shortDate(transfer.recordedAt)}
          </dd>
        </div>
      </dl>

      {/*
        Booked as company transfer, not a sale — stated on the record rather
        than left to the reader, because it is the whole point of the feature
        and invisible from the numbers alone.
      */}
      <p className="text-xs text-muted-foreground">
        Recorded as a company transfer. It does not count towards new business.
      </p>

      {transfer.dealAuditId && (
        <Link
          to="/dashboard/producer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          View the hand-off checklist
        </Link>
      )}
    </div>
  );
}
