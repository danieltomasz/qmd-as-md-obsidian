# QMD as Markdown Obsidian Plugin

A plugin for [Obsidian](https://obsidian.md) that allows seamless editing of QMD files as if they were Markdown.

QMD files combine Markdown with executable code cells and are supported by [Quarto](https://quarto.org/), an open-source publishing system. These files are compatible with editors like RStudio and VSCode.

This plugin originated in 2022 as a minimal change to a now-archived project by deathau: [deathau/txt-as-md-obsidian](https://github.com/deathau/txt-as-md-obsidian).  It has since evolved to include additional integrations and features.

As of the end of 2024, there are also other plugins  exist that make it easier to work with Obsidian and Quarto:

- [Ridian](https://github.com/MichelNivard/Ridian) offers R code block execution and variable previews.  
- [Quarto Exporter](https://github.com/AndreasThinks/obsidian-to-quarto-exporter) helps export Obsidian Markdown files into the QMD format.  

The main difference between this plugin and these other plugins is that this plugin allows you to compile QMD files as they are, without exporting them to another folder. In this regard, it is more similar to the Pandoc plugin.

---

## Version History

### 0.1.0-rc.1 (beta — BRAT only)
- Added **Render Quarto to PDF** command and ribbon icon. Runs `quarto render <file> --to pdf` on the active `.qmd` file.
- Added **"Open Compiled PDF in Obsidian"** setting toggle. When enabled, the rendered PDF opens inside Obsidian using the built-in PDF viewer.
- PDF opens in a vertical split to the right of the source `.qmd`, so the source tab is no longer replaced.
- Re-running the render reuses the existing PDF tab (reloads the file in place) instead of stacking new tabs.
- Command exposes a `file-output` icon, so plugins like **Commander** can pin it to the toolbar.

### 0.0.3
- Added an option to run Quarto preview for the current `qmd` file.

### 0.0.2
- Repurposed the plugin to enable viewing and editing of QMD files.
- Made the plugin available via BRAT and Obsidian.

### 0.0.1
- Initial release by death_md, supporting `.txt` files.

---

## To-Do List

- [ ] Use Obsidian 1.8’s web preview to enable seamless in-app previews.
- [ ] Recognize `{language}` for code block syntax highlighting.
- [ ] Add CSS support for callout blocks.
- [ ] Enable the creation of new QMD files.
- [x] Add a render command. *(0.1.0-rc.1 — render to PDF, open inside Obsidian.)*


---

## Rendering to PDF (beta)

Available from **0.1.0-rc.1** via BRAT.

- Command: **Render Quarto to PDF** (palette + ribbon icon `file-output`). Runs `quarto render <file> --to pdf` on the active `.qmd`.
- Setting **Open Compiled PDF in Obsidian** (off by default):
  - **Off** — render finishes, notice shows the PDF path. Open it however you want.
  - **On** — rendered PDF opens in a vertical split on the right via Obsidian's built-in PDF viewer. Source tab keeps focus.
- Re-running the render reuses the existing PDF tab — no tab stacking.
- The `.qmd` source must live inside the vault (the rendered `.pdf` lands next to it; Obsidian only opens vault files).
- Custom `output-dir` in `_quarto.yml` is not yet handled — the plugin looks for `<basename>.pdf` next to the source.

---

## Enhancing Quarto File Integration in Obsidian


To enable linking with Quarto files, ensure the **"Detect all file extensions"** toggle is activated in the `Files & Links` section of Obsidian settings.

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
---

## Compatibility

This plugin requires Obsidian **v0.10.12** or later to work properly, as the necessary APIs were introduced in this version.

---

## Installation

### From Within Obsidian

The plugin is available in Obsidian's community plugin list. The community-store version always tracks the latest **stable** release (currently `0.0.3`).

### Beta releases via BRAT

Pre-release versions (`-rc.x`, `-beta.x`) are **only** distributed through [BRAT](https://github.com/TfTHacker/obsidian42-brat). The community plugin store will not show them.

1. Install **Obsidian42 - BRAT** from the community plugins list.
2. Open BRAT settings → **Add Beta plugin with frozen version** is *not* needed — use **Add Beta plugin**.
3. Enter the repo: `danieltomasz/qmd-as-md-obsidian`.
4. BRAT reads `manifest-beta.json` from the repo and installs the latest pre-release tag (e.g. `0.1.0-rc.1`).
5. Enable the plugin in **Settings → Community plugins**.

To switch back to stable, remove the plugin from BRAT and reinstall from the community store.

### From GitHub

1. Download the latest release from the Releases section of the GitHub repository.
2. Extract the plugin folder from the zip file to your vault's plugins directory: `<vault>/.obsidian/plugins/`
   - Note: On some systems, the `.obsidian` folder might be hidden. On macOS, press `Command + Shift + Dot` to reveal hidden folders in Finder.
3. Reload Obsidian.
4. If prompted about Safe Mode, disable it and enable the plugin.  
   Alternatively, go to **Settings → Third-party plugins**, disable Safe Mode, and enable the plugin manually.

---

## Security

> **Important:** Third-party plugins can access files on your computer, connect to the internet, and install additional programs.

The source code for this plugin is open and available on GitHub for audit. While I assure you that the plugin does not collect data or perform any malicious actions, installing plugins in Obsidian always involves a level of trust.

---

## Development

This project is built using TypeScript for type checking and documentation.  
It relies on the latest [Obsidian plugin API](https://github.com/obsidianmd/obsidian-api) in TypeScript Definition format, which includes TSDoc comments for documentation.

**Note:** The Obsidian API is in early alpha and may change at any time.

To contribute or customize the plugin:

1. Clone this repository.
2. Run `npm i` or `yarn` to install dependencies.
3. Use `npm run build` to compile the plugin.
4. Copy `manifest.json`, `main.js`, and `styles.css` to a subfolder in your plugins directory: `<vault>/.obsidian/plugins/<plugin-name>/`
5. Reload Obsidian to apply changes.

Alternatively, clone the repository directly into your plugins folder. After installing dependencies, run `npm run dev` to enable watch mode for live compilation.  
Reload Obsidian (`Ctrl + R`) to view updates.

### Make targets

The `makefile` wraps common tasks. Run `make help` for the list:

| Target           | What it does                                                                 |
|------------------|------------------------------------------------------------------------------|
| `make build`     | `npm install`, build `main.js`, zip, clean.                                  |
| `make zip`       | Bundle `main.js` + `manifest.json` into `qmd-as-md.zip`.                     |
| `make clean`     | Wipe `node_modules`, build artefacts, lockfile.                              |
| `make audit`     | `npm audit` — security advisories for current dependency tree.               |
| `make outdated`  | `npm outdated` — newer upstream versions available.                          |
| `make check-deps`| Run both `audit` and `outdated`.                                             |

### Cutting a release

Two release channels share the same `main` branch:

- **Stable** — `manifest.json` is the source of truth (e.g. `0.0.3`). Goes to the community plugin store.
- **Beta** — `manifest-beta.json` is the source of truth (e.g. `0.1.0-rc.1`). Distributed only via [BRAT](https://github.com/TfTHacker/obsidian42-brat). Pre-release semver suffixes (`-rc.x`, `-beta.x`) are accepted by BRAT but rejected by the community store, so betas live exclusively here.

To publish a release:

```bash
# Beta — bump manifest-beta.json first, then:
make release-beta                          # interactive prompt for notes
make release-beta NOTES="Fixed leaf bug"   # non-interactive

# Stable — bump manifest.json first, then:
make release-stable
```

Both targets:
1. Read the version from the appropriate manifest.
2. Refuse to overwrite an existing tag.
3. Build `main.js` fresh.
4. Create a GitHub release tagged with the version (no `v` prefix — Obsidian convention) and attach `main.js` plus the correctly-versioned `manifest.json`. The beta target uploads `manifest-beta.json` renamed to `manifest.json` so BRAT finds the expected asset name.
5. Mark beta releases as `--prerelease`.

Requirements: `gh` authenticated against the repo, working tree clean, `node` available.

After a beta release, BRAT users can hit **Check for updates to all beta plugins** to pull it.

