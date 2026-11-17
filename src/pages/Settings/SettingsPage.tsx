import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Moon, Sun } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/contexts/theme';
import { useToast } from '@/contexts/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/utils';
import { MAX_FILE_BYTES, MAX_ROWS } from '@/services/imports/rules';
import { getIntegration } from '@/integrations/whatsapp/manual';

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('full_name, email').eq('id', user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setName(profile.data?.full_name ?? ''), [profile.data?.full_name]);
  const caps = getIntegration().getCapabilities();

  const saveName = async () => {
    setBusy('name');
    const { error } = await supabase.from('profiles').update({ full_name: name.trim().slice(0, 120) }).eq('id', user!.id);
    setBusy(null);
    toast(error ? errorMessage(error) : 'Perfil atualizado', error ? 'error' : 'success');
  };
  const savePwd = async () => {
    if (pwd.length < 8) { toast('A senha precisa ter ao menos 8 caracteres', 'error'); return; }
    setBusy('pwd');
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(null); setPwd('');
    toast(error ? errorMessage(error) : 'Senha alterada', error ? 'error' : 'success');
  };

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Perfil</CardTitle><CardDescription>{user?.email}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Nome" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <div><Button onClick={saveName} loading={busy === 'name'}>Salvar</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Segurança</CardTitle><CardDescription>Troque a senha ou encerre todas as sessões.</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Nova senha" htmlFor="s-pwd"><Input id="s-pwd" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={savePwd} loading={busy === 'pwd'}>Alterar senha</Button>
              <Button variant="outline" onClick={() => supabase.auth.signOut({ scope: 'global' })}><LogOut /> Sair de todos os dispositivos</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Aparência</CardTitle></CardHeader>
          <CardContent><Button variant="outline" onClick={toggle}>{theme === 'dark' ? <><Sun /> Usar tema claro</> : <><Moon /> Usar tema escuro</>}</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Limites e privacidade</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <p>Importação: até {MAX_FILE_BYTES / 1024 / 1024} MB e {MAX_ROWS.toLocaleString('pt-BR')} linhas por arquivo; até 3 importações simultâneas e 30 por hora.</p>
            <p>Arquivos originais ficam em armazenamento privado, acessível só pela sua conta.</p>
            <p>Somente nome e telefone são guardados de cada linha (minimização de dados).</p>
            <p>Linhas temporárias de importação são descartadas após 30 dias da conclusão.</p>
            <p>Exclusão a pedido do titular apaga nome e telefone e mantém só a marcação de “não contatar”.</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Integração com WhatsApp</CardTitle><CardDescription>Modo atual: manual (link do grupo + compartilhamento pelo seu aparelho).</CardDescription></CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>Envio automático por API oficial: <strong>{caps.sendMessages ? 'disponível' : 'não disponível'}</strong></p>
            <p>Consulta de participantes do grupo: <strong>{caps.groupStatus ? 'disponível' : 'não disponível'}</strong></p>
            <p>Confirmação automática de entrega/entrada: <strong>{caps.webhooks ? 'disponível' : 'não disponível'}</strong></p>
            <p className="mt-2 text-muted-foreground">A integração com a WhatsApp Business Platform só será ativada após verificar a documentação oficial da Meta, a elegibilidade da sua conta e as aprovações necessárias.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
