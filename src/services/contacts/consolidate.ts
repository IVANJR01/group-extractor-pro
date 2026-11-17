import { normalizePhone, isUsablePhone, type NormalizedPhone } from '@/utils/phone';
import { cleanName, mergeName } from '@/utils/names';

/**
 * Motor de deduplicação em memória. É a mesma regra aplicada pelo banco
 * (função SQL consolidate_import_batch); aqui serve para a prévia da
 * importação e para os testes. Idempotente: a chave de cada ocorrência é
 * (importJobId, rowNumber).
 */
export interface IncomingRow {
  importJobId: string;
  sourceId: string;
  rowNumber: number;
  name: unknown;
  phone: unknown;
}

export interface ConsolidatedContact {
  normalizedPhone: string;
  name: string | null;
  phone: NormalizedPhone;
  firstSourceId: string;
  firstImportJobId: string;
  nameConflicts: string[];
}

export interface SourceRelation {
  key: string; // importJobId:rowNumber
  normalizedPhone: string;
  sourceId: string;
  importJobId: string;
  rowNumber: number;
  originalName: string | null;
}

export interface RejectedRow {
  key: string;
  rowNumber: number;
  sourceId: string;
  phone: NormalizedPhone;
}

export interface ConsolidationState {
  contacts: Map<string, ConsolidatedContact>;
  relations: Map<string, SourceRelation>;
  rejected: Map<string, RejectedRow>;
}

export interface BatchStats {
  processed: number;
  newContacts: number;
  /** Linhas cujo telefone já existia (em outra origem ou no mesmo arquivo). */
  duplicates: number;
  invalid: number;
  /** Linhas ignoradas porque já tinham sido processadas (reexecução). */
  skippedAlreadyProcessed: number;
  nameConflicts: number;
}

export function createState(): ConsolidationState {
  return { contacts: new Map(), relations: new Map(), rejected: new Map() };
}

export function consolidateBatch(state: ConsolidationState, rows: IncomingRow[]): BatchStats {
  const stats: BatchStats = { processed: 0, newContacts: 0, duplicates: 0, invalid: 0, skippedAlreadyProcessed: 0, nameConflicts: 0 };

  for (const row of rows) {
    const key = `${row.importJobId}:${row.rowNumber}`;
    if (state.relations.has(key) || state.rejected.has(key)) {
      stats.skippedAlreadyProcessed++;
      continue;
    }
    stats.processed++;
    const phone = normalizePhone(row.phone);
    const name = cleanName(row.name);

    if (!isUsablePhone(phone)) {
      stats.invalid++;
      state.rejected.set(key, { key, rowNumber: row.rowNumber, sourceId: row.sourceId, phone });
      continue;
    }

    const e164 = phone.normalized!;
    const existing = state.contacts.get(e164);
    if (!existing) {
      state.contacts.set(e164, {
        normalizedPhone: e164,
        name,
        phone,
        firstSourceId: row.sourceId,
        firstImportJobId: row.importJobId,
        nameConflicts: [],
      });
      stats.newContacts++;
    } else {
      stats.duplicates++;
      const merged = mergeName(existing.name, name);
      if (merged.conflict) {
        if (!existing.nameConflicts.includes(merged.incoming)) existing.nameConflicts.push(merged.incoming);
        stats.nameConflicts++;
      } else if (merged.changed) {
        existing.name = merged.name;
      }
    }

    state.relations.set(key, {
      key,
      normalizedPhone: e164,
      sourceId: row.sourceId,
      importJobId: row.importJobId,
      rowNumber: row.rowNumber,
      originalName: name,
    });
  }
  return stats;
}

/** Origens de um contato, na ordem em que apareceram. */
export function sourcesOf(state: ConsolidationState, e164: string): string[] {
  const out: string[] = [];
  for (const r of state.relations.values()) if (r.normalizedPhone === e164 && !out.includes(r.sourceId)) out.push(r.sourceId);
  return out;
}

export function summary(state: ConsolidationState) {
  const occurrences = state.relations.size;
  const unique = state.contacts.size;
  return {
    sourceRecords: occurrences + state.rejected.size,
    validOccurrences: occurrences,
    uniquePhones: unique,
    duplicateOccurrences: occurrences - unique,
    invalid: state.rejected.size,
  };
}
