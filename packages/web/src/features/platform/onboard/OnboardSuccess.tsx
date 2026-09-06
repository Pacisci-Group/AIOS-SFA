import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import type { OnboardAgencyResponse } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { resendOwnerInvite } from "@/lib/platform-api";

/**
 * What was created, and whether the owner actually heard about it.
 *
 * ## Why a failed email is not a failed onboarding
 * The tenant is committed before the invite is dispatched, and deliberately not
 * rolled back if dispatch fails — the event may already be recorded and would be
 * replayed later, mailing a link to an account that no longer existed. So a
 * `failed` status means "everything exists, nobody was told", and the only thing
 * left to do is resend. Showing it as an error would send an operator hunting
 * for a broken agency that is in fact fine.
 */
export function OnboardSuccess({
  result,
  onOnboardAnother,
}: {
  result: OnboardAgencyResponse;
  onOnboardAnother: () => void;
}) {
  const [status, setStatus] = useState(result.owner.emailStatus);
  const [inviteUrl, setInviteUrl] = useState(result.owner.inviteUrl);
  const [devToken, setDevToken] = useState(result.owner.inviteToken);

  const resend = useMutation({
    mutationFn: () => resendOwnerInvite(result.agency.id),
    onSuccess: (owner) => {
      setStatus(owner.emailStatus);
      setInviteUrl(owner.inviteUrl);
      setDevToken(owner.inviteToken);
      toast.success("Invite sent", {
        description: `A fresh link is on its way to ${owner.email}.`,
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not resend the invite.",
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
          <Check size={16} />
        </span>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {result.agency.name} is ready
          </h2>
          <p className="text-sm text-muted-foreground">
            The agency, its default roles, the {result.branch.name} branch and
            its owner&rsquo;s account all exist.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4 md:p-5">
          {status === "queued" ? (
            <div className="flex items-start gap-2.5">
              <Mail size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5 text-sm">
                <p className="text-foreground">
                  Invite sent to{" "}
                  <span className="font-medium">{result.owner.email}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  The link expires on{" "}
                  {new Date(result.owner.expiresAt).toLocaleDateString()}. They
                  set a password and are walked through the agency&rsquo;s
                  branding.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-destructive"
              />
              <div className="space-y-0.5 text-sm">
                <p className="text-foreground">
                  The agency was created, but the invite email did not go out.
                </p>
                <p className="text-xs text-muted-foreground">
                  Nothing is wrong with the tenant —{" "}
                  <span className="font-medium">{result.owner.email}</span> has
                  simply not been told yet. Resend when you are ready.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={status === "failed" ? "brand" : "outline"}
              size="sm"
              onClick={() => resend.mutate()}
              disabled={resend.isPending}
            >
              <Mail size={14} />
              {resend.isPending ? "Sending…" : "Resend invite"}
            </Button>
            {/*
              Dev only — the API withholds the raw token in production, so this
              block simply does not render there. It is how the flow is walked
              locally, where mail goes to a log.
            */}
            {devToken && <CopyInviteLink url={inviteUrl} />}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onOnboardAnother}>
          Onboard another agency
        </Button>
        <Button asChild variant="ghost">
          <Link to="/admin">Back to the panel</Link>
        </Button>
      </div>
    </div>
  );
}

/** Copy the invite link, for walking the flow without a mail transport. */
function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy invite link (dev)"}
    </Button>
  );
}
