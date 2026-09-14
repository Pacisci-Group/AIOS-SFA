import { useMemo } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { PlatformPermission } from "@sfa/shared";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { TablePagination } from "@/components/common/TablePagination";
import {
  SEARCH_DEBOUNCE_MS,
  TableSearchInput,
} from "@/components/common/TableSearchInput";
import { toast } from "sonner";
import { MultiSelect } from "@/components/common/MultiSelect";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError } from "@/lib/api-client";
import { buildHandoffUrl } from "@/lib/impersonation-handoff";
import { listAgencies } from "@/lib/platform-api";
import {
  impersonateUser,
  listPlatformRoles,
  listPlatformUsers,
  type ListPlatformUsersParams,
  type PlatformUserRow,
} from "@/lib/platform-users-api";
import { SuperAdminLayout } from "./SuperAdminLayout";
import { PlatformUsersTable } from "./components/PlatformUsersTable";
import { usePlatformUsersUrlState } from "./usePlatformUsersUrlState";

const PAGE_SIZE = 25;

/**
 * Find / Impersonate User (PAC-70): every tenant user on the platform, with
 * instant search and two multi-select filters, and a one-click way to become
 * one of them.
 *
 * ## What "Impersonate" does
 *
 * Mints a session as the target and navigates **this tab** to the target's
 * own origin with the tokens in the URL fragment — see
 * `impersonation-handoff.ts` for why it has to be a URL, and why the fragment.
 * Same tab on purpose: `window.open` after an awaited request is popup-blocked,
 * and when the target's agency has no domain the destination *is* this origin,
 * where a second tab would silently overwrite this one's session. The operator
 * gets the full app as that user, with no banner and no way back except
 * logging out — that is the product decision, not an omission.
 *
 * ## Filters
 *
 * Both are multi-select and ORed server-side. Roles are filtered by **slug**
 * because a role's id differs per agency while its slug does not, and a user
 * holding any selected role matches. Everything lives in the URL
 * (`usePlatformUsersUrlState`), so a filtered view survives a refresh.
 */
export default function PlatformUsersPage() {
  const { can } = usePermissions();
  const { q, agencyIds, roleSlugs, page, setQ, setAgencyIds, setRoleSlugs, setPage } =
    usePlatformUsersUrlState();
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  const agenciesQuery = useQuery({
    queryKey: ["platform", "agencies"],
    queryFn: listAgencies,
  });
  const rolesQuery = useQuery({
    queryKey: ["platform", "roles"],
    queryFn: listPlatformRoles,
  });

  const params = useMemo<ListPlatformUsersParams>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQ.trim() || undefined,
      agencyIds: agencyIds.length ? agencyIds : undefined,
      roleSlugs: roleSlugs.length ? roleSlugs : undefined,
    }),
    [page, debouncedQ, agencyIds, roleSlugs],
  );

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["platform", "users", params],
    queryFn: () => listPlatformUsers(params),
    // Keep the previous page visible while refetching so the table doesn't
    // flash empty on every keystroke.
    placeholderData: keepPreviousData,
  });

  const impersonate = useMutation({
    mutationFn: (user: PlatformUserRow) => impersonateUser(user.id),
    onSuccess: (session) => {
      window.location.assign(buildHandoffUrl(session.appBaseUrl, session));
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not start a session as this user.",
      );
    },
  });

  const agencyOptions = useMemo(
    () =>
      (agenciesQuery.data ?? []).map((agency) => ({
        value: agency._id,
        label: agency.name,
      })),
    [agenciesQuery.data],
  );
  const roleOptions = useMemo(
    () =>
      (rolesQuery.data ?? []).map((role) => ({
        value: role.slug,
        label: role.name,
      })),
    [rolesQuery.data],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);
  // Success navigates away, so "pending" is the whole rest of this page's life.
  const impersonatingId =
    impersonate.isPending || impersonate.isSuccess
      ? impersonate.variables?.id ?? null
      : null;

  return (
    <SuperAdminLayout>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 gap-1">
        <Link to="/admin">
          <ArrowLeft className="size-4" />
          All areas
        </Link>
      </Button>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-card-foreground">
          Find / Impersonate User
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every user across every agency. Impersonate signs you in as them, on
          their agency's own address, with everything they can do. Log out when
          you are done.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <TableSearchInput
            value={q}
            onValueChange={setQ}
            placeholder="Search by name, email, agency, slug, branch or role…"
            label="Search users"
            busy={isFetching}
          />
        </div>
        <div className="flex items-center gap-2">
          <MultiSelect
            options={agencyOptions}
            value={agencyIds}
            onChange={setAgencyIds}
            placeholder="All agencies"
            summarize={(count) => `${count} agencies`}
            className="flex-1 md:w-[180px] md:flex-none"
          />
          <MultiSelect
            options={roleOptions}
            value={roleSlugs}
            onChange={setRoleSlugs}
            placeholder="All roles"
            summarize={(count) => `${count} roles`}
            className="flex-1 md:w-[160px] md:flex-none"
          />
        </div>
      </div>

      {isError ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16 text-center">
          <AlertCircle className="size-5 text-destructive" />
          <p className="text-sm text-muted-foreground">Couldn't load users.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : !isPending && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {debouncedQ.trim()
              ? `No users match “${debouncedQ.trim()}”.`
              : "No users yet."}
          </p>
        </div>
      ) : (
        <>
          <PlatformUsersTable
            users={items}
            isPending={isPending}
            pageSize={PAGE_SIZE}
            canImpersonate={can(PlatformPermission.UsersImpersonate)}
            impersonatingId={impersonatingId}
            onImpersonate={(user) => impersonate.mutate(user)}
          />

          <TablePagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            busy={isFetching}
            noun="users"
            className="mt-4"
          />
        </>
      )}
    </SuperAdminLayout>
  );
}
