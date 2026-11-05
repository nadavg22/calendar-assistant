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
