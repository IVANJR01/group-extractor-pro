import { describe, expect, it } from 'vitest';
import {
  isWhatsAppChatExport,
  parseWhatsAppChatExport,
  parsePastedWhatsAppText,
} from '@/utils/whatsappChatParser';

describe('whatsappChatParser', () => {
  it('identifica corretamente um arquivo de log do WhatsApp', () => {
    const validChat = `
12/03/2024, 10:15 - As mensagens e as chamadas são protegidas de ponta a ponta.
12/03/2024, 10:16 - +55 11 99999-0001: Olá a todos!
12/03/2024, 10:17 - +55 21 98888-0002: Bom dia pessoal
    `.trim();

    expect(isWhatsAppChatExport(validChat)).toBe(true);

    const normalText = `
Nome;Telefone
Maria;11999990001
João;11999990002
    `.trim();

    expect(isWhatsAppChatExport(normalText)).toBe(false);
  });

  it('extrai telefones e mensagens de eventos de chat do WhatsApp', () => {
    const chat = `
12/03/2024 10:14 - Fulano mudou o nome do grupo para "Comunidade VIP 2026"
12/03/2024 10:15 - +55 11 99999-0001: Olá a todos!
12/03/2024 10:16 - +55 21 98888-0002: Bom dia pessoal
12/03/2024 10:17 - +55 11 99999-0001 adicionou +55 84 97777-0003
12/03/2024 10:18 - +55 84 97777-0003: Obrigado pelo convite
    `.trim();

    const res = parseWhatsAppChatExport(chat);
    expect(res.groupName).toBe('Comunidade VIP 2026');
    expect(res.totalUniquePhones).toBe(3);

    const phones = res.contacts.map((c) => c.normalizedPhone);
    expect(phones).toContain('+5511999990001');
    expect(phones).toContain('+5521988880002');
    expect(phones).toContain('+5584977770003');
  });

  it('extrai contatos colados da lista de cabeçalho do WhatsApp Web', () => {
    const pasted = 'Você, +55 11 99999-0001, João Silva, +55 21 98888-0002 (Admin), +55 84 97777-0003';
    const contacts = parsePastedWhatsAppText(pasted);

    expect(contacts.length).toBe(3);
    const admin = contacts.find((c) => c.normalizedPhone === '+5521988880002');
    expect(admin).toBeDefined();
    expect(admin?.isAdmin).toBe(true);
  });
});
