// The web app. Every request is a POST of JSON sent as text/plain, and must carry the access token.
// Apps Script can't set HTTP status codes, so results and errors are both in the JSON body.

const MAX_MESSAGE_LENGTH = 2000;
const REJECT_DELAY_MS = 1000;

const LIMIT_MESSAGES = {
  daily_cap: {
    en: 'You\'ve reached today\'s request limit. It resets at midnight, or you can raise it in Settings.',
    he: 'הגעת למגבלת הבקשות היומית. היא מתאפסת בחצות, ואפשר להגדיל אותה בהגדרות.',
  },
  ai_spend_limit: {
    en: 'The AI is paused because the monthly spend limit was reached. You can raise it in the Claude Console.',
    he: 'ה-AI מושהה כי הגעת למגבלת ההוצאה החודשית. אפשר להגדיל אותה ב-Claude Console.',
  },
  ai_no_credit: {
    en: 'The AI is paused because your API credit ran out. You can add credit in the Claude Console.',
    he: 'ה-AI מושהה כי נגמר הקרדיט. אפשר להוסיף קרדיט ב-Claude Console.',
  },
  ai_key_invalid: {
    en: 'The AI is paused because the API key was rejected. Check it in Script Properties.',
    he: 'ה-AI מושהה כי מפתח ה-API נדחה. בדוק אותו ב-Script Properties.',
  },
  ai_busy: {
    en: 'The AI is busy right now. Please try again in a minute.',
    he: 'ה-AI עמוס כרגע. נסה שוב בעוד דקה.',
  },
};

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function rejected_() {
  Utilities.sleep(REJECT_DELAY_MS + Math.floor(Math.random() * 500));
  return jsonResponse_({ ok: false, error: 'unauthorized' });
}

function doGet() {
  return rejected_();
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return rejected_();
  }

  const expected = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
  if (!expected || body.token !== expected) return rejected_();

  try {
    return jsonResponse_(Object.assign({ ok: true }, routeAction_(body)));
  } catch (error) {
    if (error.limitCode) {
      const language = isHebrew_(body.message) ? 'he' : 'en';
      return jsonResponse_({ ok: false, error: error.limitCode, message: LIMIT_MESSAGES[error.limitCode][language] });
    }
    return jsonResponse_({ ok: false, error: 'server_error', message: error.message });
  }
}

function routeAction_(body) {
  switch (body.action) {
    case 'chat': return actionChat_(body);
    case 'confirm': return confirmPending(requireSession_(body), body.pendingId, undefined, body.edits);
    case 'cancel': return cancelPending(requireSession_(body), body.pendingId);
    case 'getWeek': return getWeek_(body.offset);
    case 'getSettings': return getSettings_();
    case 'saveCalendars': return saveCalendars_(body.calendars);
    case 'saveColorRules': return saveColorRules_(body.rules);
    case 'savePreferences': return savePreferences_(body.preferences);
    case 'savePlace': return savePlace(body.place);
    case 'deletePlace': return deletePlace_(body.name);
    case 'autofillPlace': return actionAutofillPlace_(body);
    case 'rotateToken': return { token: rotateAccessToken_() };
    default: throw new Error('Unknown action.');
  }
}

function requireSession_(body) {
  const session = String(body.session || '');
  if (!/^[\w-]{1,64}$/.test(session)) throw new Error('Bad session.');
  return session;
}

function actionChat_(body) {
  const message = String(body.message || '').trim();
  if (!message) throw new Error('Empty message.');
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error('That message is too long.');
  const session = requireSession_(body);
  countRequest_();
  return handleChat(session, message);
}

function actionAutofillPlace_(body) {
  countRequest_();
  return { draft: lookupPlace(String(body.query || '')) };
}

// One Sunday-to-Saturday week for the calendar preview. offset 0 is this week. Uses no AI.
function getWeek_(offset) {
  const today = getCurrentDatetime().date;
  const weekday = Number(Utilities.formatDate(new Date(localMs_(today, 720)), TZ, 'u')) % 7;
  const sunday = addDays_(today, 7 * (Number(offset) || 0) - weekday);
  const days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays_(sunday, i); });
  const events = listEvents(sunday, days[6]).map(function (e) {
    return { title: e.title, calendar: e.calendar, start: e.start, end: e.end, allDay: e.allDay, colorId: e.colorId };
  });
  return { today: today, days: days, events: events };
}

