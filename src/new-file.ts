import {
  App,
  Modal,
  Notice,
  Setting,
  SuggestModal,
  TFile,
  TFolder,
  normalizePath,
} from 'obsidian';

type PresetSource = 'built-in' | 'user';

export interface NewFilePreset {
  id: string;
  name: string;
  description: string;
  body: string;
  source: PresetSource;
}

// Built-in presets. v0: hard-coded; later versions will let users edit/add
// these in plugin settings (same shape, persisted in QmdPluginSettings).
export const DEFAULT_PRESETS: NewFilePreset[] = [
  {
    id: 'empty',
    name: 'Empty',
    description: 'Minimal front-matter, no format specified.',
    source: 'built-in',
    body: `---
title: ""
---

# Untitled
`,
  },
  {
    id: 'docx',
    name: 'Word (.docx)',
    description: 'format: docx with table of contents and numbered sections.',
    source: 'built-in',
    body: `---
title: ""
author: ""
date: today
format:
  docx:
    toc: true
    number-sections: true
    # reference-doc: reference.docx
---

# Untitled
`,
  },
  {
    id: 'typst-notes',
    name: 'Typst PDF — Notes (Eisvogel-style)',
    description:
      'Eisvogel-inspired Typst PDF: TOC, numbered sections, page header, boxed code.',
    source: 'built-in',
    body: `---
title: ""
author: ""
date: today
toc: false
toc-depth: 2
number-sections: true
format:
  typst:
    papersize: a4
    margin:
      x: 2cm
      y: 2.5cm
    fontsize: 11pt
    section-numbering: "1.1.1"
    # mainfont: "Libertinus Serif"
    # sansfont: "Libertinus Sans"
    # monofont: "JetBrains Mono"
    include-in-header:
      - text: |
          // Single accent color used throughout
          #let accent = rgb("#2E5C8A")

          // Page header: current top-level section + page number
          #set page(header: context {
            let heads = query(selector(heading.where(level: 1)).before(here()))
            let t = if heads.len() > 0 { heads.last().body } else [ ]
            text(size: 9pt, fill: gray, [#t #h(1fr) #counter(page).display()])
          })
          // Link color
          #show link: set text(fill: accent)
          // Boxed code blocks
          #show raw.where(block: true): it => block(
            fill: rgb("#f5f5f5"),
            inset: 10pt,
            radius: 4pt,
            width: 100%,
            it,
          )
          // Block quotes: colored left bar + muted italic
          #show quote.where(block: true): it => block(
            stroke: (left: 3pt + accent),
            inset: (left: 12pt, top: 4pt, bottom: 4pt),
            text(style: "italic", fill: gray.darken(20%), it.body),
          )
          // H1 headings: subtle accent rule
          #show heading.where(level: 1): it => [
            #it
            #v(-0.5em)
            #line(length: 100%, stroke: 0.5pt + accent.lighten(40%))
          ]
---

# Untitled
`,
  },
  {
    id: 'typst-report',
    name: 'Typst PDF — Report (Eisvogel-style)',
    description:
      'Eisvogel-inspired Typst report: cover metadata, TOC, numbered sections, boxed code, bibliography hints.',
    source: 'built-in',
    body: `---
title: ""
subtitle: ""
author: ""
date: today
# abstract: |
#   Short summary of the report.
# keywords: [keyword1, keyword2]
# bibliography: references.bib
# csl: ieee.csl
toc: true
toc-depth: 3
number-sections: true
format:
  typst:
    papersize: a4
    margin:
      x: 2.5cm
      y: 2.5cm
    fontsize: 11pt
    section-numbering: "1.1.1"
    # mainfont: "Libertinus Serif"
    # sansfont: "Libertinus Sans"
    # monofont: "JetBrains Mono"
    include-in-header:
      - text: |
          // Single accent color used throughout
          #let accent = rgb("#2E5C8A")

          // Page header: current top-level section + page number
          #set page(header: context {
            let heads = query(selector(heading.where(level: 1)).before(here()))
            let t = if heads.len() > 0 { heads.last().body } else [ ]
            text(size: 9pt, fill: gray, [#t #h(1fr) #counter(page).display()])
          })
          // Link color
          #show link: set text(fill: accent)
          // Boxed code blocks
          #show raw.where(block: true): it => block(
            fill: rgb("#f5f5f5"),
            inset: 10pt,
            radius: 4pt,
            width: 100%,
            it,
          )
          // Block quotes: colored left bar + muted italic
          #show quote.where(block: true): it => block(
            stroke: (left: 3pt + accent),
            inset: (left: 12pt, top: 4pt, bottom: 4pt),
            text(style: "italic", fill: gray.darken(20%), it.body),
          )
          // H1 headings: subtle accent rule
          #show heading.where(level: 1): it => [
            #it
            #v(-0.5em)
            #line(length: 100%, stroke: 0.5pt + accent.lighten(40%))
          ]
---

# Untitled
`,
  },
];

