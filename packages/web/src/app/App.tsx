import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModuleKey } from '@sfa/shared';
import { AuthProvider } from '@/contexts/auth-context';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute';
import { RequirePermission } from '@/components/layout/RequirePermission';
import { LoginPage } from '@/pages/LoginPage';
import { DevNavPage } from '@/pages/DevNavPage';
import { usePermissions } from '@/hooks/usePermissions';
import { Toaster } from '@/components/ui/sonner';

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
const HouseholdDetailsPage = lazy(
  () => import('@/features/household/HouseholdDetailsPage'),
);
const LeadsPage = lazy(() => import('@/features/lead/LeadsPage'));
const NewLeadPage = lazy(() => import('@/features/lead/NewLeadPage'));
const PublicLeadFormPage = lazy(
  () => import('@/features/lead/PublicLeadFormPage'),
);
const LeadDetailsPage = lazy(() => import('@/features/lead/LeadDetailsPage'));
const RolePermissionsPage = lazy(
  () => import('@/features/admin/RolePermissionsPage'),
);
const UsersPage = lazy(() => import('@/features/admin/UsersPage'));
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
  const { canRead } = usePermissions();

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<RoleLanding />} />
              <Route path="/nav" element={<DevNavPage />} />

              {/* Feature pages gated by per-page read access */}
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
              </Route>

              <Route
                element={
                  <RequirePermission permission={`${ModuleKey.Clients}:read`} />
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
                  path="/clients/demo"
                  element={
                    <LazyPage>
                      <HouseholdDetailsPage />
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
                <Route
                  path="/leads/:id"
                  element={
                    <LazyPage>
                      <LeadDetailsPage />
                    </LazyPage>
                  }
                />
                <Route
                  path="/leads/demo"
                  element={
                    <LazyPage>
                      <LeadDetailsPage />
                    </LazyPage>
                  }
                />
              </Route>

              {/* Owner-only role & per-user permission management */}
              <Route
                element={<RequirePermission permission="agency:users:permissions" />}
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        {/* `sonner` was installed but never mounted, so `toast()` silently
            no-opped. Used by the share-link dialog's copy action. */}
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