// Adds one to today's count, or stops the request if the cap is reached.
function countRequest_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getConfigSpreadsheet_().getSheetByName('Usage');
    const today = getCurrentDatetime().date;
    const values = sheet.getDataRange().getDisplayValues();
    const index = values.findIndex(function (row) { return row[0] === today; });
    const count = index > 0 ? Number(values[index][1]) : 0;

    if (count >= getConfig().preferences.dailyRequestCap) {
      const error = new Error('Daily cap reached.');
      error.limitCode = 'daily_cap';
      throw error;
    }
    if (index > 0) {
      sheet.getRange(index + 1, 2).setValue(String(count + 1));
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[today, '1']]);
    }
  } finally {
    lock.releaseLock();
  }
}

// Calendar IDs stay on the server: the app identifies a calendar by its row.
function getSettings_() {
  return {
    calendars: readTab_('Calendars').map(function (row, index) {
      return {
        row: index,
        label: row.label,
        include_in_free_time: row.include_in_free_time.toUpperCase() === 'TRUE',
        writable: row.writable.toUpperCase() === 'TRUE',
        routing_hints: row.routing_hints,
        default_color: row.default_color,
        default_reminders: row.default_reminders,
      };
    }),
    places: readTab_('Places'),
    colorRules: readTab_('ColorRules'),
    preferences: readTab_('Preferences'),
  };
}

function replaceRows_(sheet, rows, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, columns).clearContent();
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, columns).setValues(rows);
}

function checkColor_(color) {
  if (color && !GOOGLE_EVENT_COLORS[color]) throw new Error('Unknown color: ' + color);
}

function saveCalendars_(calendars) {
  const sheet = getConfigSpreadsheet_().getSheetByName('Calendars');
  const labels = {};
  calendars.forEach(function (calendar) {
    const label = String(calendar.label || '').trim();
    if (!label || label.indexOf(':') >= 0) throw new Error('A calendar label can\'t be empty or contain a colon.');
    if (labels[label.toLowerCase()]) throw new Error('Two calendars can\'t share a label.');
    labels[label.toLowerCase()] = true;
    checkColor_(calendar.default_color);
    parseReminders_(calendar.default_reminders);
  });
  calendars.forEach(function (calendar) {
    // Column A holds the calendar ID, which never changes here.
    sheet.getRange(Number(calendar.row) + 2, 2, 1, 6).setValues([[
      String(calendar.label).trim(),
      calendar.include_in_free_time ? 'TRUE' : 'FALSE',
      calendar.writable ? 'TRUE' : 'FALSE',
      calendar.routing_hints || '',
      calendar.default_color || '',
      calendar.default_reminders || '',
    ]]);
  });
  clearConfigCache();
  return { saved: true };
}

function saveColorRules_(rules) {
  const rows = rules.filter(function (rule) { return String(rule.category_or_keyword || '').trim(); })
    .map(function (rule) {
      checkColor_(rule.color);
      return [String(rule.category_or_keyword).trim(), rule.color];
    });
  replaceRows_(getConfigSpreadsheet_().getSheetByName('ColorRules'), rows, 2);
  clearConfigCache();
  return { saved: true };
}

function checkPreference_(key, value) {
  if (key.indexOf('window_') === 0) {
    parseTimeRange_(value);
  } else if (key === 'earliest_time' || key === 'latest_time') {
    parseClock_(value);
  } else if (key === 'default_reminders') {
    parseReminders_(value);
  } else if (!(Number(value) > 0)) {
    throw new Error('Bad value for ' + key);
  }
}

function savePreferences_(preferences) {
  const rows = CONFIG_TABS.Preferences.rows.map(function (defaults) {
    const key = defaults[0];
    const value = preferences[key] === undefined ? defaults[1] : preferences[key];
    checkPreference_(key, value);
    return [key, String(value)];
  });
  replaceRows_(getConfigSpreadsheet_().getSheetByName('Preferences'), rows, 2);
  clearConfigCache();
  return { saved: true };
}

function deletePlace_(name) {
  const sheet = getConfigSpreadsheet_().getSheetByName('Places');
  const values = sheet.getDataRange().getDisplayValues();
  const index = values.findIndex(function (row, i) { return i > 0 && row[0] === name; });
  if (index < 0) throw new Error('Place not found.');
  sheet.deleteRow(index + 1);
  clearConfigCache();
  return { deleted: name };
}
