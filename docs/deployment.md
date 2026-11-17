# Como rodar e publicar

## Rodar no computador
1. Instale Node.js 22+.
2. `npm install`
3. Copie `.env.example` para `.env.local` e preencha URL e chave **publishable** do Supabase.
4. `npm run dev` e abra http://localhost:5173

## Supabase
1. SQL Editor → cole e rode `instalar-banco.sql`, depois `atualizacao-1.sql`.
2. Authentication → URL Configuration:
   - Site URL: o endereço da Vercel (ex.: `https://group-extractor-pro.vercel.app`)
   - Redirect URLs: o mesmo endereço + `http://localhost:5173`
3. Authentication → Providers → Email: ligado (recomendado: confirmar e-mail).
4. (Opcional) Database → Extensions → pg_cron, e agende:
   `select cron.schedule('limpeza-importacoes', '0 3 * * *', $$select public.purge_import_staging()$$);`

## Vercel
1. Suba o código para um repositório no GitHub.
2. Na Vercel: Add New → Project → importe o repositório (framework Vite é detectado).
3. Environment Variables: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Nunca a service_role.
4. Deploy. `vercel.json` já cuida das rotas e dos cabeçalhos de segurança.

## Testes
- `npm run test:unit` (46 testes)
- `npm run test:db` com Postgres local (`scripts/reset-test-db.sh` + `TEST_DATABASE_URL`)
- `npm run test:e2e` (Playwright, 12 testes em desktop e celular, backend simulado)
