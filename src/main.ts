import {
  Plugin,
  Notice,
  TFile,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  TAbstractFile,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
  quartoPath: string;
  autoPreview: boolean;
  enableQmdLinking: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  autoPreview: false,
  enableQmdLinking: true,
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

      this.addRibbonIcon('eye', 'Toggle Quarto Preview', async (evt) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file && this.isQuartoFile(activeView.file)) {
          console.log(`Toggling preview for: ${activeView.file.path}`);
          await this.togglePreview(activeView.file);
        } else {
          new Notice('Current file is not a Quarto document');
        }
      });
      console.log('Ribbon icon added');

      this.addCommand({
        id: 'toggle-quarto-preview',
        name: 'Toggle Quarto Preview',
        callback: async () => {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (activeView?.file && this.isQuartoFile(activeView.file)) {
            console.log(`Command: Toggling preview for ${activeView.file.path}`);
            await this.togglePreview(activeView.file);
          } else {
            new Notice('Current file is not a Quarto document');
          }
        },
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }],
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
      const filePath = (this.app.vault.adapter as any).getFullPath(abstractFile.path);
      const workingDir = path.dirname(filePath);

      console.log(`Resolved file path: ${filePath}`);
      console.log(`Working directory: ${workingDir}`);

      const process = spawn(this.settings.quartoPath, ['preview', filePath], {
        cwd: workingDir,
      });

      let previewUrl: string | null = null;

      process.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log(`Quarto Preview Output: ${output}`);

        if (output.includes('Browse at')) {
          const match = output.match(/Browse at\s+(http:\/\/[^\s]+)/);
          if (match && match[1]) {
            previewUrl = match[1];
            new Notice(`Preview available at ${previewUrl}`);

            // Open the preview in a new tab
            // Open the preview in a new tab
            const leaf = this.app.workspace.getLeaf('tab');
            leaf.setViewState({
              type: 'webviewer',
              active: true,
              state: {
                url: previewUrl,
              },
            });
            // Reveal the tab
            this.app.workspace.revealLeaf(leaf);
          }
        }
      });

      process.stderr?.on('data', (data: Buffer) => {
        console.error(`Quarto Preview Error: ${data}`);
        new Notice(`Quarto Preview Error: ${data}`);
      });

      process.on('close', (code: number | null) => {
        if (code !== null && code !== 0) {
          new Notice(`Quarto preview process exited with code ${code}`);
        }
        this.activePreviewProcesses.delete(file.path);
      });

      this.activePreviewProcesses.set(file.path, process);
      new Notice('Quarto preview started');
    } catch (error) {
      console.error('Failed to start Quarto preview:', error);
      new Notice('Failed to start Quarto preview');
    }
  }

  async stopPreview(file: TFile) {
    const process = this.activePreviewProcesses.get(file.path);
    if (process) {
      if (!process.killed) {
        process.kill();
      }
      this.activePreviewProcesses.delete(file.path);
      new Notice('Quarto preview stopped');
    }
  }

  stopAllPreviews() {
    this.activePreviewProcesses.forEach((process, filePath) => {
      if (!process.killed) {
        process.kill();
      }
      this.activePreviewProcesses.delete(filePath);
    });
    if (this.activePreviewProcesses.size > 0) {
      new Notice('All Quarto previews stopped');
    }
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
      .setName('Auto Preview')
      .setDesc('Automatically start preview when opening Quarto files')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoPreview)
          .onChange(async (value) => {
            console.log(`Auto-preview setting changed to: ${value}`);
            this.plugin.settings.autoPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Enable Linking to Quarto Files')
      .setDesc(
        'Allow linking to `.qmd` files without enabling "Detect All File Extensions"'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableQmdLinking)
          .onChange(async (value) => {
            console.log(`Enable QMD Linking setting changed to: ${value}`);
            this.plugin.settings.enableQmdLinking = value;

            if (value) {
              this.plugin.registerQmdExtension();
            } else {
              console.log(
                '.qmd linking disabled. Restart Obsidian if required.'
              );
            }

            await this.plugin.saveSettings();
          })
      );

    console.log('Settings tab rendered successfully');
  }
}