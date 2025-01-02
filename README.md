# qmd as md Obsidian plugin

A plugin for [Obsidian](https://obsidian.md) which allows editing of qmd files as if they were markdown.

QMD files contain a combination of markdown and executable code cell, and are format supported by [Quarto](https://quarto.org/) open source publishing systems, they are supported in Rstudio and VSCode editors.

To be able to use  linking with  the quatro files you need to check the toggle "detect all files extension" in `Files & Links` section in Obsidian.

To hide additional files you might use this CSS chunk (save it as a file to your snippets folder and enable it in Obsidian in the Appeareance menu), you might add aditional filetypes.

```css
div[data-path$='.Rproj']{
	display: none;
}

div[data-path$='.cls']{
	display: none;
}

div[data-path$='.yml']{
	display: none;
}

div[data-path$='.json']{
	display: none;
}
```

Plugin is a small tweak of a plugin made by deathau: [deathau/txt-as-md-obsidian: Edit txt files in Obsidian.md as if they were markdown](https://github.com/deathau/txt-as-md-obsidian).

### Plugins for better editing experience

- Use  [obsidian-shellcomands](obsidian://show-plugin?id=obsidian-shellcommands) with `quarto render {{file_path:absolute}} --to pdf` to render the file inside Obsidian
-  Use [HTML Reader](obsidian://show-plugin?id=obsidian-html-plugin) to render HTML output inside Obsidian, Obsidian natively supports pdfs.


### To-do

- [ ] Creation of new qmd files
- [ ] Currly braces `{language}` treated as language for codeblock
- [ ] CSS for callout blocks
- [ ] Better integration with Obsidian

### Compatibility

The required APIs were only added in Obsidian **0.10.12**, and as such, that is the minimum version of Obsidian required to use this plugin. 

## Installation

### From within Obsidian

Plugin is accesible in the Obsidian n the community list. If you want to test beta releases, you can use [the BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).

### From GitHub
- Download the Latest Release from the Releases section of the GitHub Repository
- Extract the plugin folder from the zip to your vault's plugins folder: `<vault>/.obsidian/plugins/`  
Note: On some machines the `.obsidian` folder may be hidden. On MacOS you should be able to press `Command+Shift+Dot` to show the folder in Finder.
- Reload Obsidian
- If prompted about Safe Mode, you can disable safe mode and enable the plugin.
Otherwise head to Settings, third-party plugins, make sure safe mode is off and
enable the plugin from there.

## Security
> Third-party plugins can access files on your computer, connect to the internet, and even install additional programs.

The source code of this plugin is available on GitHub for you to audit yourself, but installing plugins into Obsidian is currently a matter of trust.

I can assure you here that I do nothing to collect your data, send information to the internet or otherwise do anything nefarious with your system. However, be aware that I *could*, and you only have my word that I don't.

## Development

This project uses Typescript to provide type checking and documentation.  
The repo depends on the latest [plugin API](https://github.com/obsidianmd/obsidian-api) in Typescript Definition format, which contains TSDoc comments describing what it does.

**Note:** The Obsidian API is still in early alpha and is subject to change at any time!

If you want to contribute to development and/or just customize it with your own
tweaks, you can do the following:
- Clone this repo.
- `npm i` or `yarn` to install dependencies
- `npm run build` to compile.
- Copy `manifest.json`, `main.js` and `styles.css` to a subfolder of your plugins
folder (e.g, `<vault>/.obsidian/plugins/<plugin-name>/`)
- Reload obsidian to see changes

Alternately, you can clone the repo directly into your plugins folder and once
dependencies are installed use `npm run dev` to start compilation in watch mode.  
You may have to reload obsidian (`ctrl+R`) to see changes.

## Pricing

Plugin is completely free, but you might contribute to the author of the orginal plugin (deathau) via the following:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/deathau?style=social)](https://github.com/sponsors/deathau)
[![Paypal](https://img.shields.io/badge/paypal-deathau-yellow?style=social&logo=paypal)](https://paypal.me/deathau)

# Version History
## 0.0.1
Initial release by death_md supporting txt!
## 0.0.2
Repurposing this plugin to viev and edit qmd files, plugin available via BRAT.
## 0.0.3 
Enable preview of qmd files