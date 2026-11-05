// Tests the assistant's rules on this computer with a fake Claude, so it costs nothing.
// Run: node scripts/test-agent.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Fake Google services.
const cacheStore = {};
let scripted = [];
const requests = [];
const calls = [];

Object.assign(globalThis, {
  TZ: 'Asia/Jerusalem',
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (name) => (name === 'ACCESS_TOKEN' ? storedToken : 'fake-key') }) },
  Utilities: { getUuid: () => 'abcdefgh-1234', sleep: () => {} },
  UrlFetchApp: {
    fetch(url, options) {
      const body = JSON.parse(options.payload);
      requests.push({ body, headers: options.headers });
      const next = scripted.shift();
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ usage: {}, ...next }) };
    },
  },
  getConfig: () => ({ calendars: [{ label: 'Personal', writable: true }, { label: 'Studio', writable: true }, { label: 'Read only', writable: false }], places: [{ name: 'Holmes', isStale: true }], colorRules: [], preferences: { dailyRequestCap: cap } }),
  getCurrentDatetime: () => ({ day: 'Thursday', date: '2026-11-05', time: '13:00', timezone: 'Asia/Jerusalem' }),
  appendLog_: () => {},
  resolveCalendar_: (label) => ({ label }),
  requireWritable_: () => {},
  parseToMs_: (value) => new Date(value).getTime(),
  splitEventId_: (id) => ({ calendar: { label: id.split(':')[0] } }),
  createEvent: (args) => { calls.push(['create', args.title, args.start]); return { id: args.calendar + ':new', calendar: args.calendar, title: args.title, start: args.start, end: args.end }; },
  updateEvent: (id) => { calls.push(['update', id]); return { id, calendar: 'Personal', title: 'x', start: 's', end: 'e' }; },
  deleteEvent: (id) => { calls.push(['delete', id]); return {}; },
  listEvents: () => [],
  findFreeSlots: () => ({ slots: [] }),
  getPlaces: () => [],
  savePlace: (fields) => { calls.push(['save_place', fields.name]); },
});

// Fake Sheet and web app services for api.gs.
let usageRows = [];
let cap = 2;
let storedToken = 'right-token';
Object.assign(globalThis, {
  CONFIG_TABS: {},
  GOOGLE_EVENT_COLORS: {},
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  getConfigSpreadsheet_: () => ({
    getSheetByName: () => ({
      getDataRange: () => ({ getDisplayValues: () => usageRows }),
      getLastRow: () => usageRows.length,
      getRange: (row, column, rows) => ({
        setValue: (value) => { usageRows[row - 1][column - 1] = value; },
        setValues: (values) => { usageRows[row - 1] = values[0]; },
      }),
    }),
  }),
});

const calendarSource = fs.readFileSync(path.join(__dirname, '../backend/calendar.gs'), 'utf8');
vm.runInThisContext(calendarSource.slice(calendarSource.indexOf('function guestRecord_'), calendarSource.indexOf('// Changes can include')));

['ai', 'session', 'tools', 'agent', 'api'].forEach((file) => {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../backend', file + '.gs'), 'utf8'));
});

const toolUse = (name, input, id = 't1') => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const event = { calendar: 'Personal', title: 'Gym', start: '2026-11-08T18:00:00', end: '2026-11-08T19:00:00' };
const lastToolResult = () => {
  const messages = requests[requests.length - 1].body.messages;
  return messages[messages.length - 1].content[0];
};
const post = (body) => doPost({ postData: { contents: JSON.stringify(body) } });
const chat = (extra = {}) => post({ token: 'right-token', action: 'chat', session: 's', message: 'Hi', ...extra });
const reset = () => { usageRows = [['date', 'request_count']]; cap = 2; storedToken = 'right-token'; scripted = []; requests.length = 0; calls.length = 0; Object.keys(cacheStore).forEach((k) => delete cacheStore[k]); };

