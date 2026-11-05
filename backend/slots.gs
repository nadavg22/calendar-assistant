// find_free_slots. Claude never works out free time: this file does.
// The interval functions are plain logic with no Google calls, so scripts/test-slots.js can test them.
// An interval is [start, end]. Everything is in milliseconds, or minutes for time-of-day ranges.

const SLOT_STEP_MINUTES = 30;
const MAX_SEARCH_DAYS = 31;

function mergeIntervals(intervals) {
  const sorted = intervals.slice().sort(function (a, b) { return a[0] - b[0]; });
  const merged = [];
  sorted.forEach(function (interval) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([interval[0], interval[1]]);
    }
  });
  return merged;
}

function intersectIntervals(a, b) {
  const result = [];
  a.forEach(function (x) {
    b.forEach(function (y) {
      const start = Math.max(x[0], y[0]);
      const end = Math.min(x[1], y[1]);
      if (start < end) result.push([start, end]);
    });
  });
  return mergeIntervals(result);
}

function subtractIntervals(base, remove) {
  const blocked = mergeIntervals(remove);
  const result = [];
  base.forEach(function (interval) {
    let cursor = interval[0];
    blocked.forEach(function (block) {
      if (block[1] <= cursor || block[0] >= interval[1]) return;
      if (block[0] > cursor) result.push([cursor, block[0]]);
      cursor = Math.max(cursor, block[1]);
    });
    if (cursor < interval[1]) result.push([cursor, interval[1]]);
  });
  return result;
}

// Start times in one day that fit the event, on the step grid, not overlapping each other.
function candidateStarts(allowed, busy, durationMs, bufferMs, stepMs) {
  const padded = busy.map(function (b) { return [b[0] - bufferMs, b[1] + bufferMs]; });
  const starts = [];
  subtractIntervals(allowed, padded).forEach(function (free) {
    let start = Math.ceil(free[0] / stepMs) * stepMs;
    while (start + durationMs <= free[1]) {
      starts.push(start);
      start = Math.ceil((start + durationMs) / stepMs) * stepMs;
    }
  });
  return starts;
}

// days is a list of { date, allowed }. Returns a list of { date, start, end }.
function pickSlots(options) {
  const perDay = options.days.map(function (day) {
    return {
      date: day.date,
      starts: candidateStarts(day.allowed, options.busy, options.durationMs, options.bufferMs, options.stepMs),
    };
  }).filter(function (day) { return day.starts.length > 0; });

  const toSlot = function (date, start) {
    return { date: date, start: start, end: start + options.durationMs };
  };

  if (options.spread) {
    return spreadEvenly(perDay, options.count).map(function (day) { return toSlot(day.date, day.starts[0]); });
  }
  const slots = [];
  perDay.forEach(function (day) {
    day.starts.forEach(function (start) { slots.push(toSlot(day.date, start)); });
  });
  return slots.slice(0, options.count);
}

// Picks count items spaced as far apart as possible, keeping the first and last.
function spreadEvenly(items, count) {
  if (items.length <= count) return items;
  if (count === 1) return [items[0]];
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(items[Math.round(i * (items.length - 1) / (count - 1))]);
  }
  return picked;
}

function windowRange_(timeWindow, preferences) {
  const name = String(timeWindow || 'any').trim().toLowerCase();
  if (name === 'any') return [preferences.earliestMinutes, preferences.latestMinutes];
  if (preferences.windows[name]) return preferences.windows[name];
  return parseTimeRange_(name);
}

function getBusyIntervals_(startMs, endMs) {
  const calendars = getConfig().calendars.filter(function (c) { return c.includeInFreeTime; });
  if (calendars.length === 0) return [];
  const response = Calendar.Freebusy.query({
    timeMin: new Date(startMs).toISOString(),
    timeMax: new Date(endMs).toISOString(),
    timeZone: TZ,
    items: calendars.map(function (c) { return { id: c.id }; }),
  });

  const busy = [];
  calendars.forEach(function (calendar) {
    const result = response.calendars[calendar.id];
    // Never treat an unreadable calendar as free.
    if (!result || (result.errors && result.errors.length)) {
      throw new Error('Could not read free time for ' + calendar.label + '.');
    }
    (result.busy || []).forEach(function (b) {
      busy.push([new Date(b.start).getTime(), new Date(b.end).getTime()]);
    });
  });
  return busy;
}

function findFreeSlots(args) {
  const preferences = getConfig().preferences;
  const place = args.place_name ? findPlace_(args.place_name) : null;
  if (args.place_name && !place) return { error: 'place_not_found', place_name: args.place_name };

  const durationMinutes = Number(args.duration_minutes) ||
    (place && place.defaultDuration) || preferences.defaultEventMinutes;
  const startMs = Math.max(parseToMs_(args.start), Date.now());
  const endMs = parseRangeEnd_(args.end);
  if (endMs <= startMs) throw new Error('The search range is empty or in the past.');
  if (endMs - startMs > MAX_SEARCH_DAYS * 86400000) throw new Error('Search at most ' + MAX_SEARCH_DAYS + ' days at a time.');

  const dayLimits = intersectIntervals([windowRange_(args.time_window, preferences)],
    [[preferences.earliestMinutes, preferences.latestMinutes]]);
  const unknownHours = [];
  const days = [];
  const lastDate = Utilities.formatDate(new Date(endMs - 1), TZ, 'yyyy-MM-dd');
  for (let date = Utilities.formatDate(new Date(startMs), TZ, 'yyyy-MM-dd'); date <= lastDate; date = addDays_(date, 1)) {
    let ranges = dayLimits;
    if (place) {
      const weekday = Number(Utilities.formatDate(new Date(localMs_(date, 720)), TZ, 'u')) % 7;
      if (place.hours[weekday] === null) {
        unknownHours.push(date);
      } else {
        ranges = intersectIntervals(ranges, place.hours[weekday]);
      }
    }
    const allowed = ranges.map(function (r) { return [localMs_(date, r[0]), localMs_(date, r[1])]; });
    days.push({ date: date, allowed: intersectIntervals(allowed, [[startMs, endMs]]) });
  }

  const bufferMs = (place ? place.travelBufferMinutes : 0) * 60000;
  const spread = Boolean(args.spread_across_days);
  const count = Number(args.count) || (spread ? 3 : 5);
  const slots = pickSlots({
    days: days,
    busy: getBusyIntervals_(startMs - bufferMs, endMs + bufferMs),
    durationMs: durationMinutes * 60000,
    bufferMs: bufferMs,
    stepMs: SLOT_STEP_MINUTES * 60000,
    count: count,
    spread: spread,
  });

  return {
    slots: slots.map(function (slot) {
      return {
        day: Utilities.formatDate(new Date(slot.start), TZ, 'EEEE'),
        date: slot.date,
        start: formatLocal_(slot.start),
        end: formatLocal_(slot.end),
      };
    }),
    requested: count,
    duration_minutes: durationMinutes,
    travel_buffer_minutes: bufferMs / 60000,
    place: place ? { name: place.name, address: place.address, stale: place.isStale } : null,
    unknown_hours_on: unknownHours,
  };
}
