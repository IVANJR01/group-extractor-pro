import type { Page, Route } from '@playwright/test';

/** Backend simulado do Supabase para testes de interface (dados de teste fictícios). */
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'teste@exemplo.com', aud: 'authenticated', role: 'authenticated' };
const SRC = [
  { id: 'src-x', name: 'Grupo X', source_type: 'group', description: null, status: 'active', created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z' },
  { id: 'src-y', name: 'Grupo Y', source_type: 'group', description: null, status: 'active', created_at: '2026-11-11T10:00:00Z', updated_at: '2026-11-11T10:00:00Z' },
];
const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10));
export const DASHBOARD = {
  kpis: { total_contacts: 2203, imported_this_month: 2500, unique_contacts: 2200, duplicate_occurrences: 300, invalid_contacts: 3, authorized: 120, without_consent: 2075, blocked_or_revoked: 8, invites_shared: 42, joins_confirmed: 17 },
  imports_by_day: days.map((d, i) => ({ day: d, rows: i === 27 ? 1000 : i === 28 ? 1000 : i === 29 ? 500 : 0, new: i === 27 ? 1000 : i === 28 ? 700 : i === 29 ? 500 : 0 })),
  by_source: [{ source: 'Grupo X', contacts: 1000 }, { source: 'Grupo Y', contacts: 1000 }, { source: 'Lista Excel', contacts: 500 }],
  by_ddd: [{ ddd: '11', contacts: 1400 }, { ddd: '84', contacts: 600 }, { ddd: '21', contacts: 200 }],
  duplicates_by_import: [{ file: 'grupo-x.csv', duplicates: 0, at: '2026-11-15' }, { file: 'grupo-y.csv', duplicates: 300, at: '2026-11-16' }, { file: 'lista.xlsx', duplicates: 0, at: '2026-11-17' }],
  joins_by_day: days.map((d, i) => ({ day: d, shared: i > 24 ? 8 : 0, joined: i > 25 ? 4 : 0 })),
  consent_distribution: [{ status: 'pending', contacts: 2075 }, { status: 'authorized', contacts: 120 }, { status: 'revoked', contacts: 5 }, { status: 'blocked', contacts: 3 }],
  recent_activity: [{ action: 'import.completed', entity_type: 'import_job', entity_id: null, metadata: {}, created_at: '2026-11-17T05:00:00Z' }],
};
const CONTACTS = Array.from({ length: 25 }, (_, i) => ({
  id: `c-${i}`, name: i % 7 === 0 ? null : `Pessoa Teste ${i + 1}`, original_phone: `(84) 97000-00${String(i).padStart(2, '0')}`,
  normalized_phone: `+55849700000${String(i).padStart(2, '0')}`, country_code: '55', area_code: '84', uf: 'RN', national_number: '', line_type: 'mobile',
  validation_status: 'valid', validation_issues: [], name_conflicts: i === 3 ? ['Outro Nome'] : [], consent_status: i % 5 === 0 ? 'authorized' : 'pending',
  consent_updated_at: null, first_source_id: 'src-x', created_at: '2026-11-17T05:00:00Z', updated_at: '2026-11-17T05:00:00Z',
  source_ids: i % 4 === 0 ? ['src-x', 'src-y'] : ['src-x'], occurrences: i % 4 === 0 ? 2 : 1, suppressed: false, last_event_type: null, last_event_at: null, campaign_ids: [],
}));

export interface MockState { processed: number; total: number; uploaded: number }

export async function mockBackend(page: Page, opts: { loggedIn?: boolean } = {}) {
  const state: MockState = { processed: 0, total: 0, uploaded: 0 };
  if (opts.loggedIn !== false) {
    const session = { access_token: 'e2e', refresh_token: 'e2e', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER };
    await page.addInitScript((s) => localStorage.setItem('sb-e2e-mock-auth-token', JSON.stringify(s)), session);
  }
  const json = (route: Route, body: unknown, headers: Record<string, string> = {}, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) });

  await page.route('https://e2e-mock.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.startsWith('/auth/v1/user')) return json(route, USER);
    if (p.startsWith('/auth/v1/')) return json(route, {});
    if (p.startsWith('/storage/v1/')) return json(route, { Key: 'imports/x' });
    const rpc = p.match(/\/rest\/v1\/rpc\/(\w+)/)?.[1];
    const body = req.postDataJSON?.() ?? {};
    if (rpc === 'dashboard_overview') return json(route, DASHBOARD);
    if (rpc === 'segment_contacts') return json(route, CONTACTS, { 'content-range': `0-24/2203` });
    if (rpc === 'segment_count') return json(route, { total: 600, eligible: 120, without_consent: 480, invalid: 0 });
    if (rpc === 'group_stats') return json(route, []);
    if (rpc === 'create_import_job') { state.total = body.p_total_rows; return json(route, { job_id: 'job-1', previous_job_id: null }); }
    if (rpc === 'process_import_batch') {
      state.processed = state.uploaded;
      const done = state.processed >= state.total;
      return json(route, { status: done ? 'completed' : 'processing', done, total_rows: state.total, uploaded_rows: state.uploaded, processed_rows: state.processed, valid_rows: state.processed - 1, invalid_rows: 1, duplicate_rows: 1, new_contacts: state.processed - 2, name_conflicts: 0 });
    }
    if (rpc) return json(route, []);
    if (p.endsWith('/import_rows') && req.method() === 'POST') { state.uploaded += (body as unknown[]).length; return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } }); }
    if (p.endsWith('/contact_sources')) return json(route, req.method() === 'GET' ? SRC : SRC[0]);
    if (p.endsWith('/profiles')) return json(route, url.searchParams.get('select') ? { full_name: 'Teste', email: USER.email } : []);
    return json(route, [], { 'content-range': '*/0' });
  });
  return state;
}
