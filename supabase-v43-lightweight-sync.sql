-- Gelatos Lele v43 — consulta leve para a sincronização.
-- Em vez de baixar toda a empresa a cada poucos segundos, o app verifica
-- somente a revisão. O estado completo só é transferido quando há alteração.

create or replace function public.gelatos_get_revision(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_state public.gelatos_company_state;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Acesso administrativo não autorizado.'; end if;
  v_role := public.gelatos_member_role(p_slug, auth.uid());
  if v_role is null then raise exception 'Acesso administrativo não autorizado.'; end if;
  select * into row_state from public.gelatos_company_state where store_slug = p_slug;
  if row_state.store_slug is null then raise exception 'Empresa não encontrada.'; end if;
  return jsonb_build_object('revision', row_state.revision, 'updatedAt', row_state.updated_at, 'role', v_role);
end;
$$;

revoke all on function public.gelatos_get_revision(text) from public;
grant execute on function public.gelatos_get_revision(text) to authenticated;
