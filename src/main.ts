import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  FileSystemAdapter,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
  quartoPath: string;
  enableQmdLinking: boolean;
  quartoTypst: string;
  emitCompilationLogs: boolean;
  openPdfInObsidian: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  enableQmdLinking: true,
  quartoTypst: '',
  emitCompilationLogs: true,
  openPdfInObsidian: false,
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

      this.addCommand({
        id: 'render-quarto-pdf',
        name: 'Render Quarto to PDF',
        icon: 'file-output',
        callback: async () => {
          const file = this.getActiveQuartoFile();
          if (file) await this.renderPdf(file);
        },
      });

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

      quartoProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (this.settings.emitCompilationLogs) {
          console.log(`Quarto Preview Output: ${output}`);
        }

        if (output.includes('Browse at')) {
          const match = output.match(/Browse at\s+(http:\/\/[^\s]+)/);
          if (match && match[1]) {
            previewUrl = match[1];
            new Notice(`Preview available at ${previewUrl}`);

            const leaf = this.app.workspace.getLeaf('tab');
            leaf.setViewState({
              type: 'webviewer',
              active: true,
              state: {
                url: previewUrl,
              },
            });
            this.app.workspace.revealLeaf(leaf);
          }
        }
      });

      quartoProcess.stderr?.on('data', (data: Buffer) => {
        if (this.settings.emitCompilationLogs) {
          console.error(`Quarto Preview Error: ${data}`);
        }
      });

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

  async renderPdf(file: TFile) {
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

      new Notice('Rendering Quarto to PDF...');

      const pdfVaultPath = this.pdfPathFor(file);
      const existingLeaf = this.app.workspace
        .getLeavesOfType('pdf')
        .find((l) => (l.view as any)?.file?.path === pdfVaultPath);

      const quartoProcess = spawn(
        this.settings.quartoPath,
        ['render', filePath],
        { cwd: workingDir, env: envVars }
      );

      quartoProcess.stdout?.on('data', (data: Buffer) => {
        if (this.settings.emitCompilationLogs) {
          console.log(`Quarto Render Output: ${data.toString()}`);
        }
      });

      quartoProcess.stderr?.on('data', (data: Buffer) => {
        if (this.settings.emitCompilationLogs) {
          console.error(`Quarto Render Error: ${data.toString()}`);
        }
      });

      quartoProcess.on('close', async (code: number | null) => {
        if (code !== 0) {
          new Notice(`Quarto render failed (exit ${code}). Check console.`);
          return;
        }

        const pdfTFile = await this.waitForVaultFile(pdfVaultPath);

        if (!pdfTFile) {
          new Notice(
            `Quarto rendered, but ${pdfVaultPath} did not appear in the vault within the timeout. Check Quarto's output-dir or vault sync.`
          );
          return;
        }

        if (!this.settings.openPdfInObsidian) {
          new Notice(`PDF rendered: ${pdfVaultPath}`);
          return;
        }

        try {
          const leaf = existingLeaf?.parent != null
            ? existingLeaf
            : this.app.workspace.getLeaf('split', 'vertical');
          await leaf.openFile(pdfTFile, { active: false });
          this.app.workspace.revealLeaf(leaf);
          new Notice(`Opened ${pdfVaultPath}`);
        } catch (err) {
          console.error('Failed to open PDF in Obsidian:', err);
          new Notice(
            `PDF rendered at ${pdfVaultPath}, but Obsidian could not open it (no PDF viewer registered?).`
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

    console.log('Settings tab rendered successfully');
  }
}