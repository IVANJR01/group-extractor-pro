/**
 * Testes de banco (RLS, isolamento, idempotência, consentimento).
 * Rodam contra um PostgreSQL com as migrations aplicadas + supabase/tests/supabase_shim.sql.
 * Use: TEST_DATABASE_URL=postgres://gep:gep@localhost/gep_test npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { toImportRow } from '@/services/imports/toImportRow';
import { rows as fakeRows } from '../fixtures/generate';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let pool: pg.Pool;
const A = randomUUID();
const B = randomUUID();

async function as<T>(uid: string | null, fn: (c: pg.PoolClient) => Promise<T>, role = 'authenticated'): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('role', $1, true)`, [role]);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function createSource(uid: string, name: string) {
  return as(uid, async (c) => (await c.query(`insert into contact_sources (name) values ($1) returning id`, [name])).rows[0].id as string);
}

async function importRows(uid: string, sourceId: string, fileName: string, data: { name: unknown; phone: unknown }[], hash = 'a'.repeat(64)) {
  const job = await as(uid, async (c) =>
    (await c.query(`select create_import_job($1, $2, 'csv', 1000, $3, $4, '{}') as r`, [sourceId, fileName, hash, data.length])).rows[0].r);
  const jobId = job.job_id as string;
  for (let i = 0; i < data.length; i += 500) {
    const chunk = data.slice(i, i + 500).map((r, k) => toImportRow(jobId, i + k + 1, r.name, r.phone));
    await as(uid, (c) =>
      c.query(
        `insert into import_rows (job_id, row_number, name, original_phone, normalized_phone, phone_digits, country_code, area_code, national_number, line_type, validation_status, issues)
         select * from jsonb_to_recordset($1::jsonb) as x(job_id uuid, row_number int, name text, original_phone text, normalized_phone text, phone_digits text, country_code text, area_code text, national_number text, line_type text, validation_status text, issues text[])
         on conflict (job_id, row_number) do nothing`,
        [JSON.stringify(chunk)],
      ),
    );
  }
  let progress: any;
  do {
    progress = await as(uid, async (c) => (await c.query(`select process_import_batch($1, 500) as p`, [jobId])).rows[0].p);
  } while (!progress.done);
  return { jobId, previousJobId: job.previous_job_id as string | null, progress };
}

const count = (uid: string, sql: string, params: unknown[] = []) =>
  as(uid, async (c) => Number((await c.query(sql, params)).rows[0].n));

d('banco de dados', () => {
  let srcX: string, srcY: string, srcExcel: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(`insert into auth.users (id, email) values ($1, 'a@teste.local'), ($2, 'b@teste.local')`, [A, B]);
    srcX = await createSource(A, 'Grupo X');
    srcY = await createSource(A, 'Grupo Y');
    srcExcel = await createSource(A, 'Lista Excel');
  });
  afterAll(async () => pool?.end());

  it('cria o perfil automaticamente', async () => {
    expect(await count(A, `select count(*) n from profiles`)).toBe(1);
  });

  it('cenários 1–3: 2.500 registros de origem, 300 duplicados, 2.200 únicos', async () => {
    const x = await importRows(A, srcX, 'grupo-x.csv', fakeRows(1000, 1), 'a'.repeat(64));
    expect(x.progress).toMatchObject({ status: 'completed', new_contacts: 1000, duplicate_rows: 0 });
    const y = await importRows(A, srcY, 'grupo-y.csv', [...fakeRows(300, 1), ...fakeRows(700, 1001)], 'b'.repeat(64));
    expect(y.progress).toMatchObject({ new_contacts: 700, duplicate_rows: 300 });
    const e = await importRows(A, srcExcel, 'lista.xlsx', fakeRows(500, 1701), 'c'.repeat(64));
    expect(e.progress).toMatchObject({ new_contacts: 500, duplicate_rows: 0 });

    expect(await count(A, `select count(*) n from contact_source_relations`)).toBe(2500);
    expect(await count(A, `select count(*) n from contacts where normalized_phone is not null`)).toBe(2200);
    expect(await count(A, `select count(*) n from contact_overview where occurrences > 1`)).toBe(300);
    // Contato repetido conhece as duas origens e a primeira importação
    const shared = await as(A, async (c) => (await c.query(`select source_ids, first_source_id from contact_overview where occurrences = 2 limit 1`)).rows[0]);
    expect(shared.source_ids.sort()).toEqual([srcX, srcY].sort());
    expect(shared.first_source_id).toBe(srcX);
  });

  it('cenário 6: mesmo arquivo importado de novo não duplica e preserva o histórico', async () => {
    const again = await importRows(A, srcX, 'grupo-x.csv', fakeRows(1000, 1), 'a'.repeat(64));
    expect(again.previousJobId).not.toBeNull(); // detectou reimportação
    expect(again.progress).toMatchObject({ new_contacts: 0, duplicate_rows: 1000 });
    expect(await count(A, `select count(*) n from contacts where normalized_phone is not null`)).toBe(2200);
    expect(await count(A, `select count(*) n from import_jobs`)).toBe(4);
    // reprocessar o job concluído não muda nada
    const p = await as(A, async (c) => (await c.query(`select process_import_batch($1) p`, [again.jobId])).rows[0].p);
    expect(p.done).toBe(true);
    expect(await count(A, `select count(*) n from contact_source_relations`)).toBe(3500);
  });

  it('exemplo do pedido: Maria → Maria Silva, conflito de nome é registrado sem sobrescrever', async () => {
    const s1 = await createSource(A, 'Exemplo 1');
    const s2 = await createSource(A, 'Exemplo 2');
    await importRows(A, s1, 'e1.csv', [{ name: 'Maria', phone: '+5584999999999' }, { name: 'João', phone: '+5584988888888' }], 'd'.repeat(64));
    await importRows(A, s2, 'e2.csv', [{ name: 'Maria Silva', phone: '+5584999999999' }, { name: 'Ana', phone: '+5584988888888' }], 'e'.repeat(64));
    const rows = await as(A, async (c) => (await c.query(`select name, name_conflicts from contacts where normalized_phone in ('+5584999999999','+5584988888888') order by name`)).rows);
    expect(rows).toEqual([{ name: 'João', name_conflicts: ['Ana'] }, { name: 'Maria Silva', name_conflicts: [] }]);
  });

  it('inválidos ficam separados e não duplicam ao reimportar', async () => {
    const s = await createSource(A, 'Inválidos');
    const data = [{ name: 'X', phone: '123' }, { name: 'Y', phone: '20999999999' }, { name: 'Z', phone: '' }];
    const r1 = await importRows(A, s, 'inv.csv', data, 'f'.repeat(64));
    expect(r1.progress).toMatchObject({ invalid_rows: 3, new_contacts: 0 });
    await importRows(A, s, 'inv.csv', data, 'f'.repeat(64));
    expect(await count(A, `select count(*) n from contacts where dedup_key in ('raw:123','raw:20999999999')`)).toBe(2);
  });

  it('processamento simultâneo do mesmo job não cria duplicatas', async () => {
    const s = await createSource(A, 'Concorrência');
    const job = await as(A, async (c) => (await c.query(`select create_import_job($1,'c.csv','csv',1,$2,400,'{}') r`, [s, '1'.repeat(64)])).rows[0].r.job_id);
    const chunk = fakeRows(400, 5001).map((r, k) => toImportRow(job, k + 1, r.name, r.phone));
    await as(A, (c) => c.query(
      `insert into import_rows (job_id,row_number,name,original_phone,normalized_phone,phone_digits,country_code,area_code,national_number,line_type,validation_status,issues)
       select * from jsonb_to_recordset($1::jsonb) as x(job_id uuid,row_number int,name text,original_phone text,normalized_phone text,phone_digits text,country_code text,area_code text,national_number text,line_type text,validation_status text,issues text[])`,
      [JSON.stringify(chunk)]));
    await Promise.all([1, 2, 3, 4].map(() => as(A, (c) => c.query(`select process_import_batch($1, 100)`, [job]))));
    let p: any;
    do { p = await as(A, async (c) => (await c.query(`select process_import_batch($1, 500) p`, [job])).rows[0].p); } while (!p.done);
    expect(p).toMatchObject({ processed_rows: 400, new_contacts: 400 });
    expect(await count(A, `select count(*) n from contact_source_relations where import_job_id = $1`, [job])).toBe(400);
  });

  it('cancelar uma importação em andamento é seguro', async () => {
    const s = await createSource(A, 'Cancelada');
    const job = await as(A, async (c) => (await c.query(`select create_import_job($1,'x.csv','csv',1,$2,10,'{}') r`, [s, '2'.repeat(64)])).rows[0].r.job_id);
    await as(A, (c) => c.query(`select cancel_import_job($1)`, [job]));
    expect(await as(A, async (c) => (await c.query(`select status from import_jobs where id=$1`, [job])).rows[0].status)).toBe('cancelled');
  });

  describe('consentimento, supressão e convites (cenário 4)', () => {
    let contactId: string, groupId: string, campaignId: string, segmentId: string;

    beforeAll(async () => {
      contactId = await as(A, async (c) => (await c.query(`select id from contacts where normalized_phone = '+5584999999999'`)).rows[0].id);
      groupId = await as(A, async (c) => (await c.query(`insert into destination_groups (name, invite_url) values ('Grupo A', 'https://chat.whatsapp.com/AbCdEfGhIjK123') returning id`)).rows[0].id);
      segmentId = await as(A, async (c) => (await c.query(`insert into contact_segments (name, filter_definition) values ('DDD 84', '{"area_codes":["84"]}') returning id`)).rows[0].id);
      campaignId = await as(A, async (c) => (await c.query(`insert into invitation_campaigns (destination_group_id, segment_id, name, message_body) values ($1,$2,'Convite 1','Olá {{link}}') returning id`, [groupId, segmentId])).rows[0].id);
    });

    it('telefone num arquivo não é autorização: ninguém é elegível sem registro', async () => {
      const r = await as(A, async (c) => (await c.query(`select prepare_campaign($1) r`, [campaignId])).rows[0].r);
      expect(r).toMatchObject({ segment_total: 2, eligible: 0, prepared: 0 });
      await expect(as(A, (c) => c.query(`insert into invitation_events (campaign_id, contact_id, event_type) values ($1,$2,'shared')`, [campaignId, contactId]))).rejects.toThrow(/autoriza/);
    });

    it('autorização exige evidência', async () => {
      await expect(as(A, (c) => c.query(`select register_consent($1, 'authorized')`, [contactId]))).rejects.toThrow();
      await as(A, (c) => c.query(`select register_consent($1, 'authorized', 'group_invitation', 'form', 'Formulário 2026 #12')`, [contactId]));
      const r = await as(A, async (c) => (await c.query(`select prepare_campaign($1) r`, [campaignId])).rows[0].r);
      expect(r).toMatchObject({ eligible: 1, prepared: 1 });
      await as(A, (c) => c.query(`insert into invitation_events (campaign_id, contact_id, event_type) values ($1,$2,'shared')`, [campaignId, contactId]));
    });

    it('usuário não pode registrar "enviado por integração"', async () => {
      await expect(as(A, (c) => c.query(`insert into invitation_events (campaign_id, contact_id, event_type) values ($1,$2,'sent_via_integration')`, [campaignId, contactId]))).rejects.toThrow();
      await expect(as(A, (c) => c.query(`insert into invitation_events (campaign_id, contact_id, event_type, source) values ($1,$2,'sent_via_integration','integration')`, [campaignId, contactId]))).rejects.toThrow(/row-level security/);
    });

    it('revogação bloqueia novas comunicações e vai para a supressão', async () => {
      await as(A, (c) => c.query(`select register_consent($1, 'revoked')`, [contactId]));
      const st = await as(A, async (c) => (await c.query(`select consent_status, suppressed from contact_overview where id=$1`, [contactId])).rows[0]);
      expect(st).toEqual({ consent_status: 'revoked', suppressed: true });
      await expect(as(A, (c) => c.query(`insert into invitation_events (campaign_id, contact_id, event_type) values ($1,$2,'shared')`, [campaignId, contactId]))).rejects.toThrow(/autoriza/);
      const seg = await as(A, async (c) => (await c.query(`select segment_count('{"area_codes":["84"]}') r`)).rows[0].r);
      expect(seg.eligible).toBe(0);
      // reimportar o número não "limpa" a revogação
      const s = await createSource(A, 'Reimport revogado');
      await importRows(A, s, 'r.csv', [{ name: 'Maria', phone: '84 99999-9999' }], '3'.repeat(64));
      expect(await count(A, `select count(*) n from contacts where normalized_phone='+5584999999999' and consent_status='revoked'`)).toBe(1);
    });

    it('exportação nunca inclui revogados e fica registrada na auditoria', async () => {
      const rows = await as(A, async (c) => (await c.query(`select * from export_contacts('unique', '{"area_codes":["84"]}')`)).rows);
      expect(rows.map((r: any) => r.phone)).toEqual(['+5584988888888']);
      expect(await count(A, `select count(*) n from audit_logs where action='export.contacts'`)).toBe(1);
    });

    it('LGPD: exportar dados do titular e excluir (anonimiza + supressão)', async () => {
      const other = await as(A, async (c) => (await c.query(`select id from contacts where normalized_phone = '+5584988888888'`)).rows[0].id);
      const data = await as(A, async (c) => (await c.query(`select contact_personal_data($1) d`, [other])).rows[0].d);
      expect(data.contact.phone).toBe('+5584988888888');
      expect(data.sources).toHaveLength(2);
      await as(A, (c) => c.query(`select request_contact_deletion($1)`, [other]));
      const after = await as(A, async (c) => (await c.query(`select name, normalized_phone, validation_status from contacts where id=$1`, [other])).rows[0]);
      expect(after).toEqual({ name: null, normalized_phone: null, validation_status: 'erased' });
      expect(await count(A, `select count(*) n from suppression_list where dedup_key='+5584988888888' and reason='deletion_request'`)).toBe(1);
    });

    it('dashboard lê números reais do banco', async () => {
      const dsh = await as(A, async (c) => (await c.query(`select dashboard_overview(30) d`)).rows[0].d);
      expect(dsh.kpis.unique_contacts).toBeGreaterThanOrEqual(2200);
      expect(dsh.kpis.invites_shared).toBe(1);
      expect(dsh.by_source.length).toBeGreaterThan(0);
      expect(dsh.recent_activity.length).toBeGreaterThan(0);
    });
  });

  describe('isolamento multiusuário (cenário 5)', () => {
    it('usuário B não vê nenhum dado do usuário A', async () => {
      for (const t of ['contacts', 'contact_sources', 'import_jobs', 'contact_source_relations', 'consent_records', 'suppression_list', 'audit_logs', 'contact_overview', 'invitation_campaigns']) {
        expect(await count(B, `select count(*) n from ${t}`), t).toBe(0);
      }
      const dsh = await as(B, async (c) => (await c.query(`select dashboard_overview(30) d`)).rows[0].d);
      expect(dsh.kpis.total_contacts).toBe(0);
    });

    it('usuário B não altera nem processa dados de A', async () => {
      const contactA = await as(A, async (c) => (await c.query(`select id from contacts limit 1`)).rows[0].id);
      const jobA = await as(A, async (c) => (await c.query(`select id from import_jobs limit 1`)).rows[0].id);
      const upd = await as(B, (c) => c.query(`update contacts set name='hack' where id=$1`, [contactA]));
      expect(upd.rowCount).toBe(0);
      await expect(as(B, (c) => c.query(`select process_import_batch($1)`, [jobA]))).rejects.toThrow(/não encontrado/);
      await expect(as(B, (c) => c.query(`select contact_personal_data($1)`, [contactA]))).rejects.toThrow(/não encontrado/);
      await expect(as(B, (c) => c.query(`select register_consent($1,'revoked')`, [contactA]))).rejects.toThrow(/não encontrado/);
      await expect(as(B, (c) => c.query(`select request_contact_deletion($1)`, [contactA]))).rejects.toThrow(/não encontrado/);
      await expect(as(B, (c) => c.query(`insert into import_rows (job_id,row_number,validation_status) values ($1, 999999,'empty')`, [jobA]))).rejects.toThrow(/row-level security/);
      await expect(as(B, (c) => c.query(`insert into contact_sources (user_id, name) values ($1,'invasão')`, [A]))).rejects.toThrow(/row-level security/);
    });

    it('anon não acessa nada e authenticated não insere contato direto', async () => {
      await expect(as(null, (c) => c.query(`select count(*) from contacts`), 'anon')).rejects.toThrow(/permission denied/);
      await expect(as(null, (c) => c.query(`select dashboard_overview()`), 'anon')).rejects.toThrow(/permission denied/);
      await expect(as(A, (c) => c.query(`insert into contacts (dedup_key, validation_status) values ('raw:1','invalid')`))).rejects.toThrow(/permission denied/);
      await expect(as(A, (c) => c.query(`update contacts set consent_status='authorized'`))).rejects.toThrow(/permission denied/);
      await expect(as(A, (c) => c.query(`delete from audit_logs`))).rejects.toThrow(/permission denied/);
    });

    it('storage: cada usuário só usa a própria pasta', async () => {
      await as(A, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('imports', $1)`, [`${A}/arquivo.csv`]));
      await expect(as(B, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('imports', $1)`, [`${A}/invasao.csv`]))).rejects.toThrow(/row-level security/);
      expect(await count(B, `select count(*) n from storage.objects`)).toBe(0);
      expect(await count(A, `select count(*) n from storage.objects`)).toBe(1);
    });
  });
});
