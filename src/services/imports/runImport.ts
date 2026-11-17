import { supabase } from '@/lib/supabase';
import type { ColumnMapping, FileKind } from './rules';
import type { ParserClient } from './parserClient';

export const BATCH_SIZE = 500;

export interface ImportProgress {
  status: string; done: boolean; total_rows: number; uploaded_rows: number; processed_rows: number;
  valid_rows: number; invalid_rows: number; duplicate_rows: number; new_contacts: number; name_conflicts: number;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/fetch|network|timeout|503|502|504/i.test(msg)) throw e; // só repete falhas de rede
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

async function processBatch(jobId: string): Promise<ImportProgress> {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('process_import_batch', { p_job_id: jobId, p_batch_size: BATCH_SIZE });
    if (error) throw error;
    return data as ImportProgress;
  });
}

export async function cancelImport(jobId: string) {
  const { error } = await supabase.rpc('cancel_import_job', { p_job_id: jobId });
  if (error) throw error;
}

/** Continua o processamento de um job cujas linhas já foram enviadas. */
export async function resumeImport(jobId: string, onProgress: (p: ImportProgress) => void, signal?: AbortSignal): Promise<ImportProgress> {
  let p: ImportProgress;
  do {
    if (signal?.aborted) { await cancelImport(jobId); return processBatch(jobId); }
    p = await processBatch(jobId);
    onProgress(p);
  } while (!p.done && p.processed_rows < p.uploaded_rows);
  return p;
}

export interface RunImportOptions {
  parser: ParserClient; file: File; kind: FileKind; fileType?: FileKind | 'manual'; hash: string; sourceId: string; mapping: ColumnMapping; total: number;
  onJob?: (jobId: string, previousJobId: string | null) => void;
  onProgress: (p: ImportProgress, phase: 'upload' | 'process') => void;
  signal?: AbortSignal;
}

export async function runImport(o: RunImportOptions): Promise<{ jobId: string; progress: ImportProgress; storageWarning?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sessão expirada. Entre novamente.');

  // 1. Cria o job (o servidor valida limites, dono da fonte e taxa de uso)
  const { data: jobData, error: jobErr } = await supabase.rpc('create_import_job', {
    p_source_id: o.sourceId, p_file_name: o.file.name, p_file_type: o.fileType ?? o.kind, p_file_size: o.file.size,
    p_file_hash: o.hash, p_total_rows: o.total, p_column_mapping: o.mapping,
  });
  if (jobErr) throw jobErr;
  const jobId = (jobData as { job_id: string }).job_id;
  o.onJob?.(jobId, (jobData as { previous_job_id: string | null }).previous_job_id);

  // 2. Guarda o arquivo original no Storage privado (pasta do próprio usuário)
  let storageWarning: string | undefined;
  const path = `${auth.user.id}/${jobId}.${o.kind}`;
  const up = await supabase.storage.from('imports').upload(path, o.file, { upsert: false, contentType: o.file.type || 'application/octet-stream' });
  if (up.error) storageWarning = 'O arquivo original não foi guardado no Storage, mas os registros foram importados.';
  else await supabase.from('import_jobs').update({ storage_path: path }).eq('id', jobId);

  // 3. Envia as linhas em lotes e processa cada lote (progresso real)
  let progress: ImportProgress | null = null;
  for (let from = 0; from < o.total; from += BATCH_SIZE) {
    if (o.signal?.aborted) {
      await cancelImport(jobId);
      return { jobId, progress: await processBatch(jobId), storageWarning };
    }
    const rows = await o.parser.rows(jobId, o.mapping, from, Math.min(from + BATCH_SIZE, o.total));
    await withRetry(async () => {
      const { error } = await supabase.from('import_rows').upsert(rows, { onConflict: 'job_id,row_number', ignoreDuplicates: true });
      if (error) throw error;
    });
    progress = await processBatch(jobId);
    o.onProgress(progress, 'upload');
  }

  // 4. Termina o que faltar
  progress = await resumeImport(jobId, (p) => o.onProgress(p, 'process'), o.signal);
  return { jobId, progress, storageWarning };
}
