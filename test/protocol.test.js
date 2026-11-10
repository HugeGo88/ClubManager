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
      tasks: [{ description: 'Aufgabe', responsible: '', done: false }, { description: 'Fertig', responsible: 'Sam', done: true }]
    }))
  };
  const html = protocolHtml(meeting, '');
  assert.match(html, /<html lang="de">/);
  assert.match(html, /10\.11\.2026/);
  for (const label of [...Object.values(de.attendance), ...Object.values(de.pointType)]) {
    assert.ok(html.includes(label), `Missing label: ${label}`);
  }
  assert.match(html, /\[Offen\] Aufgabe — Nicht zugewiesen/);
  assert.match(html, /\[Erledigt\] Fertig — Sam/);
  assert.match(html, /<strong>Text<\/strong>/);
  assert.equal(meeting.points[0].type, 'discussion');
});

test('protocol escapes user content and strips unsafe Markdown', () => {
  const html = protocolHtml({
    title: '<script>bad</script>', date: '', attendance: [],
    points: [{ headline: '<img>', type: 'info', details: '<script>alert(1)</script>', tasks: [] }]
  }, '');
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /&lt;img&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
