# Changelog

All notable changes to **qmd as md** are documented here. Pre-release versions (`-rc.x`, `-beta.x`) are distributed only via [BRAT](https://github.com/TfTHacker/obsidian42-brat); stable releases go to the Obsidian community plugin store.

## 0.4.0

### Added

**New Quarto file from preset.** Command palette entry that creates a fresh `.qmd` in the active folder from a chosen preset. Built-ins shipped:

- *Empty* (minimal front-matter),
- *Word (.docx)* (TOC + numbered sections),
- *Typst PDF — Notes (Eisvogel-style)* (A4, numbered sections, page header, boxed code, H1 accent rule),
- *Typst PDF — Report (Eisvogel-style)* (adds cover metadata, TOC, bibliography/CSL hints; same Typst styling block).

Picker uses a fuzzy modal; filename prompt enforces `.qmd` and avoids overwriting existing files by appending `-1`, `-2`, …

**Templates folder setting.** Optional **Templates folder** setting points at any vault folder; every top-level `.qmd` file inside it is offered as a preset alongside the built-ins (file name = preset name, file contents inserted verbatim). Default is empty — only built-ins show. Subfolders are ignored. Templates are plain `.qmd` files, so they edit, version-control, and sync like any other note.

## 0.3.3

### Internal

- Split `main.ts` into `main.ts` + `code-view.ts` + `outline.ts` for
  maintainability. No behaviour change.
- `make tag-beta` / `tag-stable` now refuse a version whose prerelease
  suffix doesn't match the channel — a plain version can no longer be
  tagged as a beta (`release.yml` would otherwise publish it as a normal
  release).

## 0.3.2

### Added

- **Lua file view.** New **Show Lua files** setting (off by default). When
  enabled, `.lua` files open in a dedicated CodeMirror editor with minimal
  Lua syntax highlighting — comments, strings, numbers, keywords — handy
  for editing Quarto/pandoc filter scripts. Turn off and reload to hide
  them again.

### Notes

- One such filter: [obsidian-callouts.lua][callouts-filter] renders
  Obsidian / GitHub-style callouts (`> [!note]`) as native Quarto callouts.
  Drop it next to your `_quarto.yml` and add it under `filters:`.

[callouts-filter]: https://gist.github.com/danieltomasz/31d298aca2969adaf60d8841b68005e2

## 0.3.1

### Changed

- YAML file editor: `Tab` / `Shift+Tab` now indent and dedent via CodeMirror's
  commands instead of always inserting two spaces (no dedent before).
- YAML file editor: reduced font size to match Obsidian's UI scale — was
  noticeably larger than the rest of the app.
- YAML highlighting now follows YAML 1.2 (as Quarto does): only `true`,
  `false`, `null`, and `~` highlight as booleans/null. `yes`/`no`/`on`/`off`
  are treated as plain scalars.
- The "no active file" notice mentions `.md` too when **Preview and render
  Markdown files with Quarto** is enabled.

### Fixed

- Render close handler no longer swallows errors as unhandled rejections.

### Internal

- Adjusted code to better follow Obsidian plugin guidelines (API usage,
  floating promises, default-hotkey removal) ahead of community-store
  submission.
- Added `versions.json`; split the dependency tree into build-only deps vs
  ESLint tooling; committed `package-lock.json`. See `Contributing.md`.

## 0.3.0

- Allow Quarto preview and render commands to operate on Markdown files in Quarto projects when enabled via settings.
- Introduce an optional YAML file view that shows .yml and .yaml files in a dedicated CodeMirror-based editor with Quarto-oriented YAML highlighting.
- Add settings to toggle Markdown command support and YAML file visibility within Obsidian.

## 0.2.0

### Added

- **Quarto preview inside Obsidian.** PDF previews (`format: typst` / `pdf`) open in Obsidian's native PDF viewer; HTML and other previews open in the built-in **Web viewer** core plugin. Live reload from the running `quarto preview` is preserved in both cases. New **Open Quarto preview in Obsidian** setting controls the generic preview command and ribbon target.
- **Explicit preview targets.** New **Toggle Quarto preview in Obsidian** and **Toggle Quarto preview in external browser** commands choose the preview destination without changing the default setting.
- **Quarto outline view** (opt-in via the **Show Quarto outline** setting). Lists the headings of the active `.qmd` in a sidebar and jumps to them on click — Obsidian's core Outline panel cannot read `.qmd` files (issue #3). Active file only; included files are not resolved. Also available as the *Open Quarto outline* command.

### Changed

- Quarto errors are now surfaced as Obsidian notices for both render and preview, showing the actual `ERROR:` line instead of a bare exit code. Preview also reports recompile errors live.
- Quarto output is streamed to the developer console line by line, routed by severity (`ERROR:` / `WARNING:` / info).
- Preview launches `quarto preview` with `--no-browser` in both modes; the plugin opens the captured URL once for the selected target, avoiding duplicate browser tabs and Quarto-managed browser navigation issues.
- The render flow reads the real output path from Quarto's `Output created:` line rather than guessing.

### Fixed

- The preview PDF tab is reused across recompiles instead of stacking new tabs, and opens once per session.
- A missing or misconfigured `quarto` binary now produces a clear notice instead of a silent failure.
- Quarto informational messages are no longer logged as errors.
- A disabled **Web viewer** core plugin is detected and reported, then falls back to the external browser instead of silently leaving an empty leaf.

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
- **QUARTO_TYPST variable** setting, for pointing Quarto at a specific Typst install.

## 0.0.2

### Changed

- Repurposed the plugin to enable viewing and editing of QMD files.

## 0.0.1

- Initial release by death_md, supporting `.txt` files.
