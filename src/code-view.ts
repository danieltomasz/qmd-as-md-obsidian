import { EditorState, RangeSetBuilder, StateField, Text } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, keymap } from '@codemirror/view';
import { indentMore, indentLess } from '@codemirror/commands';
import { TextFileView, WorkspaceLeaf } from 'obsidian';

export const QMD_YAML_VIEW = 'qmd-yaml-view';
export const QMD_LUA_VIEW = 'qmd-lua-view';

const yamlHighlightField = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    return buildYamlDecorations(state.doc);
  },
  update(decorations, transaction): DecorationSet {
    if (transaction.docChanged) {
      return buildYamlDecorations(transaction.state.doc);
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildYamlDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    decorateYamlLine(builder, line.from, line.text);
  }
  return builder.finish();
}

function decorateYamlLine(builder: RangeSetBuilder<Decoration>, lineStart: number, line: string): void {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const content = line.slice(indent.length);
  const contentStart = lineStart + indent.length;
  if (!content) return;

  if (content.startsWith('#')) {
    markYamlToken(builder, contentStart, lineStart + line.length, 'qmd-yaml-comment');
    return;
  }

  const markerMatch = content.match(/^(-\s+)(.*)$/);
  if (markerMatch) {
    const markerLength = markerMatch[1].length;
    markYamlToken(builder, contentStart, contentStart + markerLength, 'qmd-yaml-list-marker');
    decorateYamlSegment(builder, contentStart + markerLength, markerMatch[2]);
    return;
  }

  decorateYamlSegment(builder, contentStart, content);
}

function decorateYamlSegment(builder: RangeSetBuilder<Decoration>, segmentStart: number, segment: string): void {
  const docMatch = segment.match(/^(\.{3}|-{3})(\s*(#.*)?)$/);
  if (docMatch) {
    const markerLength = docMatch[1].length;
    markYamlToken(builder, segmentStart, segmentStart + markerLength, 'qmd-yaml-doc-marker');
    decorateYamlValue(builder, segmentStart + markerLength, docMatch[2] ?? '');
    return;
  }

  const colon = findYamlKeyColon(segment);
  if (colon !== -1) {
    markYamlToken(builder, segmentStart, segmentStart + colon, 'qmd-yaml-key');
    markYamlToken(builder, segmentStart + colon, segmentStart + colon + 1, 'qmd-yaml-colon');
    decorateYamlValue(builder, segmentStart + colon + 1, segment.slice(colon + 1));
    return;
  }

  decorateYamlValue(builder, segmentStart, segment);
}

function decorateYamlValue(builder: RangeSetBuilder<Decoration>, valueStart: number, value: string): void {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const rest = value.slice(leading.length);
  const restStart = valueStart + leading.length;
  if (!rest) return;

  const commentIndex = findYamlComment(rest);
  const scalar = commentIndex === -1 ? rest : rest.slice(0, commentIndex);
  decorateYamlScalar(builder, restStart, scalar);
  if (commentIndex !== -1) {
    markYamlToken(builder, restStart + commentIndex, restStart + rest.length, 'qmd-yaml-comment');
  }
}

function decorateYamlScalar(builder: RangeSetBuilder<Decoration>, scalarStart: number, scalar: string): void {
  const trailing = scalar.match(/\s*$/)?.[0] ?? '';
  const token = trailing ? scalar.slice(0, scalar.length - trailing.length) : scalar;
  if (!token) return;

  const className = yamlScalarClass(token);
  markYamlToken(builder, scalarStart, scalarStart + token.length, className);
}

function yamlScalarClass(token: string): string {
  if (/^['"].*['"]$/.test(token)) return 'qmd-yaml-string';
  if (/^[&*][A-Za-z0-9_-]+$/.test(token)) return 'qmd-yaml-anchor';
  // YAML 1.2 (what Quarto/Pandoc use): only true/false/null/~ are
  // booleans/null. yes/no/on/off are plain scalars, not booleans.
  if (/^(true|false|null|~)$/i.test(token)) return 'qmd-yaml-boolean';
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(token)) return 'qmd-yaml-number';
  if (/^[>|][+-]?$/.test(token)) return 'qmd-yaml-block';
  if (/^(html|pdf|typst|latex|beamer|revealjs|docx|odt|epub|gfm|jats|dashboard)$/i.test(token)) {
    return 'qmd-yaml-quarto-format';
  }
  return 'qmd-yaml-scalar';
}

function findYamlKeyColon(segment: string): number {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    const prev = i > 0 ? segment[i - 1] : '';
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
    } else if (char === '"' && !singleQuoted && prev !== '\\') {
      doubleQuoted = !doubleQuoted;
    } else if (char === ':' && !singleQuoted && !doubleQuoted) {
      const next = segment[i + 1] ?? '';
      const key = segment.slice(0, i).trim();
      if (key && (!next || /\s/.test(next))) return i;
    }
  }
  return -1;
}

function findYamlComment(value: string): number {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const prev = i > 0 ? value[i - 1] : '';
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
    } else if (char === '"' && !singleQuoted && prev !== '\\') {
      doubleQuoted = !doubleQuoted;
    } else if (char === '#' && !singleQuoted && !doubleQuoted && (i === 0 || /\s/.test(prev))) {
      return i;
    }
  }
  return -1;
}

