import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCampaigns, useTemplates } from '@/hooks/useCampaigns';
import { useGroups } from '@/hooks/useGroups';
import { useSegments } from '@/hooks/useSegments';
import { useSegmentCount } from '@/hooks/useContacts';
import { DEFAULT_TEMPLATE, getIntegration } from '@/integrations/whatsapp/manual';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDate, fmtNumber } from '@/lib/utils';

const STATUS: Record<string, [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  draft: ['Rascunho', 'neutral'], active: ['Ativa', 'info'], completed: ['Encerrada', 'success'], cancelled: ['Cancelada', 'danger'],
};

function NewCampaign({ open, onClose, initialGroup }: { open: boolean; onClose: () => void; initialGroup?: string }) {
  const groups = useGroups();
  const segments = useSegments();
  const templates = useTemplates();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [groupId, setGroupId] = useState(initialGroup ?? '');
  const [segmentId, setSegmentId] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState(DEFAULT_TEMPLATE);
  const [saveTpl, setSaveTpl] = useState(false);
  const [busy, setBusy] = useState(false);
  const group = groups.data?.find((g) => g.id === groupId);
  const segment = segments.data?.find((s) => s.id === segmentId);
  const count = useSegmentCount(segment?.filter_definition ?? {}, !!segment);
  const check = group ? getIntegration().validateConfiguration(group) : null;

  const create = async () => {
    if (!group || !segment || !check?.ok) return;
    if (!body.includes('{{link}}')) { toast('A mensagem precisa conter {{link}}', 'error'); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from('invitation_campaigns')
        .insert({ destination_group_id: group.id, segment_id: segment.id, name: name.trim() || `${group.name} · ${segment.name}`, message_body: body })
        .select('id').single();
      if (error) throw error;
      if (saveTpl) await supabase.from('message_templates').insert({ name: name.trim() || 'Modelo de convite', body });
      const { data: prep, error: pErr } = await supabase.rpc('prepare_campaign', { p_campaign_id: data.id });
      if (pErr) throw pErr;
      toast(`Campanha criada: ${fmtNumber((prep as { prepared: number }).prepared)} convites preparados`);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
      nav(`/convites/${data.id}`);
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} side="right" title="Nova campanha de convite"
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={create} loading={busy} disabled={!check?.ok || !segment || !count.data?.eligible}>Criar e preparar convites</Button></>}>
      <div className="grid gap-5">
        <Field label="1. Grupo de destino" htmlFor="nc-group">
          <Select id="nc-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Selecione…</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        {check && !check.ok && <Notice tone="warning">{check.reason}</Notice>}
        <Field label="2. Segmento" htmlFor="nc-seg" hint="Crie segmentos em Segmentação.">
          <Select id="nc-seg" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            <option value="">Selecione…</option>
            {segments.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {segment && count.data && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">3–5. Elegibilidade</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2"><p className="text-lg font-semibold tabular-nums">{fmtNumber(count.data.total)}</p><p className="text-[11px] text-muted-foreground">no segmento</p></div>
              <div className="rounded-md bg-accent p-2 text-accent-foreground"><p className="text-lg font-semibold tabular-nums">{fmtNumber(count.data.eligible)}</p><p className="text-[11px]">com autorização</p></div>
              <div className="rounded-md border p-2"><p className="text-lg font-semibold tabular-nums">{fmtNumber(count.data.total - count.data.eligible)}</p><p className="text-[11px] text-muted-foreground">ficam de fora</p></div>
            </div>
            {count.data.eligible === 0 && <Notice tone="warning">Nenhum contato deste segmento tem autorização registrada. Registre autorizações na Central de contatos.</Notice>}
          </div>
        )}
        <Field label="Nome da campanha" htmlFor="nc-name"><Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Convite novembro" /></Field>
        <div className="grid gap-2">
          <div className="flex items-end justify-between gap-2">
            <p className="text-sm font-medium">6. Mensagem</p>
            {!!templates.data?.length && (
              <Select aria-label="Usar modelo" className="h-8 w-auto text-xs" value="" onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setBody(t.body); }}>
                <option value="">Usar modelo salvo…</option>
                {templates.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </div>
          <Textarea aria-label="Mensagem do convite" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
          <p className="text-xs text-muted-foreground">Use {'{{link}}'} para o link do grupo e {'{{nome}}'} para o primeiro nome.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={saveTpl} onChange={(e) => setSaveTpl(e.target.checked)} /> Salvar como modelo</label>
          {group?.invite_url && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{getIntegration().createInvite(group, body, { name: 'Maria Silva', normalized_phone: null })}</div>
          )}
        </div>
        <Notice>Somente contatos com autorização registrada entram. O sistema não envia mensagens sozinho: cada convite é aberto no seu WhatsApp para você enviar.</Notice>
      </div>
    </Dialog>
  );
}

export function InvitationsPage() {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(!!params.get('grupo'));
  const { data, isLoading, error } = useCampaigns();
  const groups = useGroups();

  return (
    <>
      <PageHeader title="Convites" description="Campanhas de convite voluntário para o grupo de destino, apenas para quem autorizou."
        actions={<Button onClick={() => setOpen(true)}><Plus /> Nova campanha</Button>} />
      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {isLoading ? <Skeleton className="h-40" /> : !data?.length ? (
        <EmptyState icon={Send} title="Nenhuma campanha" description="Crie um grupo de destino, um segmento e registre autorizações. Depois crie a campanha." action={<Button onClick={() => setOpen(true)}><Plus /> Criar campanha</Button>} />
      ) : (
        <div className="grid gap-3">
          {data.map((c) => (
            <Link key={c.id} to={`/convites/${c.id}`}>
              <Card className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{groups.data?.find((g) => g.id === c.destination_group_id)?.name} · criada em {fmtDate(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="tabular-nums">{fmtNumber(c.eligible_count)} elegíveis</span>
                  <span className="tabular-nums text-muted-foreground">{fmtNumber(c.excluded_count)} excluídos</span>
                  <Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <NewCampaign open={open} onClose={() => setOpen(false)} initialGroup={params.get('grupo') ?? undefined} />
    </>
  );
}
