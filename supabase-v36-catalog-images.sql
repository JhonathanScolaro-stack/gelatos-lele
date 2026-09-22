-- Gelatos Lele v36 — mantém fotos no catálogo público e atualiza a logo.
-- Execute uma única vez no SQL Editor do projeto Supabase.
create or replace function public.gelatos_make_catalog(p_state jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with settings as (
    select coalesce(p_state->'settings', '{}'::jsonb) as item
  ), categories as (
    select case when jsonb_typeof(p_state->'productCategories') = 'array' and jsonb_array_length(p_state->'productCategories') > 0
      then p_state->'productCategories'
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
    'freeDeliveryMinValue', coalesce(nullif(regexp_replace(coalesce(settings.item->>'freeDeliveryMinValue', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
    'freeDeliveryMinItems', coalesce(nullif(regexp_replace(coalesce(settings.item->>'freeDeliveryMinItems', '0'), '[^0-9.-]', '', 'g'), '')::numeric, 0),
    'categories', categories.items,
    'products', products.items
  ) from settings, categories, zones, products;
$$;

-- Recria apenas a cópia pública derivada. Não altera receitas, pedidos,
-- estoque, pagamentos nem nenhuma informação interna da empresa.
update public.gelatos_public_catalog as public_catalog
set payload = public.gelatos_make_catalog(company_state.data), updated_at = now()
from public.gelatos_company_state as company_state
where public_catalog.store_slug = company_state.store_slug
  and public_catalog.store_slug = 'gelatos-lele';
