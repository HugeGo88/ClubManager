(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.clubDeutsch = factory();
})(globalThis, () => {
  const voteResult = Object.freeze({
    unanimous_accepted: 'Einstimmig angenommen',
    unanimous_rejected: 'Einstimmig abgelehnt',
    accepted: 'Angenommen mit',
    rejected: 'Abgelehnt mit'
  });
  return Object.freeze({
    attendance: Object.freeze({
      attending: 'Anwesend',
      excused: 'Entschuldigt abwesend',
      unexcused: 'Unentschuldigt abwesend'
    }),
    pointType: Object.freeze({
      discussion: 'Diskussion',
      decision: 'Entscheidung',
      info: 'Information'
    }),
    voteResult,
    voteDescription(vote) {
      if (!vote?.result) return 'Kein Ergebnis ausgewählt';
      const label = voteResult[vote.result];
      if (vote.result !== 'accepted' && vote.result !== 'rejected') return label;
      const counts = [['yes', 'Ja-Stimmen'], ['no', 'Gegenstimmen'], ['abstain', 'Enthaltungen']]
        .filter(([key]) => vote[key] !== null)
        .map(([key, text]) => `${vote[key]} ${text}`);
      return counts.length ? `${label} ${counts.join(', ')}` : label.replace(/ mit$/, '');
    },
    taskStatus: Object.freeze({ done: 'Erledigt', open: 'Offen' }),
    unassigned: 'Nicht zugewiesen'
  });
});
