import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PROMPT = `Extract the single fashion item shown in the reference image. Create a faithful premium e-commerce product cutout of that exact item, preserving its shape, color, material, pattern, proportions, and distinctive details. Show the full item centered with a natural product-photo perspective. Add a smooth, thick white sticker outline around the complete silhouette. Use a genuinely transparent background outside the white outline. No person, body part, hanger, mannequin, extra object, logo, added text, watermark, frame, floor, or backdrop.`;

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_URL');
  if (['localhost', '0.0.0.0'].includes(url.hostname.toLowerCase())) throw new Error('INVALID_URL');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateAddress(address))) throw new Error('INVALID_URL');
  return url;
}

async function readRequest(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body);
  if (request.body && typeof request.body === 'object') return Buffer.from(JSON.stringify(request.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_SOURCE_BYTES * 1.4) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function safeFetch(urlValue, options = {}, redirects = 0) {
  const url = await assertPublicUrl(urlValue);
  const result = await fetch(url, { ...options, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (redirects >= 4) throw new Error('SOURCE_UNAVAILABLE');
    const location = result.headers.get('location');
    if (!location) throw new Error('SOURCE_UNAVAILABLE');
    return safeFetch(new URL(location, url).href, options, redirects + 1);
  }
  return result;
}

function photoFromDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('INVALID_PHOTO');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) throw new Error('INVALID_PHOTO');
  return { buffer, type: match[1], source: 'photo' };
}

function metaImage(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return new URL(match[1].replaceAll('&amp;', '&'), baseUrl).href;
  }
  throw new Error('PRODUCT_IMAGE_NOT_FOUND');
}

async function binaryResponse(response, type, source) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_SOURCE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  return { buffer, type, source };
}

async function download(urlValue) {
  const url = await assertPublicUrl(urlValue);
  const page = await safeFetch(url.href, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 PaletteBot/1.0', Accept: 'image/*,text/html;q=0.9' } });
  if (!page.ok) throw new Error('SOURCE_UNAVAILABLE');
  const type = (page.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(type)) return binaryResponse(page, type, url.href);
  if (type !== 'text/html') throw new Error('UNSUPPORTED_SOURCE');
  const html = (await page.text()).slice(0, 1_500_000);
  const imageUrl = metaImage(html, page.url);
  await assertPublicUrl(imageUrl);
  const image = await safeFetch(imageUrl, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 PaletteBot/1.0', Accept: 'image/*' } });
  if (!image.ok) throw new Error('SOURCE_UNAVAILABLE');
  const imageType = (image.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(imageType)) throw new Error('UNSUPPORTED_IMAGE');
  return binaryResponse(image, imageType, url.href);
}

async function sourceFromRequest(request) {
  const contentType = (request.headers['content-type'] || '').split(';')[0].toLowerCase();
  const raw = await readRequest(request);
  if (ALLOWED_IMAGE_TYPES.has(contentType)) {
    if (!raw.length || raw.length > MAX_SOURCE_BYTES) throw new Error('INVALID_PHOTO');
    return { item: { buffer: raw, type: contentType, source: 'photo' }, userId: request.query.user_id };
  }
  if (contentType !== 'application/json') throw new Error('UNSUPPORTED_CONTENT_TYPE');
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new Error('INVALID_JSON'); }
  const userId = String(body.user_id || '');
  if (body.url && body.photo) throw new Error('ONE_SOURCE_ONLY');
  if (body.url) return { item: await download(body.url), userId };
  if (body.photo) return { item: photoFromDataUrl(body.photo), userId };
  throw new Error('SOURCE_REQUIRED');
}

async function generate(item) {
  const form = new FormData();
  form.set('model', 'gpt-image-2.5-sunburst');
  form.set('prompt', PROMPT);
  form.set('image', new Blob([item.buffer], { type: item.type }), `source.${item.type.split('/')[1]}`);
  form.set('background', 'transparent');
  form.set('output_format', 'webp');
  form.set('output_compression', '85');
  form.set('size', '1024x1024');
  form.set('quality', 'medium');

  const result = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120000)
  });
  const payload = await result.json();
  if (!result.ok) {
    console.error('OpenAI image generation failed', result.status, payload?.error?.code || 'unknown');
    throw new Error('GENERATION_FAILED');
  }
  const image = payload?.data?.[0]?.b64_json;
  if (!image) throw new Error('GENERATION_FAILED');
  return { image: `data:image/webp;base64,${image}`, usage: payload.usage || null };
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method === 'GET') return send(response, 200, {
    endpoint: '/api/items',
    configured: Boolean(process.env.OPENAI_API_KEY),
    accepts: ['application/json: { user_id, url }', 'application/json: { user_id, photo: data_url }', 'image/png|jpeg|webp body with ?user_id=...']
  });
  if (request.method !== 'POST') return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!process.env.OPENAI_API_KEY) return send(response, 503, { error: 'GENERATION_NOT_CONFIGURED', message: 'OPENAI_API_KEY is not configured on the server.' });

  try {
    const { item, userId } = await sourceFromRequest(request);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(userId || ''))) return send(response, 400, { error: 'INVALID_USER_ID' });
    const generated = await generate(item);
    return send(response, 201, { id: crypto.randomUUID(), user_id: userId, source: item.source, image: generated.image, usage: generated.usage, created_at: new Date().toISOString() });
  } catch (error) {
    const code = error?.message || 'INTERNAL_ERROR';
    const clientErrors = new Set(['INVALID_URL', 'PAYLOAD_TOO_LARGE', 'INVALID_PHOTO', 'PRODUCT_IMAGE_NOT_FOUND', 'SOURCE_UNAVAILABLE', 'UNSUPPORTED_SOURCE', 'UNSUPPORTED_IMAGE', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_CONTENT_TYPE', 'INVALID_JSON', 'ONE_SOURCE_ONLY', 'SOURCE_REQUIRED']);
    return send(response, clientErrors.has(code) ? 400 : 502, { error: code });
  }
}
