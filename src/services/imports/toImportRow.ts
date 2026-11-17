import { normalizePhone } from '@/utils/phone';
import { cleanName } from '@/utils/names';

/** Linha pronta para a tabela import_rows (staging). Só nome e telefone: minimização de dados. */
export interface ImportRowInsert {
  job_id: string;
  row_number: number;
  name: string | null;
  original_phone: string | null;
  normalized_phone: string | null;
  phone_digits: string;
  country_code: string | null;
  area_code: string | null;
  national_number: string | null;
  line_type: 'mobile' | 'landline' | 'other' | null;
  validation_status: string;
  issues: string[];
}

export function toImportRow(jobId: string, rowNumber: number, name: unknown, phone: unknown): ImportRowInsert {
  const p = normalizePhone(phone);
  const digits = p.original.replace(/\D/g, '').slice(0, 30);
  return {
    job_id: jobId,
    row_number: rowNumber,
    name: cleanName(name),
    original_phone: p.original === '' ? null : p.original.slice(0, 60),
    normalized_phone: p.normalized,
    phone_digits: digits,
    country_code: p.countryCode,
    area_code: p.areaCode && /^\d{2}$/.test(p.areaCode) ? p.areaCode : null,
    national_number: p.nationalNumber && /^\d{4,15}$/.test(p.nationalNumber) ? p.nationalNumber : null,
    line_type: p.lineType,
    validation_status: p.status,
    issues: p.issues,
  };
}
