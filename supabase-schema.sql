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
      'fee', coalesce(nullif(replace(replace(regexp_replace(split_part(line, '|', 2), '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0)
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
begin
  if length(trim(coalesce(p_customer, ''))) < 2 then raise exception 'Informe o nome do cliente.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Escolha pelo menos um sabor.'; end if;
  select * into row_state from public.gelatos_company_state where store_slug = p_slug for update;
  if row_state.store_slug is null then raise exception 'Cardápio não encontrado.'; end if;
  v_data := row_state.data;
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
  end if;
  v_total := round(v_subtotal + v_freight, 2);
  v_order := jsonb_build_object('id', v_order_id, 'customer', trim(p_customer), 'phone', '', 'items', v_items, 'subtotal', round(v_subtotal, 2), 'freight', round(v_freight, 2), 'total', v_total, 'cost', round(v_cost, 2), 'profit', round(v_total - v_cost, 2), 'paymentMethod', coalesce(nullif(trim(p_payment), ''), 'Pix'), 'status', 'confirmed', 'date', current_date::text, 'dueDate', current_date::text, 'paidAt', '', 'deliveryMode', coalesce(p_mode, 'Retirada'), 'deliveryZone', coalesce(v_zone->>'name', ''), 'address', coalesce(p_address, ''), 'source', 'cardapio-cliente', 'createdAt', now()::text);
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
revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.gelatos_claim_store(text, text) to authenticated;
grant execute on function public.gelatos_get_state(text) to authenticated;
grant execute on function public.gelatos_save_state(text, jsonb, bigint) to authenticated;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, jsonb) to anon, authenticated;
