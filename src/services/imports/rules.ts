import { normalizePhone, type PhoneValidationStatus } from '@/utils/phone';
import { cleanName } from '@/utils/names';

/** Regras leves de importação (sem bibliotecas pesadas): podem rodar na tela. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 200_000;
export const ACCEPTED_EXTENSIONS = ['csv', 'txt', 'xlsx', 'xls'] as const;
export type FileKind = (typeof ACCEPTED_EXTENSIONS)[number];

export class ImportFileError extends Error {}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  hasHeader: boolean;
  warnings: string[];
}

export function fileKindOf(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as FileKind) : null;
}

export function validateFileMeta(name: string, size: number): FileKind {
  const kind = fileKindOf(name);
  if (!kind) throw new ImportFileError('Extensão inválida. Use CSV, TXT, XLSX ou XLS.');
  if (size === 0) throw new ImportFileError('O arquivo está vazio.');
  if (size > MAX_FILE_BYTES) throw new ImportFileError('Arquivo maior que 20 MB. Divida a lista em partes menores.');
  return kind;
}

const PHONE_HINT = /(telefone|fone|celular|cel|whats|zap|phone|mobile|n[uú]mero|contato)/i;
const NAME_HINT = /^(nome|name|cliente|contato nome|participante|full ?name)/i;
const DDD_HINT = /^(ddd|c[oó]d(igo)? ?de ?[aá]rea|area ?code)$/i;

function looksLikePhone(v: string): boolean {
  const d = v.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 && /^[\d\s()+\-.]+$/.test(v.trim());
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v).toString() : String(v);
  return String(v).trim();
}

/** Decide se a primeira linha é cabeçalho: nenhum valor parece telefone e há texto. */
function detectHeader(first: string[]): boolean {
  if (first.length === 0) return false;
  const anyPhone = first.some(looksLikePhone);
  const anyText = first.some((c) => /[a-zA-ZÀ-ú]/.test(c));
  return !anyPhone && anyText;
}

export function finalize(raw: string[][], warnings: string[]): ParsedTable {
  const rows = raw.map((r) => r.map(cellToString)).filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) throw new ImportFileError('O arquivo não tem registros.');
  const hasHeader = detectHeader(rows[0]);
  const width = Math.max(...rows.slice(0, 1000).map((r) => r.length));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => rows[0][i]?.trim() || `Coluna ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length === 0) throw new ImportFileError('O arquivo só tem cabeçalho, sem registros.');
  if (body.length > MAX_ROWS) throw new ImportFileError(`O arquivo tem ${body.length} linhas. O limite é ${MAX_ROWS} por importação.`);
  return { headers, rows: body, hasHeader, warnings };
}

export interface ColumnMapping { name: number | null; phone: number | null; area_code: number | null }

export function detectMapping(t: ParsedTable): ColumnMapping {
  const m: ColumnMapping = { name: null, phone: null, area_code: null };
  if (t.hasHeader) {
    t.headers.forEach((h, i) => {
      if (m.area_code === null && DDD_HINT.test(h.trim())) m.area_code = i;
      else if (m.phone === null && PHONE_HINT.test(h) && !NAME_HINT.test(h)) m.phone = i;
      else if (m.name === null && NAME_HINT.test(h.trim())) m.name = i;
    });
  }
  const sample = t.rows.slice(0, 50);
  if (m.phone === null) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < t.headers.length; i++) {
      if (i === m.area_code) continue;
      const score = sample.filter((r) => looksLikePhone(r[i] ?? '')).length;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best >= 0) m.phone = best;
  }
  if (m.name === null) {
    for (let i = 0; i < t.headers.length; i++) {
      if (i === m.phone || i === m.area_code) continue;
      const score = sample.filter((r) => /[a-zA-ZÀ-ú]{2,}/.test(r[i] ?? '') && !looksLikePhone(r[i] ?? '')).length;
      if (score >= Math.max(1, sample.length / 2)) { m.name = i; break; }
    }
  }
  return m;
}

/** Junta DDD em coluna separada com o telefone, só quando o telefone não tem DDD. */
export function phoneInput(row: string[], m: ColumnMapping): string {
  const phone = m.phone !== null ? row[m.phone] ?? '' : '';
  if (m.area_code === null) return phone;
  const ddd = (row[m.area_code] ?? '').replace(/\D/g, '');
  const digits = phone.replace(/\D/g, '');
  if (ddd.length === 2 && (digits.length === 8 || digits.length === 9) && !phone.trim().startsWith('+')) return `${ddd}${digits}`;
  return phone;
}

export interface AnalyzedRow { rowNumber: number; name: string | null; phone: string; status: PhoneValidationStatus; normalized: string | null; issues: string[]; duplicateInFile: boolean }

export interface Analysis {
  total: number;
  usable: number;
  uniqueInFile: number;
  duplicatesInFile: number;
  byStatus: Record<string, number>;
  missingName: number;
  preview: AnalyzedRow[];
  problems: AnalyzedRow[];
}

export function analyze(t: ParsedTable, m: ColumnMapping, previewSize = 20): Analysis {
  if (m.phone === null) throw new ImportFileError('Selecione a coluna de telefone.');
  const seen = new Set<string>();
  const byStatus: Record<string, number> = {};
  const preview: AnalyzedRow[] = [];
  const problems: AnalyzedRow[] = [];
  let usable = 0, dups = 0, missingName = 0;
  t.rows.forEach((row, i) => {
    const p = normalizePhone(phoneInput(row, m));
    const name = m.name !== null ? cleanName(row[m.name]) : null;
    if (!name) missingName++;
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    let dup = false;
    if (p.normalized) {
      usable++;
      if (seen.has(p.normalized)) { dup = true; dups++; } else seen.add(p.normalized);
    }
    const a: AnalyzedRow = { rowNumber: i + 1, name, phone: p.original, status: p.status, normalized: p.normalized, issues: p.issues, duplicateInFile: dup };
    if (preview.length < previewSize) preview.push(a);
    if (!p.normalized && problems.length < 100) problems.push(a);
  });
  return { total: t.rows.length, usable, uniqueInFile: seen.size, duplicatesInFile: dups, byStatus, missingName, preview, problems };
}

