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

test('rejects invalid meeting data and reports corrupt records', async t => {
  const folder = await fixture(t);
  const data = meeting();
  data.points[0].type = 'invalid';
  await assert.rejects(storage.saveMeeting(folder, data, null), /Ungültiges Traktandum/);
  data.id = '../escape';
  await assert.rejects(storage.saveMeeting(folder, data, null), /Ungültige Sitzungsdaten/);
  const file = path.join(folder, 'meetings', `${crypto.randomUUID()}.json`);
  await fs.writeFile(file, '{broken');
  await assert.rejects(storage.listMeetings(folder), /ungültiges JSON/);
});
