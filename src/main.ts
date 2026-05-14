import {
  Plugin,
  Notice,
  TFile,
  FileView,
  ItemView,
  MarkdownView,
  PluginSettingTab,
  App,
  Setting,
  FileSystemAdapter,
  WorkspaceLeaf,
  debounce,
  normalizePath,
} from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { shell } from 'electron';

// --- Quarto output plumbing -----------------------------------------------
//
// Node's spawn-stream chunks don't align with line boundaries — a single
// data event can contain a partial line, and a logical line can be split
// across two events. Build a per-stream processor that buffers the
// trailing partial line and only emits whole lines. Call .flush() on the
// close handler to release any final partial line.
//
// logQuartoLine routes a single line to console by severity prefix:
// "ERROR:" -> console.error, "WARNING:"/"WARN:" -> console.warn,
// everything else -> console.log. Centralised so both the preview and
// render paths stay in sync and new prefixes only need handling here.

function logQuartoLine(prefix: string, line: string): void {
  if (/^ERROR:/.test(line)) {
    console.error(`${prefix}: ${line}`);
  } else if (/^WARN(ING)?:/.test(line)) {
    console.warn(`${prefix}: ${line}`);
  } else {
    console.log(`${prefix}: ${line}`);
  }
}

interface LineProcessor {
  (chunk: string): void;
  flush(): void;
}

function makeLineProcessor(handle: (line: string) => void): LineProcessor {
  let buffer = '';
  const proc = ((chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    // Last element is the trailing fragment after the final newline
    // (or the whole chunk if there was no newline at all). Keep it
    // for the next chunk.
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line) handle(line);
    }
  }) as LineProcessor;
  proc.flush = () => {
    if (buffer) {
      handle(buffer);
      buffer = '';
    }
  };
  return proc;
}

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

const QMD_OUTLINE_VIEW = 'qmd-outline-view';

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

interface QmdPluginSettings {
  quartoPath: string;
  enableQmdLinking: boolean;
  quartoTypst: string;
  openPdfInObsidian: boolean;
  previewInObsidian: boolean;
  showOutline: boolean;
}

const DEFAULT_SETTINGS: QmdPluginSettings = {
  quartoPath: 'quarto',
  enableQmdLinking: true,
  quartoTypst: '',
  openPdfInObsidian: false,
  previewInObsidian: true,
  showOutline: false,
};

export default class QmdAsMdPlugin extends Plugin {
  settings: QmdPluginSettings;
  activePreviewProcesses: Map<string, ChildProcess> = new Map();
  // The .qmd file the outline should describe. Tracked separately from the
  // active leaf: clicking inside the outline sidebar makes *it* the active
  // leaf, so the outline must remember the last real .qmd rather than ask
  // "what is active now?" each render.
  lastActiveQuartoFile: TFile | null = null;

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

      this.registerRenderCommand('render-quarto-pdf', 'Render Quarto (use format defined in YAML)');
      this.registerRenderCommand('render-quarto-pdf-typst', 'Render Quarto to PDF (Typst engine)', 'typst');
      this.registerRenderCommand('render-quarto-pdf-latex', 'Render Quarto to PDF (LaTeX engine)', 'pdf');

      this.registerView(QMD_OUTLINE_VIEW, (leaf) => new QmdOutlineView(leaf, this));

      this.addCommand({
        id: 'open-quarto-outline',
        name: 'Open Quarto outline',
        callback: () => this.activateOutlineView(),
      });

      // Keep any open outline view in sync with the focused file and its
      // edits. Debounced so a burst of keystrokes re-parses once it settles.
      const refresh = debounce(() => {
        this.trackActiveQuartoFile();
        this.refreshOutlineViews();
      }, 250, true);
      this.registerEvent(this.app.workspace.on('active-leaf-change', refresh));
      this.registerEvent(this.app.workspace.on('editor-change', refresh));

      // Opt-in: only auto-open the outline when the user enabled it. The
      // command above always works regardless of this setting.
      if (this.settings.showOutline) {
        this.app.workspace.onLayoutReady(() => this.activateOutlineView());
      }
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
    console.log('[qmd-as-md][diag] openPreviewUrl called. url:', url,
      'previewInObsidian:', this.settings.previewInObsidian);
    new Notice(`Preview available at ${url}`);

