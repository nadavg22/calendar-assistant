// Calendar reads and writes through the Calendar advanced service.
// Event IDs handed to Claude look like 'Studio:abc123', because Google needs the calendar too.

const MAX_REMINDERS = 5;

function getCurrentDatetime() {
  const now = new Date();
  return {
    iso: formatLocal_(now.getTime()),
    date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    time: Utilities.formatDate(now, TZ, 'HH:mm'),
    day: Utilities.formatDate(now, TZ, 'EEEE'),
    timezone: TZ,
  };
}

function formatLocal_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function isDateOnly_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

// Turns a date or date-time into milliseconds. Times with no offset are Israel time.
function parseToMs_(value) {
  const text = String(value).trim();
  if (isDateOnly_(text)) return localMs_(text, 0);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = new Date(text).getTime();
    if (isNaN(ms)) throw new Error('Bad date: ' + value);
    return ms;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (!match) throw new Error('Bad date: ' + value);
  return localMs_(match[1], Number(match[2]) * 60 + Number(match[3]));
}

// A date-only range end means the whole of that day is included.
function parseRangeEnd_(value) {
  return isDateOnly_(value) ? localMs_(addDays_(value, 1), 0) : parseToMs_(value);
}

// Milliseconds for a local date plus minutes after midnight. 1440 is the next midnight.
function localMs_(date, minutes) {
  if (minutes >= 1440) return localMs_(addDays_(date, 1), minutes - 1440);
  const clock = ('0' + Math.floor(minutes / 60)).slice(-2) + ':' + ('0' + (minutes % 60)).slice(-2);
  return Utilities.parseDate(date + ' ' + clock, TZ, 'yyyy-MM-dd HH:mm').getTime();
}

function addDays_(date, days) {
  // Noon keeps the sum on the right date across daylight saving changes.
  const noon = Utilities.parseDate(date + ' 12:00', TZ, 'yyyy-MM-dd HH:mm').getTime();
  return Utilities.formatDate(new Date(noon + days * 86400000), TZ, 'yyyy-MM-dd');
}

function resolveCalendar_(label) {
  const calendars = getConfig().calendars;
  const wanted = String(label).trim().toLowerCase();
  const match = calendars.filter(function (c) { return c.label.toLowerCase() === wanted; })[0];
  if (match) return match;
  throw new Error('Unknown calendar "' + label + '". Calendars: ' +
    calendars.map(function (c) { return c.label; }).join(', '));
}

function requireWritable_(calendar) {
  if (!calendar.writable) throw new Error('The assistant may not write to ' + calendar.label + '.');
}

function makeEventId_(calendar, googleId) {
  return calendar.label + ':' + googleId;
}

function splitEventId_(eventId) {
  const index = String(eventId).indexOf(':');
  if (index < 0) throw new Error('Bad event id: ' + eventId);
  return { calendar: resolveCalendar_(eventId.slice(0, index)), googleId: eventId.slice(index + 1) };
}

function summarizeEvent_(calendar, event) {
  return {
    id: makeEventId_(calendar, event.id),
    calendar: calendar.label,
    title: event.summary || '(no title)',
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    allDay: !event.start.dateTime,
    location: event.location || '',
    busy: event.transparency !== 'transparent',
    colorId: event.colorId || '',
    guests: (event.attendees || []).map(function (a) { return a.email; }),
  };
}

function listEvents(start, end, calendarLabels) {
  const calendars = calendarLabels && calendarLabels.length
    ? calendarLabels.map(resolveCalendar_)
    : getConfig().calendars;
  const timeMin = new Date(parseToMs_(start)).toISOString();
  const timeMax = new Date(parseRangeEnd_(end)).toISOString();

  const events = [];
  calendars.forEach(function (calendar) {
    const response = Calendar.Events.list(calendar.id, {
      timeMin: timeMin, timeMax: timeMax, timeZone: TZ,
      singleEvents: true, orderBy: 'startTime', maxResults: 250,
    });
    (response.items || []).forEach(function (event) {
      if (event.status !== 'cancelled') events.push(summarizeEvent_(calendar, event));
    });
  });
  return events.sort(function (a, b) { return parseToMs_(a.start) - parseToMs_(b.start); });
}

// First matching rule wins, then the calendar's default color.
function pickColorId_(category, title, calendar) {
  const text = (String(category || '') + ' ' + String(title || '')).toLowerCase();
  const rule = getConfig().colorRules.filter(function (r) {
    return r.keyword && text.indexOf(r.keyword.toLowerCase()) >= 0;
  })[0];
  const color = rule ? rule.color : calendar.defaultColor;
  return GOOGLE_EVENT_COLORS[color] || null;
}

