const app = document.querySelector('#app');
document.querySelector('.activity').inert = true;
const state = { view: 'meetings', version: null, changelog: null, folder: null, protocolCss: null, modules: { meetings: true, members: false, invoices: false, letters: false }, meetings: [], meeting: null, revision: null, hasProtocol: false, dirty: false, message: '', error: false };
const taskView = { search: '', responsible: '', sort: 'date', direction: 'descending' };
const decisionView = { search: '', result: '', expanded: '' };
const topView = { search: '', type: '', meeting: '', expanded: '' };
let includeEarlierTasks = false;
const taskCollator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
let meetingNavExpanded = true;
let settingsTab = 'general';
const MODULES = [
  ['meetings', 'Sitzungen', 'Besprechungen und Protokolle'],
  ['members', 'Mitglieder', 'Mitgliederverwaltung und Geburtstage'],
  ['invoices', 'Rechnungen', 'Rechnungen erstellen und verwalten'],
  ['letters', 'Briefe', 'Serienbriefe und persönliche Briefe']
];
let markdownEditors = [];
let taskDateRefresh;
let displayedTaskDate;

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const button = (action, text, extra = '') => `<button class="action ${extra}" data-action="${action}">${text}</button>`;

function blankMeeting() {
  return { id: crypto.randomUUID(), title: '', date: '', attendance: [], points: [] };
}

function confirmDiscard() {
  return !state.dirty || window.confirm('Ungespeicherte Änderungen verwerfen?');
}

function notice() {
  return state.message ? `<p role="status" class="notice ${state.error ? 'error' : ''}">${escape(state.message)}</p>` : '';
}

function setMessage(message, error = false) {
  state.message = message;
  state.error = error;
}

function meetingList() {
  return `<aside class="list"><h2>Sitzungen</h2>
    ${button('new', '+ Neue Sitzung', 'primary')}
    ${state.meetings.length ? state.meetings.map(({ meeting }) =>
      `<button class="list-item ${state.meeting?.id === meeting.id ? 'selected' : ''}" data-action="select" data-id="${escape(meeting.id)}">
      <strong>${escape(meeting.title || 'Sitzung ohne Titel')}</strong><small>${escape(meeting.date ? formatDate(meeting.date) : 'Kein Datum')}</small></button>`).join('') :
      '<p>Noch keine Sitzungen gespeichert.</p>'}
  </aside>`;
}

