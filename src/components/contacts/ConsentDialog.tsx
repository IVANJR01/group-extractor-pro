import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Notice } from '@/components/ui/feedback';
import { useContactAction } from '@/hooks/useContacts';
import { useToast } from '@/contexts/toast';
import { errorMessage } from '@/lib/utils';

export const METHOD_LABEL: Record<string, string> = {
  form: 'Formulário de inscrição', written: 'Documento assinado', opt_in_message: 'Mensagem de opt-in (pessoa pediu)',
  verbal_recorded: 'Verbal gravado', event_signup: 'Inscrição em evento', other: 'Outro',
};

const schema = z.object({
  method: z.enum(['form', 'written', 'opt_in_message', 'verbal_recorded', 'event_signup', 'other']),
  evidence: z.string().trim().min(3, 'Informe uma referência da evidência').max(300),
  obtainedAt: z.string().min(1, 'Informe a data'),
  notes: z.string().max(500).optional(),
});
type F = z.infer<typeof schema>;

export function ConsentDialog({ ids, open, onClose }: { ids: string[]; open: boolean; onClose: () => void }) {
  const act = useContactAction();
  const toast = useToast();
  const { register, handleSubmit, formState, reset } = useForm<F>({
    resolver: zodResolver(schema), defaultValues: { method: 'form', obtainedAt: new Date().toISOString().slice(0, 10) },
  });
  const submit = handleSubmit(async (v) => {
    try {
      await act.mutateAsync({ kind: 'consent', ids, status: 'authorized', method: v.method, evidence: v.evidence, obtainedAt: v.obtainedAt, notes: v.notes });
      toast(ids.length > 1 ? `Autorização registrada para ${ids.length} contatos` : 'Autorização registrada');
      reset(); onClose();
    } catch (e) { toast(errorMessage(e), 'error'); }
  });
  return (
    <Dialog open={open} onClose={onClose} title="Registrar autorização" description={`Finalidade: convite para grupo · ${ids.length} contato(s)`}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={formState.isSubmitting}>Registrar</Button></>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Como a autorização foi obtida" htmlFor="c-method">
          <Select id="c-method" {...register('method')}>{Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Evidência (referência)" htmlFor="c-ev" error={formState.errors.evidence?.message} hint="Ex.: Formulário Inscrição 2026, resposta #482. Não cole dados pessoais aqui.">
          <Input id="c-ev" {...register('evidence')} />
        </Field>
        <Field label="Data da autorização" htmlFor="c-date" error={formState.errors.obtainedAt?.message}><Input id="c-date" type="date" {...register('obtainedAt')} /></Field>
        <Field label="Observações (opcional)" htmlFor="c-notes"><Textarea id="c-notes" rows={2} {...register('notes')} /></Field>
        <Notice tone="warning">Registre apenas autorizações que você consegue comprovar. Contatos bloqueados não podem receber nova autorização sem desbloqueio.</Notice>
      </form>
    </Dialog>
  );
}
