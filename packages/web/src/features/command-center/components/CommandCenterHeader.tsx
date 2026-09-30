import { MobileNav } from "@/components/layout/MobileNav";
import { MailersButton } from "@/components/leads/MailersButton";
import { useAuth } from "@/contexts/auth-context";

/**
 * The Command Center's page header.
 *
 * ## The prototype showed two different people at once
 *
 * It hard-coded "Jenkins Insurance Group" and "Mike Jenkins" as string
 * literals, directly above a sidebar rendering the real signed-in user — so any
 * screenshot of the page showed one name in the header and another underneath
 * it. The agency name is gone entirely rather than re-sourced: `AppSidebar`
 * already renders the tenant's brand mark, and a second copy in the header is
 * the same duplication that caused the original bug.
 */
export function CommandCenterHeader() {
  const { user } = useAuth();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 md:gap-4 md:px-6 md:py-5">
      <MobileNav className="-ml-1" />

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.1rem] font-semibold -tracking-[0.01em] text-foreground">
          Agency Command Center
        </h1>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {/* The real viewer. `name` can be empty on an account invited but not
              yet completed, so the email is the fallback rather than a
              placeholder person. */}
          Signed in as {user?.name?.trim() || user?.email}
        </p>
      </div>

      {/*
       * The prototype's floating "Fast Log Mailer (QCN)" button, as the header
       * action the rest of the app already uses. `MailersButton` gates itself
       * on `mailers:read` and mounts the shipped `MailerLookupDrawer` — whose
       * own docblock notes its layout came from this page's `SidecarMailer`
       * prototype, wired to the real mailers collection (PAC-61). A second QCN
       * panel here would be the prototype competing with its own replacement.
       */}
      <div className="flex shrink-0 items-center gap-2">
        <MailersButton />
      </div>
    </div>
  );
}
