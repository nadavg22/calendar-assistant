// The Settings screen. Each section saves on its own.
import { call, el, foldSection, getConnection, load, save, setConnection } from './api.js';

const COLORS = {
  Lavender: '#7986CB', Sage: '#33B679', Grape: '#8E24AA', Flamingo: '#E67C73', Banana: '#F6BF26', Tangerine: '#F4511E',
  Peacock: '#039BE5', Graphite: '#616161', Blueberry: '#3F51B5', Basil: '#0B8043', Tomato: '#D50000',
};
const DAYS = [
  ['hours_sun', 'Sunday'], ['hours_mon', 'Monday'], ['hours_tue', 'Tuesday'], ['hours_wed', 'Wednesday'],
  ['hours_thu', 'Thursday'], ['hours_fri', 'Friday'], ['hours_sat', 'Saturday'],
];
const HOURS_PATTERN = /^(closed|\d{1,2}:\d{2}-\d{1,2}:\d{2}(\s*,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*)?$/i;

const SETTINGS_KEY = 'settings';

const $ = (id) => document.getElementById(id);
let swatchGroup = 0;
let nav = null;
let settings = null;

function field(labelText, control, hint) {
  return el('label', {}, labelText, control, hint ? el('small', {}, hint) : null);
}

function textInput(value, props = {}) {
  return el('input', { type: 'text', value: value ?? '', dir: 'auto', autocomplete: 'off', ...props });
}

function toggle(labelText, checked) {
  const input = el('input', { type: 'checkbox', checked });
  return { input, node: el('label', { class: 'toggle' }, el('span', {}, labelText), input, el('i', { 'aria-hidden': 'true' })) };
}

function section(title, ...content) {
  const body = el('div', { class: 'section-body' }, ...content);
  const fold = el('div', { class: 'fold', inert: true }, body);
  const card = el('section', { class: 'section glass' });
  const header = el('button', {
    class: 'section-header',
    type: 'button',
    onclick: () => foldSection(card, fold, body, !card.classList.contains('open')),
  }, title);
  card.append(header, fold);
  return card;
}

// A save button with a status line that handles the wait and any error.
function saveRow(onSave, label = 'Save') {
  const status = el('span', { class: 'status', role: 'status' });
  const button = el('button', {
    class: 'primary',
    type: 'button',
    onclick: async () => {
      button.disabled = true;
      status.textContent = 'Saving...';
      try {
        await onSave();
        status.textContent = 'Saved';
        fetchSettings().then((latest) => {
          if (latest) settings = latest;
        });
      } catch (error) {
        status.textContent = '';
        nav.handleError(error);
      } finally {
        button.disabled = false;
      }
    },
  }, label);
  return el('div', { class: 'save-row' }, button, status);
}

function swatchPicker(selected, allowNone) {
  const name = 'swatch-' + (swatchGroup += 1);
  const options = (allowNone ? [''] : []).concat(Object.keys(COLORS));
  const inputs = [];
  const node = el('div', { class: 'swatches', role: 'radiogroup' }, ...options.map((color) => {
    const input = el('input', { type: 'radio', name, value: color, checked: color === (selected || (allowNone ? '' : 'Basil')) });
    inputs.push(input);
    const chip = el('i', { 'aria-hidden': 'true' });
    if (color) chip.style.background = COLORS[color];
    else chip.className = 'none';
    return el('label', { class: 'swatch', title: color || 'None', 'aria-label': color || 'None' }, input, chip);
  }));
  return { node, value: () => inputs.find((input) => input.checked)?.value || '' };
}

function parseReminders(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value || value === 'none') return [];
  return value.split(',').map((part) => {
    const [method, minutes] = part.trim().split(':');
    return { method, minutes };
  });
}

