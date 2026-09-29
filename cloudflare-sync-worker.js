/*
 * Gelatos Lele — sincronização sem Supabase
 *
 * Este Worker usa apenas recursos já presentes na conta Cloudflare:
 *   DB            -> D1 (dados da empresa e sessões)
 *   GELATOS_MEDIA -> R2 (fotos e logos)
 *
 * Variáveis não secretas:
 *   ALLOWED_ORIGIN = https://jhonathanscolaro-stack.github.io
 *   STORE_SLUG     = gelatos-lele
 *
 * Segredo de uso único:
 *   BOOTSTRAP_CODE = código entregue à proprietária para trazer a cópia do
 *                    Supabase uma única vez. Depois da migração a rota se
 *                    bloqueia automaticamente.
 *
 * A estrutura de versões evita que uma gravação lenta sobrescreva outra.
 * Cada estado completo é salvo em partes imutáveis; a troca da revisão ativa
 * é uma única atualização condicional no D1.
 */

const MAX_IMAGE_BYTES = 1_200_000;
const MAX_STATE_PART_BYTES = 1_750_000;
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 160_000;
const STATE_PARTS = [
  'version', 'supplies', 'recipes', 'productions', 'readyStock', 'orders',
  'expenses', 'suppliers', 'purchases', 'resellers', 'productCategories',
  'notifications', 'notificationKeys', 'openingFinancial', 'settings'
];
const encoder = new TextEncoder();

