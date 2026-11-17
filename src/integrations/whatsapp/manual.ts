import type { InviteContact, InviteGroup, ShareOutcome, WhatsAppIntegration } from './types';

export const INVITE_URL_RE = /^https:\/\/chat\.whatsapp\.com\/(invite\/)?[A-Za-z0-9]{10,64}$/;

export const DEFAULT_TEMPLATE = `Olá{{nome}}! Estamos organizando nossa comunidade no WhatsApp.
Gostaríamos de convidar você para participar do nosso grupo.
Se tiver interesse, basta acessar o link abaixo:
{{link}}
Sua participação é totalmente voluntária. Se não quiser receber convites, é só responder "SAIR".`;

const firstName = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] ?? '';

/** Adaptador manual: link cadastrado pelo administrador + compartilhamento pelo aparelho. */
export const manualIntegration: WhatsAppIntegration = {
  id: 'manual',

  validateConfiguration(group: InviteGroup) {
    if (group.status !== 'active') return { ok: false, reason: 'Grupo de destino inativo.' };
    if (!group.invite_url) return { ok: false, reason: 'Cadastre o link de convite do grupo.' };
    if (group.invite_link_status !== 'active') return { ok: false, reason: 'Link de convite desativado.' };
    if (!INVITE_URL_RE.test(group.invite_url)) return { ok: false, reason: 'Link de convite em formato inválido.' };
    return { ok: true };
  },

  getCapabilities: () => ({ sendMessages: false, groupStatus: false, webhooks: false, userShare: true }),

  createInvite(group, template, contact?: InviteContact) {
    const name = contact ? firstName(contact.name) : '';
    return template
      .replaceAll('{{link}}', group.invite_url ?? '')
      .replaceAll('{{nome}}', name ? `, ${name}` : '')
      .replaceAll('{{grupo}}', group.name);
  },

  async shareInvite(message, contact?: InviteContact): Promise<ShareOutcome> {
    if (contact?.normalized_phone) {
      // Abre a conversa com a pessoa; quem envia (ou não) é o próprio usuário.
      const url = `https://wa.me/${contact.normalized_phone.replace('+', '')}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return { kind: 'opened', channel: 'whatsapp-link' };
    }
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text: message }); return { kind: 'opened', channel: 'web-share' }; }
      catch { return { kind: 'dismissed' }; }
    }
    await navigator.clipboard.writeText(message);
    return { kind: 'opened', channel: 'clipboard' };
  },

  async getGroupStatus() {
    return { available: false as const, reason: 'Sem integração oficial: não é possível consultar participantes. Registre as entradas manualmente com evidência.' };
  },

  async processWebhook(): Promise<never> {
    throw new Error('Nenhuma integração oficial configurada para receber webhooks.');
  },
};

export function getIntegration(): WhatsAppIntegration {
  return manualIntegration;
}
