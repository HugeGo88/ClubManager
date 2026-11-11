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
  assert.match(html, /<main><h1>Sitzung — 10\.11\.2026<\/h1>/);
  assert.match(html, /<h2>TOPs<\/h2>/);
  for (const label of [...Object.values(de.attendance), ...Object.values(de.pointType)]) {
    assert.ok(html.includes(label), `Missing label: ${label}`);
  }
  for (const [type, label] of Object.entries(de.pointType)) {
    assert.ok(html.includes(`<span class="type" data-type="${type}">${label}</span></div>`));
  }
  assert.match(html, /<div class="point-heading"><h3>1\. Punkt<\/h3>/);
  assert.match(html, /<h4>Aufgaben<\/h4>/);
  assert.match(html, /<input type="checkbox" disabled="disabled" aria-label="Offen"> Aufgabe — Nicht zugewiesen/);
  assert.match(html, /<input type="checkbox" disabled="disabled" checked="checked" aria-label="Erledigt"> Fertig — Sam — Erledigt am: 11\.11\.2026/);
  assert.match(html, /checked="checked" aria-label="Erledigt"> Alt — Nicht zugewiesen<\/li>/);
  assert.doesNotMatch(html, /\[Offen\]|\[Erledigt\]/);
  assert.match(html, /<strong>Text<\/strong>/);
  assert.equal(meeting.points[0].type, 'discussion');
});

test('omits the heading date separator when no date is provided', () => {
  const html = protocolHtml({ title: 'Sitzung', date: '', attendance: [], points: [] }, '');
  assert.match(html, /<main><h1>Sitzung<\/h1>/);
});

test('includes escaped TOP responsibility only when provided', () => {
  const html = protocolHtml({ title: 'Sitzung', date: '', attendance: [], points: [
    { headline: 'Eins', type: 'info', details: '', tasks: [], responsible: 'Alex & <Sam>' },
    { headline: 'Zwei', type: 'info', details: '', tasks: [] },
    { headline: 'Drei', type: 'info', details: '', tasks: [], responsible: '   ' }
  ] }, '');
  assert.match(html, /<h3>1\. Eins \(Alex &amp; &lt;Sam&gt;\)<\/h3>/);
  assert.match(html, /<h3>2\. Zwei<\/h3>/);
  assert.match(html, /<h3>3\. Drei<\/h3>/);
  assert.doesNotMatch(html, /class="point-responsible"/);
});

test('renders decision results and only provided vote counts', () => {
  const base = { headline: 'Punkt', type: 'decision', details: '', tasks: [] };
  const vote = (result, yes = null, no = null, abstain = null) => ({ result, yes, no, abstain });
  const html = protocolHtml({ title: 'Sitzung', date: '', attendance: [], points: [
    { ...base, vote: vote('unanimous_accepted') },
    { ...base, vote: vote('unanimous_rejected') },
    { ...base, vote: vote('accepted', 5, 1, 0) },
    { ...base, vote: vote('rejected', null, 2, null) },
    { ...base, vote: vote('accepted') },
    { ...base, vote: vote('') },
    { ...base, type: 'info', vote: vote('accepted', 3, 0, 0) },
    base
  ] }, '');
  assert.match(html, /data-result="unanimous_accepted">Abstimmung: Einstimmig angenommen/);
  assert.match(html, /data-result="unanimous_rejected">Abstimmung: Einstimmig abgelehnt/);
  assert.match(html, /data-result="accepted">Abstimmung: Angenommen mit 5 Ja-Stimmen, 1 Gegenstimmen, 0 Enthaltungen/);
  assert.match(html, /data-result="rejected">Abstimmung: Abgelehnt mit 2 Gegenstimmen/);
  assert.match(html, /data-result="accepted">Abstimmung: Angenommen<\/span>/);
  assert.equal((html.match(/class="vote-result"/g) || []).length, 5);
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

test('groups attendance by status without losing names or rendering empty groups', () => {
  const meeting = {
    title: 'Sitzung', date: '', points: [], attendance: [
      { name: 'Sam & <Alex>', status: 'excused' },
      { name: 'Alex', status: 'attending' },
      { name: 'Kim', status: 'excused' },
      { name: 'Jo', status: 'attending' }
    ]
  };
  const original = structuredClone(meeting);
  const html = protocolHtml(meeting, '');
  assert.match(html, /<p class="attendance-group"><strong>Anwesend:<\/strong> Alex, Jo<\/p>/);
  assert.match(html, /<p class="attendance-group"><strong>Entschuldigt abwesend:<\/strong> Sam &amp; &lt;Alex&gt;, Kim<\/p>/);
  assert.doesNotMatch(html, /Unentschuldigt abwesend/);
  assert.equal((html.match(/class="attendance-group"/g) || []).length, 2);
  assert.deepEqual(meeting, original);
  const empty = protocolHtml({ ...meeting, attendance: [] }, '');
  assert.match(empty, /<p>Keine Anwesenheit erfasst\.<\/p>/);
  assert.doesNotMatch(empty, /class="attendance-group"/);
  const allStatuses = protocolHtml({ ...meeting, attendance: [
    { name: 'Alex', status: 'attending' },
    { name: 'Sam', status: 'excused' },
    { name: 'Kim', status: 'unexcused' }
  ] }, '');
  assert.match(allStatuses, /<strong>Unentschuldigt abwesend:<\/strong> Kim/);
});

test('protocol displays Markdown checklists as disabled checkboxes', () => {
  const html = protocolHtml({
    title: 'Sitzung', date: '', attendance: [],
    points: [{ headline: 'Punkt', type: 'info', details: '- [ ] Offen\n- [x] Fertig', tasks: [] }]
  }, '');
  assert.match(html, /<input type="checkbox" disabled="disabled"\s*\/?> Offen/);
  assert.match(html, /<input type="checkbox" disabled="disabled" checked="checked"\s*\/?> Fertig/);
});

test('renders underlined and struck-through Markdown without unsafe attributes', () => {
  const html = protocolHtml({ title: 'Sitzung', date: '', attendance: [], points: [
    { headline: 'Punkt', type: 'info', details: '<u onclick="bad()">Unterstrichen</u> und ~~Durchgestrichen~~', tasks: [] }
  ] }, '');
  assert.match(html, /<u>Unterstrichen<\/u> und <del>Durchgestrichen<\/del>/);
  assert.doesNotMatch(html, /onclick/);
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

test('keeps CSS inside the stylesheet and blocks external resources', () => {
  const html = protocolHtml({ title: 'Sitzung', date: '', attendance: [], points: [] },
    'body::after { content: "</style><script>bad</script>"; }');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<\\\/style>/);
  assert.doesNotMatch(html, /<\/style><script>/);
});

test('adds safe page headers and numbered footers for every protocol', () => {
  const html = protocolHtml({ title: '</style><script>bad</script>', date: '2026-11-10', attendance: [], points: [] }, '');
  assert.match(html, /@top-left \{ content: /);
  assert.match(html, /@bottom-left \{ content: /);
  assert.match(html, /@bottom-right \{ content: "Seite " counter\(page\) " von " counter\(pages\)/);
  assert.match(html, /\\3c \\2f \\73 \\74 \\79 \\6c \\65 \\3e /);
  assert.doesNotMatch(html, /<\/style><script>/);
  assert.doesNotMatch(html, /<header\b/);
});
