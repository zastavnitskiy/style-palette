import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import handler, {
  cleanStickerPng,
  hasTransparency,
  parseProductHtml,
  parseOpenAiProductResponse,
  parseShopifyProductJson,
  imageDimensions,
  mergeFirecrawlImages,
  productImageScore,
  rankProductImages,
  shopifyProductApiUrls,
  shopifyProductJsonUrl,
  sniffImageType
} from '../api/items.mjs';
import { lookupProductCatalog } from '../api/_product-catalog.mjs';

function rgbaPng(alpha) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    result.write(type, 4);
    data.copy(result, 8);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 10, 20, 30, alpha]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function stickerFixturePng() {
  const width = 9;
  const height = 9;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const onRing = x >= 2 && x <= 6 && y >= 2 && y <= 6 && (x === 2 || x === 6 || y === 2 || y === 6);
      const inside = x > 2 && x < 6 && y > 2 && y < 6;
      const color = onRing ? [250, 250, 250, 254] : inside ? [90, 60, 40, 254] : [45, 45, 45, 240];
      Buffer.from(color).copy(raw, offset);
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const result = Buffer.alloc(12 + data.length);
    result.writeUInt32BE(data.length, 0);
    result.write(type, 4);
    data.copy(result, 8);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('prefers Product JSON-LD and resolves relative images', () => {
  const html = `
    <meta property="og:image" content="/fallback.jpg">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Shop"},
        {"@type":"Product","name":"Melor Casual Pants","image":[
          "/products/melor-front.jpg",
          {"contentUrl":"https://cdn.example/melor-back.webp"}
        ]}
      ]}
    </script>`;
  assert.deepEqual(parseProductHtml(html, 'https://shop.example/item'), {
    title: 'Melor Casual Pants',
    images: [
      'https://shop.example/products/melor-front.jpg',
      'https://cdn.example/melor-back.webp',
      'https://shop.example/fallback.jpg'
    ],
    price: null,
    currency: null,
    category: null
  });
});

test('parses metadata regardless of attribute order', () => {
  const html = '<meta content="Durham Socks &amp; More" property="og:title"><meta content="/socks.jpg" property="og:image">';
  assert.deepEqual(parseProductHtml(html, 'https://shop.example/product'), {
    title: 'Durham Socks & More',
    images: ['https://shop.example/socks.jpg'],
    price: null,
    currency: null,
    category: null
  });
});

test('extracts catalog price and currency from Product offers', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","name":"Weldon Coat","category":"Coats & Jackets","image":"/coat.jpg","offers":{"@type":"Offer","price":"425.00","priceCurrency":"eur"}}</script>';
  assert.deepEqual(parseProductHtml(html, 'https://shop.example/product'), {
    title: 'Weldon Coat',
    images: ['https://shop.example/coat.jpg'],
    price: '425.00',
    currency: 'EUR',
    category: 'Coats & Jackets'
  });
});

test('derives the Shopify JSON endpoint from an Octobre product URL', () => {
  assert.equal(
    shopifyProductJsonUrl('https://www.octobre-editions.com/eu-en/product/pack-durham-socks/mustard-khaki-twine#size-tu'),
    'https://www.octobre-editions.com/products/pack-durham-socks.json'
  );
});

test('preserves locale prefixes for standard Shopify product URLs', () => {
  assert.equal(
    shopifyProductJsonUrl('https://shop.example/en/products/weldon-coat?variant=123'),
    'https://shop.example/en/products/weldon-coat.json'
  );
});

test('tries the documented Shopify Ajax endpoint before the legacy JSON endpoint', () => {
  assert.deepEqual(
    shopifyProductApiUrls('https://shop.example/en/products/weldon-coat?variant=123'),
    ['https://shop.example/en/products/weldon-coat.js', 'https://shop.example/en/products/weldon-coat.json']
  );
});

test('ranks the Octobre Cloudinary product asset above generic brand images', () => {
  const page = 'https://www.octobre-editions.com/eu-en/product/pack-durham-socks/rust-beige-brown#size-tu';
  const product = 'https://media.octobre-editions.com/image/upload/c_fill%2Cd_placeholder_dark.png%2Cfl_progressive%3Asemi%2Ch_816%2Cq_auto%3Abest%2Cw_582/gqnz11rqyctrm84pgagc.jpg';
  const logo = 'https://media.octobre-editions.com/image/upload/w_1200/octobre-logo.png';
  assert.deepEqual(rankProductImages([logo, product], page), [product]);
  assert.ok(productImageScore(product, page) > productImageScore(logo, page));
});

