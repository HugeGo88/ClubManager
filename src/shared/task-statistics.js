(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./dates'));
  else root.clubTaskStatistics = factory(root.clubDates);
})(globalThis, dates => {
  function summarize(records, today = dates.localDate()) {
    if (!dates.isDate(today)) throw new Error('Ungültiges Statistikdatum.');
    const changes = new Map();
    let open = 0;
    let completed = 0;
    let overdue = 0;
    let excluded = 0;
    let included = 0;
    const add = (date, amount) => changes.set(date, (changes.get(date) || 0) + amount);
    for (const { meeting } of records) {
      for (const point of meeting.points) {
        for (const task of point.tasks) {
          if (task.done) completed++;
          else {
            open++;
            if (dates.overdue(task.dueDate, today)) overdue++;
          }
          const start = meeting.date;
          if (!dates.isDate(start) || start > today ||
              (task.done && (!dates.isDate(task.completedDate) ||
                task.completedDate < start || task.completedDate > today))) {
            excluded++;
            continue;
          }
          included++;
          add(start, 1);
          if (task.done) add(task.completedDate, -1);
        }
      }
    }
    const points = [];
    let count = 0;
    for (const [date, change] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
      count += change;
      points.push({ date, open: count });
    }
    if (points.length && points.at(-1).date !== today) points.push({ date: today, open: count });
    return { open, completed, overdue, included, excluded, points };
  }
  return Object.freeze({ summarize });
});
