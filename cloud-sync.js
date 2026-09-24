(() => {
  'use strict';
  const config = window.GelatosCloudConfig;
  const SESSION_KEY = 'gelatos-lele-cloud-session-v1';
  let session = null;
  let passwordRecovery = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; }
  }
  function persistSession(value) {
    session = value || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  function consumePasswordRecovery() {
    const params = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    if (params.get('type') !== 'recovery' || !params.get('access_token')) return false;
    persistSession({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token') || '',
      expires_at: Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600),
      token_type: params.get('token_type') || 'bearer'
    });
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    return true;
  }
  passwordRecovery = consumePasswordRecovery();
  function messageFrom(response, fallback) {
    if (!response) return fallback;
    return response.message || response.msg || response.error_description || response.hint || fallback;
  }
  async function request(path, options = {}) {
    const headers = { apikey: config.publishableKey, ...(options.headers || {}) };
    if (options.accessToken) headers.Authorization = 'Bearer ' + options.accessToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(config.url + path, {
        method: options.method || 'POST',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // O cardápio muda a cada pedido. Nunca reutilize uma resposta antiga.
        cache: options.cache || 'no-store'
      });
    } catch (_) {
      const error = new Error('CONEXAO_NUVEM_INDISPONIVEL');
      error.code = 'CONEXAO_NUVEM_INDISPONIVEL';
      throw error;
    }
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
  async function resetPassword(email) {
    return request('/auth/v1/recover', {
      body: { email, redirect_to: window.location.origin + window.location.pathname }
    });
  }
  async function updatePassword(password) {
    const accessToken = await authenticatedToken();
    const result = await request('/auth/v1/user', { method: 'PUT', accessToken, body: { password } });
    passwordRecovery = false;
    return result;
  }
  async function claimStore(activationCode) {
    return rpc('gelatos_claim_store', { p_slug: config.storeSlug, p_activation_code: activationCode });
  }
  async function getState() {
    return rpc('gelatos_get_state', { p_slug: config.storeSlug });
  }
  async function getRevision() {
    return rpc('gelatos_get_revision', { p_slug: config.storeSlug });
  }
  async function saveState(state, revision) {
    return rpc('gelatos_save_state', { p_slug: config.storeSlug, p_state: state, p_revision: revision });
  }
  async function getCatalog() {
    const result = await rpc('gelatos_get_public_catalog', { p_slug: config.storeSlug }, false);
    if (!result?.payload || !Array.isArray(result.payload.products)) throw new Error('O cardápio ainda está sendo preparado. Tente novamente em instantes.');
    return result.payload;
  }
  async function placeCustomerOrder(order) {
    return rpc('gelatos_place_customer_order', {
      p_slug: config.storeSlug,
      p_request_id: order.requestId,
      p_client_id: order.clientId,
      p_customer: order.customer,
      p_phone: order.phone,
      p_mode: order.mode,
      p_zone_id: order.zoneId,
      p_address: order.address,
      p_payment: order.payment,
      p_order_kind: order.orderKind || 'ready',
      p_scheduled_for: order.scheduledFor || null,
      p_items: order.items
    }, false);
  }
  async function listMembers() { return rpc('gelatos_list_members', { p_slug: config.storeSlug }); }
  async function addMember(email, role) { return rpc('gelatos_add_member', { p_slug: config.storeSlug, p_email: email, p_role: role }); }
  async function removeMember(userId) { return rpc('gelatos_remove_member', { p_slug: config.storeSlug, p_user_id: userId }); }
  async function listBackups() { return rpc('gelatos_list_backups', { p_slug: config.storeSlug }); }
  async function restoreBackup(snapshotDate) { return rpc('gelatos_restore_backup', { p_slug: config.storeSlug, p_snapshot_date: snapshotDate }); }
  function hasSession() { return Boolean(session?.access_token || readSession()?.access_token); }
  function email() { return session?.user?.email || readSession()?.user?.email || ''; }
  function signOut() { persistSession(null); }

  function isConnectionError(error) {
    return error?.code === 'CONEXAO_NUVEM_INDISPONIVEL' || /failed to fetch|networkerror|conex[aã]o_nuvem/i.test(String(error?.message || ''));
  }
  function isPasswordRecovery() { return passwordRecovery; }

  window.GelatosCloud = Object.freeze({ config, hasSession, email, signUp, signIn, signOut, resetPassword, updatePassword, isPasswordRecovery, isConnectionError, claimStore, getState, getRevision, saveState, getCatalog, placeCustomerOrder, listMembers, addMember, removeMember, listBackups, restoreBackup });
})();
