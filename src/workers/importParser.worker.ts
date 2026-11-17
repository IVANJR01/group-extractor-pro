/// <reference lib="webworker" />
import { analyze, parseBuffer, sha256Hex, ImportFileError, type ColumnMapping, type FileKind, type ParsedTable } from '@/services/imports/parse';
import { toImportRow } from '@/services/imports/toImportRow';
import { phoneInput } from '@/services/imports/parse';

/** Leitura e validação fora da thread principal, para não travar a tela. */
let table: ParsedTable | null = null;

type Msg =
  | { type: 'parse'; kind: FileKind; buf: ArrayBuffer }
  | { type: 'analyze'; mapping: ColumnMapping }
  | { type: 'rows'; jobId: string; mapping: ColumnMapping; from: number; to: number };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'parse') {
      const hash = await sha256Hex(m.buf);
      table = parseBuffer(m.kind, m.buf);
      self.postMessage({ type: 'parsed', hash, headers: table.headers, hasHeader: table.hasHeader, total: table.rows.length, sample: table.rows.slice(0, 10), warnings: table.warnings });
    } else if (m.type === 'analyze') {
      if (!table) throw new ImportFileError('Arquivo não carregado.');
      self.postMessage({ type: 'analysis', analysis: analyze(table, m.mapping) });
    } else if (m.type === 'rows') {
      if (!table) throw new ImportFileError('Arquivo não carregado.');
      const rows = table.rows.slice(m.from, m.to).map((r, i) =>
        toImportRow(m.jobId, m.from + i + 1, m.mapping.name !== null ? r[m.mapping.name] : null, phoneInput(r, m.mapping)));
      self.postMessage({ type: 'rows', from: m.from, rows });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof ImportFileError ? err.message : 'Não foi possível ler o arquivo.' });
  }
};
