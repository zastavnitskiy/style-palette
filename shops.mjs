export function normalizeShopUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('SHOP_URL_REQUIRED');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new Error('INVALID_SHOP_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('INVALID_SHOP_URL');
  const domain = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!domain.includes('.') || domain === 'localhost' || /^\d+(?:\.\d+){3}$/.test(domain)) throw new Error('INVALID_SHOP_URL');
  return { domain, url: `https://${domain}/` };
}

export function shopNameFromDomain(domain) {
  const label = String(domain || '').replace(/^www\./, '').split('.')[0] || 'Shop';
  return label.split(/[-_]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function productSource(item) {
  for (const value of [item?.source_url, item?.input]) {
    try {
      if (value) return normalizeShopUrl(value);
    } catch {}
  }
  return null;
}

export function shopDirectory(state = {}) {
  const shops = new Map();
  for (const entry of Array.isArray(state.manual_shops) ? state.manual_shops : []) {
    let normalized;
    try { normalized = normalizeShopUrl(entry.url || entry.domain); } catch { continue; }
    shops.set(normalized.domain, {
      id: entry.id,
      domain: normalized.domain,
      name: String(entry.name || '').trim() || shopNameFromDomain(normalized.domain),
      url: normalized.url,
      manual: true,
      product_count: 0,
      images: []
    });
  }
  const seenProducts = new Set();
  for (const item of Array.isArray(state.items) ? state.items : []) {
    const productId = item.catalog_id || item.id;
    if (!productId || seenProducts.has(productId)) continue;
    seenProducts.add(productId);
    const source = productSource(item);
    if (!source) continue;
    const shop = shops.get(source.domain) || {
      id: `domain:${source.domain}`,
      domain: source.domain,
      name: shopNameFromDomain(source.domain),
      url: source.url,
      manual: false,
      product_count: 0,
      images: []
    };
    shop.product_count += 1;
    if (item.status === 'ready' && item.image_url && shop.images.length < 3 && !shop.images.includes(item.image_url)) shop.images.push(item.image_url);
    shops.set(source.domain, shop);
  }
  return [...shops.values()].sort((a, b) => a.name.localeCompare(b.name));
}
