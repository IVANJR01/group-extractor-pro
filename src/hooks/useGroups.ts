import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DestinationGroup } from '@/types/db';

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('destination_groups').select('*').order('created_at');
      if (error) throw error;
      return data as DestinationGroup[];
    },
  });
}
