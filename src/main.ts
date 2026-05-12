import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  FileSystemAdapter,
  WorkspaceLeaf,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
  quartoPath: string;
  enableQmdLinking: boolean;
  quartoTypst: string;
  emitCompilationLogs: boolean;
  openPdfInObsidian: boolean;
  previewInObsidian: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  enableQmdLinking: true,
  quartoTypst: '',
  emitCompilationLogs: true,
  openPdfInObsidian: false,
  previewInObsidian: true,
};

export default class QmdAsMdPlugin extends Plugin {
  settings: QmdPluginSettings;
  activePreviewProcesses: Map<string, ChildProcess> = new Map();

  async onload() {
    console.log('Plugin is loading...');
    try {
      await this.loadSettings();
      console.log('Settings loaded:', this.settings);

      if (this.settings.enableQmdLinking) {
        this.registerQmdExtension();
      }

      this.addSettingTab(new QmdSettingTab(this.app, this));
      console.log('Settings tab added successfully');

      this.addRibbonIcon('eye', 'Toggle Quarto Preview', async () => {
        const file = this.getActiveQuartoFile();
        if (file) {
          console.log(`Toggling preview for: ${file.path}`);
          await this.togglePreview(file);
        }
      });
      console.log('Ribbon icon added');

      this.addCommand({
        id: 'toggle-quarto-preview',
        name: 'Toggle Quarto Preview',
        callback: async () => {
          const file = this.getActiveQuartoFile();
          if (file) {
            console.log(`Command: Toggling preview for ${file.path}`);
            await this.togglePreview(file);
          }
        },
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }],
      });

      this.addRibbonIcon('file-output', 'Render Quarto to PDF', async () => {
        const file = this.getActiveQuartoFile();
        if (file) await this.renderPdf(file);
      });

      this.registerRenderCommand('render-quarto-pdf', 'Render Quarto (use YAML format)');
      this.registerRenderCommand('render-quarto-pdf-typst', 'Render Quarto to PDF (Typst engine)', 'typst');
      this.registerRenderCommand('render-quarto-pdf-latex', 'Render Quarto to PDF (LaTeX engine)', 'pdf');

