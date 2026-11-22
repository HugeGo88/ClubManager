const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const ICAL = require('ical.js');
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
  return JSON.stringify({ version: 1, url: config.url, generation: crypto.randomUUID() }, null, 2) + '\n';
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
  let lock;
  try {
    lock = await acquireCacheLock(folder);
    const file = fileFor(folder);
    if (expectedRevision !== undefined) {
      const current = await loadConfig(folder);
      if (current.revision !== expectedRevision) {
        throw new Error('Die Kalender-Einstellungen wurden geändert. Laden Sie die Einstellungen neu.');
      }
    }
    const content = encode({ url });
    await atomicWrite(file, content, () => lock.assert());
    return { url, revision: revision(content) };
  } catch (error) {
    throw new Error(`Die Kalender-Einstellungen konnten nicht gespeichert werden: ${error.message}`);
  } finally {
    await lock?.release();
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

function zonedWallTimeToIso(time, tzid) {
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    let guess = wall;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
      const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const correction = representedAsUtc - wall;
      guess -= correction;
      if (correction === 0) break;
    }
    return new Date(guess).toISOString();
  } catch {
    return new Date(wall).toISOString();
  }
}

function timeToIso(property, time) {
  if (property && property.getParameter('tzid')) {
    const tzid = property.getParameter('tzid');
    if (!time.zone || time.zone.tzid !== tzid) {
      return zonedWallTimeToIso(time, tzid);
    }
  }
  return time.toJSDate().toISOString();
}

function allDayIso(time) {
  return new Date(Date.UTC(time.year, time.month - 1, time.day)).toISOString();
}

function recurrenceKey(property, time) {
  return time.isDate ? allDayIso(time) : timeToIso(property, time);
}