function options(values, selected) {
  return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function formatDate(value) {
  return clubDates.formatDate(value);
}

function setTaskDone(task, done) {
  if (task.done === done) return;
  task.done = done;
  if (done) task.completedDate = clubDates.localDate();
  else delete task.completedDate;
}

function decisionFields(point, i) {
  const vote = point.vote;
  const showCounts = vote?.result === 'accepted' || vote?.result === 'rejected';
  return `<div class="decision-fields">
    <label>Abstimmungsergebnis (optional)<select data-point="${i}" data-vote-result>
      ${options([['', 'Kein Ergebnis ausgewählt'], ...Object.entries(clubDeutsch.voteResult)], vote?.result || '')}
    </select></label>
    <div class="vote-counts" ${showCounts ? '' : 'hidden'}>
      ${[['yes', 'Ja-Stimmen'], ['no', 'Gegenstimmen'], ['abstain', 'Enthaltungen']].map(([key, label]) =>
        `<label>${label} (optional)<input type="number" min="0" step="1" data-point="${i}" data-vote-count="${key}" value="${escape(vote?.[key] ?? '')}"></label>`).join('')}
    </div>
  </div>`;
}

function meetingEditor(meeting) {
  return `<div class="topline meeting-toolbar"><div><h1>Sitzung bearbeiten</h1><p class="status">${state.dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert'}</p></div>
    <div class="row meeting-actions">${state.hasProtocol ? button('open-protocol', 'Gespeichertes PDF öffnen') : ''}
      <label class="checkbox export-option"><input type="checkbox" data-include-earlier-tasks ${includeEarlierTasks ? 'checked' : ''}> Offene Aufgaben früherer Sitzungen einbeziehen</label>
      ${button('export', 'PDF exportieren')}${button('save', 'Sitzung speichern', 'primary')}</div></div>
    ${state.hasProtocol ? '<p class="muted">Das gespeicherte PDF zeigt den Stand des letzten Exports. Änderungen an der Sitzung werden erst nach einem erneuten Export übernommen.</p>' : ''}
    <div class="card"><div class="fields">
      <label>Titel der Sitzung<input data-field="title" value="${escape(meeting.title)}" placeholder="Titel der Sitzung"></label>
      <label>Datum<input type="date" data-field="date" value="${escape(meeting.date)}"></label>
    </div></div>
    <div class="card"><div class="card-header"><h2>Anwesenheit</h2>${button('add-person', '+ Person hinzufügen')}</div>
      ${meeting.attendance.length ? meeting.attendance.map((person, i) => `<div class="row">
        <label>Name<input data-person="${i}" data-field="name" value="${escape(person.name)}" placeholder="Name der Person"></label>
        <label>Status<select data-person="${i}" data-field="status">${options(Object.entries(clubDeutsch.attendance), person.status)}</select></label>
        <button class="action" data-action="remove-person" data-index="${i}" aria-label="Person entfernen">Entfernen</button>
      </div>`).join('') : '<p>Keine Anwesenheit erfasst.</p>'}</div>
    <div class="topline"><h2>TOPs</h2></div>
    ${meeting.points.length ? meeting.points.map((point, i) => `<section class="card">
      <div class="card-header"><h3>TOP ${i + 1}</h3><div class="row">
        <button class="action" data-action="move-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="TOP nach oben verschieben">↑</button>
        <button class="action" data-action="move-down" data-index="${i}" ${i === meeting.points.length - 1 ? 'disabled' : ''} aria-label="TOP nach unten verschieben">↓</button>
        <button class="action" data-action="remove-point" data-index="${i}">Löschen</button></div></div>
      <div class="fields">
        <label>Überschrift<input data-point="${i}" data-field="headline" value="${escape(point.headline)}" placeholder="Überschrift"></label>
        <label>Typ<select data-point="${i}" data-field="type">${options(Object.entries(clubDeutsch.pointType), point.type)}</select></label>
        <label>Verantwortliche Person für den TOP (optional)<input data-point="${i}" data-field="responsible" value="${escape(point.responsible ?? '')}" placeholder="Name der Person"></label>
      </div>
      <div class="markdown-field"><span class="markdown-label">Details <span class="muted">(Markdown mit Live-Vorschau)</span></span><div data-markdown-editor="${i}"></div></div>
      ${point.type === 'decision' ? decisionFields(point, i) : ''}
      ${point.type !== 'decision' || point.tasks.length ? `<div class="card-header"><h3>Aufgaben</h3>${point.type !== 'decision' ? `<button class="action" data-action="add-task" data-index="${i}">+ Aufgabe hinzufügen</button>` : ''}</div>
      ${point.type === 'decision' ? '<p>Diese bestehenden Aufgaben bleiben erhalten und können entfernt werden.</p>' : ''}
      ${point.tasks.map((task, j) => `<div class="row meeting-task-row">
        <label>Aufgabe<input data-point="${i}" data-task="${j}" data-field="description" value="${escape(task.description)}" placeholder="Aufgabe"></label>
        <label>Verantwortliche Personen<input data-point="${i}" data-task="${j}" data-field="responsible" value="${escape(task.responsible)}" placeholder="Namen"></label>
        <label>Fällig am (optional)<input type="date" data-point="${i}" data-task="${j}" data-field="dueDate" value="${escape(task.dueDate || '')}"></label>
        <label class="checkbox"><input type="checkbox" data-point="${i}" data-task="${j}" data-field="done" ${task.done ? 'checked' : ''}> Erledigt</label>
        <span class="task-completed-date">${task.done && task.completedDate ? `Erledigt am: ${escape(formatDate(task.completedDate))}` : ''}</span>
        <button class="action" data-action="remove-task" data-index="${i}" data-task="${j}" aria-label="Aufgabe entfernen">Entfernen</button>
      </div>`).join('')}` : ''}</section>`).join('') : '<p>Noch keine TOPs vorhanden.</p>'}
    ${button('add-point', '+ TOP hinzufügen')}`;
}

function taskResults() {
  const allTasks = state.meetings.flatMap(({ meeting }) => meeting.points.flatMap((point, pointIndex) =>
    point.tasks.flatMap((task, taskIndex) => task.done ? [] : [{ meeting, point, task, pointIndex, taskIndex }])));
  const search = taskView.search.trim().toLocaleLowerCase('de');
  const responsible = taskView.responsible.trim().toLocaleLowerCase('de');
  const tasks = allTasks.filter(({ meeting, point, task }) => {
    const text = [task.description, task.responsible || clubDeutsch.unassigned, meeting.title, point.headline, meeting.date, formatDate(meeting.date), task.dueDate || '', formatDate(task.dueDate || '')].join(' ').toLocaleLowerCase('de');
    return text.includes(search) && (task.responsible || clubDeutsch.unassigned).toLocaleLowerCase('de').includes(responsible);
  });
  const values = {
    description: item => item.task.description,
    responsible: item => item.task.responsible || clubDeutsch.unassigned,
    meeting: item => item.meeting.title,
    point: item => item.point.headline,
    date: item => item.meeting.date,
    dueDate: item => item.task.dueDate || ''
  };
  tasks.sort((a, b) => {
    const first = values[taskView.sort](a);
    const second = values[taskView.sort](b);
    if (taskView.sort === 'dueDate' && (!first || !second)) return Number(!first) - Number(!second);
    return taskCollator.compare(first, second) * (taskView.direction === 'ascending' ? 1 : -1);
  });
  const today = clubDates.localDate();
  const header = (key, label) => {
    const active = taskView.sort === key;
    const indicator = active ? (taskView.direction === 'ascending' ? ' ↑' : ' ↓') : '';
    return `<th scope="col"${active ? ` aria-sort="${taskView.direction}"` : ''}><button class="sort-button" data-action="sort-tasks" data-sort="${key}" aria-label="${label} sortieren">${label}${indicator}</button></th>`;
  };
  return `<p class="task-count" role="status">${tasks.length} von ${allTasks.length} offenen Aufgaben</p>
    ${allTasks.length === 0 ? '<p>Keine offenen Aufgaben.</p>' : tasks.length === 0 ? '<p>Keine Aufgaben entsprechen den Filtern.</p>' :
      `<div class="table-scroll" role="region" aria-label="Aufgabentabelle, horizontal scrollbar" tabindex="0"><table class="tasks-table"><caption class="sr-only">Offene Aufgaben aus Sitzungen</caption>
      <colgroup><col class="task-col-check"><col class="task-col-description"><col class="task-col-responsible"><col class="task-col-meeting"><col class="task-col-point"><col class="task-col-date"><col class="task-col-due"><col class="task-col-action"></colgroup><thead><tr>
        <th scope="col">Erledigt</th>${header('description', 'Aufgabe')}${header('responsible', 'Verantwortlich')}
        ${header('meeting', 'Sitzung')}${header('point', 'TOP')}${header('date', 'Sitzungsdatum')}${header('dueDate', 'Fällig am')}
        <th scope="col">Aktion</th></tr></thead><tbody>
      ${tasks.map(({ meeting, point, task, pointIndex, taskIndex }) => `<tr>
        <td><input type="checkbox" data-complete-task data-id="${escape(meeting.id)}" data-point-index="${pointIndex}" data-task-index="${taskIndex}" aria-label="${escape(`${task.description || 'Aufgabe ohne Titel'} – ${meeting.title || 'Sitzung ohne Titel'} als erledigt markieren`)}"></td>
        <td>${escape(task.description || 'Aufgabe ohne Titel')}</td>
        <td>${escape(task.responsible || clubDeutsch.unassigned)}</td>
        <td>${escape(meeting.title || 'Sitzung ohne Titel')}</td>
        <td>${escape(point.headline || 'TOP ohne Titel')}</td>
        <td>${escape(meeting.date ? formatDate(meeting.date) : 'Kein Datum')}</td>
        <td>${task.dueDate ? `<time datetime="${escape(task.dueDate)}">${escape(formatDate(task.dueDate))}</time>${clubDates.overdue(task.dueDate, today) ? ' <span class="overdue">Überfällig</span>' : ''}` : '—'}</td>
        <td><button class="action" data-action="select-task-meeting" data-id="${escape(meeting.id)}">Sitzung öffnen</button></td>
      </tr>`).join('')}</tbody></table></div>`}`;
}

function tasksView() {
  return `<div class="topline"><div><h1>Offene Aufgaben</h1><p>Offene Aufgaben aus gespeicherten Sitzungen.</p></div>${button('refresh-tasks', 'Aufgaben neu laden')}</div>
    <div class="card">
      <div class="task-filters">
        <label>Aufgaben suchen<input type="search" data-task-filter="search" value="${escape(taskView.search)}" placeholder="Aufgabe, Sitzung, TOP oder Datum"></label>
        <label>Verantwortliche filtern<input type="search" data-task-filter="responsible" value="${escape(taskView.responsible)}" placeholder="Name"></label>
        ${button('clear-task-filters', 'Filter zurücksetzen')}
      </div>
      <div id="task-results">${taskResults()}</div>
    </div>`;
}

function decisionResults() {
  const allDecisions = state.meetings.flatMap(({ meeting }) => meeting.points
    .flatMap((point, pointIndex) => point.type === 'decision' ? [{ meeting, point, pointIndex }] : []));
  const search = decisionView.search.trim().toLocaleLowerCase('de');
  const groupedResults = { all_accepted: ['accepted', 'unanimous_accepted'], all_rejected: ['rejected', 'unanimous_rejected'] };
  const decisions = allDecisions.filter(({ meeting, point }) =>
    [point.headline || 'TOP ohne Titel', clubDeutsch.voteDescription(point.vote),
      meeting.title || 'Sitzung ohne Titel', meeting.date || 'Kein Datum', formatDate(meeting.date)]
      .join(' ').toLocaleLowerCase('de').includes(search) &&
    (!decisionView.result || (groupedResults[decisionView.result] || [decisionView.result]).includes(point.vote?.result || 'none')));
  return `<p class="task-count" role="status">${decisions.length} von ${allDecisions.length} Entscheidungen</p>
    ${allDecisions.length === 0 ? '<p>Keine Entscheidungen vorhanden.</p>' : decisions.length === 0 ? `<p>Keine Entscheidungen entsprechen ${decisionView.result ? 'den Filtern' : 'der Suche'}.</p>` :
      `<div class="table-scroll" role="region" aria-label="Entscheidungstabelle, horizontal scrollbar" tabindex="0">
      <table class="tasks-table decisions-table"><caption class="sr-only">Entscheidungen aus Sitzungen</caption>
      <thead><tr><th scope="col">TOP</th><th scope="col">Ergebnis</th><th scope="col">Sitzung</th><th scope="col">Sitzungsdatum</th><th scope="col">Details</th><th scope="col">Aktion</th></tr></thead>
      <tbody>${decisions.map(({ meeting, point, pointIndex }) => {
        const expanded = decisionView.expanded === `${meeting.id}:${pointIndex}`;
        const detailsId = `decision-details-${meeting.id}-${pointIndex}`;
        return `<tr data-decision-row>
        <td>${escape(point.headline || 'TOP ohne Titel')}</td>
        <td><span class="decision-result" data-result="${escape(point.vote?.result || '')}">${escape(clubDeutsch.voteDescription(point.vote))}</span></td>
        <td>${escape(meeting.title || 'Sitzung ohne Titel')}</td>
        <td>${escape(meeting.date ? formatDate(meeting.date) : 'Kein Datum')}</td>
        <td><button class="top-details-toggle" data-action="toggle-decision-details" data-id="${escape(meeting.id)}" data-index="${pointIndex}" aria-controls="${escape(detailsId)}" aria-expanded="${expanded}">${expanded ? 'Details ausblenden' : 'Details anzeigen'}</button></td>
        <td><button class="action" data-action="select-decision-meeting" data-id="${escape(meeting.id)}">Sitzung öffnen</button></td>
      </tr>${expanded ? `<tr class="top-details-row"><td colspan="6"><div class="top-details-content" id="${escape(detailsId)}">${escape(point.details || 'Keine Details vorhanden.')}</div></td></tr>` : ''}`;
      }).join('')}</tbody></table></div>`}`;
}

function decisionsView() {
  return `<div class="topline"><div><h1>Entscheidungen</h1><p>Entscheidungen aus gespeicherten Sitzungen.</p></div>${button('refresh-decisions', 'Entscheidungen neu laden')}</div>
    <div class="card">
      <div class="task-filters"><label>Entscheidungen suchen<input type="search" data-decision-search value="${escape(decisionView.search)}" placeholder="TOP, Ergebnis, Sitzung oder Datum"></label>
        <label>Ergebnis filtern<select data-decision-result>${options([['', 'Alle Ergebnisse'], ['none', 'Kein Ergebnis ausgewählt'], ['all_accepted', 'Angenommen (alle)'], ['all_rejected', 'Abgelehnt (alle)'], ...Object.entries(clubDeutsch.voteResult)], decisionView.result)}</select></label></div>
      <div id="decision-results">${decisionResults()}</div>
    </div>`;
}

function topResults() {
  const allTops = state.meetings.flatMap(({ meeting }) => meeting.points
    .map((point, pointIndex) => ({ meeting, point, pointIndex })));
  const search = topView.search.trim().toLocaleLowerCase('de');
  const tops = allTops.filter(({ meeting, point }) => {
    const text = [
      point.headline || 'TOP ohne Titel', point.details, point.responsible,
      clubDeutsch.pointType[point.type], meeting.title || 'Sitzung ohne Titel',
      meeting.date || 'Kein Datum', formatDate(meeting.date)
    ].join(' ').toLocaleLowerCase('de');
    return text.includes(search) &&
      (!topView.type || point.type === topView.type) &&
      (!topView.meeting || meeting.id === topView.meeting);
  });
  return `<p class="task-count" role="status">${tops.length} von ${allTops.length} TOPs</p>
    ${allTops.length === 0 ? '<p>Keine TOPs in gespeicherten Sitzungen vorhanden.</p>' : tops.length === 0 ? '<p>Keine TOPs entsprechen den Filtern.</p>' :
      `<div class="table-scroll" role="region" aria-label="TOP-Tabelle, horizontal scrollbar" tabindex="0">
      <table class="tasks-table tops-table"><caption class="sr-only">Alle TOPs aus gespeicherten Protokollen</caption>
      <thead><tr><th scope="col">TOP</th><th scope="col">Typ</th><th scope="col">Details</th><th scope="col">Verantwortlich</th><th scope="col">Sitzung</th><th scope="col">Datum</th><th scope="col">Aktion</th></tr></thead>
      <tbody>${tops.map(({ meeting, point, pointIndex }) => {
        const expanded = topView.expanded === `${meeting.id}:${pointIndex}`;
        const detailsId = `top-details-${meeting.id}-${pointIndex}`;
        return `<tr data-top-row data-type="${escape(point.type)}" data-meeting-id="${escape(meeting.id)}">
        <td>${escape(point.headline || 'TOP ohne Titel')}</td>
        <td><span class="top-type top-type-${escape(point.type)}">${escape(clubDeutsch.pointType[point.type])}</span></td>
        <td class="top-details"><button class="top-details-toggle" data-action="toggle-top-details" data-id="${escape(meeting.id)}" data-index="${pointIndex}" aria-controls="${escape(detailsId)}" aria-expanded="${expanded}">${expanded ? 'Details ausblenden' : 'Details anzeigen'}</button></td>
        <td>${escape(point.responsible || '—')}</td>
        <td>${escape(meeting.title || 'Sitzung ohne Titel')}</td>
        <td>${escape(meeting.date ? formatDate(meeting.date) : 'Kein Datum')}</td>
        <td><button class="action" data-action="select-top-meeting" data-id="${escape(meeting.id)}">Sitzung öffnen</button></td>
      </tr>${expanded ? `<tr class="top-details-row"><td colspan="7"><div class="top-details-content" id="${escape(detailsId)}">${escape(point.details || 'Keine Details vorhanden.')}</div></td></tr>` : ''}`;
      }).join('')}</tbody></table></div>`}`;
}

function topsView() {
  return `<div class="topline"><div><h1>Alle TOPs</h1><p>TOPs aus allen gespeicherten Protokollen.</p></div>${button('refresh-tops', 'TOPs neu laden')}</div>
    <div class="card">
      <div class="task-filters">
        <label>TOPs suchen<input type="search" data-top-filter="search" value="${escape(topView.search)}" placeholder="Überschrift, Details, Verantwortliche, Sitzung oder Datum"></label>
        <label>Typ filtern<select data-top-filter="type"><option value="">Alle Typen</option>${Object.entries(clubDeutsch.pointType).map(([type, label]) => `<option value="${escape(type)}" ${topView.type === type ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select></label>
        <label>Protokoll filtern<select data-top-filter="meeting"><option value="">Alle Protokolle</option>${state.meetings.map(({ meeting }) => `<option value="${escape(meeting.id)}" ${topView.meeting === meeting.id ? 'selected' : ''}>${escape(meeting.title || 'Sitzung ohne Titel')}${meeting.date ? ` – ${escape(formatDate(meeting.date))}` : ''}</option>`).join('')}</select></label>
        ${button('clear-top-filters', 'Filter zurücksetzen')}
      </div>
      <div id="top-results">${topResults()}</div>
    </div>`;
}

function statisticsView() {
  const { open, completed, overdue, included, excluded, points } = clubTaskStatistics.summarize(state.meetings);
  let chart = '<p>Für den Verlauf sind keine Aufgaben mit ausreichend gültigen Datumsangaben vorhanden.</p>';
  if (points.length) {
    const first = Date.parse(`${points[0].date}T00:00:00Z`);
    const last = Date.parse(`${points.at(-1).date}T00:00:00Z`);
    const max = Math.max(1, ...points.map(point => point.open));
    const x = point => last === first ? 50 : 50 + (Date.parse(`${point.date}T00:00:00Z`) - first) / (last - first) * 700;
    const y = point => 190 - point.open / max * 160;
    const path = points.map((point, index) => {
      const currentX = x(point).toFixed(2);
      const currentY = y(point).toFixed(2);
      return index ? `H ${currentX} V ${currentY}` : `M ${currentX} ${currentY}`;
    }).join(' ');
    chart = `<svg class="statistics-chart" viewBox="0 0 800 240" role="img" aria-labelledby="statistics-chart-title statistics-chart-desc">
      <title id="statistics-chart-title">Geschätzter Verlauf offener Aufgaben</title>
      <desc id="statistics-chart-desc">Die Linie zeigt den geschätzten Stand am Ende jedes Datums. Die Werte stehen auch in der Tabelle darunter.</desc>
      <line class="statistics-axis" x1="50" y1="30" x2="50" y2="190"></line>
      <line class="statistics-axis" x1="50" y1="190" x2="750" y2="190"></line>
      <text x="40" y="35" text-anchor="end">${max}</text><text x="40" y="195" text-anchor="end">0</text>
      <path class="statistics-line" d="${path}"></path>
      ${points.map(point => `<circle class="statistics-point" cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="4"><title>${escape(formatDate(point.date))}: ${point.open} offene Aufgaben</title></circle>`).join('')}
      <text x="50" y="218" text-anchor="start">${escape(formatDate(points[0].date))}</text>
      ${last === first ? '' : `<text x="750" y="218" text-anchor="end">${escape(formatDate(points.at(-1).date))}</text>`}
    </svg>
    <details class="statistics-data"><summary>Verlaufswerte als Tabelle anzeigen</summary>
      <table><caption>Geschätzte offene Aufgaben am Tagesende</caption><thead><tr><th scope="col">Datum</th><th scope="col">Offene Aufgaben</th></tr></thead>
      <tbody>${points.map(point => `<tr><td>${escape(formatDate(point.date))}</td><td>${point.open}</td></tr>`).join('')}</tbody></table>
    </details>`;
  }
  return `<div class="topline"><div><h1>Statistiken</h1><p>Aufgaben aus gespeicherten Sitzungen.</p></div>${button('refresh-statistics', 'Statistiken neu laden')}</div>
    <div class="statistics-summary">
      <div class="card"><h2>Offen</h2><strong data-stat-open>${open}</strong></div>
      <div class="card"><h2>Erledigt</h2><strong data-stat-completed>${completed}</strong></div>
      <div class="card"><h2>Überfällig</h2><strong data-stat-overdue>${overdue}</strong></div>
    </div>
    <section class="card"><h2>Geschätzter Verlauf offener Aufgaben</h2>
      <p>Das Sitzungsdatum dient als geschätztes Startdatum. Erledigungen werden am gespeicherten Erledigungsdatum berücksichtigt. Die Linie zeigt den Stand am Tagesende.</p>
      <p>Der Verlauf umfasst ${included} Aufgaben; ausgeschlossen: ${excluded}. Ausgeschlossen werden Aufgaben mit fehlendem, ungültigem oder zukünftigem Sitzungsdatum sowie erledigte Aufgaben ohne gültiges Erledigungsdatum zwischen Sitzung und heute. Die aktuellen Zahlen oben enthalten alle Aufgaben.</p>
      <p>Nachträglich hinzugefügte, gelöschte oder wieder geöffnete Aufgaben und geänderte Sitzungsdaten können den historischen Verlauf verfälschen; eine vollständige Historie wird nicht gespeichert.</p>
      ${chart}
    </section>`;
}

function renderNavigation() {
  document.querySelectorAll('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === state.view));
  document.querySelectorAll('[data-module-view]').forEach(element => {
    element.hidden = !state.modules[element.dataset.moduleView];
  });
  document.querySelector('[data-module-nav="meetings"]').hidden = !state.modules.meetings;
  document.querySelector('[data-view="meetings"]').classList.toggle('parent-active', ['tasks', 'decisions', 'tops', 'statistics'].includes(state.view));
  const toggle = document.querySelector('[data-action="toggle-meeting-nav"]');
  toggle.setAttribute('aria-expanded', String(meetingNavExpanded));
  document.querySelector('#meeting-subnav').hidden = !meetingNavExpanded;
}

function settingsView() {
  const selected = settingsTab === 'general' ? null : MODULES.find(([id]) => id === settingsTab);
  const tabs = [['general', 'Allgemein'], ...MODULES.map(([id, name]) => [id, name])];
  const moduleSettings = selected ? `<section class="card" role="tabpanel" aria-labelledby="settings-tab-${selected[0]}">
      <h2>${selected[1]}</h2>
      <p>${selected[2]}.</p>
      <label class="checkbox module-toggle"><input type="checkbox" data-module-toggle="${selected[0]}" ${state.modules[selected[0]] ? 'checked' : ''}> Modul aktivieren</label>
      <p class="muted">${state.modules[selected[0]] ? 'Das Modul wird in der Seitenleiste angezeigt.' : 'Das Modul ist deaktiviert und wird aus der Seitenleiste ausgeblendet.'}</p>
    </section>` : `<section role="tabpanel" aria-labelledby="settings-tab-general">
      <div class="card"><h2>Datenordner</h2>
        <p>Wählen Sie, wo ClubManager seine Daten speichert. Jedes Modul hat einen eigenen Unterordner.</p>
        <p class="path">${escape(state.folder || 'Kein Ordner ausgewählt')}</p>
        ${button('choose-folder', state.folder ? 'Ordner ändern' : 'Ordner auswählen', 'primary')}
        <p>Beim Wechsel werden die Daten am neuen Speicherort geöffnet; vorhandene Daten werden nicht verschoben.</p></div>
      <div class="card"><h2>CSS für PDF-Protokolle</h2>
        <p>Eine CSS-Datei ersetzt das Standardlayout beim nächsten PDF-Export.</p>
        <p class="path" data-protocol-css>${escape(state.protocolCss || 'Standardlayout wird verwendet')}</p>
        <div class="row">${button('choose-protocol-css', state.protocolCss ? 'CSS-Datei ändern' : 'CSS-Datei auswählen')}${state.protocolCss ? button('reset-protocol-css', 'Standardlayout verwenden') : ''}</div>
        <p>Die Datei wird bei jedem Export neu gelesen. Bereits exportierte PDFs bleiben unverändert.</p></div>
      <div class="card"><h2>Über ClubManager</h2><p data-app-version>Version: ${escape(state.version ?? 'Nicht verfügbar')}</p></div>
    </section>`;
  return `<h1>Einstellungen</h1>
    <div class="settings-tabs" role="tablist" aria-label="Einstellungsbereiche">
      ${tabs.map(([id, label]) => `<button type="button" class="settings-tab ${settingsTab === id ? 'selected' : ''}" id="settings-tab-${id}" role="tab" aria-selected="${settingsTab === id}" data-action="settings-tab" data-settings-tab="${id}">${label}</button>`).join('')}
    </div>
    ${moduleSettings}`;
}

function render() {
  document.querySelector('.activity').inert = false;
  const previousContent = app.querySelector('.content');
  const tableScroll = app.querySelector('.table-scroll')?.scrollLeft ?? 0;
  const preserveScroll = previousContent?.dataset.viewContext === state.view &&
    previousContent?.dataset.meetingId === (state.meeting?.id || '');
  const scrollTop = preserveScroll ? previousContent.scrollTop : 0;
  const scrollLeft = preserveScroll ? previousContent.scrollLeft : 0;
  for (const editor of markdownEditors) editor.destroy();
  markdownEditors = [];
  renderNavigation();
  let content = '';
  if (state.view === 'settings') {
    content = settingsView();
  } else if (state.view === 'changelog') {
    content = `<h1>Versionsverlauf</h1><p>Änderungen in ClubManager.</p>${state.changelog === null ? '<p>Der Versionsverlauf konnte nicht geladen werden.</p>' : state.changelog.length === 0 ? '<p>Keine Versionseinträge vorhanden.</p>' : state.changelog.map(entry =>
      `<section class="card"><h2>Version ${escape(entry.version)}</h2><ul>${entry.changes.map(change => `<li>${escape(change)}</li>`).join('')}</ul></section>`).join('')}`;
  } else if (!state.folder) {
    content = `<div class="empty"><h1>Willkommen bei ClubManager</h1><p>Wählen Sie zunächst in den Einstellungen einen Datenordner aus.</p>${button('open-settings', 'Einstellungen öffnen', 'primary')}</div>`;
  } else if (state.view === 'meetings') {
    content = state.meeting ? meetingEditor(state.meeting) : '<div class="empty"><h1>Sitzungen</h1><p>Erstellen Sie eine Sitzung oder wählen Sie eine aus der Liste aus.</p></div>';
  } else if (state.view === 'tasks') {
    content = tasksView();
  } else if (state.view === 'decisions') {
    content = decisionsView();
  } else if (state.view === 'tops') {
    content = topsView();
  } else if (state.view === 'statistics') {
    content = statisticsView();
  } else {
    const titles = { members: 'Mitglieder', invoices: 'Rechnungen', letters: 'Briefe' };
    content = `<h1>${titles[state.view]}</h1><div class="card"><p>Dieses Modul ist für eine spätere Version geplant.</p></div>`;
  }
  app.innerHTML = `<div class="layout">${state.view === 'meetings' && state.folder ? meetingList() : ''}
    <div class="content" data-view-context="${escape(state.view)}" data-meeting-id="${escape(state.meeting?.id || '')}"><div class="content-inner ${['tasks', 'decisions', 'tops', 'statistics'].includes(state.view) ? 'content-inner-wide' : ''}">${notice()}${content}</div></div></div>`;
  app.querySelectorAll('[data-markdown-editor]').forEach(parent => {
    const index = Number(parent.dataset.markdownEditor);
    const point = state.meeting.points[index];
    markdownEditors.push(window.createMarkdownEditor(parent, point.details, value => {
      point.details = value;
      state.dirty = true;
      const status = document.querySelector('.status');
      if (status) status.textContent = 'Ungespeicherte Änderungen';
    }, `Details für TOP ${index + 1}`));
  });
  if (previousContent) {
    const newContent = app.querySelector('.content');
    newContent.scrollTop = scrollTop;
    newContent.scrollLeft = scrollLeft;
  }
  if (preserveScroll && ['tasks', 'decisions', 'tops'].includes(state.view)) {
    const table = app.querySelector('.table-scroll');
    if (table) table.scrollLeft = tableScroll;
  }
  scheduleTaskDateRefresh();
}

function scheduleTaskDateRefresh() {
  clearTimeout(taskDateRefresh);
  if (!['tasks', 'statistics'].includes(state.view) || !state.folder) return;
  displayedTaskDate = clubDates.localDate();
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  taskDateRefresh = setTimeout(() => {
    if (['tasks', 'statistics'].includes(state.view) && state.folder) {
      if (state.view === 'tasks') { refreshTaskResults(); scheduleTaskDateRefresh(); }
      else render();
    }
  }, Math.max(1000, nextDay.getTime() - now.getTime() + 100));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ['tasks', 'statistics'].includes(state.view) && state.folder &&
      displayedTaskDate !== clubDates.localDate()) {
    if (state.view === 'tasks') { refreshTaskResults(); scheduleTaskDateRefresh(); }
    else render();
  }
});

async function refresh() {
  state.meetings = state.folder ? await window.club.listMeetings() : [];
}

function refreshTaskResults() {
  const results = document.querySelector('#task-results');
  const scrollLeft = results.querySelector('.table-scroll')?.scrollLeft ?? 0;
  results.innerHTML = taskResults();
  const table = results.querySelector('.table-scroll');
  if (table) table.scrollLeft = scrollLeft;
}

function refreshDecisionResults() {
  const results = document.querySelector('#decision-results');
  const scrollLeft = results.querySelector('.table-scroll')?.scrollLeft ?? 0;
  results.innerHTML = decisionResults();
  const table = results.querySelector('.table-scroll');
  if (table) table.scrollLeft = scrollLeft;
}

function refreshTopResults() {
  const results = document.querySelector('#top-results');
  const scrollLeft = results.querySelector('.table-scroll')?.scrollLeft ?? 0;
  results.innerHTML = topResults();
  const table = results.querySelector('.table-scroll');
  if (table) table.scrollLeft = scrollLeft;
}

async function changeView(view) {
  if (view === state.view) return;
  const module = ['tasks', 'decisions', 'tops', 'statistics'].includes(view) ? 'meetings' : view;
  if (view !== 'settings' && view !== 'changelog' && !state.modules[module]) {
    setMessage('Dieses Modul ist deaktiviert. Aktivieren Sie es zuerst in den Einstellungen.', true);
    return;
  }
  if (!confirmDiscard()) return;
  state.meeting = null;
  state.revision = null;
  state.hasProtocol = false;
  includeEarlierTasks = false;
  state.dirty = false;
  state.view = view;
  setMessage('');
  if (view !== 'changelog') await refresh();
}

async function run(action, target) {
  const meeting = state.meeting;
  const i = Number(target.dataset.index);
  switch (action) {
    case 'open-settings': await changeView('settings'); break;
    case 'settings-tab':
      settingsTab = target.dataset.settingsTab;
      setMessage('');
      break;
    case 'choose-folder': {
      const selected = await window.club.chooseFolder();
      if (selected) {
        state.folder = selected;
        state.meeting = null;
        state.revision = null;
        state.hasProtocol = false;
        state.dirty = false;
        await refresh();
        setMessage('Datenordner ausgewählt. Die Modulordner sind bereit.');
      }
      break;
    }
    case 'choose-protocol-css': {
      const selected = await window.club.chooseProtocolCss();
      if (selected) {
        state.protocolCss = selected;
        setMessage('CSS-Datei für PDF-Protokolle ausgewählt.');
      }
      break;
    }
    case 'reset-protocol-css':
      await window.club.resetProtocolCss();
      state.protocolCss = null;
      setMessage('Das Standardlayout für PDF-Protokolle wird verwendet.');
      break;
    case 'new':
      if (!confirmDiscard()) return;
      state.meeting = blankMeeting();
      state.revision = null;
      state.hasProtocol = false;
      includeEarlierTasks = false;
      state.dirty = true;
      setMessage('');
      break;
    case 'select':
    case 'select-task-meeting':
    case 'select-decision-meeting':
    case 'select-top-meeting': {
      if (!confirmDiscard()) return;
      await refresh();
      const selected = state.meetings.find(item => item.meeting.id === target.dataset.id);
      if (!selected) throw new Error('Die Sitzung ist auf dem Datenträger nicht mehr vorhanden.');
      const hasProtocol = await window.club.hasProtocol(selected.meeting.id);
      state.meeting = structuredClone(selected.meeting);
      state.revision = selected.revision;
      state.hasProtocol = hasProtocol;
      includeEarlierTasks = false;
      state.dirty = false;
      state.view = 'meetings';
      setMessage('');
      break;
    }
    case 'refresh-tasks':
      await refresh();
      setMessage('Aufgaben neu geladen.');
      break;
    case 'refresh-decisions':
      await refresh();
      setMessage('Entscheidungen neu geladen.');
      break;
    case 'toggle-decision-details': {
      const key = `${target.dataset.id}:${target.dataset.index}`;
      decisionView.expanded = decisionView.expanded === key ? '' : key;
      break;
    }
    case 'refresh-tops':
      await refresh();
      setMessage('TOPs neu geladen.');
      break;
    case 'refresh-statistics':
      await refresh();
      setMessage('Statistiken neu geladen.');
      break;
    case 'toggle-top-details': {
      const key = `${target.dataset.id}:${target.dataset.index}`;
      topView.expanded = topView.expanded === key ? '' : key;
      break;
    }
    case 'clear-top-filters':
      topView.search = '';
      topView.type = '';
      topView.meeting = '';
      break;
    case 'clear-task-filters':
      taskView.search = '';
      taskView.responsible = '';
      break;
    case 'sort-tasks':
      if (taskView.sort === target.dataset.sort) {
        taskView.direction = taskView.direction === 'ascending' ? 'descending' : 'ascending';
      } else {
        taskView.sort = target.dataset.sort;
        taskView.direction = 'ascending';
      }
      break;
    case 'save':
      if (!meeting.title.trim()) throw new Error('Geben Sie vor dem Speichern einen Titel für die Sitzung ein.');
      state.revision = await window.club.saveMeeting(meeting, state.revision);
      state.dirty = false;
      await refresh();
      setMessage('Sitzung gespeichert.');
      break;
    case 'export':
      if (state.dirty || !state.revision) throw new Error('Speichern Sie die Sitzung, bevor Sie das PDF exportieren.');
      setMessage(`PDF gespeichert unter: ${await window.club.exportMeeting(meeting, state.revision, includeEarlierTasks)}`);
      state.hasProtocol = true;
      break;
    case 'open-protocol':
      await window.club.openProtocol(meeting.id);
      break;
    case 'add-person': meeting.attendance.push({ name: '', status: 'attending' }); state.dirty = true; break;
    case 'remove-person': meeting.attendance.splice(i, 1); state.dirty = true; break;
    case 'add-point': meeting.points.push({ headline: '', type: 'discussion', details: '', tasks: [] }); state.dirty = true; break;
    case 'remove-point':
      if (window.confirm('Diesen TOP und seine Aufgaben löschen?')) { meeting.points.splice(i, 1); state.dirty = true; }
      break;
    case 'move-up':
    case 'move-down': {
      const destination = i + (action === 'move-up' ? -1 : 1);
      [meeting.points[i], meeting.points[destination]] = [meeting.points[destination], meeting.points[i]];
      state.dirty = true;
      break;
    }
    case 'add-task':
      if (meeting.points[i].type === 'decision') throw new Error('Für einen Entscheidungs-TOP können keine Aufgaben hinzugefügt werden.');
      meeting.points[i].tasks.push({ description: '', responsible: '', done: false }); state.dirty = true; break;
    case 'remove-task': meeting.points[i].tasks.splice(Number(target.dataset.task), 1); state.dirty = true; break;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (target.dataset.action === 'toggle-meeting-nav' && state.view === 'meetings') {
    meetingNavExpanded = !meetingNavExpanded;
    renderNavigation();
    return;
  }
  document.body.inert = true;
  try {
    if (target.dataset.view) await changeView(target.dataset.view);
    if (target.dataset.action === 'toggle-meeting-nav') {
      if (state.view === 'meetings') meetingNavExpanded = !meetingNavExpanded;
    } else if (target.dataset.action) await run(target.dataset.action, target);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    document.body.inert = false;
  }
  render();
  if (target.dataset.action === 'sort-tasks') {
    document.querySelector(`[data-action="sort-tasks"][data-sort="${target.dataset.sort}"]`)?.focus();
  } else if (target.dataset.action === 'toggle-decision-details') {
    document.querySelectorAll('[data-action="toggle-decision-details"]').forEach(button => {
      if (button.dataset.id === target.dataset.id && button.dataset.index === target.dataset.index) button.focus();
    });
  }
});

document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey) ||
      event.altKey || event.shiftKey || event.isComposing) return;
  if (state.view !== 'meetings' || !state.meeting) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat && !document.body.inert) {
    document.querySelector('[data-action="save"]')?.click();
  }
}, true);

app.addEventListener('change', async event => {
  const target = event.target;
  if (target.hasAttribute('data-module-toggle')) {
    const module = target.dataset.moduleToggle;
    const nextModules = { ...state.modules, [module]: target.checked };
    document.body.inert = true;
    try {
      state.modules = await window.club.setModules(nextModules);
      setMessage(`${MODULES.find(([id]) => id === module)[1]} ${target.checked ? 'aktiviert' : 'deaktiviert'}.`);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      document.body.inert = false;
      render();
    }
    return;
  }
  if (target.hasAttribute('data-include-earlier-tasks')) {
    includeEarlierTasks = target.checked;
    return;
  }
  if (!target.matches('[data-complete-task]') || !target.checked) return;
  document.body.inert = true;
  try {
    const record = state.meetings.find(item => item.meeting.id === target.dataset.id);
    if (!record) throw new Error('Die Sitzung ist nicht mehr vorhanden. Laden Sie die Aufgaben neu und versuchen Sie es erneut.');
    const meeting = structuredClone(record.meeting);
    const task = meeting.points[Number(target.dataset.pointIndex)]?.tasks[Number(target.dataset.taskIndex)];
    if (!task || task.done) throw new Error('Die Aufgabe ist nicht mehr offen. Laden Sie die Aufgaben neu und versuchen Sie es erneut.');
    setTaskDone(task, true);
    const revision = await window.club.saveMeeting(meeting, record.revision);
    record.meeting = meeting;
    record.revision = revision;
    setMessage('Aufgabe als erledigt markiert.');
  } catch (error) {
    setMessage(`${error.message} Laden Sie die Aufgaben neu, um den aktuellen Stand anzuzeigen.`, true);
  } finally {
    document.body.inert = false;
    render();
  }
});

app.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.topFilter === 'search') {
    topView.search = target.value;
    refreshTopResults();
    return;
  }
  if (target.hasAttribute('data-decision-search')) {
    decisionView.search = target.value;
    refreshDecisionResults();
    return;
  }
  if (target.dataset.taskFilter) {
    taskView[target.dataset.taskFilter] = target.value;
    refreshTaskResults();
    return;
  }
  if ((target.hasAttribute('data-vote-result') || target.dataset.voteCount) && state.meeting) {
    const point = state.meeting.points[Number(target.dataset.point)];
    point.vote ||= { result: '', yes: null, no: null, abstain: null };
    if (target.hasAttribute('data-vote-result')) {
      point.vote.result = target.value;
      target.closest('.decision-fields').querySelector('.vote-counts').hidden =
        target.value !== 'accepted' && target.value !== 'rejected';
    } else {
      point.vote[target.dataset.voteCount] = target.value === '' ? null : Number(target.value);
    }
    state.dirty = true;
    const status = document.querySelector('.status');
    if (status) status.textContent = 'Ungespeicherte Änderungen';
    return;
  }
  if (!target.dataset.field || !state.meeting) return;
  let item = state.meeting;
  if (target.dataset.person !== undefined) item = item.attendance[Number(target.dataset.person)];
  if (target.dataset.point !== undefined) item = item.points[Number(target.dataset.point)];
  if (target.dataset.task !== undefined) item = item.tasks[Number(target.dataset.task)];
  if (target.dataset.field === 'type' && target.dataset.point !== undefined) {
    if (target.value === 'decision' && item.tasks.length) {
      target.value = item.type;
      setMessage('Entfernen Sie zuerst die Aufgaben dieses TOPs, bevor Sie den Typ auf Entscheidung ändern.', true);
      render();
      return;
    }
    item.type = target.value;
    state.dirty = true;
    setMessage('');
    render();
    return;
  }
  if (target.dataset.field === 'done' && target.dataset.task !== undefined) {
    setTaskDone(item, target.checked);
    target.closest('.meeting-task-row').querySelector('.task-completed-date').textContent =
      item.completedDate ? `Erledigt am: ${formatDate(item.completedDate)}` : '';
  } else {
    item[target.dataset.field] = target.type === 'checkbox' ? target.checked : target.value;
  }
  state.dirty = true;
  const status = document.querySelector('.status');
  if (status) status.textContent = 'Ungespeicherte Änderungen';
});

app.addEventListener('change', event => {
  const target = event.target;
  if (target.hasAttribute('data-decision-result')) {
    decisionView.result = target.value;
    refreshDecisionResults();
    return;
  }
  if (target.dataset.topFilter !== 'type' && target.dataset.topFilter !== 'meeting') return;
  topView[target.dataset.topFilter] = target.value;
  refreshTopResults();
});

window.addEventListener('beforeunload', event => {
  if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
});

window.club.onPrepareUpdate(async () => {
  if (!confirmDiscard()) return;
  const wasDirty = state.dirty;
  state.dirty = false;
  try {
    await window.club.installUpdate();
  } catch (error) {
    state.dirty = wasDirty;
    setMessage(error.message, true);
    render();
  }
});

(async () => {
  const startup = window.club.awaitStartup();
  const [version, changelog] = await Promise.all([
    window.club.getVersion().catch(error => {
      setMessage(`Die App-Version konnte nicht geladen werden: ${error.message}`, true);
      return null;
    }),
    window.club.getChangelog().catch(error => {
      setMessage(`Der Versionsverlauf konnte nicht geladen werden: ${error.message}`, true);
      return null;
    })
  ]);
  await startup;
  const changelogVisibility = window.club.shouldShowChangelog().then(
    shouldShow => ({ shouldShow }),
    error => ({ error })
  );
  state.version = version;
  state.changelog = changelog;
  try {
    const [folder, protocolCss, modules] = await Promise.all([
      window.club.getFolder(),
      window.club.getProtocolCss(),
      window.club.getModules()
    ]);
    state.folder = folder;
    state.protocolCss = protocolCss;
    state.modules = modules;
    if (!state.modules.meetings) state.view = MODULES.find(([id]) => state.modules[id])?.[0] || 'settings';
    state.meetings = state.folder ? await window.club.listMeetings() : [];
  } catch (error) {
    setMessage(error.message, true);
  }
  let markSeen = false;
  const changelogResult = await changelogVisibility;
  if (changelogResult.error) {
    setMessage(`Der Versionsverlauf konnte nicht geladen werden: ${changelogResult.error.message}`, true);
  } else if (changelogResult.shouldShow) {
    state.view = 'changelog';
    markSeen = true;
  }
  render();
  if (markSeen) {
    try {
      await window.club.markChangelogSeen();
    } catch (error) {
      setMessage(`Die angezeigte Version konnte nicht gespeichert werden: ${error.message}`, true);
      render();
    }
  }
  app.dataset.modulesLoaded = 'true';
})();
