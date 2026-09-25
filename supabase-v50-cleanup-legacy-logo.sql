-- Gelatos Lele v50 — limpeza pontual da logo legada.
--
-- Execute uma única vez no SQL Editor, depois de confirmar que homeLogoUrl e
-- headerLogoUrl apontam para o R2. Esta rotina faz um snapshot ANTES da
-- alteração, remove somente settings.logoDataUrl e atualiza o catálogo.
-- Não altera estoque, pedidos, receitas, financeiro nem as URLs das imagens.

begin;

with before_cleanup as (
  select store_slug, data, revision
  from public.gelatos_company_state
  where store_slug = 'gelatos-lele'
    and data->'settings' ? 'logoDataUrl'
  for update
), snapshot as (
  insert into public.gelatos_state_snapshots (store_slug, snapshot_date, data, revision, created_by, saved_at)
  select store_slug, current_date, data, revision, null, now()
  from before_cleanup
  on conflict (store_slug, snapshot_date) do update
  set data = excluded.data,
      revision = excluded.revision,
      created_by = excluded.created_by,
      saved_at = excluded.saved_at
  returning store_slug
), cleaned as (
  update public.gelatos_company_state state
  set data = jsonb_set(state.data, '{settings}', (state.data->'settings') - 'logoDataUrl', true),
      revision = state.revision + 1,
      updated_at = now()
  from before_cleanup
  where state.store_slug = before_cleanup.store_slug
  returning state.store_slug, state.data, state.revision, state.updated_at
), catalog as (
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
  select store_slug, public.gelatos_make_catalog(data), updated_at
  from cleaned
  on conflict (store_slug) do update
  set payload = excluded.payload,
      updated_at = excluded.updated_at
  returning store_slug
), audit as (
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, detail)
  select md5(random()::text || clock_timestamp()::text), store_slug, null,
         'legacy_logo_removed', 'settings',
         jsonb_build_object('reason', 'v50 egress guard', 'backupCreated', true)
  from cleaned
  returning store_slug
)
select cleaned.revision, pg_column_size(cleaned.data) as state_bytes_after_cleanup
from cleaned;

commit;
