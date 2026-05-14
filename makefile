SHELL := /bin/bash
PLUGIN_ID := qmd-as-md-obsidian

# macOS ships GNU Make 3.81, which predates .ONESHELL (3.82+). Recipes
# must be `\`-joined into a single shell invocation so set -e and
# variables propagate between lines.

# --- Shared macros ---------------------------------------------------------
# Each macro is a single `\`-joined shell fragment that ends without a
# trailing semicolon — the caller adds `;` and continues the chain.

define build_main_js
echo "→ Building main.js (build deps only, ~40 packages)..."; \
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi; \
npm run build; \
[ -f main.js ] || { echo "main.js not produced by build"; exit 1; }
endef

# Reads .version from the manifest in $$MANIFEST and sets VERSION.
# Captures node's exit code explicitly so a missing file, malformed
# JSON, or a missing `.version` field surface their real cause
# instead of a generic message. The `&& RC=0 || RC=$$?` form is
# required because under `set -e` a bare failing command substitution
# would abort the recipe before we could read $$?.
define read_version
[ -f "$$MANIFEST" ] || { echo "$$MANIFEST not found in $$(pwd). Run make from the repo root."; exit 1; }; \
NODE_OUT=$$(node -p "require('./$$MANIFEST').version" 2>&1) && RC=0 || RC=$$?; \
if [ $$RC -ne 0 ]; then \
	echo "Failed to read version from $$MANIFEST:"; \
	echo "$$NODE_OUT"; \
	exit 1; \
fi; \
VERSION="$$NODE_OUT"; \
if [ -z "$$VERSION" ] || [ "$$VERSION" = "undefined" ]; then \
	echo "$$MANIFEST has no .version field"; exit 1; \
fi
endef

# Records the manifest's version -> minAppVersion mapping in versions.json,
# so the Obsidian community store knows the minimum app version each
# release requires. $$MANIFEST must be set by the caller.
define update_versions_json
node -e 'const fs=require("fs"),m=require("./"+process.argv[1]),f="versions.json",v=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};v[m.version]=m.minAppVersion;fs.writeFileSync(f,JSON.stringify(v,null,2)+"\n");' "$$MANIFEST"
endef

# Fails unless the working tree (tracked files) is clean — a tag must
# point at a committed state, not whatever happens to be on disk.
define require_clean_tree
git diff --quiet && git diff --cached --quiet || { \
	echo "Working tree has uncommitted changes. Commit or stash before tagging."; exit 1; \
}
endef

# --- Standard targets ------------------------------------------------------

help:
	@echo "Targets:"
	@echo "  build           Install build deps (~40 pkgs), build main.js, then zip."
	@echo "  lint            Install all deps (~340 pkgs, incl. eslint) and lint src/."
	@echo "  zip             Bundle main.js + manifest.json + styles.css into qmd-as-md.zip."
	@echo "  clean           Remove node_modules, build artefacts, release-local/."
	@echo "  release-local   Build into release-local/$(PLUGIN_ID)/ (manifest-beta.json"
	@echo "                  by default; STABLE=1 to use manifest.json). Folder is"
	@echo "                  gitignored; copy it into <vault>/.obsidian/plugins/."
	@echo "  sync-version    Write the manifest version into package.json and record"
	@echo "                  version -> minAppVersion in versions.json (BETA by"
	@echo "                  default; STABLE=1 to read manifest.json). Commit the result."
	@echo "  tag-beta        Tag + push the manifest-beta.json version. The release.yml"
	@echo "                  workflow then builds and publishes the GitHub pre-release."
	@echo "  tag-stable      Tag + push the manifest.json version. The release.yml"
	@echo "                  workflow then builds and publishes the GitHub release."
	@echo ""
	@echo "Public release flow:  bump the manifest -> make sync-version -> commit"
	@echo "                      -> make tag-beta (or tag-stable)."

zip:
	zip qmd-as-md.zip main.js manifest.json styles.css

clean:
	rm -rf node_modules dist build .cache *.log *.tmp release-local

build:
	@set -e; \
	$(build_main_js); \
	$(MAKE) zip

