const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { atomicWrite } = require('./storage');

const fileFor = folder => path.join(folder, 'clubmanager-calendar.json');

function normalizeUrl(input) {
  if (input === null || input === '') return null;
  if (typeof input !== 'string' || !input.trim()) throw new Error('Die Kalender-URL ist ungültig.');
  let value = input.trim();
  if (/^webcal:/i.test(value)) value = `https:${value.slice(value.indexOf(':') + 1)}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Die Kalender-URL ist ungültig.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Nur HTTPS-, HTTP- und webcal-URLs werden unterstützt.');
  }
  if (url.username || url.password) {
    throw new Error('Kalender-URLs mit Benutzername oder Passwort werden nicht unterstützt.');
  }
  return url.toString();
}

function encode(config) {
  return JSON.stringify({ version: 1, url: config.url }, null, 2) + '\n';
}

function revision(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function loadConfig(folder) {
  const file = fileFor(folder);
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { url: null, revision: null };
    throw new Error(`Die Kalender-Einstellungen konnten nicht gelesen werden: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Die Kalender-Einstellungen enthalten ungültiges JSON.');
  }
  if (!data || data.version !== 1 || !Object.hasOwn(data, 'url')) {
    throw new Error('Die Kalender-Einstellungen haben ein ungültiges oder nicht unterstütztes Format.');
  }
  let url;
  try {
    url = data.url == null ? null : normalizeUrl(data.url);
  } catch (error) {
    throw new Error(`Die gespeicherte Kalender-URL ist ungültig: ${error.message}`);
  }
  return { url, revision: revision(content) };
}

async function saveConfig(folder, input, expectedRevision) {
  let url;
  try {
    url = normalizeUrl(input);
  } catch (error) {
    throw new Error(`Die Kalender-Einstellungen konnten nicht gespeichert werden: ${error.message}`);
  }
  try {
    const file = fileFor(folder);
    if (expectedRevision !== undefined) {
      const current = await loadConfig(folder);
      if (current.revision !== expectedRevision) {
        throw new Error('Die Kalender-Einstellungen wurden geändert. Laden Sie die Einstellungen neu.');
      }
    }
    const content = encode({ url });
    await atomicWrite(file, content);
    return { url, revision: revision(content) };
  } catch (error) {
    throw new Error(`Die Kalender-Einstellungen konnten nicht gespeichert werden: ${error.message}`);
  }
}

function unfoldIcs(content) {
  const lines = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function unescapeIcs(value) {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '\\' || index + 1 === value.length) {
      result += value[index];
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === 'n' || escaped === 'N') {
      result += '\n';
      index++;
    } else if (escaped === ',' || escaped === ';' || escaped === '\\') {
      result += escaped;
      index++;
    } else {
      result += '\\';
    }
  }
  return result;
}

function parseIcsDate(value) {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  if (utc) return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  return new Date(+year, +month - 1, +day, +hour, +minute, +second);
}

function parseIcs(content) {
  if (!/(^|\n)BEGIN:VCALENDAR\b/i.test(String(content).replace(/\r/g, ''))) {
    throw new Error('Ungültige ICS-Kalenderdaten.');
  }
  const events = [];
  let inEvent = false;
  let fields = {};
  for (const line of unfoldIcs(content)) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      fields = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent) {
        const start = parseIcsDate(fields.DTSTART);
        const end = parseIcsDate(fields.DTEND);
        if (start && fields.STATUS !== 'CANCELLED' && fields.TRANSP !== 'TRANSPARENT') {
          events.push({
            id: unescapeIcs(fields.UID || crypto.randomUUID()),
            title: unescapeIcs(fields.SUMMARY || 'Ohne Titel'),
            description: unescapeIcs(fields.DESCRIPTION || ''),
            location: unescapeIcs(fields.LOCATION || ''),
            start: start.toISOString(),
            end: (end || new Date(start.getTime() + 60 * 60 * 1000)).toISOString()
          });
        }
      }
      inEvent = false;
      fields = {};
      continue;
    }
    if (!inEvent || !line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const name = left.split(';')[0].toUpperCase();
    fields[name] = line.slice(colon + 1);
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchIcs(input, redirects = 0) {
  const url = new URL(normalizeUrl(input));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Die Kalender-Quelle ist keine unterstützte HTTP- oder HTTPS-URL.');
  }
  if (redirects > 5) throw new Error('Die Kalender-Quelle führt eine Weiterleitungsschleife aus.');
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, { headers: { Accept: 'text/calendar, application/ics, text/plain' } }, response => {
      response.setEncoding('utf8');
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        try {
          resolve(fetchIcs(new URL(response.headers.location, url).toString(), redirects + 1));
        } catch {
          reject(new Error('Die Kalender-Quelle hat eine ungültige Weiterleitung zurückgegeben.'));
        }
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Die Kalender-Quelle ist nicht verfügbar (HTTP ${response.statusCode}).`));
        return;
      }
      let text = '';
      let tooLarge = false;
      response.on('data', chunk => {
        text += chunk;
        if (text.length > 10 * 1024 * 1024) {
          tooLarge = true;
          response.destroy();
        }
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        if (tooLarge) reject(new Error('Die Kalender-Quelle ist größer als 10 MB.'));
        else {
          try {
            resolve({ events: parseIcs(text), sourceUrl: url.protocol + '//' + url.host });
          } catch (error) {
            reject(new Error(`Die Kalender-Daten konnten nicht gelesen werden: ${error.message}`));
          }
        }
      });
      response.on('error', () => {
        if (settled) return;
        settled = true;
        reject(new Error('Die Kalender-Quelle konnte nicht gelesen werden.'));
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('Die Kalender-Quelle hat zu lange nicht geantwortet.')));
    request.on('error', error => {
      if (settled) return;
      settled = true;
      const timeout = /timed out/i.test(error.message);
      reject(new Error(timeout
        ? 'Die Kalender-Quelle hat zu lange nicht geantwortet.'
        : 'Die Kalender-Quelle ist nicht erreichbar oder nicht verfügbar.'));
    });
  });
}

module.exports = { normalizeUrl, loadConfig, saveConfig, parseIcs, fetchIcs };
