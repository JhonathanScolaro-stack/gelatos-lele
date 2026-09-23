-- Gelatos Lele v38 — encomendas agendadas.
-- Execute este arquivo inteiro UMA vez no SQL Editor do mesmo projeto Supabase.
-- Não altera pedidos ou estoque já existentes.

create or replace function public.gelatos_to_number(p_value text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then 0::numeric
    when position(',' in p_value) > 0 and position('.' in p_value) > 0
      then coalesce(nullif(replace(replace(regexp_replace(p_value, '[^0-9,.-]', '', 'g'), '.', ''), ',', '.'), '')::numeric, 0)
    when position(',' in p_value) > 0
      then coalesce(nullif(replace(regexp_replace(p_value, '[^0-9,.-]', '', 'g'), ',', '.'), '')::numeric, 0)
    else coalesce(nullif(regexp_replace(p_value, '[^0-9.-]', '', 'g'), '')::numeric, 0)
  end;
$$;

-- Usa os custos atuais da receita para estimar a margem de uma encomenda
-- antes de ela virar estoque pronto. As conversões seguem as mesmas regras
-- do aplicativo: ml/L e g/kg.
create or replace function public.gelatos_recipe_unit_cost(p_data jsonb, p_recipe jsonb)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_line jsonb;
  v_supply jsonb;
  v_quantity numeric;
  v_cost numeric := 0;
  v_unit_cost numeric;
  v_from text;
  v_to text;
  v_yield numeric := public.gelatos_to_number(p_recipe->>'yieldUnits');
  v_labor numeric := public.gelatos_to_number(p_recipe->>'laborAmount');
begin
  if v_yield <= 0 then raise exception 'A receita % precisa ter rendimento maior que zero.', coalesce(p_recipe->>'name', ''); end if;
  for v_line in select value from jsonb_array_elements(coalesce(p_recipe->'items', '[]'::jsonb)) loop
    select entry.item into v_supply
    from jsonb_array_elements(coalesce(p_data->'supplies', '[]'::jsonb)) entry(item)
    where entry.item->>'id' = v_line->>'supplyId'
    limit 1;
    if v_supply is null then raise exception 'Um item da receita % não está mais cadastrado no estoque.', coalesce(p_recipe->>'name', ''); end if;
    v_quantity := public.gelatos_to_number(v_line->>'quantity');
    if v_quantity <= 0 then raise exception 'A receita % possui uma quantidade inválida.', coalesce(p_recipe->>'name', ''); end if;
    v_from := lower(trim(coalesce(nullif(v_line->>'unit', ''), v_supply->>'unit', 'un.')));
    v_to := lower(trim(coalesce(v_supply->>'unit', 'un.')));
    if v_from = 'l' and v_to = 'ml' then v_quantity := v_quantity * 1000;
    elsif v_from = 'ml' and v_to = 'l' then v_quantity := v_quantity / 1000;
    elsif v_from = 'kg' and v_to = 'g' then v_quantity := v_quantity * 1000;
    elsif v_from = 'g' and v_to = 'kg' then v_quantity := v_quantity / 1000;
    elsif v_from <> v_to then raise exception 'A unidade de % é incompatível com o estoque.', coalesce(v_supply->>'name', 'este item');
    end if;
    v_unit_cost := public.gelatos_to_number(v_supply->>'averageUnitCost');
    v_cost := v_cost + v_quantity * v_unit_cost;
  end loop;
  if lower(coalesce(p_recipe->>'laborMode', 'batch')) = 'unit' then v_labor := v_labor * v_yield; end if;
  return round((v_cost + v_labor) / v_yield, 2);
end;
$$;

-- O cardápio público inclui as regras de encomenda, mas nunca dados internos.
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
      'fee', public.gelatos_to_number(split_part(line, '|', 2)),
      'cost', public.gelatos_to_number(split_part(line, '|', 3))
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
      'price', public.gelatos_to_number(recipe.item->>'saleUnitPrice'),
      'available', public.gelatos_to_number(stock.item->>'quantity'),
      'image', coalesce(recipe.item->>'imageData', '')
    ) order by lower(coalesce(recipe.item->>'name', ''))), '[]'::jsonb) as items
    from categories, jsonb_array_elements(coalesce(p_state->'recipes', '[]'::jsonb)) recipe(item)
    left join lateral (
      select s.item from jsonb_array_elements(coalesce(p_state->'readyStock', '[]'::jsonb)) s(item)
      where s.item->>'recipeId' = recipe.item->>'id' limit 1
    ) stock on true
    where coalesce((recipe.item->>'active')::boolean, true)
  )
  select jsonb_build_object(
    'store', 'gelatos-lele',
    'brand', coalesce(nullif(settings.item->>'catalogName', ''), 'Gelatos Lele'),
    'logo', coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''), ''),
    'intro', coalesce(settings.item->>'catalogIntro', ''),
    'phone', coalesce(settings.item->>'catalogPhone', ''),
    'address', coalesce(settings.item->>'businessAddress', ''),
    'pickupAddress', coalesce(settings.item->>'pickupAddress', ''),
    'deliveryModes', coalesce(settings.item->>'deliveryModes', 'Retirada,Entrega'),
    'deliveryZones', zones.items,
    'freeDeliveryMinValue', public.gelatos_to_number(settings.item->>'freeDeliveryMinValue'),
    'freeDeliveryMinItems', public.gelatos_to_number(settings.item->>'freeDeliveryMinItems'),
    'scheduledEnabled', lower(coalesce(settings.item->>'scheduledEnabled', 'true')) not in ('false', '0', 'nao', 'não'),
    'scheduledLeadDays', greatest(2, least(30, floor(public.gelatos_to_number(settings.item->>'scheduledLeadDays'))::integer)),
    'scheduledMaxItemsPerDay', greatest(0, public.gelatos_to_number(settings.item->>'scheduledMaxItemsPerDay')),
    'categories', categories.items,
    'products', products.items
  ) from settings, categories, zones, products;
