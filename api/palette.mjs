import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { defaultWidth, inferCategory, readPalette, saveProductImage, updatePalette, validUserId } from './_palette-store.mjs';
import { fetchProduct, generate, resolveProductQuery } from './items.mjs';

export const config = { maxDuration: 180 };

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function bodyOf(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  try { return JSON.parse(request.body || '{}'); } catch { throw new Error('INVALID_JSON'); }
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function displayTitle(input) {
  const value = String(input || '').trim();
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    const productIndex = parts.lastIndexOf('product');
    const useful = (productIndex >= 0 ? parts.slice(productIndex + 1) : parts.slice(-2)).slice(0, 2);
    if (useful.length) return useful.map(part => part.replace(/[-_]+/g, ' ')).join(' · ').toUpperCase();
  } catch {}
  return value.toUpperCase();
}

export function sameOrigin(request) {
  const origin = String(request.headers?.origin || '');
  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '');
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function intakeMetadata(body = {}) {
  const price = String(body.price ?? '').trim().slice(0, 32) || null;
  const currency = price ? (String(body.currency ?? '').trim().toUpperCase().slice(0, 8) || 'EUR') : null;
  return { price, currency };
}

export function applyLayerOrder(items, id, action) {
  const ordered = [...items].sort((a, b) => (a.z || 0) - (b.z || 0));
  const index = ordered.findIndex(item => item.id === id);
  if (index < 0) throw new Error('ITEM_NOT_FOUND');
  const target = action === 'front' ? ordered.length - 1 :
    action === 'back' ? 0 :
    action === 'up' ? Math.min(index + 1, ordered.length - 1) :
    action === 'down' ? Math.max(index - 1, 0) : null;
  if (target === null) throw new Error('INVALID_LAYER_ACTION');
  return applyLayerPosition(items, id, target);
}

export function applyLayerPosition(items, id, position) {
  const ordered = [...items].sort((a, b) => (a.z || 0) - (b.z || 0));
  const index = ordered.findIndex(item => item.id === id);
  if (index < 0) throw new Error('ITEM_NOT_FOUND');
  const target = Math.min(ordered.length - 1, Math.max(0, Math.round(Number(position))));
  if (!Number.isFinite(target)) throw new Error('INVALID_LAYER_ACTION');
  const [item] = ordered.splice(index, 1);
  ordered.splice(target, 0, item);
  ordered.forEach((entry, position) => { entry.z = position + 1; });
  return items;
}

async function processPending(userId, itemId, input) {
  try {
    const url = await resolveProductQuery(input);
    const { item, product } = await fetchProduct(url);
    const generated = await generate(item);
    const stored = await saveProductImage(userId, itemId, generated.buffer);
    await updatePalette(userId, state => {
      const target = state.items.find(entry => entry.id === itemId);
      if (!target) return state;
      const catalogId = target.catalog_id || target.id;
      for (const entry of state.items.filter(item => (item.catalog_id || item.id) === catalogId)) {
        entry.status = 'ready';
        entry.title = (product?.title || input).toUpperCase();
        entry.source_url = product?.page_url || url;
        entry.image_url = stored.url;
        entry.price = entry.price || product?.price || null;
        entry.currency = entry.currency || product?.currency || null;
        entry.category = inferCategory(product?.category || entry.title);
        entry.error = null;
        if (entry.auto_width) entry.width = defaultWidth(entry.title);
        delete entry.auto_width;
      }
      return state;
    });
  } catch (error) {
    console.error('Palette background intake failed', error?.message || 'INTERNAL_ERROR');
    await updatePalette(userId, state => {
      const target = state.items.find(entry => entry.id === itemId);
      if (target) {
        const catalogId = target.catalog_id || target.id;
        for (const entry of state.items.filter(item => (item.catalog_id || item.id) === catalogId)) {
          entry.status = 'failed';
          entry.error = error?.message || 'PROCESSING_FAILED';
        }
      }
      return state;
    }).catch(() => {});
  }
}

