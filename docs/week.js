// The week strip above the chat. It reads straight from the calendars, with no AI.
import { call, el, getConnection, load, save } from './api.js';

const WEEK_KEY = 'week';
const MAX_MARKS = 4;
const EVENT_COLORS = {
  1: '#7986CB', 2: '#33B679', 3: '#8E24AA', 4: '#E67C73', 5: '#F6BF26', 6: '#F4511E',
  7: '#039BE5', 8: '#616161', 9: '#3F51B5', 10: '#0B8043', 11: '#D50000',
};

const $ = (id) => document.getElementById(id);

// Dates here are plain yyyy-mm-dd text, so noon UTC keeps them on the right day.
const asDate = (day) => new Date(day + 'T12:00:00Z');
const format = (day, options) => asDate(day).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });

function eventsOn(data, day) {
  return data.events.filter((event) => {
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
  let offset = 0;
  let selected = null;
  let data = load(WEEK_KEY);
  let latestRequest = 0;
  // Weeks already seen, so the arrows answer at once while a fresh copy loads.
  const weeks = { 0: data };

  function renderDay() {
    const panel = $('day');
    panel.hidden = !selected || !data;
    if (panel.hidden) return;
    const events = eventsOn(data, selected);
    panel.replaceChildren(
      el('p', { class: 'day-title' }, format(selected, { weekday: 'long', day: 'numeric', month: 'long' })),
      events.length ? el('ul', {}, ...events.map(eventLine)) : el('p', { class: 'day-empty' }, 'Nothing planned'),
    );
  }

  function dayButton(day) {
    const marks = eventsOn(data, day).slice(0, MAX_MARKS).map((event) => {
      const mark = el('i', {});
      if (EVENT_COLORS[event.colorId]) mark.style.background = EVENT_COLORS[event.colorId];
      return mark;
    });
    const classes = ['date'];
    if (day === data.today) classes.push('today');
    if (day === selected) classes.push('selected');
    return el('button', {
      class: classes.join(' '),
      type: 'button',
      'aria-label': format(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      onclick: () => {
        selected = selected === day ? null : day;
        render();
      },
    },
    el('span', { class: 'weekday' }, format(day, { weekday: 'narrow' })),
    el('span', { class: 'number' }, String(Number(day.slice(8)))),
    el('span', { class: 'marks' }, ...marks));
  }

  function render() {
    if (!data) return;
    $('week-title').textContent = format(data.days[3], { month: 'long' });
    $('week').replaceChildren(...data.days.map(dayButton));
    renderDay();
    onHeightChange();
  }

  async function refresh() {
    if (!getConnection()) return;
    latestRequest += 1;
    const request = latestRequest;
    try {
      const requested = offset;
      const result = await call('getWeek', { offset: requested });
      weeks[requested] = result;
      if (requested === 0) save(WEEK_KEY, result);
      if (request !== latestRequest) return;
      data = result;
      render();
      prefetch(requested + 1);
    } catch {
      // The preview is a convenience, so it just keeps showing what it has.
    }
  }

  async function prefetch(week) {
    if (weeks[week]) return;
    try {
      weeks[week] = await call('getWeek', { offset: week });
    } catch {
      // It will load when the week is opened.
    }
  }

  function move(step) {
    offset += step;
    selected = null;
    if (weeks[offset]) {
      data = weeks[offset];
      render();
    }
    refresh();
  }

  $('week-prev').addEventListener('click', () => move(-1));
  $('week-next').addEventListener('click', () => move(1));
  render();
  return { refresh };
}
