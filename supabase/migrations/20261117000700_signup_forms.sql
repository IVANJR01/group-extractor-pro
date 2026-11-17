-- =====================================================================
-- Páginas de inscrição (opt-in voluntário)
-- A pessoa informa nome e WhatsApp e marca a autorização. O contato
-- entra como "authorized", com evidência registrada (texto aceito,
-- data/hora, formulário). Nenhum dado vem do WhatsApp.
-- =====================================================================

create table public.signup_forms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]{8,32}$'),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text check (char_length(description) <= 600),
  organizer_name text not null check (char_length(btrim(organizer_name)) between 2 and 120),
  consent_text text not null check (char_length(btrim(consent_text)) between 20 and 1000),
  destination_group_id uuid references public.destination_groups (id) on delete set null,
  source_id uuid not null references public.contact_sources (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index signup_forms_user_idx on public.signup_forms (user_id);
create trigger signup_forms_updated_at before update on public.signup_forms
  for each row execute function public.set_updated_at();

create table public.signup_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  form_id uuid not null references public.signup_forms (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  name text check (char_length(name) <= 200),
  phone text check (char_length(phone) <= 20),
  consent_text text not null,
  outcome text not null check (outcome in ('new', 'existing', 'suppressed')),
  ip_hash text check (char_length(ip_hash) <= 64),
  user_agent text check (char_length(user_agent) <= 200),
  created_at timestamptz not null default now()
);
create index signup_submissions_form_idx on public.signup_submissions (form_id, created_at desc);
create index signup_submissions_ip_idx on public.signup_submissions (form_id, ip_hash, created_at);

-- Ocorrência de origem pode vir de importação OU de inscrição
alter table public.contact_source_relations alter column import_job_id drop not null;
alter table public.contact_source_relations
  add column signup_submission_id uuid unique references public.signup_submissions (id) on delete cascade,
  add constraint contact_source_relations_origin check (import_job_id is not null or signup_submission_id is not null);

alter table public.signup_forms enable row level security;
alter table public.signup_submissions enable row level security;

create policy signup_forms_select on public.signup_forms for select to authenticated
  using (user_id = (select auth.uid()));
create policy signup_forms_update on public.signup_forms for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy signup_submissions_select on public.signup_submissions for select to authenticated
  using (user_id = (select auth.uid()));

-- O grupo de destino escolhido precisa ser do mesmo dono
create or replace function public.signup_forms_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.destination_group_id is not null and not exists (
    select 1 from public.destination_groups g where g.id = new.destination_group_id and g.user_id = new.user_id) then
    raise exception 'Grupo de destino inválido' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger signup_forms_guard before insert or update on public.signup_forms
  for each row execute function public.signup_forms_guard();

-- ---------------------------------------------------------------------
-- Criar formulário (cria também a fonte "Formulário: …")
-- ---------------------------------------------------------------------
create or replace function public.create_signup_form(
  p_title text, p_organizer_name text, p_consent_text text,
  p_description text default null, p_destination_group_id uuid default null
) returns public.signup_forms language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_src uuid; v_f public.signup_forms;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  if (select count(*) from public.signup_forms where user_id = v_uid) >= 50 then
    raise exception 'Limite de 50 páginas de inscrição atingido' using errcode = '54000';
  end if;
  insert into public.contact_sources (user_id, name, source_type, description)
  values (v_uid, left('Formulário: ' || btrim(p_title), 120), 'form', 'Inscrições voluntárias pela página pública')
  returning id into v_src;
  insert into public.signup_forms (user_id, slug, title, description, organizer_name, consent_text, destination_group_id, source_id)
  values (v_uid, substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), btrim(p_title), nullif(btrim(p_description), ''),
          btrim(p_organizer_name), btrim(p_consent_text), p_destination_group_id, v_src)
  returning * into v_f;
  perform public.log_audit('signup_form.created', 'signup_form', v_f.id, jsonb_build_object('title', v_f.title), v_uid);
  return v_f;
