import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultWidth, inferCategory, initialPalette, normalizePalette, validUserId } from '../api/_palette-store.mjs';
import { applyLayerOrder, applyLayerPosition, displayTitle, intakeMetadata, sameOrigin } from '../api/palette.mjs';
import { uniqueProducts } from '../catalog.mjs';

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
  assert.equal(state.version, 2);
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
