export function productGroupKey(item = {}) {
  const productId = String(item.product_id || '').trim().toLowerCase();
  if (productId) {
    let merchant = '';
    try { merchant = new URL(item.source_url || item.input || '').hostname.replace(/^www\./, '').toLowerCase(); } catch {}
    return `product:${merchant}:${productId}`;
  }
  return `catalog:${item.catalog_id || item.id}`;
}

export function uniqueProducts(items = []) {
  const products = new Map();
  for (const item of items) {
    const key = productGroupKey(item);
    const group = products.get(key) || { item, count: 0 };
    group.count += 1;
    if (group.item.status !== 'ready' && item.status === 'ready') group.item = item;
    products.set(key, group);
  }
  return [...products.values()]
    .map(group => ({ ...group.item, usage_count: group.count }))
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}
