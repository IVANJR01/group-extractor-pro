import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cleanFilter } from './useContacts';
import type { Segment, SegmentFilter } from '@/types/db';

export function useSegments() {
  return useQuery({
    queryKey: ['segments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contact_segments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Segment[];
    },
  });
}

export function useSaveSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: { id?: string; name: string; description?: string | null; filter_definition: SegmentFilter }) => {
      const v = { name: s.name, description: s.description ?? null, filter_definition: cleanFilter(s.filter_definition) };
      const res = s.id ? await supabase.from('contact_segments').update(v).eq('id', s.id) : await supabase.from('contact_segments').insert(v);
      if (res.error) throw res.error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}

export function useDeleteSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('contact_segments').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['segments'] }),
  });
}
