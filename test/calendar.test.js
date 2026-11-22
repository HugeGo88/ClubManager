const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const calendar = require('../src/main/calendar');

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-calendar-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test('persists one ICS URL per data folder and keeps folders independent', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const one = await calendar.saveConfig(first, 'https://example.test/a.ics');
  await calendar.saveConfig(second, 'webcal://example.test/b.ics');

  assert.deepEqual(await calendar.loadConfig(first), one);
  assert.equal((await calendar.loadConfig(second)).url, 'https://example.test/b.ics');
  assert.equal((await calendar.loadConfig(first)).url, 'https://example.test/a.ics');
});

test('clears the ICS URL and rejects invalid settings without replacing them', async t => {
  const folder = await fixture(t);
  const saved = await calendar.saveConfig(folder, 'https://example.test/calendar.ics');
  await calendar.saveConfig(folder, null);
  assert.equal((await calendar.loadConfig(folder)).url, null);

  await calendar.saveConfig(folder, 'https://example.test/calendar.ics');
  await assert.rejects(calendar.saveConfig(folder, 'ftp://example.test/calendar.ics'), /https/i);
  await assert.rejects(calendar.saveConfig(folder, 'http://'), /gültig/i);
  assert.equal((await calendar.loadConfig(folder)).url, 'https://example.test/calendar.ics');
});

test('normalizes webcal URLs and surfaces unreadable calendar storage', async t => {
  assert.equal(calendar.normalizeUrl('webcal://example.test/calendar.ics'), 'https://example.test/calendar.ics');
  const folder = await fixture(t);
  const file = path.join(folder, 'clubmanager-calendar.json');
  await fs.mkdir(file);
  await assert.rejects(calendar.loadConfig(folder), /Kalender-Einstellungen|URL/i);
});

test('normal timed VEVENT records are parsed and external text is kept as text', async () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'DTSTART:20261121T100000Z',
    'DTEND:20261121T113000Z',
    'SUMMARY:Team\\; Planung',
    'LOCATION:Clubhaus',
    'DESCRIPTION:First line\\nSecond line\\\\nLiteral text',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'DTSTART:20261122',
    'SUMMARY:Ganztags',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = calendar.parseIcs(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Team; Planung');
  assert.equal(events[0].description, 'First line\nSecond line\\nLiteral text');
  assert.equal(events[0].location, 'Clubhaus');
});

test('converts zoned timed events to UTC and preserves all-day and multi-day dates', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700329T020000',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:timed',
    'DTSTART;TZID=Europe/Berlin:20261121T100000',
    'DTEND;TZID=Europe/Berlin:20261121T113000',
    'SUMMARY:Termin',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:allday',
    'DTSTART;VALUE=DATE:20261130',
    'DTEND;VALUE=DATE:20261202',
    'SUMMARY:Konferenz',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = calendar.parseIcs(ics);
  const timed = events.find(event => event.id === 'timed');
  const allDay = events.find(event => event.id === 'allday');

  assert.equal(timed.start, '2026-11-21T09:00:00.000Z');
  assert.equal(timed.end, '2026-11-21T10:30:00.000Z');
  assert.equal(timed.allDay, false);
  assert.equal(allDay.start, '2026-11-30T00:00:00.000Z');
  assert.equal(allDay.end, '2026-12-02T00:00:00.000Z');
  assert.equal(allDay.allDay, true);
});

test('expands recurring events and applies moved, cancelled and excluded occurrences', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:series',
    'DTSTART:20261121T100000Z',
    'DTEND:20261121T110000Z',
    'RRULE:FREQ=DAILY;COUNT=5',
    'EXDATE:20261124T100000Z',
    'SUMMARY:Serie',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series',
    'RECURRENCE-ID:20261122T100000Z',
    'DTSTART:20261123T120000Z',
    'DTEND:20261123T130000Z',
    'SUMMARY:Verschoben',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series',
    'RECURRENCE-ID:20261123T100000Z',
    'DTSTART:20261123T100000Z',
    'DTEND:20261123T110000Z',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = calendar.parseIcs(ics);
  const starts = events.map(event => event.start);

  assert.equal(events.length, 3);
  assert.ok(starts.includes('2026-11-21T10:00:00.000Z'));
  assert.ok(starts.includes('2026-11-23T12:00:00.000Z'));
  assert.ok(starts.includes('2026-11-25T10:00:00.000Z'));
  assert.ok(!starts.includes('2026-11-22T10:00:00.000Z'));
  assert.ok(!starts.includes('2026-11-24T10:00:00.000Z'));
  assert.equal(events.find(event => event.start === '2026-11-23T12:00:00.000Z').title, 'Verschoben');
});