function anonymousSeriesId(component) {
  const [name, properties, children] = component.toJSON();
  const identity = [name, properties.filter(property => !['rrule', 'rdate', 'exdate'].includes(property[0])), children];
  return `uidless:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function uidlessSeriesIdForOccurrence(components, recurrenceProperty, recurrenceId) {
  for (const component of components) {
    if (component.getFirstPropertyValue('uid')) continue;
    if (!component.hasProperty('rrule') && !component.hasProperty('rdate')) continue;
    const startProperty = component.getFirstProperty('dtstart');
    if (!startProperty) continue;
    try {
      const event = new ICAL.Event(component);
      const iterator = event.iterator();
      let occurrence;
      while ((occurrence = iterator.next()) && occurrence.year <= 2100) {
        if (recurrenceKey(startProperty, occurrence) === recurrenceKey(recurrenceProperty, recurrenceId)) {
          return anonymousSeriesId(component);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function parseCalendar(content) {
  let jcal;
  try {
    jcal = ICAL.parse(String(content));
  } catch {
    throw new Error('Ungültige ICS-Kalenderdaten.');
  }
  const calendar = new ICAL.Component(jcal);
  if (calendar.name !== 'vcalendar') throw new Error('Ungültige ICS-Kalenderdaten.');

  for (const timezone of calendar.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(new ICAL.Timezone(timezone));
    } catch {
      // Unknown or malformed timezone components are left to the fallback parser.
    }
  }

  const events = [];
  const standalone = [];
  const cancellations = [];
  const anonymousCancellations = [];
  const seriesCancellations = [];
  const anonymousSeriesCancellations = new Set();
  const components = calendar.getAllSubcomponents('vevent');
  for (const component of components) {
    const identified = component.getFirstPropertyValue('uid');
    const uid = identified ||
      ((component.hasProperty('rrule') || component.hasProperty('rdate')) ? anonymousSeriesId(component) : null);
    const recurrenceProperty = component.getFirstProperty('recurrence-id');
    const recurrenceId = recurrenceProperty?.getFirstValue();
    const recurrenceUid = recurrenceId
      ? uidlessSeriesIdForOccurrence(components, recurrenceProperty, recurrenceId)
      : null;
    if (component.getFirstPropertyValue('status') === 'CANCELLED') {
      if (recurrenceId && identified) cancellations.push(`${identified}@${recurrenceKey(recurrenceProperty, recurrenceId)}`);
      else if (recurrenceId && recurrenceUid) anonymousCancellations.push(`${recurrenceUid}@${recurrenceKey(recurrenceProperty, recurrenceId)}`);
      else if (uid) {
        cancellations.push(uid);
        seriesCancellations.push(uid);
        if (!identified) anonymousSeriesCancellations.add(uid);
      }
    }
    for (const exdate of component.getAllProperties('exdate')) {
      for (const date of exdate.getValues()) {
        (identified ? cancellations : anonymousCancellations).push(`${uid}@${recurrenceKey(exdate, date)}`);
      }
    }
  }
  const cancelled = new Set(cancellations);
  const anonymousCancelled = new Set(anonymousCancellations);
  const cancelledSeries = new Set(seriesCancellations);
  const emitted = new Set();
  for (const component of [...components.filter(item => !item.hasProperty('recurrence-id')),
    ...components.filter(item => item.hasProperty('recurrence-id'))]) {
    const identified = component.getFirstPropertyValue('uid');
    const recurring = component.hasProperty('rrule') || component.hasProperty('rdate') ||
      component.hasProperty('recurrence-id');
    if (identified && cancelledSeries.has(identified)) continue;
    if (component.getFirstPropertyValue('status') === 'CANCELLED') {
      continue;
    }
    if (component.hasProperty('recurrence-id') && !identified) continue;
    const startProperty = component.getFirstProperty('dtstart');
    if (!startProperty) continue;
    let startValue;
    try {
      startValue = startProperty.getFirstValue();
    } catch {
      continue;
    }
    if (!startValue) continue;
    const uidless = !identified;
    const uid = identified || (recurring ? anonymousSeriesId(component)
      : `uidless:${crypto.createHash('sha256').update(JSON.stringify(component.toJSON())).digest('hex')}`);
    if (!identified && anonymousSeriesCancellations.has(uid)) continue;
    const append = (startTime, endTime, item, occurrenceKey) => {
      if (!startTime) return;
      const status = item?.component?.getFirstPropertyValue('status');
      if (status === 'CANCELLED') return;

      const startProperty = item?.component?.getFirstProperty('dtstart') ||
        component.getFirstProperty('dtstart');
      const endProperty = item?.component?.getFirstProperty('dtend') ||
        component.getFirstProperty('dtend');
      const allDay = Boolean(startTime.isDate);
      let start;
      let end;
      if (allDay) {
        start = allDayIso(startTime);
        end = endTime ? allDayIso(endTime) : allDayIso(startTime);
        if (!endTime) {
          const next = startTime.clone();
          next.day++;
          end = allDayIso(next);
        }
      } else {
        start = timeToIso(startProperty, startTime);
        if (endTime) {
          end = timeToIso(endProperty, endTime);
        } else {
          const durationProperty = item?.component?.getFirstProperty('duration') ||
            component.getFirstProperty('duration');
          if (durationProperty) {
            try {
              const next = startTime.clone();
              next.addDuration(durationProperty.getFirstValue());
              end = timeToIso(startProperty, next);
            } catch {
              end = new Date(new Date(start).getTime() + 3600000).toISOString();
            }
          } else {
          const next = new Date(start);
          end = new Date(next.getTime() + (allDay ? 86400000 : 3600000)).toISOString();
          }
        }
      }

      const titleProperty = item?.component?.getFirstProperty('summary') ||
        component.getFirstProperty('summary');
      const descriptionProperty = item?.component?.getFirstProperty('description') ||
        component.getFirstProperty('description');
      const locationProperty = item?.component?.getFirstProperty('location') ||
        component.getFirstProperty('location');
      events.push({
        id: `${uid}${occurrenceKey ? `@${occurrenceKey}` : ''}`,
        title: titleProperty?.getFirstValue() || 'Ohne Titel',
        description: descriptionProperty?.getFirstValue() || '',
        location: locationProperty?.getFirstValue() || '',
        start,
        end,
        allDay,
        ...(uidless ? { uidless: true } : {})
      });
      emitted.add(eventKey(events[events.length - 1]));
      standalone.push(recurring
        ? { ...events[events.length - 1], ...(identified ? { seriesUid: identified } : {}) }
        : events[events.length - 1]);
    };

    if (component.hasProperty('recurrence-id')) {
      const property = component.getFirstProperty('recurrence-id');
      const key = recurrenceKey(property, property.getFirstValue());
      if (!emitted.has(eventKey({ id: `${uid}@${key}` })) && !cancelled.has(`${uid}@${key}`)) {
        append(startValue, component.getFirstProperty('dtend')?.getFirstValue() || null, { component }, key);
      }
    } else if (component.hasProperty('rrule') || component.hasProperty('rdate')) {
      let event;
      const exceptions = components.filter(candidate =>
        candidate.hasProperty('recurrence-id') &&
        (identified
          ? candidate.getFirstPropertyValue('uid') === identified
          : !candidate.getFirstPropertyValue('uid')));
      const exceptionsByKey = new Map(exceptions.map(candidate => {
        const property = candidate.getFirstProperty('recurrence-id');
        return [recurrenceKey(property, property.getFirstValue()), candidate];
      }));
      try {
        event = new ICAL.Event(component, { exceptions });
      } catch {
        continue;
      }
      const iterator = event.iterator();
      let occurrence;
      let count = 0;
      while ((occurrence = iterator.next()) && count < 10000) {
        count++;
        if (occurrence.year > 2100) break;
        const key = recurrenceKey(startProperty, occurrence);
        if ((uidless ? anonymousCancelled : cancelled).has(`${uid}@${key}`)) continue;
        const exception = exceptionsByKey.get(key);
        let details;
        if (exception) {
          if (!exception.hasProperty('dtstart')) continue;
          const item = new ICAL.Event(exception);
          details = { item, startDate: item.startDate, endDate: item.endDate };
        } else {
          details = event.getOccurrenceDetails(occurrence);
        }
        const item = details.item;
        const status = item?.component?.getFirstPropertyValue('status');
        if (status === 'CANCELLED') continue;
        append(details.startDate, details.endDate, item, key);
      }
    } else {
      const endProperty = component.getFirstProperty('dtend');
      const endTime = endProperty?.getFirstValue() || null;
      append(startValue, endTime, { component }, null);
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, standalone, cancellations, anonymousCancellations, seriesCancellations };
}

function parseIcs(content) {
  return parseCalendar(content).events;
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
            const parsed = parseCalendar(text);
            resolve({ ...parsed, sourceUrl: url.protocol + '//' + url.host });
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

const cacheFileFor = folder => path.join(folder, 'clubmanager-calendar-cache.json');
const cacheLockFor = folder => path.join(folder, 'clubmanager-calendar-cache.lock');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function acquireCacheLock(folder) {
  const lockPath = cacheLockFor(folder);
  const ownerFile = path.join(lockPath, 'owner.json');
  const reclaimPath = `${lockPath}.reclaim`;
  const timeout = Date.now() + 120000;

  while (Date.now() < timeout) {
    try {
      await fs.mkdir(lockPath);
      const token = crypto.randomUUID();
      try {
        await fs.writeFile(ownerFile, JSON.stringify({ token }));
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return {
        assert: async () => {
          let owner;
          try {
            owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
          } catch (error) {
            throw new Error(`Die gemeinsame Kalender-Sperre konnte nicht geprüft werden: ${error.message}`);
          }
          if (owner?.token !== token) {
            throw new Error('Die gemeinsame Kalender-Sperre wurde von einem anderen Vorgang übernommen.');
          }
        },
        release: async () => {
          let owner;
          try {
            owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
          } catch (error) {
            if (error.code === 'ENOENT') return;
            throw new Error(`Die gemeinsame Kalender-Sperre konnte nicht freigegeben werden: ${error.message}`);
          }
          if (owner?.token === token) await fs.rm(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (Date.now() - stat.mtimeMs > 30000) {
      let reclaim;
      try {
        await fs.mkdir(reclaimPath);
        reclaim = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      if (reclaim) {
        try {
          const current = await fs.stat(lockPath);
          if (current.ino === stat.ino && Date.now() - current.mtimeMs > 30000) {
            await fs.rm(lockPath, { recursive: true, force: true });
          }
        } finally {
          await fs.rm(reclaimPath, { recursive: true, force: true });
        }
      }
    }
    await delay(50);
  }
  throw new Error('Das Aktualisieren des Kalenders dauert zu lange, weil ein anderer Vorgang den gemeinsamen Cache verwendet.');
}

async function loadCacheRecord(folder) {
  let content;
  try {
    content = await fs.readFile(cacheFileFor(folder), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Der gespeicherte Kalender konnte nicht gelesen werden: ${error.message}`);
  }
  let cache;
  try {
    cache = JSON.parse(content);
  } catch {
    throw new Error('Der gespeicherte Kalender enthält ungültiges JSON.');
  }
  if (!cache || ![1, 2].includes(cache.version)) {
    throw new Error('Der gespeicherte Kalender hat ein ungültiges oder nicht unterstütztes Format.');
  }
  const sources = cache.version === 1 ? [cache] : cache.sources;
  const validEvent = event => event && typeof event.id === 'string' &&
    (event.seriesUid === undefined || typeof event.seriesUid === 'string') &&
    typeof event.title === 'string' && typeof event.description === 'string' &&
    typeof event.location === 'string' &&
    (event.allDay === undefined || typeof event.allDay === 'boolean') &&
    (event.uidless === undefined || event.uidless === true) &&
    Number.isFinite(Date.parse(event.start)) && Number.isFinite(Date.parse(event.end));
  if (!Array.isArray(sources) || sources.some(source => !source ||
      typeof source.sourceUrl !== 'string' || typeof source.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(source.fetchedAt)) ||
      (source.completedAt !== undefined && !Number.isFinite(source.completedAt)) ||
      (source.completionId !== undefined && typeof source.completionId !== 'string') ||
      (source.hasLiveSnapshot !== undefined && typeof source.hasLiveSnapshot !== 'boolean') ||
      (source.uidlessHistorySeeded !== undefined && typeof source.uidlessHistorySeeded !== 'boolean') ||
      !Array.isArray(source.events) || source.events.some(event => !validEvent(event)) ||
      (cache.version === 2 && (!Array.isArray(source.history) ||
        source.history.some(event => !validEvent(event)) ||
        !Array.isArray(source.tombstones) || source.tombstones.some(uid => typeof uid !== 'string'))))) {
    throw new Error('Der gespeicherte Kalender enthält ungültige Daten.');
  }
  return cache;
}

