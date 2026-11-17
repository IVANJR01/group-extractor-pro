import { describe, expect, it } from 'vitest';
import { normalizePhone, maskPhone } from '@/utils/phone';
import { BRAZIL_DDDS, isValidDDD, ufFromDDD } from '@/utils/ddd';

describe('DDD', () => {
  it('tem os 67 DDDs oficiais', () => {
    expect(BRAZIL_DDDS).toHaveLength(67);
  });
  it('valida e mapeia UF', () => {
    expect(isValidDDD('84')).toBe(true);
    expect(ufFromDDD('84')).toBe('RN');
    expect(isValidDDD('20')).toBe(false);
    expect(isValidDDD('23')).toBe(false);
    expect(ufFromDDD('00')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it.each([
    ['(11) 99999-9999', '+5511999999999'],
    ['11 99999 9999', '+5511999999999'],
    ['+55 11 99999-9999', '+5511999999999'],
    ['5511999999999', '+5511999999999'],
    ['005511999999999', '+5511999999999'],
    ['011999999999', '+5511999999999'],
    ['0 15 11 99999-9999', '+5511999999999'],
    ['84.98765.4321', '+5584987654321'],
  ])('%s => %s', (input, expected) => {
    const r = normalizePhone(input);
    expect(r.status).toBe('valid');
    expect(r.normalized).toBe(expected);
    expect(r.countryCode).toBe('55');
    expect(r.original).toBe(input);
  });

  it('separa DDD e número nacional e preserva o original', () => {
    const r = normalizePhone(' (84) 98765-4321 ');
    expect(r).toMatchObject({ original: '(84) 98765-4321', areaCode: '84', nationalNumber: '84987654321', lineType: 'mobile' });
  });

  it('aceita telefone fixo', () => {
    const r = normalizePhone('(11) 3333-4444');
    expect(r.status).toBe('valid');
    expect(r.lineType).toBe('landline');
    expect(r.normalized).toBe('+551133334444');
  });

  it('aceita números vindos do Excel como number e notação científica', () => {
    expect(normalizePhone(5511999999999).normalized).toBe('+5511999999999');
    expect(normalizePhone('5.511999999999E+12').normalized).toBe('+5511999999999');
    expect(normalizePhone('5511999999999.0').normalized).toBe('+5511999999999');
  });

  it('não presume validade só pela quantidade de dígitos', () => {
    expect(normalizePhone('20999999999').status).toBe('invalid_area_code'); // DDD 20 não existe
    expect(normalizePhone('11899999999').status).toBe('invalid'); // 9 dígitos sem começar com 9
    expect(normalizePhone('1111111111').status).toBe('invalid'); // fixo começando com 1
  });

  it('não acrescenta o 9 por conta própria', () => {
    const r = normalizePhone('11 8888-7777');
    expect(r.status).toBe('needs_review');
    expect(r.normalized).toBeNull();
  });

  it('detecta incompletos, vazios e caracteres inválidos', () => {
    expect(normalizePhone('99999-9999').status).toBe('incomplete');
    expect(normalizePhone('123').status).toBe('incomplete');
    expect(normalizePhone('').status).toBe('empty');
    expect(normalizePhone(null).status).toBe('empty');
    expect(normalizePhone('11 9999A-9999').status).toBe('invalid');
    expect(normalizePhone('5511999999999999').status).toBe('invalid');
  });

  it('reconhece estrangeiro válido sem marcar como brasileiro', () => {
    const r = normalizePhone('+351 912 345 678');
    expect(r.status).toBe('foreign');
    expect(r.normalized).toBe('+351912345678');
    expect(r.areaCode).toBeNull();
  });

  it('mascara telefone para logs', () => {
    expect(maskPhone('+5511999999999')).toBe('+5511****99');
  });
});

import { signupPhone } from '@/pages/Signup/PublicSignupPage';
describe('telefone da página de inscrição', () => {
  it('aceita celular BR em vários formatos e recusa fixo, 8 dígitos e DDD inválido', () => {
    expect(signupPhone('(84) 99999-0001')).toEqual({ phone: '+5584999990001' });
    expect(signupPhone('+55 84 99999-0001')).toEqual({ phone: '+5584999990001' });
    expect(signupPhone('8432221111')).toMatchObject({ error: expect.stringMatching(/celular/) });
    expect(signupPhone('84 9999-0001')).toMatchObject({ error: expect.stringMatching(/9 dígitos/) });
    expect(signupPhone('20 99999-0001')).toMatchObject({ error: expect.stringMatching(/DDD/) });
    expect(signupPhone('')).toMatchObject({ error: expect.any(String) });
    expect(signupPhone('+351 912 345 678')).toEqual({ phone: '+351912345678' });
  });
});