test('finds the supplied Octobre variant in the merchant catalog regardless of fragment', () => {
  const product = lookupProductCatalog('https://www.octobre-editions.com/eu-en/product/pack-durham-socks/rust-beige-brown#size-tu');
  assert.equal(product.title, 'Pack Durham Socks');
  assert.equal(product.price, '45');
  assert.equal(product.currency, 'EUR');
  assert.equal(product.color, 'Rust / Beige / Brown');
  assert.match(product.images[0], /^https:\/\/media\.octobre-editions\.com\/image\/upload\//);
});

test('does not promote page-wide Firecrawl images for an empty Shopify payload', () => {
  const page = 'https://www.octobre-editions.com/products/pack-durham-socks.json';
  assert.deepEqual(mergeFirecrawlImages([], ['https://media.octobre-editions.com/image/upload/octobre-logo.png'], page, { structuredOnly: true }), []);
});

test('parses and ranks structured web-search product results', () => {
  const page = 'https://www.octobre-editions.com/eu-en/product/pack-durham-socks/rust-beige-brown#size-tu';
  const product = 'https://media.octobre-editions.com/image/upload/c_fill%2Ch_816%2Cw_582/gqnz11rqyctrm84pgagc.jpg';
  const payload = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
    title: 'Pack Durham Socks', images: ['https://media.octobre-editions.com/image/upload/octobre-logo.png', product],
    price: '45', currency: 'eur', category: 'Socks'
  }) }] }] };
  assert.deepEqual(parseOpenAiProductResponse(payload, page), {
    title: 'Pack Durham Socks', images: [product], price: '45', currency: 'EUR', category: 'Socks', method: 'openai-web-search'
  });
});

test('parses Shopify product JSON returned as a browser preformatted document', () => {
  const json = JSON.stringify({ product: {
    title: 'Pack Durham Socks',
    product_type: 'Socks',
    images: [{ src: '//cdn.example/durham-front.jpg' }, { src: '/durham-back.jpg' }],
    variants: [{ available: true, price: '45.00' }]
  } }).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  assert.deepEqual(parseShopifyProductJson(`<html><body><pre>${json}</pre></body></html>`, 'https://www.octobre-editions.com/products/pack-durham-socks.json'), {
    title: 'Pack Durham Socks',
    images: ['https://cdn.example/durham-front.jpg', 'https://www.octobre-editions.com/durham-back.jpg'],
    price: '45.00',
    currency: null,
    category: 'Socks'
  });
});

test('sniffs supported image formats from bytes', () => {
  assert.equal(sniffImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(sniffImageType(Buffer.from([255, 216, 255, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('not an image')), null);
});

test('reads PNG and JPEG dimensions from image bytes', () => {
  const png = rgbaPng(255);
  assert.deepEqual(imageDimensions(png, 'image/png'), { width: 1, height: 1 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 3, 0, 4, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 4, height: 3 });
});

test('requires an actually transparent PNG pixel', () => {
  assert.equal(hasTransparency(rgbaPng(0), 'image/png'), true);
  assert.equal(hasTransparency(rgbaPng(255), 'image/png'), false);
});

test('detects WebP alpha chunks', () => {
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0);
  webp.write('WEBP', 8);
  webp.write('ALPH', 12);
  assert.equal(hasTransparency(webp, 'image/webp'), true);
});

test('removes an opaque halo outside a closed white sticker outline', () => {
  const cleaned = cleanStickerPng(stickerFixturePng());
  const chunks = [];
  for (let offset = 8; offset + 12 <= cleaned.length;) {
    const size = cleaned.readUInt32BE(offset);
    const kind = cleaned.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') chunks.push(cleaned.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  assert.equal(pixels[4], 0);
  assert.equal(pixels[4 * (4 * 9 + 1) + 1 + 4 * 4 + 3], 255);
  assert.equal(hasTransparency(cleaned, 'image/png'), true);
});

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    end(value = '') { this.body = value; return this; }
  };
}

test('GET reports configuration without exposing secrets', async () => {
  const response = mockResponse();
  await handler({ method: 'GET', headers: {} }, response);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.endpoint, '/api/items');
  assert.equal(typeof body.configured.generation, 'boolean');
  assert.equal(JSON.stringify(body).includes('OPENAI_API_KEY'), false);
});

test('POST stays closed when authentication is not configured', async () => {
  const original = process.env.PALETTE_API_TOKEN;
  delete process.env.PALETTE_API_TOKEN;
  const response = mockResponse();
  await handler({ method: 'POST', headers: {} }, response);
  if (original === undefined) delete process.env.PALETTE_API_TOKEN;
  else process.env.PALETTE_API_TOKEN = original;
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'AUTH_NOT_CONFIGURED' });
});
