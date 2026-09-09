import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Globe,
  Loader2,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { subdomainLabelIssue } from '@sfa/shared';
import { DetailCard } from '@/components/common/DetailCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  addDomain,
  getDomainConfig,
  listDomains,
  removeDomain,
  setPrimaryDomain,
  verifyDomain,
  type AgencyDomain,
  type AgencyDomainKind,
  type AgencyDomainStatus,
  type DnsInstruction,
} from '@/lib/agency-domains-api';
import { SettingsPage } from './SettingsPage';

/**
 * Status colours follow the convention set on `UsersPage`: destructive/amber is
 * reserved for the row that still needs the owner to *do* something, and a
 * finished state is muted rather than red. `failed` is the one that wants
 * attention, so it carries the loud treatment; `pending` is merely waiting.
 */
const STATUS_BADGE: Record<
  AgencyDomainStatus,
  { label: string; className: string }
> = {
  active: { label: 'Live', className: 'bg-success/12 text-success' },
  pending: {
    label: 'Awaiting DNS',
    className: 'bg-muted text-muted-foreground',
  },
  failed: {
    label: 'Not verified',
    className: 'bg-destructive/15 text-destructive',
  },
};

export default function DomainsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['agency-domains'], queryFn: listDomains });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['agency-domains'] });
  }

  const verify = useMutation({
    mutationFn: verifyDomain,
    onSuccess: (domain) => {
      // A `failed` verification resolves rather than throws — the reason is the
      // payload, not an error. Reporting it as a success toast would tell the
      // owner their DNS is fine when it is not.
      if (domain.status === 'active') {
        toast.success(`${domain.hostname} is live`);
      } else {
        toast.error(domain.lastError ?? 'Could not verify that domain yet.');
      }
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const makePrimary = useMutation({
    mutationFn: setPrimaryDomain,
    onSuccess: (domain) => {
      toast.success(`Links now use ${domain.hostname}`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: removeDomain,
    onSuccess: () => {
      toast.success('Domain removed');
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const domains = query.data ?? [];
  const busy = verify.isPending || makePrimary.isPending || remove.isPending;

  return (
    <SettingsPage
      title="Domains"
      caption="Where your team signs in"
      icon={Globe}
      action={<AddDomainDialog onAdded={invalidate} />}
    >
      {query.isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : domains.length === 0 ? (
        <DetailCard title="No domains yet" icon={Globe}>
          <p className="text-sm text-muted-foreground">
            Your team currently signs in at the shared address. Add a subdomain
            or your own domain to give them one that looks like yours.
          </p>
        </DetailCard>
      ) : (
        <div className="space-y-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              busy={busy}
              onVerify={() => verify.mutate(domain.id)}
              onMakePrimary={() => makePrimary.mutate(domain.id)}
              onRemove={() => remove.mutate(domain.id)}
              verifying={verify.isPending && verify.variables === domain.id}
            />
          ))}
        </div>
      )}
    </SettingsPage>
  );
}

function DomainCard({
  domain,
  busy,
  verifying,
  onVerify,
  onMakePrimary,
  onRemove,
}: {
  domain: AgencyDomain;
  busy: boolean;
  verifying: boolean;
  onVerify: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const badge = STATUS_BADGE[domain.status];

  return (
    <DetailCard
      title={domain.hostname}
      icon={Globe}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={badge.className}>{badge.label}</Badge>
          {domain.isPrimary && (
            <Badge className="bg-primary/12 text-primary">
              <Star className="size-3 mr-1" />
              Primary
            </Badge>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {domain.isPrimary && (
          <p className="text-xs text-muted-foreground">
            Invite emails and shared lead forms use this address.
          </p>
        )}

        {domain.lastError && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {domain.lastError}
          </p>
        )}

        {domain.dnsInstructions && (
          <DnsInstructions records={domain.dnsInstructions} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {domain.status !== 'active' && (
            <Button
              variant="brand"
              size="sm"
              disabled={busy}
              onClick={onVerify}
            >
              {verifying ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {verifying ? 'Checking…' : 'Verify'}
            </Button>
          )}
          {domain.status === 'active' && !domain.isPrimary && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onMakePrimary}
            >
              <Star className="size-4" />
              Use for links
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        </div>
      </div>
    </DetailCard>
  );
}

/**
 * The records to publish, each with a copy button.
 *
 * Copy buttons rather than selectable text because these values are long
 * random strings that get pasted into a registrar's form, and a hand-selection
 * that clips one character fails verification with no indication of why.
 */
function DnsInstructions({ records }: { records: DnsInstruction[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Add these at your DNS provider, then press Verify. Changes can take a
        few minutes to publish.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2 pr-3 font-medium">Type</th>
              <th className="pb-2 pr-3 font-medium">Name</th>
              <th className="pb-2 pr-3 font-medium">Value</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="align-top">
            {records.map((record) => (
              <tr key={`${record.type}-${record.name}`} className="border-t border-border">
                <td className="py-2 pr-3 font-mono">{record.type}</td>
                <td className="py-2 pr-3 font-mono break-all">{record.name}</td>
                <td className="py-2 pr-3 font-mono break-all">
                  {record.value}
                  <p className="mt-1 font-sans text-muted-foreground">
                    {record.purpose}
                  </p>
                </td>
                <td className="py-2">
                  <CopyButton value={record.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy value"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </Button>
  );
}

function AddDomainDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  /** The whole address, for a custom domain. */
  const [hostname, setHostname] = useState('');
  /** Just the first label, for a subdomain — the suffix is shown, not typed. */
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AgencyDomainKind>('subdomain');

  const configQuery = useQuery({
    queryKey: ['agency-domain-config'],
    queryFn: getDomainConfig,
    // Deployment configuration: identical for every tenant and unchanged for
    // the life of the deployment, so there is nothing to revalidate.
    staleTime: Infinity,
  });
  const baseDomain = configQuery.data?.baseDomain ?? null;

  /*
   * Subdomains need a configured `BASE_DOMAIN`. Until this was known in the
   * browser the option was always offered and the API refused it on submit,
   * which read as a broken form rather than an unavailable feature.
   */
  const subdomainsAvailable = configQuery.isSuccess && baseDomain !== null;
  const isSubdomain = kind === 'subdomain';

  // Only surfaced once the field has been typed in: a red message under an
  // untouched input is a telling-off for not having started yet.
  const labelIssue = label.trim() ? subdomainLabelIssue(label) : null;
  const composed = baseDomain ? `${label.trim().toLowerCase()}.${baseDomain}` : '';

  const canSubmit = isSubdomain
    ? subdomainsAvailable && !!label.trim() && !labelIssue
    : !!hostname.trim();

  const add = useMutation({
    mutationFn: () =>
      addDomain({
        // The server takes a full hostname on both paths — the split is a
        // property of the form, not of the API. Composing here keeps the
        // contract (and `assertClaimableSubdomain`) exactly as it was.
        hostname: isSubdomain ? composed : hostname.trim(),
        kind,
      }),
    onSuccess: (domain) => {
      toast.success(
        domain.status === 'active'
          ? `${domain.hostname} is live`
          : 'Domain added — publish the DNS records to finish',
      );
      setOpen(false);
      setHostname('');
      setLabel('');
      onAdded();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="brand" size="sm">
          Add domain
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a domain</DialogTitle>
          <DialogDescription>
            Give your team an address that looks like your agency.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as AgencyDomainKind)}
            className="gap-3"
          >
            <label
              className={cn(
                'flex items-start gap-3 rounded-lg border border-border p-3',
                subdomainsAvailable
                  ? 'cursor-pointer'
                  : 'cursor-not-allowed opacity-50',
              )}
            >
              <RadioGroupItem
                value="subdomain"
                className="mt-0.5"
                disabled={!subdomainsAvailable}
              />
              <span>
                <span className="block text-sm font-medium">
                  A subdomain of ours
                </span>
                <span className="block text-xs text-muted-foreground">
                  {configQuery.isPending
                    ? 'Checking availability…'
                    : baseDomain
                      ? `Works straight away — no DNS setup needed. Your address ends in .${baseDomain}.`
                      : 'Not available on this deployment — add a domain you own instead.'}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="custom" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  A domain you own
                </span>
                <span className="block text-xs text-muted-foreground">
                  You will add two DNS records to prove it is yours.
                </span>
              </span>
            </label>
          </RadioGroup>

          {isSubdomain ? (
            /*
             * Label field + fixed suffix, rather than one box asking for the
             * whole address.
             *
             * Our subdomains are four labels deep (`texasholdings.dev.smithfamily.agency`),
             * so asking an owner to type the whole thing is both the longest
             * possible way to say "texasholdings" and an invitation to typo the
             * part that has exactly one correct value. The suffix comes from the
             * server's own `BASE_DOMAIN`, so what is shown is what will be
             * accepted.
             */
            <div className="space-y-1.5">
              <Label htmlFor="subdomain-label" className="text-xs">
                Address
              </Label>
              <div
                className={cn(
                  'flex h-9 w-full items-center rounded-md border border-input bg-transparent text-base shadow-xs transition-[color,box-shadow] md:text-sm dark:bg-input/30',
                  'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
                  labelIssue &&
                    'border-destructive ring-destructive/20 dark:ring-destructive/40',
                )}
              >
                <input
                  id="subdomain-label"
                  value={label}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={!subdomainsAvailable}
                  aria-invalid={!!labelIssue}
                  aria-describedby="subdomain-hint"
                  placeholder="youragency"
                  // Lowercased on the way in rather than on submit, so the field
                  // always shows exactly what will be created — a DNS label has
                  // no uppercase form to preserve.
                  onChange={(e) => setLabel(e.target.value.toLowerCase())}
                  className="h-full min-w-0 flex-1 rounded-l-md bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
                {/* `select-none` and not focusable: it is a statement of fact,
                    not a field. Truncated from the left so the end of a long
                    zone — the part that identifies it — stays visible. */}
                <span
                  className="max-w-[55%] select-none truncate rounded-r-md border-l border-input bg-sunken px-3 py-1 text-sm text-muted-foreground"
                  title={baseDomain ?? undefined}
                >
                  .{baseDomain ?? '…'}
                </span>
              </div>
              <p
                id="subdomain-hint"
                className={cn(
                  'text-xs',
                  labelIssue ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {labelIssue ??
                  (label.trim() && composed
                    ? `Your team will sign in at ${composed}`
                    : 'Lowercase letters, numbers and hyphens.')}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="hostname" className="text-xs">
                Address
              </Label>
              <Input
                id="hostname"
                value={hostname}
                autoComplete="off"
                spellCheck={false}
                placeholder="youragency.com"
                onChange={(e) => setHostname(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            disabled={!canSubmit || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? 'Adding…' : 'Add domain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}