test('uses VEVENT duration and shows transparent events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:duration',
    'DTSTART:20261121T100000Z',
    'DURATION:PT90M',
    'TRANSP:TRANSPARENT',
    'SUMMARY:Offener Termin',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const events = calendar.parseIcs(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Offener Termin');
  assert.equal(events[0].start, '2026-11-21T10:00:00.000Z');
  assert.equal(events[0].end, '2026-11-21T11:30:00.000Z');
});

test('fetches HTTPS and HTTP sources and reports unavailable services explicitly', async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') {
      setTimeout(() => response.end('BEGIN:VCALENDAR'), 100);
      return;
    }
    if (request.url === '/missing') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('Content-Type', 'text/calendar');
    response.end('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261121T100000Z\r\nSUMMARY:HTTP-Test\r\nEND:VEVENT\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/calendar.ics`;

  const result = await calendar.fetchIcs(url);
  assert.equal(result.events[0].title, 'HTTP-Test');
  await assert.rejects(calendar.fetchIcs(`http://127.0.0.1:${address.port}/missing`), /nicht verfügbar|404/i);
});

test('persists successful refreshes for offline reuse without replacing them on failure', async t => {
  const folder = await fixture(t);
  let responseMode = 'online';
  const server = http.createServer((request, response) => {
    if (responseMode === 'unavailable') {
      response.statusCode = 503;
      response.end('unavailable');
      return;
    }
    response.setHeader('Content-Type', 'text/calendar');
    response.end(responseMode === 'invalid'
      ? 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:truncated\r\nDTSTART:20261121T100000Z\r\nSUMMARY:Truncated'
      : 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:shared\r\nDTSTART:20261121T100000Z\r\nSUMMARY:Shared event\r\nEND:VEVENT\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);

  const refreshed = await calendar.refreshCalendar(folder, config);
  assert.equal(refreshed.events[0].title, 'Shared event');
  assert.ok(Number.isFinite(Date.parse(refreshed.fetchedAt)));

  const reopened = await calendar.loadCache(folder, url);
  assert.deepEqual(reopened, refreshed);
  assert.equal(await calendar.loadCache(folder, 'https://other.example/calendar.ics'), null);

  responseMode = 'unavailable';
  await assert.rejects(calendar.refreshCalendar(folder, config), /503|nicht verfügbar/i);
  assert.deepEqual(await calendar.loadCache(folder, url), refreshed);
  responseMode = 'invalid';
  await assert.rejects(calendar.refreshCalendar(folder, config), /Ungültige ICS/i);
  assert.deepEqual(await calendar.loadCache(folder, url), refreshed);
});

test('retains an omitted identified standalone event across refresh and reload', async t => {
  const folder = await fixture(t);
  let feed = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:retained\r\nDTSTART:20991121T100000Z\r\nSUMMARY:Remember me\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const server = http.createServer((request, response) => response.end(feed));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  await calendar.refreshCalendar(folder, config);
  feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  assert.equal((await calendar.refreshCalendar(folder, config)).events[0].title, 'Remember me');
  assert.equal((await calendar.loadCache(folder, url)).events[0].title, 'Remember me');
});

test('expires missing timed, all-day and multi-day events at two years after their ends but keeps live old events', async t => {
  const folder = await fixture(t);
  let feed = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:timed', 'DTSTART:20240101T090000Z', 'DTEND:20240101T100000Z', 'SUMMARY:Timed', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:day', 'DTSTART;VALUE=DATE:20240101', 'DTEND;VALUE=DATE:20240102', 'SUMMARY:Day', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:multi', 'DTSTART;VALUE=DATE:20240101', 'DTEND;VALUE=DATE:20240104', 'SUMMARY:Multi', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const server = http.createServer((request, response) => response.end(feed));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T09:59:59Z') });
  assert.equal((await calendar.refreshCalendar(folder, config)).events.length, 3);
  feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  assert.equal((await calendar.refreshCalendar(folder, config)).events.length, 3);
  t.mock.timers.setTime(new Date('2026-01-01T10:00:00Z').getTime());
  assert.deepEqual((await calendar.loadCache(folder, url)).events.map(event => event.id), ['day', 'multi']);
  t.mock.timers.setTime(new Date('2026-01-02T00:00:00Z').getTime());
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events.map(event => event.id), ['multi']);
  t.mock.timers.setTime(new Date('2026-01-04T00:00:00Z').getTime());
  assert.deepEqual((await calendar.loadCache(folder, url)).events, []);
  feed = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:timed\r\nDTSTART:20240101T090000Z\r\nDTEND:20240101T100000Z\r\nSUMMARY:Old but live\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.equal((await calendar.refreshCalendar(folder, config)).events[0].title, 'Old but live');
});

