// The week strip above the chat. It reads straight from the calendars, with no AI.
// Each week is a page in a native horizontal scroller, so iOS itself handles the swipe.
import { call, el, getConnection, load, save, slideClosed, slideOpen } from './api.js';

const WEEK_KEY = 'weeks';
const MAX_MARKS = 4;
const FIRST_WEEK = -26;
const LAST_WEEK = 52;
const EVENT_COLORS = {
  1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E',
  7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000',
};

const $ = (id) => document.getElementById(id);

// Dates here are plain yyyy-mm-dd text, so noon UTC keeps them on the right day.
const asDate = (day) => new Date(day + 'T12:00:00Z');
const format = (day, options) => asDate(day).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });
const addDays = (day, count) => new Date(asDate(day).getTime() + count * 86400000).toISOString().slice(0, 10);
const todayInIsrael = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

function eventsOn(events, day) {
  return events.filter((event) => {
    const first = event.start.slice(0, 10);
    const last = event.end.slice(0, 10);
    // An all-day event's end date is the day after it finishes.
    return first <= day && (event.allDay ? day < last : day <= last);
  });
}

function eventLine(event) {
  return el('li', {},
    el('span', { class: 'time' }, event.allDay ? 'All day' : event.start.slice(11, 16)),
    el('span', { class: 'what', dir: 'auto' }, event.title),
    el('span', { class: 'which', dir: 'auto' }, event.calendar));
}

export function setupWeek(onHeightChange) {
  const strip = $('week');
  const today = todayInIsrael();
  const thisSunday = addDays(today, -asDate(today).getUTCDay());
  const sundayOf = (offset) => addDays(thisSunday, 7 * offset);
  const daysOf = (offset) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(sundayOf(offset), i));

  // Events by the week's Sunday, so saved weeks show at once.
  const weeks = load(WEEK_KEY, {});
  const panes = {};
  let current = 0;
  let selected = null;
  let positioned = false;

  const eventsOfWeek = (offset) => weeks[sundayOf(offset)] || [];

  async function renderDay() {
    const panel = $('day');
    const wasOpen = !panel.hidden;
    if (!selected) {
      if (wasOpen) {
        await slideClosed(panel);
        if (!selected) panel.hidden = true;
        onHeightChange();
      }
      return;
    }
    const events = eventsOn(eventsOfWeek(current), selected);
    panel.replaceChildren(
      el('p', { class: 'day-title' }, format(selected, { weekday: 'long', day: 'numeric', month: 'long' })),
      events.length ? el('ul', {}, ...events.map(eventLine)) : el('p', { class: 'day-empty' }, 'Nothing planned'),
    );
    panel.hidden = false;
    if (!wasOpen) await slideOpen(panel);
    onHeightChange();
  }

  function dayButton(day, events) {
    const marks = eventsOn(events, day).slice(0, MAX_MARKS).map((event) => {
      const mark = el('i', {});
      if (EVENT_COLORS[event.colorId]) mark.style.background = EVENT_COLORS[event.colorId];
      return mark;
    });
    const classes = ['date'];
    if (day === today) classes.push('today');
    if (day === selected) classes.push('selected');
    return el('button', {
      class: classes.join(' '),
      type: 'button',
      'aria-label': format(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      onclick: () => {
        selected = selected === day ? null : day;
        fillPane(current);
        renderDay();
      },
    },
    el('span', { class: 'weekday' }, format(day, { weekday: 'narrow' })),
    el('span', { class: 'number' }, String(Number(day.slice(8)))),
    el('span', { class: 'marks' }, ...marks));
  }

  function fillPane(offset) {
    const pane = panes[offset];
    if (!pane) return;
    const events = eventsOfWeek(offset);
    pane.replaceChildren(...daysOf(offset).map((day) => dayButton(day, events)));
  }

  function fillNearby() {
    [current - 1, current, current + 1].forEach(fillPane);
  }

  function showTitle() {
    $('week-title').textContent = format(daysOf(current)[3], { month: 'long' });
  }

  async function fetchWeek(offset) {
    try {
      const { events } = await call('getWeek', { offset });
      weeks[sundayOf(offset)] = events;
      save(WEEK_KEY, weeks);
      fillPane(offset);
      if (offset === current && selected) renderDay();
    } catch {
      // The preview is a convenience, so it just keeps showing what it has.
    }
  }

  function moveToPane(offset, behavior) {
    strip.scrollTo({ left: panes[offset].offsetLeft, behavior });
  }

  function refresh() {
    if (!getConnection()) return;
    if (!positioned && strip.clientWidth > 0) {
      moveToPane(current, 'auto');
      positioned = true;
    }
    [current, current + 1, current - 1].forEach(fetchWeek);
  }

  function onScroll() {
    const page = Math.round(strip.scrollLeft / strip.clientWidth) + FIRST_WEEK;
    if (page === current || !positioned) return;
    current = page;
    selected = null;
    showTitle();
    fillNearby();
    renderDay();
    [current, current + 1, current - 1].filter((offset) => !weeks[sundayOf(offset)]).forEach(fetchWeek);
  }

  for (let offset = FIRST_WEEK; offset <= LAST_WEEK; offset += 1) {
    panes[offset] = el('div', { class: 'week-pane' });
    strip.append(panes[offset]);
  }
  strip.addEventListener('scroll', onScroll, { passive: true });
  $('week-prev').addEventListener('click', () => moveToPane(Math.max(current - 1, FIRST_WEEK), 'smooth'));
  $('week-next').addEventListener('click', () => moveToPane(Math.min(current + 1, LAST_WEEK), 'smooth'));
  showTitle();
  fillNearby();
  return { refresh };
}