      console.log('Commands added');
    } catch (error) {
      console.error('Error loading plugin:', error);
      new Notice(
        'Failed to load QmdAsMdPlugin. Check the developer console for details.'
      );
    }
  }

  onunload() {
    console.log('Plugin is unloading...');
    this.stopAllPreviews();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  isQuartoFile(file: TFile): boolean {
    return file.extension === 'qmd';
  }

  getActiveQuartoFile(): TFile | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file && this.isQuartoFile(activeView.file)) {
      return activeView.file;
    }
    new Notice('Current file is not a Quarto document');
    return null;
  }

  getVaultFullPath(file: TFile): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getFullPath(file.path);
    }
    new Notice('Vault is not on a local filesystem; cannot run Quarto.');
    return null;
  }

  pdfPathFor(qmdFile: TFile): string {
    return qmdFile.path.replace(/\.qmd$/i, '.pdf');
  }

  // Open (or reuse) a leaf showing the given vault-relative PDF path in
  // Obsidian's native PDF viewer. Returns the leaf so callers can keep
  // refreshing it on subsequent preview compiles.
  async openOrRefreshPdfPreview(
    vaultPath: string,
    existingLeaf: WorkspaceLeaf | null
  ): Promise<WorkspaceLeaf | null> {
    const pdfTFile = await this.waitForVaultFile(vaultPath);
    if (!pdfTFile) {
      new Notice(
        `Quarto preview produced ${vaultPath} but it did not appear in the vault within the timeout.`
      );
      return null;
    }
    try {
      const leaf =
        existingLeaf?.parent != null
          ? existingLeaf
          : this.app.workspace.getLeaf('split', 'vertical');
      await leaf.openFile(pdfTFile, { active: false });
      this.app.workspace.revealLeaf(leaf);
      return leaf;
    } catch (err) {
      console.error('[qmd-as-md] Failed to open PDF preview in native viewer:', err);
      new Notice(`Could not open ${vaultPath} in Obsidian's PDF viewer.`);
      return null;
    }
  }

  async openPreviewUrl(url: string) {
    new Notice(`Preview available at ${url}`);

    if (!this.settings.previewInObsidian) {
      // Electron's renderer routes window.open for http(s) URLs through
      // shell.openExternal, which lands in the user's default browser.
      window.open(url, '_blank');
      return;
    }

    // The "Web viewer" core plugin (Obsidian 1.8+) registers the
    // 'webviewer' view type. If the user has it disabled, setViewState
    // silently fails / leaves an empty leaf, and the user is left
    // wondering why nothing opened. Detect and report instead.
    const internalPlugins = (this.app as any).internalPlugins;
    const webviewerOn =
      internalPlugins?.getEnabledPluginById?.('webviewer') != null ||
      internalPlugins?.plugins?.webviewer?.enabled === true;

    if (!webviewerOn) {
      new Notice(
        'Obsidian core plugin "Web viewer" is disabled — cannot show preview in-app. ' +
          'Enable it in Settings → Core plugins, or turn off "Open Quarto preview in Obsidian" ' +
          'to use your external browser instead.',
        10000
      );
      console.warn(
        '[qmd-as-md] webviewer core plugin disabled; preview URL was:',
        url
      );
      return;
    }

    try {
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: 'webviewer',
        active: true,
        state: { url },
      });
      this.app.workspace.revealLeaf(leaf);
    } catch (err) {
      console.error('[qmd-as-md] Failed to open preview in webviewer:', err);
      new Notice(
        `Could not open preview in Obsidian's web viewer. Falling back to external browser.`
      );
      window.open(url, '_blank');
    }
  }

  registerRenderCommand(id: string, name: string, toFormat?: 'pdf' | 'typst') {
    this.addCommand({
      id,
      name,
      icon: 'file-output',
      callback: async () => {
        const file = this.getActiveQuartoFile();
        if (file) await this.renderPdf(file, toFormat);
      },
    });
  }

  registerQmdExtension() {
    console.log('Registering .qmd as markdown...');
    this.registerExtensions(['qmd'], 'markdown');
    console.log('.qmd registered as markdown');
  }

  async togglePreview(file: TFile) {
    if (this.activePreviewProcesses.has(file.path)) {
      await this.stopPreview(file);
    } else {
      await this.startPreview(file);
    }
  }

  async startPreview(file: TFile) {
    if (this.activePreviewProcesses.has(file.path)) {
      console.log(`Preview already running for: ${file.path}`);
      return; // Preview already running
    }

    try {
      const abstractFile = this.app.vault.getAbstractFileByPath(file.path);
      if (!abstractFile || !(abstractFile instanceof TFile)) {
        new Notice(`File ${file.path} not found`);
        return;
      }
      const filePath = this.getVaultFullPath(abstractFile);
      if (!filePath) return;
      const workingDir = path.dirname(filePath);

      console.log(`Resolved file path: ${filePath}`);
      console.log(`Working directory: ${workingDir}`);

      const envVars: NodeJS.ProcessEnv = {
        ...process.env,
      };

      if (this.settings.quartoTypst.trim()) {
        envVars.QUARTO_TYPST = this.settings.quartoTypst.trim();
        console.log(`QUARTO_TYPST set to: ${envVars.QUARTO_TYPST}`);
      }

      const quartoProcess = spawn(this.settings.quartoPath, ['preview', filePath], {
        cwd: workingDir,
        env: envVars,
      });

      let previewUrl: string | null = null;
      let pdfPreviewLeaf: WorkspaceLeaf | null = null;
      let pdfPreviewPath: string | null = null;

      // Same routing rule as renderPdf: Quarto's stdout/stderr split is
      // not strictly content/error, so log by line prefix instead of
      // by stream. Only "ERROR:"-prefixed lines hit console.error.
      const handlePreviewOutput = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          if (/^ERROR:/.test(line)) {
            console.error(`Quarto Preview: ${line}`);
          } else if (this.settings.emitCompilationLogs) {
            console.log(`Quarto Preview: ${line}`);
          }

          // Detect "Output created: <path>" — quarto prints this on every
          // compile in preview mode. If the output is a PDF, route to
          // Obsidian's native PDF viewer rather than the webviewer page
          // Quarto serves at /web/viewer.html. Subsequent compiles refresh
          // the same leaf so live reload still works.
          const outMatch = line.match(/Output created:\s*(.+?)\s*$/);
          if (outMatch && /\.pdf$/i.test(outMatch[1].trim()) && this.settings.previewInObsidian) {
            const outBasename = path.basename(outMatch[1].trim());
            const sourceDir = file.parent?.path ?? '';
            const vaultPath = sourceDir ? `${sourceDir}/${outBasename}` : outBasename;
            pdfPreviewPath = vaultPath;
            // Fire-and-forget; errors logged inside.
            this.openOrRefreshPdfPreview(vaultPath, pdfPreviewLeaf).then((leaf) => {
              pdfPreviewLeaf = leaf ?? pdfPreviewLeaf;
            });
            continue;
          }

          if (!previewUrl && line.includes('Browse at')) {
            const match = line.match(/Browse at\s+(http:\/\/[^\s]+)/);
            if (match && match[1]) {
              previewUrl = match[1];
              // If we already opened a native PDF preview, skip the
              // webviewer URL — Quarto's PDF.js wrapper would just be
              // a worse version of the same content.
              if (pdfPreviewPath) {
                new Notice(`PDF preview opened natively. Server URL: ${previewUrl}`);
              } else {
                this.openPreviewUrl(previewUrl);
              }
            }
          }
        }
      };

      quartoProcess.stdout?.on('data', (data: Buffer) => handlePreviewOutput(data.toString()));
      quartoProcess.stderr?.on('data', (data: Buffer) => handlePreviewOutput(data.toString()));

      quartoProcess.on('close', (code: number | null) => {
        if (code !== null && code !== 0) {
          new Notice(`Quarto preview process exited with code ${code}`);
        }
        this.activePreviewProcesses.delete(file.path);
      });

      this.activePreviewProcesses.set(file.path, quartoProcess);
      new Notice('Quarto preview started');
    } catch (error) {
      console.error('Failed to start Quarto preview:', error);
      new Notice('Failed to start Quarto preview');
    }
  }

  async stopPreview(file: TFile) {
    const quartoProcess = this.activePreviewProcesses.get(file.path);
    if (quartoProcess) {
      if (!quartoProcess.killed) {
        quartoProcess.kill();
      }
      this.activePreviewProcesses.delete(file.path);
      new Notice('Quarto preview stopped');
    }
  }

  stopAllPreviews() {
    this.activePreviewProcesses.forEach((quartoProcess, filePath) => {
      if (!quartoProcess.killed) {
        quartoProcess.kill();
      }
      this.activePreviewProcesses.delete(filePath);
    });
    if (this.activePreviewProcesses.size > 0) {
      new Notice('All Quarto previews stopped');
    }
  }

  async renderPdf(file: TFile, toFormat?: 'pdf' | 'typst') {
    try {
      const abstractFile = this.app.vault.getAbstractFileByPath(file.path);
      if (!abstractFile || !(abstractFile instanceof TFile)) {
        new Notice(`File ${file.path} not found`);
        return;
      }

      const filePath = this.getVaultFullPath(abstractFile);
      if (!filePath) return;
      const workingDir = path.dirname(filePath);

      const envVars: NodeJS.ProcessEnv = { ...process.env };
      if (this.settings.quartoTypst.trim()) {
        envVars.QUARTO_TYPST = this.settings.quartoTypst.trim();
      }

      const engineLabel = toFormat === 'typst' ? 'Typst' : toFormat === 'pdf' ? 'LaTeX' : 'use YAML format';
      new Notice(`Rendering Quarto (${engineLabel})...`);

      // Best-guess path used for the pre-render leaf-capture (so we can
      // reuse an existing PDF tab on recompile). The authoritative path
      // comes from quarto's "Output created:" stdout line, parsed below.
      const guessedPdfPath = this.pdfPathFor(file);
      const existingLeaf = this.app.workspace
        .getLeavesOfType('pdf')
        .find((l) => (l.view as any)?.file?.path === guessedPdfPath);

      const args = ['render', filePath];
      if (toFormat) args.push('--to', toFormat);

      const quartoProcess = spawn(this.settings.quartoPath, args, {
        cwd: workingDir,
        env: envVars,
      });

      let detectedOutputBasename: string | null = null;

      // Quarto prints progress to BOTH stdout and stderr. Most of stderr
      // is informational (typst progress, "Output created:", DONE, etc.)
      // Only lines prefixed with "ERROR:" are real errors; logging the
      // rest via console.error surfaced harmless lines as red error
      // toasts in Obsidian. Route by content, not by stream.
      const handleQuartoOutput = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          if (/^ERROR:/.test(line)) {
            console.error(`Quarto: ${line}`);
          } else if (this.settings.emitCompilationLogs) {
            console.log(`Quarto: ${line}`);
          }
          const match = line.match(/Output created:\s*(.+?)\s*$/);
          if (match) {
            detectedOutputBasename = path.basename(match[1].trim());
          }
        }
      };

      quartoProcess.stdout?.on('data', (data: Buffer) => handleQuartoOutput(data.toString()));
      quartoProcess.stderr?.on('data', (data: Buffer) => handleQuartoOutput(data.toString()));

      quartoProcess.on('close', async (code: number | null) => {
        if (code !== 0) {
          new Notice(`Quarto render failed (exit ${code}). Check console.`);
          return;
        }

        const sourceDir = file.parent?.path ?? '';
        const outputVaultPath = detectedOutputBasename
          ? (sourceDir ? `${sourceDir}/${detectedOutputBasename}` : detectedOutputBasename)
          : guessedPdfPath;

        const outputTFile = await this.waitForVaultFile(outputVaultPath);

        if (!outputTFile) {
          new Notice(
            `Quarto rendered, but ${outputVaultPath} did not appear in the vault within the timeout. Check Quarto's output-dir or vault sync.`
          );
          return;
        }

        const isPdf = outputVaultPath.toLowerCase().endsWith('.pdf');

        if (!this.settings.openPdfInObsidian || !isPdf) {
          new Notice(
            isPdf
              ? `PDF rendered: ${outputVaultPath}`
              : `Rendered: ${outputVaultPath} (Obsidian's built-in viewer only handles PDFs).`
          );
          return;
        }

        try {
          const leaf = existingLeaf?.parent != null
            ? existingLeaf
            : this.app.workspace.getLeaf('split', 'vertical');
          await leaf.openFile(outputTFile, { active: false });
          this.app.workspace.revealLeaf(leaf);
          new Notice(`Opened ${outputVaultPath}`);
        } catch (err) {
          console.error('Failed to open PDF in Obsidian:', err);
          new Notice(
            `PDF rendered at ${outputVaultPath}, but Obsidian could not open it (no PDF viewer registered?).`
          );
        }
      });
    } catch (error) {
      console.error('Failed to render Quarto PDF:', error);
      new Notice('Failed to render Quarto PDF');
    }
  }

  async waitForVaultFile(vaultPath: string, timeoutMs = 5000): Promise<TFile | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const f = this.app.vault.getAbstractFileByPath(vaultPath);
      if (f instanceof TFile) return f;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }
}

