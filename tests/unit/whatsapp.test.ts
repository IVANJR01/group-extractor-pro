import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, INVITE_URL_RE, manualIntegration } from '@/integrations/whatsapp/manual';

const group = { name: 'Grupo A', invite_url: 'https://chat.whatsapp.com/AbCdEfGhIjK123', invite_link_status: 'active' as const, status: 'active' as const };

describe('integração manual', () => {
  it('não declara capacidades que não tem', () => {
    expect(manualIntegration.getCapabilities()).toEqual({ sendMessages: false, groupStatus: false, webhooks: false, userShare: true });
  });
  it('valida link e situação do grupo', () => {
    expect(manualIntegration.validateConfiguration(group)).toEqual({ ok: true });
    expect(manualIntegration.validateConfiguration({ ...group, invite_url: null }).ok).toBe(false);
    expect(manualIntegration.validateConfiguration({ ...group, invite_link_status: 'disabled' }).ok).toBe(false);
    expect(INVITE_URL_RE.test('https://evil.com/chat.whatsapp.com/abc')).toBe(false);
    expect(INVITE_URL_RE.test('http://chat.whatsapp.com/AbCdEfGhIjK123')).toBe(false);
  });
  it('monta a mensagem com link e primeiro nome', () => {
    const msg = manualIntegration.createInvite(group, DEFAULT_TEMPLATE, { name: 'Maria Silva', normalized_phone: '+5584999999999' });
    expect(msg).toContain('Olá, Maria!');
    expect(msg).toContain(group.invite_url);
    expect(msg).toContain('voluntária');
    expect(manualIntegration.createInvite(group, DEFAULT_TEMPLATE)).toContain('Olá!');
  });
  it('não finge consultar o grupo nem processar webhook', async () => {
    expect((await manualIntegration.getGroupStatus()).available).toBe(false);
    await expect(manualIntegration.processWebhook({})).rejects.toThrow();
  });
});
