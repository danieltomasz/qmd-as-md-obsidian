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

For live development, run `npm run dev` to start watch-mode compilation, and point it at a **dedicated test vault** — not your real one. The repository's `node_modules` and `.git` do not belong inside a vault, and a synced vault (Obsidian Sync, iCloud, git) will try to sync them. Two safe layouts:

- Clone the repository into `<test-vault>/.obsidian/plugins/<plugin-id>/` directly. Acceptable only because the test vault is disposable.
- Keep the repository anywhere outside a vault and symlink the build outputs (`main.js`, `manifest.json`, `styles.css`) into `<test-vault>/.obsidian/plugins/<plugin-id>/`.

Reload Obsidian (`Ctrl + R`) after each rebuild to load the changes.

For quick manual testing against a real vault, `make release-local` builds the plugin into `release-local/<plugin-id>/` — a folder laid out exactly like `<vault>/.obsidian/plugins/<plugin-id>/`, ready to copy across.

## Make targets

The `makefile` wraps common tasks. Run `make help` for the list:

- **`make build`** — install deps (`npm ci` when `package-lock.json` exists, otherwise `npm install`), build `main.js`, then zip.
- **`make zip`** — bundle `main.js` + `manifest.json` + `styles.css` into `qmd-as-md.zip`.
- **`make clean`** — wipe `node_modules` and build artefacts.
- **`make release-local`** — build into `release-local/<plugin-id>/` for manual install (`STABLE=1` to use `manifest.json`).
- **`make sync-version`** — write the manifest version into `package.json` and record the `version → minAppVersion` mapping in `versions.json` (`STABLE=1` to read `manifest.json`).
- **`make tag-beta`** — tag + push the `manifest-beta.json` version. The release workflow then publishes the pre-release.
- **`make tag-stable`** — tag + push the `manifest.json` version. The release workflow then publishes the release.

## Cutting a release

Releases are built and published by `.github/workflows/release.yml`, which fires when a version tag is pushed. The `make tag-*` targets only create and push the tag — the workflow does the build and upload.

Two release channels share the same `main` branch:

- **Stable** — `manifest.json` is the source of truth (e.g. `0.0.3`). Goes to the community plugin store.
- **Beta** — `manifest-beta.json` is the source of truth (e.g. `0.2.0-rc.8`). Distributed only via [BRAT](https://github.com/TfTHacker/obsidian42-brat). Pre-release semver suffixes (`-rc.x`, `-beta.x`) are accepted by BRAT but rejected by the community store, so betas live exclusively here.

The workflow picks the channel from the tag itself: a tag containing a hyphen (`0.2.0-rc.8`) is published as a GitHub **pre-release** with `manifest-beta.json` shipped under the name `manifest.json` — what BRAT's beta channel expects. A plain tag (`0.2.0`) is published as a normal release using `manifest.json`. Tags carry **no `v` prefix** (Obsidian convention; enforced by `.npmrc`'s `tag-version-prefix = ""`).

To publish a release:

```bash
# Beta — bump the version in manifest-beta.json first, then:
make sync-version          # mirror version into package.json + versions.json
git commit -am "release: 0.2.0-rc.9"
make tag-beta              # tags 0.2.0-rc.9 and pushes it

# Stable — bump the version in manifest.json first, then:
make sync-version STABLE=1
git commit -am "release: 0.2.0"
make tag-stable
```

Each `tag-*` target:

1. Reads the version from the appropriate manifest.
2. Refuses to run if the working tree has uncommitted changes — a tag must point at a committed state.
3. Refuses to overwrite an existing tag.
4. Creates an annotated tag and pushes it to `origin`.

The workflow then checks out the tag, runs `npm install && npm run build`, selects the manifest for the channel, and attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

After a beta release, BRAT users can hit **Check for updates to all beta plugins** to pull it.

> `styles.css` is a hand-written source file (not a build artefact). It must stay tracked in git, and both the workflow and `make zip` ship it. Don't add it back to `.gitignore`.
>
> `versions.json` maps each plugin version to the minimum Obsidian version it requires. The Obsidian community store reads it to decide which release to offer a given user. `make sync-version` keeps it in step with the manifest — keep it committed, and don't ship it as a release asset (it lives in the repo root, not the release).

## Troubleshooting the release flow

### `Failed to read version from <manifest>` / empty version

The `tag-*` targets run `node -p "require('./<manifest>').version"` and treat an empty result as a hard error. Common causes:

- **Wrong working directory.** Targets expect to be run from the repo root. `cd` there (`pwd` should show the directory containing the manifests) before running `make`.
- **Manifest missing or malformed.** The recipe prints the real Node.js error before bailing — read the message rather than the generic line.

### `Working tree has uncommitted changes`

`tag-beta` / `tag-stable` refuse to tag a dirty tree. Commit or stash first — including the `package.json` change from `make sync-version`.

### The tag pushed but no release appeared

The release is GitHub Actions work, not local. Check the **Actions** tab for the `Release` workflow run. A failed run there (not a local error) is the cause. Confirm the tag name matches the manifest version exactly, with no `v` prefix.

### BRAT says "this is not an Obsidian plugin"

BRAT walks the latest GitHub release looking for an asset named literally `manifest.json`. The workflow copies `manifest-beta.json` to `manifest.json` before upload for prerelease tags, so the asset name is correct. If BRAT still rejects a release, inspect the assets:

```bash
gh release view <tag> | grep -i asset
```

The list must contain `main.js`, `manifest.json`, and `styles.css` (exact spelling).

### Variables silently lost between recipe lines (macOS default Make)

macOS ships **GNU Make 3.81** (released 2006), which predates `.ONESHELL` (added in 3.82, 2010). On 3.81 the directive is silently ignored, so each recipe line runs in its own shell and any variable set on one line is gone by the next. The recipes in this repo are written as single `\`-joined shell invocations specifically to remain compatible with 3.81 — do **not** add `.ONESHELL` back without verifying the local `make --version`.

If you want a modern Make on macOS:

```bash
brew install make
gmake tag-beta      # invoked as `gmake`, not `make`
```
