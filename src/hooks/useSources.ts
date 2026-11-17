import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ContactSource, SourceType } from '@/types/db';

export function useSources(includeArchived = false) {
  return useQuery({
    queryKey: ['sources', includeArchived],
    queryFn: async () => {
      let q = supabase.from('contact_sources').select('*').order('created_at', { ascending: false });
      if (!includeArchived) q = q.eq('status', 'active');
      const { data, error } = await q;
      if (error) throw error;
      return data as ContactSource[];
    },
  });
}

/** Quantidade de contatos (distintos) e ocorrências por origem. */
export function useSourceStats() {
  return useQuery({
    queryKey: ['source-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_overview', { p_days: 1 });
      if (error) throw error;
      return (data as { by_source: { source: string; contacts: number }[] }).by_source;
    },
  });
}

export interface SourceInput { name: string; source_type: SourceType; description?: string | null }

export function useSaveSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...v }: SourceInput & { id?: string; status?: 'active' | 'archived' }) => {
      const res = id
        ? await supabase.from('contact_sources').update(v).eq('id', id).select().single()
        : await supabase.from('contact_sources').insert(v).select().single();
      if (res.error) throw res.error;
      return res.data as ContactSource;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sources'] }); qc.invalidateQueries({ queryKey: ['source-stats'] }); },
  });
}
