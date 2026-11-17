import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Download, Filter, Search, ShieldCheck, Users, X } from 'lucide-react';
import { useContacts } from '@/hooks/useContacts';
import { useSources } from '@/hooks/useSources';
import { useDebounced } from '@/hooks/useDebounced';
import { useContactAction } from '@/hooks/useContacts';
import { FilterPanel, countActiveFilters } from '@/components/contacts/FilterPanel';
import { ContactDrawer } from '@/components/contacts/ContactDrawer';
import { ConsentDialog } from '@/components/contacts/ConsentDialog';
import { Pagination } from '@/components/contacts/Pagination';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ConsentBadge, ValidationBadge } from '@/components/shared/StatusBadge';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDate } from '@/lib/utils';
import { formatPhoneBR } from '@/utils/phone';
import type { ContactOverview, SegmentFilter } from '@/types/db';

const PAGE = 25;

export function ContactsPage() {
  const [filter, setFilter] = useState<SegmentFilter>({});
  const [draft, setDraft] = useState<SegmentFilter>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consentIds, setConsentIds] = useState<string[]>([]);
  const q = useDebounced(search);
  const effective = useMemo(() => ({ ...filter, search: q || undefined }), [filter, q]);
  const { data, isLoading, error, isFetching } = useContacts(effective, page, PAGE);
  const sources = useSources(true);
  const sourceName = (id: string) => sources.data?.find((s) => s.id === id)?.name ?? '—';
  const act = useContactAction();
  const toast = useToast();
  const active = countActiveFilters(filter);

  const rows = data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; });

  const bulkBlock = async () => {
    if (!window.confirm(`Bloquear ${selected.size} contato(s)? Eles não poderão receber convites.`)) return;
    try { await act.mutateAsync({ kind: 'block', ids: [...selected] }); toast('Contatos bloqueados'); setSelected(new Set()); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };

  const Sources = ({ r }: { r: ContactOverview }) => (
    <span className="text-muted-foreground">{r.source_ids.map(sourceName).join(', ') || '—'}{r.occurrences > 1 && <span className="ml-1 text-xs">({r.occurrences}×)</span>}</span>
  );

  return (
    <>
      <PageHeader title="Central de contatos" description="Um registro por telefone, com todas as origens. Busca e filtros rodam no servidor."
        actions={<Link to="/relatorios" className={buttonVariants({ variant: 'outline' })}><Download /> Exportar elegíveis</Link>} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar por nome ou telefone" placeholder="Buscar por nome ou telefone…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <Button variant="outline" onClick={() => { setDraft(filter); setFiltersOpen(true); }}>
          <Filter /> Filtros {active > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{active}</span>}
        </Button>
        {active > 0 && <Button variant="ghost" onClick={() => { setFilter({}); setPage(0); }}><X /> Limpar</Button>}
      </div>

      {selected.size > 0 && (
        <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConsentIds([...selected])}><ShieldCheck /> Registrar autorização</Button>
            <Button size="sm" variant="outline" onClick={bulkBlock}><Ban /> Bloquear</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
          </div>
        </Card>
      )}

      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <Skeleton className="h-96" /> : rows.length === 0 ? (
        <EmptyState icon={Users} title={q || active ? 'Nenhum contato encontrado' : 'Nenhum contato ainda'} description={q || active ? 'Ajuste a busca ou os filtros.' : 'Importe uma lista para começar.'}
          action={!q && !active ? <Link to="/importar" className={buttonVariants()}>Importar contatos</Link> : undefined} />
      ) : (
        <Card className={isFetching ? 'opacity-70 transition-opacity' : ''}>
          {/* Desktop/tablet: tabela */}
          <div className="hidden md:block">
            <Table>
              <THead><TR>
                <TH className="w-10"><input type="checkbox" aria-label="Selecionar página" className="size-4 accent-[var(--primary)]" checked={allOnPage} onChange={togglePage} /></TH>
                <TH>Nome</TH><TH>Telefone</TH><TH>DDD</TH><TH>Origem</TH><TH>Validação</TH><TH>Autorização</TH><TH>Cadastro</TH><TH>Atualização</TH>
              </TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <TD onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Selecionar ${r.name ?? 'contato'}`} className="size-4 accent-[var(--primary)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></TD>
                    <TD className="max-w-48 truncate font-medium">{r.name ?? <span className="text-muted-foreground">sem nome</span>}{r.name_conflicts.length > 0 && <span className="ml-1 text-xs text-warning" title="Conflito de nome">●</span>}</TD>
                    <TD className="whitespace-nowrap font-mono text-xs">{r.normalized_phone ? formatPhoneBR(r.normalized_phone) : r.original_phone}</TD>
                    <TD>{r.area_code ?? '—'}</TD>
                    <TD className="max-w-48 truncate"><Sources r={r} /></TD>
                    <TD><ValidationBadge s={r.validation_status} /></TD>
                    <TD><ConsentBadge s={r.consent_status} /></TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(r.created_at)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(r.updated_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {/* Celular: cartões */}
          <ul className="divide-y md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-3 p-4">
                <input type="checkbox" aria-label={`Selecionar ${r.name ?? 'contato'}`} className="mt-1 size-5 accent-[var(--primary)]" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <button className="grid min-w-0 flex-1 gap-1 text-left" onClick={() => setOpenId(r.id)}>
                  <span className="truncate font-medium">{r.name ?? 'sem nome'}</span>
                  <span className="font-mono text-xs">{r.normalized_phone ? formatPhoneBR(r.normalized_phone) : r.original_phone}</span>
                  <span className="truncate text-xs"><Sources r={r} /></span>
                  <span className="flex flex-wrap gap-1"><ValidationBadge s={r.validation_status} /><ConsentBadge s={r.consent_status} /></span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t p-3"><Pagination page={page} pageSize={PAGE} total={data?.total ?? 0} onPage={setPage} /></div>
        </Card>
      )}

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} side="right" title="Filtros"
        footer={<><Button variant="outline" onClick={() => setDraft({})}>Limpar</Button><Button onClick={() => { setFilter(draft); setPage(0); setFiltersOpen(false); }}>Aplicar filtros</Button></>}>
        <FilterPanel value={draft} onChange={setDraft} />
      </Dialog>
      <ContactDrawer id={openId} onClose={() => setOpenId(null)} />
      <ConsentDialog ids={consentIds} open={consentIds.length > 0} onClose={() => { setConsentIds([]); setSelected(new Set()); }} />
    </>
  );
}
