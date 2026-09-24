-- Gelatos Lele v46 — cardápio público econômico.
-- Execute este arquivo inteiro UMA vez no SQL Editor do mesmo projeto Supabase.
-- Estoque, pedidos e valores não são colocados em cache. A mudança apenas evita
-- enviar todas as fotos e logos junto com cada leitura do cardápio.

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
      'hasImage', coalesce(nullif(recipe.item->>'imageData', ''), '') <> '',
      'imageToken', case when coalesce(nullif(recipe.item->>'imageData', ''), '') <> '' then md5(recipe.item->>'imageData') else '' end
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
    'logo', '',
    'hasLogo', coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''), '') <> '',
    'logoToken', case when coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''), '') <> '' then md5(coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''))) else '' end,
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

-- Entrega somente as imagens solicitadas. O aplicativo chama isto ao abrir uma
-- categoria; nunca para buscar quantidade, preço, frete ou disponibilidade.
create or replace function public.gelatos_get_public_images(p_slug text, p_image_ids jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
  v_image_ids text[];
  v_images jsonb := '{}'::jsonb;
  v_recipe jsonb;
  v_logo text;
begin
  if jsonb_typeof(p_image_ids) <> 'array' then raise exception 'Imagens inválidas.'; end if;

  select data into v_data from public.gelatos_company_state where store_slug = p_slug;
  if v_data is null then raise exception 'Cardápio não encontrado.'; end if;

  select coalesce(array_agg(distinct request.value), '{}'::text[]) into v_image_ids
  from (
    select trim(value) as value
    from jsonb_array_elements_text(p_image_ids) as incoming(value)
    where length(trim(value)) between 1 and 120
    limit 30
  ) request;

  if '__catalog_logo__' = any(v_image_ids) then
    v_logo := coalesce(nullif(v_data->'settings'->>'catalogLogoDataUrl', ''), nullif(v_data->'settings'->>'headerLogoDataUrl', ''), '');
    if v_logo <> '' then v_images := v_images || jsonb_build_object('__catalog_logo__', v_logo); end if;
  end if;

  for v_recipe in select value from jsonb_array_elements(coalesce(v_data->'recipes', '[]'::jsonb)) loop
    if v_recipe->>'id' = any(v_image_ids)
      and coalesce((v_recipe->>'active')::boolean, true)
      and coalesce(v_recipe->>'imageData', '') <> '' then
      v_images := v_images || jsonb_build_object(v_recipe->>'id', v_recipe->>'imageData');
    end if;
  end loop;

  return jsonb_build_object('images', v_images);
end;
$$;

revoke all on function public.gelatos_get_public_images(text, jsonb) from public;
grant execute on function public.gelatos_get_public_images(text, jsonb) to anon, authenticated;

-- Atualiza o único cardápio já publicado. Não altera os dados da empresa.
update public.gelatos_public_catalog as catalog
set payload = public.gelatos_make_catalog(company.data), updated_at = now()
from public.gelatos_company_state as company
where catalog.store_slug = company.store_slug;