function upgradeCache(cache) {
  if (!cache) return { version: 2, sources: [] };
  const occurrenceId = /@(?:\d{8}(?:T\d{6}Z?)?|\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?)$/;
  const generatedId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const sources = cache.version === 1
    ? [{ ...cache, history: cache.events.filter(event => !occurrenceId.test(event.id)),
      tombstones: [], hasLiveSnapshot: true, version: undefined }]
    : cache.sources;
  return { version: 2, sources: sources.map(source => {
    if (source.uidlessHistorySeeded) return source;
    const history = new Map(source.history.map(event => [eventKey(event), event]));
    for (const event of source.events) {
      if (generatedId.test(event.id) && !history.has(eventKey(event))) {
        history.set(eventKey(event), event);
      }
    }
    return { ...source, history: [...history.values()], uidlessHistorySeeded: true };
  }) };
}

function eligible(event, now) {
  const expiry = new Date(event.end);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 2);
  return now < expiry.getTime();
}

function eventKey(event) {
  return `${event.uidless ? 'anonymous' : 'identified'}:${event.id}`;
}

function visible(source, now = Date.now()) {
  const liveIds = new Set(source.events.map(eventKey));
  return {
    events: [...source.events, ...source.history.filter(event => !liveIds.has(eventKey(event)) && eligible(event, now))
      .map(({ seriesUid, ...event }) => event)]
      .sort((a, b) => a.start.localeCompare(b.start)),
    fetchedAt: source.fetchedAt
  };
}

