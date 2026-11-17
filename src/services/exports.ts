import { supabase } from '@/lib/supabase';

export type ExportFormat = 'csv' | 'xlsx';
export type Cell = string | number | null | undefined;

/** Evita injeção de fórmulas em planilhas (=, @, +texto, -texto), sem estragar telefones +55. */
export function safeCell(v: Cell): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^[=@\t\r]/.test(s) || /^[+-][^\d]/.test(s)) return `'${s}`;
  return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = String(safeCell(v));
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // ; e BOM: abre corretamente no Excel em português
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

export async function downloadTable(fileBase: string, headers: string[], rows: Cell[][], format: ExportFormat) {
  let blob: Blob;
  if (format === 'csv') {
    blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  } else {
    const XLSX = await import('@e965/xlsx');
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map((r) => r.map(safeCell))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileBase}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type ContactExportKind = 'unique' | 'authorized' | 'unauthorized' | 'duplicates' | 'invalid' | 'by_source' | 'by_ddd' | 'segment';

interface ExportRow { name: string | null; phone: string | null; area_code: string | null; uf: string | null; validation_status: string; consent_status: string; sources: string | null; occurrences: number; created_at: string }

/** Busca em páginas de 1.000 (limite da API), até 100 mil linhas. */
export async function fetchContactExport(kind: ContactExportKind, filter: object, onProgress?: (n: number) => void): Promise<ExportRow[]> {
  const out: ExportRow[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await supabase.rpc('export_contacts', { p_kind: kind, p_filter: filter, p_offset: offset, p_limit: 1000 });
    if (error) throw error;
    out.push(...(data as ExportRow[]));
    onProgress?.(out.length);
    if ((data as ExportRow[]).length < 1000) break;
  }
  return out;
}

export async function logExport(kind: string, rows: number, criteria: object = {}) {
  await supabase.rpc('log_audit', { p_action: 'export.history', p_entity_type: kind, p_entity_id: null, p_metadata: { rows, criteria } });
}
