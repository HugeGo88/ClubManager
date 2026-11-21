const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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

test('reports cache write failures and preserves the previous successful cache', async t => {
  const folder = await fixture(t);
  const server = http.createServer((request, response) => {
    response.end('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:shared\r\nDTSTART:20261121T100000Z\r\nSUMMARY:Shared event\r\nEND:VEVENT\r\nEND:VCALENDAR');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/calendar.ics`;
  const config = await calendar.saveConfig(folder, url);
  const previous = await calendar.refreshCalendar(folder, config);

  await fs.chmod(folder, 0o500);
  try {
    await assert.rejects(calendar.refreshCalendar(folder, config), /Datenordner gespeichert/);
  } finally {
    await fs.chmod(folder, 0o700);
  }
  assert.deepEqual(await calendar.loadCache(folder, url), previous);
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
