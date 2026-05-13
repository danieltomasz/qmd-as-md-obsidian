import {
  Plugin,
  Notice,
  TFile,
  FileView,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  FileSystemAdapter,
  WorkspaceLeaf,
  normalizePath,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
  quartoPath: string;
  enableQmdLinking: boolean;
  quartoTypst: string;
  openPdfInObsidian: boolean;
  previewInObsidian: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  enableQmdLinking: true,
  quartoTypst: '',
  openPdfInObsidian: false,
  previewInObsidian: true,
};

export default class QmdAsMdPlugin extends Plugin {
  settings: QmdPluginSettings;
  activePreviewProcesses: Map<string, ChildProcess> = new Map();

  async onload() {
    try {
      await this.loadSettings();

      if (this.settings.enableQmdLinking) {
        this.registerQmdExtension();
      }

      this.addSettingTab(new QmdSettingTab(this.app, this));

      this.addRibbonIcon('eye', 'Toggle Quarto preview', async () => {
        const file = this.getActiveQuartoFile();
        if (file) await this.togglePreview(file);
      });

      this.addCommand({
        id: 'toggle-quarto-preview',
        name: 'Toggle Quarto preview',
        callback: async () => {
          const file = this.getActiveQuartoFile();
          if (file) await this.togglePreview(file);
        },
      });

      this.addRibbonIcon('file-output', 'Render Quarto to PDF', async () => {
        const file = this.getActiveQuartoFile();
        if (file) await this.renderPdf(file);
      });

      this.registerRenderCommand('render-quarto-pdf', 'Render Quarto (use YAML format)');
      this.registerRenderCommand('render-quarto-pdf-typst', 'Render Quarto to PDF (Typst engine)', 'typst');
      this.registerRenderCommand('render-quarto-pdf-latex', 'Render Quarto to PDF (LaTeX engine)', 'pdf');
    } catch (error) {
      console.error('Error loading plugin:', error);
      new Notice('Failed to load the QMD as md plugin. Check the developer console for details.');
    }
  }

  onunload() {
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

  // Pull the TFile a leaf currently shows, without resorting to
  // `as any`. The built-in PDF view (and most file-backed views)
  // extend FileView, which exposes a typed `file: TFile | null`.
  private leafFile(leaf: WorkspaceLeaf): TFile | null {
    return leaf.view instanceof FileView ? leaf.view.file : null;
  }

  // Open (or reuse) a leaf showing the given vault-relative PDF path in
  // Obsidian's native PDF viewer. Returns the leaf so callers can keep
  // refreshing it on subsequent preview compiles.
  //
  // Leaf-resolution order:
  //   1. Caller's captured ref, if still attached to the workspace.
  //   2. Any open 'pdf' leaf already showing this exact file (user may
  //      have opened it manually, or renderPdf may have opened it).
  //   3. New vertical split.
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
      const reusable =
        existingLeaf?.parent != null
          ? existingLeaf
          : this.app.workspace
              .getLeavesOfType('pdf')
              .find((l) => this.leafFile(l)?.path === pdfTFile.path) ?? null;
      const leaf = reusable ?? this.app.workspace.getLeaf('split', 'vertical');
      // Skip the openFile call when the leaf already shows this file —
      // calling openFile in that case is harmless for the file display
      // but still triggers a reveal/focus shuffle the user does not want.
      // Obsidian's PDF viewer picks up the file rewrite via its own
      // mtime watcher, so live reload still works without our help.
      const currentFile = this.leafFile(leaf);
      if (!currentFile || currentFile.path !== pdfTFile.path) {
        await leaf.openFile(pdfTFile, { active: false });
      }
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
      // Use activeWindow so popout windows resolve to the correct one.
      activeWindow.open(url, '_blank');
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
        "Could not open preview in Obsidian's web viewer. Falling back to external browser."
      );
      activeWindow.open(url, '_blank');
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
    this.registerExtensions(['qmd'], 'markdown');
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
      return; // Preview already running for this file.
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

