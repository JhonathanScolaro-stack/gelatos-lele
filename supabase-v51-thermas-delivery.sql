-- Gelatos Lele v51 — entrega no Thermas com endereço estruturado.
-- Execute uma única vez no SQL Editor do Supabase antes de publicar a v51.
-- Não apaga dados: atualiza somente o formato público das regiões de entrega.

create or replace function public.gelatos_make_catalog(p_state jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with settings as (
    select coalesce(p_state->'settings', '{}'::jsonb) as item
  ), categories as (
    select case when jsonb_typeof(p_state->'productCategories') = 'array' and jsonb_array_length(p_state->'productCategories') > 0 then p_state->'productCategories'
      else jsonb_build_array(jsonb_build_object('id', 'agua', 'name', 'Geladinho de água'), jsonb_build_object('id', 'leite', 'name', 'Geladinho de leite'), jsonb_build_object('id', 'gourmet', 'name', 'Geladinho gourmet')) end as items
  ), zones as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', regexp_replace(lower(trim(split_part(line, '|', 1))), '[^a-z0-9]+', '-', 'g'),
      'name', trim(split_part(line, '|', 1)),
      'fee', public.gelatos_to_number(split_part(line, '|', 2)),
      'cost', public.gelatos_to_number(split_part(line, '|', 3)),
      'requiresThermasAddress', lower(trim(split_part(line, '|', 4))) in ('thermas', 'sim', 'true', '1') or lower(trim(split_part(line, '|', 1))) like '%thermas%'
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
      'imageUrl', coalesce(recipe.item->>'imageUrl', ''),
      'hasImage', coalesce(nullif(recipe.item->>'imageUrl', ''), nullif(recipe.item->>'imageData', ''), '') <> '',
      'imageToken', case when coalesce(recipe.item->>'imageUrl', '') <> '' then md5(recipe.item->>'imageUrl') when coalesce(recipe.item->>'imageData', '') <> '' then md5(recipe.item->>'imageData') else '' end
    ) order by lower(coalesce(recipe.item->>'name', ''))), '[]'::jsonb) as items
    from categories, jsonb_array_elements(coalesce(p_state->'recipes', '[]'::jsonb)) recipe(item)
    left join lateral (select s.item from jsonb_array_elements(coalesce(p_state->'readyStock', '[]'::jsonb)) s(item) where s.item->>'recipeId' = recipe.item->>'id' limit 1) stock on true
    where coalesce((recipe.item->>'active')::boolean, true)
  )
  select jsonb_build_object(
    'store', 'gelatos-lele',
    'brand', coalesce(nullif(settings.item->>'catalogName', ''), 'Gelatos Lele'),
    'logo', '',
    'logoUrl', coalesce(nullif(settings.item->>'catalogLogoUrl', ''), nullif(settings.item->>'headerLogoUrl', ''), ''),
    'hasLogo', coalesce(nullif(settings.item->>'catalogLogoUrl', ''), nullif(settings.item->>'headerLogoUrl', ''), nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''), '') <> '',
    'logoToken', case when coalesce(nullif(settings.item->>'catalogLogoUrl', ''), nullif(settings.item->>'headerLogoUrl', '')) <> '' then md5(coalesce(nullif(settings.item->>'catalogLogoUrl', ''), nullif(settings.item->>'headerLogoUrl', ''))) when coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', '')) <> '' then md5(coalesce(nullif(settings.item->>'catalogLogoDataUrl', ''), nullif(settings.item->>'headerLogoDataUrl', ''))) else '' end,
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

update public.gelatos_public_catalog as catalog
set payload = public.gelatos_make_catalog(company.data), updated_at = now()
from public.gelatos_company_state as company
where catalog.store_slug = company.store_slug;
