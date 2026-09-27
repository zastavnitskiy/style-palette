const palette = document.querySelector('#palette');
const objects = document.querySelectorAll('.object');
const routeUserId = location.pathname.split('/').filter(Boolean)[0] || '441294944';
const userId = /^[a-zA-Z0-9_-]{1,64}$/.test(routeUserId) ? routeUserId : 'unknown';
const storageKey = `palette:hidden:${userId}`;
const toast = document.querySelector('.toast');
const toastMessage = document.querySelector('[data-toast-message]');
const undoButton = document.querySelector('#undo-remove');
const restoreButton = document.querySelector('#restore-items');
let toastTimer = null;
let lastRemoved = null;

const knownItemIds = new Set([...objects].map((object) => object.dataset.itemId));
let hiddenItemIds = new Set();
try {
  const storedIds = JSON.parse(localStorage.getItem(storageKey) || '[]');
  hiddenItemIds = new Set(Array.isArray(storedIds) ? storedIds.filter((id) => knownItemIds.has(id)) : []);
} catch {
  localStorage.removeItem(storageKey);
}

document.querySelectorAll('[data-user-id]').forEach((node) => { node.textContent = userId; });
document.title = `Palette / ${userId}`;

function saveHiddenItems() {
  localStorage.setItem(storageKey, JSON.stringify([...hiddenItemIds]));
}

function updatePaletteState() {
  objects.forEach((object) => { object.hidden = hiddenItemIds.has(object.dataset.itemId); });
  const visibleCount = objects.length - hiddenItemIds.size;
  document.querySelector('[data-object-count]').textContent = String(visibleCount).padStart(2, '0');
  document.querySelector('[data-hidden-count]').textContent = hiddenItemIds.size;
  restoreButton.hidden = hiddenItemIds.size === 0;
}

function showToast(message, canUndo = false) {
  clearTimeout(toastTimer);
  toastMessage.textContent = message;
  undoButton.hidden = !canUndo;
  toast.classList.add('show');
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    undoButton.hidden = true;
  }, 4000);
}

updatePaletteState();

let active = null;
let origin = { x: 0, y: 0, left: 0, top: 0 };
let topLayer = 10;

objects.forEach((object) => {
  object.addEventListener('pointerdown', (event) => {
    if (event.target.closest('a, button')) return;
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

  object.querySelector('.remove-object').addEventListener('click', () => {
    lastRemoved = object.dataset.itemId;
    hiddenItemIds.add(lastRemoved);
    saveHiddenItems();
    updatePaletteState();
    showToast(`${object.dataset.name} REMOVED`, true);
  });
});

undoButton.addEventListener('click', () => {
  if (!lastRemoved) return;
  hiddenItemIds.delete(lastRemoved);
  saveHiddenItems();
  updatePaletteState();
  lastRemoved = null;
  showToast('ITEM RESTORED');
});

restoreButton.addEventListener('click', () => {
  hiddenItemIds.clear();
  saveHiddenItems();
  updatePaletteState();
  lastRemoved = null;
  showToast('ALL ITEMS RESTORED');
});

document.querySelector('#copy-api').addEventListener('click', async () => {
  await navigator.clipboard.writeText(`${location.origin}/api/items`);
  showToast('ENDPOINT COPIED');
});
