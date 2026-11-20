import Papa from 'papaparse';
import * as XLSX from '@e965/xlsx';
import { ImportFileError, MAX_ROWS, finalize, type FileKind, type ParsedTable } from './rules';
import { isWhatsAppChatExport, parseWhatsAppChatExport } from '@/utils/whatsappChatParser';

export * from './rules';

export function parseDelimitedText(text: string): ParsedTable {
  const clean = text.replace(/^﻿/, '');
  if (clean.trim() === '') throw new ImportFileError('O arquivo está vazio.');
  if (/\u0000/.test(clean.slice(0, 2000))) throw new ImportFileError('Arquivo malformado ou binário. Salve como CSV/TXT (UTF-8).');

  if (isWhatsAppChatExport(clean)) {
    const chat = parseWhatsAppChatExport(clean);
    const rows = chat.contacts.map((c) => [c.name || 'Participante', c.normalizedPhone || c.rawPhone]);
    return finalize([['Nome', 'Telefone'], ...rows], [`Conversa do WhatsApp identificada: ${chat.totalUniquePhones} contatos extraídos.`]);
  }

  const res = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy', delimitersToGuess: [';', ',', '\t', '|'] });
  const fatal = res.errors.filter((e) => e.type === 'Quotes');
  if (fatal.length > 0 && res.data.length === 0) throw new ImportFileError('Arquivo malformado: aspas não fechadas.');
  const warnings = res.errors.slice(0, 5).map((e) => `Linha ${(e.row ?? 0) + 1}: ${e.message}`);
  return finalize(res.data, warnings);
}

export function parseWorkbook(buf: ArrayBuffer, kind: 'xlsx' | 'xls' = 'xlsx'): ParsedTable {
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (kind === 'xlsx' && !isZip) throw new ImportFileError('Arquivo .xlsx malformado ou com extensão trocada.');
  if (kind === 'xls' && !isOle && !isZip && buf.byteLength < 16) throw new ImportFileError('Arquivo .xls malformado.');
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellText: false, dense: true, sheetRows: MAX_ROWS + 2 });
  } catch {
    throw new ImportFileError('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.');
  }
  const name = wb.SheetNames[0];
  if (!name) throw new ImportFileError('A planilha não tem abas.');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
  const warnings = wb.SheetNames.length > 1 ? [`A planilha tem ${wb.SheetNames.length} abas; apenas a primeira ("${name}") foi lida.`] : [];
  return finalize(raw as string[][], warnings);
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Arquivos do Excel antigo costumam vir em Windows-1252
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(buf);
  return utf8;
}

export function parseBuffer(kind: FileKind, buf: ArrayBuffer): ParsedTable {
  return kind === 'xlsx' || kind === 'xls' ? parseWorkbook(buf, kind) : parseDelimitedText(decodeText(buf));
}