class QmdSettingTab extends PluginSettingTab {
  plugin: QmdAsMdPlugin;

  constructor(app: App, plugin: QmdAsMdPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    console.log('Rendering settings tab...');

    containerEl.createEl('h2', { text: 'Quarto Preview Settings' });

    new Setting(containerEl)
      .setName('Quarto Path')
      .setDesc('Path to Quarto executable (e.g., quarto, /usr/local/bin/quarto)')
      .addText((text) =>
        text
          .setPlaceholder('quarto')
          .setValue(this.plugin.settings.quartoPath)
          .onChange(async (value) => {
            console.log(`Quarto path changed to: ${value}`);
            this.plugin.settings.quartoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable Editing Quarto Files')
      .setDesc(
        'By default, plugin allows editing .qmd files. Disable this feature if there is a conflict with .qmd editing enabled by another plugin'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableQmdLinking)
          .onChange(async (value) => {
            console.log(`Enable QMD Editing setting changed to: ${value}`);
            this.plugin.settings.enableQmdLinking = value;

            if (value) {
              this.plugin.registerQmdExtension();
            }
          })
      );

    new Setting(containerEl)
      .setName('QUARTO_TYPST Variable')
      .setDesc('Define the QUARTO_TYPST environment variable (leave empty to unset)')
      .addText((text) =>
        text
          .setPlaceholder('e.g., typst_path')
          .setValue(this.plugin.settings.quartoTypst)
          .onChange(async (value) => {
            console.log(`QUARTO_TYPST set to: ${value}`);
            this.plugin.settings.quartoTypst = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Emit Compilation Logs')
      .setDesc('Toggle whether to emit detailed compilation logs in the console')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.emitCompilationLogs)
          .onChange(async (value) => {
            console.log(`Emit Compilation Logs set to: ${value}`);
            this.plugin.settings.emitCompilationLogs = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Open Compiled PDF in Obsidian')
      .setDesc(
        'When rendering to PDF, open the resulting file inside Obsidian using the built-in PDF viewer. The .qmd source must live in the vault so the rendered PDF is accessible.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPdfInObsidian)
          .onChange(async (value) => {
            console.log(`Open PDF in Obsidian set to: ${value}`);
            this.plugin.settings.openPdfInObsidian = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Open Quarto preview in Obsidian')
      .setDesc(
        'Use Obsidian 1.8\'s built-in web viewer (webviewer view) for the live Quarto preview server. When off, the preview URL opens in your default external browser instead.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.previewInObsidian)
          .onChange(async (value) => {
            console.log(`Preview in Obsidian set to: ${value}`);
            this.plugin.settings.previewInObsidian = value;
            await this.plugin.saveSettings();
          })
      );

    console.log('Settings tab rendered successfully');
  }
}