end;
$$;

-- ---------------------------------------------------------------------
-- Público: dados da página (somente se ativa)
-- ---------------------------------------------------------------------
create or replace function public.get_signup_form(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', f.title, 'description', f.description, 'organizer_name', f.organizer_name,
    'consent_text', f.consent_text, 'group_name', g.name)
    from public.signup_forms f
    left join public.destination_groups g on g.id = f.destination_group_id and g.status = 'active'
   where f.slug = p_slug and f.status = 'active';
$$;

-- ---------------------------------------------------------------------
-- Público: enviar inscrição
-- p_phone vem normalizado (E.164) do navegador e é validado de novo aqui.
-- ---------------------------------------------------------------------
create or replace function public.submit_signup(
  p_slug text, p_name text, p_phone text, p_consent boolean, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.signup_forms;
  g public.destination_groups;
  v_name text := nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g')), 200), '');
  v_phone text := btrim(coalesce(p_phone, ''));
  v_status text; v_area text; v_cc text; v_nat text;
  v_ip text; v_ip_hash text;
  v_contact public.contacts;
  v_sub uuid; v_outcome text; v_suppressed boolean;
  v_merge record;
begin
  select * into f from public.signup_forms where slug = p_slug and status = 'active';
  if f.id is null then raise exception 'Página de inscrição indisponível' using errcode = 'P0002'; end if;
  if p_consent is not true then raise exception 'É preciso marcar a autorização' using errcode = '22023'; end if;
  if v_name is null or char_length(v_name) < 2 then raise exception 'Informe seu nome' using errcode = '22023'; end if;

  -- Validação do telefone (celular brasileiro com DDD válido, ou número internacional)
  if v_phone ~ '^\+55[1-9][0-9]9[0-9]{8}$' then
    v_area := substr(v_phone, 4, 2);
    if not exists (select 1 from public.br_area_codes where code = v_area) then
      raise exception 'DDD inválido' using errcode = '22023';
    end if;
    v_status := 'valid'; v_cc := '55'; v_nat := substr(v_phone, 4);
  elsif v_phone ~ '^\+[1-9][0-9]{7,14}$' and v_phone !~ '^\+55' then
    v_status := 'foreign'; v_area := null; v_cc := null; v_nat := null;
  else
    raise exception 'Informe um celular válido com DDD' using errcode = '22023';
  end if;

  -- Limites contra abuso: por IP (hash, sem guardar o IP) e por página
  v_ip := split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1);
  v_ip_hash := case when v_ip <> '' then encode(sha256(convert_to(f.id::text || btrim(v_ip), 'UTF8')), 'hex') end;
  if v_ip_hash is not null and (select count(*) from public.signup_submissions
       where form_id = f.id and ip_hash = v_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Muitas inscrições deste aparelho. Tente mais tarde.' using errcode = '54000';
  end if;
  if (select count(*) from public.signup_submissions where form_id = f.id and created_at > now() - interval '10 minutes') >= 300 then
    raise exception 'Muitas inscrições ao mesmo tempo. Tente em alguns minutos.' using errcode = '54000';
  end if;

  -- Contato (deduplicado pelo telefone normalizado)
  insert into public.contacts (user_id, name, original_phone, normalized_phone, dedup_key, country_code, area_code,
                               national_number, line_type, validation_status, first_source_id)
  values (f.user_id, v_name, v_phone, v_phone, v_phone, v_cc, v_area, v_nat,
          case when v_status = 'valid' then 'mobile' else 'other' end, v_status, f.source_id)
  on conflict (user_id, dedup_key) do nothing
  returning * into v_contact;

  if v_contact.id is null then
    select * into v_contact from public.contacts where user_id = f.user_id and dedup_key = v_phone;
    v_outcome := 'existing';
    if v_contact.deleted_at is null then
      select * into v_merge from public.merge_name(v_contact.name, v_name);
      if v_merge.conflict then
        if not (v_name = any (v_contact.name_conflicts)) then
          update public.contacts set name_conflicts = array_append(name_conflicts, v_name) where id = v_contact.id;
        end if;
      elsif v_merge.changed then
        update public.contacts set name = v_merge.name where id = v_contact.id;
      end if;
    end if;
  else
    v_outcome := 'new';
  end if;

  -- Bloqueio manual, reclamação ou pedido de exclusão: não autoriza de novo
  v_suppressed := exists (select 1 from public.suppression_list s
                          where s.user_id = f.user_id and s.dedup_key = v_phone
                            and s.reason in ('manual_block', 'complaint', 'deletion_request'))
                  or v_contact.deleted_at is not null or v_contact.consent_status = 'blocked';
  if v_suppressed then v_outcome := 'suppressed'; end if;

  insert into public.signup_submissions (user_id, form_id, contact_id, name, phone, consent_text, outcome, ip_hash, user_agent)
  values (f.user_id, f.id, case when v_contact.deleted_at is null then v_contact.id end,
          case when v_suppressed then null else v_name end, case when v_suppressed then null else v_phone end,
          f.consent_text, v_outcome, v_ip_hash, left(p_user_agent, 200))
  returning id into v_sub;

  if not v_suppressed then
    insert into public.contact_source_relations (user_id, contact_id, source_id, signup_submission_id, row_number, original_name, original_phone)
    values (f.user_id, v_contact.id, f.source_id, v_sub, 1, v_name, v_phone);

    insert into public.consent_records (user_id, contact_id, purpose, status, collection_method, evidence_reference, obtained_at, notes, created_by)
    values (f.user_id, v_contact.id, 'group_invitation', 'authorized', 'form',
            left('signup:' || f.slug || ' submission:' || v_sub::text, 300), now(),
            left('Aceite na página "' || f.title || '": ' || f.consent_text, 500), null);
  end if;

  perform public.log_audit('signup.received', 'signup_form', f.id, jsonb_build_object('outcome', v_outcome), f.user_id);

  if not v_suppressed and f.destination_group_id is not null then
    select * into g from public.destination_groups
     where id = f.destination_group_id and status = 'active' and invite_link_status = 'active' and invite_url is not null;
  end if;
  return jsonb_build_object('ok', true, 'group_name', g.name, 'invite_url', g.invite_url);
end;
$$;

-- Ocorrências: inclui inscrições
create or replace function public.contact_occurrences(p_contact_id uuid)
returns table (source_id uuid, source_name text, import_job_id uuid, file_name text, row_number integer,
               original_name text, original_phone text, imported_at timestamptz)
language sql stable set search_path = '' as $$
  select r.source_id, s.name, r.import_job_id,
         coalesce(j.file_name, case when r.signup_submission_id is not null then 'Página de inscrição' end),
         r.row_number, r.original_name, r.original_phone, r.imported_at
    from public.contact_source_relations r
    join public.contact_sources s on s.id = r.source_id
    left join public.import_jobs j on j.id = r.import_job_id
   where r.contact_id = p_contact_id
   order by r.imported_at, r.row_number;
$$;

-- Permissões
revoke all on public.signup_forms, public.signup_submissions from public, anon, authenticated;
grant select on public.signup_forms, public.signup_submissions to authenticated;
grant update (title, description, organizer_name, consent_text, destination_group_id, status) on public.signup_forms to authenticated;
grant all on public.signup_forms, public.signup_submissions to service_role;

revoke all on function public.create_signup_form(text, text, text, text, uuid), public.get_signup_form(text),
  public.submit_signup(text, text, text, boolean, text), public.signup_forms_guard() from public;
grant execute on function public.create_signup_form(text, text, text, text, uuid) to authenticated;
grant execute on function public.get_signup_form(text), public.submit_signup(text, text, text, boolean, text) to anon, authenticated;
revoke all on function public.contact_occurrences(uuid) from public, anon;
grant execute on function public.contact_occurrences(uuid) to authenticated;
