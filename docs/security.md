# Segurança e LGPD

## O que o sistema NÃO faz (de propósito)
- Não extrai participantes de grupos do WhatsApp, não lê dados do WhatsApp, não usa WhatsApp Web automatizado.
- Não adiciona ninguém a grupo. Entrar é sempre voluntário, pelo link.
- Não dispara mensagens em massa. O compartilhamento é manual, um a um, via `wa.me`, e fica registrado como "compartilhado", nunca como "enviado".

## Proteções
- **RLS** em todas as tabelas: `user_id = auth.uid()`. Testado com dois usuários e com acesso anônimo.
- **anon** não tem nenhuma permissão. Permissões por coluna para `authenticated`.
- Funções `SECURITY DEFINER` com `search_path` fixo e checagem de dono (`assert_owner`).
- O app **recusa iniciar** se receber chave secreta (`sb_secret_` ou JWT `service_role`).
- Nenhum telefone em logs. Exportação protegida contra injeção de fórmula no Excel.
- Bucket `imports` privado, cada usuário só acessa a própria pasta.
- Limites contra abuso nas importações.
- Cabeçalhos de segurança (CSP, HSTS, nosniff) em `vercel.json`.
- `npm audit`: 0 vulnerabilidades. SheetJS via `@e965/xlsx` 0.20.3 (o `xlsx` 0.18.5 do npm tem falhas conhecidas).

## LGPD
- Exportar dados pessoais de um contato (direito de acesso).
- Excluir/anonimizar contato a pedido (`request_contact_deletion`), mantendo só o bloqueio para não voltar a ser importado.
- Limpeza das linhas temporárias de importação (`purge_import_staging`). Recomendado agendar com pg_cron.

## Riscos restantes
- Quem usa o sistema é responsável por registrar evidência verdadeira de consentimento.
- Links de convite podem ser repassados por quem os recebe.
- Plano grátis do Supabase pausa o projeto após 7 dias sem uso.
