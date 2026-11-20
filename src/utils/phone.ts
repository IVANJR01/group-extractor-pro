import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { isValidDDD } from './ddd';

/**
 * Resultado da validação. Nenhum status significa "tem WhatsApp":
 * só indica se o número é bem formado.
 */
export type PhoneValidationStatus =
  | 'valid' // número brasileiro bem formado (E.164)
  | 'foreign' // número estrangeiro bem formado
  | 'needs_review' // provável celular antigo sem o 9 — não adivinhamos
  | 'incomplete' // faltam dígitos
  | 'invalid_area_code' // DDD inexistente
  | 'invalid' // estrutura impossível ou caracteres inválidos
  | 'empty';

export type PhoneLineType = 'mobile' | 'landline' | 'other' | null;

export interface NormalizedPhone {
  original: string;
  /** E.164, ex.: +5511999999999. Só é preenchido quando status é valid ou foreign. */
  normalized: string | null;
  countryCode: string | null;
  areaCode: string | null;
  nationalNumber: string | null;
  status: PhoneValidationStatus;
  lineType: PhoneLineType;
  issues: string[];
}

/** Status que geram um telefone normalizado utilizável para deduplicação. */
export const USABLE_STATUSES: readonly PhoneValidationStatus[] = ['valid', 'foreign'];

const SCIENTIFIC = /^\d+(?:[.,]\d+)?e\+?\d+$/i;
const ALLOWED_CHARS = /^[\d\s()+\-./]*$/;

function result(partial: Partial<NormalizedPhone> & Pick<NormalizedPhone, 'original' | 'status'>): NormalizedPhone {
  return {
    normalized: null,
    countryCode: null,
    areaCode: null,
    nationalNumber: null,
    lineType: null,
    issues: [],
    ...partial,
  };
}

/** Converte valores vindos do Excel (número, notação científica, "5511...0") em texto. */
function coerceInput(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return '';
    return Number.isInteger(raw) ? BigInt(raw).toString() : String(raw);
  }
  let s = String(raw).trim();
  if (SCIENTIFIC.test(s)) {
    const n = Number(s.replace(',', '.'));
    if (Number.isFinite(n) && Number.isInteger(n)) s = BigInt(n).toString();
  }
  // "5511999999999.0" (planilhas)
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}

function classifyBrazilian(original: string, national: string, issues: string[]): NormalizedPhone {
  const areaCode = national.slice(0, 2);
  const subscriber = national.slice(2);

  if (!isValidDDD(areaCode)) {
    return result({ original, status: 'invalid_area_code', countryCode: '55', areaCode, nationalNumber: national, issues: [...issues, 'DDD inexistente'] });
  }

  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    const fullNational = `${areaCode}9${subscriber}`;
    const normalized = `+55${fullNational}`;
    return result({
      original,
      status: 'valid',
      countryCode: '55',
      areaCode,
      nationalNumber: fullNational,
      normalized,
      lineType: 'mobile',
      issues: [...issues, '9º dígito (9) adicionado automaticamente'],
    });
  }

  const parsed = parsePhoneNumberFromString(`+55${national}`);
  if (!parsed || !parsed.isValid()) {
    return result({ original, status: 'invalid', countryCode: '55', areaCode, nationalNumber: national, issues: [...issues, 'Estrutura telefônica inválida'] });
  }

  const t = parsed.getType();
  const lineType: PhoneLineType = t === 'MOBILE' ? 'mobile' : t === 'FIXED_LINE' ? 'landline' : 'other';
  return result({
    original,
    status: 'valid',
    normalized: parsed.number,
    countryCode: '55',
    areaCode,
    nationalNumber: national,
    lineType,
    issues,
  });
}

/**
 * Normaliza um telefone. Brasil é o país padrão quando não há código de país.
 * Nunca acrescenta dígitos por conta própria.
 */
