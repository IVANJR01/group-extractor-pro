import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, MoreHorizontal, RefreshCw, Share2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCampaign, useCampaignContacts, useRecordEvent, type CampaignContact } from '@/hooks/useCampaigns';
import { useGroups } from '@/hooks/useGroups';
import { getIntegration } from '@/integrations/whatsapp/manual';
import { Pagination } from '@/components/contacts/Pagination';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EventBadge } from '@/components/shared/StatusBadge';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDateTime, fmtNumber } from '@/lib/utils';
import { formatPhoneBR } from '@/utils/phone';
import { EVENT_LABEL } from '@/utils/labels';
import type { InvitationEventType } from '@/types/db';

const SUMMARY_ORDER: InvitationEventType[] = ['prepared', 'shared', 'join_confirmed', 'no_confirmation', 'declined', 'opt_out'];
const MANUAL_OUTCOMES: InvitationEventType[] = ['join_confirmed', 'no_confirmation', 'declined', 'opt_out'];

export function CampaignPage() {
  const { id } = useParams();
  const [page, setPage] = useState(0);
  const [outcome, setOutcome] = useState<CampaignContact | null>(null);
  const [evidence, setEvidence] = useState('');
  const { data, isLoading, error } = useCampaign(id);
  const contacts = useCampaignContacts(id, page);
  const groups = useGroups();
  const record = useRecordEvent();
  const qc = useQueryClient();
  const toast = useToast();
  const group = groups.data?.find((g) => g.id === data?.campaign.destination_group_id);
  const integ = getIntegration();

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <Notice tone="danger">{errorMessage(error)}</Notice>;
  const { campaign, summary } = data;
  const check = group ? integ.validateConfiguration(group) : { ok: false as const, reason: 'Grupo não encontrado.' };

  const share = async (c: CampaignContact) => {
    if (!group || !check.ok) { toast(check.ok ? 'Grupo indisponível' : check.reason, 'error'); return; }
    const msg = integ.createInvite({ ...group, invite_url: group.invite_url }, campaign.message_body, c);
    const r = await integ.shareInvite(msg, c);
    if (r.kind === 'dismissed') return;
    try {
      // Registramos apenas que o compartilhamento foi aberto, nunca que a mensagem foi enviada.
      await record.mutateAsync({ campaignId: campaign.id, contactId: c.contact_id, type: 'shared', metadata: { channel: r.channel } });
      toast('Conversa aberta no WhatsApp. Registrado como “compartilhado, sem confirmação de envio”.', 'info');
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  const saveOutcome = async (type: InvitationEventType) => {
    if (!outcome) return;
    if (type === 'join_confirmed' && evidence.trim().length < 3) { toast('Descreva a evidência da entrada (ex.: conferido na lista do grupo em 17/11).', 'error'); return; }
    try {
      await record.mutateAsync({ campaignId: campaign.id, contactId: outcome.contact_id, type, metadata: evidence.trim() ? { evidence: evidence.trim().slice(0, 300) } : {} });
      toast(EVENT_LABEL[type][0] + ' registrado');
      setOutcome(null); setEvidence('');
    } catch (e) { toast(errorMessage(e), 'error'); }
  };

  const reprepare = async () => {
    const { data: r, error: e } = await supabase.rpc('prepare_campaign', { p_campaign_id: campaign.id });
    if (e) { toast(errorMessage(e), 'error'); return; }
    qc.invalidateQueries({ queryKey: ['campaign', campaign.id] }); qc.invalidateQueries({ queryKey: ['campaign-contacts', campaign.id] });
    toast(`${fmtNumber((r as { prepared: number }).prepared)} novos convites preparados`);
  };

  const close = async () => {
    const { error: e } = await supabase.from('invitation_campaigns').update({ status: 'completed' }).eq('id', campaign.id);
    if (e) toast(errorMessage(e), 'error'); else { qc.invalidateQueries({ queryKey: ['campaign', campaign.id] }); qc.invalidateQueries({ queryKey: ['campaigns'] }); toast('Campanha encerrada'); }
  };

  return (
    <>
      <Link to="/convites" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Convites</Link>
      <PageHeader title={campaign.name} description={`${group?.name ?? ''} · ${fmtNumber(campaign.eligible_count)} elegíveis · ${fmtNumber(campaign.excluded_count)} ficaram de fora (sem autorização, bloqueados ou inválidos)`}
        actions={campaign.status === 'active' ? <>
          <Button variant="outline" onClick={reprepare}><RefreshCw /> Atualizar elegíveis</Button>
          <Button variant="outline" onClick={close}>Encerrar campanha</Button>
        </> : undefined} />

      {!check.ok && <Notice tone="warning">{check.reason}</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {SUMMARY_ORDER.map((t) => (
          <Card key={t} className="p-3"><p className="text-xs text-muted-foreground">{EVENT_LABEL[t][0].replace(' (sem confirmação de envio)', '')}</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmtNumber(summary[t] ?? 0)}</p></Card>
        ))}
      </div>
      <Notice>
        “Compartilhado” significa que a conversa foi aberta no seu WhatsApp; não prova que a mensagem foi enviada.
        Entradas no grupo só contam quando você registra a evidência. Sem integração oficial, não existe confirmação automática.
      </Notice>

      <Card>
        <Table>
          <THead><TR><TH>Contato</TH><TH>Telefone</TH><TH>Situação atual</TH><TH>Atualizado</TH><TH className="text-right">Ações</TH></TR></THead>
          <TBody>
            {contacts.data?.rows.map((c) => (
              <TR key={c.contact_id}>
                <TD className="font-medium">{c.name ?? 'sem nome'}</TD>
                <TD className="whitespace-nowrap font-mono text-xs">{c.normalized_phone ? formatPhoneBR(c.normalized_phone) : '—'}</TD>
                <TD><EventBadge s={c.last_event_type} />{!c.eligible && <span className="ml-1 text-xs text-destructive">não elegível</span>}</TD>
                <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(c.last_event_at)}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={!c.eligible || !check.ok || campaign.status !== 'active'} onClick={() => share(c)}><MessageCircle /> <span className="hidden sm:inline">Compartilhar convite</span></Button>
                    <Button size="icon" variant="ghost" aria-label="Registrar resultado" onClick={() => setOutcome(c)}><MoreHorizontal /></Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="border-t p-3"><Pagination page={page} pageSize={25} total={contacts.data?.total ?? 0} onPage={setPage} /></div>
      </Card>

      {group && check.ok && (
        <div><Button variant="outline" onClick={async () => { await integ.shareInvite(integ.createInvite(group, campaign.message_body)); }}><Share2 /> Compartilhar convite geral (sem contato específico)</Button></div>
      )}

      <Dialog open={!!outcome} onClose={() => setOutcome(null)} title="Registrar resultado" description={outcome?.name ?? ''}>
        <div className="grid gap-4">
          <Field label="Evidência ou observação" htmlFor="o-ev" hint="Obrigatória para entrada confirmada. Ex.: conferido na lista de participantes em 17/11.">
            <Input id="o-ev" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {MANUAL_OUTCOMES.map((t) => <Button key={t} variant={t === 'opt_out' ? 'destructive' : 'outline'} onClick={() => saveOutcome(t)} loading={record.isPending}>{EVENT_LABEL[t][0]}</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">Opt-out revoga a autorização e coloca o telefone na lista de supressão.</p>
        </div>
      </Dialog>
    </>
  );
}
