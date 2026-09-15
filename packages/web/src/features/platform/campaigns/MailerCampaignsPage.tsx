import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, FileUp, Map as MapIcon, Play } from "lucide-react";
import type { MailerCampaignListItem, MailerCampaignStatus } from "@sfa/shared";
import { TablePagination } from "@/components/common/TablePagination";
import {
  SEARCH_DEBOUNCE_MS,
  TableSearchInput,
} from "@/components/common/TableSearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listAgencies } from "@/lib/platform-api";
import { campaignsKey, listCampaigns } from "@/lib/platform-campaigns-api";
import { SuperAdminLayout } from "../SuperAdminLayout";
import { CampaignStatusBadge } from "./CampaignStatusBadge";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  describeAudience,
  formatCampaignNumber,
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
} from "./campaign-format";
import { useCampaignsUrlState } from "./useCampaignsUrlState";

const PAGE_SIZE = 25;

/** Sentinel for "no filter" — `Select` cannot take an empty-string value. */
const ANY = "__any__";

/**
 * Mailer Campaigns (PAC-71) — every run of a vendor mail file, past and in
 * flight.
 *
 * Cross-tenant by nature: a campaign belongs to no agency, it is run once and
 * can serve many. The **Visible to** column is therefore the interesting one,
 * and `null` there reads "All agencies" rather than being left blank — see
 * `describeAudience`.
 *
 * Filtering is **real-time**, no Apply button, per AGENTS.md §7; search is
 * debounced because it hits the campaign name and week tag on every keystroke.
 */
export default function MailerCampaignsPage() {
  const { q, status, agencyId, page, setQ, setStatus, setAgencyId, setPage } =
    useCampaignsUrlState();
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  const agenciesQuery = useQuery({
    queryKey: ["platform", "agencies"],
    queryFn: listAgencies,
  });

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    q: debouncedQ || undefined,
    status: status || undefined,
    agencyId: agencyId || undefined,
  };

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: [...campaignsKey, filters],
    queryFn: () => listCampaigns(filters),
    // Keeps the current page on screen while a filter change is in flight,
    // instead of flashing the empty state between every keystroke.
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin">
          <ArrowLeft className="size-4" />
          All areas
        </Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-card-foreground">
            Mailer campaigns
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every run of a vendor mail file. A campaign is run once and can serve
            one agency, several, or all of them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to="/admin/campaigns/zip-markets">
              <MapIcon className="size-4" />
              ZIP → market table
            </Link>
          </Button>
          {/* The old Add Mailers flow, kept as the recovery path for a file
              somebody else already processed. Secondary, because the vendor
              file is what an operator normally has. */}
          <Button asChild variant="outline" size="sm" className="gap-1">
            <Link to="/admin/campaigns/new?source=processed">
              <FileUp className="size-4" />
              Import a processed file
            </Link>
          </Button>
          <Button asChild size="sm" className="gap-1">
            <Link to="/admin/campaigns/new">
              <Play className="size-4" />
              Run a campaign
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1">
          <TableSearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search by name, number, audience or requester…"
            label="Search campaigns"
            busy={isFetching}
          />
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={status || ANY}
            onValueChange={(value) =>
              setStatus(value === ANY ? "" : (value as MailerCampaignStatus))
            }
          >
            <SelectTrigger
              className="flex-1 border-border bg-card md:w-[180px] md:flex-none"
              aria-label="Filter by status"
            >
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All statuses</SelectItem>
              {CAMPAIGN_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {CAMPAIGN_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={agencyId || ANY}
            onValueChange={(value) => setAgencyId(value === ANY ? "" : value)}
          >
            <SelectTrigger
              className="flex-1 border-border bg-card md:w-[200px] md:flex-none"
              aria-label="Filter by agency"
            >
              <SelectValue placeholder="All agencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All agencies</SelectItem>
              {(agenciesQuery.data ?? []).map((agency) => (
                <SelectItem key={agency._id} value={agency._id}>
                  {agency.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <AlertCircle className="size-5 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Couldn't load campaigns.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isPending ? (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="px-4 py-3.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {/* `debouncedQ`, not `q`: keying off the raw input flips the copy
                before the request that would justify it has fired. */}
            {debouncedQ || status || agencyId
              ? "No campaigns match these filters."
              : "No campaigns have been run yet."}
          </p>
          {!q && !status && !agencyId && (
            <Button asChild size="sm">
              <Link to="/admin/campaigns/new">Run the first one</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {items.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </div>

          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            busy={isFetching}
            noun="campaigns"
            className="mt-4"
          />
        </>
      )}
    </SuperAdminLayout>
  );
}

/**
 * One campaign, as a row in a `divide-y` list rather than a `<table>`.
 *
 * The same treatment the bug queue uses, and for the same reason: eleven fields
 * per campaign is more than a table can show at a readable width, so the row
 * carries a headline and a wrapping meta line and the detail page carries the
 * rest.
 */
function CampaignRow({ campaign }: { campaign: MailerCampaignListItem }) {
  return (
    <Link
      to={`/admin/campaigns/${campaign.id}`}
      className="flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-accent/50"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {campaign.name}
        </span>
        <CampaignStatusBadge status={campaign.status} />
        {campaign.source === "processed" && (
          <Badge size="sm" variant="outline">
            Processed file
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {formatCampaignNumber(campaign.campaignNumber)}
          {campaign.year ? ` · ${campaign.year}` : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="text-foreground/80">
          {describeAudience(campaign.visibleAgencyNames)}
        </span>
        <span className="tabular-nums">
          {formatCount(campaign.recordCount)} mailers
        </span>
        <span className="tabular-nums">
          {formatCount(campaign.leadsAttributed)} leads
        </span>
        <span className="tabular-nums">
          Floor {formatMoney(campaign.premiumFloor)}
        </span>
        <span>Quoted {formatDate(campaign.quoteDate)}</span>
        <span>
          {campaign.requestedByName ?? "System"} ·{" "}
          {formatDateTime(campaign.createdAt)}
        </span>
      </div>
    </Link>
  );
}
