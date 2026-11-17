/**
 * Página de inscrição (opt-in): acesso anônimo restrito, consentimento com evidência,
 * deduplicação, bloqueios respeitados e limites contra abuso.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
let pool: pg.Pool;
const A = randomUUID();
const B = randomUUID();

async function as<T>(uid: string | null, fn: (c: pg.PoolClient) => Promise<T>, role = 'authenticated', ip?: string): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('role', $1, true)`, [role]);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(ip ? { 'x-forwarded-for': ip } : {})]);
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
const anon = <T>(fn: (c: pg.PoolClient) => Promise<T>, ip = '10.0.0.1') => as(null, fn, 'anon', ip);
const submit = (slug: string, name: string, phone: string, consent = true, ip?: string) =>
  anon(async (c) => (await c.query(`select submit_signup($1,$2,$3,$4,'teste') r`, [slug, name, phone, consent])).rows[0].r, ip);
const CONSENT = 'Autorizo receber o convite do grupo e comunicações relacionadas. Posso cancelar quando quiser.';

d('página de inscrição', () => {
  let slug: string;
  let groupId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(`insert into auth.users (id, email) values ($1, 'sa@teste.local'), ($2, 'sb@teste.local')`, [A, B]);
    groupId = await as(A, async (c) => (await c.query(
      `insert into destination_groups (name, invite_url) values ('Grupo A', 'https://chat.whatsapp.com/AbCdEfGhIjKlMn') returning id`)).rows[0].id);
    const f = await as(A, async (c) => (await c.query(
      `select * from create_signup_form('Grupo VIP Segurança', 'Ivan Treinamentos', $1, 'Dicas semanais', $2)`, [CONSENT, groupId])).rows[0]);
    slug = f.slug;
  });
  afterAll(async () => pool?.end());

  it('anônimo vê só os dados públicos da página ativa', async () => {
    const page = await anon(async (c) => (await c.query(`select get_signup_form($1) r`, [slug])).rows[0].r);
    expect(page).toMatchObject({ title: 'Grupo VIP Segurança', organizer_name: 'Ivan Treinamentos', group_name: 'Grupo A' });
    expect(JSON.stringify(page)).not.toMatch(/chat\.whatsapp|user_id/);
    await expect(anon((c) => c.query(`select * from signup_forms`))).rejects.toThrow(/permission denied/);
    await expect(anon((c) => c.query(`select * from contacts`))).rejects.toThrow(/permission denied/);
    expect(await anon(async (c) => (await c.query(`select get_signup_form('naoexiste123') r`)).rows[0].r)).toBeNull();
  });

  it('inscrição cria contato autorizado com evidência e devolve o link do grupo', async () => {
    const r = await submit(slug, 'Maria Souza', '+5584999990001');
    expect(r).toMatchObject({ ok: true, group_name: 'Grupo A', invite_url: 'https://chat.whatsapp.com/AbCdEfGhIjKlMn' });
    const c = await as(A, async (cl) => (await cl.query(`select * from contact_overview where normalized_phone='+5584999990001'`)).rows[0]);
    expect(c).toMatchObject({ name: 'Maria Souza', consent_status: 'authorized', uf: 'RN', occurrences: 1 });
    const cr = await as(A, async (cl) => (await cl.query(`select * from consent_records where contact_id=$1`, [c.id])).rows[0]);
    expect(cr).toMatchObject({ status: 'authorized', collection_method: 'form' });
    expect(cr.evidence_reference).toContain(`signup:${slug}`);
    const occ = await as(A, async (cl) => (await cl.query(`select * from contact_occurrences($1)`, [c.id])).rows);
    expect(occ[0].file_name).toBe('Página de inscrição');
  });

  it('mesmo telefone não duplica e contato importado antes passa a autorizado', async () => {
    await submit(slug, 'Maria Souza', '+5584999990001');
    expect(Number((await as(A, (c) => c.query(`select count(*) n from contacts where dedup_key='+5584999990001'`))).rows[0].n)).toBe(1);
    expect(Number((await as(A, (c) => c.query(`select count(*) n from signup_submissions where phone='+5584999990001'`))).rows[0].n)).toBe(2);
  });

  it('exige autorização marcada, nome e celular válido', async () => {
    await expect(submit(slug, 'João', '+5584999990002', false)).rejects.toThrow(/autorização/);
    await expect(submit(slug, '', '+5584999990002')).rejects.toThrow(/nome/);
    await expect(submit(slug, 'João', '+558499990002')).rejects.toThrow(/celular válido/);
    await expect(submit(slug, 'João', '+5520999990002')).rejects.toThrow(/DDD/);
    await expect(submit(slug, 'João', '84999990002')).rejects.toThrow(/celular válido/);
  });

  it('contato bloqueado não é reautorizado nem recebe o link', async () => {
    await submit(slug, 'Pedro', '+5584999990003');
    const id = (await as(A, (c) => c.query(`select id from contacts where dedup_key='+5584999990003'`))).rows[0].id;
    await as(A, (c) => c.query(`select block_contact($1,'complaint')`, [id]));
    const r = await submit(slug, 'Pedro', '+5584999990003');
    expect(r.invite_url).toBeNull();
    const st = (await as(A, (c) => c.query(`select consent_status, suppressed from contact_overview where id=$1`, [id]))).rows[0];
    expect(st.suppressed).toBe(true);
    expect(st.consent_status).not.toBe('authorized');
  });

  it('página pausada não aceita inscrições', async () => {
    const f2 = await as(A, async (c) => (await c.query(`select * from create_signup_form('Pausada', 'Ivan', $1)`, [CONSENT])).rows[0]);
    await as(A, (c) => c.query(`update signup_forms set status='paused' where id=$1`, [f2.id]));
    await expect(submit(f2.slug, 'Ana', '+5584999990004')).rejects.toThrow(/indisponível/);
  });

  it('limite por aparelho (IP) contra abuso', async () => {
    for (let i = 0; i < 10; i++) await submit(slug, `Pessoa ${i}`, `+55849999911${String(i).padStart(2, '0')}`, true, '10.9.9.9');
    await expect(submit(slug, 'Mais uma', '+5584999991199', true, '10.9.9.9')).rejects.toThrow(/Muitas inscrições/);
    const ipHash = (await as(A, (c) => c.query(`select ip_hash from signup_submissions where ip_hash is not null limit 1`))).rows[0].ip_hash;
    expect(ipHash).not.toContain('10.9');
  });

  it('usuário B não vê nem altera páginas de A, nem aponta para grupo alheio', async () => {
    expect(Number((await as(B, (c) => c.query(`select count(*) n from signup_forms`))).rows[0].n)).toBe(0);
    expect(Number((await as(B, (c) => c.query(`select count(*) n from signup_submissions`))).rows[0].n)).toBe(0);
    const upd = await as(B, (c) => c.query(`update signup_forms set title='hack' where slug=$1`, [slug]));
    expect(upd.rowCount).toBe(0);
    await expect(as(B, (c) => c.query(`select create_signup_form('X página', 'B', $1, null, $2)`, [CONSENT, groupId]))).rejects.toThrow(/Grupo de destino inválido/);
    await expect(as(A, (c) => c.query(`update signup_forms set slug='outroslug1' where slug=$1`, [slug]))).rejects.toThrow(/permission denied/);
  });
});
