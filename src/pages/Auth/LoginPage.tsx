import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/utils';

const schema = z.object({
  email: z.email('Informe um e-mail válido'),
  password: z.string().min(8, 'Mínimo de 8 caracteres'),
  fullName: z.string().max(120).optional(),
});
type Form = z.infer<typeof schema>;
type Mode = 'login' | 'signup' | 'reset';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [msg, setMsg] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(mode === 'reset' ? schema.pick({ email: true }).extend({ password: z.string().optional(), fullName: z.string().optional() }) : schema) as never,
  });

  const onSubmit = async (v: Form) => {
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
      } else if (mode === 'signup') {
        const { error, data } = await supabase.auth.signUp({
          email: v.email, password: v.password,
          options: { data: { full_name: v.fullName ?? '' }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setMsg({ tone: 'info', text: 'Conta criada. Confirme pelo link enviado ao seu e-mail.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/configuracoes` });
        if (error) throw error;
        setMsg({ tone: 'info', text: 'Se o e-mail existir, você receberá um link para redefinir a senha.' });
      }
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(e) });
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0b130e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.25),transparent_45%),radial-gradient(circle_at_80%_90%,rgba(21,128,61,0.3),transparent_40%)]" />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-green-500 text-black"><ShieldCheck className="size-5" /></div>
          <span className="font-semibold">Group Extractor Pro</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Seus contatos organizados, sem duplicidade e com consentimento registrado.</h1>
          <p className="mt-4 text-white/70">Importe listas legítimas, normalize telefones, identifique repetidos e convide para o seu grupo apenas quem autorizou.</p>
        </div>
        <p className="relative text-xs text-white/50">Ingresso em grupos é sempre voluntário. Nenhum dado é coletado do WhatsApp.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></div>
            <span className="font-semibold">Group Extractor Pro</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Recuperar senha'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === 'login' ? 'Acesse sua central de contatos.' : mode === 'signup' ? 'Leva menos de um minuto.' : 'Enviaremos um link para o seu e-mail.'}
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
            {mode === 'signup' && (
              <Field label="Nome" htmlFor="fullName"><Input id="fullName" autoComplete="name" {...register('fullName')} /></Field>
            )}
            <Field label="E-mail" htmlFor="email" error={formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
            </Field>
            {mode !== 'reset' && (
              <Field label="Senha" htmlFor="password" error={formState.errors.password?.message}>
                <Input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} {...register('password')} />
              </Field>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <Button type="submit" loading={formState.isSubmitting} className="w-full">
              {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Enviar link'}
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
            {mode !== 'login' ? (
              <Button variant="link" onClick={() => { setMode('login'); setMsg(null); }}>Já tenho conta</Button>
            ) : (
              <>
                <Button variant="link" onClick={() => { setMode('signup'); setMsg(null); }}>Criar conta</Button>
                <Button variant="link" onClick={() => { setMode('reset'); setMsg(null); }}>Esqueci a senha</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
