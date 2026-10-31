import { get, list, put } from '@vercel/blob';

const ACCESS = 'public';
const WARDROBE_STATUSES = new Set(['owned', 'to_buy', 'other']);
const defaultItems = [
  ['cobalt-knit', 'COBALT KNIT', '/assets/cobalt-knit.png', null, .10, .08, .34, -8],
  ['wide-trouser', 'WIDE TROUSER', '/assets/charcoal-trousers.png', null, .72, .06, .25, 5],
  ['sunny-suede', 'SUNNY SUEDE', '/assets/butter-sneakers.png', null, .08, .70, .23, 3],
  ['cherry-gloss', 'CHERRY GLOSS', '/assets/cherry-bag.png', null, .76, .67, .18, -8],
  ['rooney-socks', 'ROONEY SOCKS', '/assets/rooney-socks.png?v=2', 'https://www.octobre-editions.com/eu-en/product/rooney-socks/red-grey-blue', .45, .35, .10, 9],
  ['paraboot-michael', 'PARABOOT MICHAEL', '/assets/paraboot-michael.png', 'https://www.paraboot.com/en/men/derbies/michael-marche-ii-marron-lisse-cafe-2/', .36, .67, .22, -3],
  ['melor-casual-pants', 'MELOR CAMOUFLAGE', '/assets/melor-casual-pants.png', 'https://www.octobre-editions.com/eu-en/product/melor-casual-pants/camouflage#size-xs', .56, .10, .20, -4],
  ['durham-socks', 'DURHAM SOCKS', '/assets/durham-socks.png', 'https://www.octobre-editions.com/eu-en/product/pack-durham-socks/mustard-khaki-twine#size-tu', .61, .59, .11, 6]
].map(([id, title, image_url, source_url, x, y, width, rotation], index) => ({
  id, catalog_id: id, title, image_url, source_url, category: inferCategory(title),
  price: null, currency: null, wardrobe_status: 'other',
  status: 'ready', x, y, width, rotation, mirror: false, z: index + 1
}));

export function inferCategory(title = '') {
  const value = String(title).toLowerCase();
  if (/coat|jacket|blazer|parka/.test(value)) return 'outerwear';
  if (/shirt|sweater|jumper|cardigan|tee|t-shirt|knit/.test(value)) return 'tops';
  if (/pant|trouser|jean|short/.test(value)) return 'bottoms';
  if (/shoe|boot|sneaker|loafer|derby|sandal|paraboot|michael/.test(value)) return 'footwear';
  if (/bag|pouch|tote|shoulder bag/.test(value)) return 'bags';
  if (/sock|hat|cap|scarf|belt|glove/.test(value)) return 'accessories';
  return 'other';
}

export function normalizePalette(state) {
  state.version = Math.max(3, Number(state.version) || 1);
  state.items = Array.isArray(state.items) ? state.items : [];
  state.manual_shops = Array.isArray(state.manual_shops) ? state.manual_shops : [];
  for (const item of state.items) {
    item.catalog_id ||= item.id;
    item.category ||= inferCategory(item.title);
    if (!('price' in item)) item.price = null;
    if (!('currency' in item)) item.currency = null;
    if (!WARDROBE_STATUSES.has(item.wardrobe_status)) item.wardrobe_status = 'other';
  }
  return state;
}

export function validUserId(value) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(String(value || ''));
}

export function initialPalette(userId) {
  return { version: 3, user_id: userId, items: structuredClone(defaultItems), manual_shops: [], updated_at: new Date().toISOString() };
}

function statePrefix(userId) { return `palettes/${userId}/states/`; }

async function streamJson(stream) {
  return JSON.parse(await new Response(stream).text());
}

export async function readPalette(userId) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: statePrefix(userId), limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const latest = blobs.reduce((winner, blob) =>
    !winner || new Date(blob.uploadedAt) > new Date(winner.uploadedAt) ? blob : winner, null);
  if (!latest) return { state: initialPalette(userId), etag: null };
  const result = await get(latest.url, { access: ACCESS, useCache: false });
  if (!result) return { state: initialPalette(userId), etag: null };
  return { state: normalizePalette(await streamJson(result.stream)), etag: result.blob.etag };
}

export async function writePalette(userId, state) {
  state.updated_at = new Date().toISOString();
  return put(`${statePrefix(userId)}state.json`, JSON.stringify(state), {
    access: ACCESS, contentType: 'application/json', cacheControlMaxAge: 31536000, addRandomSuffix: true
  });
}

export async function updatePalette(userId, updater) {
  const { state } = await readPalette(userId);
  const next = await updater(structuredClone(state));
  await writePalette(userId, next);
  return next;
}

export async function saveProductImage(userId, itemId, buffer) {
  return put(`palettes/${userId}/items/${itemId}.png`, buffer, {
    access: ACCESS, contentType: 'image/png', addRandomSuffix: true, cacheControlMaxAge: 31536000
  });
}

export function defaultWidth(title = '') {
  const value = title.toLowerCase();
  if (/coat|jacket|blazer|sweater|jumper|shirt|cardigan/.test(value)) return .32;
  if (/pant|trouser|jean/.test(value)) return .22;
  if (/shoe|boot|sneaker|loafer|derby/.test(value)) return .21;
  if (/sock/.test(value)) return .11;
  if (/bag|pouch/.test(value)) return .17;
  return .24;
}