// A reminder list from the request wins, then the calendar's, then the global default.
function pickReminders_(requested, calendar) {
  const reminders = requested || calendar.defaultReminders || getConfig().preferences.defaultReminders;
  return { useDefault: false, overrides: reminders.slice(0, MAX_REMINDERS) };
}

function eventTime_(value) {
  return isDateOnly_(value) ? { date: value } : { dateTime: formatLocal_(parseToMs_(value)), timeZone: TZ };
}

function createEvent(args) {
  const calendar = resolveCalendar_(args.calendar);
  requireWritable_(calendar);
  if (parseToMs_(args.end) <= parseToMs_(args.start)) throw new Error('The end must be after the start.');

  const resource = {
    summary: args.title,
    start: eventTime_(args.start),
    end: eventTime_(args.end),
    reminders: pickReminders_(args.reminders, calendar),
  };
  if (args.location) resource.location = args.location;
  if (args.description) resource.description = args.description;
  const colorId = pickColorId_(args.category, args.title, calendar);
  if (colorId) resource.colorId = colorId;
  if (args.guests && args.guests.length) resource.attendees = args.guests.map(guestRecord_);

  const options = resource.attendees ? { sendUpdates: 'all' } : {};
  return summarizeEvent_(calendar, Calendar.Events.insert(resource, calendar.id, options));
}

function guestRecord_(email) {
  return { email: String(email).trim() };
}

// The attendee list after adding and removing guests, keeping everyone's existing replies.
function updatedAttendees_(current, addGuests, removeGuests) {
  const removed = (removeGuests || []).map(function (email) { return String(email).trim().toLowerCase(); });
  const kept = (current || []).filter(function (a) { return removed.indexOf(a.email.toLowerCase()) < 0; });
  const known = kept.map(function (a) { return a.email.toLowerCase(); });
  const added = (addGuests || []).filter(function (email) {
    return known.indexOf(String(email).trim().toLowerCase()) < 0;
  });
  return kept.concat(added.map(guestRecord_));
}

// Changes can include title, start, end, location, description, category, reminders, calendar,
// add_guests and remove_guests.
// A new start with no new end keeps the event's length.
function updateEvent(eventId, changes) {
  const target = splitEventId_(eventId);
  let calendar = target.calendar;
  let googleId = target.googleId;
  requireWritable_(calendar);

  const current = Calendar.Events.get(calendar.id, googleId);
  const resource = {};
  if (changes.title !== undefined) resource.summary = changes.title;
  if (changes.location !== undefined) resource.location = changes.location;
  if (changes.description !== undefined) resource.description = changes.description;
  if (changes.start !== undefined) {
    resource.start = eventTime_(changes.start);
    resource.end = eventTime_(changes.end !== undefined ? changes.end : shiftedEnd_(current, changes.start));
  } else if (changes.end !== undefined) {
    resource.end = eventTime_(changes.end);
  }
  if (changes.reminders !== undefined) resource.reminders = pickReminders_(changes.reminders, calendar);
  if (changes.category !== undefined) {
    const colorId = pickColorId_(changes.category, changes.title || current.summary, calendar);
    if (colorId) resource.colorId = colorId;
  }

  if (changes.calendar !== undefined) {
    const destination = resolveCalendar_(changes.calendar);
    requireWritable_(destination);
    if (destination.id !== calendar.id) {
      googleId = Calendar.Events.move(calendar.id, googleId, destination.id).id;
      calendar = destination;
    }
  }
  if (changes.add_guests !== undefined || changes.remove_guests !== undefined) {
    resource.attendees = updatedAttendees_(current.attendees, changes.add_guests, changes.remove_guests);
  }
  // Guests hear about changes to an event they were invited to.
  const hasGuests = (current.attendees || []).length > 0 || (resource.attendees || []).length > 0;
  const updated = Object.keys(resource).length
    ? Calendar.Events.patch(resource, calendar.id, googleId, hasGuests ? { sendUpdates: 'all' } : {})
    : Calendar.Events.get(calendar.id, googleId);
  return summarizeEvent_(calendar, updated);
}

function shiftedEnd_(event, newStart) {
  const oldStart = parseToMs_(event.start.dateTime || event.start.date);
  const oldEnd = parseToMs_(event.end.dateTime || event.end.date);
  if (isDateOnly_(newStart)) return addDays_(newStart, Math.round((oldEnd - oldStart) / 86400000));
  return formatLocal_(parseToMs_(newStart) + (oldEnd - oldStart));
}

function deleteEvent(eventId) {
  const target = splitEventId_(eventId);
  requireWritable_(target.calendar);
  const event = Calendar.Events.get(target.calendar.id, target.googleId);
  const options = (event.attendees || []).length > 0 ? { sendUpdates: 'all' } : {};
  Calendar.Events.remove(target.calendar.id, target.googleId, options);
  return { deleted: event.summary || '(no title)', calendar: target.calendar.label };
}
