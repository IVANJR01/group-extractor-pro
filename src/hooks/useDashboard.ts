import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DashboardData } from '@/types/db';

const EMPTY_DASHBOARD: DashboardData = {
  kpis: {
    total_contacts: 0,
    imported_this_month: 0,
    unique_contacts: 0,
    duplicate_occurrences: 0,
    invalid_contacts: 0,
    authorized: 0,
    without_consent: 0,
    blocked_or_revoked: 0,
    invites_shared: 0,
    joins_confirmed: 0,
  },
  imports_by_day: [],
  by_source: [],
  by_ddd: [],
  duplicates_by_import: [],
  joins_by_day: [],
  consent_distribution: [],
  recent_activity: [],
};

export function useDashboard(days = 30) {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc('dashboard_overview', { p_days: days });
        if (error || !data) return EMPTY_DASHBOARD;
        return data as DashboardData;
      } catch {
        return EMPTY_DASHBOARD;
      }
    },
  });
}