// Editor for a list of reminders. value() gives the Sheet's text format.
function reminderEditor(text, emptyValue, emptyHint) {
  const list = el('div', { class: 'rows' });
  const hint = el('small', {}, emptyHint);
  const refresh = () => { hint.hidden = list.children.length > 0; };
  const addRow = (reminder) => {
    const method = el('select', { 'aria-label': 'Type' },
      el('option', { value: 'popup', selected: reminder.method === 'popup' }, 'Popup'),
      el('option', { value: 'email', selected: reminder.method === 'email' }, 'Email'));
    const minutes = el('input', { type: 'number', min: 0, max: 40320, inputMode: 'numeric', value: reminder.minutes, 'aria-label': 'Minutes before' });
    const row = el('div', { class: 'row' }, method, minutes, el('span', { class: 'unit' }, 'min before'),
      el('button', { class: 'remove', type: 'button', 'aria-label': 'Remove', onclick: () => { row.remove(); refresh(); } }, '×'));
    row.read = () => method.value + ':' + (Number(minutes.value) || 0);
    list.append(row);
    refresh();
  };
  parseReminders(text).forEach(addRow);
  refresh();
  return {
    node: el('div', { class: 'reminders' }, list, hint, el('button', { class: 'outline small', type: 'button', onclick: () => addRow({ method: 'popup', minutes: 30 }) }, 'Add reminder')),
    value: () => [...list.children].map((row) => row.read()).join(',') || emptyValue,
  };
}

function calendarsSection() {
  const editors = settings.calendars.map((calendar) => {
    const label = textInput(calendar.label);
    const hints = el('textarea', { rows: 2, dir: 'auto', value: calendar.routing_hints });
    const free = toggle('Counts when finding free time', calendar.include_in_free_time);
    const writable = toggle('Assistant may write to it', calendar.writable);
    const color = swatchPicker(calendar.default_color, true);
    const reminders = reminderEditor(calendar.default_reminders, '', 'Uses the global default.');
    return {
      node: el('fieldset', {}, field('Label', label), free.node, writable.node, field('Routing hints', hints),
        el('div', { class: 'field' }, el('span', {}, 'Default color'), color.node),
        el('div', { class: 'field' }, el('span', {}, 'Reminders'), reminders.node)),
      read: () => ({
        row: calendar.row,
        label: label.value,
        include_in_free_time: free.input.checked,
        writable: writable.input.checked,
        routing_hints: hints.value,
        default_color: color.value(),
        default_reminders: reminders.value(),
      }),
    };
  });
  return section('Calendars', ...editors.map((editor) => editor.node),
    saveRow(() => call('saveCalendars', { calendars: editors.map((editor) => editor.read()) })));
}

function colorsSection() {
  const list = el('div', { class: 'rows' });
  const addRow = (rule) => {
    const keyword = textInput(rule.category_or_keyword, { placeholder: 'workout', 'aria-label': 'Category or keyword' });
    const color = swatchPicker(rule.color, false);
    const row = el('div', { class: 'rule' }, el('div', { class: 'row' }, keyword,
      el('button', { class: 'remove', type: 'button', 'aria-label': 'Remove', onclick: () => row.remove() }, '×')), color.node);
    row.read = () => ({ category_or_keyword: keyword.value, color: color.value() });
    list.append(row);
  };
  settings.colorRules.forEach(addRow);
  return section('Colors', list,
    el('button', { class: 'outline small', type: 'button', onclick: () => addRow({ category_or_keyword: '', color: 'Basil' }) }, 'Add rule'),
    saveRow(() => call('saveColorRules', { rules: [...list.children].map((row) => row.read()) })));
}

function preferenceMap() {
  return Object.fromEntries(settings.preferences.map((row) => [row.key, row.value]));
}

function notificationsSection() {
  const reminders = reminderEditor(preferenceMap().default_reminders, 'none', 'No reminders.');
  return section('Notifications', reminders.node, saveRow(async () => {
    await call('savePreferences', { preferences: { ...preferenceMap(), default_reminders: reminders.value() } });
    settings.preferences.find((row) => row.key === 'default_reminders').value = reminders.value();
  }));
}

function timeInput(value) {
  return el('input', { type: 'time', value: value.padStart(5, '0') });
}