$$;

create or replace function public.gelatos_place_customer_order(
  p_slug text, p_request_id text, p_client_id text, p_customer text, p_phone text,
  p_mode text, p_zone_id text, p_address text, p_payment text,
  p_order_kind text, p_scheduled_for date, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_state public.gelatos_company_state;
  v_data jsonb; v_catalog jsonb; v_stock jsonb; v_recipe jsonb; v_line jsonb;
  v_items jsonb := '[]'::jsonb; v_product_id text; v_quantity numeric; v_available numeric;
  v_price numeric; v_unit_cost numeric; v_subtotal numeric := 0; v_cost numeric := 0;
  v_freight numeric := 0; v_total numeric := 0; v_is_delivery boolean := false;
  v_is_scheduled boolean := false; v_order_kind text := 'ready'; v_due_date date;
  v_business_today date; v_lead_days integer; v_capacity numeric; v_scheduled_total numeric := 0;
  v_free_value numeric := 0; v_free_items numeric := 0; v_item_count numeric := 0;
  v_zone jsonb; v_order_id text := substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  v_order jsonb; v_existing jsonb; v_delivery_cost numeric := 0; v_payment_fee numeric := 0;
  v_attempts integer; v_reservation_minutes integer; v_reservation_expires_at timestamptz;
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
  select entry.item into v_existing from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) entry(item)
  where entry.item->>'requestId' = trim(p_request_id) limit 1;
  if v_existing is not null then
    if v_existing->>'status' = 'expired' then raise exception 'A reserva deste pedido venceu. Atualize o cardápio para fazer um novo pedido.'; end if;
    return jsonb_build_object('orderId', v_existing->>'id', 'total', public.gelatos_to_number(v_existing->>'total'), 'freight', public.gelatos_to_number(v_existing->>'freight'), 'items', coalesce(v_existing->'items', '[]'::jsonb), 'reservationExpiresAt', coalesce(v_existing->>'reservationExpiresAt', ''), 'status', coalesce(v_existing->>'status', 'reserved'), 'orderKind', coalesce(v_existing->>'orderKind', 'ready'), 'scheduledFor', coalesce(v_existing->>'scheduledFor', ''), 'replayed', true);
  end if;

  insert into public.gelatos_order_rate_limits (store_slug, client_id, bucket, attempts)
  values (p_slug, left(trim(p_client_id), 128), date_trunc('hour', now()), 1)
  on conflict (store_slug, client_id, bucket) do update set attempts = public.gelatos_order_rate_limits.attempts + 1
  returning attempts into v_attempts;
  if v_attempts > 8 then raise exception 'Muitas tentativas deste aparelho. Aguarde um pouco e tente novamente.'; end if;

  v_catalog := public.gelatos_make_catalog(v_data);
  v_is_delivery := lower(coalesce(p_mode, '')) like '%entrega%';
  if v_is_delivery and length(trim(coalesce(p_address, ''))) < 5 then raise exception 'Informe o endereço de entrega completo.'; end if;
  v_is_scheduled := lower(trim(coalesce(p_order_kind, 'ready'))) in ('scheduled', 'encomenda', 'encomenda-agendada');
  v_business_today := timezone('America/Sao_Paulo', now())::date;
  if v_is_scheduled then
    if coalesce((v_catalog->>'scheduledEnabled')::boolean, true) = false then raise exception 'Encomendas não estão disponíveis neste cardápio.'; end if;
    v_lead_days := greatest(2, least(30, public.gelatos_to_number(v_catalog->>'scheduledLeadDays')::integer));
    if p_scheduled_for is null or p_scheduled_for < v_business_today + v_lead_days then raise exception 'Escolha uma data de encomenda a partir de %.', to_char(v_business_today + v_lead_days, 'DD/MM/YYYY'); end if;
    v_order_kind := 'scheduled'; v_due_date := p_scheduled_for;
  else
    v_due_date := v_business_today;
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_product_id := v_line->>'productId';
    v_quantity := public.gelatos_to_number(v_line->>'quantity');
    if v_product_id is null or v_quantity <= 0 then raise exception 'Item do pedido inválido.'; end if;
    select recipe.item into v_recipe from jsonb_array_elements(coalesce(v_data->'recipes', '[]'::jsonb)) recipe(item)
    where recipe.item->>'id' = v_product_id and coalesce((recipe.item->>'active')::boolean, true) limit 1;
    if v_recipe is null then raise exception 'Um sabor escolhido não está mais disponível no cardápio.'; end if;
    select stock.item into v_stock from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) stock(item)
    where stock.item->>'recipeId' = v_product_id limit 1;
    v_price := public.gelatos_to_number(v_recipe->>'saleUnitPrice');
    if v_is_scheduled then
      v_unit_cost := public.gelatos_recipe_unit_cost(v_data, v_recipe);
    else
      if v_stock is null then raise exception 'Um sabor escolhido não está mais disponível para pronta entrega.'; end if;
      v_available := public.gelatos_to_number(v_stock->>'quantity');
      if v_available < v_quantity then raise exception 'Estoque insuficiente para %.', coalesce(v_recipe->>'name', 'este sabor'); end if;
      v_unit_cost := public.gelatos_to_number(v_stock->>'unitCost');
      v_data := jsonb_set(v_data, '{readyStock}', (
        select jsonb_agg(case when stock.item->>'recipeId' = v_product_id then jsonb_set(jsonb_set(stock.item, '{quantity}', to_jsonb(round(v_available - v_quantity, 3))), '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', v_order_id || '-' || v_product_id, 'kind', 'Reserva do cliente', 'quantity', -v_quantity, 'date', v_business_today::text))) else stock.item end)
        from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) stock(item)
      ), true);
    end if;
    v_subtotal := v_subtotal + v_quantity * v_price; v_cost := v_cost + v_quantity * v_unit_cost; v_item_count := v_item_count + v_quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId', v_product_id, 'productName', coalesce(v_recipe->>'name', 'Sabor'), 'productCategoryId', coalesce(nullif(v_recipe->>'productCategoryId', ''), 'gourmet'), 'productType', coalesce(nullif(v_recipe->>'productType', ''), 'Geladinho gourmet'), 'quantity', v_quantity, 'saleUnitPrice', v_price, 'unitCost', v_unit_cost, 'total', round(v_quantity * v_price, 2), 'cost', round(v_quantity * v_unit_cost, 2), 'picked', false));
  end loop;

  if v_is_scheduled then
    v_capacity := greatest(0, public.gelatos_to_number(v_catalog->>'scheduledMaxItemsPerDay'));
    if v_capacity > 0 then
      select coalesce(sum(public.gelatos_to_number(line.item->>'quantity')), 0) into v_scheduled_total
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) ord(item)
      cross join lateral jsonb_array_elements(coalesce(ord.item->'items', '[]'::jsonb)) line(item)
      where ord.item->>'orderKind' = 'scheduled' and ord.item->>'scheduledFor' = p_scheduled_for::text
        and coalesce(ord.item->>'status', '') not in ('cancelled', 'expired');
      if v_scheduled_total + v_item_count > v_capacity then raise exception 'Esta data já atingiu o limite de produção. Escolha outra data ou fale com a Gelatos Lele.'; end if;
    end if;
  end if;

  v_free_value := public.gelatos_to_number(v_catalog->>'freeDeliveryMinValue');
  v_free_items := public.gelatos_to_number(v_catalog->>'freeDeliveryMinItems');
  if v_is_delivery then
    select value into v_zone from jsonb_array_elements(coalesce(v_catalog->'deliveryZones', '[]'::jsonb)) value where value->>'id' = p_zone_id limit 1;
    if v_zone is null then raise exception 'Escolha uma região de entrega.'; end if;
    if not ((v_free_value > 0 and v_subtotal >= v_free_value) or (v_free_items > 0 and v_item_count >= v_free_items)) then v_freight := public.gelatos_to_number(v_zone->>'fee'); end if;
    v_delivery_cost := public.gelatos_to_number(v_zone->>'cost');
  end if;
  v_total := round(v_subtotal + v_freight, 2);
  if lower(coalesce(p_payment, '')) like 'cr%' then v_payment_fee := round(v_total * public.gelatos_to_number(v_data->'settings'->>'creditFeePercent') / 100, 2);
  elsif lower(coalesce(p_payment, '')) like 'd%' then v_payment_fee := round(v_total * public.gelatos_to_number(v_data->'settings'->>'debitFeePercent') / 100, 2); end if;
  if not v_is_scheduled then
    v_reservation_minutes := greatest(5, least(120, public.gelatos_to_number(v_data->'settings'->>'reservationMinutes')::integer));
    v_reservation_expires_at := now() + make_interval(mins => v_reservation_minutes);
  end if;
  v_order := jsonb_build_object(
    'id', v_order_id, 'requestId', trim(p_request_id), 'customer', trim(p_customer), 'phone', trim(p_phone),
    'items', v_items, 'subtotal', round(v_subtotal, 2), 'freight', round(v_freight, 2), 'total', v_total,
    'cost', round(v_cost, 2), 'deliveryCost', round(v_delivery_cost, 2), 'paymentFee', round(v_payment_fee, 2), 'profit', round(v_total - v_cost - v_delivery_cost - v_payment_fee, 2),
    'paymentMethod', coalesce(nullif(trim(p_payment), ''), 'Pix'), 'status', case when v_is_scheduled then 'scheduled' else 'reserved' end,
    'reservationExpiresAt', case when v_is_scheduled then '' else v_reservation_expires_at::text end,
    'orderKind', v_order_kind, 'scheduledFor', case when v_is_scheduled then p_scheduled_for::text else '' end, 'stockReserved', not v_is_scheduled,
    'date', v_business_today::text, 'dueDate', v_due_date::text, 'paidAt', '', 'deliveryMode', coalesce(p_mode, 'Retirada'),
    'deliveryZone', coalesce(v_zone->>'name', ''), 'address', coalesce(p_address, ''), 'source', 'cardapio-cliente', 'createdAt', now()::text
  );
  v_data := jsonb_set(v_data, '{orders}', jsonb_build_array(v_order) || coalesce(v_data->'orders', '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{notifications}', jsonb_build_array(jsonb_build_object('id', v_order_id || '-notice', 'type', 'order', 'title', case when v_is_scheduled then 'Nova encomenda: ' || trim(p_customer) else 'Novo pedido para aprovar: ' || trim(p_customer) end, 'body', case when v_is_scheduled then 'Para ' || to_char(p_scheduled_for, 'DD/MM') || ' · ' else 'Reserva até ' || to_char(v_reservation_expires_at, 'HH24:MI') || ' · ' end || 'total R$ ' || replace(to_char(v_total, 'FM999999990D00'), '.', ','), 'route', 'orders-history', 'date', now()::text, 'read', false)) || coalesce(v_data->'notifications', '[]'::jsonb), true);
  update public.gelatos_company_state set data = v_data, revision = revision + 1, updated_at = now() where store_slug = p_slug;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at) values (p_slug, public.gelatos_make_catalog(v_data), now()) on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  insert into public.gelatos_audit_events (id, store_slug, event_type, entity_type, entity_id, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, case when v_is_scheduled then 'customer_order_scheduled' else 'customer_order_reserved' end, 'order', v_order_id, jsonb_build_object('source', 'customer_catalog', 'scheduledFor', coalesce(p_scheduled_for::text, ''), 'reservationExpiresAt', coalesce(v_reservation_expires_at::text, '')));
  return jsonb_build_object('orderId', v_order_id, 'total', v_total, 'freight', round(v_freight, 2), 'items', v_items, 'reservationExpiresAt', coalesce(v_reservation_expires_at::text, ''), 'status', case when v_is_scheduled then 'scheduled' else 'reserved' end, 'orderKind', v_order_kind, 'scheduledFor', case when v_is_scheduled then p_scheduled_for::text else '' end);
end;
$$;

-- Mantém versões instaladas antes da v38 funcionando como pronta-entrega.
create or replace function public.gelatos_place_customer_order(
  p_slug text, p_request_id text, p_client_id text, p_customer text, p_phone text,
  p_mode text, p_zone_id text, p_address text, p_payment text, p_items jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.gelatos_place_customer_order(p_slug, p_request_id, p_client_id, p_customer, p_phone, p_mode, p_zone_id, p_address, p_payment, 'ready', null::date, p_items);
$$;

revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, text, date, jsonb) from public;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, text, date, jsonb) to anon, authenticated;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
