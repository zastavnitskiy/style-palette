export function uniqueProducts(items = []) {
  const products = new Map();
  for (const item of items) {
    const key = item.catalog_id || item.id;
    const existing = products.get(key);
    if (!existing || (existing.status !== 'ready' && item.status === 'ready')) products.set(key, item);
  }
  return [...products.values()].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}
