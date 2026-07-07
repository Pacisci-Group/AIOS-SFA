import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/auth-context';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { DevNavPage } from '@/pages/DevNavPage';

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
const LeadDetailsPage = lazy(() => import('@/features/lead/LeadDetailsPage'));

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
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F19] text-[#64748B] text-sm">
      Loading…
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
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
              <Route path="/" element={<DevNavPage />} />
              <Route
                path="/dashboard/producer"
                element={
                  <LazyPage>
                    <ProducerDashboardPage />
                  </LazyPage>
                }
              />
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
