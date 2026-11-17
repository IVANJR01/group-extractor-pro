import { describe, expect, it } from 'vitest';
import { safeCell, toCsv } from '@/services/exports';

describe('exportação', () => {
  it('protege contra injeção de fórmula sem estragar telefones', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(safeCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(safeCell('+cmd')).toBe(`'+cmd`);
    expect(safeCell('+5511999999999')).toBe('+5511999999999');
    expect(safeCell(null)).toBe('');
  });
  it('gera CSV com ; BOM e aspas', () => {
    const csv = toCsv(['Nome', 'Telefone'], [['Silva; Maria', '+5511999999999'], ['Ana "Bia"', null]]);
    expect(csv.startsWith('﻿Nome;Telefone\r\n')).toBe(true);
    expect(csv).toContain('"Silva; Maria";+5511999999999');
    expect(csv).toContain('"Ana ""Bia""";');
  });
});

import { isSecretKey } from '@/lib/supabase';
describe('proteção da chave secreta', () => {
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
  it('recusa sb_secret_ e JWT service_role; aceita publishable/anon', () => {
    expect(isSecretKey('sb_secret_abc')).toBe(true);
    expect(isSecretKey(jwt('service_role'))).toBe(true);
    expect(isSecretKey(jwt('anon'))).toBe(false);
    expect(isSecretKey('sb_publishable_abc')).toBe(false);
  });
});
