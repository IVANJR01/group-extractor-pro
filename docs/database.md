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
