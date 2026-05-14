import { ItemView, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import type QmdAsMdPlugin from './main';

// --- Quarto outline -------------------------------------------------------
//
// Obsidian's core Outline panel reads headings from metadataCache, which
// only parses .md files — a .qmd opened via registerExtensions still gets
// no heading cache, so the panel stays blank (issue #3). parseQmdHeadings
// scans the file text directly: ATX headings (`# ...`, up to 3 spaces of
// indent per CommonMark) only — setext headings (underlined with === / ---)
// are intentionally not supported, they are vanishingly rare in Quarto and
// the --- form collides with YAML/frontmatter syntax. The scan skips the
// YAML frontmatter block and fenced code blocks (``` / ~~~) so a `#` line
// inside an R/Python cell is not mistaken for a heading.

export const QMD_OUTLINE_VIEW = 'qmd-outline-view';

interface QmdHeading {
  level: number;
  text: string;
  line: number; // 0-based line index in the source
}

function parseQmdHeadings(content: string): QmdHeading[] {
  const lines = content.split(/\r?\n/);
  const headings: QmdHeading[] = [];
  let inFrontmatter = false;
  // Open code-fence state. Per CommonMark, a fence closes only on the same
  // marker char with a run at least as long as the opener — so a longer
  // ```` inside a ``` block, or a ~~~ inside a ``` block, does not close it.
  let fenceMarker: string | null = null; // '`' or '~' while inside a code block
  let fenceLength = 0; // length of the run that opened the current block

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // YAML frontmatter is only frontmatter when --- is the very first line.
    if (i === 0 && /^---\s*$/.test(line)) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
      continue;
    }

    // Fenced code block: a run of >=3 backticks or tildes, up to 3 spaces
    // of indent.
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const run = fence[1];
      const marker = run[0];
      if (fenceMarker === null) {
        fenceMarker = marker;
        fenceLength = run.length;
      } else if (marker === fenceMarker && run.length >= fenceLength) {
        fenceMarker = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMarker !== null) continue;

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      // Drop a trailing pandoc/quarto attribute block: `## Title {#id .cls}`.
      const text = h[2].replace(/\s*\{[^}]*\}\s*$/, '').trim();
      if (text) headings.push({ level: h[1].length, text, line: i });
    }
  }
  return headings;
}

export class QmdOutlineView extends ItemView {
  plugin: QmdAsMdPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: QmdAsMdPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return QMD_OUTLINE_VIEW;
  }

  getDisplayText(): string {
    return 'Quarto outline';
  }

  getIcon(): string {
    return 'list';
  }

  async onOpen(): Promise<void> {
    // The outline may already be the active leaf at this point (opened via
    // command/setting), so capture the underlying .qmd before rendering.
    this.plugin.trackActiveQuartoFile();
    this.render();
  }

  // Find the open markdown view for a file, regardless of which leaf is
  // active. .qmd files open as 'markdown' leaves (registerExtensions).
  private markdownViewFor(file: TFile): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
        return leaf.view;
      }
    }
    return null;
  }

  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('qmd-outline');

    const file = this.plugin.lastActiveQuartoFile;
    if (!file) {
      container.createDiv({
        cls: 'qmd-outline-empty',
        text: 'No Quarto (.qmd) file is active.',
      });
      return;
    }

    // Read live content from the open editor rather than the active leaf —
    // clicking inside this sidebar makes it the active leaf.
    const mdView = this.markdownViewFor(file);
    if (!mdView) {
      container.createDiv({
        cls: 'qmd-outline-empty',
        text: `Open ${file.name} to see its outline.`,
      });
      return;
    }

    const headings = parseQmdHeadings(mdView.editor.getValue());
    if (headings.length === 0) {
      container.createDiv({
        cls: 'qmd-outline-empty',
        text: 'No headings in this file.',
      });
      return;
    }

    const list = container.createDiv({ cls: 'qmd-outline-list' });
    for (const heading of headings) {
      const item = list.createDiv({
        cls: 'qmd-outline-item',
        text: heading.text,
        // Keyboard-accessible: focusable, announced as a link, and the
        // keydown handler below makes Enter/Space activate it.
        attr: { tabindex: '0', role: 'link' },
      });
      // Indentation is driven by CSS off this attribute — no inline styles.
      item.dataset.level = String(heading.level);

      const jumpTo = () => {
        // Resolve the editor by file, not by "active leaf" — the click
        // itself just moved focus to this sidebar.
        const view = this.markdownViewFor(file);
        if (!view) return;
        const pos = { line: heading.line, ch: 0 };
        this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        view.editor.setCursor(pos);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
        view.editor.focus();
      };

      item.addEventListener('click', jumpTo);
      item.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          jumpTo();
        }
      });
    }
  }
}
