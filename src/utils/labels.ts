import type { ConsentStatus, InvitationEventType, JobStatus, SourceType, ValidationStatus } from '@/types/db';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const VALIDATION_LABEL: Record<ValidationStatus, [string, Tone]> = {
  valid: ['Válido', 'success'],
  foreign: ['Estrangeiro', 'info'],
  needs_review: ['Revisar', 'warning'],
  incomplete: ['Incompleto', 'danger'],
  invalid_area_code: ['DDD inválido', 'danger'],
  invalid: ['Inválido', 'danger'],
  erased: ['Excluído', 'neutral'],
};

export const CONSENT_LABEL: Record<ConsentStatus, [string, Tone]> = {
  pending: ['Pendente de comprovação', 'warning'],
  authorized: ['Autorizado', 'success'],
  revoked: ['Revogado', 'danger'],
  blocked: ['Bloqueado', 'danger'],
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  group: 'Grupo (lista fornecida)',
  customer_list: 'Lista de clientes',
  authorized_list: 'Contatos autorizados',
  form: 'Formulário de inscrição',
  manual: 'Cadastro manual',
  other: 'Outro',
};

export const JOB_STATUS_LABEL: Record<JobStatus, [string, Tone]> = {
  pending: ['Aguardando', 'neutral'],
  uploading: ['Enviando', 'info'],
  processing: ['Processando', 'info'],
  completed: ['Concluída', 'success'],
  failed: ['Falhou', 'danger'],
  cancelled: ['Cancelada', 'neutral'],
};

export const EVENT_LABEL: Record<InvitationEventType, [string, Tone]> = {
  prepared: ['Convite preparado', 'neutral'],
  shared: ['Compartilhado (sem confirmação de envio)', 'info'],
  sent_via_integration: ['Enviado por integração', 'info'],
  delivery_confirmed: ['Entrega confirmada', 'success'],
  join_confirmed: ['Entrada confirmada', 'success'],
  no_confirmation: ['Sem confirmação', 'neutral'],
  declined: ['Recusado', 'warning'],
  opt_out: ['Opt-out', 'danger'],
};

export const AUDIT_LABEL: Record<string, string> = {
  'import.created': 'Importação iniciada',
  'import.completed': 'Importação concluída',
  'import.cancelled': 'Importação cancelada',
  'consent.authorized': 'Autorização registrada',
  'consent.revoked': 'Autorização revogada',
  'consent.pending': 'Autorização marcada como pendente',
  'contact.blocked': 'Contato bloqueado',
  'contact.unblocked': 'Contato desbloqueado',
  'suppression.added': 'Incluído na lista de supressão',
  'campaign.prepared': 'Campanha preparada',
  'group.created': 'Grupo de destino criado',
  'group.link_updated': 'Link do grupo atualizado',
  'export.contacts': 'Lista exportada',
  'export.history': 'Histórico exportado',
  'lgpd.data_exported': 'Dados do titular exportados',
  'lgpd.deletion': 'Contato excluído (LGPD)',
};
