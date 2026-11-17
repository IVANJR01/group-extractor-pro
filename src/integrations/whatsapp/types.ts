/**
 * Camada de integração com WhatsApp, desacoplada do restante do sistema.
 * Só existe o adaptador "manual" (link fornecido pelo administrador +
 * compartilhamento feito pela própria pessoa). Um adaptador para a
 * WhatsApp Business Platform só será criado após conferir a documentação
 * oficial vigente da Meta e a elegibilidade da conta (ver docs/integrations.md).
 */
export interface IntegrationCapabilities {
  /** Envia mensagens por API oficial (entrega confirmável). */
  sendMessages: boolean;
  /** Consegue consultar participantes/estado do grupo. */
  groupStatus: boolean;
  /** Recebe eventos (webhooks) confiáveis. */
  webhooks: boolean;
  /** Abre o compartilhamento no aparelho da pessoa (não prova envio). */
  userShare: boolean;
}

export interface InviteGroup { name: string; invite_url: string | null; invite_link_status: 'active' | 'disabled'; status: 'active' | 'inactive' }
export interface InviteContact { name: string | null; normalized_phone: string | null }

export type ShareOutcome =
  | { kind: 'opened'; channel: 'web-share' | 'whatsapp-link' | 'clipboard' } // aberto para a pessoa enviar; NÃO confirma envio
  | { kind: 'dismissed' };

export interface WhatsAppIntegration {
  readonly id: string;
  validateConfiguration(group: InviteGroup): { ok: true } | { ok: false; reason: string };
  getCapabilities(): IntegrationCapabilities;
  createInvite(group: InviteGroup, template: string, contact?: InviteContact): string;
  shareInvite(message: string, contact?: InviteContact): Promise<ShareOutcome>;
  getGroupStatus(): Promise<{ available: false; reason: string }>;
  processWebhook(payload: unknown): Promise<never>;
}