class StaleRefresh extends Error {}

async function writeCache(folder, cache, lock, isCurrent = async () => true) {
  try {
    await atomicWrite(cacheFileFor(folder), JSON.stringify(cache, null, 2) + '\n', async () => {
      await lock.assert();
      if (!await isCurrent()) throw new StaleRefresh();
    });
  } catch (error) {
    if (error instanceof StaleRefresh) throw error;
    throw new Error(`Der Kalender konnte nicht im Datenordner gespeichert werden: ${error.message}`);
  }
}

async function loadCache(folder, input) {
  const url = normalizeUrl(input);
  if (!url) return null;
  let cache = await loadCacheRecord(folder);
  const needsUpgrade = record => record?.version === 1
    ? record.sourceUrl === url
    : record?.sources.some(source => source.sourceUrl === url && !source.uidlessHistorySeeded);
  const fallback = record => record.version === 1
    ? { events: record.events, fetchedAt: record.fetchedAt }
    : visible(record.sources.find(source => source.sourceUrl === url));
  if (needsUpgrade(cache)) {
    let lock;
    try {
      lock = await acquireCacheLock(folder);
    } catch (error) {
      return { ...fallback(cache), migrationError: error.message };
    }
    try {
      cache = await loadCacheRecord(folder);
      if (needsUpgrade(cache)) {
        const upgraded = upgradeCache(cache);
        try {
          await writeCache(folder, upgraded, lock);
          cache = upgraded;
        } catch (error) {
          return { ...fallback(cache), migrationError: error.message };
        }
      }
    } finally {
      await lock.release();
    }
  }
  const source = upgradeCache(cache).sources.find(item => item.sourceUrl === url);
  if (!source) return null;
  const result = visible(source);
  return source.hasLiveSnapshot === false && !result.events.length ? null : result;
}

