# QMD as Markdown — Obsidian plugin

A plugin for [Obsidian](https://obsidian.md) that allows seamless editing of QMD files as if they were Markdown.

QMD files combine Markdown with executable code cells and are supported by [Quarto](https://quarto.org/), an open-source publishing system. These files are compatible with editors like RStudio and VSCode.

This plugin originated in 2022 as a minimal change to a now-archived project by deathau: [deathau/txt-as-md-obsidian](https://github.com/deathau/txt-as-md-obsidian). It has since evolved to include additional integrations and features.

## Features

- View and edit `.qmd` files using Obsidian's standard Markdown editor.
- Run Quarto preview on the current file from the command palette.
- Render to PDF and (optionally) open the result inside Obsidian.

## Usage

### Editing QMD files

Once installed, `.qmd` files open in Obsidian's Markdown editor automatically.

---

## To-Do List

- [x] Use Obsidian 1.8's web preview to enable seamless in-app previews. *(toggle in settings — see "Live preview" section.)*
- [ ] Recognize `{language}` for code block syntax highlighting.
- [ ] Add CSS support for callout blocks.
- [ ] Enable the creation of new QMD files.
- [x] Add a render command. *(0.1.0-rc.1 — render to PDF, open inside Obsidian.)*

To enable linking with Quarto files, ensure the **"Detect all file extensions"** toggle is activated in the `Files & Links` section of Obsidian settings.

### Quarto preview

Available from the command palette: run **Quarto Preview** on the active `.qmd` file. *(Since 0.0.3.)*

### Rendering to PDF

*(Since 0.1)*

Three command-palette entries (all share the ribbon icon `file-output`, which is bound to the YAML-driven variant):

| Command | What it runs | When to use |
|---------|--------------|-------------|
| **Render Quarto (use format specified in YAML)** | `quarto render <file>` | Document's YAML `format:` block decides the output. If YAML targets a non-PDF format (e.g. `html`, `docx`), the file still renders but Obsidian's built-in viewer will not open it — the plugin shows a path notice. |
| **Render Quarto to PDF (Typst engine)** | `quarto render <file> --to typst` | Force the Typst engine regardless of YAML. Use `QUARTO_TYPST` setting to pin a Typst binary. |
| **Render Quarto to PDF (LaTeX engine)** | `quarto render <file> --to pdf` | Force the LaTeX engine (`lualatex`/`xelatex`/`pdflatex`). |

The CLI flag `--to pdf` is **Quarto's LaTeX path**, not a generic "any PDF" — that's why the engine-specific commands are split out. Pick the YAML-driven one if your `.qmd` already declares the format you want; pick an explicit engine to override per-render without touching the file.

#### Setting: Open Compiled PDF in Obsidian


## Live preview (beta)

The **Toggle Quarto Preview** command (palette + ribbon icon `eye`, default hotkey `Ctrl+Shift+P`) spawns `quarto preview` on the active `.qmd`, which runs a live HTTP server that re-renders on every save.

Setting **Open Quarto preview in Obsidian** decides where the preview URL lands:

- **On** (default) — uses Obsidian 1.8's built-in `webviewer` view to render the live preview in a tab inside Obsidian. No window switching; the preview re-renders in place as you save the source.
- **Off** — opens the preview URL in your default external browser (via `window.open`, which Electron routes through `shell.openExternal`).

Either way, the underlying `quarto preview` process keeps running until you toggle the command again — the toggle controls where the URL is opened, not the server's behaviour.

---

## Enhancing Quarto File Integration in Obsidian
=======
Off by default.

- **Off** — render finishes, notice shows the PDF path. Open it however you want.
- **On** — rendered PDF opens in a vertical split on the right via Obsidian's built-in PDF viewer. Source tab keeps focus.

Re-running the render reuses the existing PDF tab — no tab stacking.

#### Caveats

- The `.qmd` source must live inside the vault (the rendered `.pdf` lands next to it; Obsidian only opens vault files).
- Custom `output-dir` in `_quarto.yml` is not yet handled — the plugin looks for `<basename>.pdf` next to the source.

## Alternatives

As of the end of 2024, there are also other plugins that make it easier to work with Obsidian and Quarto:

- [Ridian](https://github.com/MichelNivard/Ridian) offers R code block execution and variable previews.
- [Quarto Exporter](https://github.com/AndreasThinks/obsidian-to-quarto-exporter) helps export Obsidian Markdown files into the QMD format.

The main difference between this plugin and these other plugins is that this plugin allows you to compile QMD files as they are, without exporting them to another folder. In this regard, it is more similar to the Pandoc plugin.

## Installation

### From the community plugin store (stable)

Search for **QMD as Markdown** in **Settings → Community plugins → Browse**. The community-store version always tracks the latest **stable** release (currently `0.1.0`).

### Beta releases via BRAT

Pre-release versions (`-rc.x`, `-beta.x`) are **only** distributed through [BRAT](https://github.com/TfTHacker/obsidian42-brat). The community plugin store will not show them.

1. Install **Obsidian42 - BRAT** from the community plugins list.
2. Open BRAT settings → use **Add Beta plugin** (the "frozen version" option is not needed).
3. Enter the repo: `danieltomasz/qmd-as-md-obsidian`.
4. BRAT reads `manifest-beta.json` from the repo and installs the latest pre-release tag (e.g. `0.1.0-rc.1`).
5. Enable the plugin in **Settings → Community plugins**.

To switch back to stable, remove the plugin from BRAT and reinstall from the community store.

### Manual install from GitHub

1. Download the latest release from the Releases section of the GitHub repository.
2. Extract the plugin folder from the zip file to your vault's plugins directory: `<vault>/.obsidian/plugins/`
   - Note: On some systems, the `.obsidian` folder might be hidden. On macOS, press `Command + Shift + Dot` to reveal hidden folders in Finder.
3. Reload Obsidian.
4. If prompted about Safe Mode, disable it and enable the plugin. Alternatively, go to **Settings → Third-party plugins**, disable Safe Mode, and enable the plugin manually.

## Hiding clutter from Quarto projects

If you'd like to hide additional file types, use the following CSS snippet. Save it in your snippets folder and enable it via the Appearance menu in Obsidian. You can add more file extensions as needed.

```css
div[data-path$='.Rproj'] {
 display: none;
}

div[data-path$='.cls'] {
 display: none;
}

div[data-path$='.yml'] {
 display: none;
}

div[data-path$='.json'] {
 display: none;
}
```

## Roadmap

- [ ] Use Obsidian 1.8's web preview to enable seamless in-app previews.
- [ ] Recognize `{language}` for code block syntax highlighting.
- [ ] Add CSS support for callout blocks.
- [ ] Enable the creation of new QMD files.
- [x] Add a render command. *(Shipped in 0.1.0-rc.1.)*

## Compatibility

This plugin requires Obsidian **v0.10.12** or later to work properly, as the necessary APIs were introduced in this version.

## Security

> **Important:** Third-party plugins can access files on your computer, connect to the internet, and install additional programs.

The source code for this plugin is open and available on GitHub for audit. While I assure you that the plugin does not collect data or perform any malicious actions, installing plugins in Obsidian always involves a level of trust.

## Changelog & contributing

- See [`CHANGELOG.md`](./CHANGELOG.md) for the full version history.
- See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development setup, the `make` targets, and the release process.
