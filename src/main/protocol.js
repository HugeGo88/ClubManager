const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const de = require('../shared/de');
const { formatDate } = require('../shared/dates');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function markdown(value) {
  return sanitizeHtml(marked.parse(value), {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'hr', 'input'],
    allowedAttributes: { input: ['type', 'checked', 'disabled'] },
    transformTags: {
      input: (tagName, attributes) => attributes.type === 'checkbox'
        ? { tagName: 'input', attribs: { type: 'checkbox', disabled: 'disabled', ...(Object.hasOwn(attributes, 'checked') ? { checked: 'checked' } : {}) } }
        : { tagName: 'span', attribs: {} }
    }
  });
}

function cssString(value) {
  return `"${Array.from(value, char => `\\${char.codePointAt(0).toString(16)} `).join('')}"`;
}

function protocolHtml(meeting, css) {
  const attendance = Object.entries(de.attendance).map(([status, label]) => {
    const names = meeting.attendance.filter(person => person.status === status).map(person => escapeHtml(person.name));
    return names.length ? `<p class="attendance-group"><strong>${escapeHtml(label)}:</strong> ${names.join(', ')}</p>` : '';
  }).join('');
  const points = meeting.points.map((point, index) => {
    let vote = '';
    if (point.type === 'decision' && point.vote?.result) {
      const result = point.vote.result;
      const description = de.voteDescription(point.vote);
      vote = `<p class="vote-result"><span class="vote-badge" data-result="${escapeHtml(result)}">Abstimmung: ${escapeHtml(description)}</span></p>`;
    }
    return `
    <section><div class="point-heading"><h3>${index + 1}. ${escapeHtml(point.headline)}${point.responsible?.trim() ? ` (${escapeHtml(point.responsible.trim())})` : ''}</h3>
    <span class="type" data-type="${escapeHtml(point.type)}">${escapeHtml(de.pointType[point.type])}</span></div>${markdown(point.details)}${vote}
    ${point.tasks.length ? `<h4>Aufgaben</h4><ul class="protocol-tasks">${point.tasks.map(task =>
      `<li><input type="checkbox" disabled="disabled"${task.done ? ' checked="checked"' : ''} aria-label="${task.done ? 'Erledigt' : 'Offen'}"> ${escapeHtml(task.description)} — ${escapeHtml(task.responsible || de.unassigned)}${task.dueDate ? ` — Fällig: ${escapeHtml(formatDate(task.dueDate))}` : ''}${task.done && task.completedDate ? ` — Erledigt am: ${escapeHtml(formatDate(task.completedDate))}` : ''}</li>`
    ).join('')}</ul>` : ''}</section>`;
  }).join('');
  const date = formatDate(meeting.date);
  const pageLayout = `@page {
    size: A4;
    margin: 20mm;
    @top-left { content: ${cssString(meeting.title)}; font: 9pt sans-serif; }
    @bottom-left { content: ${cssString(date)}; font: 9pt sans-serif; }
    @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 9pt sans-serif; }
  }`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${pageLayout}</style><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head>
    <body><main><h1>${escapeHtml(meeting.title)}${date ? ` — ${escapeHtml(date)}` : ''}</h1>
    <h2>Anwesenheit</h2>${attendance || '<p>Keine Anwesenheit erfasst.</p>'}
    <h2>TOPs</h2>${points || '<p>Keine TOPs vorhanden.</p>'}</main></body></html>`;
}

module.exports = { protocolHtml };
