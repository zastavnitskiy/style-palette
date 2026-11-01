import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { deflateSync, inflateSync } from 'node:zlib';
import { lookupProductCatalog } from './_product-catalog.mjs';

export const config = { maxDuration: 180 };
const MAX_SOURCE = 8 * 1024 * 1024;
const MAX_HTML = 2 * 1024 * 1024;
// Keep the base64 JSON response below common serverless response limits.
const MAX_OUTPUT = 3 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || 'gpt-5.5';
const PROMPT = 'Extract the single fashion item shown in the reference image. Create a faithful premium e-commerce cutout of that exact item, preserving its shape, color, material, pattern, proportions, and details. Show the complete item centered at a natural product-photo angle. Add a smooth thick white sticker outline around the silhouette. The area outside that outline must be genuinely transparent. No person, body part, hanger, mannequin, extra object, text, watermark, frame, floor, backdrop, checkerboard, or solid background.';

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function decodeHtml(value = '') {
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try { return new URL(decodeHtml(String(value)), base).href; } catch { return null; }
}

function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() === key.toLowerCase() && content) return decodeHtml(content.trim());
  }
  return '';
}

function findProduct(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findProduct(child);
      if (found) return found;
    }
    return null;
  }
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => String(type).toLowerCase() === 'product')) return value;
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    const found = findProduct(value[key]);
    if (found) return found;
  }
  return null;
}

export function parseProductHtml(html, baseUrl) {
  let product = null;
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      product = findProduct(JSON.parse(decodeHtml(match[1]).trim()));
      if (product) break;
    } catch {}
  }
  const rawImages = Array.isArray(product?.image) ? product.image : product?.image ? [product.image] : [];
  const images = rawImages.map(value => absoluteUrl(typeof value === 'string' ? value : value?.url || value?.contentUrl, baseUrl)).filter(Boolean);
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    const url = absoluteUrl(metaContent(html, key), baseUrl);
    if (url && !images.includes(url)) images.push(url);
  }
  const title = String(product?.name || metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || '').trim();
  const offers = Array.isArray(product?.offers) ? product.offers : product?.offers ? [product.offers] : [];
  const offer = offers.find(value => value && typeof value === 'object') || null;
  const rawPrice = offer?.price ?? offer?.lowPrice ?? null;
  const price = rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : String(rawPrice);
  const currency = offer?.priceCurrency ? String(offer.priceCurrency).toUpperCase() : null;
  const category = product?.category ? String(product.category).trim() : null;
  const result = { title: title || null, images, price, currency, category };
  if (product?.productID) result.product_id = String(product.productID);
  return result;
}

export function parseUniqloProductHtml(html, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return null; }
  if (!(page.hostname === 'uniqlo.com' || page.hostname.endsWith('.uniqlo.com'))) return null;
  const productId = /\/products\/(E\d+(?:-\d+)?)/i.exec(page.pathname)?.[1]?.toUpperCase();
  const assetId = /^E(\d+)/.exec(productId || '')?.[1];
  if (!productId || !assetId) return null;
  const queryColor = page.searchParams.get('colorDisplayCode');
  const escapedProductId = productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const embeddedColor = new RegExp(`"${escapedProductId}"\\s*:\\s*\\{[^}]{0,500}"colorDisplayCode"\\s*:\\s*"(\\d{2,3})"`, 'i').exec(html)?.[1];
  const colorCode = /^\d{2,3}$/.test(queryColor || '') ? queryColor : embeddedColor;
  const parsed = parseProductHtml(html, page.href);
  if (!colorCode) return { ...parsed, product_id: productId };
  const standalone = `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/${assetId}/item/goods_${colorCode}_${assetId}_3x4.jpg`;
  const regionalPattern = new RegExp(`https://image\\.uniqlo\\.com/UQ/ST3/eu/imagesgoods/${assetId}/item/eugoods_${colorCode}_${assetId}_3x4\\.jpg`, 'i');
  const regional = regionalPattern.exec(html)?.[0] ||
    `https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/${assetId}/item/eugoods_${colorCode}_${assetId}_3x4.jpg`;
  const images = [standalone, regional, ...parsed.images.filter(image => ![standalone, regional].includes(image))];
  const colorName = new RegExp(`Colour:\\s*${colorCode}\\s+([^<]+)`, 'i').exec(html)?.[1]?.trim() || null;
  return { ...parsed, images, product_id: productId, color: colorName };
}

