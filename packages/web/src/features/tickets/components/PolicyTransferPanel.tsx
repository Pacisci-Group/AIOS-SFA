import type { PolicyTransferRef } from "@sfa/shared";
import { ArrowLeftRight, ArrowRight, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <DetailCard
      title="Policy transfer"
      icon={ArrowLeftRight}
      action={
        <span className="text-sm text-muted-foreground">
          {shortDate(transfer.transferDate)}
        </span>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {transfer.pairs.map((pair) => (
            <div
              key={pair.toPolicyId}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-muted-foreground line-through">
                  {pair.fromPolicyNumber ?? "No number"}
                </span>
                <span className="block tabular-nums text-muted-foreground">
                  {money(pair.fromPremium)}
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 text-right">
                <span className="block truncate font-medium text-foreground">
                  {pair.toPolicyNumber ?? "No number"}
                </span>
                <span className="block tabular-nums text-muted-foreground">
                  {money(pair.toPremium)}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <DataRow
            label="Transferred premium"
            value={
              <span className="font-medium tabular-nums">
                {money(transfer.premium)}
              </span>
            }
          />
          <DataRow
            label="Change"
            value={
              <span
                className={cn(
                  "font-medium tabular-nums",
                  saving && "text-success",
                )}
              >
                {delta === null
                  ? "—"
                  : `${delta > 0 ? "+" : ""}${money(delta)}${saving ? " saved" : ""}`}
              </span>
            }
          />
          <DataRow
            className="sm:col-span-2"
            label="Recorded by"
            value={`${transfer.recordedByName} · ${shortDate(transfer.recordedAt)}`}
          />
        </div>

        {/*
          Booked as company transfer, not a sale — stated on the record rather
          than left to the reader, because it is the whole point of the feature
          and invisible from the numbers alone.
        */}
        <p className="text-sm text-muted-foreground">
          Recorded as a company transfer. It does not count towards new business.
        </p>

        {transfer.dealAuditId && (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to="/dashboard/producer">
              <ClipboardCheck />
              View the hand-off checklist
            </Link>
          </Button>
        )}
      </div>
    </DetailCard>
  );
}
