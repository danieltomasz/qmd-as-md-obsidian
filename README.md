# QMD as Markdown Obsidian Plugin

A plugin for [Obsidian](https://obsidian.md) that allows seamless editing of QMD files as if they were Markdown.

QMD files combine Markdown with executable code cells and are supported by [Quarto](https://quarto.org/), an open-source publishing system. These files are compatible with editors like RStudio and VSCode.

This plugin originated in 2022 as a minimal change to a now-archived project by deathau: [deathau/txt-as-md-obsidian](https://github.com/deathau/txt-as-md-obsidian).  It has since evolved to include additional integrations and features.

As of the end of 2024, there are also other plugins  exist that make it easier to work with Obsidian and Quarto:

- [Ridian](https://github.com/MichelNivard/Ridian) offers R code block execution and variable previews.  
- [Quarto Exporter](https://github.com/AndreasThinks/obsidian-to-quarto-exporter) helps export Obsidian Markdown files into the QMD format.  


---

## Version History

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
- [ ] Add a render command.


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

The plugin is available in Obsidian's community plugin list.  
For beta releases, you can use the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).

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

