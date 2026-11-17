import { useState } from 'react';
import { Download, FileSpreadsheet, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSources } from '@/hooks/useSources';
import { cleanFilter } from '@/hooks/useContacts';
import { FilterPanel, countActiveFilters } from '@/components/contacts/FilterPanel';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Notice, PageHeader } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { downloadTable, fetchContactExport, logExport, type ContactExportKind, type ExportFormat } from '@/services/exports';
import { errorMessage, fmtNumber } from '@/lib/utils';
import { CONSENT_LABEL, EVENT_LABEL, JOB_STATUS_LABEL, VALIDATION_LABEL } from '@/utils/labels';
import type { ConsentStatus, InvitationEventType, JobStatus, SegmentFilter, ValidationStatus } from '@/types/db';

const CONTACT_REPORTS: { kind: ContactExportKind; title: string; desc: string }[] = [
  { kind: 'unique', title: 'Contatos únicos', desc: 'Um registro por telefone válido.' },
  { kind: 'by_source', title: 'Contatos por origem', desc: 'Escolha a fonte abaixo.' },
  { kind: 'by_ddd', title: 'Contatos por DDD', desc: 'Informe o DDD abaixo.' },
  { kind: 'authorized', title: 'Contatos autorizados', desc: 'Telefone válido e autorização registrada.' },
  { kind: 'unauthorized', title: 'Sem autorização comprovada', desc: 'Para buscar a comprovação; não usar para comunicação.' },
  { kind: 'duplicates', title: 'Contatos duplicados', desc: 'Telefones que apareceram em mais de uma linha/fonte.' },
  { kind: 'invalid', title: 'Contatos inválidos', desc: 'Para correção da lista de origem.' },
];

const CONTACT_HEADERS = ['Nome', 'Telefone', 'DDD', 'UF', 'Validação', 'Autorização', 'Fontes', 'Ocorrências', 'Cadastro'];