export function shopifyProductJsonUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean);
  const productIndex = parts.findIndex(part => part === 'product' || part === 'products');
  const handle = parts[productIndex + 1]?.replace(/\.json$/i, '');
  if (productIndex < 0 || !handle || !/^[a-zA-Z0-9_%.-]{1,200}$/.test(handle)) return null;
  const prefix = parts[productIndex] === 'products' ? parts.slice(0, productIndex) : [];
  url.pathname = `/${[...prefix, 'products', `${handle}.json`].join('/')}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

export function shopifyProductApiUrls(value) {
  const jsonUrl = shopifyProductJsonUrl(value);
  if (!jsonUrl) return [];
  return [jsonUrl.replace(/\.json$/i, '.js'), jsonUrl];
}

function normalizedTokens(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3);
}

export function productUrlIdentity(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const productIndex = parts.indexOf('product');
    if (productIndex < 0) return null;
    const productParts = parts.slice(productIndex + 1);
    if (productParts[0] === 'octobre-editions') productParts.shift();
    if (productParts.length < 2) return null;
    return { handle: productParts[0], variant: productParts[1] };
  } catch { return null; }
}

export function selectProductImageSearchResults(results, pageUrl) {
  const target = productUrlIdentity(pageUrl);
  if (!target) return [];
  const stem = token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
  const genericProductTokens = new Set(['shirt', 'sweater', 'sock']);
  const variantModifiers = new Set(['heather', 'mottled', 'melange', 'speckled']);
  const handleTokens = normalizedTokens(target.handle).map(stem).filter(token => !genericProductTokens.has(token));
  const variantTokens = normalizedTokens(target.variant);
  const coreVariantTokens = variantTokens.filter(token => !variantModifiers.has(token));
  const trustedImageHosts = new Set(['media.octobre-editions.com', 'media.sezane.com', 'i.pinimg.com']);
  return (Array.isArray(results) ? results : [])
    .map((result, position) => {
      let image;
      try { image = new URL(result?.image); } catch { return null; }
      if (!trustedImageHosts.has(image.hostname)) return null;
      const sourceIdentity = productUrlIdentity(result?.url);
      const exactIdentity = sourceIdentity?.handle === target.handle && sourceIdentity?.variant === target.variant;
      const titleTokens = new Set(normalizedTokens(result?.title));
      const handleMatch = handleTokens.every(token => titleTokens.has(token));
      const variantMatch = variantTokens.every(token => titleTokens.has(token));
      const sourceHandleTokens = sourceIdentity ? normalizedTokens(sourceIdentity.handle).map(stem).filter(token => !genericProductTokens.has(token)) : [];
      const equivalentHandle = sourceHandleTokens.length === handleTokens.length && handleTokens.every(token => sourceHandleTokens.includes(token));
      const sourceVariantTokens = sourceIdentity ? normalizedTokens(sourceIdentity.variant) : [];
      const safeVariantAlias = variantTokens.every(token => coreVariantTokens.includes(token) || variantModifiers.has(token)) &&
        coreVariantTokens.length > 0 && coreVariantTokens.every(token => titleTokens.has(token) || sourceVariantTokens.includes(token));
      const aliasIdentity = equivalentHandle && safeVariantAlias;
      if (!exactIdentity && !aliasIdentity && (!handleMatch || !variantMatch)) return null;
      const width = Number(result?.width || 0);
      const height = Number(result?.height || 0);
      if ((width && width < 300) || (height && height < 300)) return null;
      const score = (exactIdentity ? 100 : 0) + (aliasIdentity ? 45 : 0) + (handleMatch ? 30 : 0) + (variantMatch ? 30 : 0) +
        (image.hostname.endsWith('octobre-editions.com') || image.hostname === 'media.sezane.com' ? 25 : 5) +
        (width >= 500 && height >= 500 ? 15 : 0) - position / 100;
      return { url: image.href, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .map(candidate => candidate.url);
}

export function duckDuckGoSearchToken(html) {
  const source = String(html || '');
  return /\bvqd=["']?([\d-]+)/.exec(source)?.[1] ||
    /\bname=["']vqd["'][^>]*\bvalue=["']([\d-]+)/i.exec(source)?.[1] ||
    /\bvalue=["']([\d-]+)["'][^>]*\bname=["']vqd["']/i.exec(source)?.[1] || null;
}

export function parseShopifyProductJson(value, baseUrl) {
  const raw = String(value || '').trim();
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(raw)?.[1];
  let payload;
  for (const candidate of [raw, pre && decodeHtml(pre)]) {
    if (!candidate) continue;
    try {
      payload = JSON.parse(candidate);
      break;
    } catch {}
  }
  const product = payload?.product || payload;
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    return { title: null, images: [], price: null, currency: null, category: null };
  }
  const rawImages = [
    ...(Array.isArray(product.images) ? product.images : product.images ? [product.images] : []),
    ...(product.featured_image ? [product.featured_image] : [])
  ];
  const images = [...new Set(rawImages.map(image => absoluteUrl(
    typeof image === 'string' ? image : image?.src || image?.url,
    baseUrl
  )).filter(Boolean))];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variant = variants.find(item => item?.available !== false) || variants[0] || null;
  const rawPrice = variant?.price ?? product.price ?? null;
  const result = {
    title: String(product.title || product.name || '').trim() || null,
    images,
    price: rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : String(rawPrice),
    currency: product.currency ? String(product.currency).toUpperCase() : null,
    category: String(product.product_type || product.category || '').trim() || null
  };
  if (product.id !== null && product.id !== undefined && product.id !== '') result.product_id = String(product.id);
  return result;
}

function urlTokens(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 4);
  } catch { return []; }
}

function cloudinaryDimensions(url) {
  try {
    const decoded = decodeURIComponent(new URL(url).pathname);
    const width = Number(/(?:^|[,/])w_(\d{2,5})(?:[,/]|$)/i.exec(decoded)?.[1] || 0);
    const height = Number(/(?:^|[,/])h_(\d{2,5})(?:[,/]|$)/i.exec(decoded)?.[1] || 0);
    return { width, height };
  } catch { return { width: 0, height: 0 }; }
}

export function productImageScore(imageUrl, pageUrl = '', position = 0) {
  let image;
  let page;
  try {
    image = new URL(imageUrl, pageUrl);
    page = new URL(pageUrl);
  } catch { return -1000; }
  const decodedPath = decodeURIComponent(image.pathname).toLowerCase();
  const assetName = decodedPath.split('/').at(-1) || '';
  let score = Math.max(0, 20 - position);
  if (/\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(image.href)) score += 10;
  if (image.protocol === 'https:') score += 3;
  if (image.hostname === page.hostname) score += 6;
  if (/\/image\/upload\//i.test(decodedPath)) score += 12;
  const dimensions = cloudinaryDimensions(image.href);
  if (dimensions.width >= 400 && dimensions.height >= 400) score += 24;
  else if (dimensions.width >= 200 || dimensions.height >= 200) score += 8;
  for (const token of [...new Set(urlTokens(page.href))]) {
    if (decodedPath.includes(token)) score += 4;
  }
  if (page.hostname.endsWith('octobre-editions.com')) {
    if (image.hostname === 'media.octobre-editions.com' && /\/image\/upload\//i.test(decodedPath)) score += 50;
    else if (!image.hostname.endsWith('octobre-editions.com')) score -= 20;
  }
  // Inspect the actual public asset name only. Cloudinary's d_placeholder_* transform is a
  // fallback instruction and can coexist with a valid product image public ID.
  if (/(?:^|[-_.])(logo|favicon|sprite|icon|avatar|newsletter|social|share|loader)(?:[-_.]|$)/i.test(assetName)) score -= 120;
  if (/(?:^|[-_.])(banner|homepage|storefront|generic)(?:[-_.]|$)/i.test(assetName)) score -= 45;
  return score;
}

export function rankProductImages(images, pageUrl = '') {
  const unique = [...new Set((images || []).map(value => absoluteUrl(value, pageUrl)).filter(Boolean))];
  return unique
    .map((url, position) => ({ url, score: productImageScore(url, pageUrl, position), position }))
    .filter(candidate => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(candidate => candidate.url);
}

export function mergeFirecrawlImages(parsedImages, discoveredImages, pageUrl, { structuredOnly = false } = {}) {
  const images = structuredOnly && parsedImages?.length
    ? parsedImages
    : [...(parsedImages || []), ...(structuredOnly ? [] : (discoveredImages || []))];
  return rankProductImages(images, pageUrl);
}

export function parseOpenAiProductResponse(payload, pageUrl) {
  const text = payload?.output
    ?.flatMap(item => item?.type === 'message' ? (item.content || []) : [])
    ?.find(item => item?.type === 'output_text')?.text;
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const images = rankProductImages(Array.isArray(parsed.images) ? parsed.images : [], pageUrl);
  if (!images.length) return null;
  return {
    title: String(parsed.title || '').trim() || null,
    images,
    price: parsed.price === null || parsed.price === undefined || parsed.price === '' ? null : String(parsed.price),
    currency: parsed.currency ? String(parsed.currency).toUpperCase() : null,
    category: String(parsed.category || '').trim() || null,
    method: 'openai-web-search'
  };
}

function isPrivateAddress(raw) {
  const address = (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw)?.[1] || raw).toLowerCase();
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') ||
    ['fe8', 'fe9', 'fea', 'feb', 'ff'].some(prefix => address.startsWith(prefix));
}

async function assertPublicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_URL');
  if ((url.port && !['80', '443'].includes(url.port)) || ['localhost', '0.0.0.0'].includes(url.hostname.toLowerCase())) throw new Error('INVALID_URL');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error('INVALID_URL');
  return url;
}

async function safeFetch(value, options = {}, redirects = 0) {
  const url = await assertPublicUrl(value);
  const result = await fetch(url, { ...options, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    if (redirects >= 4) throw new Error('SOURCE_UNAVAILABLE');
    const location = result.headers.get('location');
    if (!location) throw new Error('SOURCE_UNAVAILABLE');
    return safeFetch(new URL(location, url).href, options, redirects + 1);
  }
  return result;
}

export function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function imageDimensions(buffer, type = sniffImageType(buffer)) {
  if (type === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type === 'image/jpeg') {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (offset + 4 > buffer.length) break;
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) break;
      offset += size + 2;
    }
  }
  if (type === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 12, 16) === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  return null;
}

function decodeRgbaPng(buffer) {
  if (sniffImageType(buffer) !== 'image/png' || buffer.length < 33 || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('INVALID_GENERATED_IMAGE');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height || buffer[24] !== 8 || buffer[25] !== 6 || buffer[28] !== 0) throw new Error('INVALID_GENERATED_IMAGE');
  const chunks = [];
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    const kind = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + size > buffer.length) throw new Error('INVALID_GENERATED_IMAGE');
    if (kind === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 12 + size;
    if (kind === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgba = Buffer.alloc(width * height * 4);
  let cursor = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    const row = Buffer.from(raw.subarray(cursor, cursor + stride));
    if (row.length !== stride) throw new Error('INVALID_GENERATED_IMAGE');
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upperLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255;
      } else if (filter !== 0) throw new Error('INVALID_GENERATED_IMAGE');
    }
    row.copy(rgba, y * stride);
    previous = row;
  }
  return { width, height, rgba };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind, data) {
  const type = Buffer.from(kind);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return chunk;
}

function encodeRgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

export function cleanStickerPng(buffer) {
  const { width, height, rgba } = decodeRgbaPng(buffer);
  const pixels = width * height;
  const barrier = new Uint8Array(pixels);
  const outside = new Uint8Array(pixels);
  const queue = new Uint32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const alpha = rgba[offset + 3];
    barrier[index] = alpha >= 220 && red >= 232 && green >= 232 && blue >= 232 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 20 ? 1 : 0;
  }
  let head = 0;
  let tail = 0;
  const seed = index => {
    if (!barrier[index] && !outside[index]) {
      outside[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) seed(index - 1);
    if (x + 1 < width) seed(index + 1);
    if (y > 0) seed(index - width);
    if (y + 1 < height) seed(index + width);
  }
  let retained = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    if (outside[index]) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 0;
    } else {
      rgba[offset + 3] = 255;
      retained += 1;
    }
  }
  const retainedRatio = retained / pixels;
  if (retainedRatio < 0.12 || retainedRatio > 0.82) throw new Error('INVALID_GENERATED_IMAGE');
  return encodeRgbaPng(width, height, rgba);
}

export function hasTransparency(buffer, type) {
  if (type === 'image/png') {
    try {
      if (buffer.length < 33 || buffer.toString('ascii', 12, 16) !== 'IHDR') return false;
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      const bitDepth = buffer[24];
      const colorType = buffer[25];
      const interlace = buffer[28];
      if (!width || !height || bitDepth !== 8 || ![4, 6].includes(colorType) || interlace !== 0) return false;
      const chunks = [];
      for (let offset = 8; offset + 12 <= buffer.length;) {
        const size = buffer.readUInt32BE(offset);
        const kind = buffer.toString('ascii', offset + 4, offset + 8);
        if (offset + 12 + size > buffer.length) return false;
        if (kind === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
        offset += 12 + size;
        if (kind === 'IEND') break;
      }
      const raw = inflateSync(Buffer.concat(chunks));
      const channels = colorType === 6 ? 4 : 2;
      const stride = width * channels;
      let cursor = 0;
      let previous = Buffer.alloc(stride);
      for (let y = 0; y < height; y += 1) {
        const filter = raw[cursor++];
        const row = Buffer.from(raw.subarray(cursor, cursor + stride));
        cursor += stride;
        for (let x = 0; x < stride; x += 1) {
          const left = x >= channels ? row[x - channels] : 0;
          const up = previous[x];
          const upperLeft = x >= channels ? previous[x - channels] : 0;
          if (filter === 1) row[x] = (row[x] + left) & 255;
          else if (filter === 2) row[x] = (row[x] + up) & 255;
          else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
          else if (filter === 4) {
            const estimate = left + up - upperLeft;
            const pa = Math.abs(estimate - left);
            const pb = Math.abs(estimate - up);
            const pc = Math.abs(estimate - upperLeft);
            row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255;
          } else if (filter !== 0) return false;
        }
        for (let x = channels - 1; x < stride; x += channels) {
          if (row[x] < 255) return true;
        }
        previous = row;
      }
      return false;
    } catch {
      return false;
    }
  }
  if (type !== 'image/webp') return false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunk === 'ALPH') return true;
    if (chunk === 'VP8X' && offset + 8 < buffer.length && (buffer[offset + 8] & 16)) return true;
    if (chunk === 'VP8L' && offset + 12 < buffer.length && ((buffer.readUInt32LE(offset + 9) >>> 28) & 1)) return true;
    offset += 8 + size + (size % 2);
  }
  return false;
}

async function readRequest(request) {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === 'string') return Buffer.from(request.body);
  if (request.body && typeof request.body === 'object') return Buffer.from(JSON.stringify(request.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_SOURCE * 1.4) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function binaryResponse(response, source) {
  if (Number(response.headers.get('content-length') || 0) > MAX_SOURCE) throw new Error('IMAGE_TOO_LARGE');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_SOURCE) throw new Error('IMAGE_TOO_LARGE');
  const type = sniffImageType(buffer);
  if (!type) throw new Error('UNSUPPORTED_IMAGE');
  const dimensions = imageDimensions(buffer, type);
  if (!dimensions || dimensions.width < 120 || dimensions.height < 120 || dimensions.width * dimensions.height > 50_000_000) {
    throw new Error('INVALID_IMAGE_DIMENSIONS');
  }
  return { buffer, type, source, ...dimensions };
}

async function firecrawl(url, options = {}) {
  if (!process.env.FIRECRAWL_API_KEY) return null;
  const result = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['rawHtml', 'images'], onlyMainContent: false, waitFor: 3000, timeout: 45000, removeBase64Images: true }),
    signal: AbortSignal.timeout(60000)
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok || !payload?.success) throw new Error('PROTECTED_PAGE_FETCH_FAILED');
  const html = String(payload.data?.rawHtml || '').slice(0, MAX_HTML);
  const parsed = options.shopifyJson
    ? parseShopifyProductJson(html, payload.data?.metadata?.url || url)
    : parseProductHtml(html, payload.data?.metadata?.url || url);
  const pageUrl = payload.data?.metadata?.url || url;
  const images = mergeFirecrawlImages(
    parsed.images,
    payload.data?.images || [],
    pageUrl,
    { structuredOnly: Boolean(options.shopifyJson) }
  );
  return {
    title: parsed.title || payload.data?.metadata?.title || null,
    images: [...new Set(images)],
    price: parsed.price,
    currency: parsed.currency,
    category: parsed.category,
    method: options.shopifyJson ? 'firecrawl-shopify-json' : 'firecrawl'
  };
}

async function duckDuckGoImageProduct(url) {
  const page = new URL(url);
  if (!page.hostname.endsWith('octobre-editions.com')) return null;
  const identity = productUrlIdentity(page.href);
  if (!identity) return null;
  const humanize = value => value.replace(/[-_]+/g, ' ');
  const query = `${humanize(identity.handle)} ${humanize(identity.variant)} Octobre Editions`;
  const searchPage = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaletteIntake/1.0)', Accept: 'text/html' },
    signal: AbortSignal.timeout(12000)
  });
  if (!searchPage.ok) throw new Error(`OCTOBRE_SEARCH_PAGE_${searchPage.status}`);
  const html = await searchPage.text();
  let token = duckDuckGoSearchToken(html);
  if (!token) {
    const htmlSearch = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(12000)
    });
    if (htmlSearch.ok) token = duckDuckGoSearchToken(await htmlSearch.text());
  }
  if (!token) throw new Error('OCTOBRE_SEARCH_TOKEN_MISSING');
  const endpoint = new URL('https://duckduckgo.com/i.js');
  endpoint.searchParams.set('l', 'us-en');
  endpoint.searchParams.set('o', 'json');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('vqd', token);
  endpoint.searchParams.set('f', ',,,,,');
  const result = await fetch(endpoint, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaletteIntake/1.0)', Referer: 'https://duckduckgo.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!result.ok) throw new Error(`OCTOBRE_SEARCH_RESULTS_${result.status}`);
  const payload = await result.json().catch(() => null);
  const images = selectProductImageSearchResults(payload?.results, page.href);
  if (!images.length) throw new Error('OCTOBRE_SEARCH_NO_MATCH');
  const matchingResult = payload.results.find(candidate => candidate?.image === images[0]);
  return {
    title: String(matchingResult?.title || humanize(identity.handle)).split(/\s+-\s+/)[0].trim() || null,
    images: rankProductImages(images, page.href),
    price: null,
    currency: null,
    category: null,
    method: 'octobre-image-search'
  };
}

async function openAiWebProduct(url) {
  if (!process.env.OPENAI_API_KEY) return null;
  const result = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      input: [
        {
          role: 'system',
          content: 'Find public product metadata for the exact URL and selected color variant. Return direct full-size product image URLs only. Exclude logos, icons, banners, social previews, placeholders, and unrelated products. Do not invent URLs.'
        },
        { role: 'user', content: `Product URL: ${url}` }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'product_import',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              title: { type: ['string', 'null'] },
              images: { type: 'array', items: { type: 'string' }, maxItems: 12 },
              price: { type: ['string', 'null'] },
              currency: { type: ['string', 'null'] },
              category: { type: ['string', 'null'] }
            },
            required: ['title', 'images', 'price', 'currency', 'category'],
            additionalProperties: false
          }
        }
      },
      max_output_tokens: 3000
    }),
    signal: AbortSignal.timeout(60000)
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok) {
    console.warn('OpenAI web product search unavailable', result.status, payload?.error?.code || 'unknown');
    return null;
  }
  if (payload?.status !== 'completed') {
    console.warn('OpenAI web product search incomplete', payload?.status || 'missing', payload?.incomplete_details?.reason || 'unknown');
    return null;
  }
  return parseOpenAiProductResponse(payload, url);
}

async function fetchProductImage(parsed, pageUrl, method) {
  let lastError;
  for (const imageUrl of parsed.images.slice(0, 8)) {
    try {
      const response = await safeFetch(imageUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaletteIntake/1.0)', Accept: 'image/*', Referer: pageUrl }
      });
      if (!response.ok) continue;
      const item = await binaryResponse(response, pageUrl);
      return { item, product: {
        title: parsed.title || null, page_url: pageUrl, image_url: imageUrl,
        product_id: parsed.product_id || null,
        price: parsed.price || null, currency: parsed.currency || null, category: parsed.category || null,
        color: parsed.color || null, size: parsed.size || null, material: parsed.material || null,
        contents: parsed.contents || null, fetch_method: method
      } };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('PRODUCT_IMAGE_NOT_FOUND');
}

export async function fetchProduct(value) {
  const url = await assertPublicUrl(value);
  const catalogProduct = lookupProductCatalog(url.href);
  if (catalogProduct) {
    catalogProduct.images = rankProductImages(catalogProduct.images, url.href);
    return fetchProductImage(catalogProduct, url.href, 'merchant-catalog');
  }
  let page;
  try {
    page = await safeFetch(url.href, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaletteIntake/1.0)', Accept: 'image/*,text/html;q=0.9' }
    });
  } catch {}
  if (page?.ok) {
    const type = (page.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (IMAGE_TYPES.has(type)) {
      const item = await binaryResponse(page, url.href);
      return { item, product: { title: null, page_url: url.href, image_url: url.href, fetch_method: 'direct-image' } };
    }
    if (type === 'text/html') {
      const html = (await page.text()).slice(0, MAX_HTML);
      const uniqlo = parseUniqloProductHtml(html, page.url || url.href);
      const parsed = uniqlo || parseProductHtml(html, page.url || url.href);
      parsed.images = rankProductImages(parsed.images, page.url || url.href);
      if (parsed.images.length) return fetchProductImage(parsed, page.url || url.href, uniqlo ? 'uniqlo-structured' : 'direct-metadata');
    }
  }
  for (const productApiUrl of shopifyProductApiUrls(url.href)) {
    try {
      const direct = await safeFetch(productApiUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaletteIntake/1.0)', Accept: 'application/json,text/plain;q=0.9' }
      });
      if (direct.ok) {
        const parsed = parseShopifyProductJson((await direct.text()).slice(0, MAX_HTML), productApiUrl);
        parsed.images = rankProductImages(parsed.images, url.href);
        if (parsed.images.length) return fetchProductImage(parsed, url.href, 'shopify-ajax');
      }
    } catch {}
    try {
      const parsed = await firecrawl(productApiUrl, { shopifyJson: true });
      if (parsed?.images.length) return fetchProductImage(parsed, url.href, parsed.method);
    } catch {}
  }
  try {
    const parsed = await duckDuckGoImageProduct(url.href);
    if (parsed?.images.length) return fetchProductImage(parsed, url.href, parsed.method);
  } catch (error) {
    console.warn('Octobre image search unavailable', error?.message || 'unknown');
  }
  let protectedFetchFailed = false;
  try {
    const parsed = await firecrawl(url.href);
    if (parsed?.images.length) return fetchProductImage(parsed, url.href, parsed.method);
  } catch (error) {
    protectedFetchFailed = error?.message === 'PROTECTED_PAGE_FETCH_FAILED';
  }
  try {
    const parsed = await openAiWebProduct(url.href);
    if (parsed?.images.length) return fetchProductImage(parsed, url.href, parsed.method);
  } catch {}
  if (!process.env.FIRECRAWL_API_KEY && !process.env.OPENAI_API_KEY) throw new Error('PROTECTED_PAGE_REQUIRES_PROVIDER');
  throw new Error(protectedFetchFailed ? 'PROTECTED_PAGE_FETCH_FAILED' : 'PRODUCT_IMAGE_NOT_FOUND');
}

function photoFromDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('INVALID_PHOTO');
  const buffer = Buffer.from(match[2], 'base64');
  const type = sniffImageType(buffer);
  if (!type || type !== match[1] || !buffer.length || buffer.length > MAX_SOURCE) throw new Error('INVALID_PHOTO');
  return { buffer, type, source: 'photo' };
}

async function sourceFromRequest(request) {
  const contentType = (request.headers['content-type'] || '').split(';')[0].toLowerCase();
  const raw = await readRequest(request);
  if (IMAGE_TYPES.has(contentType)) {
    const type = sniffImageType(raw);
    if (!type || type !== contentType || raw.length > MAX_SOURCE) throw new Error('INVALID_PHOTO');
    return { item: { buffer: raw, type, source: 'photo' }, userId: request.query?.user_id, product: null };
  }
  if (contentType !== 'application/json') throw new Error('UNSUPPORTED_CONTENT_TYPE');
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new Error('INVALID_JSON'); }
  const userId = String(body.user_id || '');
  if (body.url && body.photo) throw new Error('ONE_SOURCE_ONLY');
  if (body.url) return { ...(await fetchProduct(body.url)), userId };
  if (body.photo) return { item: photoFromDataUrl(body.photo), userId, product: null };
  throw new Error('SOURCE_REQUIRED');
}

export async function generate(item) {
  const form = new FormData();
  form.set('model', MODEL);
  form.set('prompt', PROMPT);
  form.set('image', new Blob([item.buffer], { type: item.type }), `source.${item.type.split('/')[1]}`);
  form.set('background', 'transparent');
  form.set('output_format', 'png');
  form.set('size', '768x1024');
  form.set('quality', 'medium');
  const result = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(150000)
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok) {
    console.error('OpenAI image generation failed', result.status, payload?.error?.code || 'unknown');
    throw new Error('GENERATION_FAILED');
  }
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('GENERATION_FAILED');
  const buffer = cleanStickerPng(Buffer.from(encoded, 'base64'));
  if (buffer.length > MAX_OUTPUT || !hasTransparency(buffer, 'image/png')) throw new Error('INVALID_GENERATED_IMAGE');
  return { buffer, image: `data:image/png;base64,${buffer.toString('base64')}`, usage: payload.usage || null };
}

export function authorized(request) {
  const expected = process.env.PALETTE_API_TOKEN;
  const provided = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function resolveProductQuery(input) {
  const value = String(input || '').trim();
  if (!value || value.length > 500) throw new Error('INVALID_QUERY');
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
  } catch {}
  if (!process.env.FIRECRAWL_API_KEY) throw new Error('SEARCH_NOT_CONFIGURED');
  const result = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `${value} official product`, limit: 6, sources: ['web'], timeout: 30000 }),
    signal: AbortSignal.timeout(45000)
  });
  const payload = await result.json().catch(() => null);
  const candidates = payload?.data?.web || payload?.data || [];
  if (!result.ok || !Array.isArray(candidates)) throw new Error('PRODUCT_SEARCH_FAILED');
  const blocked = /(?:amazon|ebay|pinterest|facebook|instagram|tiktok|reddit)\./i;
  const candidate = candidates.find(entry => entry?.url && !blocked.test(entry.url)) || candidates.find(entry => entry?.url);
  if (!candidate) throw new Error('PRODUCT_NOT_FOUND');
  return candidate.url;
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method === 'GET') return send(response, 200, {
    endpoint: '/api/items',
    configured: {
      generation: Boolean(process.env.OPENAI_API_KEY),
      protected_pages: Boolean(process.env.FIRECRAWL_API_KEY),
      authentication: Boolean(process.env.PALETTE_API_TOKEN)
    },
    model: MODEL,
    accepts: ['application/json: { user_id, url }', 'application/json: { user_id, photo: data_url }', 'image/png|jpeg|webp body with ?user_id=...']
  });
  if (request.method !== 'POST') return send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!process.env.PALETTE_API_TOKEN) return send(response, 503, { error: 'AUTH_NOT_CONFIGURED' });
  if (!authorized(request)) return send(response, 401, { error: 'UNAUTHORIZED' });
  if (!process.env.OPENAI_API_KEY) return send(response, 503, { error: 'GENERATION_NOT_CONFIGURED' });
  try {
    const { item, userId, product } = await sourceFromRequest(request);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(userId || ''))) return send(response, 400, { error: 'INVALID_USER_ID' });
    const generated = await generate(item);
    return send(response, 201, {
      id: crypto.randomUUID(), user_id: userId, source: item.source, product,
      image: generated.image, usage: generated.usage, created_at: new Date().toISOString()
    });
  } catch (error) {
    const code = error?.message || 'INTERNAL_ERROR';
    const client = new Set(['INVALID_URL', 'PAYLOAD_TOO_LARGE', 'INVALID_PHOTO', 'UNSUPPORTED_CONTENT_TYPE', 'INVALID_JSON', 'ONE_SOURCE_ONLY', 'SOURCE_REQUIRED', 'INVALID_USER_ID']);
    const upstream = new Set(['PRODUCT_IMAGE_NOT_FOUND', 'SOURCE_UNAVAILABLE', 'UNSUPPORTED_IMAGE', 'IMAGE_TOO_LARGE', 'PROTECTED_PAGE_REQUIRES_FIRECRAWL', 'PROTECTED_PAGE_FETCH_FAILED', 'GENERATION_FAILED', 'INVALID_GENERATED_IMAGE']);
    console.error('Palette intake failed', code);
    return send(response, client.has(code) ? 400 : upstream.has(code) ? 502 : 500, { error: code });
  }
}