function now() { return new Date().toISOString(); }
function brazilDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function reply(body, status, request, env, headers = {}) {
  return new Response(body, { status, headers: { ...cors(request, env), ...headers } });
}
function json(value, status, request, env) {
  return reply(JSON.stringify(value), status, request, env, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function error(message, status, request, env, code = '') {
  return json({ error: message, code }, status, request, env);
}
function asText(value) { return String(value ?? '').trim(); }
function emailOf(value) { return asText(value).toLocaleLowerCase('pt-BR'); }
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = String(value ?? '').trim().replace(/\s/g, '');
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(',', '.');
  const result = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(result) ? result : 0;
}
function round(value) { return Math.round((numberOf(value) + Number.EPSILON) * 100) / 100; }
function quantity(value) { return Math.round((numberOf(value) + Number.EPSILON) * 1000) / 1000; }
function randomId(prefix = 'id') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + '-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
function bytesFromBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(bytes)].map(item => item.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytesFromBase64(salt), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' }, material, 256);
  return base64(new Uint8Array(bits));
}
async function passwordRecord(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = base64(saltBytes);
  return { salt, hash: await passwordHash(password, salt) };
}
function sameText(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
function safeJson(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch (_) { return fallback; }
}
function storeSlug(env) { return asText(env.STORE_SLUG) || 'gelatos-lele'; }
function defaultPart(name) {
  if (name === 'version') return 18;
  if (['openingFinancial', 'settings'].includes(name)) return {};
  return [];
}
function normalizeState(state) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const output = {};
  STATE_PARTS.forEach(part => { output[part] = Object.prototype.hasOwnProperty.call(source, part) ? source[part] : defaultPart(part); });
  return output;
}
function statePayloads(state) {
  const normalized = normalizeState(state);
  return STATE_PARTS.map(part => {
    const value = JSON.stringify(normalized[part]);
    if (encoder.encode(value).byteLength > MAX_STATE_PART_BYTES) throw new Error('O histórico de ' + part + ' ficou grande demais para uma única parte. Exporte um backup e fale com o suporte antes de continuar.');
    return { part, value };
  });
}
async function metaFor(env, slug = storeSlug(env)) {
  return env.DB.prepare('SELECT store_slug, active_version, revision, updated_at FROM gelatos_state_meta WHERE store_slug = ?').bind(slug).first();
}
async function stateForVersion(env, versionId) {
  const rows = await env.DB.prepare('SELECT part_name, payload FROM gelatos_state_parts WHERE version_id = ?').bind(versionId).all();
  const output = {};
  for (const row of rows.results || []) output[row.part_name] = safeJson(row.payload, defaultPart(row.part_name));
  return normalizeState(output);
}
async function loadState(env, slug = storeSlug(env)) {
  const meta = await metaFor(env, slug);
  if (!meta) return null;
  return { meta, state: await stateForVersion(env, meta.active_version) };
}
async function createVersion(env, slug, state) {
  const versionId = randomId('ver');
  const payloads = statePayloads(state);
  const statements = [env.DB.prepare('INSERT INTO gelatos_state_versions (version_id, store_slug, created_at) VALUES (?, ?, ?)').bind(versionId, slug, now())];
  payloads.forEach(item => statements.push(env.DB.prepare('INSERT INTO gelatos_state_parts (version_id, part_name, payload) VALUES (?, ?, ?)').bind(versionId, item.part, item.value)));
  await env.DB.batch(statements);
  return versionId;
}
async function removeVersion(env, versionId) {
  if (!versionId) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gelatos_state_parts WHERE version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM gelatos_state_versions WHERE version_id = ?').bind(versionId)
  ]);
}
async function snapshotOldVersion(env, slug, meta) {
  if (!meta?.active_version) return;
  await env.DB.prepare('INSERT OR IGNORE INTO gelatos_state_snapshots (store_slug, snapshot_date, version_id, revision, saved_at) VALUES (?, ?, ?, ?, ?)').bind(slug, brazilDate(), meta.active_version, meta.revision, now()).run();
}
async function cleanObsoleteVersions(env, slug) {
  // Só limpa cópias não ativas e não marcadas como backup diário. Limite
  // pequeno evita que uma limpeza concorra com uma venda do cardápio.
  const obsolete = await env.DB.prepare("SELECT version_id FROM gelatos_state_versions WHERE store_slug = ? AND version_id NOT IN (SELECT active_version FROM gelatos_state_meta WHERE store_slug = ?) AND version_id NOT IN (SELECT version_id FROM gelatos_state_snapshots WHERE store_slug = ?) ORDER BY created_at ASC LIMIT 12").bind(slug, slug, slug).all();
  for (const row of obsolete.results || []) await removeVersion(env, row.version_id);
}
async function commitState(env, slug, expectedRevision, state, previousMeta) {
  const versionId = await createVersion(env, slug, state);
  const updated = await env.DB.prepare('UPDATE gelatos_state_meta SET active_version = ?, revision = revision + 1, updated_at = ? WHERE store_slug = ? AND revision = ?').bind(versionId, now(), slug, Number(expectedRevision)).run();
  if (Number(updated.meta?.changes || 0) !== 1) {
    await removeVersion(env, versionId);
    return { conflict: true };
  }
  await snapshotOldVersion(env, slug, previousMeta);
  await cleanObsoleteVersions(env, slug);
  return { conflict: false, revision: Number(expectedRevision) + 1, versionId };
}
async function memberForRequest(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1] || '';
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare("SELECT m.member_id, m.email, m.role, m.active FROM gelatos_sessions s JOIN gelatos_team_members m ON m.member_id = s.member_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(tokenHash, now()).first();
  if (!row || Number(row.active) !== 1) return null;
  return row;
}
function canWrite(member) { return ['owner', 'manager'].includes(String(member?.role || '')); }
function canProduce(member) { return ['owner', 'manager', 'production'].includes(String(member?.role || '')); }
async function requireMember(request, env, write = false) {
  const member = await memberForRequest(request, env);
  if (!member) throw Object.assign(new Error('Entre com seu e-mail e senha para acessar os dados da empresa.'), { status: 401 });
  if (write && !canWrite(member)) throw Object.assign(new Error('Este acesso é somente para consulta. Peça à proprietária para liberar Gestão.'), { status: 403 });
  return member;
}
async function createSession(env, member) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO gelatos_sessions (token_hash, member_id, store_slug, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(await digest(token), member.member_id, member.store_slug || storeSlug(env), expires, now()).run();
  return { access_token: token, expires_at: Math.floor(new Date(expires).getTime() / 1000), user: { email: member.email, role: member.role } };
}
async function parseBody(request) {
  try { return await request.json(); }
  catch (_) { throw Object.assign(new Error('Os dados enviados não são válidos.'), { status: 400 }); }
}
function safeKey(value) {
  let key = '';
  try { key = decodeURIComponent(String(value || '')); } catch (_) { return ''; }
  if (key.includes('..')) return '';
  return /^gelatos-lele\/(?:recipes|branding)\/[a-z0-9_-]{4,120}\.(?:jpg|jpeg|png|webp)$/i.test(key) ? key : '';
}
function dataUrlToBytes(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(value || ''));
  if (!match) throw new Error('Formato de imagem inválido.');
  const binary = atob(match[2].replace(/\s/g, ''));
  if (binary.length > MAX_IMAGE_BYTES) throw new Error('A imagem é grande demais.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase(), bytes };
}
function unitKey(unit) {
  return String(unit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/[.\s]+/g, '');
}
const UNITS = {
  ml: ['volume', 1], mililitro: ['volume', 1], mililitros: ['volume', 1], l: ['volume', 1000], litro: ['volume', 1000], litros: ['volume', 1000],
  g: ['mass', 1], grama: ['mass', 1], gramas: ['mass', 1], kg: ['mass', 1000], quilo: ['mass', 1000], quilos: ['mass', 1000],
  un: ['count', 1], unidade: ['count', 1], unidades: ['count', 1], und: ['count', 1], unds: ['count', 1],
  pacote: ['package:pacote', 1], pacotes: ['package:pacote', 1], caixa: ['package:caixa', 1], caixas: ['package:caixa', 1], cx: ['package:caixa', 1], rolo: ['package:rolo', 1], rolos: ['package:rolo', 1]
};
function convertAmount(value, fromUnit, toUnit) {
  const from = UNITS[unitKey(fromUnit)];
  const to = UNITS[unitKey(toUnit)];
  if (!from || !to || from[0] !== to[0]) {
    if (unitKey(fromUnit) === unitKey(toUnit)) return numberOf(value);
    throw new Error('Unidades incompatíveis na receita: use ' + (toUnit || 'a unidade cadastrada no estoque') + '.');
  }
  return quantity(numberOf(value) * from[1] / to[1]);
}
function suppliesById(state) { return Object.fromEntries((state.supplies || []).map(item => [String(item.id), item])); }
function readyByRecipe(state) { return Object.fromEntries((state.readyStock || []).map(item => [String(item.recipeId), item])); }
function recipeCost(recipe, state) {
  const supplies = suppliesById(state);
  const lines = (recipe.items || []).map(item => {
    const supply = supplies[String(item.supplyId)];
    if (!supply) throw new Error('Há um item da receita que não existe mais no estoque. Abra a receita e selecione o item novamente.');
    const used = convertAmount(item.quantity, item.unit || supply.unit, supply.unit);
    if (!(used > 0)) throw new Error('Quantidade de receita inválida.');
    return { supply, supplyId: String(item.supplyId), quantity: used, cost: round(used * numberOf(supply.averageUnitCost)) };
  });
  if (!lines.length) throw new Error('Cadastre ao menos um ingrediente ou embalagem na receita.');
  const yieldUnits = quantity(recipe.yieldUnits);
  if (!(yieldUnits > 0)) throw new Error('Rendimento da receita inválido.');
  const materialCost = round(lines.reduce((sum, line) => sum + line.cost, 0));
  const laborCost = round(recipe.laborMode === 'unit' ? numberOf(recipe.laborAmount) * yieldUnits : numberOf(recipe.laborAmount));
  return { lines, yieldUnits, materialCost, laborCost, batchCost: round(materialCost + laborCost), unitCost: round((materialCost + laborCost) / yieldUnits) };
}
function deliveryZones(settings) {
  return String(settings?.deliveryZones || '').split(/\r?\n/).map(line => {
    const [name = '', fee = '', cost = '', rule = ''] = line.split('|');
    const city = asText(name);
    return { id: city.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-'), name: city, fee: Math.max(0, numberOf(fee)), cost: Math.max(0, numberOf(cost)), requiresThermasAddress: asText(rule).toLocaleLowerCase('pt-BR') === 'thermas' || /(thermas|santa\s*b[aá]rbara\s*resort)/i.test(city) };
  }).filter(item => item.name);
}
function productCategories(state) {
  const values = Array.isArray(state.productCategories) && state.productCategories.length ? state.productCategories : [{ id: 'agua', name: 'Geladinho de água' }, { id: 'leite', name: 'Geladinho de leite' }, { id: 'gourmet', name: 'Geladinho gourmet' }];
  return values.map(item => ({ id: String(item.id), name: String(item.name) }));
}
function catalogFromState(state, env) {
  const settings = state.settings || {};
  const recipes = (state.recipes || []).filter(recipe => recipe.active !== false);
  const ready = readyByRecipe(state);
  const products = recipes.map(recipe => {
    const stock = ready[String(recipe.id)];
    const imageUrl = asText(recipe.imageUrl);
    const image = asText(recipe.imageData);
    return {
      id: String(recipe.id), name: String(recipe.name || 'Sabor'), categoryId: String(recipe.productCategoryId || 'gourmet'), categoryName: String(recipe.productType || 'Geladinho gourmet'), type: String(recipe.productType || 'Geladinho gourmet'), description: String(recipe.description || ''),
      price: Math.max(0, numberOf(recipe.saleUnitPrice)), available: Math.max(0, quantity(stock?.quantity)), imageUrl, hasImage: Boolean(imageUrl || image), imageToken: imageUrl || image ? awaitableToken(imageUrl || image) : ''
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const logoUrl = asText(settings.catalogLogoUrl) || asText(settings.headerLogoUrl);
  const logoData = asText(settings.catalogLogoDataUrl) || asText(settings.headerLogoDataUrl);
  return {
    store: storeSlug(env), brand: asText(settings.catalogName) || 'Gelatos Lele', intro: String(settings.catalogIntro || ''), phone: String(settings.catalogPhone || ''), address: String(settings.businessAddress || ''), pickupAddress: String(settings.pickupAddress || ''), deliveryModes: String(settings.deliveryModes || 'Retirada,Entrega'), deliveryZones: deliveryZones(settings), freeDeliveryMinValue: Math.max(0, numberOf(settings.freeDeliveryMinValue)), freeDeliveryMinItems: Math.max(0, numberOf(settings.freeDeliveryMinItems)), scheduledEnabled: settings.scheduledEnabled !== false && String(settings.scheduledEnabled).toLocaleLowerCase('pt-BR') !== 'false', scheduledLeadDays: Math.max(2, Math.min(30, Math.floor(numberOf(settings.scheduledLeadDays) || 2))), scheduledMaxItemsPerDay: Math.max(0, quantity(settings.scheduledMaxItemsPerDay)),
    logoUrl, logo: '', hasLogo: Boolean(logoUrl || logoData), logoToken: logoUrl || logoData ? awaitableToken(logoUrl || logoData) : '', categories: productCategories(state), products
  };
}
// Token leve de cache; não é uma função criptográfica de segurança.
function awaitableToken(value) { return String(value || '').length + '-' + String(value || '').slice(-18); }
function publicImagesFromState(state, ids) {
  const requested = new Set((Array.isArray(ids) ? ids : []).map(value => String(value)));
  const images = {};
  if (requested.has('__catalog_logo__')) {
    const settings = state.settings || {};
    const image = asText(settings.catalogLogoDataUrl) || asText(settings.headerLogoDataUrl);
    if (image) images.__catalog_logo__ = image;
  }
  (state.recipes || []).forEach(recipe => {
    if (requested.has(String(recipe.id)) && asText(recipe.imageData)) images[String(recipe.id)] = String(recipe.imageData);
  });
  return images;
}
function findOrderByRequest(state, requestId) {
  return (state.orders || []).find(order => String(order.requestId || '') === String(requestId));
}
function paymentFee(total, method, settings) {
  const rate = method === 'Crédito' ? numberOf(settings.creditFeePercent) : method === 'Débito' ? numberOf(settings.debitFeePercent) : 0;
  return round(numberOf(total) * Math.max(0, rate) / 100);
}
function isDelivery(mode) { return /entrega/i.test(String(mode || '')); }
function makeOrder(state, payload) {
  const requestId = asText(payload.requestId);
  const clientId = asText(payload.clientId);
  const customer = asText(payload.customer);
  if (requestId.length < 8 || clientId.length < 16 || !customer) throw new Error('Não foi possível validar este pedido. Atualize o cardápio e tente novamente.');
  const settings = state.settings || {};
  const scheduled = payload.orderKind === 'scheduled';
  const today = brazilDate();
  const leadDays = Math.max(2, Math.floor(numberOf(settings.scheduledLeadDays) || 2));
  const minimum = new Date(today + 'T12:00:00-03:00');
  minimum.setDate(minimum.getDate() + leadDays);
  const minimumDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(minimum);
  const scheduledFor = scheduled ? asText(payload.scheduledFor) : '';
  if (scheduled && (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor) || scheduledFor < minimumDate)) throw new Error('Escolha uma data com pelo menos ' + leadDays + ' dias para o preparo.');
  const recipes = Object.fromEntries((state.recipes || []).filter(item => item.active !== false).map(item => [String(item.id), item]));
  const ready = readyByRecipe(state);
  const requested = Array.isArray(payload.items) ? payload.items : [];
  if (!requested.length) throw new Error('Escolha pelo menos um sabor.');
  const combined = {};
  requested.forEach(line => {
    const id = String(line?.productId || '');
    const amount = quantity(line?.quantity);
    if (id && amount > 0) combined[id] = quantity((combined[id] || 0) + amount);
  });
  const items = [];
  for (const [productId, amount] of Object.entries(combined)) {
    const recipe = recipes[productId];
    const stock = ready[productId];
    if (!recipe) throw new Error('Um sabor escolhido não está mais disponível. Atualize o cardápio e tente novamente.');
    const available = Math.max(0, quantity(stock?.quantity));
    if (!scheduled && (!stock || available < amount)) throw new Error('Estoque insuficiente para ' + recipe.name + '. Atualize o cardápio e tente novamente.');
    const reservedQuantity = scheduled ? Math.min(amount, available) : amount;
    const pendingProductionQuantity = quantity(amount - reservedQuantity);
    const readyCost = Math.max(0, numberOf(stock?.unitCost));
    const madeCost = recipeCost(recipe, state).unitCost;
    const unitCost = amount > 0 ? round((reservedQuantity * readyCost + pendingProductionQuantity * madeCost) / amount) : 0;
    const saleUnitPrice = Math.max(0, numberOf(recipe.saleUnitPrice));
    items.push({ productId, productName: String(recipe.name || 'Sabor'), productCategoryId: String(recipe.productCategoryId || 'gourmet'), productType: String(recipe.productType || 'Geladinho gourmet'), quantity: amount, saleUnitPrice, grossTotal: round(amount * saleUnitPrice), discountTotal: 0, discountPerUnit: 0, total: round(amount * saleUnitPrice), reservedQuantity, pendingProductionQuantity, reservedUnitCost: readyCost, reservedCost: round(reservedQuantity * readyCost), pendingUnitCost: madeCost, pendingCost: round(pendingProductionQuantity * madeCost), unitCost, cost: round(reservedQuantity * readyCost + pendingProductionQuantity * madeCost), picked: false });
  }
  if (!items.length) throw new Error('Escolha pelo menos um sabor.');
  const pending = quantity(items.reduce((sum, item) => sum + item.pendingProductionQuantity, 0));
  const dayLimit = Math.max(0, quantity(settings.scheduledMaxItemsPerDay));
  if (scheduled && dayLimit > 0) {
    const planned = quantity((state.orders || []).filter(order => order.orderKind === 'scheduled' && !['cancelled', 'expired'].includes(order.status) && String(order.scheduledFor || order.dueDate) === scheduledFor).reduce((sum, order) => sum + (order.items || []).reduce((inner, line) => inner + quantity(line.pendingProductionQuantity ?? line.quantity), 0), 0));
    if (planned + pending > dayLimit) throw new Error('Esta data já tem ' + planned + ' geladinho(s) programado(s). O limite configurado é ' + dayLimit + '. Escolha outra data.');
  }
  const mode = asText(payload.mode) || 'Retirada';
  const zones = deliveryZones(settings);
  const zone = zones.find(item => item.id === asText(payload.zoneId));
  if (isDelivery(mode) && !zone) throw new Error('Selecione o local de entrega.');
  const subtotal = round(items.reduce((sum, item) => sum + item.total, 0));
  const totalItems = quantity(items.reduce((sum, item) => sum + item.quantity, 0));
  const free = isDelivery(mode) && ((numberOf(settings.freeDeliveryMinValue) > 0 && subtotal >= numberOf(settings.freeDeliveryMinValue)) || (numberOf(settings.freeDeliveryMinItems) > 0 && totalItems >= numberOf(settings.freeDeliveryMinItems)));
  const freight = isDelivery(mode) && !free ? round(zone?.fee) : 0;
  const total = round(subtotal + freight);
  const method = asText(payload.payment) || 'Pix';
  const minutes = Math.max(5, Math.min(120, Math.floor(numberOf(settings.reservationMinutes) || 20)));
  const reservationExpiresAt = scheduled ? '' : new Date(Date.now() + minutes * 60000).toISOString();
  const id = randomId('order');
  const order = { id, requestId, clientId, customer, phone: asText(payload.phone), items, subtotal, freight, total, cost: round(items.reduce((sum, item) => sum + item.cost, 0)), deliveryCost: isDelivery(mode) ? round(zone?.cost) : 0, paymentFee: paymentFee(total, method, settings), profit: 0, paymentMethod: method, status: scheduled ? 'scheduled' : 'reserved', reservationExpiresAt, date: today, dueDate: scheduled ? scheduledFor : today, paidAt: '', deliveryMode: mode, deliveryZone: zone?.name || '', zoneId: zone?.id || '', address: asText(payload.address), source: 'cardapio-cliente', orderKind: scheduled ? 'scheduled' : 'ready', scheduledFor, stockReserved: !scheduled || items.every(item => item.pendingProductionQuantity <= 0), createdAt: now() };
  order.profit = round(order.total - order.cost - order.deliveryCost - order.paymentFee);
  const products = (state.readyStock || []).map(product => {
    const line = items.find(item => String(item.productId) === String(product.recipeId));
    if (!line || !(line.reservedQuantity > 0)) return product;
    return { ...product, quantity: quantity(quantity(product.quantity) - line.reservedQuantity), movements: [...(Array.isArray(product.movements) ? product.movements : []), { id: randomId('mov'), kind: scheduled ? 'Reserva de encomenda' : 'Reserva do cliente', quantity: -line.reservedQuantity, date: today, orderId: id }] };
  });
  state.readyStock = products;
  state.orders = [order, ...(state.orders || [])];
  state.notifications = [{ id: randomId('notice'), type: 'order', title: 'Novo pedido: ' + customer, body: 'Pedido do cardápio no valor de R$ ' + total.toFixed(2).replace('.', ','), route: 'orders-history', date: now(), read: false }, ...(state.notifications || [])].slice(0, 120);
  return order;
}
function expireReservations(state) {
  const current = Date.now();
  const returns = {};
  let changed = false;
  state.orders = (state.orders || []).map(order => {
    if (order.status !== 'reserved' || !order.reservationExpiresAt || new Date(order.reservationExpiresAt).getTime() > current) return order;
    changed = true;
    (order.items || []).forEach(line => { returns[String(line.productId)] = quantity((returns[String(line.productId)] || 0) + quantity(line.quantity)); });
    return { ...order, status: 'expired', expiredAt: now(), stockReserved: false };
  });
  if (changed) state.readyStock = (state.readyStock || []).map(product => {
    const amount = returns[String(product.recipeId)] || 0;
    return amount > 0 ? { ...product, quantity: quantity(quantity(product.quantity) + amount), movements: [...(product.movements || []), { id: randomId('mov'), kind: 'Reserva expirada', quantity: amount, date: brazilDate() }] } : product;
  });
  return changed;
}
async function latestStateWithExpiredReservations(env, slug) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = await loadState(env, slug);
    if (!loaded) return null;
    const state = structuredClone(loaded.state);
    if (!expireReservations(state)) return { ...loaded, state };
    const committed = await commitState(env, slug, loaded.meta.revision, state, loaded.meta);
    if (!committed.conflict) return { meta: { ...loaded.meta, revision: committed.revision, active_version: committed.versionId }, state };
  }
  throw new Error('CONFLITO: o estoque foi atualizado em outro acesso. Atualize e tente novamente.');
}
async function registerProduction(state, recipeId, batches, date) {
  const recipe = (state.recipes || []).find(item => String(item.id) === String(recipeId));
  const count = numberOf(batches);
  if (!recipe || !(count > 0) || count > 10000) throw new Error('Selecione uma receita e informe uma quantidade de lotes válida.');
  const costing = recipeCost(recipe, state);
  const needs = {};
  costing.lines.forEach(line => {
    const current = needs[line.supplyId] || { supply: line.supply, quantity: 0, cost: 0 };
    current.quantity = quantity(current.quantity + line.quantity * count);
    current.cost = round(current.cost + line.cost * count);
    needs[line.supplyId] = current;
  });
  const shortages = Object.values(needs).filter(item => quantity(item.supply.quantity) + 0.0000001 < item.quantity);
  if (shortages.length) throw new Error('Estoque insuficiente para produzir. ' + shortages.map(item => item.supply.name + ': precisa ' + item.quantity + ' ' + item.supply.unit + ', disponível ' + quantity(item.supply.quantity) + ' ' + item.supply.unit).join(' · '));
  const productionDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : brazilDate();
  state.supplies = (state.supplies || []).map(supply => {
    const used = needs[String(supply.id)];
    return !used ? supply : { ...supply, quantity: quantity(quantity(supply.quantity) - used.quantity), movements: [...(supply.movements || []), { id: randomId('mov'), kind: 'Produção', quantity: -used.quantity, total: used.cost, date: productionDate }] };
  });
  const output = quantity(costing.yieldUnits * count);
  const totalCost = round(costing.batchCost * count);
  const unitCost = round(totalCost / output);
  const existing = (state.readyStock || []).find(item => String(item.recipeId) === String(recipe.id));
  if (existing) {
    const previousQty = quantity(existing.quantity);
    const newQty = quantity(previousQty + output);
    state.readyStock = state.readyStock.map(item => String(item.recipeId) !== String(recipe.id) ? item : { ...item, name: recipe.name, productCategoryId: recipe.productCategoryId, productType: recipe.productType, quantity: newQty, unitCost: round((previousQty * numberOf(item.unitCost) + output * unitCost) / newQty), saleUnitPrice: numberOf(recipe.saleUnitPrice), movements: [...(item.movements || []), { id: randomId('mov'), kind: 'Produção', quantity: output, date: productionDate }] });
  } else {
    state.readyStock = [{ id: randomId('ready'), recipeId: recipe.id, name: recipe.name, productCategoryId: recipe.productCategoryId || 'gourmet', productType: recipe.productType || 'Geladinho gourmet', quantity: output, unitCost, saleUnitPrice: numberOf(recipe.saleUnitPrice), minimumStock: 0, movements: [{ id: randomId('mov'), kind: 'Produção', quantity: output, date: productionDate }] }, ...(state.readyStock || [])];
  }
  state.productions = [{ id: randomId('prod'), recipeId: recipe.id, recipeName: recipe.name, batches: count, outputQuantity: output, totalCost, unitCost, consumed: Object.entries(needs).map(([supplyId, value]) => ({ supplyId, quantity: value.quantity, cost: value.cost })), date: productionDate }, ...(state.productions || [])];
  return state;
}
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const slug = storeSlug(env);
  if (request.method === 'OPTIONS') return reply('', 204, request, env);

  if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'gelatos-lele-cloudflare', time: now() }, 200, request, env);

  if (request.method === 'POST' && path === '/v1/auth/login') {
    const body = await parseBody(request);
    const email = emailOf(body.email);
    const password = String(body.password || '');
    const member = await env.DB.prepare('SELECT member_id, store_slug, email, role, active, password_salt, password_hash FROM gelatos_team_members WHERE store_slug = ? AND email = ?').bind(slug, email).first();
    if (!member || Number(member.active) !== 1 || password.length < 8) return error('E-mail ou senha não conferem.', 401, request, env);
    const candidate = await passwordHash(password, member.password_salt);
    if (!sameText(candidate, member.password_hash)) return error('E-mail ou senha não conferem.', 401, request, env);
    await env.DB.prepare('DELETE FROM gelatos_sessions WHERE expires_at <= ?').bind(now()).run();
    return json(await createSession(env, member), 200, request, env);
  }

  if (request.method === 'POST' && path === '/v1/auth/bootstrap') {
    const body = await parseBody(request);
    const meta = await metaFor(env, slug);
    if (meta) return error('A empresa já foi migrada para a nova nuvem. Entre com o acesso criado.', 409, request, env);
    if (!env.BOOTSTRAP_CODE || !sameText(body.activationCode, env.BOOTSTRAP_CODE)) return error('Código de migração não confere.', 401, request, env);
    const email = emailOf(body.email);
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return error('Informe um e-mail e uma nova senha de pelo menos 8 caracteres.', 400, request, env);
    const pass = await passwordRecord(password);
    const state = normalizeState(body.state);
    const versionId = await createVersion(env, slug, state);
    try {
      await env.DB.prepare('INSERT INTO gelatos_state_meta (store_slug, active_version, revision, updated_at) VALUES (?, ?, 1, ?)').bind(slug, versionId, now()).run();
    } catch (cause) {
      await removeVersion(env, versionId);
      return error('A empresa já foi ativada em outro aparelho. Entre com o acesso criado.', 409, request, env);
    }
    const member = { member_id: randomId('member'), store_slug: slug, email, role: 'owner' };
    await env.DB.prepare('INSERT INTO gelatos_team_members (member_id, store_slug, email, role, password_salt, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').bind(member.member_id, slug, email, 'owner', pass.salt, pass.hash, now()).run();
    return json({ ...(await createSession(env, member)), revision: 1 }, 201, request, env);
  }

  if (request.method === 'POST' && path === '/v1/auth/change-password') {
    const member = await requireMember(request, env, false);
    const body = await parseBody(request);
    const password = String(body.password || '');
    if (password.length < 8) return error('Use uma senha com pelo menos 8 caracteres.', 400, request, env);
    const pass = await passwordRecord(password);
    await env.DB.prepare('UPDATE gelatos_team_members SET password_salt = ?, password_hash = ? WHERE member_id = ?').bind(pass.salt, pass.hash, member.member_id).run();
    await env.DB.prepare('DELETE FROM gelatos_sessions WHERE member_id = ?').bind(member.member_id).run();
    return json({ ok: true }, 200, request, env);
  }

  if (request.method === 'GET' && path === '/v1/revision') {
    await requireMember(request, env, false);
    const loaded = await latestStateWithExpiredReservations(env, slug);
    if (!loaded) return error('Empresa ainda não foi migrada.', 404, request, env);
    return json({ revision: loaded.meta.revision, updatedAt: loaded.meta.updated_at }, 200, request, env);
  }
  if (request.method === 'GET' && path === '/v1/state') {
    await requireMember(request, env, false);
    const loaded = await latestStateWithExpiredReservations(env, slug);
    if (!loaded) return error('Empresa ainda não foi migrada.', 404, request, env);
    return json({ state: loaded.state, revision: loaded.meta.revision, updatedAt: loaded.meta.updated_at }, 200, request, env);
  }
  if (request.method === 'PUT' && path === '/v1/state') {
    await requireMember(request, env, true);
    const body = await parseBody(request);
    const loaded = await latestStateWithExpiredReservations(env, slug);
    if (!loaded) return error('Empresa ainda não foi migrada.', 404, request, env);
    const committed = await commitState(env, slug, Number(body.revision), normalizeState(body.state), loaded.meta);
    if (committed.conflict) return error('CONFLITO: os dados foram alterados em outro celular. Atualize a tela e tente novamente.', 409, request, env, 'CONFLITO');
    return json({ revision: committed.revision, updatedAt: now() }, 200, request, env);
  }

  if (request.method === 'POST' && path === '/v1/production') {
    const member = await requireMember(request, env, false);
    if (!canProduce(member)) return error('Sem permissão para registrar produção.', 403, request, env);
    const body = await parseBody(request);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loaded = await latestStateWithExpiredReservations(env, slug);
      if (!loaded) return error('Empresa ainda não foi migrada.', 404, request, env);
      const state = structuredClone(loaded.state);
      await registerProduction(state, body.recipeId, body.batches, body.date);
      const committed = await commitState(env, slug, loaded.meta.revision, state, loaded.meta);
      if (!committed.conflict) return json({ state, revision: committed.revision, updatedAt: now() }, 200, request, env);
    }
    return error('CONFLITO: o estoque foi atualizado em outro acesso. Atualize e tente novamente.', 409, request, env, 'CONFLITO');
  }

  if (request.method === 'GET' && path === '/v1/catalog') {
    const loaded = await latestStateWithExpiredReservations(env, slug);
    if (!loaded) return error('Cardápio não encontrado.', 404, request, env);
    return json(catalogFromState(loaded.state, env), 200, request, env);
  }
  if (request.method === 'POST' && path === '/v1/catalog/images') {
    const body = await parseBody(request);
    const loaded = await latestStateWithExpiredReservations(env, slug);
    if (!loaded) return error('Cardápio não encontrado.', 404, request, env);
    return json({ images: publicImagesFromState(loaded.state, body.ids) }, 200, request, env);
  }
  if (request.method === 'POST' && path === '/v1/customer-order') {
    const body = await parseBody(request);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loaded = await latestStateWithExpiredReservations(env, slug);
      if (!loaded) return error('Cardápio não encontrado.', 404, request, env);
      const existing = findOrderByRequest(loaded.state, body.requestId);
      if (existing) return json(existing, 200, request, env);
      const state = structuredClone(loaded.state);
      let order;
      try { order = makeOrder(state, body); }
      catch (cause) { return error(cause.message || 'Não foi possível confirmar o pedido.', 400, request, env); }
      const committed = await commitState(env, slug, loaded.meta.revision, state, loaded.meta);
      if (!committed.conflict) return json(order, 201, request, env);
    }
    return error('O estoque foi atualizado por outro pedido. Atualize o cardápio e tente novamente.', 409, request, env, 'CONFLITO');
  }

  if (request.method === 'GET' && path === '/v1/team') {
    await requireMember(request, env, false);
    const rows = await env.DB.prepare('SELECT member_id, email, role, active, created_at FROM gelatos_team_members WHERE store_slug = ? ORDER BY created_at').bind(slug).all();
    return json({ members: (rows.results || []).map(item => ({ userId: item.member_id, email: item.email, role: item.role, active: Boolean(item.active), createdAt: item.created_at })) }, 200, request, env);
  }
  if (request.method === 'POST' && path === '/v1/team') {
    const owner = await requireMember(request, env, false);
    if (owner.role !== 'owner') return error('Apenas a proprietária pode incluir pessoas.', 403, request, env);
    const body = await parseBody(request);
    const email = emailOf(body.email), password = String(body.password || ''), role = ['manager', 'production', 'sales', 'viewer'].includes(body.role) ? body.role : 'manager';
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return error('Informe e-mail e uma senha provisória de pelo menos 8 caracteres.', 400, request, env);
    const exists = await env.DB.prepare('SELECT member_id FROM gelatos_team_members WHERE store_slug = ? AND email = ?').bind(slug, email).first();
    if (exists) return error('Já existe uma pessoa com este e-mail.', 409, request, env);
    const pass = await passwordRecord(password);
    const memberId = randomId('member');
    await env.DB.prepare('INSERT INTO gelatos_team_members (member_id, store_slug, email, role, password_salt, password_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').bind(memberId, slug, email, role, pass.salt, pass.hash, now()).run();
    return json({ member: { userId: memberId, email, role } }, 201, request, env);
  }
  if (request.method === 'DELETE' && path.startsWith('/v1/team/')) {
    const owner = await requireMember(request, env, false);
    if (owner.role !== 'owner') return error('Apenas a proprietária pode remover pessoas.', 403, request, env);
    const id = decodeURIComponent(path.slice('/v1/team/'.length));
    const target = await env.DB.prepare('SELECT member_id, role FROM gelatos_team_members WHERE store_slug = ? AND member_id = ?').bind(slug, id).first();
    if (!target) return error('Pessoa não encontrada.', 404, request, env);
    if (target.role === 'owner') return error('A proprietária não pode ser removida.', 400, request, env);
    await env.DB.batch([
      env.DB.prepare('UPDATE gelatos_team_members SET active = 0 WHERE member_id = ?').bind(id),
      env.DB.prepare('DELETE FROM gelatos_sessions WHERE member_id = ?').bind(id)
    ]);
    return json({ ok: true }, 200, request, env);
  }

  if (request.method === 'GET' && path === '/v1/backups') {
    await requireMember(request, env, false);
    const rows = await env.DB.prepare('SELECT snapshot_date, revision, saved_at FROM gelatos_state_snapshots WHERE store_slug = ? ORDER BY snapshot_date DESC LIMIT 90').bind(slug).all();
    return json({ backups: (rows.results || []).map(item => ({ snapshotDate: item.snapshot_date, revision: item.revision, savedAt: item.saved_at })) }, 200, request, env);
  }
  if (request.method === 'POST' && /^\/v1\/backups\/[^/]+\/restore$/.test(path)) {
    await requireMember(request, env, true);
    const snapshotDate = decodeURIComponent(path.split('/')[3]);
    const snapshot = await env.DB.prepare('SELECT version_id FROM gelatos_state_snapshots WHERE store_slug = ? AND snapshot_date = ?').bind(slug, snapshotDate).first();
    const loaded = await loadState(env, slug);
    if (!snapshot || !loaded) return error('Cópia não encontrada.', 404, request, env);
    const updated = await env.DB.prepare('UPDATE gelatos_state_meta SET active_version = ?, revision = revision + 1, updated_at = ? WHERE store_slug = ? AND revision = ?').bind(snapshot.version_id, now(), slug, loaded.meta.revision).run();
    if (Number(updated.meta?.changes || 0) !== 1) return error('CONFLITO: os dados foram alterados em outro celular. Tente novamente.', 409, request, env, 'CONFLITO');
    await snapshotOldVersion(env, slug, loaded.meta);
    return json({ state: await stateForVersion(env, snapshot.version_id), revision: loaded.meta.revision + 1 }, 200, request, env);
  }

  if (request.method === 'GET' && path === '/v1/media-recovery') {
    await requireMember(request, env, false);
    const loaded = await loadState(env, slug);
    if (!loaded) return error('Empresa não encontrada.', 404, request, env);
    const settings = loaded.state.settings || {};
    return json({ recipes: (loaded.state.recipes || []).map(recipe => ({ id: recipe.id, imageData: recipe.imageData || '' })), logos: { homeLogoDataUrl: settings.homeLogoDataUrl || '', headerLogoDataUrl: settings.headerLogoDataUrl || '', catalogLogoDataUrl: settings.catalogLogoDataUrl || '' } }, 200, request, env);
  }
  if (request.method === 'GET' && path.startsWith('/v1/media/')) {
    const key = safeKey(path.slice('/v1/media/'.length));
    if (!key) return reply('Imagem não encontrada.', 404, request, env);
    const object = await env.GELATOS_MEDIA.get(key);
    if (!object) return reply('Imagem não encontrada.', 404, request, env);
    const headers = new Headers(cors(request, env));
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }
  if (request.method === 'POST' && path === '/v1/media') {
    await requireMember(request, env, true);
    const body = await parseBody(request);
    const key = safeKey(body.key);
    if (!key) return error('Identificação de imagem inválida.', 400, request, env);
    try {
      const image = dataUrlToBytes(body.dataUrl);
      await env.GELATOS_MEDIA.put(key, image.bytes, { httpMetadata: { contentType: image.mime, cacheControl: 'public, max-age=31536000, immutable' } });
      return json({ key, url: url.origin + '/v1/media/' + encodeURIComponent(key) }, 201, request, env);
    } catch (cause) { return error(cause.message || 'Não foi possível salvar a imagem.', 400, request, env); }
  }

  return error('Rota não encontrada.', 404, request, env);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (cause) {
      const message = cause?.message || 'Não foi possível concluir esta operação.';
      return error(message, Number(cause?.status) || 500, request, env);
    }
  }
};
