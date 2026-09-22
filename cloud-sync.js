(() => {
  'use strict';
  const config = window.GelatosCloudConfig;
  const SESSION_KEY = 'gelatos-lele-cloud-session-v1';
  let session = null;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
  }
  function persistSession(value) {
    session = value || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  function messageFrom(response, fallback) {
    if (!response) return fallback;
    return response.message || response.msg || response.error_description || response.hint || fallback;
  }
  async function request(path, options = {}) {
    const headers = { apikey: config.publishableKey, ...(options.headers || {}) };
    if (options.accessToken) headers.Authorization = 'Bearer ' + options.accessToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(config.url + path, {
      method: options.method || 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // O cardápio muda a cada pedido. Nunca reutilize uma resposta antiga.
      cache: options.cache || 'no-store'
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = raw; }
    if (!response.ok) throw new Error(messageFrom(body, 'Não foi possível falar com a nuvem.'));
    return body;
  }
  async function validSession() {
    if (!session) session = readSession();
    if (!session) return null;
    const expiresAt = Number(session.expires_at || 0) * 1000;
    if (expiresAt && expiresAt - Date.now() > 60000) return session;
    if (!session.refresh_token) { persistSession(null); return null; }
    try {
      const refreshed = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
      persistSession(refreshed);
      return session;
    } catch (_) { persistSession(null); return null; }
  }
  async function authenticatedToken() {
    const current = await validSession();
    if (!current?.access_token) throw new Error('Entre na nuvem para acessar os dados da empresa.');
    return current.access_token;
  }
  async function rpc(name, args, needsLogin = true) {
    const accessToken = needsLogin ? await authenticatedToken() : '';
    return request('/rest/v1/rpc/' + name, { body: args, accessToken });
  }
  async function signUp(email, password) {
    const result = await request('/auth/v1/signup', { body: { email, password } });
    if (result?.access_token) persistSession(result);
    return result;
  }
  async function signIn(email, password) {
    const result = await request('/auth/v1/token?grant_type=password', { body: { email, password } });
    persistSession(result);
    return result;
  }
  async function claimStore(activationCode) {
    return rpc('gelatos_claim_store', { p_slug: config.storeSlug, p_activation_code: activationCode });
  }
  async function getState() {
    return rpc('gelatos_get_state', { p_slug: config.storeSlug });
  }
  async function saveState(state, revision) {
    return rpc('gelatos_save_state', { p_slug: config.storeSlug, p_state: state, p_revision: revision });
  }
  async function getCatalog() {
    const query = '?store_slug=eq.' + encodeURIComponent(config.storeSlug) + '&select=payload';
    const rows = await request('/rest/v1/gelatos_public_catalog' + query, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' }
    });
    if (!Array.isArray(rows) || !rows[0]?.payload || !Array.isArray(rows[0].payload.products)) throw new Error('O cardápio ainda está sendo preparado. Tente novamente em instantes.');
    return rows[0].payload;
  }
  async function placeCustomerOrder(order) {
    return rpc('gelatos_place_customer_order', {
      p_slug: config.storeSlug,
      p_request_id: order.requestId,
      p_customer: order.customer,
      p_mode: order.mode,
      p_zone_id: order.zoneId,
      p_address: order.address,
      p_payment: order.payment,
      p_items: order.items
    }, false);
  }
  function hasSession() { return Boolean(session?.access_token || readSession()?.access_token); }
  function email() { return session?.user?.email || readSession()?.user?.email || ''; }
  function signOut() { persistSession(null); }

  window.GelatosCloud = Object.freeze({ config, hasSession, email, signUp, signIn, signOut, claimStore, getState, saveState, getCatalog, placeCustomerOrder });
})();
