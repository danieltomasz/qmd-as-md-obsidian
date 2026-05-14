# Changelog

All notable changes to **QMD as Markdown** are documented here. Pre-release versions (`-rc.x`, `-beta.x`) are distributed only via [BRAT](https://github.com/TfTHacker/obsidian42-brat); stable releases go to the Obsidian community plugin store.

## 0.2.0

### Added

- **Quarto preview inside Obsidian.** PDF previews (`format: typst` / `pdf`) open in Obsidian's native PDF viewer; HTML and other previews open in the built-in **Web viewer** core plugin. Live reload from the running `quarto preview` is preserved in both cases. New **Open Quarto preview in Obsidian** setting — turn it off to open the preview URL in your external browser instead.
- **Quarto outline view** (opt-in via the **Show Quarto outline** setting). Lists the headings of the active `.qmd` in a sidebar and jumps to them on click — Obsidian's core Outline panel cannot read `.qmd` files (issue #3). Active file only; included files are not resolved. Also available as the *Open Quarto outline* command.
- **QUARTO_TYPST variable** setting, for pointing Quarto at a specific Typst install.

### Changed

- Quarto errors are now surfaced as Obsidian notices for both render and preview, showing the actual `ERROR:` line instead of a bare exit code. Preview also reports recompile errors live.
- Quarto output is streamed to the developer console line by line, routed by severity (`ERROR:` / `WARNING:` / info).
- `quarto preview` is launched with `--no-browse`, so it no longer also opens an external browser tab alongside the in-Obsidian preview.
- The render flow reads the real output path from Quarto's `Output created:` line rather than guessing.

### Fixed

- The preview PDF tab is reused across recompiles instead of stacking new tabs, and opens once per session.
- A missing or misconfigured `quarto` binary now produces a clear notice instead of a silent failure.
- Quarto informational messages are no longer logged as errors.
- A disabled **Web viewer** core plugin is detected and reported, instead of silently leaving an empty leaf.

### Removed

- The `emitCompilationLogs` setting — Quarto output is now always logged.

## 0.1.0

### Added

- **Render Quarto to PDF** command and ribbon icon. Runs `quarto render <file>` on the active `.qmd` file (output format driven by the document's YAML — `format: typst` for Typst, `format: pdf` for LaTeX).
- **Open Compiled PDF in Obsidian** setting toggle. When enabled, the rendered PDF opens inside Obsidian using the built-in PDF viewer.
- Command exposes a `file-output` icon, so plugins like **Commander** can pin it to the toolbar.

### Changed

- PDF opens in a vertical split to the right of the source `.qmd`, so the source tab is no longer replaced.
- Re-running the render reuses the existing PDF tab (reloads the file in place) instead of stacking new tabs.

## 0.0.3

### Added

- Option to run Quarto preview for the current `.qmd` file.

## 0.0.2

### Changed

- Repurposed the plugin to enable viewing and editing of QMD files.

## 0.0.1

- Initial release by death_md, supporting `.txt` files.
