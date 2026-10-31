import crypto from 'node:crypto';
import { readPalette, updatePalette, validUserId } from './_palette-store.mjs';
import { normalizeShopUrl, shopDirectory, shopNameFromDomain } from '../shops.mjs';

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function bodyOf(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  try { return JSON.parse(request.body || '{}'); } catch { throw new Error('INVALID_JSON'); }
}

function sameOrigin(request) {
  const origin = String(request.headers?.origin || '');
  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export default async function handler(request, response) {
  const userId = String(request.query?.user_id || '');
  if (!validUserId(userId)) return send(response, 400, { error: 'INVALID_USER_ID' });

  if (request.method === 'GET') {
    try {
      const { state } = await readPalette(userId);
      const shops = shopDirectory(state);
      return send(response, 200, { shops, count: shops.length });
    } catch (error) {
      console.error('Shop directory read failed', error?.message);
      return send(response, 503, { error: 'STORAGE_UNAVAILABLE' });
    }
  }

  if (!sameOrigin(request)) return send(response, 403, { error: 'SAME_ORIGIN_REQUIRED' });

  try {
    if (request.method === 'POST') {
      const body = bodyOf(request);
      const normalized = normalizeShopUrl(body.url);
      const name = String(body.name || '').trim().slice(0, 80) || shopNameFromDomain(normalized.domain);
      const state = await updatePalette(userId, current => {
        current.manual_shops ||= [];
        const existing = current.manual_shops.find(shop => {
          try { return normalizeShopUrl(shop.url || shop.domain).domain === normalized.domain; } catch { return false; }
        });
        if (existing) {
          existing.name = name;
          existing.url = normalized.url;
        } else {
          current.manual_shops.push({ id: crypto.randomUUID(), name, url: normalized.url, domain: normalized.domain, created_at: new Date().toISOString() });
        }
        return current;
      });
      return send(response, 201, { shops: shopDirectory(state) });
    }

    if (request.method === 'DELETE') {
      const id = String(bodyOf(request).id || '');
      const state = await updatePalette(userId, current => {
        const before = current.manual_shops?.length || 0;
        current.manual_shops = (current.manual_shops || []).filter(shop => shop.id !== id);
        if (current.manual_shops.length === before) throw new Error('SHOP_NOT_FOUND');
        return current;
      });
      return send(response, 200, { shops: shopDirectory(state) });
    }
    return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const code = error?.message || 'INTERNAL_ERROR';
    const client = new Set(['INVALID_JSON', 'SHOP_URL_REQUIRED', 'INVALID_SHOP_URL', 'SHOP_NOT_FOUND']);
    console.error('Shop directory mutation failed', code);
    return send(response, client.has(code) ? 400 : 500, { error: code });
  }
}