function preferencesSection() {
  const prefs = preferenceMap();
  const windows = ['morning', 'afternoon', 'evening'].map((name) => {
    const [start, end] = prefs['window_' + name].split('-');
    const from = timeInput(start);
    const to = timeInput(end);
    return {
      key: 'window_' + name,
      node: el('div', { class: 'field' }, el('span', {}, name[0].toUpperCase() + name.slice(1)), el('div', { class: 'row' }, from, el('span', { class: 'unit' }, 'to'), to)),
      value: () => from.value + '-' + to.value,
    };
  });
  const length = el('input', { type: 'number', min: 5, inputMode: 'numeric', value: prefs.default_event_minutes });
  const earliest = timeInput(prefs.earliest_time);
  const latest = timeInput(prefs.latest_time);
  const cap = el('input', { type: 'number', min: 1, inputMode: 'numeric', value: prefs.daily_request_cap });

  return section('Preferences', ...windows.map((w) => w.node),
    field('Default event length, in minutes', length), field('Earliest time', earliest), field('Latest time', latest),
    field('Daily request cap', cap),
    saveRow(async () => {
      const updated = {
        ...preferenceMap(),
        ...Object.fromEntries(windows.map((w) => [w.key, w.value()])),
        default_event_minutes: length.value,
        earliest_time: earliest.value,
        latest_time: latest.value,
        daily_request_cap: cap.value,
      };
      await call('savePreferences', { preferences: updated });
      settings.preferences.forEach((row) => { row.value = updated[row.key]; });
    }));
}

function placesSection() {
  const list = el('div', { class: 'place-list' });
  const refresh = () => {
    list.replaceChildren(...settings.places.map((place) => el('button', {
      class: 'place',
      type: 'button',
      onclick: () => openPlace(place, refresh),
    }, el('span', { dir: 'auto' }, place.name), el('small', { dir: 'auto' }, place.address))));
  };
  refresh();
  return section('Places', list,
    el('button', { class: 'outline small', type: 'button', onclick: () => openPlace(null, refresh) }, 'Add place'));
}

function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function openPlace(place, onChange) {
  const data = place || {};
  const inputs = {
    name: textInput(data.name),
    aliases: textInput(data.aliases),
    address: textInput(data.address),
    default_duration: el('input', { type: 'number', min: 5, inputMode: 'numeric', value: data.default_duration ?? '' }),
    travel_buffer_minutes: el('input', { type: 'number', min: 0, inputMode: 'numeric', value: data.travel_buffer_minutes ?? '' }),
  };
  DAYS.forEach(([key]) => {
    inputs[key] = textInput(data[key], { dir: 'ltr', placeholder: '06:00-22:00 or closed' });
  });
  let source = data.source || 'manual';

  const lookupStatus = el('p', { class: 'status', role: 'status' });
  const lookup = el('button', {
    class: 'outline',
    type: 'button',
    onclick: async () => {
      if (!inputs.name.value.trim()) {
        lookupStatus.textContent = 'Type the place\'s name first.';
        return;
      }
      lookup.disabled = true;
      lookupStatus.textContent = 'Searching the web...';
      try {
        const { draft } = await call('autofillPlace', { query: inputs.name.value + ' ' + inputs.address.value });
        Object.keys(inputs).forEach((key) => {
          if (key !== 'name' && draft[key] !== undefined && draft[key] !== '') inputs[key].value = draft[key];
        });
        source = draft.source || 'web';
        lookupStatus.textContent = 'Found online and may be wrong. Please review before saving.';
      } catch (error) {
        lookupStatus.textContent = '';
        nav.handleError(error);
      } finally {
        lookup.disabled = false;
      }
    },
  }, 'Auto-fill from web');

  const savePlace = async () => {
    const fields = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
    if (!fields.name) throw new Error('A place needs a name.');
    const badDay = DAYS.find(([key]) => !HOURS_PATTERN.test(fields[key]));
    if (badDay) throw new Error(badDay[1] + ': use a format like 06:00-22:00, or closed.');
    const updated = { ...fields, last_verified: today(), source };
    await call('savePlace', { place: updated });
    if (place && place.name !== fields.name) await call('deletePlace', { name: place.name });
    if (place) settings.places.splice(settings.places.indexOf(place), 1, updated);
    else settings.places.push(updated);
    onChange();
    $('place-dialog').close();
  };

  const remove = place ? el('button', {
    class: 'outline danger',
    type: 'button',
    onclick: async () => {
      if (!window.confirm('Delete ' + place.name + '?')) return;
      try {
        await call('deletePlace', { name: place.name });
        settings.places.splice(settings.places.indexOf(place), 1);
        onChange();
        $('place-dialog').close();
      } catch (error) {
        nav.handleError(error);
      }
    },
  }, 'Delete place') : null;

  $('place-title').textContent = place ? 'Edit place' : 'New place';
  $('place-body').replaceChildren(el('div', { class: 'section-body' },
    field('Name', inputs.name), lookup, lookupStatus,
    field('Other names', inputs.aliases, 'Comma-separated, including Hebrew.'),
    field('Address', inputs.address),
    ...DAYS.map(([key, day]) => field(day, inputs[key])),
    field('Usual visit, in minutes', inputs.default_duration),
    field('Travel time each way, in minutes', inputs.travel_buffer_minutes),
    data.last_verified ? el('small', {}, 'Last checked ' + data.last_verified) : null,
    saveRow(savePlace), remove));
  $('place-dialog').showModal();
}

