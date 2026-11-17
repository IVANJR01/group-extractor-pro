import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { analyze, detectMapping, parseBuffer, parseDelimitedText, phoneInput, validateFileMeta, ImportFileError } from '@/services/imports/parse';
import { toImportRow } from '@/services/imports/toImportRow';

describe('validação do arquivo', () => {
  it('rejeita extensão, vazio e excesso de tamanho', () => {
    expect(() => validateFileMeta('lista.pdf', 10)).toThrow(ImportFileError);
    expect(() => validateFileMeta('lista.csv', 0)).toThrow(/vazio/);
    expect(() => validateFileMeta('lista.csv', 21 * 1024 * 1024)).toThrow(/20 MB/);
    expect(validateFileMeta('Lista.XLSX', 100)).toBe('xlsx');
  });
});

describe('CSV', () => {
  it('lê ; com BOM e cabeçalho e detecta colunas', () => {
    const t = parseDelimitedText('﻿Nome;Telefone;Cidade\nMaria;(11) 99999-9999;SP\nJoão;11 98888-8888;SP\n');
    expect(t.hasHeader).toBe(true);
    expect(t.rows).toHaveLength(2);
    expect(detectMapping(t)).toEqual({ name: 0, phone: 1, area_code: null });
  });
  it('lê vírgula com aspas', () => {
    const t = parseDelimitedText('name,phone\n"Silva, Maria","+55 11 99999-9999"\n');
    expect(t.rows[0]).toEqual(['Silva, Maria', '+55 11 99999-9999']);
  });
  it('sem cabeçalho: detecta telefone pelo conteúdo', () => {
    const t = parseDelimitedText('Maria,11999999999\nJoão,11988888888\n');
    expect(t.hasHeader).toBe(false);
    expect(detectMapping(t)).toMatchObject({ phone: 1, name: 0 });
  });
  it('junta DDD em coluna separada', () => {
    const t = parseDelimitedText('Nome;DDD;Celular\nAna;84;98765-4321\n');
    const m = detectMapping(t);
    expect(m).toEqual({ name: 0, phone: 2, area_code: 1 });
    expect(phoneInput(t.rows[0], m)).toBe('84987654321');
  });
  it('arquivo vazio ou só cabeçalho', () => {
    expect(() => parseDelimitedText('   \n')).toThrow(/vazio/);
    expect(() => parseDelimitedText('Nome;Telefone\n')).toThrow(/cabeçalho/);
  });
});

describe('TXT', () => {
  it('um número por linha', () => {
    const t = parseBuffer('txt', new TextEncoder().encode('11999999999\n(84) 98765-4321\n\n123\n').buffer as ArrayBuffer);
    const m = detectMapping(t);
    expect(m.phone).toBe(0);
    const a = analyze(t, m);
    expect(a).toMatchObject({ total: 3, usable: 2 });
    expect(a.byStatus.incomplete).toBe(1);
  });
  it('detecta repetidos dentro do próprio arquivo', () => {
    const t = parseDelimitedText('11999999999\n+5511999999999\n(11) 99999-9999\n');
    expect(analyze(t, detectMapping(t))).toMatchObject({ total: 3, uniqueInFile: 1, duplicatesInFile: 2 });
  });
});

describe('XLSX / XLS', () => {
  const book = (type: 'xlsx' | 'biff8') => {
    const ws = XLSX.utils.aoa_to_sheet([['Nome', 'WhatsApp'], ['Maria', 5511999999999], ['Pedro', '(84) 98765-4321']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
    return XLSX.write(wb, { type: 'array', bookType: type }) as ArrayBuffer;
  };
  it.each([['xlsx', 'xlsx'], ['xls', 'biff8']] as const)('lê %s, inclusive telefone numérico', (kind, type) => {
    const t = parseBuffer(kind, book(type));
    expect(t.headers).toEqual(['Nome', 'WhatsApp']);
    const m = detectMapping(t);
    expect(m).toMatchObject({ name: 0, phone: 1 });
    expect(analyze(t, m).usable).toBe(2);
    expect(toImportRow('j', 1, t.rows[0][0], t.rows[0][1]).normalized_phone).toBe('+5511999999999');
  });
  it('arquivo corrompido gera erro amigável', () => {
    expect(() => parseBuffer('xlsx', new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer)).toThrow(ImportFileError);
  });
});
