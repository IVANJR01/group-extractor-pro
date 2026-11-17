-- =====================================================================
-- Group Extractor Pro — Fundação: utilidades, perfis, DDDs, auditoria
-- =====================================================================

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Cria o perfil quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- DDDs brasileiros (tabela de referência, somente leitura)
-- ---------------------------------------------------------------------
create table public.br_area_codes (
  code text primary key check (code ~ '^[1-9][0-9]$'),
  uf text not null check (uf ~ '^[A-Z]{2}$')
);

insert into public.br_area_codes (code, uf) values
  ('11','SP'),('12','SP'),('13','SP'),('14','SP'),('15','SP'),('16','SP'),('17','SP'),('18','SP'),('19','SP'),
  ('21','RJ'),('22','RJ'),('24','RJ'),('27','ES'),('28','ES'),
  ('31','MG'),('32','MG'),('33','MG'),('34','MG'),('35','MG'),('37','MG'),('38','MG'),
  ('41','PR'),('42','PR'),('43','PR'),('44','PR'),('45','PR'),('46','PR'),
  ('47','SC'),('48','SC'),('49','SC'),('51','RS'),('53','RS'),('54','RS'),('55','RS'),
  ('61','DF'),('62','GO'),('64','GO'),('63','TO'),('65','MT'),('66','MT'),('67','MS'),('68','AC'),('69','RO'),
  ('71','BA'),('73','BA'),('74','BA'),('75','BA'),('77','BA'),('79','SE'),
  ('81','PE'),('87','PE'),('82','AL'),('83','PB'),('84','RN'),('85','CE'),('88','CE'),('86','PI'),('89','PI'),
  ('91','PA'),('93','PA'),('94','PA'),('92','AM'),('97','AM'),('95','RR'),('96','AP'),('98','MA'),('99','MA');

alter table public.br_area_codes enable row level security;
create policy br_area_codes_read on public.br_area_codes for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- audit_logs (somente inserção; nunca guardar telefone em metadata)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action text not null check (char_length(action) between 1 and 80),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;
create policy audit_logs_select_own on public.audit_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy audit_logs_insert_own on public.audit_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
-- Sem políticas de update/delete: registros de auditoria são imutáveis.

-- Função auxiliar para registrar auditoria a partir de outras funções
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb, p_user_id uuid default null
) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (coalesce(p_user_id, auth.uid()), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
