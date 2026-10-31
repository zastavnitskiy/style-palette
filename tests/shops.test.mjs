import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeShopUrl, shopDirectory, shopNameFromDomain } from '../shops.mjs';

test('normalizes shop domains and removes product paths', () => {
  assert.deepEqual(normalizeShopUrl('https://www.octobre-editions.com/eu-en/product/socks'), {
    domain: 'octobre-editions.com',
    url: 'https://octobre-editions.com/'
  });
  assert.deepEqual(normalizeShopUrl('paraboot.com'), {
    domain: 'paraboot.com',
    url: 'https://paraboot.com/'
  });
  assert.throws(() => normalizeShopUrl('localhost:3000'), /INVALID_SHOP_URL/);
});

test('creates readable names from shop domains', () => {
  assert.equal(shopNameFromDomain('octobre-editions.com'), 'Octobre Editions');
});

test('merges separately added shops with shops discovered from products', () => {
  const shops = shopDirectory({
    manual_shops: [
      { id: 'saved-octobre', name: 'Octobre', url: 'https://octobre-editions.com/' },
      { id: 'saved-arket', name: 'Arket', url: 'https://arket.com/' }
    ],
    items: [
      { id: 'a', catalog_id: 'socks', source_url: 'https://www.octobre-editions.com/eu-en/product/socks', status: 'ready', image_url: '/socks.png' },
      { id: 'b', catalog_id: 'socks', source_url: 'https://www.octobre-editions.com/eu-en/product/socks', status: 'ready', image_url: '/socks.png' },
      { id: 'c', catalog_id: 'shoes', input: 'https://www.paraboot.com/en/shoes/michael', status: 'failed' },
      { id: 'd', catalog_id: 'search-ad', source_url: 'https://www.google.com/aclk?adurl=', status: 'ready' }
    ]
  });
  assert.deepEqual(shops.map(shop => [shop.name, shop.product_count, shop.manual]), [
    ['Arket', 0, true],
    ['Octobre', 1, true],
    ['Paraboot', 1, false]
  ]);
  assert.deepEqual(shops[1].images, ['/socks.png']);
});
