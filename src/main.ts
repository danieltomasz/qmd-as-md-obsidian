import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  WorkspaceLeaf,
  Platform,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
  quartoPath: string;
  autoPreview: boolean;
  enableQmdLinking: boolean;
  useWebViewer: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  autoPreview: false,
  enableQmdLinking: false,
  useWebViewer: true,
};

export default class QmdAsMdPlugin extends Plugin {
  settings: QmdPluginSettings;
  activePreviewProcesses: Map<string, ChildProcess> = new Map();
  activeWebViewers: Map<string, WorkspaceLeaf> = new Map();

  async onload() {
    try {
      await this.loadSettings();

      if (this.settings.enableQmdLinking) {
        this.registerQmdExtension();
      }

      this.addSettingTab(new QmdSettingTab(this.app, this));

      this.addRibbonIcon('eye', 'Toggle Quarto Preview', async () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file && this.isQuartoFile(activeView.file)) {
          await this.togglePreview(activeView.file);
        } else {
          new Notice('Current file is not a Quarto document');
        }
      });

      this.addCommand({
        id: 'toggle-quarto-preview',
        name: 'Toggle Quarto Preview',
        callback: async () => {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (activeView?.file && this.isQuartoFile(activeView.file)) {
            await this.togglePreview(activeView.file);
          } else {
            new Notice('Current file is not a Quarto document');
          }
        },
      });

      if (this.settings.autoPreview) {
        this.registerEvent(
          this.app.workspace.on('file-open', async (file) => {
            if (file && this.isQuartoFile(file)) {
              await this.togglePreview(file);
            }
          })
        );
      }
    } catch (error) {
      console.error('Error loading plugin:', error);
      new Notice('Failed to load QmdAsMdPlugin.');
    }
  }

  onunload() {
    this.stopAllPreviews();
    this.activeWebViewers.forEach((leaf) => leaf.detach());
    this.activeWebViewers.clear();
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

  registerQmdExtension() {
    this.registerExtensions(['qmd'], 'markdown');
  }

  async togglePreview(file: TFile) {
    if (this.settings.useWebViewer && !Platform.isMobile) {
      await this.toggleWebViewer(file);
    } else {
      await this.toggleExternalPreview(file);
    }
  }

  async toggleWebViewer(file: TFile) {
    const existingViewer = this.activeWebViewers.get(file.path);
    if (existingViewer) {
      existingViewer.detach();
      this.activeWebViewers.delete(file.path);
      await this.stopPreview(file);
    } else {
      const previewUrl = await this.startPreviewAndGetUrl(file);
      if (previewUrl) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) {
          new Notice('Failed to create preview pane');
          return;
        }
        await leaf.setViewState({
          type: 'webview',
          state: { url: previewUrl },
        });
        this.activeWebViewers.set(file.path, leaf);
        this.app.workspace.setActiveLeaf(leaf, false, true);
      }
    }
  }

  async startPreviewAndGetUrl(file: TFile): Promise<string | null> {
    return new Promise((resolve) => {
      const filePath = (this.app.vault.adapter as any).getFullPath(file.path);
      const workingDir = path.dirname(filePath);

      const process = spawn(this.settings.quartoPath, ['preview', filePath], { cwd: workingDir });
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutId);
        process.removeAllListeners();
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
        new Notice('Preview startup timed out');
      }, 10000);

      process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (output.includes('Browse at')) {
          const match = output.match(/Browse at\s+(http:\/\/[^\s]+)/);
          if (match && match[1]) {
            cleanup();
            resolve(match[1]);
          }
        }
      });

      process.stderr?.on('data', (data: Buffer) => {
        console.error(`Quarto Preview Error: ${data}`);
      });

      process.on('error', () => {
        cleanup();
        resolve(null);
      });

      process.on('close', () => {
        this.activePreviewProcesses.delete(file.path);
      });

      this.activePreviewProcesses.set(file.path, process);
    });
  }

  async toggleExternalPreview(file: TFile) {
    if (this.activePreviewProcesses.has(file.path)) {
      await this.stopPreview(file);
    } else {
      await this.startPreview(file);
    }
  }

  async startPreview(file: TFile) {
    if (this.activePreviewProcesses.has(file.path)) {
      return;
    }

    const filePath = (this.app.vault.adapter as any).getFullPath(file.path);
    const workingDir = path.dirname(filePath);

    const process = spawn(this.settings.quartoPath, ['preview', filePath], { cwd: workingDir });

    process.on('close', () => {
      this.activePreviewProcesses.delete(file.path);
    });

    this.activePreviewProcesses.set(file.path, process);
  }

  async stopPreview(file: TFile) {
    const process = this.activePreviewProcesses.get(file.path);
    if (process) {
      if (!process.killed) {
        process.kill();
      }
      this.activePreviewProcesses.delete(file.path);
    }
  }

  stopAllPreviews() {
    this.activePreviewProcesses.forEach((process) => {
      if (!process.killed) {
        process.kill();
      }
    });
    this.activePreviewProcesses.clear();
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

    containerEl.createEl('h2', { text: 'Quarto Preview Settings' });

    new Setting(containerEl)
      .setName('Quarto Path')
      .addText((text) =>
        text.setValue(this.plugin.settings.quartoPath).onChange(async (value) => {
          this.plugin.settings.quartoPath = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Use WebViewer')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useWebViewer).onChange(async (value) => {
          this.plugin.settings.useWebViewer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Auto Preview')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoPreview).onChange(async (value) => {
          this.plugin.settings.autoPreview = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Enable Linking to Quarto Files')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableQmdLinking).onChange(async (value) => {
          this.plugin.settings.enableQmdLinking = value;
          if (value) {
            this.plugin.registerQmdExtension();
          }
          await this.plugin.saveSettings();
        })
      );
  }
}