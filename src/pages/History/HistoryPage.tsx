import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Play, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cancelImport, resumeImport, type ImportProgress } from '@/services/imports/runImport';
import { Pagination } from '@/components/contacts/Pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader, Progress, Skeleton } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { JobBadge } from '@/components/shared/StatusBadge';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDateTime, fmtNumber } from '@/lib/utils';
import { AUDIT_LABEL } from '@/utils/labels';
import type { AuditLog, ImportJob } from '@/types/db';

const PAGE = 20;

function ImportsTab() {
  const [page, setPage] = useState(0);
  const [running, setRunning] = useState<{ id: string; p: ImportProgress | null } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: ['import-jobs', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from('import_jobs').select('*, contact_sources(name)', { count: 'exact' })
        .order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as (ImportJob & { contact_sources: { name: string } | null })[], total: count ?? 0 };
    },
  });

  const resume = async (j: ImportJob) => {
    setRunning({ id: j.id, p: null });
    try {
      const p = await resumeImport(j.id, (x) => setRunning({ id: j.id, p: x }));
      toast(p.done ? 'Importação concluída' : `Processadas todas as linhas enviadas (${fmtNumber(p.uploaded_rows)} de ${fmtNumber(p.total_rows)}). Para o restante, importe o arquivo novamente: nada será duplicado.`, p.done ? 'success' : 'info');
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setRunning(null); qc.invalidateQueries(); }
  };
  const cancel = async (j: ImportJob) => {
    if (!window.confirm('Cancelar esta importação? O que já foi processado é mantido.')) return;
    try { await cancelImport(j.id); toast('Importação cancelada'); qc.invalidateQueries({ queryKey: ['import-jobs'] }); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };

  if (isLoading) return <Skeleton className="h-80" />;
  if (error) return <Notice tone="danger">{errorMessage(error)}</Notice>;
  if (!data?.rows.length) return <EmptyState icon={History} title="Nenhuma importação ainda" />;
  return (
    <Card>
      <Table>
        <THead><TR><TH>Data</TH><TH>Arquivo</TH><TH>Fonte</TH><TH>Situação</TH><TH>Linhas</TH><TH>Novos</TH><TH>Duplicados</TH><TH>Inválidos</TH><TH /></TR></THead>
        <TBody>{data.rows.map((j) => {
          const open = ['pending', 'uploading', 'processing'].includes(j.status);
          return (
            <TR key={j.id}>
              <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(j.created_at)}</TD>
              <TD className="max-w-48 truncate font-medium" title={j.file_name}>{j.file_name}</TD>
              <TD>{j.contact_sources?.name}</TD>
              <TD>
                <JobBadge s={j.status} />
                {running?.id === j.id && running.p && <div className="mt-1 w-28"><Progress value={(running.p.processed_rows / Math.max(1, running.p.total_rows)) * 100} /></div>}
                {j.error_details.length > 0 && <p className="mt-1 max-w-48 text-xs text-destructive">{j.error_details.at(-1)?.message}</p>}
              </TD>
              <TD className="tabular-nums">{fmtNumber(j.processed_rows)}/{fmtNumber(j.total_rows)}</TD>
              <TD className="tabular-nums">{fmtNumber(j.new_contacts)}</TD>
              <TD className="tabular-nums">{fmtNumber(j.duplicate_rows)}</TD>
              <TD className="tabular-nums">{fmtNumber(j.invalid_rows)}</TD>
              <TD>{open && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => resume(j)} loading={running?.id === j.id}><Play /> Retomar</Button>
                  <Button size="icon" variant="ghost" aria-label="Cancelar importação" onClick={() => cancel(j)}><XCircle /></Button>
                </div>
              )}</TD>
            </TR>
          );
        })}</TBody>
      </Table>
      <div className="border-t p-3"><Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} /></div>
    </Card>
  );
}

function AuditTab() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as AuditLog[], total: count ?? 0 };
    },
  });
  if (isLoading) return <Skeleton className="h-80" />;
  if (error) return <Notice tone="danger">{errorMessage(error)}</Notice>;
  const detail = (m: Record<string, unknown>) =>
    Object.entries(m).filter(([k, v]) => v !== null && k !== 'filter' && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ');
  return (
    <Card>
      <Table>
        <THead><TR><TH>Data</TH><TH>Ação</TH><TH>Detalhes</TH></TR></THead>
        <TBody>{data?.rows.map((a) => (
          <TR key={a.id}>
            <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(a.created_at)}</TD>
            <TD className="font-medium">{AUDIT_LABEL[a.action] ?? a.action}</TD>
            <TD className="text-xs text-muted-foreground">{detail(a.metadata)}</TD>
          </TR>
        ))}</TBody>
      </Table>
      <div className="border-t p-3"><Pagination page={page} pageSize={PAGE} total={data?.total ?? 0} onPage={setPage} /></div>
    </Card>
  );
}

export function HistoryPage() {
  const [tab, setTab] = useState<'imports' | 'audit'>('imports');
  return (
    <>
      <PageHeader title="Histórico" description="Importações (com retomada segura) e trilha de auditoria. Registros de auditoria não podem ser alterados nem apagados." />
      <div className="flex gap-2">
        <Button size="sm" variant={tab === 'imports' ? 'default' : 'outline'} onClick={() => setTab('imports')}>Importações</Button>
        <Button size="sm" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Auditoria</Button>
      </div>
      {tab === 'imports' ? <ImportsTab /> : <AuditTab />}
    </>
  );
}
