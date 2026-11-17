import { useEffect, useState } from 'react';
import { Ban, Download, ShieldCheck, ShieldOff, Trash2, Unlock } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Notice, Skeleton } from '@/components/ui/feedback';
import { ConsentBadge, EventBadge, ValidationBadge } from '@/components/shared/StatusBadge';
import { ConsentDialog, METHOD_LABEL } from './ConsentDialog';
import { downloadPersonalData, useContactAction, useContactDetail } from '@/hooks/useContacts';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDate, fmtDateTime } from '@/lib/utils';
import { formatPhoneBR } from '@/utils/phone';
import type { InvitationEventType } from '@/types/db';

export function ContactDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useContactDetail(id);
  const act = useContactAction();
  const toast = useToast();
  const [consentOpen, setConsentOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const c = data?.contact;
  useEffect(() => { setName(c?.name ?? ''); }, [c?.name]);
  useEffect(() => { setNotes(''); }, [id]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); } catch (e) { toast(errorMessage(e), 'error'); }
  };

  return (
    <Dialog open={!!id} onClose={onClose} side="right" title={c?.name || 'Contato sem nome'} description={c?.normalized_phone ? formatPhoneBR(c.normalized_phone) : c?.original_phone ?? ''}>
      {isLoading && <div className="grid gap-3"><Skeleton className="h-6" /><Skeleton className="h-24" /></div>}
      {error && <Notice tone="danger">{errorMessage(error)}</Notice>}
      {c && data && (
        <div className="grid gap-6 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <ValidationBadge s={c.validation_status} /><ConsentBadge s={c.consent_status} />
            {c.suppressed && <Badge tone="danger">Lista de supressão</Badge>}
          </div>

          <section className="grid gap-2">
            <h3 className="font-medium">Dados</h3>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted-foreground">Telefone original</dt><dd className="font-mono text-xs">{c.original_phone ?? '—'}</dd>
              <dt className="text-muted-foreground">DDD / UF</dt><dd>{c.area_code ?? '—'} {c.uf && `· ${c.uf}`}</dd>
              <dt className="text-muted-foreground">Tipo</dt><dd>{c.line_type === 'mobile' ? 'Celular' : c.line_type === 'landline' ? 'Fixo' : '—'}</dd>
              <dt className="text-muted-foreground">Cadastro</dt><dd>{fmtDateTime(c.created_at)}</dd>
              <dt className="text-muted-foreground">Atualização</dt><dd>{fmtDateTime(c.updated_at)}</dd>
            </dl>
            {c.validation_issues.length > 0 && <Notice tone="warning">{c.validation_issues.join('; ')}</Notice>}
            <p className="text-xs text-muted-foreground">Telefone válido não significa que o número tem WhatsApp.</p>
          </section>

          {c.validation_status !== 'erased' && (
            <section className="grid gap-3">
              <h3 className="font-medium">Editar</h3>
              <Field label="Nome" htmlFor="d-name"><Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Field>
              {c.name_conflicts.length > 0 && (
                <div className="grid gap-2 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Outras fontes trouxeram nomes diferentes. Escolha o correto:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[c.name, ...c.name_conflicts].filter(Boolean).map((n) => (
                      <Button key={n} size="sm" variant="outline" onClick={() => run(() => act.mutateAsync({ kind: 'resolve-name', id: c.id, name: n! }), 'Nome definido')}>{n}</Button>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Observação" htmlFor="d-notes"><Textarea id="d-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
              <div><Button size="sm" variant="outline" loading={act.isPending}
                onClick={() => run(() => act.mutateAsync({ kind: 'edit', id: c.id, name: name.trim() || null, notes: notes.trim() || null }), 'Contato atualizado')}>Salvar alterações</Button></div>
            </section>
          )}

          <section className="grid gap-2">
            <h3 className="font-medium">Fontes relacionadas ({data.occurrences.length})</h3>
            <ul className="divide-y rounded-lg border">
              {data.occurrences.map((o, i) => (
                <li key={i} className="flex flex-col gap-0.5 p-3">
                  <span className="flex items-center gap-2 font-medium">{o.source_name}{i === 0 && <Badge tone="info">Primeira importação</Badge>}</span>
                  <span className="text-xs text-muted-foreground">{o.original_name ?? 'sem nome'} · {o.file_name}, linha {o.row_number} · {fmtDate(o.imported_at)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2">
            <h3 className="font-medium">Histórico de autorização</h3>
            {data.consents.length === 0 ? <p className="text-muted-foreground">Nenhum registro. Telefone em lista não é autorização.</p> : (
              <ul className="divide-y rounded-lg border">
                {data.consents.map((r) => (
                  <li key={r.id} className="grid gap-0.5 p-3">
                    <span className="font-medium">{r.status === 'authorized' ? 'Autorizado' : r.status === 'revoked' ? 'Revogado' : 'Pendente'} · {fmtDateTime(r.created_at)}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.collection_method ? METHOD_LABEL[r.collection_method] : ''}{r.evidence_reference ? ` · ${r.evidence_reference}` : ''}
                      {r.obtained_at ? ` · obtida em ${fmtDate(r.obtained_at)}` : ''}{r.revoked_at ? ` · revogada em ${fmtDate(r.revoked_at)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.events.length > 0 && (
            <section className="grid gap-2">
              <h3 className="font-medium">Convites</h3>
              <ul className="grid gap-1.5">{data.events.map((e) => <li key={e.id} className="flex items-center justify-between gap-2"><EventBadge s={e.event_type as InvitationEventType} /><span className="text-xs text-muted-foreground">{fmtDateTime(e.occurred_at)}</span></li>)}</ul>
            </section>
          )}

          {c.validation_status !== 'erased' && (
            <section className="grid gap-2 border-t pt-4">
              <h3 className="font-medium">Ações e LGPD</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {c.consent_status !== 'blocked' && c.consent_status !== 'authorized' && <Button variant="outline" onClick={() => setConsentOpen(true)}><ShieldCheck /> Registrar autorização</Button>}
                {c.consent_status === 'authorized' && <Button variant="outline" onClick={() => run(() => act.mutateAsync({ kind: 'consent', ids: [c.id], status: 'revoked' }), 'Autorização revogada')}><ShieldOff /> Registrar revogação</Button>}
                {c.consent_status === 'blocked'
                  ? <Button variant="outline" onClick={() => run(() => act.mutateAsync({ kind: 'unblock', ids: [c.id] }), 'Contato desbloqueado')}><Unlock /> Desbloquear</Button>
                  : <Button variant="outline" onClick={() => run(() => act.mutateAsync({ kind: 'block', ids: [c.id] }), 'Contato bloqueado')}><Ban /> Bloquear contato</Button>}
                <Button variant="outline" onClick={() => run(() => downloadPersonalData(c.id), 'Arquivo gerado')}><Download /> Exportar dados do titular</Button>
                <Button variant="destructive" onClick={() => {
                  if (window.confirm('Excluir os dados pessoais deste contato? O telefone ficará apenas na lista de supressão para não ser contatado novamente. Esta ação não pode ser desfeita.'))
                    run(async () => { await act.mutateAsync({ kind: 'delete', ids: [c.id] }); onClose(); }, 'Dados excluídos');
                }}><Trash2 /> Excluir (pedido do titular)</Button>
              </div>
            </section>
          )}
        </div>
      )}
      {c && <ConsentDialog ids={[c.id]} open={consentOpen} onClose={() => setConsentOpen(false)} />}
    </Dialog>
  );
}
