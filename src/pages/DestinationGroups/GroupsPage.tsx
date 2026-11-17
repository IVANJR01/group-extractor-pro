import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Link2Off, Pencil, Plus, Send, Share2, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useGroups } from '@/hooks/useGroups';
import { useSegments } from '@/hooks/useSegments';
import { INVITE_URL_RE, DEFAULT_TEMPLATE, getIntegration } from '@/integrations/whatsapp/manual';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDate, fmtNumber } from '@/lib/utils';
import type { DestinationGroup } from '@/types/db';

const schema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  description: z.string().trim().max(500).optional(),
  invite_url: z.string().trim().refine((v) => v === '' || INVITE_URL_RE.test(v), 'Use um link no formato https://chat.whatsapp.com/…'),
  status: z.enum(['active', 'inactive']),
});
type F = z.infer<typeof schema>;

function useGroupStats() {
  return useQuery({
    queryKey: ['group-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('group_stats');
      if (error) throw error;
      return data as { destination_group_id: string; campaigns: number; shared: number; joined: number }[];
    },
  });
}

function useGroupSegments() {
  return useQuery({
    queryKey: ['group-segments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('destination_group_segments').select('destination_group_id, segment_id');
      if (error) throw error;
      return data as { destination_group_id: string; segment_id: string }[];
    },
  });
}

