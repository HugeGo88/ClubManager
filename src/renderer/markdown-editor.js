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
  const add = (from, to, decoration) => {
    if (from < to && !view.state.doc.sliceString(from, to).includes('\n')) ranges.push(decoration.range(from, to));
  };
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
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

window.createMarkdownEditor = (parent, value, onChange, label) => new EditorView({
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
