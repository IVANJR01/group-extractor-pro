import { normalizePhone, formatPhoneBR } from '@/utils/phone';
import type { ValidationStatus } from '@/types/db';

export interface ExtractedWhatsAppContact {
  id: string;
  name: string;
  rawPhone: string;
  normalizedPhone: string;
  formattedPhone: string;
  status: ValidationStatus;
  isAdmin?: boolean;
  messageCount?: number;
  firstSeen?: string;
}

export interface WhatsAppChatParseResult {
  groupName?: string;
  contacts: ExtractedWhatsAppContact[];
  totalMessages: number;
  totalUniquePhones: number;
}

/**
 * Regex para capturar padrões comuns de cabeçalhos de mensagens de exportação do WhatsApp:
 * Exemplos:
 * 12/03/2024 14:32 - +55 11 98765-4321: mensagem
 * 12/03/24, 14:32 - João (+55 11 98765-4321): mensagem
 * [12/03/2024, 14:32:10] +55 11 98765-4321: mensagem
 * 12/03/2024 14:32 - As mensagens e as chamadas são protegidas...
 * 12/03/2024 14:32 - +55 11 99999-9999 adicionou +55 21 98888-8888
 * 12/03/2024 14:32 - Fulano mudou o nome do grupo para "Grupo VIP"
 */
const MESSAGE_HEADER_REGEX = /^(?:\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[apAP][mM])?)\]?)\s*(?:-|:)\s*(.*?)(?::\s*([\s\S]*))?$/;

const PHONE_DETECTION_REGEX = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/g;

/**
 * Verifica se um texto parece ser uma exportação de conversa do WhatsApp
 */
export function isWhatsAppChatExport(content: string): boolean {
  const lines = content.split('\n').slice(0, 30);
  let matchCount = 0;
  for (const line of lines) {
    if (MESSAGE_HEADER_REGEX.test(line.trim())) {
      matchCount++;
    }
  }
  return matchCount >= 2;
}

/**
 * Analisa o conteúdo de um arquivo .txt de conversa do WhatsApp e extrai todos os participantes e contatos
 */
export function parseWhatsAppChatExport(content: string): WhatsAppChatParseResult {
  const lines = content.split('\n');
  const contactsMap = new Map<string, ExtractedWhatsAppContact>();
  let detectedGroupName: string | undefined;
  let totalMessages = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(MESSAGE_HEADER_REGEX);
    if (!match) {
      // Pode ser continuação de mensagem ou linha de sistema avulsa
      continue;
    }

    const [, dateStr, timeStr, senderOrSystem, messageBody] = match;
    const timestamp = `${dateStr} ${timeStr}`;

    // Detectar nome do grupo em mensagens do sistema
    if (!messageBody && senderOrSystem) {
      const subjectMatch = senderOrSystem.match(/(?:mudou o nome do grupo para|alterou o assunto do grupo para|changed the subject to)\s*["“](.*?)["”]/i);
      if (subjectMatch) {
        detectedGroupName = subjectMatch[1].trim();
      }

      // Procurar telefones em mensagens de sistema (ex: "+55 11 99999-9999 adicionou +55 21 88888-8888")
      const systemPhones = extractPhonesFromText(senderOrSystem);
      for (const p of systemPhones) {
        registerContact(contactsMap, p.phone, p.suggestedName || '', timestamp, false);
      }
      continue;
    }

    if (messageBody !== undefined && senderOrSystem) {
      totalMessages++;
      const sender = senderOrSystem.trim();

      // Verificar se o remetente é um número de telefone
      const senderPhones = extractPhonesFromText(sender);
      if (senderPhones.length > 0) {
        const primary = senderPhones[0];
        const contactName = sender.replace(primary.rawMatch, '').replace(/[()\-+]/g, '').trim();
        registerContact(contactsMap, primary.phone, contactName, timestamp, false);
      } else {
        // Remetente é um nome de contato salvo (sem telefone explícito no cabeçalho)
        // Se a mensagem mencionar algum número ou contato, podemos capturar
      }
    }
  }

  const contactsList = Array.from(contactsMap.values()).sort((a, b) => {
    // Ordena por quantidade de mensagens (se houver) ou pelo número
    if ((b.messageCount ?? 0) !== (a.messageCount ?? 0)) {
      return (b.messageCount ?? 0) - (a.messageCount ?? 0);
    }
    return a.normalizedPhone.localeCompare(b.normalizedPhone);
  });

  return {
    groupName: detectedGroupName,
    contacts: contactsList,
    totalMessages,
    totalUniquePhones: contactsList.length,
  };
}