function markYamlToken(
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
  className: string
): void {
  if (to <= from) return;
  builder.add(from, to, Decoration.mark({ class: className }));
}

// --- Lua highlighting -----------------------------------------------------
//
// Minimal Lua syntax highlighting for the Lua file view — enough to make
// pandoc/Quarto filter scripts readable. A single forward scan over the
// whole document text marks comments, strings, numbers and keywords;
// everything else is left unstyled. The forward scan guarantees the
// RangeSetBuilder receives ranges in ascending, non-overlapping order.

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
  'true', 'until', 'while',
]);

const luaHighlightField = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    return buildLuaDecorations(state.doc);
  },
  update(decorations, transaction): DecorationSet {
    if (transaction.docChanged) {
      return buildLuaDecorations(transaction.state.doc);
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildLuaDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const s = doc.toString();
  const len = s.length;

  const mark = (from: number, to: number, className: string): void => {
    if (to > from) builder.add(from, to, Decoration.mark({ class: className }));
  };

  // If a Lua long bracket opens at `open` (`[`, `[=[`, `[==[`, …), return the
  // index just past its matching close; an unterminated bracket runs to EOF.
  // Returns -1 when `open` is not a long-bracket opener.
  const longBracketEnd = (open: number): number => {
    if (s[open] !== '[') return -1;
    let j = open + 1;
    let level = 0;
    while (s[j] === '=') {
      level++;
      j++;
    }
    if (s[j] !== '[') return -1;
    const close = ']' + '='.repeat(level) + ']';
    const idx = s.indexOf(close, j + 1);
    return idx === -1 ? len : idx + close.length;
  };

  let i = 0;
  while (i < len) {
    const c = s[i];

    // comment: line (`-- …`) or block (`--[[ … ]]`, `--[==[ … ]==]`)
    if (c === '-' && s[i + 1] === '-') {
      const block = longBracketEnd(i + 2);
      if (block !== -1) {
        mark(i, block, 'qmd-lua-comment');
        i = block;
        continue;
      }
      let j = i + 2;
      while (j < len && s[j] !== '\n') j++;
      mark(i, j, 'qmd-lua-comment');
      i = j;
      continue;
    }

    // long-bracket string
    if (c === '[') {
      const long = longBracketEnd(i);
      if (long !== -1) {
        mark(i, long, 'qmd-lua-string');
        i = long;
        continue;
      }
    }

    // quoted string (single or double); does not span lines
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < len && s[j] !== c && s[j] !== '\n') {
        if (s[j] === '\\') j++;
        j++;
      }
      if (j < len && s[j] === c) j++;
      mark(i, j, 'qmd-lua-string');
      i = j;
      continue;
    }

    // number (decimal, hex, fractional, exponent)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i;
      if (c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X')) {
        j = i + 2;
        while (j < len && /[0-9a-fA-F.]/.test(s[j])) j++;
      } else {
        while (j < len && /[0-9.]/.test(s[j])) j++;
        if (s[j] === 'e' || s[j] === 'E') {
          j++;
          if (s[j] === '+' || s[j] === '-') j++;
          while (j < len && /[0-9]/.test(s[j])) j++;
        }
      }
      mark(i, j, 'qmd-lua-number');
      i = j;
      continue;
    }

    // identifier — only keywords get marked
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(s[j])) j++;
      if (LUA_KEYWORDS.has(s.slice(i, j))) mark(i, j, 'qmd-lua-keyword');
      i = j;
      continue;
    }

    i++;
  }

  return builder.finish();
}

