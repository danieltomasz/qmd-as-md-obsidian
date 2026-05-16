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

export interface NewFilePreset {
  id: string;
  name: string;
  description: string;
  body: string;
}

// Built-in presets. v0: hard-coded; later versions will let users edit/add
// these in plugin settings (same shape, persisted in QmdPluginSettings).
export const DEFAULT_PRESETS: NewFilePreset[] = [
  {
    id: 'empty',
    name: 'Empty',
    description: 'Minimal front-matter, no format specified.',
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
    id: 'typst',
    name: 'Typst PDF (modern)',
    description: 'format: typst with A4, 2 cm margins, numbered sections, TOC.',
    body: `---
title: ""
author: ""
date: today
format:
  typst:
    papersize: a4
    margin:
      x: 2cm
      y: 2cm
    fontsize: 11pt
    section-numbering: 1.1.a
    toc: true
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
    el.createEl('div', { text: preset.name, cls: 'qmd-preset-name' });
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

export async function newQmdFromPreset(app: App): Promise<void> {
  const modal = new PresetSuggestModal(app, DEFAULT_PRESETS, (preset) => {
    const folder = activeFolderPath(app);
    new FilenameModal(app, preset, folder, async (filename) => {
      try {
        const target = await buildTargetPath(app, folder, filename);
        // Ensure parent folder exists. getActiveFile() can return a stale
        // folder reference if the user just moved things; recreate on miss.
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
