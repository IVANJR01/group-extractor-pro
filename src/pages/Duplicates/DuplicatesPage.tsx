import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSources } from '@/hooks/useSources';
import { useDashboard } from '@/hooks/useDashboard';
import { ContactDrawer } from '@/components/contacts/ContactDrawer';
import { Pagination } from '@/components/contacts/Pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { errorMessage, fmtNumber } from '@/lib/utils';
import { formatPhoneBR } from '@/utils/phone';
import type { ContactOverview } from '@/types/db';

const PAGE = 25;

export function DuplicatesPage() {
  const [tab, setTab] = useState<'dups' | 'conflicts'>('dups');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const dash = useDashboard(30);
  const sources = useSources(true);
  const sourceName = (id: string) => sources.data?.find((s) => s.id === id)?.name ?? '—';

  const { data, isLoading, error } = useQuery({
    queryKey: ['duplicates', tab, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('contact_overview').select('*', { count: 'exact' });
      q = tab === 'dups' ? q.gt('occurrences', 1).not('normalized_phone', 'is', null) : q.neq('name_conflicts', '{}');
      const { data, error, count } = await q.order('occurrences', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as ContactOverview[], total: count ?? 0 };
    },
  });

  return (
    <>
      <PageHeader title="Duplicidades" description="O mesmo telefone vindo de várias fontes vira um único contato. Nenhum registro de origem é apagado." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Ocorrências repetidas</p><p className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(dash.data?.kpis.duplicate_occurrences)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Telefones únicos</p><p className="mt-1 text-2xl font-semibold tabular-nums">{fmtNumber(dash.data?.kpis.unique_contacts)}</p></Card>
      </div>
      <div className="flex gap-2">
        <Button variant={tab === 'dups' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('dups'); setPage(0); }}>Contatos em várias fontes</Button>
        <Button variant={tab === 'conflicts' ? 'default' : 'outline'} size="sm" onClick={() => { setTab('conflicts'); setPage(0); }}>Conflitos de nome</Button>
      </div>
      {tab === 'conflicts' && <Notice>Quando fontes trazem nomes diferentes para o mesmo telefone, o primeiro nome é mantido. Abra o contato para escolher o correto.</Notice>}
      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <Skeleton className="h-80" /> : !data?.rows.length ? (
        <EmptyState icon={Copy} title={tab === 'dups' ? 'Nenhuma duplicidade' : 'Nenhum conflito de nome'} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Contato</TH><TH>Telefone</TH><TH>Ocorrências</TH><TH>Fontes</TH>{tab === 'conflicts' && <TH>Outros nomes</TH>}</TR></THead>
            <TBody>{data.rows.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                <TD className="font-medium">{r.name ?? 'sem nome'}</TD>
                <TD className="whitespace-nowrap font-mono text-xs">{r.normalized_phone ? formatPhoneBR(r.normalized_phone) : r.original_phone}</TD>
                <TD><Badge tone="warning">{r.occurrences}×</Badge></TD>
                <TD className="text-muted-foreground">{r.source_ids.map(sourceName).join(', ')}</TD>
                {tab === 'conflicts' && <TD>{r.name_conflicts.join(', ')}</TD>}
              </TR>
            ))}</TBody>
          </Table>
          <div className="border-t p-3"><Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} /></div>
        </Card>
      )}
      <ContactDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
