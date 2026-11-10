(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.clubDeutsch = factory();
})(globalThis, () => Object.freeze({
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
  taskStatus: Object.freeze({ done: 'Erledigt', open: 'Offen' }),
  unassigned: 'Nicht zugewiesen'
}));
