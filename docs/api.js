// Talks to the Apps Script backend, and keeps the connection details on this device.
// The body is sent as text/plain so the browser skips the CORS preflight, which Apps Script can't answer.

const REQUEST_TIMEOUT_MS = 200000;
const URL_PREFIX = 'https://script.google.com/macros/s/';

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Storage can throw in private browsing, so reads and writes are guarded.
export function load(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The app still works for this visit.
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

export const getConnection = () => load('connection');
export const setConnection = (connection) => save('connection', connection);
export const isValidUrl = (url) => url.startsWith(URL_PREFIX) && url.endsWith('/exec');

export async function post(connection, action, data = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let result;
  try {
    const response = await fetch(connection.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: connection.token, action, ...data }),
      signal: controller.signal,
    });
    result = await response.json();
  } catch {
    throw new ApiError('network', 'Can\'t reach the assistant. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok) throw new ApiError(result.error, result.message || 'Something went wrong.');
  return result;
}

export const call = (action, data) => post(getConnection(), action, data);

export function isHebrew(text) {
  return /[֐-׿]/.test(String(text));
}

// Creates an element. Text always goes in as text, never as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  });
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

export function showNotice(text) {
  document.getElementById('notice-text').textContent = text;
  const dialog = document.getElementById('notice');
  if (!dialog.open) dialog.showModal();
}

// A real spring, the way iOS moves things: it arrives quickly, drifts a touch past, and settles.
function springEasing() {
  const damping = 0.68;
  const frequency = 9.5;
  const damped = frequency * Math.sqrt(1 - damping ** 2);
  const points = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    const decay = Math.exp(-damping * frequency * t);
    const value = 1 - decay * (Math.cos(damped * t) + (damping * frequency / damped) * Math.sin(damped * t));
    points.push(i === 40 ? 1 : Number(value.toFixed(4)));
  }
  return 'linear(' + points.join(', ') + ')';
}

const SPRING = springEasing();
const EASE = CSS.supports('animation-timing-function', SPRING) ? SPRING : 'cubic-bezier(.22, 1, .36, 1)';
const DURATION = 620;
// Folding uses iOS's own curve, because a spring would overshoot past closed and squash the cards.
const FOLD_EASE = 'cubic-bezier(.32, .72, 0, 1)';
const FOLD_BASE_MS = 420;
const FOLD_MS_PER_PIXEL = 0.2;
const FOLD_MAX_MS = 680;
document.documentElement.style.setProperty('--ease', EASE);

// Plays an animation and resolves when it ends. People who turned on Reduce Motion skip it.
export function animate(node, keyframes, duration = DURATION) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return node.animate(keyframes, { duration, easing: EASE }).finished.catch(() => {});
}

// Reveals or hides a large section. The contents are always built and laid out inside a closed
// fold, so tapping only moves a mask and the items below, with nothing to build at that moment.
export async function foldSection(section, fold, body, opening) {
  if (section.dataset.moving) return;
  fold.inert = !opening;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    section.classList.toggle('open', opening);
    return;
  }
  section.dataset.moving = 'true';
  const height = body.offsetHeight;
  if (opening) section.classList.add('open');

  const duration = Math.min(FOLD_MAX_MS, FOLD_BASE_MS + height * FOLD_MS_PER_PIXEL);
  const options = { duration, easing: FOLD_EASE, fill: 'both' };
  const order = (frames) => (opening ? frames : [...frames].reverse());
  const below = [];
  for (let node = section.nextElementSibling; node; node = node.nextElementSibling) below.push(node);

  const moves = [
    section.animate(order([
      { clipPath: `inset(0 0 ${height}px 0 round 22px)` },
      { clipPath: 'inset(0 0 0 0 round 22px)' },
    ]), options),
    ...below.map((node) => node.animate(order([
      { transform: `translateY(${-height}px)` },
      { transform: 'none' },
    ]), options)),
  ];
  await Promise.all(moves.map((move) => move.finished.catch(() => {})));
  if (!opening) section.classList.remove('open');
  moves.forEach((move) => move.cancel());
  delete section.dataset.moving;
}

function openShape(node) {
  const style = getComputedStyle(node);
  return {
    height: node.offsetHeight + 'px',
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    opacity: 1,
  };
}

const CLOSED_SHAPE = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', opacity: 0 };

async function slide(node, keyframes) {
  node.style.overflow = 'hidden';
  await animate(node, keyframes);
  node.style.overflow = '';
}

export const slideOpen = (node) => slide(node, [CLOSED_SHAPE, openShape(node)]);
export const slideClosed = (node) => slide(node, [openShape(node), CLOSED_SHAPE]);
