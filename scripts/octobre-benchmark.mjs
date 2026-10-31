import products from '../tests/fixtures/octobre-products.json' with { type: 'json' };
import { fetchProduct, productUrlIdentity } from '../api/items.mjs';

const results = [];
for (const expected of products) {
  const started = Date.now();
  try {
    const { item, product } = await fetchProduct(expected.url);
    const identity = productUrlIdentity(product.page_url);
    const correctVariant = identity?.variant === expected.variant;
    const usableImage = item.buffer.length > 10_000 && item.width >= 300 && item.height >= 300;
    results.push({
      product: expected.title,
      ok: correctVariant && usableImage,
      method: product.fetch_method,
      imageHost: new URL(product.image_url).hostname,
      dimensions: `${item.width}x${item.height}`,
      bytes: item.buffer.length,
      ms: Date.now() - started
    });
  } catch (error) {
    results.push({ product: expected.title, ok: false, error: error?.message || String(error), ms: Date.now() - started });
  }
}

console.table(results);
const passed = results.filter(result => result.ok).length;
console.log(`Octobre usable imports: ${passed}/${results.length}`);
if (passed !== results.length) process.exitCode = 1;
