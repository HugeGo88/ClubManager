const app = document.querySelector('#app');
const state = { view: 'meetings', folder: null, meetings: [], meeting: null, revision: null, dirty: false, message: '', error: false };

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const button = (action, text, extra = '') => `<button class="action ${extra}" data-action="${action}">${text}</button>`;

function blankMeeting() {
  return { id: crypto.randomUUID(), title: '', date: '', attendance: [], points: [] };
}

function sampleMeeting() {
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  return {
    ...blankMeeting(), title: 'Sample: committee meeting', date,
    attendance: [{ name: 'Alex Example', status: 'attending' }, { name: 'Sam Example', status: 'excused' }],
    points: [
      { headline: 'Upcoming event', type: 'discussion', details: 'Discuss the **event plan** and venue.', tasks: [{ description: 'Contact the venue', responsible: 'Alex Example', done: false }] },
      { headline: 'Budget', type: 'decision', details: 'Agree on a budget at the next meeting.', tasks: [] }
    ]
  };
}

function confirmDiscard() {
  return !state.dirty || window.confirm('Discard unsaved changes?');
}

function notice() {
  return state.message ? `<p role="status" class="notice ${state.error ? 'error' : ''}">${escape(state.message)}</p>` : '';
}

function setMessage(message, error = false) {
  state.message = message;
  state.error = error;
}

function meetingList() {
  return `<aside class="list"><h2>Meetings</h2>
    ${button('new', '+ New meeting', 'primary')}
    ${button('sample', '+ Sample meeting')}
    ${state.meetings.length ? state.meetings.map(({ meeting }) =>
      `<button class="list-item ${state.meeting?.id === meeting.id ? 'selected' : ''}" data-action="select" data-id="${escape(meeting.id)}">
      <strong>${escape(meeting.title || 'Untitled meeting')}</strong><small>${escape(meeting.date || 'No date')}</small></button>`).join('') :
      '<p>No saved meetings yet.</p>'}
  </aside>`;
}

