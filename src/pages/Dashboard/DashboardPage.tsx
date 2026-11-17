import { Link } from 'react-router-dom';
import {
  Users, CalendarPlus, Fingerprint, Copy, AlertCircle, ShieldCheck, ShieldQuestion, Ban, Share2, UserCheck, Upload, Activity, type LucideIcon,
} from 'lucide-react';
import { useDashboard } from '@/hooks/useDashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { buttonVariants } from '@/components/ui/button';
import { ConsentChart, DuplicatesChart, HBarChart, ImportsChart, JoinsChart } from '@/components/dashboard/charts';
import { errorMessage, fmtDateTime, fmtNumber } from '@/lib/utils';
import { AUDIT_LABEL } from '@/utils/labels';

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: number; hint?: string; tone?: 'warn' | 'danger' | 'good' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className={`size-4 ${tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : tone === 'good' ? 'text-success' : 'text-muted-foreground'}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{fmtNumber(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function ChartCard({ title, description, children, empty }: { title: string; description?: string; children: React.ReactNode; empty: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent>{empty ? <p className="grid h-40 place-items-center text-sm text-muted-foreground">Sem dados ainda.</p> : children}</CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard(30);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </>
    );
  }
  if (error || !data) return <Notice tone="danger" title="Não foi possível carregar o dashboard">{errorMessage(error)}</Notice>;

  const k = data.kpis;
  const empty = k.total_contacts === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Indicadores calculados em tempo real a partir do seu banco de dados."
        actions={<Link to="/importar" className={buttonVariants()}><Upload /> Importar contatos</Link>}
      />

      {empty && (
        <EmptyState icon={Upload} title="Nenhum contato ainda" description="Cadastre uma fonte (ex.: Grupo X) e importe um arquivo CSV, Excel ou TXT para começar."
          action={<Link to="/fontes" className={buttonVariants({ variant: 'outline' })}>Cadastrar fonte</Link>} />
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Indicadores">
        <Kpi icon={Users} label="Contatos cadastrados" value={k.total_contacts} />
        <Kpi icon={CalendarPlus} label="Importados no mês" value={k.imported_this_month} hint="registros de origem" />
        <Kpi icon={Fingerprint} label="Contatos únicos" value={k.unique_contacts} hint="telefone válido" tone="good" />
        <Kpi icon={Copy} label="Duplicados" value={k.duplicate_occurrences} hint="ocorrências repetidas" tone="warn" />
        <Kpi icon={AlertCircle} label="Inválidos" value={k.invalid_contacts} tone="danger" />
        <Kpi icon={ShieldCheck} label="Com autorização" value={k.authorized} tone="good" />
        <Kpi icon={ShieldQuestion} label="Sem autorização comprovada" value={k.without_consent} tone="warn" />
        <Kpi icon={Ban} label="Bloqueados / exclusão" value={k.blocked_or_revoked} tone="danger" />
        <Kpi icon={Share2} label="Convites compartilhados" value={k.invites_shared} hint="sem prova de envio" />
        <Kpi icon={UserCheck} label="Entradas confirmadas" value={k.joins_confirmed} hint="com evidência registrada" tone="good" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Importações por período" description="Últimos 30 dias" empty={data.imports_by_day.every((d) => d.rows === 0)}>
          <ImportsChart data={data.imports_by_day} />
        </ChartCard>
        <ChartCard title="Contatos por origem" empty={data.by_source.length === 0}>
          <HBarChart data={data.by_source} k="source" label="Contatos" />
        </ChartCard>
        <ChartCard title="Contatos por DDD" description="15 DDDs com mais contatos" empty={data.by_ddd.length === 0}>
          <HBarChart data={data.by_ddd} k="ddd" label="Contatos" />
        </ChartCard>
        <ChartCard title="Duplicidades encontradas" description="Últimas 10 importações" empty={data.duplicates_by_import.length === 0}>
          <DuplicatesChart data={data.duplicates_by_import} />
        </ChartCard>
        <ChartCard title="Evolução das adesões" description="Somente eventos efetivamente registrados" empty={data.joins_by_day.every((d) => d.shared + d.joined === 0)}>
          <JoinsChart data={data.joins_by_day} />
        </ChartCard>
        <ChartCard title="Situação de autorização" empty={data.consent_distribution.length === 0}>
          <ConsentChart data={data.consent_distribution} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Atividade recente</CardTitle></CardHeader>
        <CardContent>
          {data.recent_activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade ainda.</p>
          ) : (
            <ul className="divide-y">
              {data.recent_activity.map((a, i) => (
                <li key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm">{AUDIT_LABEL[a.action] ?? a.action}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
