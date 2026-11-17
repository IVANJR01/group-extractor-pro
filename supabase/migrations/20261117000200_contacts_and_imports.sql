-- =====================================================================
-- Origens, contatos, importações e relação contato × origem
-- =====================================================================

create table public.contact_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  source_type text not null default 'group'
    check (source_type in ('group', 'customer_list', 'authorized_list', 'form', 'manual', 'other')),
  description text check (char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index contact_sources_user_name_uniq on public.contact_sources (user_id, lower(btrim(name)));
create index contact_sources_user_idx on public.contact_sources (user_id, created_at desc);
create trigger contact_sources_updated_at before update on public.contact_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id uuid not null references public.contact_sources (id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_type text not null check (file_type in ('csv', 'xlsx', 'xls', 'txt', 'manual')),
  file_size bigint check (file_size >= 0),
  file_hash text check (file_hash ~ '^[0-9a-f]{64}$'),
  storage_path text,
  column_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(column_mapping) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'processing', 'completed', 'failed', 'cancelled')),
  total_rows integer not null default 0 check (total_rows >= 0),
  uploaded_rows integer not null default 0 check (uploaded_rows >= 0),
  processed_rows integer not null default 0 check (processed_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  new_contacts integer not null default 0 check (new_contacts >= 0),
  name_conflicts integer not null default 0 check (name_conflicts >= 0),
  error_details jsonb not null default '[]'::jsonb check (jsonb_typeof(error_details) = 'array'),
  attempts integer not null default 0,
  cancel_requested boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_jobs_user_created_idx on public.import_jobs (user_id, created_at desc);
create index import_jobs_user_hash_idx on public.import_jobs (user_id, file_hash);
create index import_jobs_source_idx on public.import_jobs (source_id);
create trigger import_jobs_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Contato consolidado: 1 por telefone normalizado por dono.
-- dedup_key = telefone normalizado, ou 'raw:<dígitos>' para números
-- inválidos/incompletos (evita duplicar inválidos em reimportações).
-- ---------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 200),
  original_phone text check (char_length(original_phone) <= 60),
  normalized_phone text check (normalized_phone ~ '^\+[1-9][0-9]{7,14}$'),
  dedup_key text not null check (char_length(dedup_key) between 1 and 80),
  country_code text check (country_code ~ '^[0-9]{1,3}$'),
  area_code text check (area_code ~ '^[0-9]{2}$'),
  national_number text check (national_number ~ '^[0-9]{4,15}$'),
  line_type text check (line_type in ('mobile', 'landline', 'other')),
  validation_status text not null
    check (validation_status in ('valid', 'foreign', 'needs_review', 'incomplete', 'invalid_area_code', 'invalid', 'erased')),
  validation_issues text[] not null default '{}',
  name_conflicts text[] not null default '{}',
  consent_status text not null default 'pending' check (consent_status in ('pending', 'authorized', 'revoked', 'blocked')),
  consent_updated_at timestamptz,
  first_source_id uuid references public.contact_sources (id) on delete set null,
  first_import_job_id uuid references public.import_jobs (id) on delete set null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Telefone normalizado existe se, e somente se, o número é utilizável
  constraint contacts_normalized_matches_status
    check ((validation_status in ('valid', 'foreign')) = (normalized_phone is not null)),
  constraint contacts_dedup_key_matches
    check (normalized_phone is null or dedup_key = normalized_phone)
);
create unique index contacts_user_dedup_uniq on public.contacts (user_id, dedup_key);
create index contacts_user_created_idx on public.contacts (user_id, created_at desc);
create index contacts_user_area_idx on public.contacts (user_id, area_code);
create index contacts_user_consent_idx on public.contacts (user_id, consent_status);
create index contacts_user_validation_idx on public.contacts (user_id, validation_status);
create index contacts_name_search_idx on public.contacts using gin (to_tsvector('simple', coalesce(name, '')));
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- Validação no servidor: DDD brasileiro precisa existir
create or replace function public.contacts_validate_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.validation_status = 'valid' then
    if new.country_code is distinct from '55'
       or new.area_code is null
       or not exists (select 1 from public.br_area_codes a where a.code = new.area_code)
       or new.normalized_phone <> '+55' || new.national_number
       or left(new.national_number, 2) <> new.area_code then
      raise exception 'Telefone brasileiro inconsistente' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger contacts_validate_phone before insert or update on public.contacts
  for each row execute function public.contacts_validate_phone();

