// Lets the owner adjust a proposal before confirming it. The server checks every edit again.
import { el, isHebrew } from './api.js';

const $ = (id) => document.getElementById(id);

const datePart = (value) => String(value).slice(0, 10);
const timePart = (value) => String(value).slice(11, 16);
const isDateOnly = (value) => String(value).length === 10;

function addDays(day, count) {
  return new Date(new Date(day + 'T12:00:00Z').getTime() + count * 86400000).toISOString().slice(0, 10);
}

const daysBetween = (first, last) => Math.round((new Date(last + 'T12:00:00Z') - new Date(first + 'T12:00:00Z')) / 86400000);

function field(label, control) {
  return el('label', {}, label, control);
}

function text(value, props = {}) {
  return el('input', { type: 'text', value: value ?? '', dir: 'auto', autocomplete: 'off', ...props });
}

function calendarPicker(selected, calendars) {
  return el('select', {}, ...calendars.map((label) => el('option', { value: label, selected: label === selected }, label)));
}

// Date and time fields for a start and an optional end. read() gives the values to send.
function whenFields(start, end) {
  const date = el('input', { type: 'date', value: datePart(start) });
  if (isDateOnly(start)) {
    const length = end ? daysBetween(datePart(start), datePart(end)) : 1;
    return {
      node: field('Date', date),
      read: () => ({ start: date.value, ...(end ? { end: addDays(date.value, length) } : {}) }),
    };
  }
  const from = el('input', { type: 'time', value: timePart(start) });
  const to = end ? el('input', { type: 'time', value: timePart(end) }) : null;
  return {
    node: el('div', { class: 'rows' }, field('Date', date),
      el('div', { class: 'times' }, field('From', from), to ? field('To', to) : null)),
    read: () => {
      const values = { start: `${date.value}T${from.value}:00` };
      // An end at or before the start runs past midnight.
      if (to) values.end = `${to.value <= from.value ? addDays(date.value, 1) : date.value}T${to.value}:00`;
      return values;
    },
  };
}

function createFields(event, calendars) {
  const title = text(event.title);
  const calendar = calendarPicker(event.calendar, calendars);
  const when = whenFields(event.start, event.end);
  const location = text(event.location);
  const guests = text((event.guests || []).join(', '), { dir: 'ltr', inputMode: 'email', autocapitalize: 'off', placeholder: 'name@example.com' });
  return {
    nodes: [field('Title', title), field('Calendar', calendar), when.node, field('Location', location), field('Guests', guests)],
    read: () => ({
      event: {
        title: title.value.trim(),
        calendar: calendar.value,
        ...when.read(),
        location: location.value.trim(),
        guests: guests.value.split(',').map((email) => email.trim()).filter(Boolean),
      },
    }),
  };
}

function updateFields(changes, calendars) {
  const nodes = [];
  const readers = [];
  if (changes.title !== undefined) {
    const title = text(changes.title);
    nodes.push(field('Title', title));
    readers.push(() => ({ title: title.value.trim() }));
  }
  if (changes.start !== undefined) {
    const when = whenFields(changes.start, changes.end);
    nodes.push(when.node);
    readers.push(when.read);
  }
  if (changes.calendar !== undefined) {
    const calendar = calendarPicker(changes.calendar, calendars);
    nodes.push(field('Calendar', calendar));
    readers.push(() => ({ calendar: calendar.value }));
  }
  if (changes.location !== undefined) {
    const location = text(changes.location);
    nodes.push(field('Location', location));
    readers.push(() => ({ location: location.value.trim() }));
  }
  if (changes.add_guests !== undefined) {
    const guests = text(changes.add_guests.join(', '), { dir: 'ltr', inputMode: 'email', autocapitalize: 'off' });
    nodes.push(field('Guests to add', guests));
    readers.push(() => ({ add_guests: guests.value.split(',').map((email) => email.trim()).filter(Boolean) }));
  }
  return { nodes, read: () => ({ changes: Object.assign({}, ...readers.map((reader) => reader())) }) };
}

function headline(item) {
  if (item.type === 'delete') return 'Delete ' + (item.title || 'this event');
  if (item.type === 'update') return 'Change ' + (item.title || 'this event');
  return item.title || 'New event';
}

function itemEditor(item, calendars) {
  const fields = item.type === 'create' ? createFields(item.event, calendars)
    : item.type === 'update' ? updateFields(item.changes, calendars)
      : { nodes: [], read: () => ({}) };

  let removed = false;
  const card = el('div', { class: 'edit-item glass' });
  const toggle = el('button', {
    class: 'link',
    type: 'button',
    onclick: () => {
      removed = !removed;
      card.classList.toggle('removed', removed);
      toggle.textContent = removed ? 'Undo' : 'Remove';
    },
  }, 'Remove');
  card.append(el('div', { class: 'edit-item-top' }, el('span', { class: 'edit-item-title', dir: 'auto' }, headline(item)), toggle), ...fields.nodes);
  return { node: card, read: () => (removed ? { skip: true } : fields.read()) };
}

export function openProposalEditor(pending, onConfirm) {
  const dialog = $('edit-dialog');
  const editors = pending.items.map((item) => itemEditor(item, pending.calendars));
  const confirm = el('button', {
    class: 'primary',
    type: 'button',
    onclick: () => {
      const edits = editors.map((editor) => editor.read());
      dialog.close();
      onConfirm(edits);
    },
  }, isHebrew(pending.summary) ? 'אישור' : 'Confirm');
  $('edit-body').replaceChildren(...editors.map((editor) => editor.node), confirm);
  $('edit-close').onclick = () => dialog.close();
  dialog.showModal();
}