function securitySection() {
  const result = el('p', { class: 'status', role: 'status' });
  const rotate = el('button', {
    class: 'outline',
    type: 'button',
    onclick: async () => {
      if (!window.confirm('Replace the access token? The old one stops working right away.')) return;
      rotate.disabled = true;
      try {
        const { token } = await call('rotateToken');
        setConnection({ ...getConnection(), token });
        result.textContent = 'New token saved on this phone.';
        const show = el('code', { dir: 'ltr' }, token);
        result.after(show);
      } catch (error) {
        nav.handleError(error);
      } finally {
        rotate.disabled = false;
      }
    },
  }, 'Rotate token');
  return section('Security', rotate, result,
    el('button', {
      class: 'outline danger',
      type: 'button',
      onclick: () => { if (window.confirm('Forget the token on this phone?')) nav.signOut(); },
    }, 'Disconnect this phone'));
}

let renderedData = null;

// Rebuilds the screen only if the data changed, so opening Settings normally builds nothing.
function renderSettings(data) {
  const json = JSON.stringify(data);
  if (json === renderedData) return;
  settings = data;
  renderedData = json;
  $('settings-body').replaceChildren(placesSection(), calendarsSection(), colorsSection(), notificationsSection(), preferencesSection(), securitySection());
}

// Saves the latest settings on the phone, so the screen can open with no wait.
export async function fetchSettings() {
  const latest = await call('getSettings').catch(() => null);
  if (!latest) return null;
  save(SETTINGS_KEY, latest);
  return latest;
}

// Builds the Settings screen in the background while the chat is showing.
export async function prepareSettings(navigation) {
  nav = navigation;
  $('close-settings').onclick = () => nav.showChat();
  $('place-close').onclick = () => $('place-dialog').close();
  const saved = load(SETTINGS_KEY);
  if (saved) renderSettings(saved);
  const latest = await fetchSettings();
  if (latest && !isInUse()) renderSettings(latest);
}

function isInUse() {
  return Boolean($('settings-body').querySelector('.section.open')) || $('place-dialog').open;
}

export async function openSettings() {
  if (!settings) $('settings-body').replaceChildren(el('p', { class: 'status pad' }, 'Loading...'));
  nav.showView('settings-view');

  // A fresh copy loads behind the scenes, and never replaces a section you have open.
  const latest = await fetchSettings();
  if (latest && !isInUse()) {
    renderSettings(latest);
  } else if (!latest && !settings) {
    nav.showChat();
    nav.handleError(new Error('Can\'t reach the assistant. Check your connection and try again.'));
  }
}
