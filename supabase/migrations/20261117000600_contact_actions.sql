-- =====================================================================
-- Ações da central de contatos: resolver conflito de nome, ocorrências
-- =====================================================================

-- Escolhe o nome correto quando fontes diferentes trouxeram nomes diferentes
create or replace function public.resolve_name_conflict(p_contact_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.contacts;
begin
  select * into v_c from public.contacts where id = p_contact_id and deleted_at is null;
  perform public.assert_owner(v_c.user_id);
  if p_name is null or char_length(btrim(p_name)) = 0 or char_length(p_name) > 200 then
    raise exception 'Nome inválido' using errcode = '22023';
  end if;
  update public.contacts set name = btrim(p_name), name_conflicts = '{}' where id = p_contact_id;
  perform public.log_audit('contact.name_resolved', 'contact', p_contact_id, '{}'::jsonb, v_c.user_id);
end;
$$;

-- Todas as ocorrências de um contato (de quais fontes e importações veio)
create or replace function public.contact_occurrences(p_contact_id uuid)
returns table (source_id uuid, source_name text, import_job_id uuid, file_name text, row_number integer,
               original_name text, original_phone text, imported_at timestamptz)
language sql stable set search_path = '' as $$
  select r.source_id, s.name, r.import_job_id, j.file_name, r.row_number, r.original_name, r.original_phone, r.imported_at
    from public.contact_source_relations r
    join public.contact_sources s on s.id = r.source_id
    join public.import_jobs j on j.id = r.import_job_id
   where r.contact_id = p_contact_id
   order by r.imported_at, r.row_number;
$$;

revoke all on function public.resolve_name_conflict(uuid, text), public.contact_occurrences(uuid) from public, anon;
grant execute on function public.resolve_name_conflict(uuid, text), public.contact_occurrences(uuid) to authenticated;

-- Números por grupo de destino (somente eventos efetivamente registrados)
create or replace function public.group_stats()
returns table (destination_group_id uuid, campaigns bigint, prepared bigint, shared bigint, joined bigint, declined bigint, opt_out bigint)
language sql stable set search_path = '' as $$
  select g.id,
         (select count(*) from public.invitation_campaigns c where c.destination_group_id = g.id),
         count(distinct e.contact_id) filter (where e.event_type = 'prepared'),
         count(distinct e.contact_id) filter (where e.event_type = 'shared'),
         count(distinct e.contact_id) filter (where e.event_type = 'join_confirmed'),
         count(distinct e.contact_id) filter (where e.event_type = 'declined'),
         count(distinct e.contact_id) filter (where e.event_type = 'opt_out')
    from public.destination_groups g
    left join public.invitation_campaigns c on c.destination_group_id = g.id
    left join public.invitation_events e on e.campaign_id = c.id
   group by g.id;
$$;
revoke all on function public.group_stats() from public, anon;
grant execute on function public.group_stats() to authenticated;

-- Exportação paginada (a API devolve no máximo 1.000 linhas por chamada).
-- A auditoria é registrada uma vez, na primeira página.
drop function if exists public.export_contacts(text, jsonb);
create or replace function public.export_contacts(p_kind text, p_filter jsonb default '{}'::jsonb, p_offset integer default 0, p_limit integer default 1000)
returns table (name text, phone text, area_code text, uf text, validation_status text, consent_status text,
               sources text, occurrences integer, created_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  if p_kind not in ('unique', 'authorized', 'unauthorized', 'duplicates', 'invalid', 'by_source', 'by_ddd', 'segment') then
    raise exception 'Tipo de exportação inválido' using errcode = '22023';
  end if;
  if p_offset = 0 then
    perform public.log_audit('export.contacts', 'contact', null,
      jsonb_build_object('kind', p_kind, 'filter', coalesce(p_filter, '{}'::jsonb)));
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
     order by s.created_at, s.id
     offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
end;
$$;
revoke all on function public.export_contacts(text, jsonb, integer, integer) from public, anon;
grant execute on function public.export_contacts(text, jsonb, integer, integer) to authenticated;