export function normalizePhone(raw: unknown): NormalizedPhone {
  const original = coerceInput(raw);
  if (original === '') return result({ original, status: 'empty', issues: ['Telefone vazio'] });

  if (!ALLOWED_CHARS.test(original)) {
    return result({ original, status: 'invalid', issues: ['Caracteres inválidos no telefone'] });
  }

  const hasPlus = original.startsWith('+');
  let digits = original.replace(/\D/g, '');
  const issues: string[] = [];

  if (digits.length === 0) return result({ original, status: 'empty', issues: ['Telefone vazio'] });

  // Prefixo internacional 00 (ex.: 0055...) => equivale a "+"
  let international = hasPlus;
  if (!international && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }

  if (international) {
    if (digits.startsWith('55')) {
      const national = digits.slice(2);
      if (national.length < 10) return result({ original, status: 'incomplete', countryCode: '55', issues: ['Faltam dígitos'] });
      if (national.length > 11) return result({ original, status: 'invalid', countryCode: '55', issues: ['Dígitos em excesso'] });
      return classifyBrazilian(original, national, issues);
    }
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (parsed && parsed.isValid()) {
      const t = parsed.getType();
      return result({
        original,
        status: 'foreign',
        normalized: parsed.number,
        countryCode: parsed.countryCallingCode,
        nationalNumber: parsed.nationalNumber,
        lineType: t === 'MOBILE' ? 'mobile' : t === 'FIXED_LINE' ? 'landline' : 'other',
        issues: ['Número de outro país'],
      });
    }
    if (parsed && parsed.isPossible() === false && digits.length < 8) {
      return result({ original, status: 'incomplete', issues: ['Faltam dígitos'] });
    }
    return result({ original, status: 'invalid', issues: ['Código de país ou número inválido'] });
  }

  // Sem código de país explícito: regras brasileiras.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return classifyBrazilian(original, digits.slice(2), issues);
  }

  if (digits.startsWith('0')) {
    digits = digits.slice(1); // prefixo de longa distância
    if (digits.length === 12 || digits.length === 13) {
      digits = digits.slice(2); // código da operadora (ex.: 0 15 11 ...)
      issues.push('Código de operadora removido');
    }
  }

  if (digits.length < 10) {
    return result({
      original,
      status: 'incomplete',
      issues: [digits.length >= 8 ? 'Sem DDD ou faltam dígitos' : 'Faltam dígitos'],
    });
  }
  if (digits.length > 11) return result({ original, status: 'invalid', issues: ['Dígitos em excesso'] });

  return classifyBrazilian(original, digits, issues);
}

export function isUsablePhone(p: NormalizedPhone): boolean {
  return p.normalized !== null && USABLE_STATUSES.includes(p.status);
}

/** Máscara para exibição/logs: nunca mostrar o número inteiro em logs. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  return e164.length <= 6 ? '***' : `${e164.slice(0, 5)}****${e164.slice(-2)}`;
}

/** Formata para exibição: +55 (11) 99999-9999 */
export function formatPhoneBR(e164: string | null | undefined): string {
  if (!e164) return '';
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

/**
 * Normaliza e corrige telefones para o padrão de celular brasileiro real (13 dígitos com DDI 55 + DDD + 9).
 * Injeta o 9º dígito quando ausente e descarta IDs de privacidade (LIDs).
 */
export function normalizeBrazilianPhoneDigits(raw: string): { valid: boolean; digits: string; formatted: string; isLid: boolean } {
  if (!raw) return { valid: false, digits: '', formatted: '', isLid: false };
  let digits = String(raw).replace(/@.*$/, '').replace(/\D/g, '');

  // Detecta se é LID de privacidade do WhatsApp (14-15 dígitos)
  if (digits.length >= 14 && !digits.startsWith('55')) {
    return { valid: false, digits: '', formatted: '', isLid: true };
  }

  // Se tiver mais de 13 dígitos mesmo começando com 55: é LID ou dado inválido
  if (digits.length > 13) {
    return { valid: false, digits: '', formatted: '', isLid: true };
  }

  // Normalização para o padrão brasileiro
  if (digits.startsWith('55')) {
    const national = digits.slice(2);
    // 10 dígitos nacionais: 2 de DDD + 8 de assinante (celular sem o 9)
    if (national.length === 10) {
      const ddd = national.slice(0, 2);
      const sub = national.slice(2);
      if (/^[6-9]/.test(sub)) {
        digits = `55${ddd}9${sub}`;
      }
    }
  } else {
    // Sem DDI 55
    if (digits.length === 10) {
      const ddd = digits.slice(0, 2);
      const sub = digits.slice(2);
      if (/^[6-9]/.test(sub)) {
        digits = `55${ddd}9${sub}`;
      } else {
        digits = `55${digits}`;
      }
    } else if (digits.length === 11) {
      digits = `55${digits}`;
    }
  }

  // Formatação visual padronizada
  let formatted = digits;
  if (digits.startsWith('55') && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    formatted = `+55 (${ddd}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  } else if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    formatted = `+55 (${ddd}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  } else if (digits.length >= 10) {
    formatted = `+${digits}`;
  }

  const valid = digits.length >= 10 && digits.length <= 13;
  return { valid, digits, formatted, isLid: false };
}
