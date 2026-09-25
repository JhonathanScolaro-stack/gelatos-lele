-- Gelatos Lele v50 — proteção contra egress desnecessário.
--
-- Esta atualização não altera estoque, pedidos, receitas ou financeiro.
-- Ela mantém a sincronização existente, mas deixa de devolver todo o estado
-- como resposta de um salvamento e rejeita a antiga logo base64 em novos saves.

create or replace function public.gelatos_save_state(p_slug text, p_state jsonb, p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_state public.gelatos_company_state;
  v_role text;
begin
  if jsonb_typeof(p_state) <> 'object' then raise exception 'Dados inválidos.'; end if;
  if auth.uid() is null then raise exception 'Acesso administrativo não autorizado.'; end if;
  v_role := public.gelatos_member_role(p_slug, auth.uid());
  if v_role not in ('owner', 'manager') then raise exception 'Este acesso é somente para consulta. Peça à proprietária para liberar Gestão.'; end if;

  -- `logoDataUrl` é uma chave de versões antigas. As URLs atuais de logo já
  -- apontam para o R2; remover só esta chave impede que uma instalação antiga
  -- volte a transportar centenas de KB a cada edição.
  p_state := jsonb_set(
    p_state,
    '{settings}',
    coalesce(p_state->'settings', '{}'::jsonb) - 'logoDataUrl',
    true
  );

  perform public.gelatos_expire_customer_reservations(p_slug);
  select * into row_state
  from public.gelatos_company_state
  where store_slug = p_slug and revision = p_revision
  for update;
  if row_state.store_slug is null then raise exception 'CONFLITO: os dados foram alterados em outro celular. Atualize a tela e tente novamente.'; end if;

  insert into public.gelatos_state_snapshots (store_slug, snapshot_date, data, revision, created_by, saved_at)
  values (p_slug, current_date, row_state.data, row_state.revision, auth.uid(), now())
  on conflict (store_slug, snapshot_date) do update
  set data = excluded.data, revision = excluded.revision, created_by = excluded.created_by, saved_at = excluded.saved_at;

  update public.gelatos_company_state
  set data = p_state, revision = revision + 1, updated_at = now()
  where store_slug = p_slug
  returning * into row_state;

  insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
  values (p_slug, public.gelatos_make_catalog(row_state.data), now())
  on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;

  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'state_saved', 'company', jsonb_build_object('revision', row_state.revision, 'egressGuard', true));

  -- O aplicativo já possui a cópia que enviou. Para uma gravação bem-sucedida
  -- ele só precisa da nova revisão, não de outra cópia do JSON completo.
  return jsonb_build_object('revision', row_state.revision, 'updatedAt', row_state.updated_at, 'role', v_role);
end;
$$;

revoke all on function public.gelatos_save_state(text, jsonb, bigint) from public;
grant execute on function public.gelatos_save_state(text, jsonb, bigint) to authenticated;
