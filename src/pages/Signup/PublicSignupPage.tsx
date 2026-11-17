import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MessageCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { normalizePhone } from '@/utils/phone';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Notice, Skeleton } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/utils';
import type { PublicSignupForm } from '@/types/db';

/** Valida o celular digitado. Sem DDI, assume Brasil. Retorna E.164 ou a mensagem de erro. */
export function signupPhone(raw: string): { phone: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: 'Informe seu WhatsApp com DDD' };
  const p = normalizePhone(v);
  if (p.status === 'foreign' && p.normalized) return { phone: p.normalized };
  if (p.status === 'valid' && p.normalized && p.lineType === 'mobile') return { phone: p.normalized };
  if (p.status === 'valid') return { error: 'Use um número de celular (WhatsApp), não fixo' };
  if (p.status === 'needs_review') return { error: 'Celular precisa ter 9 dígitos depois do DDD' };
  if (p.status === 'invalid_area_code') return { error: 'DDD inválido' };
  return { error: 'Confira o número com DDD, ex.: (84) 99999-9999' };
}

type Result = { ok: true; group_name: string | null; invite_url: string | null };

export function PublicSignupPage() {
  const { slug = '' } = useParams();
  const form = useQuery({
    queryKey: ['public-signup', slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_signup_form', { p_slug: slug });
      if (error) throw error;
      return data as PublicSignupForm | null;
    },
    retry: 1,
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hp, setHp] = useState('');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; phone?: string; agree?: string; form?: string }>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Result | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    const n = name.trim();
    if (n.length < 2) errs.name = 'Informe seu nome';
    const ph = signupPhone(phone);
    if ('error' in ph) errs.phone = ph.error;
    if (!agree) errs.agree = 'Marque a autorização para continuar';
    setErrors(errs);
    if (Object.keys(errs).length || 'error' in ph) return;
    if (hp) { setDone({ ok: true, group_name: null, invite_url: null }); return; } // robô
    setSending(true);
    const { data, error } = await supabase.rpc('submit_signup', {
      p_slug: slug, p_name: n, p_phone: ph.phone, p_consent: true, p_user_agent: navigator.userAgent.slice(0, 200),
    });
    setSending(false);
    if (error) { setErrors({ form: errorMessage(error) }); return; }
    setDone(data as Result);
  };

  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-8 sm:py-14">
      <main className="mx-auto w-full max-w-md">
        {form.isLoading ? (
          <div className="grid gap-3 rounded-xl border bg-card p-6"><Skeleton className="h-7 w-2/3" /><Skeleton className="h-4" /><Skeleton className="h-40" /></div>
        ) : !form.data ? (
          <div className="rounded-xl border bg-card p-6 text-center">
            <h1 className="text-lg font-semibold">Inscrições encerradas</h1>
            <p className="mt-2 text-sm text-muted-foreground">Esta página não está disponível no momento.</p>
          </div>
        ) : done ? (
          <div className="grid gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto size-12 text-primary" />
            <h1 className="text-xl font-semibold">Inscrição confirmada!</h1>
            {done.invite_url ? (
              <>
                <p className="text-sm text-muted-foreground">Toque no botão abaixo para entrar no grupo. Você só entra se quiser e pode sair quando quiser.</p>
                <a href={done.invite_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[#1f9d55] px-6 font-medium text-white hover:bg-[#188046]">
                  <MessageCircle className="size-5" /> Entrar no grupo{done.group_name ? ` ${done.group_name}` : ''}
                </a>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Recebemos seus dados. {form.data.organizer_name} vai entrar em contato.</p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-5 rounded-xl border bg-card p-6 shadow-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">{form.data.organizer_name}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{form.data.title}</h1>
              {form.data.description && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{form.data.description}</p>}
            </div>
            <Field label="Seu nome" htmlFor="s-name" error={errors.name}>
              <Input id="s-name" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} maxLength={120} />
            </Field>
            <Field label="Seu WhatsApp (com DDD)" htmlFor="s-phone" error={errors.phone}>
              <Input id="s-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(84) 99999-9999" value={phone} onChange={(e) => { setPhone(e.target.value); setErrors((x) => ({ ...x, phone: undefined })); }} maxLength={25} />
            </Field>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={hp} onChange={(e) => setHp(e.target.value)} />
            <div className="grid gap-1.5">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErrors((x) => ({ ...x, agree: undefined })); }} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span>{form.data.consent_text}</span>
              </label>
              {errors.agree && <p className="text-xs text-destructive" role="alert">{errors.agree}</p>}
            </div>
            {errors.form && <Notice tone="danger">{errors.form}</Notice>}
            <Button type="submit" size="lg" loading={sending}>Quero me inscrever</Button>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              Seus dados ficam com {form.data.organizer_name} e são usados só para o que está descrito acima, conforme a LGPD. Você pode pedir para sair a qualquer momento.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
