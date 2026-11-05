// Connection screen and chat screen.
import {
  animate, call, getConnection, isHebrew, isValidUrl, load, post, remove, save, setConnection, showNotice,
} from './api.js';
import { openSettings, prepareSettings } from './settings.js';
import { setupVoice } from './voice.js';
import { setupWeek } from './week.js';

const CHAT_KEY = 'chat';
const SESSION_HOURS = 6;
const MAX_SAVED_MESSAGES = 40;
const KEYBOARD_MIN_HEIGHT = 80;
const TAP_MOVEMENT = 10;
const KEYBOARD_SETTLE_MS = 380;
const TEXT_TYPES = ['text', 'url', 'password', 'number', 'time'];

const $ = (id) => document.getElementById(id);
const views = ['setup-view', 'chat-view', 'settings-view'];

let chat = null;
let busy = false;
let week = null;

export function showView(id) {
  const previous = views.find((view) => !$(view).hidden);
  views.forEach((view) => { $(view).hidden = view !== id; });
  if (previous && previous !== id) {
    const from = id === 'settings-view' ? 56 : -56;
    animate($(id), [{ transform: `translateX(${from}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }]);
  }
}

function newChat() {
  return { session: 'app-' + crypto.randomUUID(), lastUsed: Date.now(), messages: [], pending: null };
}

// The backend forgets a conversation after a few hours, so the screen starts fresh too.
function loadChat() {
  const saved = load(CHAT_KEY);
  const fresh = saved && Date.now() - saved.lastUsed < SESSION_HOURS * 3600000;
  return fresh ? saved : newChat();
}

function saveChat() {
  chat.lastUsed = Date.now();
  chat.messages = chat.messages.slice(-MAX_SAVED_MESSAGES);
  save(CHAT_KEY, chat);
}

function scrollToEnd() {
  const scroller = $('scroller');
  scroller.scrollTop = scroller.scrollHeight;
}

function messageNode(message) {
  const item = document.createElement('li');
  item.className = 'message ' + message.role;
  const text = document.createElement('p');
  text.dir = 'auto';
  text.textContent = message.text;
  item.append(text);
  return item;
}

function renderPending() {
  const pending = chat.pending;
  $('proposal').hidden = !pending;
  if (!pending) return;
  const hebrew = isHebrew(pending.summary);
  $('proposal-text').textContent = pending.summary;
  $('confirm').textContent = hebrew ? 'אישור' : 'Confirm';
  $('cancel').textContent = hebrew ? 'ביטול' : 'Cancel';
}

function render() {
  $('log').replaceChildren(...chat.messages.map(messageNode));
  $('empty').hidden = chat.messages.length > 0;
  renderPending();
  scrollToEnd();
}

function addMessage(role, text) {
  chat.messages.push({ role, text });
  const node = messageNode({ role, text });
  node.classList.add('enter');
  $('log').append(node);
  $('empty').hidden = true;
  saveChat();
  scrollToEnd();
}

function setBusy(value) {
  busy = value;
  $('send').disabled = value;
  $('confirm').disabled = value;
  $('cancel').disabled = value;
  $('thinking')?.remove();
  if (value) {
    const item = document.createElement('li');
    item.id = 'thinking';
    item.className = 'thinking';
    item.setAttribute('aria-label', 'Thinking');
    item.textContent = '...';
    $('log').append(item);
    scrollToEnd();
  }
}

function handleError(error) {
  if (error.code === 'unauthorized') {
    showSetup('The token was rejected. Please enter it again.');
  } else {
    showNotice(error.message);
  }
}

function applyResult(result) {
  addMessage('assistant', result.reply);
  chat.pending = result.pending || null;
  saveChat();
  renderPending();
  scrollToEnd();
  week.refresh();
}

async function run(action, data) {
  setBusy(true);
  try {
    applyResult(await call(action, { session: chat.session, ...data }));
    return true;
  } catch (error) {
    handleError(error);
    return false;
  } finally {
    setBusy(false);
  }
}

async function send() {
  const input = $('input');
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  input.blur();
  resizeInput();
  addMessage('user', text);
  const sent = await run('chat', { message: text });
  if (!sent) {
    // Put the words back so nothing has to be dictated twice.
    chat.messages.pop();
    $('log').lastElementChild?.remove();
    saveChat();
    input.value = text;
    resizeInput();
  }
}

function resizeInput() {
  const input = $('input');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight + 2, 200) + 'px';
}

function showSetup(message = '') {
  const connection = getConnection();
  $('setup-url').value = connection?.url || '';
  $('setup-token').value = '';
  $('setup-status').textContent = message;
  showView('setup-view');
}

async function connect(event) {
  event.preventDefault();
  const connection = { url: $('setup-url').value.trim(), token: $('setup-token').value.trim() };
  const status = $('setup-status');
  if (!isValidUrl(connection.url)) {
    status.textContent = 'That doesn\'t look like the web app URL. It ends in /exec.';
    return;
  }
  status.textContent = 'Connecting...';
  try {
    await post(connection, 'getSettings');
    setConnection(connection);
    showChat();
    prepareSettings(navigation);
  } catch (error) {
    status.textContent = error.code === 'unauthorized' ? 'That token was rejected.' : error.message;
  }
}

export function showChat() {
  showView('chat-view');
  render();
  week.refresh();
}

export function signOut() {
  remove('connection');
  remove('settings');
  remove('weeks');
  remove(CHAT_KEY);
  chat = newChat();
  showSetup();
}

// The layout never resizes for the keyboard, so nothing squashes. The chat stays where it is
// and fades, and only the message box rises, which CSS animates alongside the keyboard.
function trackViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;
  let fullHeight = viewport.height;
  const update = () => {
    fullHeight = Math.max(fullHeight, viewport.height);
    const keyboard = fullHeight - viewport.height;
    root.style.setProperty('--app-height', fullHeight + 'px');
    root.style.setProperty('--viewport-top', viewport.offsetTop + 'px');
    root.style.setProperty('--keyboard', keyboard + 'px');
    root.classList.toggle('keyboard-open', keyboard > KEYBOARD_MIN_HEIGHT);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}

function textFieldAt(target) {
  const field = target.closest('input, textarea') || target.closest('label')?.control;
  if (!field) return null;
  return field.tagName === 'TEXTAREA' || TEXT_TYPES.includes(field.type) ? field : null;
}

// Brings a field to the middle of the space above the keyboard, by scrolling only its own list.
function bringIntoView(field) {
  const list = field.closest('.scroller');
  if (!list || field.id === 'input') return;
  const box = field.getBoundingClientRect();
  const middle = window.visualViewport ? window.visualViewport.height / 2 : window.innerHeight / 2;
  list.scrollBy({ top: box.top + box.height / 2 - middle, behavior: 'smooth' });
}

// Left alone, iOS slides the whole screen up to reach a field. Focusing it ourselves stops
// that, everywhere in the app. A finger that moved was scrolling, so that is left alone.
function setupFieldFocus() {
  let start = null;
  document.addEventListener('touchstart', (event) => {
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  document.addEventListener('touchend', (event) => {
    const field = textFieldAt(event.target);
    const touch = event.changedTouches[0];
    const moved = !start || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_MOVEMENT;
    if (!field || moved || document.activeElement === field) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
    setTimeout(() => bringIntoView(field), KEYBOARD_SETTLE_MS);
  }, { passive: false });
}

const navigation = { showView, showChat, signOut, handleError };

function start() {
  chat = loadChat();
  $('setup-form').addEventListener('submit', connect);
  $('composer').addEventListener('submit', (event) => { event.preventDefault(); send(); });
  $('input').addEventListener('input', resizeInput);
  // Tapping the faded chat closes the keyboard.
  $('scroller').addEventListener('click', () => $('input').blur());
  $('confirm').addEventListener('click', () => run('confirm', { pendingId: chat.pending.id }));
  $('cancel').addEventListener('click', () => run('cancel', { pendingId: chat.pending.id }));
  $('open-settings').addEventListener('click', () => openSettings());
  $('notice-close').addEventListener('click', () => $('notice').close());

  week = setupWeek(scrollToEnd);
  setupFieldFocus();
  setupVoice(resizeInput);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('chat-view').hidden) week.refresh();
  });
  trackViewport();
  if (getConnection()) {
    showChat();
    prepareSettings(navigation);
  } else {
    showSetup();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
