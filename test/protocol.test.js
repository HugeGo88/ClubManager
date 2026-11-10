const test = require('node:test');
const assert = require('node:assert/strict');
const { protocolHtml } = require('../src/main/protocol');
const de = require('../src/shared/de');

test('protocol labels and statuses are German and stored values are unchanged', () => {
  const meeting = {
    title: 'Sitzung', date: '2026-11-10',
    attendance: Object.keys(de.attendance).map(status => ({ name: 'Alex', status })),
    points: Object.keys(de.pointType).map(type => ({
      headline: 'Punkt', type, details: '**Text**',
      tasks: [{ description: 'Aufgabe', responsible: '', done: false }, { description: 'Fertig', responsible: 'Sam', done: true, completedDate: '2026-11-11' }, { description: 'Alt', responsible: '', done: true }]
    }))
  };
  const html = protocolHtml(meeting, '');
  assert.match(html, /<html lang="de">/);
  assert.match(html, /10\.11\.2026/);
  assert.match(html, /<h2>TOPs<\/h2>/);
  for (const label of [...Object.values(de.attendance), ...Object.values(de.pointType)]) {
    assert.ok(html.includes(label), `Missing label: ${label}`);
  }
  assert.match(html, /<input type="checkbox" disabled="disabled" aria-label="Offen"> Aufgabe — Nicht zugewiesen/);
  assert.match(html, /<input type="checkbox" disabled="disabled" checked="checked" aria-label="Erledigt"> Fertig — Sam — Erledigt am: 11\.11\.2026/);
  assert.match(html, /checked="checked" aria-label="Erledigt"> Alt — Nicht zugewiesen<\/li>/);
  assert.doesNotMatch(html, /\[Offen\]|\[Erledigt\]/);
  assert.match(html, /<strong>Text<\/strong>/);
  assert.equal(meeting.points[0].type, 'discussion');
});

test('protocol escapes user content and strips unsafe Markdown', () => {
  const html = protocolHtml({
    title: '<script>bad</script>', date: '', attendance: [],
    points: [{ headline: '<img>', type: 'info', details: '<script>alert(1)</script>', tasks: [
      { description: '<img onerror="bad">', responsible: '<script>bad</script>', done: false }
    ] }]
  }, '');
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /&lt;img&gt;/);
  assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt; — &lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('protocol displays Markdown checklists as disabled checkboxes', () => {
  const html = protocolHtml({
    title: 'Sitzung', date: '', attendance: [],
    points: [{ headline: 'Punkt', type: 'info', details: '- [ ] Offen\n- [x] Fertig', tasks: [] }]
  }, '');
  assert.match(html, /<input type="checkbox" disabled="disabled"\s*\/?> Offen/);
  assert.match(html, /<input type="checkbox" disabled="disabled" checked="checked"\s*\/?> Fertig/);
});

test('protocol includes optional task deadlines', () => {
  const html = protocolHtml({
    title: 'Sitzung', date: '', attendance: [],
    points: [{ headline: 'Punkt', type: 'info', details: '', tasks: [
      { description: 'Mit Frist', responsible: '', done: false, dueDate: '2026-11-10' },
      { description: 'Ohne Frist', responsible: '', done: false }
    ] }]
  }, '');
  assert.match(html, /Mit Frist — Nicht zugewiesen — Fällig: 10\.11\.2026/);
  assert.match(html, /Ohne Frist — Nicht zugewiesen<\/li>/);
});