    if (!this.settings.previewInObsidian) {
      // shell.openExternal hands the URL to the OS default browser. This
      // is the reliable path — activeWindow.open('_blank') frequently
      // opens nothing in Obsidian's renderer.
      console.log('[qmd-as-md][diag] calling shell.openExternal; shell is:', typeof shell, shell);
      shell.openExternal(url).then(
        () => console.log('[qmd-as-md][diag] shell.openExternal resolved'),
        (err) => console.error('[qmd-as-md][diag] shell.openExternal rejected:', err)
      );
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
      void shell.openExternal(url);
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

  // Open the Quarto outline in the right sidebar, reusing an existing
  // outline leaf if one is already open.
  async activateOutlineView(): Promise<void> {
    const { workspace } = this.app;
    // Capture the current .qmd before opening the outline — setViewState
    // with active:true makes the outline the active leaf, after which the
    // active markdown view is gone.
    this.trackActiveQuartoFile();
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(QMD_OUTLINE_VIEW)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: QMD_OUTLINE_VIEW, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
    this.refreshOutlineViews();
  }

  // Remember the active .qmd file. Called whenever the active leaf changes;
  // a non-.qmd active leaf (including the outline sidebar itself) leaves the
  // last value untouched so the outline keeps describing that file.
  trackActiveQuartoFile(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file && this.isQuartoFile(view.file)) {
      this.lastActiveQuartoFile = view.file;
    }
  }

