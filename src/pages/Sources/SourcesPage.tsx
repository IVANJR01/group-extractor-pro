import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, Database, Pencil, Plus, Upload } from 'lucide-react';
import { useSaveSource, useSourceStats, useSources } from '@/hooks/useSources';
import { sourceSchema, type SourceForm } from '@/schemas/source';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDate, fmtNumber } from '@/lib/utils';
import { SOURCE_TYPE_LABEL } from '@/utils/labels';
import type { ContactSource } from '@/types/db';

export function SourceDialog({ open, onClose, source, onSaved }: { open: boolean; onClose: () => void; source?: ContactSource | null; onSaved?: (s: ContactSource) => void }) {
  const save = useSaveSource();
  const toast = useToast();
  const { register, handleSubmit, formState, reset } = useForm<SourceForm>({
    resolver: zodResolver(sourceSchema),
    values: { name: source?.name ?? '', source_type: source?.source_type ?? 'group', description: source?.description ?? '' },
  });
  const submit = handleSubmit(async (v) => {
    try {
      const s = await save.mutateAsync({ ...v, id: source?.id });
      toast(source ? 'Fonte atualizada' : 'Fonte cadastrada');
      reset(); onSaved?.(s); onClose();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });
  return (
    <Dialog open={open} onClose={onClose} title={source ? 'Editar fonte' : 'Nova fonte de contatos'}
      description="A fonte identifica de onde a lista veio. Ex.: Grupo X, Lista de clientes."
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={formState.isSubmitting}>Salvar</Button></>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nome" htmlFor="src-name" error={formState.errors.name?.message}><Input id="src-name" placeholder="Grupo X" {...register('name')} /></Field>
        <Field label="Tipo" htmlFor="src-type">
          <Select id="src-type" {...register('source_type')}>
            {Object.entries(SOURCE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Descrição (opcional)" htmlFor="src-desc" error={formState.errors.description?.message} hint="Como a lista foi obtida e com qual finalidade.">
          <Textarea id="src-desc" {...register('description')} />
        </Field>
        <Notice>Use apenas listas obtidas legitimamente. Estar numa lista não significa autorização para receber mensagens.</Notice>
      </form>
    </Dialog>
  );
}

export function SourcesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading, error } = useSources(showArchived);
  const stats = useSourceStats();
  const save = useSaveSource();
  const toast = useToast();
  const [editing, setEditing] = useState<ContactSource | null>(null);
  const [open, setOpen] = useState(false);
  const countOf = (name: string) => stats.data?.find((s) => s.source === name)?.contacts ?? 0;

  const toggleArchive = async (s: ContactSource) => {
    try {
      await save.mutateAsync({ id: s.id, name: s.name, source_type: s.source_type, description: s.description, status: s.status === 'active' ? 'archived' : 'active' });
      toast(s.status === 'active' ? 'Fonte arquivada (histórico preservado)' : 'Fonte reativada');
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <>
      <PageHeader title="Fontes de contatos" description="Cadastre as origens das suas listas. Fontes não são apagadas: são arquivadas para preservar o histórico."
        actions={<>
          <Button variant="outline" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}</Button>
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus /> Nova fonte</Button>
        </>} />

      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : data && data.length === 0 ? (
          <EmptyState icon={Database} title="Nenhuma fonte cadastrada" description="Exemplo: Grupo X, Grupo Y, Lista Excel." action={<Button onClick={() => setOpen(true)}><Plus /> Cadastrar primeira fonte</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data?.map((s) => (
              <Card key={s.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{SOURCE_TYPE_LABEL[s.source_type]}</p>
                  </div>
                  {s.status === 'archived' && <Badge>Arquivada</Badge>}
                </div>
                {s.description && <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}
                <div className="mt-auto flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{fmtNumber(countOf(s.name))}</p>
                    <p className="text-xs text-muted-foreground">contatos · desde {fmtDate(s.created_at)}</p>
                  </div>
                  <div className="flex gap-1">
                    {s.status === 'active' && (
                      <Link to={`/importar?fonte=${s.id}`} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={`Importar para ${s.name}`} title="Importar"><Upload /></Link>
                    )}
                    <Button variant="ghost" size="icon" aria-label="Editar" title="Editar" onClick={() => { setEditing(s); setOpen(true); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon" aria-label={s.status === 'active' ? 'Arquivar' : 'Reativar'} title={s.status === 'active' ? 'Arquivar' : 'Reativar'} onClick={() => toggleArchive(s)}>
                      {s.status === 'active' ? <Archive /> : <ArchiveRestore />}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      <SourceDialog open={open} onClose={() => setOpen(false)} source={editing} />
    </>
  );
}
