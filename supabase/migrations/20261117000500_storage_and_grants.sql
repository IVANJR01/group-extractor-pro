-- =====================================================================
-- Storage privado para arquivos importados + privilégios mínimos
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 20971520, array[
  'text/csv', 'text/plain', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Cada usuário só acessa a própria pasta: imports/<user_id>/...
create policy imports_select_own on storage.objects for select to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy imports_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy imports_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- Privilégios: anon não acessa nada; authenticated só o necessário.
-- Alterações sensíveis passam pelas funções (que validam o dono).
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on all tables in schema public to authenticated;

grant update (full_name) on public.profiles to authenticated;
grant insert on public.contact_sources to authenticated;
grant update (name, source_type, description, status) on public.contact_sources to authenticated;
grant update (storage_path) on public.import_jobs to authenticated;
grant insert on public.import_rows to authenticated;
grant update (name, notes) on public.contacts to authenticated;
grant insert on public.audit_logs to authenticated;
grant insert on public.suppression_list to authenticated;
grant insert on public.destination_groups to authenticated;
grant update (name, description, invite_url, invite_link_status, status) on public.destination_groups to authenticated;
grant insert, delete on public.contact_segments to authenticated;
grant update (name, description, filter_definition) on public.contact_segments to authenticated;
grant insert, delete on public.destination_group_segments to authenticated;
grant insert, delete on public.message_templates to authenticated;
grant update (name, body) on public.message_templates to authenticated;
grant insert on public.invitation_campaigns to authenticated;
grant update (name, message_body, status) on public.invitation_campaigns to authenticated;
grant insert on public.invitation_events to authenticated;
-- consent_records: inserção só via register_consent (exige evidência e dono)

grant execute on function
  public.log_audit(text, text, uuid, jsonb, uuid),
  public.register_consent(uuid, text, text, text, text, timestamptz, text, uuid),
  public.block_contact(uuid, text, text),
  public.unblock_contact(uuid),
  public.create_import_job(uuid, text, text, bigint, text, integer, jsonb),
  public.process_import_batch(uuid, integer),
  public.cancel_import_job(uuid),
  public.fail_import_job(uuid, text),
  public.segment_contacts(jsonb),
  public.segment_count(jsonb),
  public.prepare_campaign(uuid),
  public.campaign_contacts(uuid),
  public.campaign_summary(uuid),
  public.contact_personal_data(uuid),
  public.request_contact_deletion(uuid, text),
  public.export_contacts(text, jsonb),
  public.dashboard_overview(integer),
  public.import_progress(public.import_jobs),
  -- usadas dentro de políticas/visões consultadas pelo usuário
  public.is_suppressed(uuid, text),
  public.is_contact_eligible(public.contacts),
  public.jsonb_text_array(jsonb),
  public.name_key(text),
  public.merge_name(text, text),
  public.jwt_role(),
  public.assert_owner(uuid)
to authenticated;

-- O worker (service_role) pode processar e limpar
grant execute on function public.process_import_batch(uuid, integer), public.purge_import_staging(interval),
  public.fail_import_job(uuid, text) to service_role;

-- Novas tabelas/funções não ficam abertas por padrão
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
