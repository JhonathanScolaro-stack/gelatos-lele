/*
 * Gelatos Lele — Worker de imagens para Cloudflare R2.
 *
 * Variáveis do Worker:
 * - SUPABASE_URL: https://<projeto>.supabase.co
 * - SUPABASE_ANON_KEY: chave publicável do projeto Supabase
 * - STORE_SLUG: gelatos-lele
 * - ALLOWED_ORIGIN: https://jhonathanscolaro-stack.github.io
 *
 * Binding R2:
 * - GELATOS_MEDIA: bucket gelatos-lele-media
 *
 * O token do Supabase é enviado somente em POST/DELETE para comprovar que a
 * pessoa é membro da empresa. Ele não é salvo no Worker nem é usado em GET.
 */

const MAX_IMAGE_BYTES = 1_200_000;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin'
  };
}

function response(body, status, request, env, extra = {}) {
  return new Response(body, { status, headers: { ...corsHeaders(request, env), ...extra } });
}

function json(value, status, request, env) {
  return response(JSON.stringify(value), status, request, env, { 'Content-Type': 'application/json; charset=utf-8' });
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
  const base64 = match[2].replace(/\s/g, '');
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) throw new Error('A imagem é grande demais.');
  const binary = atob(base64);
  if (binary.length > MAX_IMAGE_BYTES) throw new Error('A imagem é grande demais.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase(), bytes };
}

async function isCompanyMember(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return false;
  const check = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/gelatos_get_state', {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_slug: env.STORE_SLUG })
  });
  return check.ok;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return response('', 204, request, env);

    if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
      const key = safeKey(url.pathname.slice('/media/'.length));
      if (!key) return response('Imagem não encontrada.', 404, request, env);
      const object = await env.GELATOS_MEDIA.get(key);
      if (!object) return response('Imagem não encontrada.', 404, request, env);
      const headers = new Headers(corsHeaders(request, env));
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    if (request.method === 'POST' && url.pathname === '/media') {
      if (!(await isCompanyMember(request, env))) return json({ error: 'Acesso não autorizado.' }, 401, request, env);
      let payload;
      try { payload = await request.json(); } catch (_) { return json({ error: 'Envie uma imagem válida.' }, 400, request, env); }
      const key = safeKey(payload?.key);
      if (!key) return json({ error: 'Identificação de imagem inválida.' }, 400, request, env);
      try {
        const image = dataUrlToBytes(payload?.dataUrl);
        await env.GELATOS_MEDIA.put(key, image.bytes, {
          httpMetadata: { contentType: image.mime, cacheControl: 'public, max-age=31536000, immutable' }
        });
        return json({ key, url: url.origin + '/media/' + encodeURIComponent(key) }, 201, request, env);
      } catch (error) {
        return json({ error: error.message || 'Não foi possível salvar a imagem.' }, 400, request, env);
      }
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/media/')) {
      if (!(await isCompanyMember(request, env))) return json({ error: 'Acesso não autorizado.' }, 401, request, env);
      const key = safeKey(url.pathname.slice('/media/'.length));
      if (!key) return json({ error: 'Identificação de imagem inválida.' }, 400, request, env);
      await env.GELATOS_MEDIA.delete(key);
      return response('', 204, request, env);
    }

    return response('Rota não encontrada.', 404, request, env);
  }
};
