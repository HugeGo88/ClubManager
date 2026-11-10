const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDate } = require('../shared/dates');

const MODULES = ['meetings', 'invoices', 'members', 'letters'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function initializeFolder(folder) {
  for (const name of MODULES) {
    await fs.mkdir(path.join(folder, name), { recursive: true });
  }
}

function meetingPath(folder, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Ungültige Sitzungs-ID.');
  return path.join(folder, 'meetings', `${id}.json`);
}

function protocolPath(folder, id) {
  meetingPath(folder, id);
  return path.join(folder, 'meetings', 'protocols', `${id}.pdf`);
}

async function hasProtocol(folder, id) {
  const file = protocolPath(folder, id);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) throw new Error('Das Protokoll-PDF ist keine reguläre Datei.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function revision(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function atomicWrite(file, content) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function validateMeeting(meeting) {
  const string = value => typeof value === 'string';
  if (!meeting || !ID.test(meeting.id) || !string(meeting.title) ||
      !string(meeting.date) || !Array.isArray(meeting.attendance) ||
      !Array.isArray(meeting.points)) throw new Error('Ungültige Sitzungsdaten.');
  for (const person of meeting.attendance) {
    if (!person || !string(person.name) ||
        !['attending', 'excused', 'unexcused'].includes(person.status)) {
      throw new Error('Ungültige Anwesenheitsdaten.');
    }
  }
  for (const point of meeting.points) {
    if (!point || !string(point.headline) || !string(point.details) ||
        !['discussion', 'decision', 'info'].includes(point.type) ||
        !Array.isArray(point.tasks)) throw new Error('Ungültiger TOP.');
    for (const task of point.tasks) {
      if (!task || !string(task.description) || !string(task.responsible) ||
          typeof task.done !== 'boolean') throw new Error('Ungültige Aufgabe.');
      if (task.dueDate !== undefined && task.dueDate !== '' && !isDate(task.dueDate)) {
        throw new Error('Ungültiges Fälligkeitsdatum für die Aufgabe.');
      }
      if (task.completedDate !== undefined && (!task.done || !isDate(task.completedDate))) {
        throw new Error('Ungültiges Erledigungsdatum für die Aufgabe.');
      }
    }
  }
}

async function listMeetings(folder) {
  const entries = await fs.readdir(path.join(folder, 'meetings'), { withFileTypes: true });
  const meetings = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    const file = meetingPath(folder, id);
    const content = await fs.readFile(file, 'utf8');
    let record;
    try {
      record = JSON.parse(content);
    } catch {
      throw new Error(`${entry.name} konnte nicht gelesen werden: ungültiges JSON.`);
    }
    if (record.version !== 1 || record.meeting?.id !== id) {
      throw new Error(`${entry.name} konnte nicht gelesen werden: nicht unterstützter oder ungültiger Datensatz.`);
    }
    validateMeeting(record.meeting);
    meetings.push({ meeting: record.meeting, revision: revision(content) });
  }
  return meetings.sort((a, b) => b.meeting.date.localeCompare(a.meeting.date));
}

async function saveMeeting(folder, meeting, expectedRevision) {
  validateMeeting(meeting);
  const file = meetingPath(folder, meeting.id);
  let existing;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((existing === undefined ? null : revision(existing)) !== expectedRevision) {
    throw new Error('Die Sitzung wurde auf dem Datenträger geändert. Laden Sie sie vor dem Speichern neu, um keine Änderungen zu überschreiben.');
  }
  const content = JSON.stringify({ version: 1, meeting }, null, 2) + '\n';
  await atomicWrite(file, content);
  return revision(content);
}

module.exports = { initializeFolder, listMeetings, saveMeeting, atomicWrite, validateMeeting, protocolPath, hasProtocol };
