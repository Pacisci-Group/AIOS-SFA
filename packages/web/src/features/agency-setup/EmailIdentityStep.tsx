import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getEmailSettings,
  updateEmailSettings,
  type AgencyEmailSettings,
} from "@/lib/agency-email-api";
import { ApiError } from "@/lib/api-client";

/**
 * How the agency's outbound email is addressed (PAC-69 phase 2).
 *
 * ## Only the two DNS-free fields
 * A verified sending domain and a custom app domain both need the owner to
 * publish DNS records and come back later — that is not a step, it is a project,
 * and a wizard is the wrong shape for it. Those live in Settings and are linked
 * to from here.
 *
 * ## Why a custom domain must not be added *during* the wizard
 * A brand-new agency has no domain of its own, and `HostTenantGuard` admits a
 * domain-less agency on the platform host for exactly that reason. Adding a
 * domain closes that fallback — so an owner who added one mid-wizard would be
 * signed out of the very session they were completing it in. The link below goes
 * to Settings on purpose.
 */
export function EmailIdentityStep() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["agency-email"], queryFn: getEmailSettings });

  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setFromName(query.data.fromName ?? "");
    setReplyTo(query.data.replyTo ?? "");
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      updateEmailSettings({
        fromName: fromName.trim() || null,
        replyTo: replyTo.trim() || null,
      }),
    onSuccess: (next: AgencyEmailSettings) => {
      queryClient.setQueryData(["agency-email"], next);
      toast.success("Saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (query.isLoading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="space-y-1.5">
        <Label htmlFor="setup-fromName" className="text-xs">
          Sender name
        </Label>
        <Input
          id="setup-fromName"
          value={fromName}
          maxLength={60}
          placeholder={query.data?.fromName ?? "Your agency"}
          onChange={(e) => setFromName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Who your invites and password-reset emails appear to come from.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setup-replyTo" className="text-xs">
          Reply-to address
        </Label>
        <Input
          id="setup-replyTo"
          type="email"
          value={replyTo}
          maxLength={160}
          placeholder="hello@youragency.com"
          onChange={(e) => setReplyTo(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Where replies land. Needs no DNS setup — it is the one-field way to get
          replies into your own inbox.
        </p>
      </div>

      {query.data?.effectiveFrom && (
        <p className="text-xs text-muted-foreground">
          Mail currently goes out as{" "}
          <span className="font-mono text-foreground">
            {query.data.effectiveFrom}
          </span>
          .
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Sending from your own domain, and putting the app on your own web
        address, both need DNS records. Set those up whenever you are ready in{" "}
        <Link to="/settings/email" className="text-primary hover:underline">
          Email settings
        </Link>{" "}
        and{" "}
        <Link to="/settings/domains" className="text-primary hover:underline">
          Domains
        </Link>
        .
      </p>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error
    ? err.message
    : "Something went wrong.";
}
