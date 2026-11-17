import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Copy, ExternalLink, Pause, Pencil, Play, Plus, Share2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useGroups } from '@/hooks/useGroups';
import { formatPhoneBR } from '@/utils/phone';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, Notice, PageHeader, Skeleton } from '@/components/ui/feedback';
import { useToast } from '@/contexts/toast';
import { errorMessage, fmtDateTime, fmtNumber } from '@/lib/utils';
import type { SignupForm, SignupSubmission } from '@/types/db';

export const consentTemplate = (organizer: string, group?: string) =>
  `Autorizo ${organizer || '[seu nome ou empresa]'} a usar meu nome e WhatsApp para me enviar o convite ${group ? `do grupo ${group}` : 'do grupo'} e mensagens relacionadas. Posso cancelar quando quiser.`;

const schema = z.object({
  title: z.string().trim().min(3, 'Mínimo de 3 letras').max(120),
  description: z.string().trim().max(600).optional(),
  organizer_name: z.string().trim().min(2, 'Informe quem está coletando os dados').max(120),
  consent_text: z.string().trim().min(20, 'Texto de autorização muito curto').max(1000),
  destination_group_id: z.string(),
});
type F = z.infer<typeof schema>;

export const signupUrl = (slug: string) => `${window.location.origin}/i/${slug}`;

function useSignupForms() {
  return useQuery({
    queryKey: ['signup-forms'],
    queryFn: async () => {
      const { data, error } = await supabase.from('signup_forms').select('*, signup_submissions(count)').order('created_at', { ascending: false });
      if (error) throw error;
      return data as SignupForm[];
    },
  });
}

function useRecentSubmissions() {
  return useQuery({
    queryKey: ['signup-submissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('signup_submissions')
        .select('id, form_id, contact_id, name, phone, outcome, created_at').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data as SignupSubmission[];
    },
  });
}

