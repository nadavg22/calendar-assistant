// Test functions to run from the Apps Script editor. Results appear in the Execution log.

// calendarRow is the calendar's position in the Calendars tab, so renaming a label is safe.
const TEST_EVENTS = [
  { calendarRow: 0, title: 'TEST workout', category: 'workout', hour: 12 },
  { calendarRow: 1, title: 'TEST studio session', category: 'studio', hour: 13 },
  { calendarRow: 2, title: 'TEST rehearsal', category: 'rehearsal', hour: 14 },
];

function testConfig() {
  clearConfigCache();
  const config = getConfig();
  config.calendars.forEach(function (c) {
    Logger.log('Calendar: %s | counts for free time: %s | writable: %s', c.label, c.includeInFreeTime, c.writable);
  });
  config.places.forEach(function (p) {
    Logger.log('Place: %s | aliases: %s | Friday: %s | Saturday: %s', p.name, p.aliases.join(', '), p.hoursText[5], p.hoursText[6]);
  });
  Logger.log('Default reminders: %s', JSON.stringify(config.preferences.defaultReminders));
  Logger.log('Now: %s', JSON.stringify(getCurrentDatetime()));
}

function testListEvents() {
  const today = getCurrentDatetime().date;
  const events = listEvents(today, addDays_(today, 6));
  Logger.log('%s events in the next 7 days:', events.length);
  events.forEach(function (e) {
    Logger.log('%s | %s | %s%s', e.calendar, e.start, e.title, e.busy ? '' : ' (marked Free)');
  });
}

function testFindSlots() {
  const today = getCurrentDatetime().date;
  const result = findFreeSlots({
    start: today,
    end: addDays_(today, 6),
    time_window: 'evening',
    place_name: 'gym',
    count: 3,
    spread_across_days: true,
  });
  Logger.log('Asked for %s slots, %s minutes each, %s minutes travel either side:',
    result.requested, result.duration_minutes, result.travel_buffer_minutes);
  result.slots.forEach(function (s) { Logger.log('%s | %s to %s', s.day, s.start, s.end); });
}

// Creates one event on each calendar for tomorrow. Check them in Google Calendar,
// then run testDeleteEvents to remove them.
function testCreateEvents() {
  const tomorrow = addDays_(getCurrentDatetime().date, 1);
  const calendars = getConfig().calendars;
  TEST_EVENTS.forEach(function (sample) {
    const start = localMs_(tomorrow, sample.hour * 60);
    const event = createEvent({
      calendar: calendars[sample.calendarRow].label,
      title: sample.title,
      category: sample.category,
      start: formatLocal_(start),
      end: formatLocal_(start + 3600000),
    });
    const target = splitEventId_(event.id);
    const saved = Calendar.Events.get(target.calendar.id, target.googleId);
    Logger.log('%s | %s | %s | color id: %s | reminders: %s',
      event.calendar, event.title, event.start, saved.colorId, JSON.stringify(saved.reminders));
  });
}

// Finds events whose title starts with TEST, so it also cleans up after a failed test.
function testDeleteEvents() {
  const today = getCurrentDatetime().date;
  const events = listEvents(today, addDays_(today, 2)).filter(function (e) { return e.title.indexOf('TEST') === 0; });
  if (events.length === 0) Logger.log('No test events to delete.');
  events.forEach(function (e) { Logger.log(JSON.stringify(deleteEvent(e.id))); });
}

function newTestSession_() {
  return 'test-' + Date.now();
}

function askAndLog_(sessionId, text) {
  Logger.log('YOU: %s', text);
  const result = handleChat(sessionId, text);
  Logger.log('ASSISTANT: %s', result.reply);
  if (result.pending) Logger.log('WAITING FOR CONFIRM: %s', result.pending.summary);
  if (result.usage) {
    Logger.log('[%s model, %s rounds, %s new input, %s from cache, %s written to cache, %s output, %s searches]',
      result.tier, result.rounds, result.usage.input, result.usage.cacheRead, result.usage.cacheWrite,
      result.usage.output, result.usage.searches);
  }
  return result;
}

function testAi1Questions() {
  const session = newTestSession_();
  askAndLog_(session, 'What does my Thursday look like?');
  askAndLog_(newTestSession_(), 'מה יש לי ביום ראשון?');
  askAndLog_(session, 'When am I free for 2 hours next week?');
}

function testAi2CreateAndMove() {
  const session = newTestSession_();
  askAndLog_(session, 'Add TEST dentist to my Personal calendar tomorrow at 15:00 for 30 minutes');
  askAndLog_(session, 'Move it to 16:00');
  askAndLog_(session, 'yes');
  askAndLog_(newTestSession_(), 'תוסיף ליומן Personal אירוע בשם TEST אימון מחר ב-18:00 לשעה');
}

function testAi3CalendarChoice() {
  const first = newTestSession_();
  askAndLog_(first, 'Add TEST band rehearsal tomorrow at 20:00 for 3 hours');
  askAndLog_(first, 'cancel');
  const second = newTestSession_();
  askAndLog_(second, 'Add TEST lunch tomorrow at 13:00');
  askAndLog_(second, 'cancel');
}

function testAi4Workouts() {
  const session = newTestSession_();
  askAndLog_(session, 'Next week I want to work out three times at the gym, evenings');
  askAndLog_(session, 'cancel');
}

function testAi5WebSearch() {
  askAndLog_(newTestSession_(), 'What are the opening hours of the Israel Museum in Jerusalem?');
}
