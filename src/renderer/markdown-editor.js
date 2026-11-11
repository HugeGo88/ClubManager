import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

const marks = {
  StrongEmphasis: 'markdown-strong',
  Emphasis: 'markdown-emphasis',
  Strikethrough: 'markdown-strike',
  InlineCode: 'markdown-code',
  Link: 'markdown-link'
};

class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement('span');
    bullet.className = 'markdown-bullet';
    bullet.textContent = '•';
    bullet.setAttribute('aria-hidden', 'true');
    return bullet;
  }
}

class TaskWidget extends WidgetType {
  constructor(from, checked, text) {
    super();
    this.from = from;
    this.checked = checked;
    this.text = text;
  }

  eq(other) {
    return this.from === other.from && this.checked === other.checked && this.text === other.text;
  }

  toDOM(view) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'markdown-task';
    checkbox.checked = this.checked;
    const action = this.checked ? 'als offen markieren' : 'als erledigt markieren';
    checkbox.setAttribute('aria-label', `Markdown-Aufgabe ${this.text || 'ohne Beschreibung'} ${action}`);
    checkbox.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.from + 1, to: this.from + 2, insert: checkbox.checked ? 'x' : ' ' } });
    });
    return checkbox;
  }

  ignoreEvent() {
    return true;
  }
}

function selected(view, from, to) {
  return view.hasFocus && view.state.selection.ranges.some(range => range.from <= to && range.to >= from);
}

function decorations(view) {
  const ranges = [];
  const underlineTags = new Map();
  const add = (from, to, decoration) => {
    if (from < to && !view.state.doc.sliceString(from, to).includes('\n')) ranges.push(decoration.range(from, to));
  };
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      if (name === 'HTMLTag' && node.node.parent?.name === 'Paragraph') {
        const tag = view.state.doc.sliceString(node.from, node.to).toLowerCase();
        const parent = node.node.parent;
        const key = `${parent.from}:${parent.to}`;
        if (tag === '<u>') {
          const stack = underlineTags.get(key) || [];
          stack.push({ from: node.from, to: node.to });
          underlineTags.set(key, stack);
        } else if (tag === '</u>') {
          const opening = underlineTags.get(key)?.pop();
          if (opening) {
            for (let pos = opening.to; pos < node.from;) {
              const line = view.state.doc.lineAt(pos);
              add(pos, Math.min(line.to, node.from), Decoration.mark({ class: 'markdown-underline' }));
              pos = line.to + 1;
            }
            if (!selected(view, opening.from, node.to)) {
              add(opening.from, opening.to, Decoration.replace({}));
              add(node.from, node.to, Decoration.replace({}));
            }
          }
        }
        return;
      }
      if (name === 'ListMark') {
        const marker = view.state.doc.sliceString(node.from, node.to);
        const task = node.node.parent?.getChild('Task')?.getChild('TaskMarker');
        if (!selected(view, node.from, node.to) && task) {
          add(node.from, node.to, Decoration.replace({}));
        } else if (!selected(view, node.from, node.to) && /^[-+*]$/.test(marker)) {
          add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
        } else if (/^\d+[.)]$/.test(marker)) {
          add(node.from, node.to, Decoration.mark({ class: 'markdown-list-number' }));
        }
        return;
      }
      if (name === 'TaskMarker') {
        if (!selected(view, node.from, node.to)) {
          const checked = view.state.doc.sliceString(node.from + 1, node.from + 2).toLowerCase() === 'x';
          const end = Math.min(node.node.parent.to, view.state.doc.lineAt(node.from).to);
          const text = view.state.doc.sliceString(node.to, end).trim();
          add(node.from, node.to, Decoration.replace({ widget: new TaskWidget(node.from, checked, text) }));
        }
        return;
      }
      const isHeading = /^ATXHeading[1-6]$/.test(name);
      if (!marks[name] && !isHeading) return;
      if (marks[name]) add(node.from, node.to, Decoration.mark({ class: marks[name] }));
      if (isHeading) {
        ranges.push(Decoration.line({ class: `markdown-heading-${name.slice(-1)}` }).range(view.state.doc.lineAt(node.from).from));
      }
      if (selected(view, node.from, node.to)) return;
      if (name === 'Link' && view.state.doc.sliceString(node.from, node.to).includes('\n')) return;
      const cursor = node.node.cursor();
      if (!cursor.firstChild()) return;
      do {
        if (['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'HeaderMark'].includes(cursor.name)) {
          let end = cursor.to;
          if (cursor.name === 'HeaderMark' && cursor.from === node.from) {
            while (end < node.to && view.state.doc.sliceString(end, end + 1) === ' ') end++;
          }
          add(cursor.from, end, Decoration.replace({}));
        } else if (name === 'Link' && cursor.name === 'LinkMark') {
          add(cursor.from, cursor.to, Decoration.replace({}));
        } else if (name === 'Link' && (cursor.name === 'URL' || cursor.name === 'LinkTitle')) {
          add(cursor.from, cursor.to, Decoration.replace({}));
        }
      } while (cursor.nextSibling());
    }
  });
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = decorations(view);
  }
  update(update) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
      this.decorations = decorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });

