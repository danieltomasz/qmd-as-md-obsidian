# Contributing to QMD as Markdown

## Development setup

This project is built using TypeScript for type checking and documentation. It relies on the latest [Obsidian plugin API](https://github.com/obsidianmd/obsidian-api) in TypeScript Definition format, which includes TSDoc comments for documentation.

**Note:** The Obsidian API is in early alpha and may change at any time.

To contribute or customize the plugin:

1. Clone this repository.
2. Run `npm i` or `yarn` to install dependencies.
3. Use `npm run build` to compile the plugin.
4. Copy `manifest.json`, `main.js`, and `styles.css` to a subfolder in your plugins directory: `<vault>/.obsidian/plugins/<plugin-name>/`
5. Reload Obsidian to apply changes.

Alternatively, clone the repository directly into your plugins folder. After installing dependencies, run `npm run dev` to enable watch mode for live compilation. Reload Obsidian (`Ctrl + R`) to view updates.

## Make targets

The `makefile` wraps common tasks. Run `make help` for the list:

| Target              | What it does                                                                                |
|---------------------|---------------------------------------------------------------------------------------------|
| `make build`        | Install deps (`npm ci` when `package-lock.json` exists, otherwise `npm install`), build `main.js`, then zip. |
| `make zip`          | Bundle `main.js` + `manifest.json` into `qmd-as-md.zip`.                                    |
| `make clean`        | Wipe `node_modules` and build artefacts.                                                    |
| `make release-beta` | Publish a GitHub pre-release using the version in `manifest-beta.json`.                     |
| `make release-stable` | Publish a GitHub release using the version in `manifest.json`.                            |

## Cutting a release

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

1. Check that `gh`, `node`, `npm`, and `zip` are on `PATH`.
2. Read the version from the appropriate manifest, and refuse to overwrite an existing tag.
3. Build `main.js` fresh (`npm ci` if `package-lock.json` exists, otherwise `npm install`).
4. Create a GitHub release tagged with the version (no `v` prefix — Obsidian convention) and attach `main.js` plus a correctly-versioned `manifest.json`. The beta target stages `manifest-beta.json` into a tempdir under the literal name `manifest.json` so BRAT finds the asset it expects.
5. Mark beta releases as `--prerelease`.

Requirements: `gh` authenticated against the repo, working tree clean.

After a beta release, BRAT users can hit **Check for updates to all beta plugins** to pull it.

## Troubleshooting the release flow

### `Could not read version from manifest-beta.json` / empty version

The recipe runs `node -p "require('./manifest-beta.json').version"` and treats an empty result as a hard error. Common causes:

- **Wrong working directory.** The recipe expects to be run from the repo root. `cd` to it (`pwd` should show the directory containing `manifest-beta.json`) before running `make`.
- **Manifest missing or malformed.** The recipe now prints the real Node.js error before bailing — read the message rather than the generic line.
- **`gh` not authenticated for this repo.** Run `gh auth status` and `gh repo set-default danieltomasz/qmd-as-md-obsidian` if needed.

### Variables silently lost between recipe lines (macOS default Make)

macOS ships **GNU Make 3.81** (released 2006), which predates `.ONESHELL` (added in 3.82, 2010). On 3.81 the directive is silently ignored, so each recipe line runs in its own shell and any variable set on one line is gone by the next. The recipes in this repo are written as single `\`-joined shell invocations specifically to remain compatible with 3.81 — do **not** add `.ONESHELL` back without verifying the local `make --version`.

If you want a modern Make on macOS:

```bash
brew install make
gmake release-beta NOTES="…"      # invoked as `gmake`, not `make`
```

### BRAT says "this is not an Obsidian plugin"

BRAT walks the latest GitHub release looking for an asset named literally `manifest.json`. The previous version of this Makefile relied on `gh release create`'s `path#displayname` rename syntax, which silently no-op'd in some `gh` CLI versions and uploaded the asset under its real basename (e.g. `qmd-release-manifest.json`) — invisible to BRAT. The current recipe sidesteps the rename mechanism by staging the file under the correct name in a tempdir before upload. If BRAT still rejects a release, inspect the assets:

```bash
gh release view <tag> | grep -i asset
```

The list must contain both `main.js` and `manifest.json` (exact spelling).

### Release was created but `gh release create` failed silently

Older versions of the recipe used long `\`-joined chains without `set -e`. A failed `npm install`/`npm run build` or missing tool would let the chain continue past the failure, eventually erroring on `gh release create` with no clear cause. The current recipe sets `set -e` at the start of each release target, validates each tool with `command -v`, and verifies `main.js` was produced before invoking `gh`. If something still goes wrong, the first error surfaced by the recipe is the real one — read up, not down.