export function ReportsPage() {
  const toast = useToast();
  const sources = useSources(true);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [filter, setFilter] = useState<SegmentFilter>({});
  const [draft, setDraft] = useState<SegmentFilter>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [ddd, setDdd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const exportContacts = async (kind: ContactExportKind) => {
    let f: SegmentFilter = { ...filter };
    if (kind === 'by_source') { if (!sourceId) { toast('Escolha a fonte', 'error'); return; } f = { ...f, source_ids: [sourceId] }; }
    if (kind === 'by_ddd') { if (!/^\d{2}$/.test(ddd)) { toast('Informe um DDD com 2 dígitos', 'error'); return; } f = { ...f, area_codes: [ddd] }; }
    setBusy(kind);
    try {
      const rows = await fetchContactExport(kind, cleanFilter(f));
      if (rows.length === 0) { toast('Nenhum registro elegível para esta exportação', 'info'); return; }
      await downloadTable(`contatos-${kind}`, CONTACT_HEADERS, rows.map((r) => [
        r.name, r.phone, r.area_code, r.uf, VALIDATION_LABEL[r.validation_status as ValidationStatus]?.[0] ?? r.validation_status,
        CONSENT_LABEL[r.consent_status as ConsentStatus]?.[0] ?? r.consent_status, r.sources, r.occurrences, r.created_at.slice(0, 10),
      ]), format);
      toast(`${fmtNumber(rows.length)} registros exportados`);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const exportImports = async () => {
    setBusy('imports');
    try {
      const { data, error } = await supabase.from('import_jobs').select('created_at, file_name, file_type, status, total_rows, valid_rows, invalid_rows, duplicate_rows, new_contacts, contact_sources(name)').order('created_at', { ascending: false }).limit(1000);
      if (error) throw error;
      await downloadTable('historico-importacoes', ['Data', 'Arquivo', 'Tipo', 'Fonte', 'Situação', 'Linhas', 'Válidas', 'Inválidas', 'Duplicadas', 'Contatos novos'],
        (data as unknown as { created_at: string; file_name: string; file_type: string; status: JobStatus; total_rows: number; valid_rows: number; invalid_rows: number; duplicate_rows: number; new_contacts: number; contact_sources: { name: string } | null }[])
          .map((j) => [j.created_at.slice(0, 16).replace('T', ' '), j.file_name, j.file_type, j.contact_sources?.name, JOB_STATUS_LABEL[j.status][0], j.total_rows, j.valid_rows, j.invalid_rows, j.duplicate_rows, j.new_contacts]), format);
      await logExport('import_jobs', data.length);
      toast('Histórico de importações exportado');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const exportInvites = async () => {
    setBusy('invites');
    try {
      const { data, error } = await supabase.from('invitation_events').select('occurred_at, event_type, source, invitation_campaigns(name), contacts(name, normalized_phone)').order('occurred_at', { ascending: false }).limit(1000);
      if (error) throw error;
      await downloadTable('historico-convites', ['Data', 'Campanha', 'Contato', 'Telefone', 'Evento', 'Origem do registro'],
        (data as unknown as { occurred_at: string; event_type: InvitationEventType; source: string; invitation_campaigns: { name: string } | null; contacts: { name: string | null; normalized_phone: string | null } | null }[])
          .map((e) => [e.occurred_at.slice(0, 16).replace('T', ' '), e.invitation_campaigns?.name, e.contacts?.name, e.contacts?.normalized_phone, EVENT_LABEL[e.event_type][0], e.source === 'user' ? 'Registrado pelo usuário' : 'Integração']), format);
      await logExport('invitation_events', data.length);
      toast('Histórico de convites exportado');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(null); }
  };

  const active = countActiveFilters(filter);

  return (
    <>
      <PageHeader title="Relatórios e exportação" description="Toda exportação fica registrada (quem, quando e quais critérios). Contatos bloqueados ou revogados nunca são exportados."
        actions={<>
          <Select aria-label="Formato" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} className="w-auto"><option value="xlsx">Excel (XLSX)</option><option value="csv">CSV</option></Select>
          <Button variant="outline" onClick={() => { setDraft(filter); setFiltersOpen(true); }}><Filter /> Filtros {active > 0 && `(${active})`}</Button>
        </>} />
      {active > 0 && <Notice>Os filtros selecionados são aplicados a todas as exportações de contatos.</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CONTACT_REPORTS.map((r) => (
          <Card key={r.kind} className="flex flex-col">
            <CardHeader><CardTitle>{r.title}</CardTitle><CardDescription>{r.desc}</CardDescription></CardHeader>
            <div className="mt-auto grid gap-3 p-5 pt-0">
              {r.kind === 'by_source' && (
                <Select aria-label="Fonte" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">Escolha a fonte…</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )}
              {r.kind === 'by_ddd' && <Field label="DDD" htmlFor="r-ddd"><Input id="r-ddd" inputMode="numeric" maxLength={2} value={ddd} onChange={(e) => setDdd(e.target.value.replace(/\D/g, ''))} placeholder="84" /></Field>}
              <Button variant="outline" onClick={() => exportContacts(r.kind)} loading={busy === r.kind}><Download /> Exportar</Button>
            </div>
          </Card>
        ))}
        <Card className="flex flex-col">
          <CardHeader><CardTitle>Histórico de importações</CardTitle><CardDescription>Arquivos, fontes e contadores.</CardDescription></CardHeader>
          <div className="mt-auto p-5 pt-0"><Button variant="outline" className="w-full" onClick={exportImports} loading={busy === 'imports'}><FileSpreadsheet /> Exportar</Button></div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader><CardTitle>Histórico de convites</CardTitle><CardDescription>Eventos registrados por campanha.</CardDescription></CardHeader>
          <div className="mt-auto p-5 pt-0"><Button variant="outline" className="w-full" onClick={exportInvites} loading={busy === 'invites'}><FileSpreadsheet /> Exportar</Button></div>
        </Card>
      </div>

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} side="right" title="Filtros da exportação"
        footer={<><Button variant="outline" onClick={() => setDraft({})}>Limpar</Button><Button onClick={() => { setFilter(draft); setFiltersOpen(false); }}>Aplicar</Button></>}>
        <FilterPanel value={draft} onChange={setDraft} />
      </Dialog>
    </>
  );
}