function toggleFormat(view, open, close) {
  const { state } = view;
  const { from, to, anchor, head } = state.selection.main;
  const text = state.doc.sliceString(from, to);
  let start = from;
  let end = to;
  let replacement;
  let selectionStart;
  let selectionEnd;
  const nestedItalic = open === '*' && from >= 3 && to + 3 <= state.doc.length &&
    state.doc.sliceString(from - 3, from) === '***' && state.doc.sliceString(to, to + 3) === '***' &&
    syntaxTree(state).resolveInner(from, 1).matchContext(['Paragraph', 'Emphasis']);
  if (nestedItalic) {
    start = from - 3;
    end = to + 3;
    replacement = `**${text}**`;
    selectionStart = start + 2;
    selectionEnd = selectionStart + text.length;
  } else if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
    replacement = text.slice(open.length, text.length - close.length);
    selectionStart = from;
    selectionEnd = from + replacement.length;
  } else if (from >= open.length && to + close.length <= state.doc.length &&
      state.doc.sliceString(from - open.length, from) === open &&
      state.doc.sliceString(to, to + close.length) === close &&
      (open !== '*' || (state.doc.sliceString(Math.max(0, from - 2), from - 1) !== '*' &&
        state.doc.sliceString(to + 1, Math.min(state.doc.length, to + 2)) !== '*'))) {
    start = from - open.length;
    end = to + close.length;
    replacement = text;
    selectionStart = start;
    selectionEnd = start + text.length;
  } else {
    replacement = open + text + close;
    selectionStart = from + open.length;
    selectionEnd = selectionStart + text.length;
  }
  view.dispatch({
    changes: { from: start, to: end, insert: replacement },
    selection: { anchor: anchor <= head ? selectionStart : selectionEnd, head: anchor <= head ? selectionEnd : selectionStart },
    userEvent: 'input'
  });
  view.focus();
}

window.createMarkdownEditor = (parent, value, onChange, label) => {
  const toolbar = document.createElement('div');
  toolbar.className = 'markdown-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', `Formatierung für ${label}`);
  const formats = [
    { name: 'Fett', text: 'F', className: 'format-bold', open: '**', close: '**' },
    { name: 'Kursiv', text: 'K', className: 'format-italic', open: '*', close: '*' },
    { name: 'Unterstrichen', text: 'U', className: 'format-underline', open: '<u>', close: '</u>' },
    { name: 'Durchgestrichen', text: 'S', className: 'format-strike', open: '~~', close: '~~' }
  ];
  parent.append(toolbar);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        EditorView.cspNonce.of('clubmanager-editor'),
        EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' }),
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        placeholder('Details in Markdown schreiben'),
        livePreview,
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChange(update.state.doc.toString());
        })
      ]
    })
  });
  for (const format of formats) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `markdown-format ${format.className}`;
    button.textContent = format.text;
    button.title = format.name;
    button.setAttribute('aria-label', format.name);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.stopPropagation();
      toggleFormat(view, format.open, format.close);
    });
    toolbar.append(button);
  }
  return view;
};