# Lint needs the eslint tooling, which is the bulk of the dependency
# tree (~300 of ~340 packages). It is kept out of the build path on
# purpose — `make build` installs build deps only. Run this before
# submitting to the community store to catch Obsidian guideline issues.
lint:
	@set -e; \
	echo "→ Installing all deps (incl. eslint, ~340 packages)..."; \
	if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
	npm run lint

# --- Local "release" for manual testing ------------------------------------
# Build the plugin into release-local/<plugin-id>/ at the repo root. The
# folder layout mirrors <vault>/.obsidian/plugins/<plugin-id>/ so it can
# be copied straight in:
#
#   cp -R release-local/$(PLUGIN_ID) /path/to/vault/.obsidian/plugins/
#
# Default uses manifest-beta.json (the version under active development).
# Pass STABLE=1 to use manifest.json instead.
#
#   make release-local
#   make release-local STABLE=1
#
# release-local/ is git-ignored.

release-local:
	@set -e; \
	$(build_main_js); \
	DEST="release-local/$(PLUGIN_ID)"; \
	rm -rf "$$DEST"; \
	mkdir -p "$$DEST"; \
	cp main.js "$$DEST/main.js"; \
	if [ "$(STABLE)" = "1" ]; then \
		echo "→ Using manifest.json (stable)"; \
		cp manifest.json "$$DEST/manifest.json"; \
	else \
		echo "→ Using manifest-beta.json (beta)"; \
		cp manifest-beta.json "$$DEST/manifest.json"; \
	fi; \
	[ -f styles.css ] && cp styles.css "$$DEST/styles.css" || true; \
	echo "✓ Wrote release-local/$(PLUGIN_ID)/"; \
	echo "  Copy to a vault with:"; \
	echo "    cp -R release-local/$(PLUGIN_ID) /path/to/vault/.obsidian/plugins/"

# --- Public releases -------------------------------------------------------
# Releases are built and published by .github/workflows/release.yml, which
# fires on a pushed tag. A prerelease-style tag (one containing a hyphen,
# e.g. 0.2.0-rc.8) is published as a GitHub pre-release with the
# manifest-beta.json contents — that is what BRAT's beta channel reads.
# A plain tag (e.g. 0.2.0) is published as a normal release.
#
# These targets only create and push the tag; the workflow does the rest.
# Tags carry no `v` prefix (Obsidian requirement; see .npmrc).

sync-version:
	@set -e; \
	if [ "$(STABLE)" = "1" ]; then MANIFEST=manifest.json; else MANIFEST=manifest-beta.json; fi; \
	$(read_version); \
	echo "→ Setting package.json version to $$VERSION (from $$MANIFEST)..."; \
	npm pkg set version="$$VERSION"; \
	echo "→ Recording $$VERSION -> minAppVersion in versions.json..."; \
	$(update_versions_json); \
	echo "✓ package.json + versions.json now at $$VERSION. Commit these changes, then run a tag-* target."

tag-beta:
	@set -e; \
	MANIFEST=manifest-beta.json; \
	$(read_version); \
	$(require_clean_tree); \
	if git rev-parse "$$VERSION" >/dev/null 2>&1; then \
		echo "Tag $$VERSION already exists. Bump manifest-beta.json first."; exit 1; \
	fi; \
	echo "→ Tagging $$VERSION and pushing..."; \
	git tag -a "$$VERSION" -m "Beta release $$VERSION"; \
	git push origin "$$VERSION"; \
	echo "✓ Pushed tag $$VERSION. release.yml will publish the pre-release."

tag-stable:
	@set -e; \
	MANIFEST=manifest.json; \
	$(read_version); \
	$(require_clean_tree); \
	if git rev-parse "$$VERSION" >/dev/null 2>&1; then \
		echo "Tag $$VERSION already exists. Bump manifest.json first."; exit 1; \
	fi; \
	echo "→ Tagging $$VERSION and pushing..."; \
	git tag -a "$$VERSION" -m "Release $$VERSION"; \
	git push origin "$$VERSION"; \
	echo "✓ Pushed tag $$VERSION. release.yml will publish the release."

.PHONY: help zip clean build lint release-local sync-version tag-beta tag-stable
