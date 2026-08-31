import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModuleKey, PlatformPermission } from '@sfa/shared';
import { AuthProvider } from '@/contexts/auth-context';
import { ThemeProvider } from '@/app/ThemeProvider';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute';
import { RequirePermission } from '@/components/layout/RequirePermission';
import { LoginPage } from '@/pages/LoginPage';
import { DevNavPage } from '@/pages/DevNavPage';
import { usePermissions } from '@/hooks/usePermissions';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const ProducerDashboardPage = lazy(
  () => import('@/features/producer/ProducerDashboardPage'),
);
const ManagementDashboardPage = lazy(
  () => import('@/features/management/ManagementDashboardPage'),
);
const ManagementDashboardAltPage = lazy(
  () => import('@/features/management-alt/ManagementDashboardAltPage'),
);
const ServiceDashboardPage = lazy(
  () => import('@/features/service/ServiceDashboardPage'),
);
const TicketWorkspacePage = lazy(
  () => import('@/features/tickets/TicketWorkspacePage'),
);
const ArchivedTicketsPage = lazy(
  () => import('@/features/tickets/ArchivedTicketsPage'),
);
const HouseholdDetailsPage = lazy(
  () => import('@/features/household/HouseholdDetailsPage'),
);
const PolicyDetailPage = lazy(
  () => import('@/features/policy/PolicyDetailPage'),
);
const LeadsPage = lazy(() => import('@/features/lead/LeadsPage'));
const NewLeadPage = lazy(() => import('@/features/lead/NewLeadPage'));
const NewQuoteRecapPage = lazy(
  () => import('@/features/quote-recap/NewQuoteRecapPage'),
);
const EditQuoteRecapPage = lazy(
  () => import('@/features/quote-recap/EditQuoteRecapPage'),
);
const SoldDealPage = lazy(() => import('@/features/sold/SoldDealPage'));
const PolicyTransferPage = lazy(
  () => import('@/features/sold/PolicyTransferPage'),
);
const PublicLeadFormPage = lazy(
  () => import('@/features/lead/PublicLeadFormPage'),
);
const LeadDetailsPage = lazy(() => import('@/features/lead/LeadDetailsPage'));
const RolePermissionsPage = lazy(
  () => import('@/features/admin/RolePermissionsPage'),
);
const UsersPage = lazy(() => import('@/features/admin/UsersPage'));
const SuperAdminHomePage = lazy(
  () => import('@/features/platform/SuperAdminHomePage'),
);
const AddMailersPage = lazy(
  () => import('@/features/platform/AddMailersPage'),
);
const AcceptInvitePage = lazy(() => import('@/pages/AcceptInvitePage'));
const UserPermissionsPage = lazy(
  () => import('@/features/admin/UserPermissionsPage'),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
      Loading…
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

/**
 * Role-based landing for `/`. Each user is sent to the most relevant
 * dashboard for their permissions. Owners/managers land on the
 * management dashboard, producers on the producer dashboard, etc.
 * Anyone without an obvious dashboard (e.g. platform admin) gets the
 * navigation hub.
 */
function RoleLanding() {
  const { canRead, can } = usePermissions();

  // A platform operator holds only `platform:*` and no module permissions, so
  // without this they fall all the way through to the dev navigator — a page
  // full of tenant dashboards they cannot open (PAC-73).
  if (can(PlatformPermission.AgenciesRead)) {
    return <Navigate to="/admin" replace />;
  }
  if (canRead(ModuleKey.Management)) {
    return <Navigate to="/dashboard/management" replace />;
  }
  if (canRead(ModuleKey.Dashboard)) {
    return <Navigate to="/dashboard/producer" replace />;
  }
  if (canRead(ModuleKey.CrmService)) {
    return <Navigate to="/crm/service" replace />;
  }
  if (canRead(ModuleKey.Clients)) {
    return <Navigate to="/clients/demo" replace />;
  }
  if (canRead(ModuleKey.Leads)) {
    return <Navigate to="/leads" replace />;
  }
  return <DevNavPage />;
}

export function App() {
  return (
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      {/* Radix tooltips need a provider ancestor or `Tooltip.Root` throws at
          render — and `components/ui/tooltip` deliberately does not self-wrap,
          because the open/close delays are a global concern. Mounted once here
          rather than per call site (first needed by the dashboard's lead quick
          actions, PAC-16). */}
      <TooltipProvider delayDuration={200}>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<RoleLanding />} />
              <Route path="/nav" element={<DevNavPage />} />

              {/*
                No layout route here: the shell is `AppShell`, which each page
                renders itself so it can put `MobileNav` inside its own header
                instead of stacking a second app bar above it. A layout route
                would render `AppSidebar` a second time around pages that
                already have one. Each page still declares its own per-page
                `RequirePermission` gate.
              */}
              <>
                <Route
                  element={
                    <RequirePermission permission={`${ModuleKey.Dashboard}:read`} />
                  }
                >
                  <Route
                    path="/dashboard/producer"
                    element={
                      <LazyPage>
                        <ProducerDashboardPage />
                      </LazyPage>
                    }
                  />
                </Route>

                <Route
                  element={
                    <RequirePermission permission={`${ModuleKey.CrmService}:read`} />
                  }
                >
                  <Route
                    path="/crm/service"
                    element={
                      <LazyPage>
                        <ServiceDashboardPage />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/crm/tickets"
                    element={
                      <LazyPage>
                        <TicketWorkspacePage />
                      </LazyPage>
                    }
                  />
                  <Route
                    path="/crm/tickets/archived"
                    element={
                      <LazyPage>
                        <ArchivedTicketsPage />
                      </LazyPage>
                    }
                  />
                </Route>

                <Route
                  element={
                    <RequirePermission permission={`${ModuleKey.Leads}:read`} />
                  }
                >
                  <Route
                    path="/leads"
                    element={
                      <LazyPage>
                        <LeadsPage />
                      </LazyPage>
                    }
                  />
                  {/* Static segment, so it wins over `/leads/:id` regardless of
                      order — declared first for readability. Needs `leads:write`,
                      which is stricter than the surrounding read gate. */}
                  <Route
                    element={
                      <RequirePermission
                        permission={`${ModuleKey.Leads}:write`}
                        redirectTo="/leads"
                      />
                    }
                  >
                    <Route
                      path="/leads/new"
                      element={
                        <LazyPage>
                          <NewLeadPage />
                        </LazyPage>
                      }
                    />
                  </Route>
                  {/* `/leads/demo` was removed with PAC-38: the page renders real
                      data now, so a route that could only ever show the mockup was
                      dead weight. It had no inbound links, and the `*` catch-all
                      below handles a stale bookmark. */}
                  <Route
                    path="/leads/:id"
                    element={
                      <LazyPage>
                        <LeadDetailsPage />
                      </LazyPage>
                    }
                  />
                </Route>
              </>

              <Route
                element={
                  <RequirePermission permission={`${ModuleKey.Management}:read`} />
                }
              >
                <Route
                  path="/dashboard/management"
                  element={
                    <LazyPage>
                      <ManagementDashboardPage />
                    </LazyPage>
                  }
                />
                <Route
                  path="/dashboard/management-alt"
                  element={
                    <LazyPage>
                      <ManagementDashboardAltPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* The mock demo page stays behind the Clients page permission.
                  No sidebar entry points here any more (see AppSidebar) — it is
                  reachable from the dev Screen Navigator at `/`.
                  Declared before `/clients/:id` so the literal segment wins. */}
              <Route
                element={
                  <RequirePermission permission={`${ModuleKey.Clients}:read`} />
                }
              >
                <Route
                  path="/clients/demo"
                  element={
                    <LazyPage>
                      <HouseholdDetailsPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Household and policy records also render inside the CRM
                  ticket detail, so either page permission grants access. */}
              <Route
                element={
                  <RequirePermission
                    anyOf={[
                      `${ModuleKey.Clients}:read`,
                      `${ModuleKey.CrmService}:read`,
                    ]}
                  />
                }
              >
                <Route
                  path="/clients/:id"
                  element={
                    <LazyPage>
                      <HouseholdDetailsPage />
                    </LazyPage>
                  }
                />
                <Route
                  path="/policies/:id"
                  element={
                    <LazyPage>
                      <PolicyDetailPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Quote Recap form (PAC-39). Deliberately NOT nested under the
                  `leads:read` gate: every endpoint this page calls (context,
                  presign, create) sits behind `quote_recaps`, so one gate covers
                  the whole flow rather than letting a user pass the outer check
                  and fail mid-form. */}
              <Route
                element={
                  <RequirePermission
                    permission={`${ModuleKey.QuoteRecaps}:write`}
                    redirectTo="/leads"
                  />
                }
              >
                <Route
                  path="/quote-recaps/new"
                  element={
                    <LazyPage>
                      <NewQuoteRecapPage />
                    </LazyPage>
                  }
                />
                {/* Editing a recorded recap (PAC-56 #11). Same gate: every
                    endpoint it calls — GET :id, the presign, PATCH :id — sits
                    behind the same module. */}
                <Route
                  path="/quote-recaps/:id/edit"
                  element={
                    <LazyPage>
                      <EditQuoteRecapPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Sold form (PAC-40). Gated on `deal_audits:write` because that
                  is what POST /sold-deals itself requires, so the route and the
                  API agree.

                  Note PAC-38 has since added `clients:write` to the Producer
                  template (for editing a lead's contact), so the original
                  reasoning — "producers hold no `clients:*`" — no longer holds.
                  The gate stays where it is regardless: it matches the endpoint,
                  which is the durable reason. */}
              <Route
                element={
                  <RequirePermission
                    permission={`${ModuleKey.DealAudits}:write`}
                    redirectTo="/leads"
                  />
                }
              >
                <Route
                  path="/sold/new"
                  element={
                    <LazyPage>
                      <SoldDealPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Policy transfer — the same wizard, recorded from a CRM ticket
                  rather than a lead, and booked as company transfer so it never
                  counts as new business.

                  Gated on `crm_service:write` for the same reason the Sold form
                  is gated on `deal_audits:write`: it is what
                  POST /crm/service-tickets/:id/policy-transfer itself requires,
                  so the route and the API agree. A producer never reaches this;
                  a CSR — who holds no `deal_audits` at all — is exactly who
                  does. */}
              <Route
                element={
                  <RequirePermission
                    permission={`${ModuleKey.CrmService}:write`}
                    redirectTo="/crm/tickets"
                  />
                }
              >
                <Route
                  path="/policy-transfers/new"
                  element={
                    <LazyPage>
                      <PolicyTransferPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Owner-only role & per-user permission management */}
              {/*
                `agency:roles:read`, not `agency:users:permissions`: this page
                calls `GET /roles` and saves with `PATCH /roles/:id`. Gating on
                the users permission let a role holding that but not
                `agency:roles:*` reach the page and 403 on save.
              */}
              <Route
                element={<RequirePermission permission="agency:roles:read" />}
              >
                <Route
                  path="/settings/roles"
                  element={
                    <LazyPage>
                      <RolePermissionsPage />
                    </LazyPage>
                  }
                />
                <Route
                  path="/settings/users/:userId/permissions"
                  element={
                    <LazyPage>
                      <UserPermissionsPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Owner-only user directory */}
              <Route
                element={<RequirePermission permission="agency:users:read" />}
              >
                <Route
                  path="/settings/users"
                  element={
                    <LazyPage>
                      <UsersPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/*
                Super Admin panel (PAC-73). Above the tenant boundary: these
                pages render their own `SuperAdminLayout`, not `AppShell`, and
                the operator has no agency of their own.

                `/admin` gates on `platform:agencies:read` because every
                platform admin holds it (`ALL_PLATFORM_PERMISSIONS`), so it is
                the cheapest "is this a platform operator" test. The one live
                feature gates on its own permission and falls back to the panel
                rather than to `/`, which would bounce the operator out of it.
              */}
              <Route
                element={
                  <RequirePermission
                    permission={PlatformPermission.AgenciesRead}
                  />
                }
              >
                <Route
                  path="/admin"
                  element={
                    <LazyPage>
                      <SuperAdminHomePage />
                    </LazyPage>
                  }
                />
                <Route
                  element={
                    <RequirePermission
                      permission={PlatformPermission.MailersWrite}
                      redirectTo="/admin"
                    />
                  }
                >
                  <Route
                    path="/admin/mailers/add"
                    element={
                      <LazyPage>
                        <AddMailersPage />
                      </LazyPage>
                    }
                  />
                </Route>
              </Route>
            </Route>

            {/* Public share-link intake. Outside BOTH route guards on purpose:
                `ProtectedRoute` would bounce an anonymous prospect to /login,
                and `PublicOnlyRoute` would redirect a signed-in producer away
                from previewing their own link. Must sit above the catch-all. */}
            <Route
              path="/f/lead/:token"
              element={
                <LazyPage>
                  <PublicLeadFormPage />
                </LazyPage>
              }
            />

            {/* Accept an employee invite (PAC-58). Outside BOTH guards, for the
                same two reasons as the share-link form above: `ProtectedRoute`
                would bounce an invitee who has no session yet to /login, and
                `PublicOnlyRoute` would redirect away anyone who *does* have one
                — an owner checking their own invite, or a new hire on a machine
                where a colleague is still signed in. Must sit above the
                catch-all. */}
            <Route
              path="/auth/accept-invite"
              element={
                <LazyPage>
                  <AcceptInvitePage />
                </LazyPage>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </BrowserRouter>
          {/* `sonner` was installed but never mounted, so `toast()` silently
              no-opped. Used by the share-link dialog's copy action. */}
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </ThemeProvider>
  );
}
