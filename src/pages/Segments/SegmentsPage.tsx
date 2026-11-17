import { useState } from 'react';
import { Filter, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDeleteSegment, useSaveSegment, useSegments } from '@/hooks/useSegments';
import { useSegmentCount } from '@/hooks/useContacts';
import { FilterPanel } from '@/components/contacts/FilterPanel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtNumber } from '@/lib/utils';
import type { Segment, SegmentFilter } from '@/types/db';

function Counts({ filter }: { filter: SegmentFilter }) {
  const { data, isLoading } = useSegmentCount(filter);
  if (isLoading || !data) return <Skeleton className="h-12" />;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-md bg-muted/60 p-2"><p className="text-lg font-semibold tabular-nums">{fmtNumber(data.total)}</p><p className="text-[11px] text-muted-foreground">contatos</p></div>
      <div className="rounded-md bg-accent p-2 text-accent-foreground"><p className="text-lg font-semibold tabular-nums">{fmtNumber(data.eligible)}</p><p className="text-[11px]">elegíveis p/ convite</p></div>
      <div className="rounded-md bg-muted/60 p-2"><p className="text-lg font-semibold tabular-nums">{fmtNumber(data.without_consent)}</p><p className="text-[11px] text-muted-foreground">sem autorização</p></div>
    </div>
  );
}

export function SegmentsPage() {
  const { data, isLoading, error } = useSegments();
  const save = useSaveSegment();
  const del = useDeleteSegment();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Segment> | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>({});

  const open = (s?: Segment) => { setEditing(s ?? { name: '' }); setFilter(s?.filter_definition ?? {}); };
  const submit = async () => {
    if (!editing?.name?.trim()) { toast('Informe um nome para o segmento', 'error'); return; }
    try { await save.mutateAsync({ id: editing.id, name: editing.name.trim(), description: editing.description, filter_definition: filter }); toast('Segmento salvo'); setEditing(null); }
    catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <>
      <PageHeader title="Segmentação" description="Salve filtros como segmentos reutilizáveis. Convites só alcançam contatos elegíveis (telefone válido + autorização registrada + fora da supressão)."
        actions={<Button onClick={() => open()}><Plus /> Novo segmento</Button>} />
      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <Skeleton className="h-40" /> : !data?.length ? (
        <EmptyState icon={Filter} title="Nenhum segmento" description="Exemplos: Contatos do Grupo X; DDD 84; Únicos e com autorização; Ainda não convidados." action={<Button onClick={() => open()}><Plus /> Criar segmento</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((s) => (
            <Card key={s.id} className="grid gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-medium">{s.name}</p>{s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}</div>
                <div className="flex">
                  <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => open(s)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={async () => {
                    if (!window.confirm(`Excluir o segmento "${s.name}"? Os contatos não são afetados.`)) return;
                    try { await del.mutateAsync(s.id); toast('Segmento excluído'); } catch (e) { toast(errorMessage(e), 'error'); }
                  }}><Trash2 /></Button>
                </div>
              </div>
              <Counts filter={s.filter_definition} />
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} side="right" title={editing?.id ? 'Editar segmento' : 'Novo segmento'}
        footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={submit} loading={save.isPending}>Salvar segmento</Button></>}>
        {editing && (
          <div className="grid gap-5">
            <Field label="Nome" htmlFor="seg-name"><Input id="seg-name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} /></Field>
            <Field label="Descrição (opcional)" htmlFor="seg-desc"><Input id="seg-desc" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={500} /></Field>
            <Counts filter={filter} />
            <FilterPanel value={filter} onChange={setFilter} />
          </div>
        )}
      </Dialog>
    </>
  );
}
