-- Gelatos Lele v42 — reserva parcial de encomendas.
-- Execute este arquivo inteiro UMA vez no SQL Editor do mesmo projeto Supabase.
-- O que já estiver pronto é separado imediatamente; só o saldo faltante entra
-- no planejamento de produção. Não apaga pedidos, estoque ou financeiro.

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
  v_reserved_quantity numeric := 0; v_pending_quantity numeric := 0;
  v_reserved_unit_cost numeric := 0; v_reserved_cost numeric := 0;
  v_pending_unit_cost numeric := 0; v_pending_cost numeric := 0;
  v_reserved_total numeric := 0; v_pending_total numeric := 0;
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
      v_pending_unit_cost := public.gelatos_recipe_unit_cost(v_data, v_recipe);
      v_available := case when v_stock is null then 0 else greatest(0, public.gelatos_to_number(v_stock->>'quantity')) end;
      v_reserved_quantity := least(v_quantity, v_available);
      v_pending_quantity := greatest(0, v_quantity - v_reserved_quantity);
      v_reserved_unit_cost := case when v_reserved_quantity > 0 then public.gelatos_to_number(v_stock->>'unitCost') else 0 end;
      v_reserved_cost := round(v_reserved_quantity * v_reserved_unit_cost, 2);
      v_pending_cost := round(v_pending_quantity * v_pending_unit_cost, 2);
      v_unit_cost := case when v_quantity > 0 then round((v_reserved_cost + v_pending_cost) / v_quantity, 2) else 0 end;
      if v_reserved_quantity > 0 then
        v_data := jsonb_set(v_data, '{readyStock}', (
          select coalesce(jsonb_agg(case when stock.item->>'recipeId' = v_product_id then
            jsonb_set(jsonb_set(stock.item, '{quantity}', to_jsonb(round(v_available - v_reserved_quantity, 3))), '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', v_order_id || '-' || v_product_id, 'kind', 'Reserva parcial para encomenda', 'quantity', -v_reserved_quantity, 'date', v_business_today::text)))
            else stock.item end), '[]'::jsonb)
          from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) stock(item)
        ), true);
      end if;
      v_reserved_total := v_reserved_total + v_reserved_quantity;
      v_pending_total := v_pending_total + v_pending_quantity;
    else
      if v_stock is null then raise exception 'Um sabor escolhido não está mais disponível para pronta entrega.'; end if;
      v_available := public.gelatos_to_number(v_stock->>'quantity');
      if v_available < v_quantity then raise exception 'Estoque insuficiente para %.', coalesce(v_recipe->>'name', 'este sabor'); end if;
      v_reserved_quantity := v_quantity; v_pending_quantity := 0;
      v_reserved_unit_cost := public.gelatos_to_number(v_stock->>'unitCost');
      v_reserved_cost := round(v_quantity * v_reserved_unit_cost, 2);
      v_pending_unit_cost := 0; v_pending_cost := 0; v_unit_cost := v_reserved_unit_cost;
      v_data := jsonb_set(v_data, '{readyStock}', (
        select coalesce(jsonb_agg(case when stock.item->>'recipeId' = v_product_id then
          jsonb_set(jsonb_set(stock.item, '{quantity}', to_jsonb(round(v_available - v_quantity, 3))), '{movements}', coalesce(stock.item->'movements', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', v_order_id || '-' || v_product_id, 'kind', 'Reserva do cliente', 'quantity', -v_quantity, 'date', v_business_today::text)))
          else stock.item end), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_data->'readyStock', '[]'::jsonb)) stock(item)
      ), true);
      v_reserved_total := v_reserved_total + v_quantity;
    end if;
    v_subtotal := v_subtotal + v_quantity * v_price;
    v_cost := v_cost + v_reserved_cost + v_pending_cost;
    v_item_count := v_item_count + v_quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product_id, 'productName', coalesce(v_recipe->>'name', 'Sabor'),
      'productCategoryId', coalesce(nullif(v_recipe->>'productCategoryId', ''), 'gourmet'),
      'productType', coalesce(nullif(v_recipe->>'productType', ''), 'Geladinho gourmet'),
      'quantity', v_quantity, 'saleUnitPrice', v_price, 'unitCost', v_unit_cost,
      'reservedQuantity', v_reserved_quantity, 'pendingProductionQuantity', v_pending_quantity,
      'reservedUnitCost', v_reserved_unit_cost, 'reservedCost', v_reserved_cost,
      'pendingUnitCost', v_pending_unit_cost, 'pendingCost', v_pending_cost,
      'total', round(v_quantity * v_price, 2), 'cost', round(v_reserved_cost + v_pending_cost, 2), 'picked', false
    ));
  end loop;

  if v_is_scheduled then
    v_capacity := greatest(0, public.gelatos_to_number(v_catalog->>'scheduledMaxItemsPerDay'));
    if v_capacity > 0 then
      select coalesce(sum(case when line.item ? 'pendingProductionQuantity' then public.gelatos_to_number(line.item->>'pendingProductionQuantity') when coalesce((ord.item->>'stockReserved')::boolean, false) then 0 else public.gelatos_to_number(line.item->>'quantity') end), 0) into v_scheduled_total
      from jsonb_array_elements(coalesce(v_data->'orders', '[]'::jsonb)) ord(item)
      cross join lateral jsonb_array_elements(coalesce(ord.item->'items', '[]'::jsonb)) line(item)
      where ord.item->>'orderKind' = 'scheduled' and ord.item->>'scheduledFor' = p_scheduled_for::text
        and coalesce(ord.item->>'status', '') not in ('cancelled', 'expired');
      if v_scheduled_total + v_pending_total > v_capacity then raise exception 'Esta data já atingiu o limite de produção. Escolha outra data ou fale com a Gelatos Lele.'; end if;
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
    'paymentMethod', coalesce(nullif(trim(p_payment), ''), 'Pix'),
    'status', case when v_is_scheduled and v_pending_total > 0 then 'scheduled' when v_is_scheduled then 'confirmed' else 'reserved' end,
    'reservationExpiresAt', case when v_is_scheduled then '' else v_reservation_expires_at::text end,
    'orderKind', v_order_kind, 'scheduledFor', case when v_is_scheduled then p_scheduled_for::text else '' end,
    'stockReserved', case when v_is_scheduled then v_pending_total <= 0 else true end,
    'date', v_business_today::text, 'dueDate', v_due_date::text, 'paidAt', '', 'deliveryMode', coalesce(p_mode, 'Retirada'),
    'deliveryZone', coalesce(v_zone->>'name', ''), 'address', coalesce(p_address, ''), 'source', 'cardapio-cliente', 'createdAt', now()::text
  );
  v_data := jsonb_set(v_data, '{orders}', jsonb_build_array(v_order) || coalesce(v_data->'orders', '[]'::jsonb), true);
  v_data := jsonb_set(v_data, '{notifications}', jsonb_build_array(jsonb_build_object(
    'id', v_order_id || '-notice', 'type', 'order',
    'title', case when v_is_scheduled then 'Nova encomenda: ' || trim(p_customer) else 'Novo pedido para aprovar: ' || trim(p_customer) end,
    'body', case when v_is_scheduled then round(v_reserved_total, 3)::text || ' separado(s) · ' || round(v_pending_total, 3)::text || ' para produzir · ' else 'Reserva até ' || to_char(v_reservation_expires_at, 'HH24:MI') || ' · ' end || 'total R$ ' || replace(to_char(v_total, 'FM999999990D00'), '.', ','),
    'route', 'orders-history', 'date', now()::text, 'read', false
  )) || coalesce(v_data->'notifications', '[]'::jsonb), true);
  update public.gelatos_company_state set data = v_data, revision = revision + 1, updated_at = now() where store_slug = p_slug;
  insert into public.gelatos_public_catalog (store_slug, payload, updated_at) values (p_slug, public.gelatos_make_catalog(v_data), now()) on conflict (store_slug) do update set payload = excluded.payload, updated_at = excluded.updated_at;
  insert into public.gelatos_audit_events (id, store_slug, event_type, entity_type, entity_id, detail)
  values (md5(random()::text || clock_timestamp()::text), p_slug, case when v_is_scheduled then 'customer_order_scheduled_partial_reservation' else 'customer_order_reserved' end, 'order', v_order_id, jsonb_build_object('source', 'customer_catalog', 'scheduledFor', coalesce(p_scheduled_for::text, ''), 'reservedQuantity', v_reserved_total, 'pendingProductionQuantity', v_pending_total, 'reservationExpiresAt', coalesce(v_reservation_expires_at::text, '')));
  return jsonb_build_object('orderId', v_order_id, 'total', v_total, 'freight', round(v_freight, 2), 'items', v_items, 'reservationExpiresAt', coalesce(v_reservation_expires_at::text, ''), 'status', case when v_is_scheduled and v_pending_total > 0 then 'scheduled' when v_is_scheduled then 'confirmed' else 'reserved' end, 'orderKind', v_order_kind, 'scheduledFor', case when v_is_scheduled then p_scheduled_for::text else '' end, 'reservedQuantity', v_reserved_total, 'pendingProductionQuantity', v_pending_total);
end;
$$;

revoke all on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, text, date, jsonb) from public;
grant execute on function public.gelatos_place_customer_order(text, text, text, text, text, text, text, text, text, text, date, jsonb) to anon, authenticated;