-- ---------------------------------------------------------------------
-- Cada ocorrência do contato em uma origem (nunca apagada na deduplicação)
-- ---------------------------------------------------------------------
create table public.contact_source_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  source_id uuid not null references public.contact_sources (id) on delete restrict,
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number integer not null check (row_number > 0),
  original_name text check (char_length(original_name) <= 200),
  original_phone text check (char_length(original_phone) <= 60),
  imported_at timestamptz not null default now(),
  constraint contact_source_relations_row_uniq unique (import_job_id, row_number)
);
create index csr_contact_idx on public.contact_source_relations (contact_id, imported_at);
create index csr_user_source_idx on public.contact_source_relations (user_id, source_id);

-- ---------------------------------------------------------------------
-- Linhas brutas de cada importação (staging). Permite retomar e
-- reprocessar sem duplicar. Apagadas após a conclusão (retenção).
-- ---------------------------------------------------------------------
create table public.import_rows (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number integer not null check (row_number > 0),
  name text check (char_length(name) <= 200),
  original_phone text check (char_length(original_phone) <= 60),
  normalized_phone text check (normalized_phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_digits text check (phone_digits ~ '^[0-9]{0,30}$'),
  country_code text check (country_code ~ '^[0-9]{1,3}$'),
  area_code text check (area_code ~ '^[0-9]{2}$'),
  national_number text check (national_number ~ '^[0-9]{4,15}$'),
  line_type text check (line_type in ('mobile', 'landline', 'other')),
  validation_status text not null
    check (validation_status in ('valid', 'foreign', 'needs_review', 'incomplete', 'invalid_area_code', 'invalid', 'empty')),
  issues text[] not null default '{}',
  outcome text check (outcome in ('new', 'duplicate', 'invalid', 'skipped')),
  contact_id uuid references public.contacts (id) on delete set null,
  processed_at timestamptz,
  constraint import_rows_job_row_uniq unique (job_id, row_number),
  constraint import_rows_normalized_matches_status
    check ((validation_status in ('valid', 'foreign')) = (normalized_phone is not null))
);
create index import_rows_pending_idx on public.import_rows (job_id, row_number) where processed_at is null;

-- ---------------------------------------------------------------------
-- RLS: cada tabela só mostra as linhas do dono
-- ---------------------------------------------------------------------
alter table public.contact_sources enable row level security;
alter table public.import_jobs enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_source_relations enable row level security;
alter table public.import_rows enable row level security;

create policy contact_sources_select on public.contact_sources for select to authenticated using (user_id = (select auth.uid()));
create policy contact_sources_insert on public.contact_sources for insert to authenticated with check (user_id = (select auth.uid()));
create policy contact_sources_update on public.contact_sources for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Origens não são apagadas (histórico); são arquivadas.

create policy import_jobs_select on public.import_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy import_jobs_insert on public.import_jobs for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.contact_sources s where s.id = source_id and s.user_id = (select auth.uid())));
create policy import_jobs_update on public.import_jobs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy contacts_select on public.contacts for select to authenticated using (user_id = (select auth.uid()));
create policy contacts_insert on public.contacts for insert to authenticated with check (user_id = (select auth.uid()));
create policy contacts_update on public.contacts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Sem delete direto: exclusão passa por request_contact_deletion (anonimiza + supressão).

create policy csr_select on public.contact_source_relations for select to authenticated using (user_id = (select auth.uid()));
create policy csr_insert on public.contact_source_relations for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid()))
    and exists (select 1 from public.contact_sources s where s.id = source_id and s.user_id = (select auth.uid()))
    and exists (select 1 from public.import_jobs j where j.id = import_job_id and j.user_id = (select auth.uid())));

create policy import_rows_select on public.import_rows for select to authenticated using (user_id = (select auth.uid()));
create policy import_rows_insert on public.import_rows for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.import_jobs j where j.id = job_id and j.user_id = (select auth.uid())
                and j.status in ('pending', 'uploading', 'processing')));
create policy import_rows_update on public.import_rows for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
