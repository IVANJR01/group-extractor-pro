/** Normaliza um nome para comparação: minúsculas, sem acentos, espaços simples. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove espaços extras e caracteres de controle; preserva acentos. */
export function cleanName(name: unknown): string | null {
  if (name === null || name === undefined) return null;
  const s = String(name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s.slice(0, 200);
}

export type NameMerge =
  | { name: string | null; changed: boolean; conflict: false }
  | { name: string | null; changed: false; conflict: true; incoming: string };

/**
 * Regra: nunca troca informação mais completa por menos completa.
 * - vazio + nome => nome
 * - "Maria" + "Maria Silva" => "Maria Silva" (mais completo, contém o anterior)
 * - "Maria Silva" + "Maria" => mantém "Maria Silva"
 * - "Maria" + "Ana" => mantém "Maria" e marca conflito para revisão
 */
export function mergeName(existing: string | null, incoming: string | null): NameMerge {
  if (!incoming) return { name: existing, changed: false, conflict: false };
  if (!existing) return { name: incoming, changed: true, conflict: false };
  const a = nameKey(existing);
  const b = nameKey(incoming);
  if (a === b) return { name: existing, changed: false, conflict: false };
  const ta = a.split(' ');
  const tb = b.split(' ');
  if (tb.length > ta.length && ta.every((t) => tb.includes(t))) return { name: incoming, changed: true, conflict: false };
  if (tb.every((t) => ta.includes(t))) return { name: existing, changed: false, conflict: false };
  return { name: existing, changed: false, conflict: true, incoming };
}
