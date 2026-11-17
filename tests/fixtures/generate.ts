/**
 * Gera telefones de TESTE determinísticos (sequência numérica, não pessoas reais).
 * Usados apenas pelos testes automatizados — nunca em produção.
 */
export function testPhone(i: number, ddd = '11'): string {
  // celular: 9 + 8 dígitos. Faixa 9 7xxx-xxxx reservada aos testes.
  return `(${ddd}) 97${String(i).padStart(7, '0').slice(0, 3)}-${String(i).padStart(7, '0').slice(3)}`;
}

export function rows(count: number, start: number, ddd = '11') {
  return Array.from({ length: count }, (_, k) => ({ name: `Pessoa Teste ${start + k}`, phone: testPhone(start + k, ddd) }));
}
