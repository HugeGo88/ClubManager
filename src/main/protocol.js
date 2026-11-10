const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const de = require('../shared/de');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function markdown(value) {
  return sanitizeHtml(marked.parse(value), {
    allowedTags: ['p', 'br', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'hr'],
    allowedAttributes: {}
  });
}

function protocolHtml(meeting, css) {
  const attendance = meeting.attendance.map(person =>
    `<li>${escapeHtml(person.name)} — ${escapeHtml(de.attendance[person.status])}</li>`
  ).join('');
  const points = meeting.points.map((point, index) => `
    <section><h2>${index + 1}. ${escapeHtml(point.headline)}</h2>
    <p class="type">${escapeHtml(de.pointType[point.type])}</p>${markdown(point.details)}
    ${point.tasks.length ? `<h3>Aufgaben</h3><ul>${point.tasks.map(task =>
      `<li>[${escapeHtml(task.done ? de.taskStatus.done : de.taskStatus.open)}] ${escapeHtml(task.description)} — ${escapeHtml(task.responsible || de.unassigned)}</li>`
    ).join('')}</ul>` : ''}</section>`).join('');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meeting.date);
  const date = match ? `${match[3]}.${match[2]}.${match[1]}` : meeting.date;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${css}</style></head>
    <body><h1>${escapeHtml(meeting.title)}</h1><p>${escapeHtml(date)}</p>
    <h2>Anwesenheit</h2>${attendance ? `<ul>${attendance}</ul>` : '<p>Keine Anwesenheit erfasst.</p>'}
    <h2>Traktanden</h2>${points || '<p>Keine Traktanden vorhanden.</p>'}</body></html>`;
}

module.exports = { protocolHtml };