export default async function handler(request, response) {
  const userId = String(request.query?.user_id || '');
  if (!validUserId(userId)) return send(response, 400, { error: 'INVALID_USER_ID' });

  if (request.method === 'GET') {
    try {
      const { state } = await readPalette(userId);
      return send(response, 200, state);
    } catch (error) {
      console.error('Palette read failed', error?.message);
      return send(response, 503, { error: 'STORAGE_UNAVAILABLE' });
    }
  }

  if (!sameOrigin(request)) return send(response, 403, { error: 'SAME_ORIGIN_REQUIRED' });

  try {
    if (request.method === 'POST') {
      const body = bodyOf(request);
      if (body.copy_id) {
        const state = await updatePalette(userId, current => {
          const source = current.items.find(item => item.id === String(body.copy_id));
          if (!source) throw new Error('ITEM_NOT_FOUND');
          const copy = structuredClone(source);
          copy.id = crypto.randomUUID();
          copy.catalog_id = source.catalog_id || source.id;
          copy.x = Number(source.x || 0) + .035;
          copy.y = Number(source.y || 0) + .035;
          copy.z = Math.max(0, ...current.items.map(item => item.z || 0)) + 1;
          current.items.push(copy);
          return current;
        });
        return send(response, 201, { item: state.items.at(-1) });
      }
      const input = String(body.input || body.url || body.name || '').trim();
      if (!input || input.length > 500) return send(response, 400, { error: 'INPUT_REQUIRED' });
      const { price, currency } = intakeMetadata(body);
      const id = crypto.randomUUID();
      const state = await updatePalette(userId, current => {
        const z = Math.max(0, ...current.items.map(item => item.z || 0)) + 1;
        current.items.push({
          id, catalog_id: id, title: displayTitle(input), input, image_url: null, source_url: null,
          category: inferCategory(displayTitle(input)), price, currency, wardrobe_status: 'other',
          status: 'pending', x: .38, y: .32, width: .22, rotation: 0, mirror: false, z, auto_width: true
        });
        return current;
      });
      waitUntil(processPending(userId, id, input));
      return send(response, 202, { item: state.items.find(item => item.id === id) });
    }

    if (request.method === 'PATCH') {
      const body = bodyOf(request);
      const id = String(body.id || '');
      const state = await updatePalette(userId, current => {
        const item = current.items.find(entry => entry.id === id);
        if (!item) throw new Error('ITEM_NOT_FOUND');
        if (body.catalog && typeof body.catalog === 'object') {
          const catalogId = item.catalog_id || item.id;
          const allowedStatus = new Set(['owned', 'to_buy', 'other']);
          for (const entry of current.items.filter(value => (value.catalog_id || value.id) === catalogId)) {
            if ('category' in body.catalog) entry.category = String(body.catalog.category || 'other').slice(0, 48);
            if ('price' in body.catalog) entry.price = String(body.catalog.price || '').slice(0, 32) || null;
            if ('currency' in body.catalog) entry.currency = String(body.catalog.currency || '').toUpperCase().slice(0, 8) || null;
            if ('wardrobe_status' in body.catalog && allowedStatus.has(body.catalog.wardrobe_status)) entry.wardrobe_status = body.catalog.wardrobe_status;
          }
        }
        if ('layer' in body) applyLayerOrder(current.items, id, String(body.layer));
        if ('layer_position' in body) applyLayerPosition(current.items, id, body.layer_position);
        if ('x' in body) item.x = bounded(body.x, -100, 100, item.x);
        if ('y' in body) item.y = bounded(body.y, -100, 100, item.y);
        if ('width' in body) { item.width = bounded(body.width, .05, .8, item.width); delete item.auto_width; }
        if ('rotation' in body) item.rotation = bounded(body.rotation, -180, 180, item.rotation);
        if ('mirror' in body) item.mirror = Boolean(body.mirror);
        if ('z' in body) item.z = bounded(body.z, 1, 100000, item.z);
        return current;
      });
      return send(response, 200, { item: state.items.find(item => item.id === id), items: state.items });
    }

    if (request.method === 'DELETE') {
      const body = bodyOf(request);
      const id = String(body.id || '');
      const state = await updatePalette(userId, current => {
        const before = current.items.length;
        current.items = current.items.filter(item => item.id !== id);
        if (before === current.items.length) throw new Error('ITEM_NOT_FOUND');
        return current;
      });
      return send(response, 200, { removed: id, count: state.items.length });
    }
    return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const code = error?.message || 'INTERNAL_ERROR';
    const client = new Set(['INVALID_JSON', 'ITEM_NOT_FOUND', 'INVALID_LAYER_ACTION']);
    console.error('Palette mutation failed', code);
    return send(response, client.has(code) ? 400 : 500, { error: code });
  }
}
