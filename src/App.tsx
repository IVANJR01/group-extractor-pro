import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { ThemeProvider } from '@/contexts/theme';
import { ToastProvider } from '@/contexts/toast';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/Auth/LoginPage';
import { SetupRequired } from '@/pages/Auth/SetupRequired';
import { Skeleton } from '@/components/ui/feedback';

const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ImportPage = lazy(() => import('@/pages/Imports/ImportPage').then((m) => ({ default: m.ImportPage })));
const ContactsPage = lazy(() => import('@/pages/Contacts/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const DuplicatesPage = lazy(() => import('@/pages/Duplicates/DuplicatesPage').then((m) => ({ default: m.DuplicatesPage })));
const SegmentsPage = lazy(() => import('@/pages/Segments/SegmentsPage').then((m) => ({ default: m.SegmentsPage })));
const GroupsPage = lazy(() => import('@/pages/DestinationGroups/GroupsPage').then((m) => ({ default: m.GroupsPage })));
const InvitationsPage = lazy(() => import('@/pages/Invitations/InvitationsPage').then((m) => ({ default: m.InvitationsPage })));
const CampaignPage = lazy(() => import('@/pages/Invitations/CampaignPage').then((m) => ({ default: m.CampaignPage })));
const ReportsPage = lazy(() => import('@/pages/Reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const HistoryPage = lazy(() => import('@/pages/History/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SourcesPage = lazy(() => import('@/pages/Sources/SourcesPage').then((m) => ({ default: m.SourcesPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8"><Skeleton className="h-8 w-48" /></div>;
  if (!session) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const Fallback = () => <div className="grid gap-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-64" /></div>;

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <Suspense fallback={<Fallback />}>
                <Routes>
                  <Route path="/entrar" element={<PublicOnly><LoginPage /></PublicOnly>} />
                  <Route element={<Protected><AppLayout /></Protected>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="fontes" element={<SourcesPage />} />
                    <Route path="importar" element={<ImportPage />} />
                    <Route path="contatos" element={<ContactsPage />} />
                    <Route path="duplicidades" element={<DuplicatesPage />} />
                    <Route path="segmentos" element={<SegmentsPage />} />
                    <Route path="grupos" element={<GroupsPage />} />
                    <Route path="convites" element={<InvitationsPage />} />
                    <Route path="convites/:id" element={<CampaignPage />} />
                    <Route path="relatorios" element={<ReportsPage />} />
                    <Route path="historico" element={<HistoryPage />} />
                    <Route path="configuracoes" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