const tests = {
  'creates at once when the owner named the calendar'() {
    scripted = [toolUse('create_event', { ...event, calendar_stated_by_user: true }), say('Added.')];
    const result = handleChat('s', 'Add gym to Personal');
    assert.deepStrictEqual(calls.map((c) => c[1]), ['Gym']);
    assert.strictEqual(result.pending, null);
  },
  'refuses to create when Claude chose the calendar'() {
    scripted = [toolUse('create_event', { ...event, calendar_stated_by_user: false }), say('Which calendar?')];
    handleChat('s', 'Add gym');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lastToolResult().is_error, true);
  },
  'refuses a second create in one request'() {
    scripted = [
      toolUse('create_event', { ...event, calendar_stated_by_user: true }),
      toolUse('create_event', { ...event, title: 'Gym 2', calendar_stated_by_user: true }),
      say('One done.'),
    ];
    handleChat('s', 'Add two');
    assert.deepStrictEqual(calls.map((c) => c[1]), ['Gym']);
  },
  'refuses to delete directly'() {
    scripted = [toolUse('delete_event', { event_id: 'Personal:1' }), say('Confirm?')];
    handleChat('s', 'Delete it');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lastToolResult().is_error, true);
  },
  'refuses to move directly but allows a rename'() {
    scripted = [
      toolUse('update_event', { event_id: 'Personal:1', changes: { start: '2026-11-08T21:00:00' } }),
      toolUse('update_event', { event_id: 'Personal:1', changes: { title: 'New name' } }, 't2'),
      say('Renamed.'),
    ];
    handleChat('s', 'Rename and move');
    assert.deepStrictEqual(calls, [['update', 'Personal:1']]);
  },
  'a proposal changes nothing until confirmed, and the button runs it with no AI call'() {
    scripted = [
      toolUse('propose_actions', { summary: 'Book 2', done_message: 'Booked.', actions: [{ type: 'create', event }, { type: 'create', event: { ...event, title: 'Gym 2' } }] }),
      say('Book these two?'),
    ];
    const proposed = handleChat('s', 'Two workouts');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(proposed.pending.summary, 'Book 2');
    const before = requests.length;
    const confirmed = confirmPending('s', proposed.pending.id);
    assert.strictEqual(requests.length, before);
    assert.strictEqual(confirmed.reply, 'Booked.');
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(confirmed.pending, null);
  },
  'a wrong confirmation id does nothing'() {
    scripted = [toolUse('propose_actions', { summary: 'Del', done_message: 'Gone.', actions: [{ type: 'delete', event_id: 'Personal:1' }] }), say('Sure?')];
    handleChat('s', 'Delete it');
    confirmPending('s', 'wrong');
    assert.deepStrictEqual(calls, []);
  },
  'typing yes in Hebrew confirms with no AI call'() {
    scripted = [toolUse('propose_actions', { summary: 'Del', done_message: 'נמחק.', actions: [{ type: 'delete', event_id: 'Personal:1' }] }), say('בטוח?')];
    handleChat('s', 'מחק');
    const before = requests.length;
    assert.strictEqual(handleChat('s', 'כן').reply, 'נמחק.');
    assert.strictEqual(requests.length, before);
    assert.deepStrictEqual(calls, [['delete', 'Personal:1']]);
  },
  'typing no cancels'() {
    scripted = [toolUse('propose_actions', { summary: 'Del', done_message: 'Gone.', actions: [{ type: 'delete', event_id: 'Personal:1' }] }), say('Sure?')];
    handleChat('s', 'Delete it');
    assert.strictEqual(handleChat('s', 'no').reply, 'Cancelled.');
    assert.deepStrictEqual(calls, []);
  },
  'yes with nothing waiting goes to Claude, not to an action'() {
    scripted = [say('Yes to what?')];
    assert.strictEqual(handleChat('s', 'yes').reply, 'Yes to what?');
    assert.deepStrictEqual(calls, []);
  },
  'save_place waits for confirmation'() {
    scripted = [toolUse('save_place', { name: 'Holmes' }), say('Save it?')];
    const result = handleChat('s', 'Save the gym');
    assert.deepStrictEqual(calls, []);
    confirmPending('s', result.pending.id);
    assert.deepStrictEqual(calls, [['save_place', 'Holmes']]);
  },
  'follow-ups see earlier turns and recent events'() {
    scripted = [toolUse('create_event', { ...event, calendar_stated_by_user: true }), say('Added.'), say('Ok.')];
    handleChat('s', 'Add gym to Personal');
    handleChat('s', 'move it');
    const messages = requests[requests.length - 1].body.messages;
    assert.strictEqual(messages.length, 3);
    assert.ok(messages[2].content.includes('id Personal:new'));
  },
  'one failed action is reported, the rest still run'() {
    scripted = [toolUse('propose_actions', { summary: 'Mix', done_message: 'Done.', actions: [{ type: 'delete', event_id: 'Personal:1' }, { type: 'delete', event_id: 'Personal:2' }] }), say('Sure?')];
    const proposed = handleChat('s', 'Delete both');
    const original = globalThis.deleteEvent;
    globalThis.deleteEvent = (id) => { if (id === 'Personal:1') throw new Error('Not found'); calls.push(['delete', id]); };
    const result = confirmPending('s', proposed.pending.id);
    globalThis.deleteEvent = original;
    assert.ok(result.reply.startsWith('1/2'));
    assert.deepStrictEqual(calls, [['delete', 'Personal:2']]);
  },
  'request format: cache marker, version header, fallback on Sonnet only'() {
    scripted = [say('Hi')];
    handleChat('s', 'When am I free next week?');
    const { body, headers } = requests[requests.length - 1];
    assert.deepStrictEqual(body.system[0].cache_control, { type: 'ephemeral' });
    assert.strictEqual(headers['anthropic-version'], '2026-10-21');
    assert.strictEqual(body.model, 'claude-sonnet-5-5');
    assert.strictEqual(body.fallbacks, 'default');
    assert.strictEqual(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.strictEqual(body.tools[body.tools.length - 1].type, 'web_search_20260318');
    assert.strictEqual(body.temperature, undefined);
    assert.strictEqual(body.tool_choice, undefined);
    assert.ok(!body.system[0].text.includes('2026'), 'nothing date-specific in the cached prompt');
  },
  'routing: planning and live info use Sonnet, simple requests use Haiku'() {
    ['This week I want to work out three times, evenings', 'When am I free for 2 hours next week?', 'Is the gym open on Sukkot?',
      'מתי אני פנוי בשבוע הבא?', 'אני רוצה שלושה אימונים השבוע', 'האם חדר הכושר פתוח בחג?'].forEach((text) => assert.strictEqual(pickTier_(text), 'complex', text));
    ['Add rehearsal to Studio tomorrow at 8pm', 'What does my Thursday look like?', 'Move the second one to 9',
      'תוסיף פגישה ליומן Personal מחר בשמונה', 'מה יש לי ביום ראשון?'].forEach((text) => assert.strictEqual(pickTier_(text), 'simple', text));
  },
  'the context lists saved places, so Claude needs no tool for them'() {
    scripted = [say('Ok')];
    handleChat('s', 'Hi');
    assert.ok(requests[0].body.messages[0].content.includes('Saved places: Holmes (stale)'));
  },
  'pause_turn resends without a new user message'() {
    scripted = [{ content: [{ type: 'text', text: 'Searching' }], stop_reason: 'pause_turn' }, say('Found it.')];
    assert.strictEqual(handleChat('s', 'Is it open?').reply, 'Found it.');
    const messages = requests[requests.length - 1].body.messages;
    assert.strictEqual(messages[messages.length - 1].role, 'assistant');
  },
  'the reply is only the words after the search'() {
    assert.strictEqual(aiFinalText_([
      { type: 'text', text: 'Let me check.' },
      { type: 'server_tool_use', id: 's', name: 'web_search', input: {} },
      { type: 'web_search_tool_result', tool_use_id: 's', content: [] },
      { type: 'text', text: 'It is ' },
      { type: 'text', text: 'open.' },
    ]), 'It is open.');
  },
  'inviting guests is refused directly and must be confirmed'() {
    scripted = [toolUse('create_event', { ...event, guests: ['a@b.co'], calendar_stated_by_user: true }), say('Confirm?')];
    handleChat('s', 'Add gym and invite a@b.co');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lastToolResult().is_error, true);
  },
  'changing guests is refused directly'() {
    scripted = [toolUse('update_event', { event_id: 'Personal:1', changes: { add_guests: ['a@b.co'] } }), say('Confirm?')];
    handleChat('s', 'Invite a@b.co');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lastToolResult().is_error, true);
  },
  'a proposal with a bad guest address is rejected'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'create', event: { ...event, guests: ['dana'] } }] }), say('Hm')];
    assert.strictEqual(handleChat('s', 'Invite Dana').pending, null);
    assert.ok(lastToolResult().content.includes('valid email'));
  },
  'guests go through once confirmed'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'Invited.', actions: [{ type: 'create', event: { ...event, guests: ['a@b.co'] } }] }), say('Sure?')];
    const proposed = handleChat('s', 'Invite a@b.co');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(confirmPending('s', proposed.pending.id).reply, 'Invited.');
    assert.strictEqual(calls.length, 1);
  },
  'attendee list keeps replies, skips duplicates, and removes'() {
    const current = [{ email: 'a@b.co', responseStatus: 'accepted' }, { email: 'x@y.co' }];
    const updated = updatedAttendees_(current, ['A@B.co', 'new@c.co'], ['x@y.co']);
    assert.deepStrictEqual(updated, [{ email: 'a@b.co', responseStatus: 'accepted' }, { email: 'new@c.co' }]);
  },
  'the app gets what it needs to edit a proposal, with writable calendars only'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'create', event }, { type: 'delete', event_id: 'Personal:1' }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Do it');
    assert.deepStrictEqual(pending.calendars, ['Personal', 'Studio']);
    assert.strictEqual(pending.items[0].event.title, 'Gym');
    assert.strictEqual(pending.items[1].type, 'delete');
  },
  'edits change the details before anything runs'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'Booked 2.', actions: [{ type: 'create', event }, { type: 'create', event: { ...event, title: 'Gym 2' } }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Two workouts');
    const result = confirmPending('s', pending.id, undefined, [{ event: { title: 'Yoga', start: '2026-11-08T17:00:00', end: '2026-11-08T18:00:00' } }, { skip: true }]);
    assert.deepStrictEqual(calls, [['create', 'Yoga', '2026-11-08T17:00:00']]);
    assert.strictEqual(result.reply, 'Done, with your changes.');
  },
  'edits can never change what an action does or which event it touches'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'update', event_id: 'Personal:1', changes: { start: '2026-11-08T18:00:00' } }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Move it');
    confirmPending('s', pending.id, undefined, [{ type: 'delete', event_id: 'Personal:999', changes: { start: '2026-11-08T19:00:00', reminders: [] } }]);
    assert.deepStrictEqual(calls, [['update', 'Personal:1']]);
  },
  'a bad edit changes nothing and leaves the proposal waiting'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'create', event }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Book');
    const bad = post({ token: 'right-token', action: 'confirm', session: 's', pendingId: pending.id, edits: [{ event: { end: '2026-11-08T10:00:00' } }] });
    assert.strictEqual(bad.error, 'server_error');
    assert.ok(bad.message.includes('after the start'));
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(post({ token: 'right-token', action: 'confirm', session: 's', pendingId: pending.id }).reply, 'D');
  },
  'a bad guest address in an edit is refused'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'create', event }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Book');
    assert.throws(() => confirmPending('s', pending.id, undefined, [{ event: { guests: ['not-an-email'] } }]), /valid email/);
    assert.deepStrictEqual(calls, []);
  },
  'removing every item leaves nothing to confirm'() {
    scripted = [toolUse('propose_actions', { summary: 'S', done_message: 'D', actions: [{ type: 'create', event }] }), say('Sure?')];
    const { pending } = handleChat('s', 'Book');
    assert.throws(() => confirmPending('s', pending.id, undefined, [{ skip: true }]), /Nothing is left/);
  },
  'a wrong token is rejected and does nothing'() {
    assert.deepStrictEqual(post({ token: 'wrong', action: 'chat', session: 's', message: 'Hi' }), { ok: false, error: 'unauthorized' });
    assert.strictEqual(requests.length, 0);
    assert.strictEqual(usageRows.length, 1);
  },
  'a missing token is rejected'() {
    assert.strictEqual(post({ action: 'getSettings' }).error, 'unauthorized');
  },
  'nothing is accepted if no token has been set up'() {
    storedToken = null;
    assert.strictEqual(post({ token: null, action: 'getSettings' }).error, 'unauthorized');
  },
  'broken JSON is rejected the same way'() {
    assert.strictEqual(doPost({ postData: { contents: 'not json' } }).error, 'unauthorized');
    assert.strictEqual(doPost({}).error, 'unauthorized');
  },
  'the daily cap stops requests, in the language used'() {
    scripted = [say('One'), say('Two')];
    assert.strictEqual(chat().reply, 'One');
    assert.strictEqual(chat().reply, 'Two');
    const blocked = chat();
    assert.strictEqual(blocked.error, 'daily_cap');
    assert.ok(blocked.message.includes('limit'));
    assert.ok(chat({ message: 'שלום' }).message.includes('מגבלת'));
    assert.deepStrictEqual(usageRows[1], ['2026-11-05', '2']);
  },
  'Confirm still works at the cap'() {
    cap = 1;
    scripted = [toolUse('propose_actions', { summary: 'Del', done_message: 'Gone.', actions: [{ type: 'delete', event_id: 'Personal:1' }] }), say('Sure?')];
    const proposed = chat();
    assert.strictEqual(chat().error, 'daily_cap');
    const confirmed = post({ token: 'right-token', action: 'confirm', session: 's', pendingId: proposed.pending.id });
    assert.strictEqual(confirmed.reply, 'Gone.');
  },
  'each Anthropic failure gets its own code'() {
    const cases = [
      [402, 'Billing problem', 'ai_no_credit'],
      [400, 'Your credit balance is too low', 'ai_no_credit'],
      [400, 'You have reached your specified workspace spend limit', 'ai_spend_limit'],
      [429, 'Monthly spend cap reached', 'ai_spend_limit'],
      [401, 'invalid x-api-key', 'ai_key_invalid'],
      [529, 'Overloaded', 'ai_busy'],
      [400, 'Some other problem', undefined],
    ];
    cases.forEach(([status, message, code]) => assert.strictEqual(aiError_(status, message).limitCode, code));
  },
  'an unknown action is a plain error, not a crash'() {
    assert.strictEqual(post({ token: 'right-token', action: 'nope' }).error, 'server_error');
  },
  'stops at the round limit'() {
    scripted = Array.from({ length: 12 }, (_, i) => toolUse('get_places', {}, 't' + i));
    assert.ok(handleChat('s', 'Loop').reply.includes('too long'));
  },
};

let failed = 0;
Object.keys(tests).forEach((name) => {
  reset();
  try {
    tests[name]();
    console.log('ok    ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL  ' + name + '\n      ' + error.message);
  }
});
console.log(`\n${Object.keys(tests).length - failed} of ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
