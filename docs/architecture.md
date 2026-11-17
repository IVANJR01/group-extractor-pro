# Arquitetura

Documento completo (com diagrama): https://claude.ai/artifact/XVYfvcd56Zf1vqRHLfZVgQ

## Visão geral
- **Frontend**: React 19 + TypeScript + Vite 8 + Tailwind 4. Rotas com carregamento sob demanda (`src/App.tsx`), dados com TanStack Query, formulários com React Hook Form + Zod.
- **Backend**: Supabase. Postgres guarda tudo; as regras de negócio importantes (deduplicação, consentimento, supressão, elegibilidade para convite, auditoria) ficam em funções SQL e triggers, então valem mesmo se alguém chamar a API direto.
- **Sem servidor próprio**: o navegador fala com o Supabase usando só a chave pública; RLS isola cada usuário.

## Fluxo de importação
1. O arquivo é lido num **Web Worker** (`src/workers/importParser.worker.ts`), sem travar a tela.
2. Telefones são normalizados no navegador (libphonenumber-js) para a prévia.
3. `create_import_job` registra a importação (limites: 20 MB, 200 mil linhas, 3 simultâneas, 30/hora).
4. Linhas vão para `import_rows` em lotes de 500 (com repetição automática se a rede falhar).
5. `process_import_batch` consolida no banco: deduplica por telefone normalizado, mescla nomes, registra a origem de cada ocorrência. É idempotente: reenviar o mesmo lote não duplica nada.
6. O arquivo original fica no bucket privado `imports/<user_id>/`.

## Pastas
```
src/
  components/   ui, layout, dashboard, contacts, imports, shared
  contexts/     auth, tema, avisos
  hooks/        consultas TanStack Query
  integrations/whatsapp/  interface + adaptador manual (wa.me)
  pages/        uma pasta por tela
  services/     importação, exportação, deduplicação
  utils/        telefone, DDD, nomes, rótulos
  workers/      leitura de arquivos
supabase/migrations/  esquema, RLS, funções
tests/        unit, integration (Postgres), e2e (Playwright)
```
