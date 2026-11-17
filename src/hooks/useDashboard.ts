import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DashboardData } from '@/types/db';

export function useDashboard(days = 30) {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_overview', { p_days: days });
      if (error) throw error;
      return data as DashboardData;
    },
  });
}
