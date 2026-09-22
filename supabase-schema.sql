-- Gelatos Lele: banco online (Supabase)
-- Execute este arquivo inteiro no SQL Editor do projeto Supabase uma única vez.

create extension if not exists pgcrypto;

create table if not exists public.gelatos_company_state (
  store_slug text primary key check (store_slug ~ '^[a-z0-9-]{3,60}$'),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  owner_id uuid references auth.users(id) on delete set null,
  activation_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gelatos_public_catalog (
  store_slug text primary key references public.gelatos_company_state(store_slug) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.gelatos_company_state (store_slug, activation_hash)
values ('gelatos-lele', 'b0564e61bdca2dd53a643bdd6f2bf6f5ae499260793b325338c7b5a8709fd9f1')
on conflict (store_slug) do nothing;

insert into public.gelatos_public_catalog (store_slug)
values ('gelatos-lele')
on conflict (store_slug) do nothing;

alter table public.gelatos_company_state enable row level security;
alter table public.gelatos_public_catalog enable row level security;

drop policy if exists gelatos_catalog_read on public.gelatos_public_catalog;
create policy gelatos_catalog_read on public.gelatos_public_catalog
for select to anon, authenticated using (true);

-- Converte o estado interno do aplicativo no cardápio que o cliente pode ver.
create or replace function public.gelatos_make_catalog(p_state jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with settings as (
    select coalesce(p_state->'settings', '{}'::jsonb) as item
  ), categories as (
    select case
      when jsonb_typeof(p_state->'productCategories') = 'array' and jsonb_array_length(p_state->'productCategories') > 0 then p_state->'productCategories'
      else jsonb_build_array(
        jsonb_build_object('id', 'agua', 'name', 'Geladinho de água'),
        jsonb_build_object('id', 'leite', 'name', 'Geladinho de leite'),
        jsonb_build_object('id', 'gourmet', 'name', 'Geladinho gourmet')
      )
    end as items
  ), zones as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', regexp_replace(lower(trim(split_part(line, '|', 1))), '[^a-z0-9]+', '-', 'g'),
      'name', trim(split_part(line, '|', 1)),
      'fee', coalesce(nullif(replace(replace(regexp_replace(split_part(line, '|', 2), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0),
      'cost', coalesce(nullif(replace(replace(regexp_replace(split_part(line, '|', 3), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0)
    ) order by trim(split_part(line, '|', 1))), '[]'::jsonb) as items
    from settings, regexp_split_to_table(coalesce(settings.item->>'deliveryZones', ''), E'\\r?\\n') line
    where trim(split_part(line, '|', 1)) <> ''
  ), products as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', recipe.item->>'id',
      'name', coalesce(recipe.item->>'name', 'Sabor'),
      'categoryId', coalesce(nullif(recipe.item->>'productCategoryId', ''), case lower(coalesce(recipe.item->>'productType', '')) when 'água' then 'agua' when 'agua' then 'agua' when 'leite' then 'leite' else 'gourmet' end),
      'categoryName', coalesce((select category.item->>'name' from jsonb_array_elements(categories.items) category(item) where category.item->>'id' = coalesce(nullif(recipe.item->>'productCategoryId', ''), case lower(coalesce(recipe.item->>'productType', '')) when 'água' then 'agua' when 'agua' then 'agua' when 'leite' then 'leite' else 'gourmet' end) limit 1), nullif(recipe.item->>'productType', ''), 'Geladinho gourmet'),
      'type', coalesce((select category.item->>'name' from jsonb_array_elements(categories.items) category(item) where category.item->>'id' = coalesce(nullif(recipe.item->>'productCategoryId', ''), case lower(coalesce(recipe.item->>'productType', '')) when 'água' then 'agua' when 'agua' then 'agua' when 'leite' then 'leite' else 'gourmet' end) limit 1), nullif(recipe.item->>'productType', ''), 'Geladinho gourmet'),
      'description', coalesce(recipe.item->>'description', ''),
      'price', coalesce(nullif(regexp_replace(coalesce(recipe.item->>'saleUnitPrice', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
      'available', coalesce(nullif(regexp_replace(coalesce(stock.item->>'quantity', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
      'image', case when length(coalesce(recipe.item->>'imageData', '')) < 30000 then coalesce(recipe.item->>'imageData', '') else '' end
    ) order by lower(coalesce(recipe.item->>'name', ''))), '[]'::jsonb) as items
    from categories, jsonb_array_elements(coalesce(p_state->'recipes', '[]'::jsonb)) recipe(item)
    left join lateral (
      select s.item
      from jsonb_array_elements(coalesce(p_state->'readyStock', '[]'::jsonb)) s(item)
      where s.item->>'recipeId' = recipe.item->>'id'
      limit 1
    ) stock on true
    where coalesce((recipe.item->>'active')::boolean, true)
  )
  select jsonb_build_object(
    'store', 'gelatos-lele',
    'brand', coalesce(nullif(settings.item->>'catalogName', ''), 'Gelatos Lele'),
    'intro', coalesce(settings.item->>'catalogIntro', ''),
    'phone', coalesce(settings.item->>'catalogPhone', ''),
    'address', coalesce(settings.item->>'businessAddress', ''),
    'pickupAddress', coalesce(settings.item->>'pickupAddress', ''),
    'deliveryModes', coalesce(settings.item->>'deliveryModes', 'Retirada,Entrega'),
    'deliveryZones', zones.items,
    'freeDeliveryMinValue', coalesce(nullif(regexp_replace(coalesce(settings.item->>'freeDeliveryMinValue', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
    'freeDeliveryMinItems', coalesce(nullif(regexp_replace(coalesce(settings.item->>'freeDeliveryMinItems', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
    'categories', categories.items,
    'products', products.items
  )
  from settings, categories, zones, products;
$$;

create or replace function public.gelatos_claim_store(p_slug text, p_activation_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare row_state public.gelatos_company_state;
begin
  if auth.uid() is null then raise exception 'Faça login antes de ativar a empresa.'; end if;
  update public.gelatos_company_state
  set owner_id = auth.uid(), activation_hash = '', updated_at = now()
  where store_slug = p_slug and owner_id is null and activation_hash = encode(extensions.digest(convert_to(p_activation_code, 'UTF8'), 'sha256'), 'hex')
  returning * into row_state;
  if row_state.store_slug is null then
    select * into row_state from public.gelatos_company_state where store_slug = p_slug and owner_id = auth.uid();
  end if;
  if row_state.store_slug is null then raise exception 'Código de ativação inválido ou empresa já ativada.'; end if;
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision);
end;
$$;

create or replace function public.gelatos_get_state(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare row_state public.gelatos_company_state;
begin
  select * into row_state from public.gelatos_company_state where store_slug = p_slug and owner_id = auth.uid();
  if row_state.store_slug is null then raise exception 'Acesso administrativo não autorizado.'; end if;
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at);
end;
$$;

create or replace function public.gelatos_save_state(p_slug text, p_state jsonb, p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare row_state public.gelatos_company_state;
begin
  if jsonb_typeof(p_state) <> 'object' then raise exception 'Dados inválidos.'; end if;
  update public.gelatos_company_state
  set data = p_state, revision = revision + 1, updated_at = now()
  where store_slug = p_slug and owner_id = auth.uid() and revision = p_revision
  returning * into row_state;
  if row_state.store_slug is null then raise exception 'CONFLITO: os dados foram alterados em outro celular. Atualize a tela e tente novamente.'; end if;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
  values (p_slug, public.gelatos_make_catalog(row_state.data), now())
  on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at);
end;
$$;

create or replace function public.gelatos_place_customer_order(
  p_slug text,
  p_request_id text,
  p_customer text,
  p_mode text,
  p_zone_id text,
  p_address text,
  p_payment text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_state public.gelatos_company_state;
  v_data jsonb;
  v_catalog jsonb;
  v_stock jsonb;
  v_recipe jsonb;
  v_line jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id text;
  v_quantity numeric;
  v_available numeric;
  v_price numeric;
  v_unit_cost numeric;
  v_subtotal numeric := 0;
  v_cost numeric := 0;
  v_freight numeric := 0;
  v_total numeric := 0;
  v_is_delivery boolean := false;
  v_free_value numeric := 0;
  v_free_items numeric := 0;
  v_item_count numeric := 0;
  v_zone jsonb;
  v_order_id text := substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_order jsonb;
  v_existing jsonb;
  v_delivery_cost numeric := 0;
  v_payment_fee numeric := 0;
begin
  if length(trim(coalesce(p_request_id, ''))) < 8 then raise exception 'Não foi possível identificar este pedido. Atualize o cardápio e tente novamente.'; end if;
  if length(trim(coalesce(p_customer, ''))) < 2 then raise exception 'Informe o nome do cliente.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Escolha pelo menos um sabor.'; end if;
  select * into row_state from public.gelatos_company_state where store_slug = p_slug for update;
  if row_state.store_slug is null then raise exception 'Cardápio não encontrado.'; end if;
  v_data := row_state.data;
  select entry.item into v_existing
  from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) entry(item)
  where entry.item->>'requestId' = trim(p_request_id)
  limit 1;
  if v_existing is not null then
    return jsonb_build_object(
      'orderId', v_existing->>'id',
      'total', coalesce((v_existing->>'total')::numeric, 0),
      'freight', coalesce((v_existing->>'freight')::numeric, 0),
      'items', coalesce(v_existing->'items', '[]'::jsonb),
      'replayed', true
    );
  end if;
  v_catalog := public.gelatos_make_catalog(v_data);
  v_is_delivery := lower(coalesce(p_mode, '')) like '%entrega%';
  if v_is_delivery and length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Informe o endereço de entrega completo.'; end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_product_id := v_line->>'productId';
    v_quantity := coalesce(nullif(regexp_replace(coalesce(v_line->>'quantity', ''), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    if v_product_id is null or v_quantity <= 0 then raise exception 'Item do pedido inválido.'; end if;
    select recipe.item into v_recipe from jsonb_array_elements(coalesce(v_data->'recipes', '[]'::jsonb)) as recipe(item) where recipe.item->>'id' = v_product_id and coalesce((recipe.item->>'active')::boolean, true) limit 1;
    select stock.item into v_stock from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) as stock(item) where stock.item->>'recipeId' = v_product_id limit 1;
    if v_recipe is null or v_stock is null then raise exception 'Um sabor escolhido não está mais disponível.'; end if;
    v_available := coalesce(nullif(regexp_replace(coalesce(v_stock->>'quantity', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    if v_available < v_quantity then raise exception 'Estoque insuficiente para %.', coalesce(v_recipe->>'name', 'este sabor'); end if;
    v_price := coalesce(nullif(regexp_replace(coalesce(v_recipe->>'saleUnitPrice', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    v_unit_cost := coalesce(nullif(regexp_replace(coalesce(v_stock->>'unitCost', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    v_subtotal := v_subtotal + v_quantity * v_price;
    v_cost := v_cost + v_quantity * v_unit_cost;
    v_item_count := v_item_count + v_quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId', v_product_id, 'productName', coalesce(v_recipe->>'name', 'Sabor'), 'productCategoryId', coalesce(nullif(v_recipe->>'productCategoryId', ''), 'gourmet'), 'productType', coalesce(nullif(v_recipe->>'productType', ''), 'Geladinho gourmet'), 'quantity', v_quantity, 'saleUnitPrice', v_price, 'unitCost', v_unit_cost, 'total', round(v_quantity * v_price, 2), 'cost', round(v_quantity * v_unit_cost, 2), 'picked', false));
    v_data := jsonb_set(v_data, '{readyStock}', (
      select jsonb_agg(case when stock.item->>'recipeId' = v_product_id then jsonb_set(jsonb_set(stock.item, '{quantity}', to_jsonb(round(v_available - v_quantity, 3))), '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', v_order_id || '-' || v_product_id, 'kind', 'Pedido do cliente', 'quantity', -v_quantity, 'date', current_date::text))) else stock.item end)
      from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) as stock(item)
    ), true);
  end loop;

  v_free_value := coalesce((v_catalog->>'freeDeliveryMinValue')::numeric, 0);
  v_free_items := coalesce((v_catalog->>'freeDeliveryMinItems')::numeric, 0);
  if v_is_delivery then
    select value into v_zone from jsonb_array_elements(coalesce(v_catalog->'deliveryZones', '[]'::jsonb)) value where value->>'id' = p_zone_id limit 1;
    if v_zone is null then raise exception 'Escolha uma região de entrega.'; end if;
    if not ((v_free_value > 0 and v_subtotal >= v_free_value) or (v_free_items > 0 and v_item_count >= v_free_items)) then
      v_freight := coalesce((v_zone->>'fee')::numeric, 0);
    end if;
    v_delivery_cost := coalesce((v_zone->>'cost')::numeric, 0);
  end if;
  v_total := round(v_subtotal + v_freight, 2);
  if lower(coalesce(p_payment, '')) like 'cr%' then
    v_payment_fee := round(v_total * coalesce(nullif(replace(replace(regexp_replace(coalesce(v_data->'settings'->>'creditFeePercent', '0'), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0) / 100, 2);
  elsif lower(coalesce(p_payment, '')) like 'd%' then
    v_payment_fee := round(v_total * coalesce(nullif(replace(replace(regexp_replace(coalesce(v_data->'settings'->>'debitFeePercent', '0'), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0) / 100, 2);
  end if;
  v_order := jsonb_build_object('id', v_order_id, 'requestId', trim(p_request_id), 'customer', trim(p_customer), 'phone', '', 'items', v_items, 'subtotal', round(v_subtotal, 2), 'freight', round(v_freight, 2), 'total', v_total, 'cost', round(v_cost, 2), 'deliveryCost', round(v_delivery_cost, 2), 'paymentFee', round(v_payment_fee, 2), 'profit', round(v_total - v_cost - v_delivery_cost - v_payment_fee, 2), 'paymentMethod', coalesce(nullif(trim(p_payment), ''), 'Pix'), 'status', 'confirmed', 'date', current_date::text, 'dueDate', current_date::text, 'paidAt', '', 'deliveryMode', coalesce(p_mode, 'Retirada'), 'deliveryZone', coalesce(v_zone->>'name', ''), 'address', coalesce(p_address, ''), 'source', 'cardapio-cliente', 'createdAt', now()::text);
  v_data := jsonb_set(v_data, '{orders}', jsonb_build_array(v_order) || coalesce(v_data->'orders', '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{notifications}', jsonb_build_array(jsonb_build_object('id', v_order_id || '-notice', 'type', 'order', 'title', 'Novo pedido: ' || trim(p_customer), 'body', 'Pedido do cardápio no valor de R$ ' || replace(to_char(v_total, 'FM999999990D00'), '.', ','), 'route', 'orders-history', 'date', now()::text, 'read', false)) || coalesce(v_data->'notifications', '[]'::jsonb), true);
  update public.gelatos_company_state set data = v_data, revision = revision + 1, updated_at = now() where store_slug = p_slug;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at) values (p_slug, public.gelatos_make_catalog(v_data), now()) on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  return jsonb_build_object('orderId', v_order_id, 'total', v_total, 'freight', round(v_freight, 2), 'items', v_items);
end;
$$;

revoke all on table public.gelatos_company_state from anon, authenticated;
grant select on table public.gelatos_public_catalog to anon, authenticated;
revoke all on function public.gelatos_claim_store(text, text) from public;
revoke all on function public.gelatos_get_state(text) from public;
revoke all on function public.gelatos_save_state(text, jsonb, bigint) from public;
revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.gelatos_claim_store(text, text) to authenticated;
grant execute on function public.gelatos_get_state(text) to authenticated;
grant execute on function public.gelatos_save_state(text, jsonb, bigint) to authenticated;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- v34 — fundação de produto: acessos por pessoa, trilha de auditoria,
-- reservas temporárias e proteção básica contra repetição de pedidos públicos.
create table if not exists public.gelatos_company_members (
  store_slug text not null references public.gelatos_company_state(store_slug) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'production', 'sales', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (store_slug, user_id)
);

create table if not exists public.gelatos_audit_events (
  id text primary key,
  store_slug text not null references public.gelatos_company_state(store_slug) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gelatos_order_rate_limits (
  store_slug text not null references public.gelatos_company_state(store_slug) on delete cascade,
  client_id text not null,
  bucket timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  primary key (store_slug, client_id, bucket)
);

create table if not exists public.gelatos_state_snapshots (
  store_slug text not null references public.gelatos_company_state(store_slug) on delete cascade,
  snapshot_date date not null,
  data jsonb not null,
  revision bigint not null,
  created_by uuid references auth.users(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (store_slug, snapshot_date)
);

alter table public.gelatos_company_members enable row level security;
alter table public.gelatos_audit_events enable row level security;
alter table public.gelatos_order_rate_limits enable row level security;
alter table public.gelatos_state_snapshots enable row level security;
revoke all on table public.gelatos_company_members, public.gelatos_audit_events, public.gelatos_order_rate_limits, public.gelatos_state_snapshots from anon, authenticated;

-- Migra a proprietária já existente para a tabela de membros sem alterar dados.
insert into public.gelatos_company_members (store_slug, user_id, role)
select store_slug, owner_id, 'owner'
from public.gelatos_company_state
where owner_id is not null
on conflict (store_slug, user_id) do update set role = 'owner';

create or replace function public.gelatos_member_role(p_slug text, p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select member.role
  from public.gelatos_company_members member
  where member.store_slug = p_slug and member.user_id = p_user_id
  limit 1;
$$;

revoke all on function public.gelatos_member_role(text, uuid) from public;

create or replace function public.gelatos_claim_store(p_slug text, p_activation_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare row_state public.gelatos_company_state;
begin
  if auth.uid() is null then raise exception 'Faça login antes de ativar a empresa.'; end if;
  update public.gelatos_company_state
  set owner_id = auth.uid(), activation_hash = '', updated_at = now()
  where store_slug = p_slug and owner_id is null and activation_hash = encode(extensions.digest(convert_to(p_activation_code, 'UTF8'), 'sha256'), 'hex')
  returning * into row_state;
  if row_state.store_slug is null then
    select * into row_state from public.gelatos_company_state where store_slug = p_slug and owner_id = auth.uid();
  end if;
  if row_state.store_slug is null then raise exception 'Código de ativação inválido ou empresa já ativada.'; end if;
  insert into public.gelatos_company_members (store_slug, user_id, role)
  values (p_slug, auth.uid(), 'owner')
  on conflict (store_slug, user_id) do update set role = 'owner';
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'company_claimed', 'company');
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at, 'role', 'owner');
end;
$$;

create or replace function public.gelatos_expire_customer_reservations(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_state public.gelatos_company_state;
  v_data jsonb;
  v_order jsonb;
  v_line jsonb;
  v_changed boolean := false;
begin
  select * into row_state
  from public.gelatos_company_state
  where store_slug = p_slug
  for update;
  if row_state.store_slug is null then raise exception 'Cardápio não encontrado.'; end if;
  v_data := row_state.data;

  for v_order in
    select entry.item
    from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) entry(item)
    where entry.item->>'status' = 'reserved'
      and nullif(entry.item->>'reservationExpiresAt', '') is not null
      and (entry.item->>'reservationExpiresAt')::timestamptz <= now()
  loop
    for v_line in select value from jsonb_array_elements(coalesce(v_order->'items', '[]'::jsonb)) loop
      v_data := jsonb_set(v_data, '{readyStock}', coalesce((
        select jsonb_agg(
          case when stock.item->>'recipeId' = v_line->>'productId' then
            jsonb_set(
              jsonb_set(stock.item, '{quantity}', to_jsonb(round(coalesce(nullif(stock.item->>'quantity', '')::numeric, 0) + coalesce(nullif(v_line->>'quantity', '')::numeric, 0), 3))),
              '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'id', 'expired-' || coalesce(v_order->>'id', '') || '-' || coalesce(v_line->>'productId', ''),
                'kind', 'Reserva expirada',
                'quantity', coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
                'date', current_date::text
              ))
            )
          else stock.item end
          order by stock.ordinality
        )
        from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) with ordinality stock(item, ordinality)
      ), '[]'::jsonb), true);
    end loop;

    v_data := jsonb_set(v_data, '{orders}', coalesce((
      select jsonb_agg(
        case when entry.item->>'id' = v_order->>'id' then
          entry.item || jsonb_build_object('status', 'expired', 'expiredAt', now()::text, 'reservationExpiresAt', '')
        else entry.item end
        order by entry.ordinality
      )
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) with ordinality entry(item, ordinality)
    ), '[]'::jsonb), true);
    insert into public.gelatos_audit_events (id, store_slug, event_type, entity_type, entity_id, detail)
    values (md5(random()::text || clock_timestamp()::text), p_slug, 'reservation_expired', 'order', v_order->>'id', jsonb_build_object('customer', v_order->>'customer'));
    v_changed := true;
  end loop;

  if v_changed then
    update public.gelatos_company_state
    set data = v_data, revision = revision + 1, updated_at = now()
    where store_slug = p_slug;
    insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
    values (p_slug, public.gelatos_make_catalog(v_data), now())
    on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  end if;
  return v_data;
end;
$$;

revoke all on function public.gelatos_expire_customer_reservations(text) from public;

create or replace function public.gelatos_get_state(p_slug text)
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
  perform public.gelatos_expire_customer_reservations(p_slug);
  select * into row_state from public.gelatos_company_state where store_slug = p_slug;
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at, 'role', v_role);
end;
$$;

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
  -- As cópias ficam preservadas: uma política de retenção pode ser definida
  -- futuramente, sem remover o histórico por uma atualização do aplicativo.
  update public.gelatos_company_state
  set data = p_state, revision = revision + 1, updated_at = now()
  where store_slug = p_slug
  returning * into row_state;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
  values (p_slug, public.gelatos_make_catalog(row_state.data), now())
  on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'state_saved', 'company', jsonb_build_object('revision', row_state.revision));
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at, 'role', v_role);
end;
$$;

create or replace function public.gelatos_get_public_catalog(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_payload jsonb;
begin
  perform public.gelatos_expire_customer_reservations(p_slug);
  select payload into v_payload from public.gelatos_public_catalog where store_slug = p_slug;
  if v_payload is null then raise exception 'Cardápio não encontrado.'; end if;
  return jsonb_build_object('payload', v_payload);
end;
$$;

create or replace function public.gelatos_list_members(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  v_role := public.gelatos_member_role(p_slug, auth.uid());
  if v_role not in ('owner', 'manager') then raise exception 'Sem permissão para ver a equipe.'; end if;
  return jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object('userId', member.user_id, 'email', user_row.email, 'role', member.role, 'createdAt', member.created_at) order by case member.role when 'owner' then 0 else 1 end, lower(user_row.email))
    from public.gelatos_company_members member
    left join auth.users user_row on user_row.id = member.user_id
    where member.store_slug = p_slug
  ), '[]'::jsonb));
end;
$$;

create or replace function public.gelatos_add_member(p_slug text, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  if public.gelatos_member_role(p_slug, auth.uid()) <> 'owner' then raise exception 'Somente a proprietária pode liberar acessos.'; end if;
  if p_role not in ('manager', 'production', 'sales', 'viewer') then raise exception 'Papel de acesso inválido.'; end if;
  select id into v_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user_id is null then raise exception 'Esta pessoa ainda não criou acesso. Peça para ela usar “Criar acesso novo” antes.'; end if;
  insert into public.gelatos_company_members (store_slug, user_id, role)
  values (p_slug, v_user_id, p_role)
  on conflict (store_slug, user_id) do update set role = excluded.role;
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, entity_id, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'member_granted', 'member', v_user_id::text, jsonb_build_object('role', p_role));
  return public.gelatos_list_members(p_slug);
end;
$$;

create or replace function public.gelatos_remove_member(p_slug text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.gelatos_member_role(p_slug, auth.uid()) <> 'owner' then raise exception 'Somente a proprietária pode remover acessos.'; end if;
  if p_user_id = auth.uid() then raise exception 'A proprietária não pode remover o próprio acesso.'; end if;
  delete from public.gelatos_company_members where store_slug = p_slug and user_id = p_user_id and role <> 'owner';
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, entity_id)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'member_removed', 'member', p_user_id::text);
  return public.gelatos_list_members(p_slug);
end;
$$;

create or replace function public.gelatos_list_backups(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  v_role := public.gelatos_member_role(p_slug, auth.uid());
  if v_role not in ('owner', 'manager') then raise exception 'Sem permissão para ver cópias da nuvem.'; end if;
  return jsonb_build_object('backups', coalesce((
    select jsonb_agg(jsonb_build_object('snapshotDate', snapshot.snapshot_date, 'revision', snapshot.revision, 'savedAt', snapshot.saved_at) order by snapshot.snapshot_date desc)
    from public.gelatos_state_snapshots snapshot
    where snapshot.store_slug = p_slug
  ), '[]'::jsonb));
end;
$$;

create or replace function public.gelatos_restore_backup(p_slug text, p_snapshot_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_state public.gelatos_company_state;
  v_snapshot public.gelatos_state_snapshots;
begin
  if public.gelatos_member_role(p_slug, auth.uid()) <> 'owner' then raise exception 'Somente a proprietária pode restaurar uma cópia.'; end if;
  select * into v_snapshot from public.gelatos_state_snapshots where store_slug = p_slug and snapshot_date = p_snapshot_date;
  if v_snapshot.store_slug is null then raise exception 'Cópia não encontrada.'; end if;
  select * into row_state from public.gelatos_company_state where store_slug = p_slug for update;
  insert into public.gelatos_state_snapshots (store_slug, snapshot_date, data, revision, created_by, saved_at)
  values (p_slug, current_date, row_state.data, row_state.revision, auth.uid(), now())
  on conflict (store_slug, snapshot_date) do update
  set data = excluded.data, revision = excluded.revision, created_by = excluded.created_by, saved_at = excluded.saved_at;
  update public.gelatos_company_state
  set data = v_snapshot.data, revision = revision + 1, updated_at = now()
  where store_slug = p_slug
  returning * into row_state;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at)
  values (p_slug, public.gelatos_make_catalog(row_state.data), now())
  on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  insert into public.gelatos_audit_events (id, store_slug, actor_id, event_type, entity_type, entity_id, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, auth.uid(), 'backup_restored', 'snapshot', p_snapshot_date::text, jsonb_build_object('restoredRevision', v_snapshot.revision));
  return jsonb_build_object('state', row_state.data, 'revision', row_state.revision, 'updatedAt', row_state.updated_at);
end;
$$;

revoke all on function public.gelatos_get_public_catalog(text) from public;
revoke all on function public.gelatos_list_members(text) from public;
revoke all on function public.gelatos_add_member(text, text, text) from public;
revoke all on function public.gelatos_remove_member(text, uuid) from public;
revoke all on function public.gelatos_list_backups(text) from public;
revoke all on function public.gelatos_restore_backup(text, date) from public;
grant execute on function public.gelatos_get_public_catalog(text) to anon, authenticated;
grant execute on function public.gelatos_list_members(text) to authenticated;
grant execute on function public.gelatos_add_member(text, text, text) to authenticated;
grant execute on function public.gelatos_remove_member(text, uuid) to authenticated;
grant execute on function public.gelatos_list_backups(text) to authenticated;
grant execute on function public.gelatos_restore_backup(text, date) to authenticated;

create or replace function public.gelatos_place_customer_order(
  p_slug text,
  p_request_id text,
  p_client_id text,
  p_customer text,
  p_phone text,
  p_mode text,
  p_zone_id text,
  p_address text,
  p_payment text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_state public.gelatos_company_state;
  v_data jsonb;
  v_catalog jsonb;
  v_stock jsonb;
  v_recipe jsonb;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id text;
  v_quantity numeric;
  v_available numeric;
  v_price numeric;
  v_unit_cost numeric;
  v_subtotal numeric := 0;
  v_cost numeric := 0;
  v_freight numeric := 0;
  v_total numeric := 0;
  v_is_delivery boolean := false;
  v_free_value numeric := 0;
  v_free_items numeric := 0;
  v_item_count numeric := 0;
  v_zone jsonb;
  v_order_id text := substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_order jsonb;
  v_existing jsonb;
  v_delivery_cost numeric := 0;
  v_payment_fee numeric := 0;
  v_attempts integer;
  v_reservation_minutes integer;
  v_reservation_expires_at timestamptz;
begin
  if length(trim(coalesce(p_request_id, ''))) < 8 then raise exception 'Não foi possível identificar este pedido. Atualize o cardápio e tente novamente.'; end if;
  if length(trim(coalesce(p_client_id, ''))) < 16 then raise exception 'Não foi possível validar este pedido. Atualize o cardápio e tente novamente.'; end if;
  if length(trim(coalesce(p_customer, ''))) < 2 then raise exception 'Informe o nome do cliente.'; end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 10 then raise exception 'Informe um WhatsApp válido para confirmar o pedido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Escolha pelo menos um sabor.'; end if;

  perform public.gelatos_expire_customer_reservations(p_slug);
  select * into row_state from public.gelatos_company_state where store_slug = p_slug for update;
  if row_state.store_slug is null then raise exception 'Cardápio não encontrado.'; end if;
  v_data := row_state.data;
  select entry.item into v_existing
  from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) entry(item)
  where entry.item->>'requestId' = trim(p_request_id)
  limit 1;
  if v_existing is not null then
    if v_existing->>'status' = 'expired' then raise exception 'A reserva deste pedido venceu. Atualize o cardápio para fazer um novo pedido.'; end if;
    return jsonb_build_object(
      'orderId', v_existing->>'id',
      'total', coalesce((v_existing->>'total')::numeric, 0),
      'freight', coalesce((v_existing->>'freight')::numeric, 0),
      'items', coalesce(v_existing->'items', '[]'::jsonb),
      'reservationExpiresAt', coalesce(v_existing->>'reservationExpiresAt', ''),
      'status', coalesce(v_existing->>'status', 'reserved'),
      'replayed', true
    );
  end if;

  insert into public.gelatos_order_rate_limits (store_slug, client_id, bucket, attempts)
  values (p_slug, left(trim(p_client_id), 128), date_trunc('hour', now()), 1)
  on conflict (store_slug, client_id, bucket) do update set attempts = public.gelatos_order_rate_limits.attempts + 1
  returning attempts into v_attempts;
  if v_attempts > 8 then raise exception 'Muitas tentativas deste aparelho. Aguarde um pouco e tente novamente.'; end if;

  v_catalog := public.gelatos_make_catalog(v_data);
  v_is_delivery := lower(coalesce(p_mode, '')) like '%entrega%';
  if v_is_delivery and length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Informe o endereço de entrega completo.'; end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_product_id := v_line->>'productId';
    v_quantity := coalesce(nullif(regexp_replace(coalesce(v_line->>'quantity', ''), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    if v_product_id is null or v_quantity <= 0 then raise exception 'Item do pedido inválido.'; end if;
    select recipe.item into v_recipe from jsonb_array_elements(coalesce(v_data->'recipes', '[]'::jsonb)) as recipe(item) where recipe.item->>'id' = v_product_id and coalesce((recipe.item->>'active')::boolean, true) limit 1;
    select stock.item into v_stock from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) as stock(item) where stock.item->>'recipeId' = v_product_id limit 1;
    if v_recipe is null or v_stock is null then raise exception 'Um sabor escolhido não está mais disponível.'; end if;
    v_available := coalesce(nullif(regexp_replace(coalesce(v_stock->>'quantity', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    if v_available < v_quantity then raise exception 'Estoque insuficiente para %.', coalesce(v_recipe->>'name', 'este sabor'); end if;
    v_price := coalesce(nullif(regexp_replace(coalesce(v_recipe->>'saleUnitPrice', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    v_unit_cost := coalesce(nullif(regexp_replace(coalesce(v_stock->>'unitCost', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0);
    v_subtotal := v_subtotal + v_quantity * v_price;
    v_cost := v_cost + v_quantity * v_unit_cost;
    v_item_count := v_item_count + v_quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId', v_product_id, 'productName', coalesce(v_recipe->>'name', 'Sabor'), 'productCategoryId', coalesce(nullif(v_recipe->>'productCategoryId', ''), 'gourmet'), 'productType', coalesce(nullif(v_recipe->>'productType', ''), 'Geladinho gourmet'), 'quantity', v_quantity, 'saleUnitPrice', v_price, 'unitCost', v_unit_cost, 'total', round(v_quantity * v_price, 2), 'cost', round(v_quantity * v_unit_cost, 2), 'picked', false));
    v_data := jsonb_set(v_data, '{readyStock}', (
      select jsonb_agg(case when stock.item->>'recipeId' = v_product_id then jsonb_set(jsonb_set(stock.item, '{quantity}', to_jsonb(round(v_available - v_quantity, 3))), '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', v_order_id || '-' || v_product_id, 'kind', 'Reserva do cliente', 'quantity', -v_quantity, 'date', current_date::text))) else stock.item end)
      from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) as stock(item)
    ), true);
  end loop;

  v_free_value := coalesce((v_catalog->>'freeDeliveryMinValue')::numeric, 0);
  v_free_items := coalesce((v_catalog->>'freeDeliveryMinItems')::numeric, 0);
  if v_is_delivery then
    select value into v_zone from jsonb_array_elements(coalesce(v_catalog->'deliveryZones', '[]'::jsonb)) value where value->>'id' = p_zone_id limit 1;
    if v_zone is null then raise exception 'Escolha uma região de entrega.'; end if;
    if not ((v_free_value > 0 and v_subtotal >= v_free_value) or (v_free_items > 0 and v_item_count >= v_free_items)) then
      v_freight := coalesce((v_zone->>'fee')::numeric, 0);
    end if;
    v_delivery_cost := coalesce((v_zone->>'cost')::numeric, 0);
  end if;
  v_total := round(v_subtotal + v_freight, 2);
  if lower(coalesce(p_payment, '')) like 'cr%' then
    v_payment_fee := round(v_total * coalesce(nullif(replace(replace(regexp_replace(coalesce(v_data->'settings'->>'creditFeePercent', '0'), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0) / 100, 2);
  elsif lower(coalesce(p_payment, '')) like 'd%' then
    v_payment_fee := round(v_total * coalesce(nullif(replace(replace(regexp_replace(coalesce(v_data->'settings'->>'debitFeePercent', '0'), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0) / 100, 2);
  end if;
  v_reservation_minutes := greatest(5, least(120, coalesce(nullif(regexp_replace(coalesce(v_data->'settings'->>'reservationMinutes', '20'), '[^0-9]', '', 'g'), '')::integer, 20)));
  v_reservation_expires_at := now() + make_interval(mins => v_reservation_minutes);
  v_order := jsonb_build_object('id', v_order_id, 'requestId', trim(p_request_id), 'customer', trim(p_customer), 'phone', trim(p_phone), 'items', v_items, 'subtotal', round(v_subtotal, 2), 'freight', round(v_freight, 2), 'total', v_total, 'cost', round(v_cost, 2), 'deliveryCost', round(v_delivery_cost, 2), 'paymentFee', round(v_payment_fee, 2), 'profit', round(v_total - v_cost - v_delivery_cost - v_payment_fee, 2), 'paymentMethod', coalesce(nullif(trim(p_payment), ''), 'Pix'), 'status', 'reserved', 'reservationExpiresAt', v_reservation_expires_at::text, 'date', current_date::text, 'dueDate', current_date::text, 'paidAt', '', 'deliveryMode', coalesce(p_mode, 'Retirada'), 'deliveryZone', coalesce(v_zone->>'name', ''), 'address', coalesce(p_address, ''), 'source', 'cardapio-cliente', 'createdAt', now()::text);
  v_data := jsonb_set(v_data, '{orders}', jsonb_build_array(v_order) || coalesce(v_data->'orders', '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{notifications}', jsonb_build_array(jsonb_build_object('id', v_order_id || '-notice', 'type', 'order', 'title', 'Novo pedido para aprovar: ' || trim(p_customer), 'body', 'Reserva até ' || to_char(v_reservation_expires_at, 'HH24:MI') || ' · total R$ ' || replace(to_char(v_total, 'FM999999990D00'), '.', ','), 'route', 'orders-history', 'date', now()::text, 'read', false)) || coalesce(v_data->'notifications', '[]'::jsonb), true);
  update public.gelatos_company_state set data = v_data, revision = revision + 1, updated_at = now() where store_slug = p_slug;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at) values (p_slug, public.gelatos_make_catalog(v_data), now()) on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  insert into public.gelatos_audit_events (id, store_slug, event_type, entity_type, entity_id, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, 'customer_order_reserved', 'order', v_order_id, jsonb_build_object('source', 'customer_catalog', 'reservationExpiresAt', v_reservation_expires_at));
  return jsonb_build_object('orderId', v_order_id, 'total', v_total, 'freight', round(v_freight, 2), 'items', v_items, 'reservationExpiresAt', v_reservation_expires_at::text, 'status', 'reserved');
end;
$$;

revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
-- Clientes antigos devem atualizar o PWA antes de criar novos pedidos públicos.
revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, jsonb) from anon, authenticated;
do $$
begin
  if to_regprocedure('public.gelatos_place_customer_order(text, text, text, text, text, text, jsonb)') is not null then
    execute 'revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, jsonb) from anon, authenticated';
  end if;
end;
$$;
