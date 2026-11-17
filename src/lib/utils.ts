import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const nf = new Intl.NumberFormat('pt-BR');
export const fmtNumber = (n: number | null | undefined) => nf.format(n ?? 0);
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(d)) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '—';

/** Mensagem de erro amigável, sem vazar detalhes internos. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const m = (e as { message: string }).message;
    if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para esta ação.';
    if (/duplicate key|unique/i.test(m)) return 'Já existe um registro com esses dados.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor. Tente novamente.';
    return m.length > 200 ? 'Ocorreu um erro inesperado.' : m;
  }
  return 'Ocorreu um erro inesperado.';
}
