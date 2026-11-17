import { describe, expect, it } from 'vitest';
import { consolidateBatch, createState, sourcesOf, summary, type IncomingRow } from '@/services/contacts/consolidate';
import { rows } from '../fixtures/generate';

const toIncoming = (job: string, source: string, data: { name: unknown; phone: unknown }[]): IncomingRow[] =>
  data.map((d, i) => ({ importJobId: job, sourceId: source, rowNumber: i + 1, name: d.name, phone: d.phone }));

describe('deduplicação — exemplo do pedido', () => {
  it('Grupo X + Grupo Y = 4 registros, 3 únicos, 1 duplicidade', () => {
    const s = createState();
    consolidateBatch(s, toIncoming('jx', 'X', [{ name: 'Maria', phone: '+5511999999999' }, { name: 'João', phone: '+5511988888888' }]));
    const st = consolidateBatch(s, toIncoming('jy', 'Y', [{ name: 'Maria Silva', phone: '+5511999999999' }, { name: 'Pedro', phone: '+5511977777777' }]));
    expect(st.duplicates).toBe(1);
    expect(summary(s)).toMatchObject({ sourceRecords: 4, uniquePhones: 3, duplicateOccurrences: 1 });
    const maria = s.contacts.get('+5511999999999')!;
    expect(maria.name).toBe('Maria Silva'); // nome mais completo
    expect(maria.firstSourceId).toBe('X'); // primeira importação preservada
    expect(sourcesOf(s, '+5511999999999')).toEqual(['X', 'Y']); // histórico de todas as fontes
  });

  it('números do exemplo com 8 ou 7 após o DDD não são celulares válidos', () => {
    const s = createState();
    const st = consolidateBatch(s, toIncoming('j', 'X', [{ name: 'João', phone: '+5511888888888' }]));
    expect(st.invalid).toBe(1);
  });

  it('não junta pessoas só pelo nome', () => {
    const s = createState();
    consolidateBatch(s, toIncoming('j', 'X', [{ name: 'Maria', phone: '11999999999' }, { name: 'Maria', phone: '11988888888' }]));
    expect(s.contacts.size).toBe(2);
  });
});

describe('cenários 1, 2, 3 e 6', () => {
  // Observação: o pedido cita "2.200 registros e 1.900 únicos", mas 1.000 + 1.000 + 500
  // somam 2.500 registros de origem; com 300 repetidos ficam 2.200 telefones únicos.
  it('2.500 registros de origem, 300 duplicados e 2.200 telefones únicos', () => {
    const s = createState();
    const grupoX = rows(1000, 1); // 1..1000
    const grupoY = [...rows(300, 1), ...rows(700, 1001)]; // 300 repetidos + 700 novos
    const excel = rows(500, 1701); // 500 novos
    consolidateBatch(s, toIncoming('job-x', 'Grupo X', grupoX));
    const y = consolidateBatch(s, toIncoming('job-y', 'Grupo Y', grupoY));
    consolidateBatch(s, toIncoming('job-excel', 'Lista Excel', excel));
    expect(y.duplicates).toBe(300);
    expect(summary(s)).toMatchObject({ sourceRecords: 2500, uniquePhones: 2200, duplicateOccurrences: 300, invalid: 0 });
  });

  it('cenário 6: reprocessar o mesmo job não cria nada', () => {
    const s = createState();
    const data = toIncoming('job-x', 'Grupo X', rows(1000, 1));
    consolidateBatch(s, data);
    const again = consolidateBatch(s, data);
    expect(again).toMatchObject({ processed: 0, newContacts: 0, skippedAlreadyProcessed: 1000 });
    expect(s.contacts.size).toBe(1000);
  });

  it('cenário 6: mesmo arquivo importado de novo (novo job) preserva histórico sem contato novo', () => {
    const s = createState();
    consolidateBatch(s, toIncoming('job-1', 'Grupo X', rows(1000, 1)));
    const second = consolidateBatch(s, toIncoming('job-2', 'Grupo X', rows(1000, 1)));
    expect(second.newContacts).toBe(0);
    expect(s.contacts.size).toBe(1000);
    expect(s.relations.size).toBe(2000);
  });

  it('linhas inválidas são registradas sem virar contato', () => {
    const s = createState();
    const st = consolidateBatch(s, toIncoming('j', 'X', [{ name: 'A', phone: '123' }, { name: 'B', phone: '20999999999' }, { name: 'C', phone: '11999999999' }]));
    expect(st).toMatchObject({ invalid: 2, newContacts: 1 });
  });
});
