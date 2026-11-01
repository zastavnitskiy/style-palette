import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWidth, inferCategory, initialPalette, normalizePalette, validUserId } from '../api/_palette-store.mjs';
import { applyLayerOrder, applyLayerPosition, displayTitle, intakeMetadata, prepareCatalogRefetch, removeCatalogProduct, sameOrigin } from '../api/palette.mjs';
import { productGroupKey, uniqueProducts } from '../catalog.mjs';

test('bootstraps the eight existing palette items with server transforms', () => {
  const state = initialPalette('441294944');
  assert.equal(state.items.length, 8);
  assert.ok(state.items.every(item => Number.isFinite(item.x) && Number.isFinite(item.width)));
  state.items.pop();
  assert.equal(initialPalette('441294944').items.length, 8);
});
test('validates palette identifiers', () => {
  assert.equal(validUserId('441294944'), true);
  assert.equal(validUserId('../secret'), false);
});
test('assigns smaller widths to accessories than garments', () => {
  assert.ok(defaultWidth('Weldon coat') > defaultWidth('Durham socks'));
  assert.ok(defaultWidth('Melor trousers') > defaultWidth('Paraboot Michael shoes'));
});
test('normalizes older items into one catalog product per original id', () => {
  const state = normalizePalette({ version: 1, items: [{ id: 'jeans', title: 'Wide jeans' }] });
  assert.equal(state.version, 3);
  assert.deepEqual(state.manual_shops, []);
  assert.deepEqual(state.items[0], {
    id: 'jeans', title: 'Wide jeans', catalog_id: 'jeans', category: 'bottoms',
    price: null, currency: null, wardrobe_status: 'other'
  });
  assert.equal(inferCategory('Weldon houndstooth coat'), 'outerwear');
});
test('deduplicates canvas copies in the wardrobe list', () => {
  const products = uniqueProducts([
    { id: 'jeans-a', catalog_id: 'jeans', title: 'Jeans', status: 'pending' },
    { id: 'jeans-b', catalog_id: 'jeans', title: 'Jeans', status: 'ready' },
    { id: 'coat', catalog_id: 'coat', title: 'Coat', status: 'ready' }
  ]);
  assert.deepEqual(products.map(item => item.id), ['coat', 'jeans-b']);
  assert.deepEqual(products.map(item => item.usage_count), [1, 2]);
});

test('groups separate imports by merchant product id and counts every use', () => {
  const products = uniqueProducts([
    { id: 'first', catalog_id: 'first', product_id: 'E482858-000', source_url: 'https://www.uniqlo.com/nl/en/products/E482858-000/00', title: 'Jeans', status: 'ready' },
    { id: 'second', catalog_id: 'second', product_id: 'E482858-000', source_url: 'https://uniqlo.com/nl/en/products/E482858-000/00?color=09', title: 'Jeans', status: 'ready' },
    { id: 'other', catalog_id: 'other', product_id: 'E462197-000', source_url: 'https://www.uniqlo.com/nl/en/products/E462197-000/00', title: 'Trousers', status: 'ready' }
  ]);
  assert.equal(productGroupKey(products[0]), 'product:uniqlo.com:e482858-000');
  assert.deepEqual(products.map(item => [item.title, item.usage_count]), [['Jeans', 2], ['Trousers', 1]]);
});
test('allows mutations from the palette origin without a private token', () => {
  assert.equal(sameOrigin({ headers: { origin: 'https://workspace-style.vercel.app', host: 'workspace-style.vercel.app' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://example.com', host: 'workspace-style.vercel.app' } }), false);
});

test('turns product URLs into readable pending titles', () => {
  assert.equal(
    displayTitle('https://www.octobre-editions.com/eu-en/product/teckel-t-shirt/white#size-xs'),
    'TECKEL T SHIRT · WHITE'
  );
  assert.equal(displayTitle('Paraboot Michael brown'), 'PARABOOT MICHAEL BROWN');
});

test('normalizes optional intake pricing without requiring it', () => {
  assert.deepEqual(intakeMetadata({ price: ' 249.00 ', currency: 'eur' }), { price: '249.00', currency: 'EUR' });
  assert.deepEqual(intakeMetadata({ price: '75' }), { price: '75', currency: 'EUR' });
  assert.deepEqual(intakeMetadata({ currency: 'USD' }), { price: null, currency: null });
});

test('reorders item layers and normalizes z indexes', () => {
  const items = [{ id: 'a', z: 1 }, { id: 'b', z: 2 }, { id: 'c', z: 3 }];
  applyLayerOrder(items, 'a', 'front');
  assert.deepEqual([...items].sort((a, b) => a.z - b.z).map(item => item.id), ['b', 'c', 'a']);
  applyLayerOrder(items, 'a', 'down');
  assert.deepEqual([...items].sort((a, b) => a.z - b.z).map(item => item.id), ['b', 'a', 'c']);
  applyLayerOrder(items, 'c', 'back');
  assert.deepEqual([...items].sort((a, b) => a.z - b.z).map(item => item.id), ['c', 'b', 'a']);
  applyLayerPosition(items, 'a', 1);
  assert.deepEqual([...items].sort((a, b) => a.z - b.z).map(item => item.id), ['c', 'a', 'b']);
});

test('refetches every copy while retaining the current product image', () => {
  const items = [
    { id: 'a', catalog_id: 'product', status: 'ready', image_url: '/old.png', source_url: 'https://shop.example/product/item' },
    { id: 'b', catalog_id: 'product', status: 'ready', image_url: '/old.png' },
    { id: 'other', catalog_id: 'other', status: 'ready', image_url: '/other.png' }
  ];
  assert.deepEqual(prepareCatalogRefetch(items, 'b'), {
    itemId: 'b', catalogId: 'product', input: 'https://shop.example/product/item'
  });
  assert.equal(items[0].refreshing, true);
  assert.equal(items[1].refreshing, true);
  assert.equal(items[0].image_url, '/old.png');
  assert.equal(items[2].refreshing, undefined);
});

test('refetch requires a source URL', () => {
  assert.throws(
    () => prepareCatalogRefetch([{ id: 'local', status: 'ready', image_url: '/local.png' }], 'local'),
    /PRODUCT_SOURCE_REQUIRED/
  );
});

test('deletes a catalog product and all of its canvas copies', () => {
  const result = removeCatalogProduct([
    { id: 'a', catalog_id: 'product' },
    { id: 'b', catalog_id: 'product' },
    { id: 'other', catalog_id: 'other' }
  ], 'a');
  assert.equal(result.removed, 2);
  assert.deepEqual(result.items.map(item => item.id), ['other']);
});

test('refetch and delete span duplicate catalog imports with the same product id', () => {
  const items = [
    { id: 'a', catalog_id: 'first', product_id: 'E482858-000', source_url: 'https://www.uniqlo.com/nl/en/products/E482858-000/00', image_url: '/old-a.png', status: 'ready' },
    { id: 'b', catalog_id: 'second', product_id: 'E482858-000', source_url: 'https://uniqlo.com/nl/en/products/E482858-000/00', image_url: '/old-b.png', status: 'ready' },
    { id: 'other', catalog_id: 'other', product_id: 'E462197-000', source_url: 'https://www.uniqlo.com/nl/en/products/E462197-000/00', status: 'ready' }
  ];
  prepareCatalogRefetch(items, 'a');
  assert.equal(items[0].refreshing, true);
  assert.equal(items[1].refreshing, true);
  assert.equal(items[2].refreshing, undefined);
  const result = removeCatalogProduct(items, 'b');
  assert.equal(result.removed, 2);
  assert.deepEqual(result.items.map(item => item.id), ['other']);
});
