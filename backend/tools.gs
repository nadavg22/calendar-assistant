// Claude's tools. Keep this list unchanged between requests so it stays in the prompt cache.
// The rules for what needs the owner's confirmation are enforced here, not only in the prompt.

const REMINDERS_SCHEMA = {
  type: 'array',
  description: 'Only when the owner asks for specific reminders. An empty list means no reminders.',
  items: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['popup', 'email'] },
      minutes: { type: 'integer', description: 'Minutes before the event.' },
    },
    required: ['method', 'minutes'],
  },
};

const EVENT_PROPERTIES = {
  calendar: { type: 'string', description: 'Calendar label.' },
  title: { type: 'string' },
  start: { type: 'string', description: 'Local time like 2026-11-08T20:00:00, or a date for an all-day event.' },
  end: { type: 'string', description: 'Same format as start. For all-day events, the day after the last day.' },
  location: { type: 'string' },
  description: { type: 'string' },
  category: { type: 'string', description: 'One short English word for the kind of event, e.g. workout, rehearsal, studio. Sets the color.' },
  reminders: REMINDERS_SCHEMA,
};

const CHANGE_PROPERTIES = {
  title: { type: 'string' },
  start: { type: 'string', description: 'New start. Without a new end, the event keeps its length.' },
  end: { type: 'string' },
  location: { type: 'string' },
  description: { type: 'string' },
  category: { type: 'string' },
  reminders: REMINDERS_SCHEMA,
  calendar: { type: 'string', description: 'Move the event to this calendar label.' },
};