async function refreshCalendar(folder, config, isCurrent = async () => true) {
  const url = normalizeUrl(config?.url);
  if (!url) throw new Error('Für diesen Datenordner ist keine Kalender-URL eingerichtet.');
  if (!await isCurrent()) return { stale: true };
  const beforeFetch = await loadConfig(folder);
  if (beforeFetch.url !== url || beforeFetch.revision !== config.revision) return { stale: true };
  const result = await fetchIcs(url);
  const completedAt = performance.timeOrigin + performance.now();
  const completionId = crypto.randomUUID();
  if (!await isCurrent()) return { stale: true };

  let lock;
  try {
    lock = await acquireCacheLock(folder);
  } catch (error) {
    throw new Error(`Der Kalender konnte nicht im Datenordner gespeichert werden: ${error.message}`);
  }
  try {
    await lock.assert();
    const current = await loadConfig(folder);
    if (current.url !== url || current.revision !== config.revision || !await isCurrent()) return { stale: true };

    const cache = upgradeCache(await loadCacheRecord(folder));
    const previous = cache.sources.find(item => item.sourceUrl === url);
    if (previous &&
        (previous.completedAt > completedAt ||
         (previous.completedAt === completedAt && previous.completionId > completionId))) {
      return await isCurrent() ? visible(previous) : { stale: true };
    }

    const history = new Map((previous?.history || []).map(event => [eventKey(event), event]));
    const tombstones = new Set(previous?.tombstones || []);
    for (const uid of result.seriesCancellations) {
      for (const [id, event] of history) {
        if (event.seriesUid === uid) history.delete(id);
      }
    }
    for (const uid of result.cancellations) {
      history.delete(eventKey({ id: uid }));
      tombstones.add(uid);
    }
    for (const id of result.anonymousCancellations) history.delete(eventKey({ id, uidless: true }));
    for (const event of result.standalone) {
      history.set(eventKey(event), event);
      if (!event.uidless) tombstones.delete(event.id);
    }
    const now = Date.now();
    const active = new Set(result.standalone.map(eventKey));
    for (const [uid, event] of history) {
      if (!active.has(uid) && !eligible(event, now)) history.delete(uid);
    }
    const source = {
      sourceUrl: url,
      completedAt,
      completionId,
      events: result.events,
      hasLiveSnapshot: true,
      uidlessHistorySeeded: true,
      fetchedAt: new Date(completedAt).toISOString(),
      history: [...history.values()],
      tombstones: [...tombstones]
    };
    cache.sources = cache.sources.filter(item => item.sourceUrl !== url)
      .map(item => ({ ...item, events: [], hasLiveSnapshot: false }));
    cache.sources.push(source);
    try {
      await writeCache(folder, cache, lock, isCurrent);
    } catch (error) {
      if (error instanceof StaleRefresh) return { stale: true };
      throw error;
    }
    const afterWrite = await loadConfig(folder);
    if (afterWrite.url !== url || afterWrite.revision !== config.revision || !await isCurrent()) {
      return { stale: true };
    }
    return visible(source, now);
  } finally {
    await lock.release();
  }
}

module.exports = { normalizeUrl, loadConfig, saveConfig, parseIcs, fetchIcs, loadCache, refreshCalendar };