  // Re-render every open outline view. No-op when none are open.
  refreshOutlineViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(QMD_OUTLINE_VIEW)) {
      if (leaf.view instanceof QmdOutlineView) {
        leaf.view.render();
      }
    }
  }

  // Close any open outline views — used when the user turns the setting off.
  detachOutlineViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(QMD_OUTLINE_VIEW)) {
      leaf.detach();
    }
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
      //
      // detached: `quarto preview` forks a separate long-lived server
      // process. Making the spawned process a process-group leader (POSIX)
      // lets killPreviewProcess signal the whole group — a plain kill() of
      // the wrapper would orphan the server, leaving it serving and
      // recompiling after "stop". No process groups on Windows; the kill
      // there goes through taskkill instead.
      const quartoProcess = spawn(
        this.settings.quartoPath,
        ['preview', filePath, '--no-browse'],
        {
          cwd: workingDir,
          env: envVars,
          detached: process.platform !== 'win32',
        }
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

      // Quarto "ERROR:" lines from this preview run. Used both to surface
      // recompile failures live (preview keeps running, so the close
      // handler never fires) and to explain a startup exit in the Notice.
      const errorLines: string[] = [];
      // Dedupe: a single failed recompile emits the same ERROR: block on
      // every save until fixed — only Notice when the error text changes.
      let lastErrorShown = '';

      // Per-line handler: log the line, then look for the two markers
      // we care about ("Output created:" and "Browse at").
      const handlePreviewLine = (line: string) => {
        logQuartoLine('Quarto Preview', line);

        if (/^ERROR:/.test(line)) {
          errorLines.push(line);
          if (line !== lastErrorShown) {
            lastErrorShown = line;
            new Notice(`Quarto preview error:\n${line}`, 15000);
          }
          return;
        }
        // A clean compile clears the dedupe guard so the same error
        // reappearing after a good build is surfaced again.
        if (line.includes('Output created:')) {
          lastErrorShown = '';
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
          return;
        }

        if (!previewUrl && line.includes('Browse at')) {
          const match = line.match(/Browse at\s+(http:\/\/[^\s]+)/);
          console.log(
            '[qmd-as-md][diag] Browse-at line seen.',
            'matched:', match?.[1] ?? null,
            'pdfPreviewPath:', pdfPreviewPath,
            'previewInObsidian:', this.settings.previewInObsidian
          );
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
      };

      // One buffered processor per stream — stdout and stderr each
      // need their own partial-line buffer, or interleaved fragments
      // from the two streams would be spliced into synthetic lines.
      const previewStdout = makeLineProcessor(handlePreviewLine);
      const previewStderr = makeLineProcessor(handlePreviewLine);
      quartoProcess.stdout?.on('data', (data: Buffer) => previewStdout(data.toString()));
      quartoProcess.stderr?.on('data', (data: Buffer) => previewStderr(data.toString()));

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
        previewStdout.flush(); // release any final partial line
        previewStderr.flush();
        if (code !== null && code !== 0) {
          const reason = errorLines.length > 0
            ? errorLines.join('\n')
            : 'Check the developer console for details.';
          new Notice(`Quarto preview exited with code ${code}.\n${reason}`, 15000);
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

  // `quarto preview` forks a long-lived server as a child of the spawned
  // process, so killing only the wrapper leaves that server running. Signal
  // the whole process tree: the process group on POSIX (the child was
  // spawned detached, see startPreview), or taskkill /t on Windows.
  private killPreviewProcess(quartoProcess: ChildProcess): void {
    if (quartoProcess.killed || quartoProcess.pid === undefined) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(quartoProcess.pid), '/t', '/f']);
      return;
    }
    try {
      // Negative PID targets the whole process group.
      process.kill(-quartoProcess.pid, 'SIGTERM');
    } catch {
      // Group already gone, or never became a leader — best-effort direct kill.
      try {
        quartoProcess.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
  }

  async stopPreview(file: TFile) {
    const quartoProcess = this.activePreviewProcesses.get(file.path);
    if (quartoProcess) {
      this.killPreviewProcess(quartoProcess);
      this.activePreviewProcesses.delete(file.path);
      new Notice('Quarto preview stopped');
    }
  }

  stopAllPreviews() {
    const hadPreviews = this.activePreviewProcesses.size > 0;
    this.activePreviewProcesses.forEach((quartoProcess, filePath) => {
      this.killPreviewProcess(quartoProcess);
      this.activePreviewProcesses.delete(filePath);
    });
    if (hadPreviews) {
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

      // A running `quarto preview` keeps recompiling the same source and
      // writes to overlapping output paths. Stop it before a one-shot
      // render so the two Quarto processes do not fight over the output.
      if (this.activePreviewProcesses.has(file.path)) {
        await this.stopPreview(file);
      }

      const filePath = this.getVaultFullPath(abstractFile);
      if (!filePath) return;
      const workingDir = path.dirname(filePath);

      const envVars: NodeJS.ProcessEnv = { ...process.env };
      if (this.settings.quartoTypst.trim()) {
        envVars.QUARTO_TYPST = this.settings.quartoTypst.trim();
      }

      const engineLabel = toFormat === 'typst' ? 'Typst' : toFormat === 'pdf' ? 'LaTeX' : 'format defined in YAML';
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
      // Quarto prints the human-readable cause on "ERROR:" lines (bad YAML,
      // missing engine, etc.). Keep them so a failing close can surface the
      // real reason in the Notice instead of a bare exit code.
      const errorLines: string[] = [];

      // Per-line handler: log the line, then watch for "Output created:".
      const handleRenderLine = (line: string) => {
        logQuartoLine('Quarto', line);
        const match = line.match(/Output created:\s*(.+?)\s*$/);
        if (match) {
          detectedOutputBasename = path.basename(match[1].trim());
        }
        if (/^ERROR:/.test(line)) {
          errorLines.push(line);
        }
      };

      // One buffered processor per stream — stdout and stderr each
      // need their own partial-line buffer, or interleaved fragments
      // from the two streams would be spliced into synthetic lines.
      const renderStdout = makeLineProcessor(handleRenderLine);
      const renderStderr = makeLineProcessor(handleRenderLine);
      quartoProcess.stdout?.on('data', (data: Buffer) => renderStdout(data.toString()));
      quartoProcess.stderr?.on('data', (data: Buffer) => renderStderr(data.toString()));

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
        renderStdout.flush(); // release any final partial line
        renderStderr.flush();

        // A clean exit is code 0. Anything else is a failure, except a
        // termination by SIGTERM/SIGKILL — that means the process was
        // intentionally cancelled (matching the preview handler, which
        // suppresses notices for those signals). Stay quiet then.
        if (code === 0) {
          // fall through to the success path below
        } else if (code === null && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
          console.error(`[qmd-as-md] Quarto render cancelled (${signal}).`);
          return;
        } else {
          const exitLabel = code !== null
            ? `exit ${code}`
            : signal
              ? `terminated by ${signal}`
              : 'terminated';
          // The full output was already streamed line-by-line through
          // console.log / console.error as it arrived — no need to
          // re-dump it. Surface the actual ERROR: line(s) in the Notice so
          // the user sees the cause (bad YAML, missing engine, ...) without
          // having to open the developer console.
          console.error(`[qmd-as-md] Quarto render failed (${exitLabel}).`);
          const reason = errorLines.length > 0
            ? errorLines.join('\n')
            : 'Check the developer console for details.';
          new Notice(`Quarto render failed (${exitLabel}).\n${reason}`, 15000);
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

// Sidebar outline for the active .qmd file. Re-renders on demand (the
// plugin wires it to active-leaf-change and editor-change). Active-file
// only by design — Quarto `{{< include >}}` targets are not resolved.
class QmdOutlineView extends ItemView {
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

    new Setting(containerEl)
      .setName('Show Quarto outline')
      .setDesc(
        "Add a sidebar outline of the active .qmd file's headings (Obsidian's " +
          'core Outline panel cannot read .qmd files). Active file only — ' +
          'headings from included files are not listed. The "Open Quarto ' +
          'outline" command works regardless of this toggle.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOutline)
          .onChange(async (value) => {
            this.plugin.settings.showOutline = value;
            await this.plugin.saveSettings();
            if (value) {
              await this.plugin.activateOutlineView();
            } else {
              this.plugin.detachOutlineViews();
            }
          })
      );
  }
}