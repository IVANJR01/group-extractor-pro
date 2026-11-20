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
const WhatsAppExtractorPage = lazy(() => import('@/pages/WhatsAppExtractor/WhatsAppExtractorPage').then((m) => ({ default: m.WhatsAppExtractorPage })));
const SettingsPage = lazy(() => import('@/pages/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PublicSignupPage = lazy(() => import('@/pages/Signup/PublicSignupPage').then((m) => ({ default: m.PublicSignupPage })));

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
                  <Route path="/i/:slug" element={<PublicSignupPage />} />
                  <Route path="/entrar" element={<PublicOnly><LoginPage /></PublicOnly>} />
                  <Route element={<Protected><AppLayout /></Protected>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="extrair-whatsapp" element={<WhatsAppExtractorPage />} />
                    <Route path="importar" element={<Navigate to="/" replace />} />
                    <Route path="contatos" element={<Navigate to="/" replace />} />
                    <Route path="grupos" element={<Navigate to="/" replace />} />
                    <Route path="convites" element={<Navigate to="/" replace />} />
                    <Route path="convites/:id" element={<Navigate to="/" replace />} />
                    <Route path="fontes" element={<Navigate to="/" replace />} />
                    <Route path="duplicidades" element={<Navigate to="/" replace />} />
                    <Route path="segmentos" element={<Navigate to="/" replace />} />
                    <Route path="inscricoes" element={<Navigate to="/" replace />} />
                    <Route path="relatorios" element={<Navigate to="/" replace />} />
                    <Route path="historico" element={<Navigate to="/" replace />} />
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
