import { describe, expect, it } from 'vitest';
import { mergeName, nameKey, cleanName } from '@/utils/names';

describe('nomes', () => {
  it('normaliza para comparação', () => {
    expect(nameKey('  JOÃO  da  Silva ')).toBe('joao da silva');
    expect(cleanName('  Ana\tMaria ')).toBe('Ana Maria');
    expect(cleanName('   ')).toBeNull();
  });
  it('não substitui informação completa por incompleta', () => {
    expect(mergeName('Maria', 'Maria Silva')).toMatchObject({ name: 'Maria Silva', changed: true });
    expect(mergeName('Maria Silva', 'Maria')).toMatchObject({ name: 'Maria Silva', changed: false, conflict: false });
    expect(mergeName('Maria Silva', null)).toMatchObject({ name: 'Maria Silva', changed: false });
    expect(mergeName(null, 'Pedro')).toMatchObject({ name: 'Pedro', changed: true });
  });
  it('marca conflito sem sobrescrever', () => {
    expect(mergeName('Maria', 'Ana')).toMatchObject({ name: 'Maria', conflict: true, incoming: 'Ana' });
  });
});
