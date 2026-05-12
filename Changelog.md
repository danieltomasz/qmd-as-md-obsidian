# Changelog

All notable changes to **QMD as Markdown** are documented here. Pre-release versions (`-rc.x`, `-beta.x`) are distributed only via [BRAT](https://github.com/TfTHacker/obsidian42-brat); stable releases go to the Obsidian community plugin store.

## 0.1.0-rc.1 — beta (BRAT only)

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