function options(values, selected) {
  return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function meetingEditor(meeting) {
  return `<div class="topline"><div><h1>Meeting editor</h1><p class="status">${state.dirty ? 'Unsaved changes' : 'Saved'}</p></div>
    <div class="row">${button('export', 'Export PDF')}${button('save', 'Save meeting', 'primary')}</div></div>
    <div class="card"><div class="fields">
      <label>Meeting title<input data-field="title" value="${escape(meeting.title)}" placeholder="Meeting title"></label>
      <label>Date<input type="date" data-field="date" value="${escape(meeting.date)}"></label>
    </div></div>
    <div class="card"><div class="card-header"><h2>Attendance</h2>${button('add-person', '+ Add person')}</div>
      ${meeting.attendance.length ? meeting.attendance.map((person, i) => `<div class="row">
        <label>Name<input data-person="${i}" data-field="name" value="${escape(person.name)}" placeholder="Person's name"></label>
        <label>Status<select data-person="${i}" data-field="status">${options([['attending', 'Attending'], ['excused', 'Absent with excuse'], ['unexcused', 'Absent without excuse']], person.status)}</select></label>
        <button class="action" data-action="remove-person" data-index="${i}" aria-label="Remove person">Remove</button>
      </div>`).join('') : '<p>No attendance recorded.</p>'}</div>
    <div class="topline"><h2>Meeting points</h2>${button('add-point', '+ Add point')}</div>
    ${meeting.points.length ? meeting.points.map((point, i) => `<section class="card">
      <div class="card-header"><h3>Point ${i + 1}</h3><div class="row">
        <button class="action" data-action="move-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move point up">↑</button>
        <button class="action" data-action="move-down" data-index="${i}" ${i === meeting.points.length - 1 ? 'disabled' : ''} aria-label="Move point down">↓</button>
        <button class="action" data-action="remove-point" data-index="${i}">Delete</button></div></div>
      <div class="fields">
        <label>Headline<input data-point="${i}" data-field="headline" value="${escape(point.headline)}" placeholder="Headline"></label>
        <label>Type<select data-point="${i}" data-field="type">${options([['discussion', 'Discussion'], ['decision', 'Decision'], ['info', 'Info']], point.type)}</select></label>
      </div>
      <label>Details <span class="muted">(Markdown)</span><textarea data-point="${i}" data-field="details" placeholder="Write details in Markdown">${escape(point.details)}</textarea></label>
      <div class="card-header"><h3>Tasks</h3><button class="action" data-action="add-task" data-index="${i}">+ Add task</button></div>
      ${point.tasks.map((task, j) => `<div class="row">
        <label>Task<input data-point="${i}" data-task="${j}" data-field="description" value="${escape(task.description)}" placeholder="Task"></label>
        <label>Responsible persons<input data-point="${i}" data-task="${j}" data-field="responsible" value="${escape(task.responsible)}" placeholder="Names"></label>
        <label class="checkbox"><input type="checkbox" data-point="${i}" data-task="${j}" data-field="done" ${task.done ? 'checked' : ''}> Done</label>
        <button class="action" data-action="remove-task" data-index="${i}" data-task="${j}" aria-label="Remove task">Remove</button>
      </div>`).join('')}</section>`).join('') : '<p>No meeting points yet.</p>'}`;
}

function tasksView() {
  const tasks = state.meetings.flatMap(({ meeting }) => meeting.points.flatMap((point, pointIndex) =>
    point.tasks.flatMap((task, taskIndex) => task.done ? [] : [{ meeting, point, task, pointIndex, taskIndex }])));
  return `<div class="topline"><div><h1>Open tasks</h1><p>Outstanding tasks from saved meetings.</p></div>${button('refresh-tasks', 'Reload tasks')}</div>
    ${tasks.length ? tasks.map(({ meeting, point, task, pointIndex, taskIndex }) => `<div class="card">
      <label class="checkbox"><input type="checkbox" data-complete-task data-id="${escape(meeting.id)}" data-point-index="${pointIndex}" data-task-index="${taskIndex}">
      <strong>${escape(task.description || 'Untitled task')}</strong> <span class="muted">Mark done</span></label>
      <p>${escape(meeting.title || 'Untitled meeting')} · ${escape(point.headline || 'Untitled point')}</p>
      <span class="badge">${escape(task.responsible || 'Unassigned')}</span>
      <button class="action" data-action="select-task-meeting" data-id="${escape(meeting.id)}">Open meeting</button></div>`).join('') :
      '<div class="card"><p>No open tasks.</p></div>'}`;
}

function render() {
  document.querySelectorAll('[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === state.view));
  let content = '';
  if (state.view === 'settings') {
    content = `<h1>Settings</h1><div class="card"><h2>Data folder</h2>
      <p>Choose where ClubManager stores its data. Each module has its own subfolder.</p>
      <p class="path">${escape(state.folder || 'No folder selected')}</p>
      ${button('choose-folder', state.folder ? 'Change folder' : 'Choose folder', 'primary')}
      <p>Changing folders opens the data already in the new location; existing data is not moved.</p></div>`;
  } else if (!state.folder) {
    content = `<div class="empty"><h1>Welcome to ClubManager</h1><p>Choose a data folder in Settings to get started.</p>${button('open-settings', 'Open Settings', 'primary')}</div>`;
  } else if (state.view === 'meetings') {
    content = state.meeting ? meetingEditor(state.meeting) : '<div class="empty"><h1>Meetings</h1><p>Create a meeting or choose one from the list.</p></div>';
  } else if (state.view === 'tasks') {
    content = tasksView();
  } else {
    const titles = { members: 'Members', invoices: 'Invoices', letters: 'Letters' };
    content = `<h1>${titles[state.view]}</h1><div class="card"><p>This module is planned for a future version.</p></div>`;
  }
  app.innerHTML = `<div class="layout">${state.view === 'meetings' && state.folder ? meetingList() : ''}
    <div class="content"><div class="content-inner">${notice()}${content}</div></div></div>`;
}

async function refresh() {
  state.meetings = state.folder ? await window.club.listMeetings() : [];
}

async function changeView(view) {
  if (view === state.view) return;
  if (!confirmDiscard()) return;
  state.meeting = null;
  state.revision = null;
  state.dirty = false;
  state.view = view;
  setMessage('');
  await refresh();
}

async function run(action, target) {
  const meeting = state.meeting;
  const i = Number(target.dataset.index);
  switch (action) {
    case 'open-settings': await changeView('settings'); break;
    case 'choose-folder': {
      const selected = await window.club.chooseFolder();
      if (selected) {
        state.folder = selected;
        state.meeting = null;
        state.revision = null;
        state.dirty = false;
        await refresh();
        setMessage('Storage folder selected. Module folders are ready.');
      }
      break;
    }
    case 'new':
    case 'sample':
      if (!confirmDiscard()) return;
      state.meeting = action === 'sample' ? sampleMeeting() : blankMeeting();
      state.revision = null;
      state.dirty = true;
      setMessage(action === 'sample' ? 'This is sample data. Save it if you want to keep it.' : '');
      break;
    case 'select':
    case 'select-task-meeting': {
      if (!confirmDiscard()) return;
      await refresh();
      const selected = state.meetings.find(item => item.meeting.id === target.dataset.id);
      if (!selected) throw new Error('Meeting no longer exists on disk.');
      state.meeting = structuredClone(selected.meeting);
      state.revision = selected.revision;
      state.dirty = false;
      state.view = 'meetings';
      setMessage('');
      break;
    }
    case 'refresh-tasks':
      await refresh();
      setMessage('Tasks reloaded.');
      break;
    case 'save':
      if (!meeting.title.trim()) throw new Error('Enter a meeting title before saving.');
      state.revision = await window.club.saveMeeting(meeting, state.revision);
      state.dirty = false;
      await refresh();
      setMessage('Meeting saved.');
      break;
    case 'export':
      if (state.dirty || !state.revision) throw new Error('Save the meeting before exporting its PDF.');
      setMessage(`PDF saved to ${await window.club.exportMeeting(meeting, state.revision)}`);
      break;
    case 'add-person': meeting.attendance.push({ name: '', status: 'attending' }); state.dirty = true; break;
    case 'remove-person': meeting.attendance.splice(i, 1); state.dirty = true; break;
    case 'add-point': meeting.points.push({ headline: '', type: 'discussion', details: '', tasks: [] }); state.dirty = true; break;
    case 'remove-point':
      if (window.confirm('Delete this point and its tasks?')) { meeting.points.splice(i, 1); state.dirty = true; }
      break;
    case 'move-up':
    case 'move-down': {
      const destination = i + (action === 'move-up' ? -1 : 1);
      [meeting.points[i], meeting.points[destination]] = [meeting.points[destination], meeting.points[i]];
      state.dirty = true;
      break;
    }
    case 'add-task': meeting.points[i].tasks.push({ description: '', responsible: '', done: false }); state.dirty = true; break;
    case 'remove-task': meeting.points[i].tasks.splice(Number(target.dataset.task), 1); state.dirty = true; break;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  document.body.inert = true;
  try {
    if (target.dataset.view) await changeView(target.dataset.view);
    if (target.dataset.action) await run(target.dataset.action, target);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    document.body.inert = false;
  }
  render();
});

app.addEventListener('change', async event => {
  const target = event.target;
  if (!target.matches('[data-complete-task]') || !target.checked) return;
  document.body.inert = true;
  try {
    const record = state.meetings.find(item => item.meeting.id === target.dataset.id);
    if (!record) throw new Error('Meeting no longer exists. Reload tasks and try again.');
    const meeting = structuredClone(record.meeting);
    const task = meeting.points[Number(target.dataset.pointIndex)]?.tasks[Number(target.dataset.taskIndex)];
    if (!task || task.done) throw new Error('Task is no longer open. Reload tasks and try again.');
    task.done = true;
    const revision = await window.club.saveMeeting(meeting, record.revision);
    record.meeting = meeting;
    record.revision = revision;
    setMessage('Task marked done.');
  } catch (error) {
    setMessage(`${error.message} Reload tasks to see the latest saved data.`, true);
  } finally {
    document.body.inert = false;
    render();
  }
});

app.addEventListener('input', event => {
  const target = event.target;
  if (!target.dataset.field || !state.meeting) return;
  let item = state.meeting;
  if (target.dataset.person !== undefined) item = item.attendance[Number(target.dataset.person)];
  if (target.dataset.point !== undefined) item = item.points[Number(target.dataset.point)];
  if (target.dataset.task !== undefined) item = item.tasks[Number(target.dataset.task)];
  item[target.dataset.field] = target.type === 'checkbox' ? target.checked : target.value;
  state.dirty = true;
  const status = document.querySelector('.status');
  if (status) status.textContent = 'Unsaved changes';
});

window.addEventListener('beforeunload', event => {
  if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
});

(async () => {
  try {
    state.folder = await window.club.getFolder();
    await refresh();
  } catch (error) {
    setMessage(error.message, true);
  }
  render();
})();