function GroupDialog({ group, open, onClose }: { group: DestinationGroup | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { register, handleSubmit, formState } = useForm<F>({
    resolver: zodResolver(schema),
    values: { name: group?.name ?? '', description: group?.description ?? '', invite_url: group?.invite_url ?? '', status: group?.status ?? 'active' },
  });
  const submit = handleSubmit(async (v) => {
    const row = { name: v.name, description: v.description || null, invite_url: v.invite_url || null, status: v.status };
    const res = group ? await supabase.from('destination_groups').update(row).eq('id', group.id) : await supabase.from('destination_groups').insert(row);
    if (res.error) { toast(errorMessage(res.error), 'error'); return; }
    qc.invalidateQueries({ queryKey: ['groups'] });
    toast(group ? 'Grupo atualizado' : 'Grupo cadastrado');
    onClose();
  });
  return (
    <Dialog open={open} onClose={onClose} title={group ? 'Editar grupo de destino' : 'Novo grupo de destino'}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={formState.isSubmitting}>Salvar</Button></>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nome" htmlFor="g-name" error={formState.errors.name?.message}><Input id="g-name" placeholder="Grupo A" {...register('name')} /></Field>
        <Field label="Descrição" htmlFor="g-desc"><Textarea id="g-desc" rows={2} placeholder="Comunidade principal" {...register('description')} /></Field>
        <Field label="Link de convite" htmlFor="g-url" error={formState.errors.invite_url?.message} hint="Copie em: WhatsApp › grupo › Convidar via link.">
          <Input id="g-url" inputMode="url" placeholder="https://chat.whatsapp.com/…" {...register('invite_url')} />
        </Field>
        <Field label="Situação" htmlFor="g-status"><Select id="g-status" {...register('status')}><option value="active">Ativo</option><option value="inactive">Inativo</option></Select></Field>
        <Notice>Cadastrar o link não cria conexão técnica com o grupo do WhatsApp. O sistema não vê nem conta os participantes; entradas só aparecem quando registradas.</Notice>
      </form>
    </Dialog>
  );
}

export function GroupsPage() {
  const { data, isLoading, error } = useGroups();
  const stats = useGroupStats();
  const segments = useSegments();
  const links = useGroupSegments();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<DestinationGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [assoc, setAssoc] = useState<{ group: string; segment: string }>({ group: '', segment: '' });

  const toggleLink = useMutation({
    mutationFn: async (g: DestinationGroup) => {
      const { error } = await supabase.from('destination_groups').update({ invite_link_status: g.invite_link_status === 'active' ? 'disabled' : 'active' }).eq('id', g.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });

  const share = async (g: DestinationGroup) => {
    const integ = getIntegration();
    const check = integ.validateConfiguration(g);
    if (!check.ok) { toast(check.reason, 'error'); return; }
    const r = await integ.shareInvite(integ.createInvite(g, DEFAULT_TEMPLATE));
    if (r.kind === 'opened') toast(r.channel === 'clipboard' ? 'Mensagem copiada. Cole onde quiser compartilhar.' : 'Compartilhamento aberto. O envio depende de você.', 'info');
  };

  const addSegment = async (groupId: string, segmentId: string) => {
    const { error } = await supabase.from('destination_group_segments').insert({ destination_group_id: groupId, segment_id: segmentId });
    if (error) toast(errorMessage(error), 'error'); else { qc.invalidateQueries({ queryKey: ['group-segments'] }); setAssoc({ group: '', segment: '' }); }
  };
  const removeSegment = async (groupId: string, segmentId: string) => {
    const { error } = await supabase.from('destination_group_segments').delete().eq('destination_group_id', groupId).eq('segment_id', segmentId);
    if (error) toast(errorMessage(error), 'error'); else qc.invalidateQueries({ queryKey: ['group-segments'] });
  };

  return (
    <>
      <PageHeader title="Grupos de destino" description="Cadastre o Grupo A e outros grupos para onde as pessoas podem entrar voluntariamente."
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus /> Novo grupo</Button>} />
      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <Skeleton className="h-48" /> : !data?.length ? (
        <EmptyState icon={UsersRound} title="Nenhum grupo de destino" description="Comece cadastrando o Grupo A com o link de convite do WhatsApp." action={<Button onClick={() => setOpen(true)}><Plus /> Cadastrar Grupo A</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((g) => {
            const st = stats.data?.find((s) => s.destination_group_id === g.id);
            const segs = links.data?.filter((l) => l.destination_group_id === g.id) ?? [];
            return (
              <Card key={g.id} className="grid gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{g.name}</p>
                    {g.description && <p className="text-sm text-muted-foreground">{g.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">Criado em {fmtDate(g.created_at)}{g.invite_link_updated_at && ` · link atualizado em ${fmtDate(g.invite_link_updated_at)}`}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status === 'active' ? 'Ativo' : 'Inativo'}</Badge>
                    {g.invite_url && <Badge tone={g.invite_link_status === 'active' ? 'info' : 'danger'}>{g.invite_link_status === 'active' ? 'Link ativo' : 'Link desativado'}</Badge>}
                  </div>
                </div>
                {g.invite_url ? (
                  <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{g.invite_url}</span>
                    <Button variant="ghost" size="icon" aria-label="Copiar link" onClick={async () => { await navigator.clipboard.writeText(g.invite_url!); toast('Link copiado', 'info'); }}><Copy /></Button>
                  </div>
                ) : <Notice tone="warning">Sem link cadastrado: convites ficam indisponíveis.</Notice>}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md border p-2"><p className="font-semibold tabular-nums">{fmtNumber(st?.campaigns)}</p><p className="text-[11px] text-muted-foreground">campanhas</p></div>
                  <div className="rounded-md border p-2"><p className="font-semibold tabular-nums">{fmtNumber(st?.shared)}</p><p className="text-[11px] text-muted-foreground">compartilhados</p></div>
                  <div className="rounded-md border p-2"><p className="font-semibold tabular-nums">{fmtNumber(st?.joined)}</p><p className="text-[11px] text-muted-foreground">adesões registradas</p></div>
                </div>
                <div className="grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Segmentos associados</p>
                  <div className="flex flex-wrap gap-1.5">
                    {segs.map((l) => (
                      <Badge key={l.segment_id} tone="outline" className="gap-1.5">
                        {segments.data?.find((s) => s.id === l.segment_id)?.name ?? '—'}
                        <button onClick={() => removeSegment(g.id, l.segment_id)} aria-label="Remover segmento" className="text-muted-foreground hover:text-foreground">×</button>
                      </Badge>
                    ))}
                    <Select aria-label="Associar segmento" className="h-8 w-auto text-xs" value={assoc.group === g.id ? assoc.segment : ''}
                      onChange={(e) => { if (e.target.value) addSegment(g.id, e.target.value); else setAssoc({ group: '', segment: '' }); }}>
                      <option value="">+ Associar segmento</option>
                      {segments.data?.filter((s) => !segs.some((l) => l.segment_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Link to={`/convites?grupo=${g.id}`} className={buttonVariants({ size: 'sm' })}><Send /> Nova campanha</Link>
                  <Button size="sm" variant="outline" onClick={() => share(g)}><Share2 /> Compartilhar convite</Button>
                  {g.invite_url && <Button size="sm" variant="outline" onClick={() => toggleLink.mutate(g)}>{g.invite_link_status === 'active' ? <><Link2Off /> Desativar link</> : <><Link2 /> Reativar link</>}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(g); setOpen(true); }}><Pencil /> Editar</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <GroupDialog group={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
