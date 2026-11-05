// Creates the "Assistant Config" Sheet. Run setupConfigSheet once from the editor.
// This file is the source of truth for tab and column names.

const CONFIG_SHEET_NAME = 'Assistant Config';

const CONFIG_TABS = {
  Calendars: {
    headers: ['id', 'label', 'include_in_free_time', 'writable', 'routing_hints', 'default_color', 'default_reminders'],
    rows: [
      ['primary', 'Personal', true, true, 'Personal life, workouts, appointments, anything that fits nowhere else', '', ''],
      ['PASTE_ID_IN_STEP_2', 'Studio', true, true, 'Studio sessions', '', ''],
      ['PASTE_ID_IN_STEP_2', 'Rehearsal space', true, true, 'Band rehearsals', '', ''],
    ],
  },
  Places: {
    headers: ['name', 'aliases', 'address', 'hours_sun', 'hours_mon', 'hours_tue', 'hours_wed', 'hours_thu', 'hours_fri', 'hours_sat',
      'default_duration', 'travel_buffer_minutes', 'last_verified', 'source'],
    rows: [
      ['Sample Gym', 'gym, חדר כושר', 'SAMPLE: replace with the real address',
        '06:00-22:00', '06:00-22:00', '06:00-22:00', '06:00-22:00', '06:00-22:00', '06:00-15:00', 'closed',
        60, 20, '', 'sample'],
    ],
  },
  ColorRules: {
    headers: ['category_or_keyword', 'color'],
    rows: [
      ['workout', 'Basil'],
      ['rehearsal', 'Grape'],
      ['studio', 'Tangerine'],
    ],
  },
  Preferences: {
    headers: ['key', 'value'],
    rows: [
      ['window_morning', '07:00-12:00'],
      ['window_afternoon', '12:00-17:00'],
      ['window_evening', '17:00-22:00'],
      ['default_event_minutes', 60],
      ['earliest_time', '07:00'],
      ['latest_time', '23:00'],
      ['default_reminders', 'popup:30'],
      ['daily_request_cap', 200],
    ],
  },
  Usage: {
    headers: ['date', 'request_count'],
    rows: [],
  },
  Log: {
    headers: ['timestamp', 'request_summary', 'action_taken'],
    rows: [],
  },
};

function setupConfigSheet() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('CONFIG_SHEET_ID');
  if (existingId) {
    const existing = SpreadsheetApp.openById(existingId);
    Logger.log('Config Sheet already exists, nothing changed: ' + existing.getUrl());
    return;
  }

  const spreadsheet = SpreadsheetApp.create(CONFIG_SHEET_NAME);
  const defaultTab = spreadsheet.getSheets()[0];

  Object.keys(CONFIG_TABS).forEach(function (name) {
    const tab = CONFIG_TABS[name];
    const sheet = spreadsheet.insertSheet(name);
    // Plain text stops Sheets turning values like 07:00 into dates.
    sheet.getRange(1, 1, sheet.getMaxRows(), tab.headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, tab.headers.length).setValues([tab.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (tab.rows.length > 0) {
      sheet.getRange(2, 1, tab.rows.length, tab.headers.length).setValues(tab.rows);
    }
    sheet.autoResizeColumns(1, tab.headers.length);
  });

  spreadsheet.deleteSheet(defaultTab);
  props.setProperty('CONFIG_SHEET_ID', spreadsheet.getId());
  Logger.log('Config Sheet created: ' + spreadsheet.getUrl());
}

function generateToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// Run once from the editor. Prints the token in the Execution log.
function setupAccessToken() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ACCESS_TOKEN')) {
    Logger.log('A token already exists, nothing changed. Use Rotate token in the app to replace it.');
    return;
  }
  const token = generateToken_();
  props.setProperty('ACCESS_TOKEN', token);
  Logger.log('Your access token: ' + token);
}

function rotateAccessToken_() {
  const token = generateToken_();
  PropertiesService.getScriptProperties().setProperty('ACCESS_TOKEN', token);
  return token;
}
