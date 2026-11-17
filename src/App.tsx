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
import { ComingSoon } from '@/components/shared/ComingSoon';

const DashboardPage = lazy(() => import('@/pages/Dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ImportPage = lazy(() => import('@/pages/Imports/ImportPage').then((m) => ({ default: m.ImportPage })));
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
                    <Route path="contatos" element={<ComingSoon title="Central de contatos" description="Busca, filtros e ações por contato." phase="Fase 5" />} />
                    <Route path="duplicidades" element={<ComingSoon title="Duplicidades" description="Telefones repetidos entre fontes e conflitos de nome." phase="Fase 5" />} />
                    <Route path="segmentos" element={<ComingSoon title="Segmentação" description="Filtros salvos e reutilizáveis." phase="Fase 5" />} />
                    <Route path="grupos" element={<ComingSoon title="Grupos de destino" description="Cadastro do Grupo A e links de convite." phase="Fase 6" />} />
                    <Route path="convites" element={<ComingSoon title="Convites" description="Campanhas de convite para contatos autorizados." phase="Fase 6" />} />
                    <Route path="relatorios" element={<ComingSoon title="Relatórios" description="Exportações CSV e XLSX." phase="Fase 7" />} />
                    <Route path="historico" element={<ComingSoon title="Histórico" description="Importações e trilha de auditoria." phase="Fase 7" />} />
                    <Route path="configuracoes" element={<ComingSoon title="Configurações" description="Perfil, senha e privacidade." phase="Fase 7" />} />
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
