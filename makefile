.ONESHELL:
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

help:
	@echo "Targets:"
	@echo "  build           Install deps, build main.js, zip, then clean."
	@echo "  zip             Bundle main.js + manifest.json into qmd-as-md.zip."
	@echo "  clean           Remove node_modules, build artefacts, lockfile."
	@echo "  audit           npm audit — security advisories for current deps."
	@echo "  outdated        npm outdated — newer versions available upstream."
	@echo "  check-deps      Run both audit and outdated."
	@echo "  release-beta    Publish GitHub pre-release from manifest-beta.json."
	@echo "  release-stable  Publish GitHub release from manifest.json."

zip:
	zip qmd-as-md.zip main.js manifest.json

clean:
	rm -rf node_modules dist build .cache *.log *.tmp package-lock.json

build:
	npm install
	npm run build
	$(MAKE) zip
	$(MAKE) clean

# --- Dependency health ------------------------------------------------------

audit:
	npm install
	npm audit

outdated:
	npm install
	npm outdated || true   # exit 1 when something is outdated; not a failure

check-deps: audit outdated
	@echo "✓ Dependency check complete."

# --- Releases ---------------------------------------------------------------
# Publish a GitHub release whose assets BRAT (or the community store) reads.
#
#   make release-beta        # reads version from manifest-beta.json
#   make release-stable      # reads version from manifest.json
#
# Both targets prompt for release notes (Enter accepts the default).
# Override the prompt non-interactively:
#   make release-beta NOTES="Fixed re-render leaf bug"
#
# Requires: gh authenticated, node, working tree clean.

# Shared release helpers. Used by both release-beta and release-stable so
# tool checks, install, build, and main.js verification live in one place.

define preflight
	command -v gh >/dev/null || { echo "gh CLI not found. Install from https://cli.github.com"; exit 1; }
	command -v node >/dev/null || { echo "node not found"; exit 1; }
endef

# `npm ci` gives reproducible installs from package-lock.json. The lockfile
# is gitignored in this repo, so fall back to `npm install` when it is
# absent (e.g. fresh clone, or right after `make clean`).
define build_main_js
	echo "→ Building main.js..."
	if [ -f package-lock.json ]; then npm ci; else npm install; fi
	npm run build
	[ -f main.js ] || { echo "main.js not produced by build"; exit 1; }
endef

release-beta:
	$(preflight)
	VERSION=$$(node -p "require('./manifest-beta.json').version")
	if [ -z "$$VERSION" ]; then echo "Could not read version from manifest-beta.json"; exit 1; fi
	if gh release view $$VERSION >/dev/null 2>&1; then
		echo "Release $$VERSION already exists. Bump manifest-beta.json first."
		exit 1
	fi
	if [ -z "$(NOTES)" ]; then
		read -p "Release notes [Beta release $$VERSION]: " INPUT_NOTES || true
		FINAL_NOTES="$${INPUT_NOTES:-Beta release $$VERSION}"
	else
		FINAL_NOTES="$(NOTES)"
	fi
	$(build_main_js)
	echo "→ Staging manifest-beta.json as a file literally named manifest.json..."
	STAGE=$$(mktemp -d)
	cp manifest-beta.json $$STAGE/manifest.json
	echo "→ Creating GitHub pre-release $$VERSION..."
	gh release create $$VERSION \
		--title "$$VERSION (beta)" \
		--prerelease \
		--notes "$$FINAL_NOTES" \
		main.js $$STAGE/manifest.json
	rm -rf $$STAGE
	echo "✓ Released $$VERSION (beta). BRAT users: 'Check for updates'."

release-stable:
	$(preflight)
	VERSION=$$(node -p "require('./manifest.json').version")
	if [ -z "$$VERSION" ]; then echo "Could not read version from manifest.json"; exit 1; fi
	if gh release view $$VERSION >/dev/null 2>&1; then
		echo "Release $$VERSION already exists. Bump manifest.json first."
		exit 1
	fi
	if [ -z "$(NOTES)" ]; then
		read -p "Release notes [Stable release $$VERSION]: " INPUT_NOTES || true
		FINAL_NOTES="$${INPUT_NOTES:-Stable release $$VERSION}"
	else
		FINAL_NOTES="$(NOTES)"
	fi
	$(build_main_js)
	echo "→ Creating GitHub release $$VERSION..."
	gh release create $$VERSION \
		--title "$$VERSION" \
		--notes "$$FINAL_NOTES" \
		main.js manifest.json
	echo "✓ Released $$VERSION (stable)."

.PHONY: help zip clean build audit outdated check-deps release-beta release-stable
