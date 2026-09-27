const palette = document.querySelector('#palette');
const stickers = document.querySelectorAll('.sticker');
let active = null;
let origin = { x: 0, y: 0, left: 0, top: 0 };
let topLayer = 10;

stickers.forEach((sticker) => {
  sticker.addEventListener('pointerdown', (event) => {
    if (event.target.closest('a')) return;
    active = sticker;
    const itemRect = sticker.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    origin = {
      x: event.clientX,
      y: event.clientY,
      left: itemRect.left - paletteRect.left,
      top: itemRect.top - paletteRect.top
    };
    sticker.style.transform = 'rotate(0deg) scale(1.03)';
    sticker.style.left = `${origin.left}px`;
    sticker.style.top = `${origin.top}px`;
    sticker.style.right = 'auto';
    sticker.style.bottom = 'auto';
    sticker.style.zIndex = ++topLayer;
    sticker.setPointerCapture(event.pointerId);
  });

  sticker.addEventListener('pointermove', (event) => {
    if (active !== sticker) return;
    const maxLeft = palette.clientWidth - sticker.offsetWidth * 0.45;
    const maxTop = palette.clientHeight - sticker.offsetHeight * 0.45;
    const left = Math.min(maxLeft, Math.max(-sticker.offsetWidth * 0.45, origin.left + event.clientX - origin.x));
    const top = Math.min(maxTop, Math.max(-sticker.offsetHeight * 0.45, origin.top + event.clientY - origin.y));
    sticker.style.left = `${left}px`;
    sticker.style.top = `${top}px`;
  });

  sticker.addEventListener('pointerup', () => {
    if (active === sticker) sticker.style.transform = 'rotate(0deg)';
    active = null;
  });
});

const togglePanel = (open) => {
  document.body.classList.toggle('panel-open', open);
  document.querySelector('.about-panel').setAttribute('aria-hidden', String(!open));
  document.querySelector('.about-button').setAttribute('aria-expanded', String(open));
};

document.querySelector('.about-button').addEventListener('click', () => togglePanel(true));
document.querySelector('.close-panel').addEventListener('click', () => togglePanel(false));
document.querySelector('.scrim').addEventListener('click', () => togglePanel(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') togglePanel(false); });
