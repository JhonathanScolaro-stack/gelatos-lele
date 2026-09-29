(() => {
  'use strict';

  /* Cliente pequeno do Worker Cloudflare. O app mantém a mesma interface
     interna; por isso receitas, estoque e o cardápio não precisam conhecer o
     banco de dados nem carregam chaves administrativas no navegador. */
  const config = window.GelatosCloudConfig;
  const SESSION_KEY = 'gelatos-lele-cloudflare-session-v1';
  const LEGACY_SESSION_KEY = 'gelatos-lele-cloud-session-v1';
  let session = null;

  function stored(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }
  function persist(value) {
    session = value || null;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch (_) { /* Sem espaço local, a sessão continua válida nesta abertura. */ }
  }
  function apiBase() { return String(config.apiUrl || '').replace(/\/$/, ''); }
  function message(response, fallback) { return response?.error || response?.message || response?.msg || fallback; }
  async function request(path, options = {}) {
    const base = apiBase();
    if (!base) throw new Error('A nova nuvem ainda não está configurada.');
    const headers = { ...(options.headers || {}) };
    if (options.accessToken) headers.Authorization = 'Bearer ' + options.accessToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(base + path, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' });
    } catch (_) {
      const error = new Error('CONEXAO_NUVEM_INDISPONIVEL');
      error.code = 'CONEXAO_NUVEM_INDISPONIVEL';
      throw error;
    }
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = { error: raw }; }
    if (!response.ok) {
      const error = new Error(message(body, 'Não foi possível falar com a nuvem.'));
      error.code = body?.code || '';
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function currentSession() {
    if (!session) session = stored(SESSION_KEY);
    const expires = Number(session?.expires_at || 0) * 1000;
    if (!session?.access_token || (expires && expires <= Date.now())) { persist(null); return null; }
    return session;
  }
  async function token() {
    const active = currentSession();
    if (!active?.access_token) throw new Error('Entre na nuvem para acessar os dados da empresa.');
    return active.access_token;
  }
  async function authenticated(path, options = {}) { return request(path, { ...options, accessToken: await token() }); }
  async function signIn(email, password) {
    const result = await request('/v1/auth/login', { method: 'POST', body: { email, password } });
    persist(result);
    return result;
  }
  function signOut() { persist(null); }
  function hasSession() { return Boolean(currentSession()?.access_token); }
  function email() { return String(currentSession()?.user?.email || ''); }
  function role() { return String(currentSession()?.user?.role || ''); }
  function isConnectionError(error) { return error?.code === 'CONEXAO_NUVEM_INDISPONIVEL' || /failed to fetch|networkerror|conexao_nuvem/i.test(String(error?.message || '')); }

  // Migração única: aproveita o login Supabase já existente no aparelho que
  // contém os dados corretos. Nenhuma senha do Supabase é enviada ao novo
  // banco. Se a sessão antiga tiver expirado, usamos a cópia local do app.
  function legacySession() { return stored(LEGACY_SESSION_KEY); }
  function hasLegacySession() { return Boolean(legacySession()?.access_token || legacySession()?.refresh_token); }
  async function legacyRequest(path, options = {}) {
    const legacy = config.legacySupabase || {};
    const headers = { apikey: legacy.publishableKey, ...(options.headers || {}) };
    if (options.accessToken) headers.Authorization = 'Bearer ' + options.accessToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(String(legacy.url || '').replace(/\/$/, '') + path, { method: options.method || 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = { error: raw }; }
    if (!response.ok) throw new Error(message(body, 'Não foi possível ler a cópia antiga da nuvem.'));
    return body;
  }
  async function legacyState() {
    const legacy = legacySession();
    if (!legacy?.access_token && !legacy?.refresh_token) return null;
    let active = legacy;
    const expiresAt = Number(active.expires_at || 0) * 1000;
    if ((!active.access_token || (expiresAt && expiresAt <= Date.now() + 60000)) && active.refresh_token) {
      active = await legacyRequest('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: active.refresh_token } });
      try { localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(active)); } catch (_) {}
    }
    if (!active?.access_token) return null;
    const result = await legacyRequest('/rest/v1/rpc/gelatos_get_state', { body: { p_slug: config.storeSlug }, accessToken: active.access_token });
    return result?.state && typeof result.state === 'object' ? result.state : null;
  }
  function looksLikeCompanyData(value) {
    if (!value || typeof value !== 'object') return false;
    return ['recipes', 'supplies', 'orders', 'productions', 'purchases', 'expenses'].some(key => Array.isArray(value[key]) && value[key].length > 0);
  }
  async function bootstrapMigration({ email: nextEmail, password, activationCode, localState }) {
    let state = null;
    try { state = await legacyState(); } catch (_) { /* A cópia deste aparelho é a alternativa segura. */ }
    if (!looksLikeCompanyData(state)) state = localState;
    if (!looksLikeCompanyData(state)) throw new Error('Não encontramos os cadastros deste celular. Abra a versão antiga neste aparelho e tente novamente.');
    const result = await request('/v1/auth/bootstrap', { method: 'POST', body: { email: nextEmail, password, activationCode, state } });
    persist(result);
    return result;
  }

  async function getState() { return authenticated('/v1/state'); }
  async function getRevision() { return authenticated('/v1/revision'); }
  async function saveState(state, revision) { return authenticated('/v1/state', { method: 'PUT', body: { state, revision } }); }
  async function registerProduction(recipeId, batches, date) { return authenticated('/v1/production', { method: 'POST', body: { recipeId, batches, date } }); }
  async function getCatalog() { return request('/v1/catalog'); }
  async function getCatalogImages(imageIds) { return request('/v1/catalog/images', { method: 'POST', body: { ids: Array.isArray(imageIds) ? imageIds.slice(0, 30) : [] } }); }
  async function getMediaRecovery() { return authenticated('/v1/media-recovery'); }
  async function uploadMedia(key, dataUrl) { return authenticated('/v1/media', { method: 'POST', body: { key, dataUrl } }); }
  async function placeCustomerOrder(order) { return request('/v1/customer-order', { method: 'POST', body: order }); }
  async function listMembers() { return authenticated('/v1/team'); }
  async function addMember(email, roleValue, password) { return authenticated('/v1/team', { method: 'POST', body: { email, role: roleValue, password } }); }
  async function removeMember(userId) { return authenticated('/v1/team/' + encodeURIComponent(userId), { method: 'DELETE' }); }
  async function listBackups() { return authenticated('/v1/backups'); }
  async function restoreBackup(snapshotDate) { return authenticated('/v1/backups/' + encodeURIComponent(snapshotDate) + '/restore', { method: 'POST', body: {} }); }
  async function updatePassword(password) { return authenticated('/v1/auth/change-password', { method: 'POST', body: { password } }); }

  window.GelatosCloud = Object.freeze({
    config, hasSession, email, role, signIn, signOut, isConnectionError,
    hasLegacySession, bootstrapMigration, getState, getRevision, saveState,
    registerProduction, getCatalog, getCatalogImages, getMediaRecovery,
    uploadMedia, placeCustomerOrder, listMembers, addMember, removeMember,
    listBackups, restoreBackup, updatePassword,
    // Mantidos somente para uma abertura intermediária não quebrar.
    isPasswordRecovery: () => false,
    resetPassword: async () => { throw new Error('Peça à proprietária para criar uma nova senha de acesso.'); },
    signUp: async () => { throw new Error('A proprietária cria os acessos em Configurações › Equipe e acessos.'); },
    claimStore: async () => { throw new Error('Use a migração para Cloudflare nesta versão.'); }
  });
})();