interface CodeViewConfig {
  label: string;
  ariaLabel: string;
  highlightField: StateField<DecorationSet>;
}

const YAML_CODE_VIEW: CodeViewConfig = {
  label: 'YAML file',
  ariaLabel: 'YAML file contents',
  highlightField: yamlHighlightField,
};

const LUA_CODE_VIEW: CodeViewConfig = {
  label: 'Lua file',
  ariaLabel: 'Lua file contents',
  highlightField: luaHighlightField,
};

// A minimal CodeMirror-backed file view, shared by the YAML and Lua file
// views. The only per-language difference is the highlight StateField and
// the labels, supplied through CodeViewConfig.
//
// getViewType() is left abstract on purpose: Obsidian's View constructor
// calls getViewType() *during* super(), before subclass constructor params
// and field initializers have run, so it cannot read instance state. Each
// concrete subclass returns a module-level literal instead.
abstract class QmdCodeFileView extends TextFileView {
  private editorView: EditorView | null = null;
  private settingViewData = false;

  constructor(leaf: WorkspaceLeaf, private readonly config: CodeViewConfig) {
    super(leaf);
  }

  abstract getViewType(): string;

  getDisplayText(): string {
    return this.file?.name ?? this.config.label;
  }

  getIcon(): string {
    return 'file-code';
  }

  onload(): void {
    super.onload();
    this.contentEl.empty();
    this.contentEl.addClass('qmd-code-view');
    this.editorView = new EditorView({
      parent: this.contentEl,
      state: EditorState.create({
        doc: this.data ?? '',
        extensions: [
          EditorState.tabSize.of(2),
          this.config.highlightField,
          EditorView.contentAttributes.of({
            'aria-label': this.config.ariaLabel,
            autocapitalize: 'off',
            autocomplete: 'off',
            spellcheck: 'false',
          }),
          keymap.of([
            { key: 'Tab', run: indentMore },
            { key: 'Shift-Tab', run: indentLess },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || this.settingViewData) return;
            this.data = update.state.doc.toString();
            this.requestSave();
          }),
        ],
      }),
    });
    this.register(() => {
      this.editorView?.destroy();
      this.editorView = null;
    });
  }

  getViewData(): string {
    return this.editorView?.state.doc.toString() ?? this.data ?? '';
  }

  setViewData(data: string): void {
    this.data = data;
    const view = this.editorView;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === data) return;
    this.settingViewData = true;
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: current.length,
          insert: data,
        },
      });
    } finally {
      this.settingViewData = false;
    }
  }

  clear(): void {
    this.setViewData('');
  }
}

export class QmdYamlFileView extends QmdCodeFileView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf, YAML_CODE_VIEW);
  }

  getViewType(): string {
    return QMD_YAML_VIEW;
  }
}

export class QmdLuaFileView extends QmdCodeFileView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf, LUA_CODE_VIEW);
  }

  getViewType(): string {
    return QMD_LUA_VIEW;
  }
}
