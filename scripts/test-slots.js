// Tests the free-time logic in backend/slots.gs on this computer. Run: node scripts/test-slots.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../backend/slots.gs'), 'utf8'));

const MIN = 60000;
const HOUR = 60 * MIN;
const at = (day, hour) => day * 24 * HOUR + hour * HOUR;
const dayWith = (day, from, to) => ({ date: 'day' + day, allowed: [[at(day, from), at(day, to)]] });
const base = { busy: [], durationMs: HOUR, bufferMs: 0, stepMs: 30 * MIN, count: 5, spread: false };

const tests = {
  'merges overlapping and touching intervals'() {
    assert.deepStrictEqual(mergeIntervals([[5, 7], [1, 3], [3, 4], [6, 9]]), [[1, 4], [5, 9]]);
  },
  'intersects opening hours with a time window'() {
    assert.deepStrictEqual(intersectIntervals([[17, 22]], [[6, 12], [16, 20]]), [[17, 20]]);
  },
  'an empty list means closed, so nothing fits'() {
    assert.deepStrictEqual(intersectIntervals([[17, 22]], []), []);
  },
  'subtracts busy time from the middle and the edges'() {
    assert.deepStrictEqual(subtractIntervals([[0, 10]], [[2, 3], [8, 12]]), [[0, 2], [3, 8]]);
  },
  'subtracting everything leaves nothing'() {
    assert.deepStrictEqual(subtractIntervals([[2, 5]], [[0, 10]]), []);
  },
  'travel buffer keeps the visit clear of events on both sides'() {
    const starts = candidateStarts([[at(0, 17), at(0, 22)]], [[at(0, 17), at(0, 18)], [at(0, 20), at(0, 21)]],
      HOUR, 30 * MIN, 30 * MIN);
    assert.deepStrictEqual(starts, [at(0, 18.5)]);
  },
  'no slot when the buffer leaves too little room'() {
    const starts = candidateStarts([[at(0, 17), at(0, 22)]], [[at(0, 17), at(0, 18)], [at(0, 19.5), at(0, 22)]],
      HOUR, 30 * MIN, 30 * MIN);
    assert.deepStrictEqual(starts, []);
  },
  'an event that starts before the window still blocks it'() {
    assert.deepStrictEqual(candidateStarts([[at(0, 17), at(0, 19)]], [[at(0, 10), at(0, 18)]], HOUR, 0, 30 * MIN),
      [at(0, 18)]);
  },
  'starts are rounded up to the half hour'() {
    assert.deepStrictEqual(candidateStarts([[at(0, 17) + 10 * MIN, at(0, 19)]], [], HOUR, 0, 30 * MIN), [at(0, 17.5)]);
  },
  'slots in one day do not overlap'() {
    const slots = pickSlots({ ...base, days: [dayWith(0, 17, 20)] });
    assert.deepStrictEqual(slots.map((s) => s.start), [at(0, 17), at(0, 18), at(0, 19)]);
  },
  'count limits the results'() {
    assert.strictEqual(pickSlots({ ...base, days: [dayWith(0, 7, 22)], count: 2 }).length, 2);
  },
  'spread gives one slot per day on well-separated days'() {
    const days = [0, 1, 2, 3, 4, 5, 6].map((d) => dayWith(d, 17, 22));
    const slots = pickSlots({ ...base, days, count: 3, spread: true });
    assert.deepStrictEqual(slots.map((s) => s.date), ['day0', 'day3', 'day6']);
  },
  'spread skips full days'() {
    const days = [0, 1, 2].map((d) => dayWith(d, 17, 19));
    const slots = pickSlots({ ...base, days, busy: [[at(1, 17), at(1, 19)]], count: 3, spread: true });
    assert.deepStrictEqual(slots.map((s) => s.date), ['day0', 'day2']);
  },
  'spread never doubles up a day to reach the count'() {
    const slots = pickSlots({ ...base, days: [dayWith(0, 7, 22)], count: 3, spread: true });
    assert.strictEqual(slots.length, 1);
  },
};

let failed = 0;
Object.keys(tests).forEach((name) => {
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