test('active updates replace history, cancellation stays effective after omission, and reinstatement returns', async t => {
  const folder = await fixture(t);
  const event = title => `BEGIN:VEVENT\r\nUID:item\r\nDTSTART:20990101T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT`;
  const cancel = 'BEGIN:VEVENT\r\nUID:item\r\nSTATUS:CANCELLED\r\nEND:VEVENT';
  let contents = event('Original');
  const server = http.createServer((request, response) => response.end(`BEGIN:VCALENDAR\r\n${contents}\r\nEND:VCALENDAR`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  await calendar.refreshCalendar(folder, config);
  contents = event('Updated');
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events.map(e => e.title), ['Updated']);
  contents = cancel;
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events, []);
  contents = '';
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events, []);
  assert.deepEqual((await calendar.loadCache(folder, url)).events, []);
  contents = event('Reinstated');
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events.map(e => e.title), ['Reinstated']);
  contents = '';
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events.map(e => e.title), ['Reinstated']);
});

test('keeps normalized source histories independent in each data folder when switching away and back', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const server = http.createServer((request, response) => response.end(request.url === '/a'
    ? 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20990101T100000Z\r\nSUMMARY:Source A\r\nEND:VEVENT\r\nEND:VCALENDAR'
    : 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART:20990101T100000Z\r\nSUMMARY:Source B\r\nEND:VEVENT\r\nEND:VCALENDAR'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let config = await calendar.saveConfig(first, `${base}/a`);
  await calendar.refreshCalendar(first, config);
  config = await calendar.saveConfig(first, `${base}/b`, config.revision);
  assert.deepEqual((await calendar.refreshCalendar(first, config)).events.map(e => e.id), ['b']);
  config = await calendar.saveConfig(first, `${base}/a`, config.revision);
  assert.deepEqual((await calendar.loadCache(first, `${base}/a`)).events.map(e => e.id), ['a']);
  assert.equal(await calendar.loadCache(second, `${base}/a`), null);
});

test('switching sources retains standalone history but does not restore an older source live recurrence cache', async t => {
  const folder = await fixture(t);
  const server = http.createServer((request, response) => response.end(request.url === '/a'
    ? 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:item\r\nDTSTART:20990101T100000Z\r\nSUMMARY:Standalone\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:series\r\nDTSTART:20990101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=1\r\nSUMMARY:Series\r\nEND:VEVENT\r\nEND:VCALENDAR'
    : 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let config = await calendar.saveConfig(folder, `${base}/a`);
  assert.equal((await calendar.refreshCalendar(folder, config)).events.length, 2);
  config = await calendar.saveConfig(folder, `${base}/b`, config.revision);
  await calendar.refreshCalendar(folder, config);
  await calendar.saveConfig(folder, `${base}/a`, config.revision);
  assert.deepEqual((await calendar.loadCache(folder, `${base}/a`)).events.map(e => e.title), ['Standalone']);
});

test('migrates the last successful cache offline and seeds identifiable standalone history without retaining recurrence or generated IDs', async t => {
  const folder = await fixture(t);
  let feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  const server = http.createServer((request, response) => response.end(feed));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const events = [
    { id: 'legacy', title: 'Identified', description: '', location: '', start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z' },
    { id: 'series@2099-01-01T10:00:00Z', title: 'Recurring', description: '', location: '', start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z' },
    { id: randomUUID(), title: 'No UID', description: '', location: '', start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z' }
  ];
  await fs.writeFile(path.join(folder, 'clubmanager-calendar-cache.json'), JSON.stringify({
    version: 1, sourceUrl: url, fetchedAt: '2026-01-01T00:00:00.000Z', events
  }));
  assert.deepEqual((await calendar.loadCache(folder, url)).events.map(e => e.title), ['Identified', 'Recurring', 'No UID']);
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events.map(e => e.title), ['Identified']);
  assert.deepEqual((await calendar.loadCache(folder, url)).events.map(e => e.title), ['Identified']);
});

test('keeps the legacy cache usable and reports a failed offline migration', async t => {
  const folder = await fixture(t);
  const url = 'https://example.test/legacy.ics';
  const events = [{ id: 'legacy', title: 'Cached', description: '', location: '',
    start: '2099-01-01T10:00:00.000Z', end: '2099-01-01T11:00:00.000Z' }];
  const file = path.join(folder, 'clubmanager-calendar-cache.json');
  const original = JSON.stringify({ version: 1, sourceUrl: url, fetchedAt: '2026-01-01T00:00:00.000Z', events });
  await fs.writeFile(file, original);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', (source, target) => target === file
    ? Promise.reject(new Error('offline migration failed')) : rename(source, target));
  const cached = await calendar.loadCache(folder, url);
  assert.deepEqual(cached.events, events);
  assert.match(cached.migrationError, /offline migration failed/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('recurring and UID-less events remain available in the live cache but are not retained after omission', async t => {
  const folder = await fixture(t);
  let feed = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'DTSTART:20990101T100000Z', 'SUMMARY:No UID', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:series', 'DTSTART:20990101T100000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'SUMMARY:Series', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const server = http.createServer((request, response) => response.end(feed));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  assert.equal((await calendar.refreshCalendar(folder, config)).events.length, 3);
  assert.equal((await calendar.loadCache(folder, url)).events.length, 3);
  feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  assert.deepEqual((await calendar.refreshCalendar(folder, config)).events, []);
});

test('does not publish an in-flight refresh after its source becomes stale', async t => {
  const folder = await fixture(t);
  let respond;
  const server = http.createServer((request, response) => {
    respond = () => response.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const oldRefresh = calendar.refreshCalendar(folder, config);
  while (!respond) await new Promise(resolve => setTimeout(resolve, 5));

  await calendar.saveConfig(folder, 'https://other.example/calendar.ics', config.revision);
  respond();
  assert.deepEqual(await oldRefresh, { stale: true });
  assert.equal(await calendar.loadCache(folder, url), null);
});

test('rejects a refresh if the source changes away and back while it is in flight', async t => {
  const folder = await fixture(t);
  let respond;
  const server = http.createServer((request, response) => {
    respond = () => response.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const refresh = calendar.refreshCalendar(folder, config);
  while (!respond) await new Promise(resolve => setTimeout(resolve, 5));
  const changed = await calendar.saveConfig(folder, 'https://other.example/calendar.ics', config.revision);
  await calendar.saveConfig(folder, url, changed.revision);
  respond();
  assert.deepEqual(await refresh, { stale: true });
  assert.equal(await calendar.loadCache(folder, url), null);
});

test('does not publish an in-flight refresh after switching the active data folder', async t => {
  const folder = await fixture(t);
  let respond;
  const server = http.createServer((request, response) => {
    respond = () => response.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  let active = true;
  const oldRefresh = calendar.refreshCalendar(folder, config, () => active);
  while (!respond) await new Promise(resolve => setTimeout(resolve, 5));

  active = false;
  respond();
  assert.deepEqual(await oldRefresh, { stale: true });
  assert.equal(await calendar.loadCache(folder, url), null);
});

test('does not commit a refresh if the active folder changes while the cache is being written', async t => {
  const folder = await fixture(t);
  const server = http.createServer((request, response) => response.end(
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:item\r\nDTSTART:20990101T100000Z\r\nSUMMARY:Event\r\nEND:VEVENT\r\nEND:VCALENDAR'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  let active = true;
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    const result = await writeFile(file, ...args);
    if (String(file).includes('clubmanager-calendar-cache.json.') && String(file).endsWith('.tmp')) active = false;
    return result;
  });
  assert.deepEqual(await calendar.refreshCalendar(folder, config, () => active), { stale: true });
  assert.equal(await calendar.loadCache(folder, url), null);
});

test('reports cache write failures and preserves the previous successful cache', async t => {
  const folder = await fixture(t);
  let title = 'Shared event';
  const server = http.createServer((request, response) => {
    response.end(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:shared\r\nDTSTART:20261121T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const previous = await calendar.refreshCalendar(folder, config);
  const cacheFile = path.join(folder, 'clubmanager-calendar-cache.json');
  const original = await fs.readFile(cacheFile);

  title = 'Updated event';
  const rename = fs.rename;
  const write = t.mock.method(fs, 'rename', (source, target) => {
    if (target === cacheFile) return Promise.reject(Object.assign(new Error('fixture cache write failure'), { code: 'EIO' }));
    return rename(source, target);
  });
  await assert.rejects(calendar.refreshCalendar(folder, config), /Datenordner gespeichert.*fixture cache write failure/);
  assert.equal(write.mock.callCount(), 1);
  write.mock.restore();
  assert.deepEqual(await fs.readFile(cacheFile), original);
  assert.deepEqual(await calendar.loadCache(folder, url), previous);
  assert.deepEqual((await fs.readdir(folder)).filter(name => name.endsWith('.tmp')), []);
});

test('keeps the result of the last completed successful competing refresh', async t => {
  const folder = await fixture(t);
  let requests = 0;
  let releaseFirst;
  const firstRequest = new Promise(resolve => {
    releaseFirst = resolve;
  });

  const server = http.createServer((request, response) => {
    requests++;
    const number = requests;
    if (number === 1) {
      firstRequest.then(() => response.end('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:first\r\nDTSTART:20261121T100000Z\r\nSUMMARY:First refresh\r\nEND:VEVENT\r\nEND:VCALENDAR'));
      return;
    }
    response.end(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${number}\r\nDTSTART:20261121T100000Z\r\nSUMMARY:Refresh ${number}\r\nEND:VEVENT\r\nEND:VCALENDAR`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    releaseFirst();
    await new Promise(resolve => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const waitForRequests = async count => {
    for (let attempt = 0; attempt < 100 && requests < count; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(requests, count);
  };

  const first = calendar.refreshCalendar(folder, config);
  await waitForRequests(1);
  const second = calendar.refreshCalendar(folder, config);
  await waitForRequests(2);
  const completedFirst = await second;
  releaseFirst();
  const completedLast = await first;
  assert.notEqual(completedFirst.events[0].title, completedLast.events[0].title);
  assert.equal((await calendar.loadCache(folder, url)).events[0].title, completedLast.events[0].title);
});

test('concurrent app processes merge observed history without losing a successful refresh', async t => {
  const folder = await fixture(t);
  const requests = [];
  const server = http.createServer((request, response) => requests.push(response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  await calendar.saveConfig(folder, url);
  const script = `const c = require(${JSON.stringify(require.resolve('../src/main/calendar'))});
    c.loadConfig(process.argv[1]).then(config => c.refreshCalendar(process.argv[1], config))
      .then(() => process.exit(0), error => { console.error(error); process.exit(1); });`;
  const start = () => {
    const child = spawn(process.execPath, ['-e', script, folder], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(errors)));
    });
    return { child, done };
  };
  const waitFor = async count => {
    for (let i = 0; i < 200 && requests.length < count; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests.length, count);
  };
  const one = start();
  await waitFor(1);
  const two = start();
  t.after(() => { one.child.kill(); two.child.kill(); for (const response of requests) response.destroy(); });
  await waitFor(2);
  const event = id => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:20990101T100000Z\r\nSUMMARY:${id}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  requests[1].end(event('second'));
  await two.done;
  requests[0].end(event('first'));
  await one.done;
  assert.deepEqual((await calendar.loadCache(folder, url)).events.map(event => event.id).sort(), ['first', 'second']);
});
