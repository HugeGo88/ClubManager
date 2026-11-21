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
    'DESCRIPTION:<b>readable text</b>',
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
  assert.equal(events[0].description, '<b>readable text</b>');
  assert.equal(events[0].location, 'Clubhaus');
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
