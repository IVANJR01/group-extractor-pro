-- =====================================================================
-- Consentimento (LGPD), supressão, grupos de destino, segmentos,
-- campanhas e eventos de convite
-- =====================================================================

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  purpose text not null default 'group_invitation'
    check (purpose in ('group_invitation', 'marketing', 'service', 'other')),
  status text not null check (status in ('authorized', 'revoked', 'pending')),
  collection_method text
    check (collection_method in ('form', 'written', 'opt_in_message', 'verbal_recorded', 'event_signup', 'other')),
  evidence_reference text check (char_length(evidence_reference) <= 300),
  campaign_id uuid,
  obtained_at timestamptz,
  revoked_at timestamptz,
  notes text check (char_length(notes) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint consent_authorized_needs_evidence
    check (status <> 'authorized' or (collection_method is not null and obtained_at is not null and evidence_reference is not null)),
  constraint consent_revoked_needs_date check (status <> 'revoked' or revoked_at is not null)
);
create index consent_records_contact_idx on public.consent_records (contact_id, purpose, created_at desc);

create table public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dedup_key text not null check (char_length(dedup_key) between 1 and 80),
  reason text not null check (reason in ('revoked', 'opt_out', 'deletion_request', 'manual_block', 'complaint')),
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  constraint suppression_user_key_uniq unique (user_id, dedup_key)
);

create table public.destination_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 500),
  -- Apenas links de convite oficiais do WhatsApp fornecidos pelo administrador.
  invite_url text check (invite_url ~ '^https://chat\.whatsapp\.com/(invite/)?[A-Za-z0-9]{10,64}$'),
  invite_link_status text not null default 'active' check (invite_link_status in ('active', 'disabled')),
  invite_link_updated_at timestamptz,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index destination_groups_user_name_uniq on public.destination_groups (user_id, lower(btrim(name)));
create trigger destination_groups_updated_at before update on public.destination_groups
  for each row execute function public.set_updated_at();

create table public.contact_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 500),
  filter_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(filter_definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contact_segments_user_name_uniq on public.contact_segments (user_id, lower(btrim(name)));
create trigger contact_segments_updated_at before update on public.contact_segments
  for each row execute function public.set_updated_at();

create table public.destination_group_segments (
  destination_group_id uuid not null references public.destination_groups (id) on delete cascade,
  segment_id uuid not null references public.contact_segments (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (destination_group_id, segment_id)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000 and position('{{link}}' in body) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

create table public.invitation_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  destination_group_id uuid not null references public.destination_groups (id) on delete restrict,
  segment_id uuid references public.contact_segments (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  message_body text not null check (char_length(message_body) between 1 and 2000),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  eligible_count integer not null default 0,
  excluded_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index invitation_campaigns_user_idx on public.invitation_campaigns (user_id, created_at desc);
create trigger invitation_campaigns_updated_at before update on public.invitation_campaigns
  for each row execute function public.set_updated_at();

alter table public.consent_records
  add constraint consent_records_campaign_fk foreign key (campaign_id) references public.invitation_campaigns (id) on delete set null;

create table public.invitation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.invitation_campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  event_type text not null check (event_type in (
    'prepared',              -- convite preparado
    'shared',                -- usuário abriu o compartilhamento (não prova envio)
    'sent_via_integration',  -- enviado por integração oficial
    'delivery_confirmed',    -- entrega confirmada pela integração
    'join_confirmed',        -- entrada confirmada (evidência registrada)
    'no_confirmation',       -- sem confirmação
    'declined',              -- recusado
    'opt_out'                -- pediu para não receber
  )),
  source text not null default 'user' check (source in ('user', 'integration')),
  event_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(event_metadata) = 'object'),
  recorded_by uuid default auth.uid(),
  occurred_at timestamptz not null default now(),
  -- Eventos de envio/entrega só podem vir de integração oficial
  constraint invitation_events_integration_only
    check (event_type not in ('sent_via_integration', 'delivery_confirmed') or source = 'integration')
);
create index invitation_events_campaign_idx on public.invitation_events (campaign_id, occurred_at desc);
create index invitation_events_contact_idx on public.invitation_events (contact_id, occurred_at desc);
create index invitation_events_user_type_idx on public.invitation_events (user_id, event_type, occurred_at);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.consent_records enable row level security;
alter table public.suppression_list enable row level security;
alter table public.destination_groups enable row level security;
alter table public.contact_segments enable row level security;
alter table public.destination_group_segments enable row level security;
alter table public.message_templates enable row level security;
alter table public.invitation_campaigns enable row level security;
alter table public.invitation_events enable row level security;

-- consent_records: somente leitura e inserção (histórico imutável)
create policy consent_select on public.consent_records for select to authenticated using (user_id = (select auth.uid()));
create policy consent_insert on public.consent_records for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid())));

-- suppression_list: ler e incluir; remover só por função dedicada (não existe por padrão)
create policy suppression_select on public.suppression_list for select to authenticated using (user_id = (select auth.uid()));
create policy suppression_insert on public.suppression_list for insert to authenticated with check (user_id = (select auth.uid()));

create policy dg_select on public.destination_groups for select to authenticated using (user_id = (select auth.uid()));
create policy dg_insert on public.destination_groups for insert to authenticated with check (user_id = (select auth.uid()));
create policy dg_update on public.destination_groups for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy seg_select on public.contact_segments for select to authenticated using (user_id = (select auth.uid()));
create policy seg_insert on public.contact_segments for insert to authenticated with check (user_id = (select auth.uid()));
create policy seg_update on public.contact_segments for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy seg_delete on public.contact_segments for delete to authenticated using (user_id = (select auth.uid()));

create policy dgs_select on public.destination_group_segments for select to authenticated using (user_id = (select auth.uid()));
create policy dgs_insert on public.destination_group_segments for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.destination_groups g where g.id = destination_group_id and g.user_id = (select auth.uid()))
    and exists (select 1 from public.contact_segments s where s.id = segment_id and s.user_id = (select auth.uid())));
create policy dgs_delete on public.destination_group_segments for delete to authenticated using (user_id = (select auth.uid()));

create policy mt_select on public.message_templates for select to authenticated using (user_id = (select auth.uid()));
create policy mt_insert on public.message_templates for insert to authenticated with check (user_id = (select auth.uid()));
create policy mt_update on public.message_templates for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mt_delete on public.message_templates for delete to authenticated using (user_id = (select auth.uid()));

create policy ic_select on public.invitation_campaigns for select to authenticated using (user_id = (select auth.uid()));
create policy ic_insert on public.invitation_campaigns for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.destination_groups g where g.id = destination_group_id and g.user_id = (select auth.uid())));
create policy ic_update on public.invitation_campaigns for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ie_select on public.invitation_events for select to authenticated using (user_id = (select auth.uid()));
-- Usuário só registra eventos de origem 'user'; eventos de integração vêm do servidor (service_role).
create policy ie_insert on public.invitation_events for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'user'
    and exists (select 1 from public.invitation_campaigns c where c.id = campaign_id and c.user_id = (select auth.uid()))
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid())));
