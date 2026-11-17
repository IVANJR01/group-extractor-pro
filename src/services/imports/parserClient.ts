import type { Analysis, ColumnMapping, FileKind } from './rules';
import type { ImportRowInsert } from './toImportRow';

export interface ParsedInfo { hash: string; headers: string[]; hasHeader: boolean; total: number; sample: string[][]; warnings: string[] }

/** Conversa com o Web Worker de leitura de arquivos usando Promises. */
export class ParserClient {
  private worker = new Worker(new URL('../../workers/importParser.worker.ts', import.meta.url), { type: 'module' });
  private queue: Promise<unknown> = Promise.resolve();

  private call<T>(msg: unknown, expect: string): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        this.worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'error') reject(new Error(e.data.message));
          else if (e.data.type === expect) resolve(e.data as T);
        };
        this.worker.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
        this.worker.postMessage(msg);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  parse(kind: FileKind, buf: ArrayBuffer) { return this.call<ParsedInfo>({ type: 'parse', kind, buf }, 'parsed'); }
  analyze(mapping: ColumnMapping) { return this.call<{ analysis: Analysis }>({ type: 'analyze', mapping }, 'analysis').then((r) => r.analysis); }
  rows(jobId: string, mapping: ColumnMapping, from: number, to: number) {
    return this.call<{ rows: ImportRowInsert[] }>({ type: 'rows', jobId, mapping, from, to }, 'rows').then((r) => r.rows);
  }
  terminate() { this.worker.terminate(); }
}