function FormDialog({ form, open, onClose }: { form: SignupForm | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useGroups();
  const { register, handleSubmit, formState, watch, setValue } = useForm<F>({
    resolver: zodResolver(schema),
    values: {
      title: form?.title ?? '', description: form?.description ?? '', organizer_name: form?.organizer_name ?? '',
      consent_text: form?.consent_text ?? '', destination_group_id: form?.destination_group_id ?? '',
    },
  });
  const organizer = watch('organizer_name');
  const groupId = watch('destination_group_id');
  const fillConsent = () => setValue('consent_text', consentTemplate(organizer, groups.data?.find((g) => g.id === groupId)?.name), { shouldValidate: true });

  const submit = handleSubmit(async (v) => {
    const group = v.destination_group_id || null;
    const res = form
      ? await supabase.from('signup_forms').update({ title: v.title, description: v.description || null, organizer_name: v.organizer_name, consent_text: v.consent_text, destination_group_id: group }).eq('id', form.id)
      : await supabase.rpc('create_signup_form', { p_title: v.title, p_organizer_name: v.organizer_name, p_consent_text: v.consent_text, p_description: v.description || null, p_destination_group_id: group });
    if (res.error) { toast(errorMessage(res.error), 'error'); return; }
    qc.invalidateQueries({ queryKey: ['signup-forms'] });
    qc.invalidateQueries({ queryKey: ['sources'] });
    toast(form ? 'Página atualizada' : 'Página criada. Copie o link e divulgue.');
    onClose();
  });

  return (
    <Dialog open={open} onClose={onClose} title={form ? 'Editar página de inscrição' : 'Nova página de inscrição'}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={formState.isSubmitting}>Salvar</Button></>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Título da página" htmlFor="sf-title" error={formState.errors.title?.message}>
          <Input id="sf-title" placeholder="Grupo VIP de Segurança do Trabalho" {...register('title')} />
        </Field>
        <Field label="Descrição (opcional)" htmlFor="sf-desc" hint="Conte o que a pessoa ganha ao entrar.">
          <Textarea id="sf-desc" rows={3} placeholder="Dicas semanais de NRs, vagas e materiais gratuitos." {...register('description')} />
        </Field>
        <Field label="Quem coleta os dados" htmlFor="sf-org" error={formState.errors.organizer_name?.message} hint="Seu nome ou da sua empresa. Aparece para a pessoa (exigência da LGPD).">
          <Input id="sf-org" placeholder="Ivan Treinamentos" {...register('organizer_name')} />
        </Field>
        <Field label="Grupo para onde a pessoa vai" htmlFor="sf-group" hint="Depois da inscrição aparece o botão para entrar nesse grupo.">
          <Select id="sf-group" {...register('destination_group_id')}>
            <option value="">Nenhum (só cadastrar)</option>
            {groups.data?.filter((g) => g.status === 'active').map((g) => <option key={g.id} value={g.id}>{g.name}{g.invite_url ? '' : ' (sem link)'}</option>)}
          </Select>
        </Field>
        <Field label="Texto da autorização" htmlFor="sf-consent" error={formState.errors.consent_text?.message} hint="A pessoa marca esta caixa. O texto fica guardado como prova.">
          <Textarea id="sf-consent" rows={4} {...register('consent_text')} />
        </Field>
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={fillConsent}>Usar texto pronto</Button>
      </form>
    </Dialog>
  );
}

const OUTCOME: Record<SignupSubmission['outcome'], { label: string; tone: 'success' | 'info' | 'danger' }> = {
  new: { label: 'Novo contato', tone: 'success' },
  existing: { label: 'Já existia', tone: 'info' },
  suppressed: { label: 'Bloqueado', tone: 'danger' },
};

export function SignupFormsPage() {
  const forms = useSignupForms();
  const subs = useRecentSubmissions();
  const groups = useGroups();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<SignupForm | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: async (f: SignupForm) => {
      const { error } = await supabase.from('signup_forms').update({ status: f.status === 'active' ? 'paused' : 'active' }).eq('id', f.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signup-forms'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const copy = async (f: SignupForm) => {
    try { await navigator.clipboard.writeText(signupUrl(f.slug)); toast('Link copiado', 'info'); }
    catch { toast(signupUrl(f.slug), 'info'); }
  };
  const share = (f: SignupForm) => {
    const text = `${f.title}\n${f.description ? f.description + '\n' : ''}\nQuer participar? Faça sua inscrição aqui 👇\n${signupUrl(f.slug)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <>
      <PageHeader title="Páginas de inscrição"
        description="Divulgue o link nos seus grupos e redes. Quem se inscreve entra como contato autorizado, com prova do aceite."
        actions={<Button onClick={() => { setEditing(null); setOpen(true); }}><Plus /> Nova página</Button>} />
      {forms.error && <Notice tone="danger">{errorMessage(forms.error)}</Notice>}
      {forms.isLoading ? <Skeleton className="h-48" /> : !forms.data?.length ? (
        <EmptyState icon={ClipboardList} title="Nenhuma página de inscrição"
          description="Crie uma página, ligue ao Grupo A e poste o link no seu grupo do WhatsApp. As pessoas se cadastram sozinhas, com autorização."
          action={<Button onClick={() => setOpen(true)}><Plus /> Criar primeira página</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {forms.data.map((f) => {
            const total = f.signup_submissions?.[0]?.count ?? 0;
            const group = groups.data?.find((g) => g.id === f.destination_group_id);
            return (
              <Card key={f.id} className="grid gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{f.title}</p>
                    <p className="text-sm text-muted-foreground">{group ? `Leva para: ${group.name}` : 'Sem grupo ligado'} · {f.organizer_name}</p>
                  </div>
                  <Badge tone={f.status === 'active' ? 'success' : 'neutral'}>{f.status === 'active' ? 'Recebendo' : 'Pausada'}</Badge>
                </div>
                {group && !group.invite_url && <Notice tone="warning">O grupo ligado está sem link de convite. Cadastre o link em Grupos de destino.</Notice>}
                <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{signupUrl(f.slug)}</span>
                  <Button variant="ghost" size="icon" aria-label="Copiar link" onClick={() => copy(f)}><Copy /></Button>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{fmtNumber(total)}</span>
                  <span className="text-sm text-muted-foreground">inscrições</span>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" onClick={() => share(f)}><Share2 /> Divulgar no WhatsApp</Button>
                  <a href={`/i/${f.slug}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: 'sm', variant: 'outline' })}><ExternalLink /> Ver página</a>
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate(f)}>{f.status === 'active' ? <><Pause /> Pausar</> : <><Play /> Reabrir</>}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(f); setOpen(true); }}><Pencil /> Editar</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!!subs.data?.length && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <h2 className="font-medium">Últimas inscrições</h2>
            <Link to="/contatos" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>Ver na Central de contatos</Link>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <THead><TR><TH>Nome</TH><TH>WhatsApp</TH><TH>Página</TH><TH>Situação</TH><TH>Quando</TH></TR></THead>
              <TBody>
                {subs.data.map((s) => (
                  <TR key={s.id}>
                    <TD>{s.name ?? '—'}</TD>
                    <TD className="whitespace-nowrap font-mono text-xs">{s.phone ? formatPhoneBR(s.phone) : '—'}</TD>
                    <TD className="max-w-48 truncate">{forms.data?.find((f) => f.id === s.form_id)?.title ?? '—'}</TD>
                    <TD><Badge tone={OUTCOME[s.outcome].tone}>{OUTCOME[s.outcome].label}</Badge></TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(s.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}
      <FormDialog form={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