      const envVars: NodeJS.ProcessEnv = { ...process.env };
      if (this.settings.quartoTypst.trim()) {
        envVars.QUARTO_TYPST = this.settings.quartoTypst.trim();
      }

      // --no-browse stops Quarto from auto-opening the preview URL in
      // the default system browser. Without it the plugin's own
      // open-in-Obsidian/open-external logic competes with Quarto's,
      // and the user sees two windows (Obsidian leaf + external tab).
      const quartoProcess = spawn(
        this.settings.quartoPath,
        ['preview', filePath, '--no-browse'],
        { cwd: workingDir, env: envVars }
      );

      let previewUrl: string | null = null;

      // PDF-preview state. Quarto emits "Output created: foo.pdf" on
      // every recompile (often several times per recompile); the
      // handler dedups so we don't spawn tabs on every save.
      //
      //  leaf:  current PDF tab, if any.
      //  path:  the path that leaf is showing (and the path of an
      //         in-flight open call, recorded synchronously when it
      //         is scheduled). Also gates the webviewer-URL skip
      //         logic on the "Browse at" branch below — when a PDF
      //         preview is active, we don't open Quarto's PDF.js
      //         wrapper page in the webviewer too.
      //  busy:  a call to openOrRefreshPdfPreview is in flight.
      //
      // Schedule open when any of:
      //   - leaf is detached (user closed the tab manually)
      //   - the new output path differs from the tracked one
      //     (multi-format project, or rename)
      //   - we never opened in this session
      // Skip when busy (bursts of emissions during recompile dedup
      // automatically; the final emission of a burst wins because it
      // arrives after busy clears).
      let pdfPreviewLeaf: WorkspaceLeaf | null = null;
      let pdfPreviewPath: string | null = null;
      let pdfPreviewBusy = false;

      const schedulePdfPreview = (vaultPath: string): void => {
        if (pdfPreviewBusy) return;
        const leafAttached = pdfPreviewLeaf?.parent != null;
        const pathSame = pdfPreviewPath === vaultPath;
        if (leafAttached && pathSame) return;

        pdfPreviewBusy = true;
        pdfPreviewPath = vaultPath;
        this.openOrRefreshPdfPreview(vaultPath, pdfPreviewLeaf)
          .then((leaf) => {
            if (leaf) pdfPreviewLeaf = leaf;
          })
          .catch((err) => {
            console.error('[qmd-as-md] PDF preview open failed:', err);
            pdfPreviewLeaf = null;
            pdfPreviewPath = null;
          })
          .finally(() => {
            pdfPreviewBusy = false;
          });
      };

