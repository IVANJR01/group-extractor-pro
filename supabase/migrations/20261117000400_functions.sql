-- =====================================================================
-- Regras de negócio no banco: importação idempotente, consentimento,
-- supressão, elegibilidade, segmentos, campanhas, LGPD e indicadores.
-- Funções SECURITY DEFINER sempre verificam o dono explicitamente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create or replace function public.jwt_role()
returns text language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

-- Garante que quem chama é o dono do registro (ou o worker com service_role)
create or replace function public.assert_owner(p_owner uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_owner is null then
    raise exception 'Registro não encontrado' using errcode = 'P0002';
  end if;
  if auth.uid() is not null and auth.uid() = p_owner then
    return;
  end if;
  if auth.uid() is null and public.jwt_role() = 'service_role' then
    return;
  end if;
  raise exception 'Registro não encontrado' using errcode = 'P0002';
end;
$$;

create or replace function public.jsonb_text_array(p jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array'
              then array(select jsonb_array_elements_text(p))
              else null end;
$$;

-- Chave de nome para comparação: minúsculas, sem acento, espaços simples
create or replace function public.name_key(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Mesma regra do frontend (src/utils/names.ts): nunca troca nome completo por incompleto
create or replace function public.merge_name(p_existing text, p_incoming text, out name text, out changed boolean, out conflict boolean)
language plpgsql immutable set search_path = '' as $$
declare a text[]; b text[];
begin
  name := p_existing; changed := false; conflict := false;
  if p_incoming is null or btrim(p_incoming) = '' then return; end if;
  if p_existing is null or btrim(p_existing) = '' then name := p_incoming; changed := true; return; end if;
  if public.name_key(p_existing) = public.name_key(p_incoming) then return; end if;
  a := string_to_array(public.name_key(p_existing), ' ');
  b := string_to_array(public.name_key(p_incoming), ' ');
  if cardinality(b) > cardinality(a) and a <@ b then name := p_incoming; changed := true; return; end if;
  if b <@ a then return; end if;
  conflict := true;
end;
$$;

-- ---------------------------------------------------------------------
-- Supressão e consentimento
-- ---------------------------------------------------------------------
create or replace function public.is_suppressed(p_user uuid, p_key text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.suppression_list s where s.user_id = p_user and s.dedup_key = p_key);
$$;

-- Contato novo cujo telefone está na supressão já nasce bloqueado/revogado
create or replace function public.contacts_apply_suppression()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  select reason into v_reason from public.suppression_list s where s.user_id = new.user_id and s.dedup_key = new.dedup_key;
  if v_reason is not null then
    new.consent_status := case when v_reason in ('revoked', 'opt_out') then 'revoked' else 'blocked' end;
    new.consent_updated_at := now();
  end if;
  return new;
end;
$$;
create trigger contacts_apply_suppression before insert on public.contacts
  for each row execute function public.contacts_apply_suppression();

-- Inclusão na supressão atualiza todos os contatos com aquele telefone
create or replace function public.suppression_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.contacts c
     set consent_status = case when new.reason in ('revoked', 'opt_out') and c.consent_status <> 'blocked' then 'revoked' else 'blocked' end,
         consent_updated_at = now()
   where c.user_id = new.user_id and c.dedup_key = new.dedup_key;
  perform public.log_audit('suppression.added', 'suppression_list', new.id, jsonb_build_object('reason', new.reason), new.user_id);
  return new;
end;
$$;
create trigger suppression_after_insert after insert on public.suppression_list
  for each row execute function public.suppression_after_insert();

-- Novo registro de consentimento atualiza o estado atual do contato
create or replace function public.consent_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_contact public.contacts;
begin
  select * into v_contact from public.contacts where id = new.contact_id;
  if new.purpose = 'group_invitation' then
    if new.status = 'revoked' then
      insert into public.suppression_list (user_id, dedup_key, reason)
      values (new.user_id, v_contact.dedup_key, 'revoked')
      on conflict (user_id, dedup_key) do nothing;
      update public.contacts set consent_status = case when consent_status = 'blocked' then 'blocked' else 'revoked' end,
                                 consent_updated_at = now()
       where id = new.contact_id;
    elsif new.status = 'authorized' then
      if v_contact.consent_status = 'blocked' then
        raise exception 'Contato bloqueado: desbloqueie antes de registrar nova autorização' using errcode = '42501';
      end if;
      -- Nova autorização explícita encerra uma revogação/opt-out anterior
      delete from public.suppression_list
       where user_id = new.user_id and dedup_key = v_contact.dedup_key and reason in ('revoked', 'opt_out');
      update public.contacts set consent_status = 'authorized', consent_updated_at = now() where id = new.contact_id;
    else
      if v_contact.consent_status not in ('blocked', 'revoked') then
        update public.contacts set consent_status = 'pending', consent_updated_at = now() where id = new.contact_id;
      end if;
    end if;
  end if;
  perform public.log_audit('consent.' || new.status, 'contact', new.contact_id,
    jsonb_build_object('purpose', new.purpose, 'method', new.collection_method, 'consent_record_id', new.id), new.user_id);
  return new;
end;
$$;
create trigger consent_after_insert after insert on public.consent_records
  for each row execute function public.consent_after_insert();

create or replace function public.register_consent(
  p_contact_id uuid, p_status text, p_purpose text default 'group_invitation',
  p_collection_method text default null, p_evidence_reference text default null,
  p_obtained_at timestamptz default null, p_notes text default null, p_campaign_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  select user_id into v_owner from public.contacts where id = p_contact_id and deleted_at is null;
  perform public.assert_owner(v_owner);
  insert into public.consent_records (user_id, contact_id, purpose, status, collection_method, evidence_reference,
                                      obtained_at, revoked_at, notes, campaign_id, created_by)
  values (v_owner, p_contact_id, p_purpose, p_status, p_collection_method, p_evidence_reference,
          case when p_status = 'authorized' then coalesce(p_obtained_at, now()) end,
          case when p_status = 'revoked' then now() end, p_notes, p_campaign_id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.block_contact(p_contact_id uuid, p_reason text default 'manual_block', p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts;
begin
  select * into v_c from public.contacts where id = p_contact_id;
  perform public.assert_owner(v_c.user_id);
  if p_reason not in ('manual_block', 'complaint', 'opt_out') then
    raise exception 'Motivo inválido' using errcode = '22023';
  end if;
  insert into public.suppression_list (user_id, dedup_key, reason, notes)
  values (v_c.user_id, v_c.dedup_key, p_reason, p_notes)
  on conflict (user_id, dedup_key) do update set reason = excluded.reason, notes = excluded.notes;
  update public.contacts set consent_status = 'blocked', consent_updated_at = now() where id = p_contact_id;
  perform public.log_audit('contact.blocked', 'contact', p_contact_id, jsonb_build_object('reason', p_reason), v_c.user_id);
end;
$$;

create or replace function public.unblock_contact(p_contact_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts;
begin
  select * into v_c from public.contacts where id = p_contact_id;
  perform public.assert_owner(v_c.user_id);
  if exists (select 1 from public.suppression_list where user_id = v_c.user_id and dedup_key = v_c.dedup_key and reason = 'deletion_request') then
    raise exception 'Contato com pedido de exclusão não pode ser desbloqueado' using errcode = '42501';
  end if;
  delete from public.suppression_list where user_id = v_c.user_id and dedup_key = v_c.dedup_key and reason in ('manual_block', 'complaint');
  update public.contacts set consent_status = 'pending', consent_updated_at = now() where id = p_contact_id and consent_status = 'blocked';
  perform public.log_audit('contact.unblocked', 'contact', p_contact_id, '{}'::jsonb, v_c.user_id);
end;
$$;

-- Elegível para comunicação iniciada pelo sistema
create or replace function public.is_contact_eligible(p_contact public.contacts)
returns boolean language sql stable set search_path = '' as $$
  select p_contact.deleted_at is null
     and p_contact.validation_status in ('valid', 'foreign')
     and p_contact.consent_status = 'authorized'
     and not public.is_suppressed(p_contact.user_id, p_contact.dedup_key);
$$;

-- ---------------------------------------------------------------------
-- Importação
-- ---------------------------------------------------------------------
create or replace function public.create_import_job(
  p_source_id uuid, p_file_name text, p_file_type text, p_file_size bigint,
  p_file_hash text, p_total_rows integer, p_column_mapping jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_job public.import_jobs;
  v_prev uuid;
  v_max_rows constant integer := 200000;
  v_max_bytes constant bigint := 20 * 1024 * 1024;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  select user_id into v_owner from public.contact_sources where id = p_source_id and status = 'active';
  perform public.assert_owner(v_owner);
  if p_total_rows is null or p_total_rows < 1 then raise exception 'Arquivo sem registros' using errcode = '22023'; end if;
  if p_total_rows > v_max_rows then raise exception 'Limite de % linhas por importação', v_max_rows using errcode = '22023'; end if;
  if coalesce(p_file_size, 0) > v_max_bytes then raise exception 'Arquivo maior que 20 MB' using errcode = '22023'; end if;
  -- Limites de uso (rate limiting por conta)
  if (select count(*) from public.import_jobs where user_id = v_uid and status in ('pending', 'uploading', 'processing')) >= 3 then
    raise exception 'Já existem 3 importações em andamento. Aguarde terminar.' using errcode = '53400';
  end if;
  if (select count(*) from public.import_jobs where user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Limite de 30 importações por hora atingido.' using errcode = '53400';
  end if;

  select id into v_prev from public.import_jobs
   where user_id = v_uid and file_hash = p_file_hash and status = 'completed'
   order by created_at desc limit 1;

  insert into public.import_jobs (user_id, source_id, file_name, file_type, file_size, file_hash, total_rows, column_mapping, status)
  values (v_uid, p_source_id, left(p_file_name, 255), p_file_type, p_file_size, p_file_hash, p_total_rows, coalesce(p_column_mapping, '{}'::jsonb), 'uploading')
  returning * into v_job;

  perform public.log_audit('import.created', 'import_job', v_job.id,
    jsonb_build_object('file_type', p_file_type, 'total_rows', p_total_rows, 'reimport_of', v_prev), v_uid);
  return jsonb_build_object('job_id', v_job.id, 'previous_job_id', v_prev);
end;
$$;

-- Progresso de uma importação em JSON (usado pela barra de progresso)
create or replace function public.import_progress(j public.import_jobs)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'status', j.status, 'done', j.status in ('completed', 'cancelled', 'failed'),
    'total_rows', j.total_rows, 'uploaded_rows', j.uploaded_rows, 'processed_rows', j.processed_rows,
    'valid_rows', j.valid_rows, 'invalid_rows', j.invalid_rows, 'duplicate_rows', j.duplicate_rows,
    'new_contacts', j.new_contacts, 'name_conflicts', j.name_conflicts);
$$;

-- Processa um lote de linhas pendentes. Idempotente e seguro para retomada:
-- cada linha é marcada como processada na mesma transação em que vira contato.
create or replace function public.process_import_batch(p_job_id uuid, p_batch_size integer default 500)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.import_jobs;
  r public.import_rows;
  v_key text;
  v_contact_id uuid;
  v_existing public.contacts;
  v_merge record;
  v_outcome text;
  v_new int := 0; v_dup int := 0; v_inv int := 0; v_valid int := 0; v_proc int := 0; v_conf int := 0;
  v_uploaded int; v_pending int;
begin
  -- Impede dois processamentos simultâneos do mesmo job
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text, 42));
  select * into j from public.import_jobs where id = p_job_id for update;
  perform public.assert_owner(j.user_id);

  if j.status in ('completed', 'cancelled', 'failed') then
    return public.import_progress(j);
  end if;

  if j.cancel_requested then
    update public.import_jobs set status = 'cancelled', completed_at = now() where id = j.id returning * into j;
    delete from public.import_rows where job_id = j.id and processed_at is null;
    perform public.log_audit('import.cancelled', 'import_job', j.id, jsonb_build_object('processed_rows', j.processed_rows), j.user_id);
    return public.import_progress(j);
  end if;

  if j.status <> 'processing' then
    update public.import_jobs set status = 'processing', started_at = coalesce(started_at, now()), attempts = attempts + 1 where id = j.id;
  end if;

  for r in
    select * from public.import_rows
     where job_id = j.id and processed_at is null
     order by row_number
     limit greatest(1, least(coalesce(p_batch_size, 500), 2000))
     for update skip locked
  loop
    v_proc := v_proc + 1;
    v_contact_id := null;

    if r.validation_status = 'empty' or coalesce(r.phone_digits, '') = '' and r.normalized_phone is null then
      update public.import_rows set outcome = 'invalid', processed_at = now() where id = r.id;
      v_inv := v_inv + 1;
      continue;
    end if;

    v_key := coalesce(r.normalized_phone, 'raw:' || r.phone_digits);

    insert into public.contacts (user_id, name, original_phone, normalized_phone, dedup_key, country_code, area_code,
                                 national_number, line_type, validation_status, validation_issues,
                                 first_source_id, first_import_job_id)
    values (j.user_id, r.name, r.original_phone, r.normalized_phone, v_key, r.country_code,
            case when r.validation_status in ('valid', 'needs_review', 'invalid_area_code') then r.area_code end,
            r.national_number, r.line_type, r.validation_status, r.issues, j.source_id, j.id)
    on conflict (user_id, dedup_key) do nothing
    returning id into v_contact_id;

    if v_contact_id is null then
      select * into v_existing from public.contacts where user_id = j.user_id and dedup_key = v_key;
      v_contact_id := v_existing.id;
      select * into v_merge from public.merge_name(v_existing.name, r.name);
      if v_merge.conflict then
        if not (r.name = any (v_existing.name_conflicts)) then
          update public.contacts set name_conflicts = array_append(name_conflicts, r.name) where id = v_existing.id;
        end if;
        v_conf := v_conf + 1;
      elsif v_merge.changed then
        update public.contacts set name = v_merge.name where id = v_existing.id;
      end if;
      v_outcome := case when r.normalized_phone is null then 'invalid' else 'duplicate' end;
    else
      v_outcome := case when r.normalized_phone is null then 'invalid' else 'new' end;
    end if;

    if v_outcome = 'invalid' then v_inv := v_inv + 1;
    else
      v_valid := v_valid + 1;
      if v_outcome = 'duplicate' then v_dup := v_dup + 1; else v_new := v_new + 1; end if;
    end if;

    insert into public.contact_source_relations (user_id, contact_id, source_id, import_job_id, row_number, original_name, original_phone)
    values (j.user_id, v_contact_id, j.source_id, j.id, r.row_number, r.name, r.original_phone)
    on conflict (import_job_id, row_number) do nothing;

    update public.import_rows set outcome = v_outcome, contact_id = v_contact_id, processed_at = now() where id = r.id;
  end loop;

  select count(*), count(*) filter (where processed_at is null) into v_uploaded, v_pending
    from public.import_rows where job_id = j.id;

  update public.import_jobs
     set processed_rows = processed_rows + v_proc,
         valid_rows = valid_rows + v_valid,
         invalid_rows = invalid_rows + v_inv,
         duplicate_rows = duplicate_rows + v_dup,
         new_contacts = new_contacts + v_new,
         name_conflicts = name_conflicts + v_conf,
         uploaded_rows = greatest(uploaded_rows, v_uploaded)
   where id = j.id
   returning * into j;

  if v_pending = 0 and v_uploaded >= j.total_rows then
    update public.import_jobs set status = 'completed', completed_at = now() where id = j.id returning * into j;
    perform public.log_audit('import.completed', 'import_job', j.id, jsonb_build_object(
      'total_rows', j.total_rows, 'valid_rows', j.valid_rows, 'invalid_rows', j.invalid_rows,
      'duplicate_rows', j.duplicate_rows, 'new_contacts', j.new_contacts), j.user_id);
  end if;

  return public.import_progress(j) || jsonb_build_object('batch_processed', v_proc);
end;
$$;

create or replace function public.cancel_import_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.import_jobs where id = p_job_id;
  perform public.assert_owner(v_owner);
  update public.import_jobs set cancel_requested = true
   where id = p_job_id and status in ('pending', 'uploading', 'processing');
  -- Se nada está processando agora, encerra imediatamente
  perform public.process_import_batch(p_job_id, 1);
end;
$$;

create or replace function public.fail_import_job(p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.import_jobs where id = p_job_id;
  perform public.assert_owner(v_owner);
  update public.import_jobs
     set status = 'failed', completed_at = now(),
         error_details = error_details || jsonb_build_array(jsonb_build_object('at', now(), 'message', left(p_error, 300)))
   where id = p_job_id and status in ('pending', 'uploading', 'processing');
end;
$$;

-- ---------------------------------------------------------------------
-- Visão da central de contatos (respeita RLS de quem consulta)
-- ---------------------------------------------------------------------
create or replace view public.contact_overview
with (security_invoker = true) as
select
  c.id, c.user_id, c.name, c.original_phone, c.normalized_phone, c.country_code, c.area_code,
  a.uf, c.national_number, c.line_type, c.validation_status, c.validation_issues, c.name_conflicts,
  c.consent_status, c.consent_updated_at, c.first_source_id, c.created_at, c.updated_at,
  coalesce(rel.source_ids, '{}') as source_ids,
  coalesce(rel.occurrences, 0) as occurrences,
  public.is_suppressed(c.user_id, c.dedup_key) as suppressed,
  ev.last_event_type,
  ev.last_event_at,
  coalesce(ev.campaign_ids, '{}') as campaign_ids
from public.contacts c
left join public.br_area_codes a on a.code = c.area_code and c.country_code = '55'
left join lateral (
  select array_agg(distinct r.source_id) as source_ids, count(*)::int as occurrences
  from public.contact_source_relations r where r.contact_id = c.id
) rel on true
left join lateral (
  select (array_agg(e.event_type order by e.occurred_at desc))[1] as last_event_type,
         max(e.occurred_at) as last_event_at,
         array_agg(distinct e.campaign_id) as campaign_ids
  from public.invitation_events e where e.contact_id = c.id
) ev on true
where c.deleted_at is null;

-- ---------------------------------------------------------------------
-- Segmentos: filtro em JSON interpretado no servidor, sem SQL dinâmico
-- Chaves aceitas: source_ids, source_match (any|all), area_codes, ufs,
-- consent_statuses, validation_statuses, imported_from, imported_to,
-- invite_status (never|invited), include_suppressed, search,
-- destination_group_id
-- ---------------------------------------------------------------------
create or replace function public.segment_contacts(p_filter jsonb)
returns setof public.contact_overview
language sql stable set search_path = '' as $$
  with f as (
    select
      public.jsonb_text_array(p_filter -> 'source_ids')::uuid[] as source_ids,
      coalesce(p_filter ->> 'source_match', 'any') as source_match,
      public.jsonb_text_array(p_filter -> 'area_codes') as area_codes,
      public.jsonb_text_array(p_filter -> 'ufs') as ufs,
      public.jsonb_text_array(p_filter -> 'consent_statuses') as consent_statuses,
      public.jsonb_text_array(p_filter -> 'validation_statuses') as validation_statuses,
      nullif(p_filter ->> 'imported_from', '')::date as imported_from,
      nullif(p_filter ->> 'imported_to', '')::date as imported_to,
      nullif(p_filter ->> 'invite_status', '') as invite_status,
      coalesce((p_filter ->> 'include_suppressed')::boolean, false) as include_suppressed,
      nullif(btrim(p_filter ->> 'search'), '') as search,
      nullif(p_filter ->> 'destination_group_id', '')::uuid as destination_group_id
  )
  select o.*
  from public.contact_overview o, f
  where (f.source_ids is null or cardinality(f.source_ids) = 0
         or (f.source_match = 'all' and o.source_ids @> f.source_ids)
         or (f.source_match <> 'all' and o.source_ids && f.source_ids))
    and (f.area_codes is null or cardinality(f.area_codes) = 0 or o.area_code = any (f.area_codes))
    and (f.ufs is null or cardinality(f.ufs) = 0 or o.uf = any (f.ufs))
    and (f.consent_statuses is null or cardinality(f.consent_statuses) = 0 or o.consent_status = any (f.consent_statuses))
    and (f.validation_statuses is null or cardinality(f.validation_statuses) = 0 or o.validation_status = any (f.validation_statuses))
    and (f.imported_from is null or o.created_at >= f.imported_from)
    and (f.imported_to is null or o.created_at < f.imported_to + 1)
    and (f.invite_status is null
         or (f.invite_status = 'never' and o.last_event_type is null)
         or (f.invite_status = 'invited' and o.last_event_type is not null))
    and (f.include_suppressed or not o.suppressed)
    and (f.search is null
         or o.name ilike '%' || replace(replace(f.search, '%', ''), '_', '') || '%'
         or (regexp_replace(f.search, '\D', '', 'g') <> '' and o.normalized_phone like '%' || regexp_replace(f.search, '\D', '', 'g') || '%'))
    and (f.destination_group_id is null or exists (
          select 1 from public.invitation_campaigns ic
          where ic.destination_group_id = f.destination_group_id and ic.id = any (o.campaign_ids)))
  order by o.created_at desc, o.id;
$$;

create or replace function public.segment_count(p_filter jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'eligible', count(*) filter (where s.validation_status in ('valid', 'foreign') and s.consent_status = 'authorized' and not s.suppressed),
    'without_consent', count(*) filter (where s.consent_status = 'pending'),
    'invalid', count(*) filter (where s.validation_status not in ('valid', 'foreign'))
  )
  from public.segment_contacts(p_filter) s;
$$;

-- ---------------------------------------------------------------------
-- Campanhas de convite
-- ---------------------------------------------------------------------

-- Bloqueia eventos de convite para contatos não elegíveis
create or replace function public.invitation_events_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts; v_g public.destination_groups;
begin
  if new.event_type in ('prepared', 'shared', 'sent_via_integration') then
    select * into v_c from public.contacts where id = new.contact_id;
    if not public.is_contact_eligible(v_c) then
      raise exception 'Contato sem autorização registrada, bloqueado ou inválido' using errcode = '42501';
    end if;
    select g.* into v_g from public.destination_groups g join public.invitation_campaigns ic on ic.destination_group_id = g.id
     where ic.id = new.campaign_id;
    if v_g.invite_url is null or v_g.invite_link_status <> 'active' or v_g.status <> 'active' then
      raise exception 'Grupo de destino sem link de convite ativo' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger invitation_events_guard before insert on public.invitation_events
  for each row execute function public.invitation_events_guard();

-- Opt-out registrado no convite vira revogação + supressão
create or replace function public.invitation_events_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if new.event_type = 'opt_out' then
    select dedup_key into v_key from public.contacts where id = new.contact_id;
    insert into public.suppression_list (user_id, dedup_key, reason)
    values (new.user_id, v_key, 'opt_out') on conflict (user_id, dedup_key) do nothing;
    insert into public.consent_records (user_id, contact_id, purpose, status, revoked_at, campaign_id, notes, created_by)
    values (new.user_id, new.contact_id, 'group_invitation', 'revoked', now(), new.campaign_id, 'Opt-out registrado no convite', new.recorded_by);
  end if;
  return new;
end;
$$;
create trigger invitation_events_after_insert after insert on public.invitation_events
  for each row execute function public.invitation_events_after_insert();

create or replace function public.prepare_campaign(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.invitation_campaigns; v_filter jsonb; v_total int; v_eligible int; v_inserted int;
begin
  select * into v_c from public.invitation_campaigns where id = p_campaign_id;
  perform public.assert_owner(v_c.user_id);
  if v_c.status not in ('draft', 'active') then raise exception 'Campanha encerrada' using errcode = '22023'; end if;
  select coalesce(filter_definition, '{}'::jsonb) into v_filter from public.contact_segments where id = v_c.segment_id;
  v_filter := coalesce(v_filter, '{}'::jsonb) - 'include_suppressed';

  create temporary table if not exists _seg (id uuid, eligible boolean) on commit drop;
  truncate _seg;
  insert into _seg
    select s.id, (s.validation_status in ('valid', 'foreign') and s.consent_status = 'authorized' and not s.suppressed)
      from public.segment_contacts(v_filter) s
     where s.user_id = v_c.user_id;

  select count(*), count(*) filter (where eligible) into v_total, v_eligible from _seg;

  insert into public.invitation_events (user_id, campaign_id, contact_id, event_type, source, recorded_by)
  select v_c.user_id, v_c.id, s.id, 'prepared', 'user', auth.uid()
    from _seg s
   where s.eligible
     and not exists (select 1 from public.invitation_events e where e.campaign_id = v_c.id and e.contact_id = s.id and e.event_type = 'prepared');
  get diagnostics v_inserted = row_count;

  update public.invitation_campaigns
     set status = 'active', eligible_count = v_eligible, excluded_count = v_total - v_eligible
   where id = v_c.id;
  perform public.log_audit('campaign.prepared', 'invitation_campaign', v_c.id,
    jsonb_build_object('segment_total', v_total, 'eligible', v_eligible, 'excluded', v_total - v_eligible, 'new_prepared', v_inserted), v_c.user_id);
  return jsonb_build_object('segment_total', v_total, 'eligible', v_eligible, 'excluded', v_total - v_eligible, 'prepared', v_inserted);
end;
$$;

-- Situação atual de cada contato numa campanha (último evento)
create or replace function public.campaign_contacts(p_campaign_id uuid)
returns table (contact_id uuid, name text, normalized_phone text, area_code text, consent_status text,
               last_event_type text, last_event_at timestamptz, eligible boolean)
language sql stable set search_path = '' as $$
  select c.id, c.name, c.normalized_phone, c.area_code, c.consent_status,
         le.event_type, le.occurred_at, public.is_contact_eligible(c)
    from public.contacts c
    join lateral (
      select e.event_type, e.occurred_at from public.invitation_events e
       where e.campaign_id = p_campaign_id and e.contact_id = c.id
       order by e.occurred_at desc, e.id desc limit 1
    ) le on true
   where c.deleted_at is null
   order by c.name nulls last, c.id;
$$;

create or replace function public.campaign_summary(p_campaign_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.last_event_type, t.n), '{}'::jsonb)
    from (select last_event_type, count(*) as n from public.campaign_contacts(p_campaign_id) group by 1) t;
$$;

-- Atualização do link do grupo registra data e auditoria
create or replace function public.destination_groups_link_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.invite_url is distinct from old.invite_url or new.invite_link_status is distinct from old.invite_link_status then
    new.invite_link_updated_at := now();
    perform public.log_audit(case when tg_op = 'INSERT' then 'group.created' else 'group.link_updated' end,
      'destination_group', new.id, jsonb_build_object('link_status', new.invite_link_status), new.user_id);
  end if;
  return new;
end;
$$;
create trigger destination_groups_link_audit before insert or update on public.destination_groups
  for each row execute function public.destination_groups_link_audit();

-- ---------------------------------------------------------------------
-- LGPD: direitos do titular
-- ---------------------------------------------------------------------
create or replace function public.contact_personal_data(p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts; v jsonb;
begin
  select * into v_c from public.contacts where id = p_contact_id;
  perform public.assert_owner(v_c.user_id);
  select jsonb_build_object(
    'exported_at', now(),
    'contact', jsonb_build_object('name', v_c.name, 'phone', v_c.normalized_phone, 'original_phone', v_c.original_phone,
                                  'area_code', v_c.area_code, 'validation_status', v_c.validation_status,
                                  'consent_status', v_c.consent_status, 'created_at', v_c.created_at, 'updated_at', v_c.updated_at),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', s.name, 'name_in_source', r.original_name, 'imported_at', r.imported_at) order by r.imported_at)
                           from public.contact_source_relations r join public.contact_sources s on s.id = r.source_id where r.contact_id = v_c.id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('purpose', purpose, 'status', status, 'method', collection_method,
                                  'evidence', evidence_reference, 'obtained_at', obtained_at, 'revoked_at', revoked_at, 'created_at', created_at) order by created_at)
                           from public.consent_records where contact_id = v_c.id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('event', event_type, 'at', occurred_at) order by occurred_at)
                           from public.invitation_events where contact_id = v_c.id), '[]'::jsonb)
  ) into v;
  perform public.log_audit('lgpd.data_exported', 'contact', v_c.id, '{}'::jsonb, v_c.user_id);
  return v;
end;
$$;

-- Exclusão: anonimiza e mantém só a chave do telefone na supressão
create or replace function public.request_contact_deletion(p_contact_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts;
begin
  select * into v_c from public.contacts where id = p_contact_id;
  perform public.assert_owner(v_c.user_id);
  if v_c.deleted_at is not null then return; end if;
  insert into public.suppression_list (user_id, dedup_key, reason, notes)
  values (v_c.user_id, v_c.dedup_key, 'deletion_request', left(p_notes, 300))
  on conflict (user_id, dedup_key) do update set reason = 'deletion_request';
  update public.contact_source_relations set original_name = null, original_phone = null where contact_id = v_c.id;
  delete from public.import_rows where contact_id = v_c.id;
  update public.contacts
     set name = null, original_phone = null, normalized_phone = null, national_number = null, line_type = null,
         validation_status = 'erased', validation_issues = '{}', name_conflicts = '{}', notes = null,
         dedup_key = 'erased:' || v_c.id::text, consent_status = 'blocked', deleted_at = now()
   where id = v_c.id;
  perform public.log_audit('lgpd.deletion', 'contact', v_c.id, '{}'::jsonb, v_c.user_id);
end;
$$;

-- Retenção: limpa linhas de staging e jobs antigos (agendar com pg_cron)
create or replace function public.purge_import_staging(p_older_than interval default interval '30 days')
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if public.jwt_role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Somente o servidor pode executar' using errcode = '42501';
  end if;
  delete from public.import_rows r using public.import_jobs j
   where r.job_id = j.id and j.status in ('completed', 'cancelled', 'failed') and j.completed_at < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Exportação (com regras e auditoria)
-- ---------------------------------------------------------------------
create or replace function public.export_contacts(p_kind text, p_filter jsonb default '{}'::jsonb)
returns table (name text, phone text, area_code text, uf text, validation_status text, consent_status text,
               sources text, occurrences integer, created_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  if p_kind not in ('unique', 'authorized', 'unauthorized', 'duplicates', 'invalid', 'by_source', 'by_ddd', 'segment') then
    raise exception 'Tipo de exportação inválido' using errcode = '22023';
  end if;
  return query
    select s.name, s.normalized_phone, s.area_code, s.uf, s.validation_status, s.consent_status,
           (select string_agg(cs.name, ' | ' order by cs.name) from public.contact_sources cs where cs.id = any (s.source_ids)),
           s.occurrences, s.created_at
      from public.segment_contacts(coalesce(p_filter, '{}'::jsonb) - 'include_suppressed') s
     where s.consent_status not in ('blocked', 'revoked')   -- nunca exporta bloqueados/revogados
       and not s.suppressed
       and case p_kind
             when 'unique' then s.validation_status in ('valid', 'foreign')
             when 'authorized' then s.validation_status in ('valid', 'foreign') and s.consent_status = 'authorized'
             when 'unauthorized' then s.consent_status = 'pending'
             when 'duplicates' then s.occurrences > 1
             when 'invalid' then s.validation_status not in ('valid', 'foreign')
             else true
           end
     order by s.created_at, s.name
     limit 100000;
  get diagnostics v_count = row_count;
  perform public.log_audit('export.contacts', 'contact', null,
    jsonb_build_object('kind', p_kind, 'filter', coalesce(p_filter, '{}'::jsonb), 'rows', v_count));
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard: todos os indicadores vêm do banco
-- ---------------------------------------------------------------------
create or replace function public.dashboard_overview(p_days integer default 30)
returns jsonb language sql stable set search_path = '' as $$
  with me as (select auth.uid() as uid),
  c as (select * from public.contacts, me where user_id = me.uid and deleted_at is null),
  rel as (select r.* from public.contact_source_relations r, me where r.user_id = me.uid)
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_contacts', (select count(*) from c),
      'imported_this_month', (select count(*) from rel where imported_at >= date_trunc('month', now())),
      'unique_contacts', (select count(*) from c where normalized_phone is not null),
      'duplicate_occurrences', (select count(*) from rel join c on c.id = rel.contact_id where c.normalized_phone is not null)
                               - (select count(*) from c where normalized_phone is not null and exists (select 1 from rel where rel.contact_id = c.id)),
      'invalid_contacts', (select count(*) from c where normalized_phone is null),
      'authorized', (select count(*) from c where consent_status = 'authorized'),
      'without_consent', (select count(*) from c where consent_status = 'pending'),
      'blocked_or_revoked', (select count(*) from c where consent_status in ('blocked', 'revoked'))
                            + (select count(*) from public.contacts, me where user_id = me.uid and deleted_at is not null),
      'invites_shared', (select count(distinct (e.campaign_id, e.contact_id)) from public.invitation_events e, me where e.user_id = me.uid and e.event_type = 'shared'),
      'joins_confirmed', (select count(distinct (e.campaign_id, e.contact_id)) from public.invitation_events e, me where e.user_id = me.uid and e.event_type = 'join_confirmed')
    ),
    'imports_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'rows', coalesce(x.n, 0), 'new', coalesce(x.nw, 0)) order by d)
        from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
        left join (select j.created_at::date as day, sum(j.processed_rows) as n, sum(j.new_contacts) as nw
                     from public.import_jobs j, me where j.user_id = me.uid group by 1) x on x.day = d::date), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.name, 'contacts', t.n) order by t.n desc)
        from (select source_id, count(distinct contact_id) as n from rel group by 1) t
        join public.contact_sources s on s.id = t.source_id), '[]'::jsonb),
    'by_ddd', coalesce((
      select jsonb_agg(jsonb_build_object('ddd', t.area_code, 'contacts', t.n) order by t.n desc)
        from (select area_code, count(*) as n from c where normalized_phone is not null and area_code is not null
               group by 1 order by 2 desc limit 15) t), '[]'::jsonb),
    'duplicates_by_import', coalesce((
      select jsonb_agg(jsonb_build_object('file', t.file_name, 'duplicates', t.duplicate_rows, 'at', t.created_at) order by t.created_at)
        from (select j.file_name, j.duplicate_rows, j.created_at from public.import_jobs j, me
               where j.user_id = me.uid and j.status = 'completed' order by j.created_at desc limit 10) t), '[]'::jsonb),
    'joins_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'shared', coalesce(x.sh, 0), 'joined', coalesce(x.jn, 0)) order by d)
        from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
        left join (select e.occurred_at::date as day,
                          count(*) filter (where e.event_type = 'shared') as sh,
                          count(*) filter (where e.event_type = 'join_confirmed') as jn
                     from public.invitation_events e, me where e.user_id = me.uid group by 1) x on x.day = d::date), '[]'::jsonb),
    'consent_distribution', coalesce((
      select jsonb_agg(jsonb_build_object('status', consent_status, 'contacts', n))
        from (select consent_status, count(*) as n from c group by 1) t), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
                                          'metadata', a.metadata, 'created_at', a.created_at) order by a.created_at desc)
        from (select * from public.audit_logs l, me where l.user_id = me.uid order by l.created_at desc limit 15) a), '[]'::jsonb)
  );
$$;
