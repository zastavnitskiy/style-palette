function catalogKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch { return null; }
}

const PRODUCTS = new Map([
  ['https://www.octobre-editions.com/eu-en/product/pack-durham-socks/rust-beige-brown', {
    title: 'Pack Durham Socks',
    images: [
      'https://media.octobre-editions.com/image/upload/c_fill%2Cd_placeholder_dark.png%2Cfl_progressive%3Asemi%2Ch_816%2Cq_auto%3Abest%2Cw_582/gqnz11rqyctrm84pgagc.jpg'
    ],
    price: '45',
    currency: 'EUR',
    category: 'Socks',
    color: 'Rust / Beige / Brown',
    size: 'TU',
    material: '66% recycled wool, 28% polyamide, other fibres',
    contents: 'Three pairs of ribbed socks'
  }]
]);

export function lookupProductCatalog(value) {
  const product = PRODUCTS.get(catalogKey(value));
  return product ? structuredClone(product) : null;
}