const TOOL_DEFINITIONS = [
  {
    name: 'get_current_datetime',
    description: 'Current date, time and weekday in Asia/Jerusalem.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_events',
    description: 'List events in a range, across all calendars unless some are named. Returns event ids.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Date or local date-time.' },
        end: { type: 'string', description: 'Date or local date-time. A date includes that whole day.' },
        calendars: { type: 'array', items: { type: 'string' }, description: 'Calendar labels.' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'find_free_slots',
    description: 'Find free times across all calendars that count for free time, respecting the time window, ' +
      'earliest and latest times, and a place\'s opening hours and travel buffer. Always use this to find free time.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Date or local date-time.' },
        end: { type: 'string', description: 'Date or local date-time. A date includes that whole day. At most 31 days.' },
        duration_minutes: { type: 'integer', description: 'Defaults to the place\'s usual length, then the default event length.' },
        time_window: { type: 'string', description: 'morning, afternoon, evening, any, or a range like 18:00-21:00.' },
        place_name: { type: 'string', description: 'A saved place name or alias.' },
        count: { type: 'integer', description: 'How many slots to return.' },
        spread_across_days: { type: 'boolean', description: 'One slot per day, on well-separated days.' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'create_event',
    description: 'Create one event immediately. Only for a single event on a calendar the owner named in this request. ' +
      'Applies color rules and reminders. Anything else goes through propose_actions.',
    input_schema: {
      type: 'object',
      properties: Object.assign({}, EVENT_PROPERTIES, {
        calendar_stated_by_user: { type: 'boolean', description: 'True only if the owner named this calendar. False if you chose it.' },
      }),
      required: ['calendar', 'title', 'start', 'end', 'calendar_stated_by_user'],
    },
  },
  {
    name: 'update_event',
    description: 'Change an event\'s title, location, description, category or reminders immediately. ' +
      'Changing its time or calendar is a move and goes through propose_actions.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        changes: { type: 'object', properties: CHANGE_PROPERTIES },
      },
      required: ['event_id', 'changes'],
    },
  },
  {
    name: 'delete_event',
    description: 'Deleting always goes through propose_actions. This tool refuses and exists to explain that.',
    input_schema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
  },
  {
    name: 'propose_actions',
    description: 'Store actions for the owner to confirm with a button. Nothing happens until they confirm. ' +
      'Use for: deleting, moving, creating more than one event, or creating an event on a calendar you chose yourself. ' +
      'A new proposal replaces the previous one.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What will happen, naming each event, its calendar, day, date and time. In the owner\'s language.' },
        done_message: { type: 'string', description: 'Short past-tense message shown after they confirm. In the owner\'s language.' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['create', 'update', 'delete'] },
              event: { type: 'object', properties: EVENT_PROPERTIES, description: 'For create.' },
              event_id: { type: 'string', description: 'For update and delete.' },
              changes: { type: 'object', properties: CHANGE_PROPERTIES, description: 'For update.' },
            },
            required: ['type'],
          },
        },
      },
      required: ['summary', 'done_message', 'actions'],
    },
  },
  {
    name: 'get_places',
    description: 'Saved places with address, opening hours, usual length and travel buffer. stale means the details need checking online.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'save_place',
    description: 'Propose saving or replacing a place. The owner confirms with a button before anything is saved.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        aliases: { type: 'string', description: 'Comma-separated, including Hebrew names.' },
        address: { type: 'string' },
        hours_sun: { type: 'string', description: 'Like 06:00-22:00, or closed. Leave blank if unknown. Same for each day.' },
        hours_mon: { type: 'string' },
        hours_tue: { type: 'string' },
        hours_wed: { type: 'string' },
        hours_thu: { type: 'string' },
        hours_fri: { type: 'string' },
        hours_sat: { type: 'string' },
        default_duration: { type: 'integer', description: 'Usual visit length in minutes.' },
        travel_buffer_minutes: { type: 'integer' },
        source: { type: 'string', description: 'Where the details came from, e.g. a URL.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_config',
    description: 'Calendars with their settings, color rules and preferences.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ctx holds the session and how many events this request has created.
function runTool_(name, input, ctx) {
  switch (name) {
    case 'get_current_datetime': return getCurrentDatetime();
    case 'list_events': return toolListEvents_(input, ctx);
    case 'find_free_slots': return findFreeSlots(input);
    case 'create_event': return toolCreateEvent_(input, ctx);
    case 'update_event': return toolUpdateEvent_(input, ctx);
    case 'delete_event': throw new Error('Deleting needs confirmation. Use propose_actions.');
    case 'propose_actions': return toolProposeActions_(input, ctx);
    case 'get_places': return toolGetPlaces_();
    case 'save_place': return toolSavePlace_(input, ctx);
    case 'get_config': return toolGetConfig_();
    default: throw new Error('Unknown tool: ' + name);
  }
}

function toolListEvents_(input, ctx) {
  const events = listEvents(input.start, input.end, input.calendars);
  rememberEvents_(ctx.session, events.slice(0, SESSION_MAX_EVENTS));
  return events;
}

function toolCreateEvent_(input, ctx) {
  if (input.calendar_stated_by_user !== true) {
    throw new Error('You chose this calendar yourself, so the owner must confirm it. Use propose_actions.');
  }
  if (ctx.createdCount >= 1) throw new Error('Creating more than one event needs confirmation. Use propose_actions.');
  const event = createEvent(input);
  ctx.createdCount += 1;
  rememberEvents_(ctx.session, [event]);
  return event;
}

function toolUpdateEvent_(input, ctx) {
  const changes = input.changes || {};
  if (changes.start !== undefined || changes.end !== undefined || changes.calendar !== undefined) {
    throw new Error('Moving an event needs confirmation. Use propose_actions.');
  }
  const event = updateEvent(input.event_id, changes);
  rememberEvents_(ctx.session, [event]);
  return event;
}

function toolProposeActions_(input, ctx) {
  if (!input.actions || input.actions.length === 0) throw new Error('A proposal needs at least one action.');
  input.actions.forEach(validateAction_);
  ctx.session.pending = {
    id: Utilities.getUuid().slice(0, 8),
    summary: input.summary,
    doneMessage: input.done_message,
    actions: input.actions,
  };
  return { status: 'waiting_for_owner', note: 'Nothing has changed yet. Tell the owner what you propose and ask them to confirm.' };
}

function validateAction_(action) {
  if (action.type === 'create') {
    const event = action.event || {};
    requireWritable_(resolveCalendar_(event.calendar));
    if (!event.title) throw new Error('A new event needs a title.');
    if (parseToMs_(event.end) <= parseToMs_(event.start)) throw new Error('The end must be after the start.');
  } else if (action.type === 'update' || action.type === 'delete') {
    requireWritable_(splitEventId_(action.event_id).calendar);
    if (action.type === 'update' && !action.changes) throw new Error('An update needs changes.');
  } else {
    throw new Error('Unknown action type: ' + action.type);
  }
}

function toolSavePlace_(input, ctx) {
  const fields = Object.assign({}, input, { last_verified: getCurrentDatetime().date });
  ctx.session.pending = {
    id: Utilities.getUuid().slice(0, 8),
    summary: 'Save place: ' + input.name + (input.address ? ', ' + input.address : ''),
    doneMessage: input.name + ' ✓',
    actions: [{ type: 'save_place', fields: fields }],
  };
  return { status: 'waiting_for_owner', note: 'Nothing is saved yet. Show the owner the details and ask them to confirm.' };
}

function toolGetPlaces_() {
  return getPlaces().map(function (place) {
    return {
      name: place.name,
      aliases: place.aliases,
      address: place.address,
      hours_sunday_to_saturday: place.hoursText,
      default_duration: place.defaultDuration,
      travel_buffer_minutes: place.travelBufferMinutes,
      last_verified: place.lastVerified,
      stale: place.isStale,
    };
  });
}

// Calendar IDs stay out of this on purpose: Claude only needs labels.
function toolGetConfig_() {
  const config = getConfig();
  return {
    calendars: config.calendars.map(function (c) {
      return {
        label: c.label,
        counts_for_free_time: c.includeInFreeTime,
        writable: c.writable,
        routing_hints: c.routingHints,
      };
    }),
    color_rules: config.colorRules,
    preferences: config.preferences,
  };
}
