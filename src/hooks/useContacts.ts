import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ContactOverview, SegmentFilter } from '@/types/db';

/** Remove chaves vazias para o servidor não receber filtros inúteis. */
export function cleanFilter(f: SegmentFilter): SegmentFilter {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false) continue;
    out[k] = v;
  }
  return out as SegmentFilter;
}

/** Paginação no servidor: nunca carrega milhares de registros no navegador. */
export function useContacts(filter: SegmentFilter, page: number, pageSize = 25) {
  return useQuery({
    queryKey: ['contacts', filter, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = page * pageSize;
      const { data, error, count } = await supabase
        .rpc('segment_contacts', { p_filter: cleanFilter(filter) }, { count: 'exact' })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      return { rows: (data ?? []) as ContactOverview[], total: count ?? 0 };
    },
  });
}

export function useSegmentCount(filter: SegmentFilter, enabled = true) {
  return useQuery({
    queryKey: ['segment-count', filter],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('segment_count', { p_filter: cleanFilter(filter) });
      if (error) throw error;
      return data as { total: number; eligible: number; without_consent: number; invalid: number };
    },
  });
}

export function useContactDetail(id: string | null) {
  return useQuery({
    queryKey: ['contact', id],
    enabled: !!id,
    queryFn: async () => {
      const [c, occ, consents, events] = await Promise.all([
        supabase.from('contact_overview').select('*').eq('id', id!).maybeSingle(),
        supabase.rpc('contact_occurrences', { p_contact_id: id }),
        supabase.from('consent_records').select('*').eq('contact_id', id!).order('created_at', { ascending: false }),
        supabase.from('invitation_events').select('id, event_type, source, occurred_at, campaign_id').eq('contact_id', id!).order('occurred_at', { ascending: false }).limit(50),
      ]);
      for (const r of [c, occ, consents, events]) if (r.error) throw r.error;
      return {
        contact: c.data as ContactOverview | null,
        occurrences: occ.data as { source_name: string; file_name: string; row_number: number; original_name: string | null; original_phone: string | null; imported_at: string }[],
        consents: consents.data as { id: string; purpose: string; status: string; collection_method: string | null; evidence_reference: string | null; obtained_at: string | null; revoked_at: string | null; created_at: string }[],
        events: events.data as { id: string; event_type: string; source: string; occurred_at: string }[],
      };
    },
  });
}

export function useContactAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a:
      | { kind: 'consent'; ids: string[]; status: 'authorized' | 'revoked'; method?: string; evidence?: string; obtainedAt?: string; notes?: string }
      | { kind: 'block' | 'unblock' | 'delete'; ids: string[] }
      | { kind: 'edit'; id: string; name: string | null; notes: string | null }
      | { kind: 'resolve-name'; id: string; name: string }) => {
      const run = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) throw error; };
      if (a.kind === 'edit') return run(supabase.from('contacts').update({ name: a.name, notes: a.notes }).eq('id', a.id));
      if (a.kind === 'resolve-name') return run(supabase.rpc('resolve_name_conflict', { p_contact_id: a.id, p_name: a.name }));
      for (const id of a.ids) {
        if (a.kind === 'consent') {
          await run(supabase.rpc('register_consent', {
            p_contact_id: id, p_status: a.status, p_purpose: 'group_invitation',
            p_collection_method: a.method ?? null, p_evidence_reference: a.evidence ?? null,
            p_obtained_at: a.obtainedAt ? new Date(a.obtainedAt).toISOString() : null, p_notes: a.notes ?? null,
          }));
        } else if (a.kind === 'block') await run(supabase.rpc('block_contact', { p_contact_id: id }));
        else if (a.kind === 'unblock') await run(supabase.rpc('unblock_contact', { p_contact_id: id }));
        else if (a.kind === 'delete') await run(supabase.rpc('request_contact_deletion', { p_contact_id: id }));
      }
    },
    onSuccess: () => { ['contacts', 'contact', 'segment-count', 'dashboard', 'duplicates'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
}

export async function downloadPersonalData(id: string) {
  const { data, error } = await supabase.rpc('contact_personal_data', { p_contact_id: id });
  if (error) throw error;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dados-titular-${id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