class PresetSuggestModal extends SuggestModal<NewFilePreset> {
  constructor(
    app: App,
    private presets: NewFilePreset[],
    private onChoose: (preset: NewFilePreset) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a Quarto file preset…');
  }

  getSuggestions(query: string): NewFilePreset[] {
    const q = query.toLowerCase();
    if (!q) return this.presets;
    return this.presets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }

  renderSuggestion(preset: NewFilePreset, el: HTMLElement): void {
    const title = preset.source === 'built-in'
      ? `${preset.name}  (built-in)`
      : preset.name;
    el.createEl('div', { text: title, cls: 'qmd-preset-name' });
    el.createEl('small', { text: preset.description, cls: 'qmd-preset-desc' });
  }

  onChooseSuggestion(preset: NewFilePreset): void {
    this.onChoose(preset);
  }
}

class FilenameModal extends Modal {
  private value: string;

  constructor(
    app: App,
    private preset: NewFilePreset,
    private folderPath: string,
    private onSubmit: (filename: string) => void,
  ) {
    super(app);
    this.value = 'untitled';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: `New Quarto file: ${this.preset.name}` });
    contentEl.createEl('p', {
      text: `Folder: ${this.folderPath || '(vault root)'}`,
      cls: 'setting-item-description',
    });

    new Setting(contentEl)
      .setName('Filename')
      .setDesc('".qmd" is added automatically if omitted.')
      .addText((text) => {
        text
          .setPlaceholder('untitled')
          .setValue(this.value)
          .onChange((v) => (this.value = v));
        text.inputEl.focus();
        text.inputEl.select();
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Create')
        .setCta()
        .onClick(() => this.submit()),
    );
  }

  private submit(): void {
    const raw = this.value.trim();
    if (!raw) {
      new Notice('Filename is required.');
      return;
    }
    this.close();
    this.onSubmit(raw);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// Strip path separators and trailing ".qmd"; callers add the extension back.
function sanitizeBaseName(input: string): string {
  const noSlashes = input.replace(/[\\/]/g, '-').trim();
  return noSlashes.replace(/\.qmd$/i, '');
}

// Pick a target path next to the active file, falling back to vault root.
// Existing files are not overwritten — appends "-1", "-2", … until free.
async function buildTargetPath(
  app: App,
  folderPath: string,
  base: string,
): Promise<string> {
  const safe = sanitizeBaseName(base) || 'untitled';
  let candidate = normalizePath(
    folderPath ? `${folderPath}/${safe}.qmd` : `${safe}.qmd`,
  );
  let n = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(
      folderPath ? `${folderPath}/${safe}-${n}.qmd` : `${safe}-${n}.qmd`,
    );
    n += 1;
  }
  return candidate;
}

function activeFolderPath(app: App): string {
  const active = app.workspace.getActiveFile();
  if (active?.parent) return active.parent.path === '/' ? '' : active.parent.path;
  return '';
}

// Read every top-level .qmd inside `folderPath` and turn each into a user
// preset. Subfolders are skipped — keeps the picker flat and predictable.
// Missing folder or read errors degrade silently to "no user presets"; the
// built-ins still show up so the command never appears broken.
async function loadUserPresets(
  app: App,
  folderPath: string,
): Promise<NewFilePreset[]> {
  const trimmed = folderPath.trim();
  if (!trimmed) return [];
  const folder = app.vault.getAbstractFileByPath(normalizePath(trimmed));
  if (!(folder instanceof TFolder)) return [];
  const out: NewFilePreset[] = [];
  for (const child of folder.children) {
    if (!(child instanceof TFile)) continue;
    if (child.extension.toLowerCase() !== 'qmd') continue;
    try {
      const body = await app.vault.cachedRead(child);
      out.push({
        id: `user:${child.path}`,
        name: child.basename,
        description: `From ${child.path}`,
        source: 'user',
        body,
      });
    } catch (err) {
      console.warn(`[qmd-as-md] Skipped template ${child.path}:`, err);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function newQmdFromPreset(
  app: App,
  templatesFolder: string,
): Promise<void> {
  const userPresets = await loadUserPresets(app, templatesFolder);
  // User presets first — they're the ones the user actively curated; built-ins
  // fall to the bottom as fallback options.
  const presets = [...userPresets, ...DEFAULT_PRESETS];

  const modal = new PresetSuggestModal(app, presets, (preset) => {
    const folder = activeFolderPath(app);
    new FilenameModal(app, preset, folder, async (filename) => {
      try {
        const target = await buildTargetPath(app, folder, filename);
        const parent = target.includes('/')
          ? target.slice(0, target.lastIndexOf('/'))
          : '';
        if (parent && !(app.vault.getAbstractFileByPath(parent) instanceof TFolder)) {
          await app.vault.createFolder(parent);
        }
        const file = await app.vault.create(target, preset.body);
        if (file instanceof TFile) {
          await app.workspace.getLeaf(false).openFile(file);
        }
        new Notice(`Created ${target}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Failed to create file: ${msg}`);
      }
    }).open();
  });
  modal.open();
}