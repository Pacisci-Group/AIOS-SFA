import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DetailCard } from '@/components/common/DetailCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import {
  clearSendingDomain,
  getEmailSettings,
  setSendingDomain,
  updateEmailSettings,
  verifySendingDomain,
  type AgencyEmailSettings,
  type SendingDnsRecord,
  type SendingStatus,
} from '@/lib/agency-email-api';
import { SettingsPage } from './SettingsPage';

const STATUS_BADGE: Record<
  SendingStatus,
  { label: string; className: string }
> = {
  platform: {
    label: 'Our address',
    className: 'bg-muted text-muted-foreground',
  },
  pending: {
    label: 'Awaiting DNS',
    className: 'bg-muted text-muted-foreground',
  },
  verified: { label: 'Your address', className: 'bg-success/12 text-success' },
  failed: {
    label: 'Not verified',
    className: 'bg-destructive/15 text-destructive',
  },
};

export default function EmailSenderPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['agency-email'], queryFn: getEmailSettings });

  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [domain, setDomain] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setFromName(query.data.fromName ?? '');
    setReplyTo(query.data.replyTo ?? '');
    setLocalPart(query.data.fromLocalPart ?? '');
  }, [query.data]);

  function onSaved(next: AgencyEmailSettings) {
    queryClient.setQueryData(['agency-email'], next);
  }

  const save = useMutation({
    mutationFn: () =>
      updateEmailSettings({
        fromName: fromName.trim() || null,
        replyTo: replyTo.trim() || null,
        fromLocalPart: localPart.trim() || null,
      }),
    onSuccess: (next) => {
      toast.success('Email settings saved');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const addDomain = useMutation({
    mutationFn: () => setSendingDomain(domain.trim()),
    onSuccess: (next) => {
      toast.success('Domain added — publish the DNS records to finish');
      setDomain('');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const verify = useMutation({
    mutationFn: verifySendingDomain,
    onSuccess: (next) => {
      // Like domain verification, a failure comes back as a 200 with a status.
      if (next.sendingStatus === 'verified') {
        toast.success('Verified — email now sends from your domain');
      } else {
        toast.error(next.lastError ?? 'Not verified yet.');
      }
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const clear = useMutation({
    mutationFn: clearSendingDomain,
    onSuccess: (next) => {
      toast.success('Back to sending from our address');
      onSaved(next);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const data = query.data;

  return (
    <SettingsPage
      title="Email"
      caption="How your email is addressed"
      icon={AtSign}
    >
      {query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : query.isError || !data ? (
        <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      ) : (
        <div className="space-y-6">
          {/*
            The address mail is *actually* going out as, stated before anything
            else. "Awaiting DNS" and "verified" are indistinguishable in a form,
            and an owner who has added records but not yet passed verification
            will otherwise believe they are already sending from their own
            domain.
          */}
          <DetailCard
            title="Sending as"
            icon={AtSign}
            action={
              <Badge className={STATUS_BADGE[data.sendingStatus].className}>
                {STATUS_BADGE[data.sendingStatus].label}
              </Badge>
            }
          >
            <p className="font-mono text-sm break-all text-foreground">
              {data.effectiveFrom}
            </p>
            {data.replyTo && (
              <p className="mt-2 text-xs text-muted-foreground">
                Replies go to{' '}
                <span className="font-mono">{data.replyTo}</span>.
              </p>
            )}
            {data.sendingStatus === 'pending' && (
              <p className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2 text-xs text-muted-foreground">
                Your domain is not verified yet, so email still goes out from
                our address. Nothing is failing — this is deliberate. Sending
                from an unverified domain would get the message rejected
                outright.
              </p>
            )}
          </DetailCard>

          <DetailCard title="Name and replies" icon={AtSign}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fromName" className="text-xs">
                  Sender name
                </Label>
                <Input
                  id="fromName"
                  value={fromName}
                  maxLength={60}
                  placeholder="Your agency name"
                  onChange={(e) => setFromName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  What recipients see in their inbox.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="replyTo" className="text-xs">
                  Reply-to address
                </Label>
                <Input
                  id="replyTo"
                  type="email"
                  value={replyTo}
                  maxLength={160}
                  placeholder="service@youragency.com"
                  onChange={(e) => setReplyTo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Where replies land. This needs no setup — if all you want is
                  replies reaching your own inbox, this field alone does it.
                </p>
              </div>

              <Button
                variant="brand"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DetailCard>

          <DetailCard title="Send from your own domain" icon={AtSign}>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Optional. Everything already works without this — it only
                changes the address before the @.
              </p>

              {data.sendingDomain ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">
                      {data.sendingDomain}
                    </span>
                    <Badge className={STATUS_BADGE[data.sendingStatus].className}>
                      {STATUS_BADGE[data.sendingStatus].label}
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="localPart" className="text-xs">
                      Mailbox
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="localPart"
                        value={localPart}
                        maxLength={64}
                        placeholder="hello"
                        className="max-w-[12rem]"
                        onChange={(e) => setLocalPart(e.target.value)}
                      />
                      <span className="font-mono text-sm text-muted-foreground">
                        @{data.sendingDomain}
                      </span>
                    </div>
                  </div>

                  {data.lastError && (
                    <p className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {data.lastError}
                    </p>
                  )}

                  {data.dnsRecords && data.dnsRecords.length > 0 && (
                    <SendingDnsTable records={data.dnsRecords} />
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {data.sendingStatus !== 'verified' && (
                      <Button
                        variant="brand"
                        size="sm"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate()}
                      >
                        {verify.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        {verify.isPending ? 'Checking…' : 'Verify'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={clear.isPending}
                      onClick={() => clear.mutate()}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      Use our address instead
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[16rem] flex-1 space-y-1.5">
                    <Label htmlFor="sendingDomain" className="text-xs">
                      Domain
                    </Label>
                    <Input
                      id="sendingDomain"
                      value={domain}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="youragency.com"
                      onChange={(e) => setDomain(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={!domain.trim() || addDomain.isPending}
                    onClick={() => addDomain.mutate()}
                  >
                    {addDomain.isPending ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              )}
            </div>
          </DetailCard>
        </div>
      )}
    </SettingsPage>
  );
}

/**
 * The provider's DNS records.
 *
 * A separate table from the one on the Domains page even though they look
 * alike: these come from the email provider verbatim (SPF, DKIM, sometimes a
 * priority on an MX record), and flattening them into our own shape would mean
 * transcribing values that must be pasted exactly.
 */
function SendingDnsTable({ records }: { records: SendingDnsRecord[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Add these at your DNS provider, then press Verify. They can take up to
        72 hours to publish.
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
              <tr
                key={`${record.type}-${record.name}-${record.record}`}
                className="border-t border-border"
              >
                <td className="py-2 pr-3 font-mono">
                  {record.type}
                  {record.priority != null && (
                    <span className="block text-muted-foreground">
                      priority {record.priority}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono break-all">{record.name}</td>
                <td className="py-2 pr-3 font-mono break-all">
                  {record.value}
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

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : 'Something went wrong.';
}
