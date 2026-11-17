# Banco de dados

Migrações em `supabase/migrations` (aplicar em ordem).

| Tabela | Para que serve |
|---|---|
| profiles | Perfil do usuário (criado automaticamente no cadastro) |
| br_area_codes | 67 DDDs válidos da Anatel com UF |
| contact_sources | Origens (Grupo X, lista do evento...) |
| import_jobs / import_rows | Importações e linhas em processamento |
| contacts | Um registro por telefone normalizado (`dedup_key` único por usuário) |
| contact_source_relations | Cada ocorrência do contato em cada importação |
| consent_records | Histórico de autorizações/revogações (com evidência) |
| suppression_list | Quem não pode receber nada (bloqueio, revogação, saída, exclusão LGPD) |
| contact_segments | Filtros salvos |
| destination_groups | Grupos de destino com link de convite |
| message_templates | Mensagens com `{{nome}}` e `{{link}}` |
| invitation_campaigns / invitation_events | Campanhas e eventos (compartilhado, entrou, saiu...) |
| audit_logs | Auditoria (só inserção) |

## Regras garantidas pelo banco
- Telefone em arquivo **não** é consentimento: todo contato começa `pending`.
- Autorizar exige método, evidência e data.
- Revogação, saída (opt-out) e bloqueio entram na lista de supressão automaticamente.
- Evento de convite só é aceito para contato elegível (autorizado, não suprimido, telefone válido) e com link ativo.
- Usuário só pode registrar eventos `source = user`; "enviado pela integração" exige integração oficial (não existe ainda).

## Atualizações
- `instalar-banco.sql`: migrações 0100–0500.
- `atualizacao-1.sql`: migração 0600 (conflitos de nome, ocorrências, estatísticas de grupos, exportação paginada).
- `atualizacao-2.sql`: migração 0700 (páginas de inscrição: `signup_forms`, `signup_submissions`, `create_signup_form`, `get_signup_form`, `submit_signup`).

## Páginas de inscrição (opt-in)
- Página pública `/i/<código>`: a pessoa informa nome e WhatsApp e marca a autorização.
- `submit_signup` (liberada para anônimos) valida o celular de novo no servidor, deduplica pelo telefone, grava a evidência (texto aceito, data, página) e marca o contato como autorizado.
- Contato bloqueado, com reclamação ou que pediu exclusão **não** é reautorizado.
- Limites: 10 inscrições por aparelho por hora e 300 por página a cada 10 minutos. O IP não é guardado, só um hash.
- Se a página estiver ligada a um grupo com link ativo, a pessoa vê o botão para entrar (entrada voluntária).
