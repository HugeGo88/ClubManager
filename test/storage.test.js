const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const storage = require('../src/main/storage');

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'clubmanager-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await storage.initializeFolder(folder);
  return folder;
}

function meeting() {
  return {
    id: crypto.randomUUID(), title: 'Committee', date: '2026-11-10',
    attendance: [{ name: 'Alex', status: 'excused' }],
    points: [{ headline: 'Budget', type: 'decision', details: '**Discuss**', tasks: [{ description: 'Review', responsible: 'Alex, Sam', done: false }] }]
  };
}

test('creates module folders and saves and reloads a meeting', async t => {
  const folder = await fixture(t);
  assert.deepEqual((await fs.readdir(folder)).sort(), ['invoices', 'letters', 'meetings', 'members']);
  const data = meeting();
  const revision = await storage.saveMeeting(folder, data, null);
  assert.deepEqual(await storage.listMeetings(folder), [{ meeting: data, revision }]);
  data.points[0].tasks[0].done = true;
  const next = await storage.saveMeeting(folder, data, revision);
  assert.notEqual(next, revision);
  assert.deepEqual((await storage.listMeetings(folder))[0].meeting, data);
});

test('does not overwrite a meeting changed or removed on disk', async t => {
  const folder = await fixture(t);
  const data = meeting();
  const revision = await storage.saveMeeting(folder, data, null);
  await assert.rejects(storage.saveMeeting(folder, data, null), /auf dem Datenträger geändert/);
  const file = path.join(folder, 'meetings', `${data.id}.json`);
  const external = '{"external":true}\n';
  await fs.writeFile(file, external);
  await assert.rejects(storage.saveMeeting(folder, data, revision), /auf dem Datenträger geändert/);
  assert.equal(await fs.readFile(file, 'utf8'), external);
  await fs.unlink(file);
  await assert.rejects(storage.saveMeeting(folder, data, revision), /auf dem Datenträger geändert/);
});

test('preserves optional TOP responsibility and rejects invalid values', async t => {
  const folder = await fixture(t);
  const data = meeting();
  let revision = await storage.saveMeeting(folder, data, null);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].responsible, undefined);
  data.points[0].responsible = 'Alex & Sam';
  revision = await storage.saveMeeting(folder, data, revision);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].responsible, 'Alex & Sam');
  for (const invalid of [null, 123, {}, []]) {
    data.points[0].responsible = invalid;
    await assert.rejects(storage.saveMeeting(folder, data, revision), /Ungültige verantwortliche Person/);
  }
  data.points[0].responsible = '';
  await storage.saveMeeting(folder, data, revision);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].responsible, '');
});

test('rejects invalid meeting data and reports corrupt records', async t => {
  const folder = await fixture(t);
  const data = meeting();
  data.points[0].type = 'invalid';
  await assert.rejects(storage.saveMeeting(folder, data, null), /Ungültiger TOP/);
  data.id = '../escape';
  await assert.rejects(storage.saveMeeting(folder, data, null), /Ungültige Sitzungsdaten/);
  const file = path.join(folder, 'meetings', `${crypto.randomUUID()}.json`);
  await fs.writeFile(file, '{broken');
  await assert.rejects(storage.listMeetings(folder), /ungültiges JSON/);
});

test('locates protocol PDFs safely and rejects non-files', async t => {
  const folder = await fixture(t);
  const data = meeting();
  assert.equal(await storage.hasProtocol(folder, data.id), false);
  assert.throws(() => storage.protocolPath(folder, '../escape'), /Ungültige Sitzungs-ID/);
  const directory = path.join(folder, 'meetings', 'protocols');
  await fs.mkdir(directory);
  const file = storage.protocolPath(folder, data.id);
  await fs.writeFile(file, '%PDF-test');
  assert.equal(await storage.hasProtocol(folder, data.id), true);
  await fs.unlink(file);
  await fs.mkdir(file);
  await assert.rejects(storage.hasProtocol(folder, data.id), /keine reguläre Datei/);
});

test('persists optional due dates and rejects invalid calendar dates', async t => {
  const folder = await fixture(t);
  const data = meeting();
  const task = data.points[0].tasks[0];
  task.dueDate = '2028-02-29';
  let revision = await storage.saveMeeting(folder, data, null);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].tasks[0].dueDate, '2028-02-29');
  for (const invalid of ['2026-02-29', '2026-13-01', 'not a date', null, 123]) {
    task.dueDate = invalid;
    await assert.rejects(storage.saveMeeting(folder, data, revision), /Ungültiges Fälligkeitsdatum/);
  }
  task.dueDate = '';
  revision = await storage.saveMeeting(folder, data, revision);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].tasks[0].dueDate, '');
  delete task.dueDate;
  await storage.saveMeeting(folder, data, revision);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].tasks[0].dueDate, undefined);
});

test('preserves legacy completed tasks and validates optional completion dates', async t => {
  const folder = await fixture(t);
  const data = meeting();
  const task = data.points[0].tasks[0];
  task.done = true;
  let revision = await storage.saveMeeting(folder, data, null);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].tasks[0].completedDate, undefined);
  task.completedDate = '2028-02-29';
  revision = await storage.saveMeeting(folder, data, revision);
  assert.equal((await storage.listMeetings(folder))[0].meeting.points[0].tasks[0].completedDate, '2028-02-29');
  for (const invalid of ['', '2026-02-29', null, 123]) {
    task.completedDate = invalid;
    await assert.rejects(storage.saveMeeting(folder, data, revision), /Ungültiges Erledigungsdatum/);
  }
  task.done = false;
  task.completedDate = '2026-11-10';
  await assert.rejects(storage.saveMeeting(folder, data, revision), /Ungültiges Erledigungsdatum/);
  delete task.completedDate;
  await storage.saveMeeting(folder, data, revision);
});
