import { Plugin, Notice, TFile, MarkdownView, PluginSettingTab, App, Setting, WorkspaceLeaf } from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
    quartoPath: string;
    autoPreview: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
    quartoPath: 'quarto', // Default to global Quarto installation
    autoPreview: false
};

export default class QmdAsMdPlugin extends Plugin {
    settings: QmdPluginSettings;
    activePreviewProcesses: Map<string, ChildProcess> = new Map();

    async onload() {
        console.log('Plugin is loading...'); // Debug log for onload

        try {
            // Load settings
            await this.loadSettings();
            console.log('Settings loaded:', this.settings);

            // Register .qmd as markdown files
            this.registerExtensions(["qmd"], "markdown");
            console.log('.qmd registered as markdown');

            // Add settings tab
            this.addSettingTab(new QmdSettingTab(this.app, this));
            console.log('Settings tab added successfully');

            // Add ribbon icon for toggling preview
            this.addRibbonIcon('eye', 'Toggle Quarto Preview', async (evt) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file && this.isQuartoFile(activeView.file)) {
                    console.log(`Toggling preview for: ${activeView.file.path}`);
                    await this.togglePreview(activeView.file);
                } else {
                    console.warn('No valid Quarto file selected for preview');
                    new Notice('Current file is not a Quarto document');
                }
            });
            console.log('Ribbon icon added');

            // Add commands
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
                hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }]
            });

            this.addCommand({
                id: 'stop-all-quarto-previews',
                name: 'Stop All Quarto Previews',
                callback: () => {
                    console.log('Command: Stopping all Quarto previews');
                    this.stopAllPreviews();
                }
            });
            console.log('Commands added');

            // Register event for auto-preview
            this.registerEvent(
                this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
                    if (this.settings.autoPreview && leaf?.view instanceof MarkdownView) {
                        const file = leaf.view.file;
                        if (file && this.isQuartoFile(file)) {
                            console.log(`Auto-preview for: ${file.path}`);
                            this.startPreview(file);
                        }
                    }
                })
            );
            console.log('Auto-preview event registered');

        } catch (error) {
            console.error('Error loading plugin:', error);
            new Notice('Failed to load QmdAsMdPlugin. Check the developer console for details.');
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

    async togglePreview(file: TFile) {
        if (this.activePreviewProcesses.has(file.path)) {
            await this.stopPreview(file);
        } else {
            await this.startPreview(file);
        }
    }

    async startPreview(file: TFile) {
      if (this.activePreviewProcesses.has(file.path)) {
          return; // Preview already running
      }
  
      try {
          const adapter = this.app.vault.adapter;
          const filePath = (adapter as any).getFullPath(file.path); // Resolve the full path of the file
          const workingDir = path.dirname(filePath);
  
          console.log(`Resolved file path: ${filePath}`); // Debug log for the resolved path
          console.log(`Working directory: ${workingDir}`); // Debug log for the working directory
  
          const process = spawn(this.settings.quartoPath, ['preview', filePath], {
              cwd: workingDir,
              shell: true
          });
  
          let previewUrl: string | null = null;
  
          process.stdout?.on('data', (data: Buffer) => {
              const output = data.toString();
              console.log(`Quarto Preview Output: ${output}`);
              
              // Extract preview URL if available
              if (output.includes('Browse at')) {
                  const match = output.match(/Browse at\s+(http:\/\/[^\s]+)/);
                  if (match && match[1]) {
                      previewUrl = match[1];
                      new Notice(`Preview available at ${previewUrl}`);
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
            process.kill();
            this.activePreviewProcesses.delete(file.path);
            new Notice('Quarto preview stopped');
        }
    }

    stopAllPreviews() {
        Array.from(this.activePreviewProcesses.entries()).forEach(([filePath, process]) => {
            process.kill();
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

        console.log('Rendering settings tab...'); // Debug log

        containerEl.createEl('h2', { text: 'Quarto Preview Settings' });

        // Quarto Path Setting
        new Setting(containerEl)
            .setName('Quarto Path')
            .setDesc('Path to Quarto executable (e.g., quarto, /usr/local/bin/quarto)')
            .addText(text =>
                text
                    .setPlaceholder('quarto')
                    .setValue(this.plugin.settings.quartoPath)
                    .onChange(async (value) => {
                        console.log(`Quarto path changed to: ${value}`);
                        this.plugin.settings.quartoPath = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Auto Preview Setting
        new Setting(containerEl)
            .setName('Auto Preview')
            .setDesc('Automatically start preview when opening Quarto files')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.autoPreview)
                    .onChange(async (value) => {
                        console.log(`Auto-preview setting changed to: ${value}`);
                        this.plugin.settings.autoPreview = value;
                        await this.plugin.saveSettings();
                    })
            );

        containerEl.createEl('h3', { text: 'Usage' });
        containerEl.createEl('p', {
            text: 'Use the ribbon icon or command palette to toggle previews. Auto-preview can be enabled in the settings above.'
        });

        console.log('Settings tab rendered successfully');
    }
}