/**
 * Registra ou atualiza um contato no mapa
 */
function registerContact(
  map: Map<string, ExtractedWhatsAppContact>,
  phoneStr: string,
  name: string,
  timestamp: string,
  isAdmin: boolean = false
) {
  const norm = normalizePhone(phoneStr);
  if (!norm.normalized && (norm.status === 'invalid' || norm.status === 'empty')) return;

  const key = norm.normalized || phoneStr.replace(/\D/g, '');
  if (!key || key.length < 8) return;

  const status: ValidationStatus = norm.status === 'empty' ? 'invalid' : norm.status;

  const existing = map.get(key);
  if (existing) {
    existing.messageCount = (existing.messageCount ?? 0) + 1;
    if (!existing.name && name) {
      existing.name = name;
    }
    if (isAdmin) {
      existing.isAdmin = true;
    }
  } else {
    map.set(key, {
      id: key,
      name: name.trim(),
      rawPhone: phoneStr,
      normalizedPhone: norm.normalized || key,
      formattedPhone: norm.normalized ? formatPhoneBR(norm.normalized) : phoneStr,
      status,
      isAdmin,
      messageCount: 1,
      firstSeen: timestamp,
    });
  }
}

interface PhoneCandidate {
  phone: string;
  rawMatch: string;
  suggestedName?: string;
}

/**
 * Extrai candidatos a números de telefone de um trecho de texto
 */
export function extractPhonesFromText(text: string): PhoneCandidate[] {
  const candidates: PhoneCandidate[] = [];
  const matches = text.match(PHONE_DETECTION_REGEX);
  if (!matches) return candidates;

  for (const m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) {
      candidates.push({
        phone: m.trim(),
        rawMatch: m,
      });
    }
  }

  return candidates;
}

/**
 * Extrai contatos a partir de texto bruto colado (ex: lista do cabeçalho do WhatsApp Web)
 * Exemplo: "Você, +55 11 98765-4321, Carlos, +55 21 99999-0000, +55 84 98888-1111"
 */
export function parsePastedWhatsAppText(text: string): ExtractedWhatsAppContact[] {
  const contactsMap = new Map<string, ExtractedWhatsAppContact>();
  
  // Se for arquivo de conversa completo, delega para o parser de chat
  if (isWhatsAppChatExport(text)) {
    return parseWhatsAppChatExport(text).contacts;
  }

  // Quebra por vírgula, ponto-e-vírgula ou quebra de linha
  const parts = text.split(/[\n,;]+/);

  for (let part of parts) {
    part = part.trim();
    if (!part || part.toLowerCase() === 'você' || part.toLowerCase() === 'you') continue;

    // Remove caracteres especiais de indicação de admin (ex: "~", "(Admin)")
    const isAdmin = /admin/i.test(part);
    const cleaned = part.replace(/\(admin\)/i, '').replace(/~/g, '').trim();

    const phones = extractPhonesFromText(cleaned);
    if (phones.length > 0) {
      for (const p of phones) {
        const potentialName = cleaned.replace(p.rawMatch, '').replace(/[()\-+]/g, '').trim();
        registerContact(contactsMap, p.phone, potentialName, new Date().toISOString(), isAdmin);
      }
    } else {
      // Talvez seja no formato: Nome: Telefone ou Nome - Telefone
      const subParts = cleaned.split(/[-:]/);
      if (subParts.length === 2) {
        const [possibleName, possiblePhone] = subParts;
        const subPhones = extractPhonesFromText(possiblePhone);
        if (subPhones.length > 0) {
          registerContact(contactsMap, subPhones[0].phone, possibleName.trim(), new Date().toISOString(), isAdmin);
        }
      }
    }
  }

  return Array.from(contactsMap.values());
}
