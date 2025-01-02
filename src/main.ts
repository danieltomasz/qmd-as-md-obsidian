import { Plugin, Notice, TFile, MarkdownView, PluginSettingTab, App, Setting, WorkspaceLeaf } from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface QmdPluginSettings {
    quartoPath: string;
    autoPreview: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
    quartoPath: 'quarto', // Default to global quarto installation
    autoPreview: false
}

export default class QmdAsMdPlugin extends Plugin {
    settings: QmdPluginSettings;
    activePreviewProcesses: Map<string, ChildProcess> = new Map();

    async onload() {
        await this.loadSettings();

        // Register qmd files as markdown (existing functionality)
        this.registerExtensions(["qmd"], "markdown");

        // Add settings tab
        this.addSettingTab(new QmdSettingTab(this.app, this));

        // Add ribbon icon for quick preview toggle
        const ribbonIconEl = this.addRibbonIcon('eye', 'Toggle Quarto Preview', (evt) => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView?.file && this.isQuartoFile(activeView.file)) {
                this.togglePreview(activeView.file);
            } else {
                new Notice('Current file is not a Quarto document');
            }
        });

        // Add command to toggle preview
        this.addCommand({
            id: 'toggle-quarto-preview',
            name: 'Toggle Quarto Preview',
            callback: () => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file && this.isQuartoFile(activeView.file)) {
                    this.togglePreview(activeView.file);
                } else {
                    new Notice('Current file is not a Quarto document');
                }
            },
            hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'p' }]
        });

        // Add command to stop all previews
        this.addCommand({
            id: 'stop-all-quarto-previews',
            name: 'Stop All Quarto Previews',
            callback: () => {
                this.stopAllPreviews();
            }
        });

        // Register event handlers
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
                if (this.settings.autoPreview && leaf?.view instanceof MarkdownView) {
                    const file = leaf.view.file;
                    if (file && this.isQuartoFile(file)) {
                        this.startPreview(file);
                    }
                }
            })
        );
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
            const filePath = (adapter as any).getFullPath(file.path);
            const workingDir = path.dirname(filePath);

            const process = spawn(this.settings.quartoPath, ['preview', file.path], {
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
        // Convert Map entries to array before iterating
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

        containerEl.createEl('h2', { text: 'Quarto Preview Settings' });

        new Setting(containerEl)
            .setName('Quarto Path')
            .setDesc('Path to Quarto executable (e.g., quarto, /usr/local/bin/quarto)')
            .addText(text => text
                .setPlaceholder('quarto')
                .setValue(this.plugin.settings.quartoPath)
                .onChange(async (value) => {
                    this.plugin.settings.quartoPath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto Preview')
            .setDesc('Automatically start preview when opening Quarto files')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoPreview)
                .onChange(async (value) => {
                    this.plugin.settings.autoPreview = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Usage' });
        const usageText = containerEl.createEl('p');
        usageText.innerHTML = `
            - Use the ribbon icon or command palette to toggle preview<br>
            - Ctrl+Shift+P to quickly toggle preview<br>
            - Preview URLs will be shown in notifications<br>
            - Auto-preview can be enabled to start preview automatically
        `;
    }
}