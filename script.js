const palette = document.querySelector('#palette');
const objects = document.querySelectorAll('.object');
const routeUserId = location.pathname.split('/').filter(Boolean)[0] || '441294944';
const userId = /^[a-zA-Z0-9_-]{1,64}$/.test(routeUserId) ? routeUserId : 'unknown';

document.querySelectorAll('[data-user-id]').forEach((node) => { node.textContent = userId; });
document.title = `Palette / ${userId}`;

let active = null;
let origin = { x: 0, y: 0, left: 0, top: 0 };
let topLayer = 10;

objects.forEach((object) => {
  object.addEventListener('pointerdown', (event) => {
    if (event.target.closest('a')) return;
    active = object;
    const itemRect = object.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    origin = { x: event.clientX, y: event.clientY, left: itemRect.left - paletteRect.left, top: itemRect.top - paletteRect.top };
    object.style.transform = 'rotate(0deg)';
    object.style.left = `${origin.left}px`;
    object.style.top = `${origin.top}px`;
    object.style.right = 'auto';
    object.style.bottom = 'auto';
    object.style.zIndex = ++topLayer;
    object.setPointerCapture(event.pointerId);
  });

  object.addEventListener('pointermove', (event) => {
    if (active !== object) return;
    const left = origin.left + event.clientX - origin.x;
    const top = origin.top + event.clientY - origin.y;
    object.style.left = `${Math.min(palette.clientWidth - object.offsetWidth * .3, Math.max(-object.offsetWidth * .3, left))}px`;
    object.style.top = `${Math.min(palette.clientHeight - object.offsetHeight * .3, Math.max(-object.offsetHeight * .3, top))}px`;
  });

  object.addEventListener('pointerup', () => { active = null; });
  object.addEventListener('pointercancel', () => { active = null; });
});

document.querySelector('#copy-api').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/api/items`);
  const toast = document.querySelector('.toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1400);
});
