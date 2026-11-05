// Conversation memory in CacheService. Plain text only, because an entry is limited to 100 KB.

const SESSION_SECONDS = 21600;
const SESSION_MAX_MESSAGES = 20;
const SESSION_MAX_EVENTS = 15;
const SESSION_MAX_BYTES = 90000;

function loadSession_(sessionId) {
  const cached = CacheService.getScriptCache().get('session_' + sessionId);
  return cached ? JSON.parse(cached) : { id: sessionId, turns: [], recentEvents: [], pending: null };
}

function saveSession_(session) {
  session.turns = session.turns.slice(-SESSION_MAX_MESSAGES);
  let json = JSON.stringify(session);
  while (json.length > SESSION_MAX_BYTES && session.turns.length > 2) {
    session.turns = session.turns.slice(2);
    json = JSON.stringify(session);
  }
  CacheService.getScriptCache().put('session_' + session.id, json, SESSION_SECONDS);
}

function addTurn_(session, userText, assistantText) {
  session.turns.push({ role: 'user', text: userText });
  session.turns.push({ role: 'assistant', text: assistantText });
}

// Newest first, so "the second one" follows the order the owner just saw.
function rememberEvents_(session, events) {
  const ids = events.map(function (e) { return e.id; });
  const older = session.recentEvents.filter(function (e) { return ids.indexOf(e.id) < 0; });
  const brief = events.map(function (e) {
    return { id: e.id, calendar: e.calendar, title: e.title, start: e.start, end: e.end };
  });
  session.recentEvents = brief.concat(older).slice(0, SESSION_MAX_EVENTS);
}

function forgetEvent_(session, eventId) {
  session.recentEvents = session.recentEvents.filter(function (e) { return e.id !== eventId; });
}
