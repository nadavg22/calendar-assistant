// Reads and writes the Config Sheet. Sheet cells are plain text, so values are converted here.

const TZ = 'Asia/Jerusalem';
const CONFIG_CACHE_KEY = 'config';
const CONFIG_CACHE_SECONDS = 3600;
const PLACE_STALE_DAYS = 60;
const LOG_MAX_ROWS = 500;
const LOG_SUMMARY_LENGTH = 80;
const PLACE_HOUR_COLUMNS = ['hours_sun', 'hours_mon', 'hours_tue', 'hours_wed', 'hours_thu', 'hours_fri', 'hours_sat'];

const GOOGLE_EVENT_COLORS = {
  Lavender: '1', Sage: '2', Grape: '3', Flamingo: '4', Banana: '5', Tangerine: '6',
  Peacock: '7', Graphite: '8', Blueberry: '9', Basil: '10', Tomato: '11',
};

let configSpreadsheet_ = null;

// Opening the Sheet is slow, so each request opens it once.
function getConfigSpreadsheet_() {
  if (configSpreadsheet_) return configSpreadsheet_;
  const id = PropertiesService.getScriptProperties().getProperty('CONFIG_SHEET_ID');
  if (!id) throw new Error('Config Sheet not found. Run setupConfigSheet first.');
  configSpreadsheet_ = SpreadsheetApp.openById(id);
  return configSpreadsheet_;
}

function readTab_(name) {
  const values = getConfigSpreadsheet_().getSheetByName(name).getDataRange().getDisplayValues();
  const headers = values[0];
  return values.slice(1)
    .filter(function (row) { return row.join('') !== ''; })
    .map(function (row) {
      const record = {};
      headers.forEach(function (header, i) { record[header] = row[i].trim(); });
      return record;
    });
}

function getConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const prefs = {};
  readTab_('Preferences').forEach(function (row) { prefs[row.key] = row.value; });

  const config = {
    calendars: readTab_('Calendars').map(function (row) {
      return {
        id: row.id,
        label: row.label,
        includeInFreeTime: row.include_in_free_time.toUpperCase() === 'TRUE',
        writable: row.writable.toUpperCase() === 'TRUE',
        routingHints: row.routing_hints,
        defaultColor: row.default_color,
        defaultReminders: parseReminders_(row.default_reminders),
      };
    }),
    places: readTab_('Places').map(parsePlace_),
    colorRules: readTab_('ColorRules').map(function (row) {
      return { keyword: row.category_or_keyword, color: row.color };
    }),
    preferences: {
      windows: {
        morning: parseTimeRange_(prefs.window_morning),
        afternoon: parseTimeRange_(prefs.window_afternoon),
        evening: parseTimeRange_(prefs.window_evening),
      },
      defaultEventMinutes: Number(prefs.default_event_minutes) || 60,
      earliestMinutes: parseClock_(prefs.earliest_time),
      latestMinutes: parseClock_(prefs.latest_time) || 1440,
      defaultReminders: parseReminders_(prefs.default_reminders) || [],
      dailyRequestCap: Number(prefs.daily_request_cap) || 200,
    },
  };

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_SECONDS);
  return config;
}

function clearConfigCache() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

function parsePlace_(row) {
  const verified = row.last_verified ? new Date(row.last_verified).getTime() : NaN;
  const ageDays = (Date.now() - verified) / 86400000;
  return {
    name: row.name,
    aliases: row.aliases.split(',').map(function (a) { return a.trim(); }).filter(String),
    address: row.address,
    // Indexed by day of week, Sunday = 0. Each entry is null when hours are unknown.
    hours: PLACE_HOUR_COLUMNS.map(function (column) { return parseHours_(row[column]); }),
    hoursText: PLACE_HOUR_COLUMNS.map(function (column) { return row[column]; }),
    defaultDuration: Number(row.default_duration) || null,
    travelBufferMinutes: Number(row.travel_buffer_minutes) || 0,
    lastVerified: row.last_verified,
    source: row.source,
    isStale: !(ageDays <= PLACE_STALE_DAYS),
  };
}

// '07:30' -> 450
function parseClock_(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!match) throw new Error('Bad time in config: ' + text);
  return Number(match[1]) * 60 + Number(match[2]);
}

// '07:00-12:00' -> [420, 720]. An end of 00:00 means midnight at the end of the day.
function parseTimeRange_(text) {
  const parts = String(text).split('-');
  if (parts.length !== 2) throw new Error('Bad time range in config: ' + text);
  return [parseClock_(parts[0]), parseClock_(parts[1]) || 1440];
}

// 'closed' -> [], blank -> null (unknown), '06:00-12:00, 16:00-22:00' -> two ranges.
function parseHours_(text) {
  const value = String(text || '').trim().toLowerCase();
  if (value === '') return null;
  if (value === 'closed') return [];
  return value.split(',').map(parseTimeRange_);
}

// 'popup:30,email:60' -> [{method, minutes}], blank -> null (use the default), 'none' -> [].
function parseReminders_(text) {
  const value = String(text || '').trim().toLowerCase();
  if (value === '') return null;
  if (value === 'none') return [];
  return value.split(',').map(function (part) {
    const pieces = part.trim().split(':');
    if ((pieces[0] !== 'popup' && pieces[0] !== 'email') || isNaN(Number(pieces[1]))) {
      throw new Error('Bad reminder in config: ' + part);
    }
    return { method: pieces[0], minutes: Number(pieces[1]) };
  });
}

function getPlaces() {
  return getConfig().places;
}

function findPlace_(name) {
  const wanted = String(name).trim().toLowerCase();
  return getPlaces().filter(function (place) {
    const names = [place.name].concat(place.aliases);
    return names.some(function (n) { return n.toLowerCase() === wanted; });
  })[0] || null;
}

// Adds a place, or replaces the row with the same name. Takes Places column names as keys.
function savePlace(fields) {
  if (!fields.name) throw new Error('A place needs a name.');
  // A bad value here would break reading the whole config, so check before saving.
  PLACE_HOUR_COLUMNS.forEach(function (column) { parseHours_(fields[column]); });
  const sheet = getConfigSpreadsheet_().getSheetByName('Places');
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const row = headers.map(function (header) { return fields[header] === undefined ? '' : String(fields[header]); });

  const wanted = String(fields.name).trim().toLowerCase();
  const index = values.findIndex(function (existing, i) { return i > 0 && existing[0].trim().toLowerCase() === wanted; });
  if (index > 0) {
    sheet.getRange(index + 1, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  }
  clearConfigCache();
  return { saved: fields.name };
}

// Keeps only the latest rows. Never pass full API responses here.
function appendLog_(summary, action) {
  const sheet = getConfigSpreadsheet_().getSheetByName('Log');
  const timestamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([timestamp, String(summary).slice(0, LOG_SUMMARY_LENGTH), action]);
  const extra = sheet.getLastRow() - 1 - LOG_MAX_ROWS;
  if (extra > 0) sheet.deleteRows(2, extra);
}