      // Same routing rule as renderPdf: Quarto's stdout/stderr split is
      // not strictly content/error, so route by line prefix. Every
      // line is logged so the user can see what the preview server is
      // doing; "ERROR:"-prefixed lines go through console.error.
      const handlePreviewOutput = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          if (/^ERROR:/.test(line)) {
            console.error(`Quarto Preview: ${line}`);
          } else {
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
            const vaultPath = normalizePath(sourceDir ? `${sourceDir}/${outBasename}` : outBasename);
            schedulePdfPreview(vaultPath);
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

      // child_process.spawn does not throw on a missing binary; it emits
      // an 'error' event later. Without this listener an ENOENT just
      // produced a silent "exit 1" close with no output to console.
      quartoProcess.on('error', (err) => {
        console.error('[qmd-as-md] Failed to spawn quarto for preview:', err);
        new Notice(
          `Failed to spawn '${this.settings.quartoPath}': ${err.message}. ` +
            'Check the Quarto path setting and that Quarto is on PATH.'
        );
        this.activePreviewProcesses.delete(file.path);
      });

      quartoProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code !== null && code !== 0) {
          new Notice(`Quarto preview process exited with code ${code}`);
        } else if (code === null && signal && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
          // SIGTERM/SIGKILL come from our own stopPreview / onunload — silent.
          new Notice(`Quarto preview process was terminated by ${signal}`);
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
        .find((l) => this.leafFile(l)?.path === guessedPdfPath);

      const args = ['render', filePath];
      if (toFormat) args.push('--to', toFormat);

      const quartoProcess = spawn(this.settings.quartoPath, args, {
        cwd: workingDir,
        env: envVars,
      });

      let detectedOutputBasename: string | null = null;

      // Quarto prints progress to BOTH stdout and stderr. Most of stderr
      // is informational (typst progress, "Output created:", DONE, etc.)
      // Route by line prefix: "ERROR:" goes through console.error so
      // it stands out; everything else goes through console.log so the
      // user can always see what Quarto is doing.
      const handleQuartoOutput = (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          if (/^ERROR:/.test(line)) {
            console.error(`Quarto: ${line}`);
          } else {
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

      // child_process.spawn does not throw on a missing binary; it emits
      // an 'error' event later. Without this listener an ENOENT just
      // produced a silent "exit 1" close with no output to console.
      quartoProcess.on('error', (err) => {
        console.error('[qmd-as-md] Failed to spawn quarto for render:', err);
        new Notice(
          `Failed to spawn '${this.settings.quartoPath}': ${err.message}. ` +
            'Check the Quarto path setting and that Quarto is on PATH.'
        );
      });

      quartoProcess.on('close', async (code: number | null, signal: NodeJS.Signals | null) => {
        if (code !== 0) {
          const exitLabel = code !== null
            ? `exit ${code}`
            : signal
              ? `terminated by ${signal}`
              : 'terminated';
          // The full output was already streamed line-by-line through
          // console.log / console.error as it arrived — no need to
          // re-dump it. Just summarise the failure.
          console.error(`[qmd-as-md] Quarto render failed (${exitLabel}).`);
          new Notice(`Quarto render failed (${exitLabel}). Check console.`);
          return;
        }

        const sourceDir = file.parent?.path ?? '';
        const outputVaultPath = normalizePath(
          detectedOutputBasename
            ? (sourceDir ? `${sourceDir}/${detectedOutputBasename}` : detectedOutputBasename)
            : guessedPdfPath
        );

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
      await new Promise((r) => activeWindow.setTimeout(r, 200));
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

    new Setting(containerEl)
      .setName('Quarto path')
      .setDesc('Path to the Quarto executable (e.g. quarto, /usr/local/bin/quarto)')
      .addText((text) =>
        text
          .setPlaceholder('quarto')
          .setValue(this.plugin.settings.quartoPath)
          .onChange(async (value) => {
            this.plugin.settings.quartoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable editing Quarto files')
      .setDesc(
        'When on, .qmd files open in the Markdown editor. Turn off if another plugin handles .qmd editing.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableQmdLinking)
          .onChange(async (value) => {
            this.plugin.settings.enableQmdLinking = value;
            if (value) {
              this.plugin.registerQmdExtension();
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('QUARTO_TYPST variable')
      .setDesc('Value for the QUARTO_TYPST environment variable (leave empty to unset).')
      .addText((text) =>
        text
          .setPlaceholder('e.g. typst_path')
          .setValue(this.plugin.settings.quartoTypst)
          .onChange(async (value) => {
            this.plugin.settings.quartoTypst = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Open compiled PDF in Obsidian')
      .setDesc(
        "When rendering to PDF, open the resulting file inside Obsidian using the built-in PDF viewer. The .qmd source must live in the vault so the rendered PDF is accessible."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPdfInObsidian)
          .onChange(async (value) => {
            this.plugin.settings.openPdfInObsidian = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Open Quarto preview in Obsidian')
      .setDesc(
        "When on: PDF previews (format: typst / pdf) open in Obsidian's native PDF viewer; " +
          "non-PDF previews (HTML, etc.) open in Obsidian 1.8's built-in web viewer " +
          '(requires the "Web viewer" core plugin enabled in Settings → Core plugins). ' +
          'Live reload from the running Quarto preview is preserved in both cases. ' +
          'When off, the preview URL opens in your default external browser instead.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.previewInObsidian)
          .onChange(async (value) => {
            this.plugin.settings.previewInObsidian = value;
            await this.plugin.saveSettings();
          })
      );
  }
}