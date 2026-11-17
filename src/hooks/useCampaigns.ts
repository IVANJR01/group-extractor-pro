import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Campaign, InvitationEventType, MessageTemplate } from '@/types/db';

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('invitation_campaigns').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['campaign', id],
    enabled: !!id,
    queryFn: async () => {
      const [c, s] = await Promise.all([
        supabase.from('invitation_campaigns').select('*').eq('id', id!).single(),
        supabase.rpc('campaign_summary', { p_campaign_id: id }),
      ]);
      if (c.error) throw c.error;
      if (s.error) throw s.error;
      return { campaign: c.data as Campaign, summary: s.data as Partial<Record<InvitationEventType, number>> };
    },
  });
}

export interface CampaignContact { contact_id: string; name: string | null; normalized_phone: string | null; area_code: string | null; consent_status: string; last_event_type: InvitationEventType; last_event_at: string; eligible: boolean }

export function useCampaignContacts(id: string | undefined, page: number, pageSize = 25) {
  return useQuery({
    queryKey: ['campaign-contacts', id, page],
    enabled: !!id,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase.rpc('campaign_contacts', { p_campaign_id: id }, { count: 'exact' }).range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { rows: data as CampaignContact[], total: count ?? 0 };
    },
  });
}

export function useRecordEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { campaignId: string; contactId: string; type: InvitationEventType; metadata?: Record<string, unknown> }) => {
      const { error } = await supabase.from('invitation_events').insert({ campaign_id: e.campaignId, contact_id: e.contactId, event_type: e.type, event_metadata: e.metadata ?? {} });
      if (error) throw error;
    },
    onSuccess: (_d, e) => {
      qc.invalidateQueries({ queryKey: ['campaign', e.campaignId] });
      qc.invalidateQueries({ queryKey: ['campaign-contacts', e.campaignId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('message_templates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as MessageTemplate[];
    },
  });
}
