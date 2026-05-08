SHELL := /bin/bash

# macOS ships GNU Make 3.81, which predates .ONESHELL (3.82+). Recipes
# must be `\`-joined into a single shell invocation so set -e and
# variables propagate between lines.

# --- Shared macros ---------------------------------------------------------
# Each macro is a single `\`-joined shell fragment that ends without a
# trailing semicolon — the caller adds `;` and continues the chain.

define preflight
command -v gh >/dev/null || { echo "gh CLI not found. Install from https://cli.github.com"; exit 1; }; \
command -v node >/dev/null || { echo "node not found"; exit 1; }; \
command -v npm >/dev/null || { echo "npm not found"; exit 1; }
endef

define build_main_js
echo "→ Building main.js..."; \
if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
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

# --- Standard targets ------------------------------------------------------

help:
	@echo "Targets:"
	@echo "  build           Install deps, build main.js, then zip."
	@echo "  zip             Bundle main.js + manifest.json into qmd-as-md.zip."
	@echo "  clean           Remove node_modules and build artefacts."
	@echo "  release-beta    Publish GitHub pre-release from manifest-beta.json."
	@echo "  release-stable  Publish GitHub release from manifest.json."
	@echo ""
	@echo "Optional: NOTES=\"...\" passes non-interactive release notes."

zip:
	zip qmd-as-md.zip main.js manifest.json

clean:
	rm -rf node_modules dist build .cache *.log *.tmp

build:
	@set -e; \
	$(build_main_js); \
	$(MAKE) zip

# --- Releases --------------------------------------------------------------
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

release-beta:
	@set -e; \
	$(preflight); \
	MANIFEST=manifest-beta.json; \
	$(read_version); \
	if gh release view "$$VERSION" >/dev/null 2>&1; then \
		echo "Release $$VERSION already exists. Bump manifest-beta.json first."; exit 1; \
	fi; \
	if [ -z "$(NOTES)" ]; then \
		read -p "Release notes [Beta release $$VERSION]: " INPUT_NOTES || true; \
		FINAL_NOTES="$${INPUT_NOTES:-Beta release $$VERSION}"; \
	else \
		FINAL_NOTES="$(NOTES)"; \
	fi; \
	$(build_main_js); \
	echo "→ Staging manifest-beta.json as manifest.json..."; \
	STAGE=$$(mktemp -d -t qmd-as-md.XXXXXX); \
	cp manifest-beta.json "$$STAGE/manifest.json"; \
	echo "→ Creating GitHub pre-release $$VERSION..."; \
	gh release create "$$VERSION" \
		--title "$$VERSION (beta)" \
		--prerelease \
		--notes "$$FINAL_NOTES" \
		main.js "$$STAGE/manifest.json"; \
	rm -rf "$$STAGE"; \
	echo "✓ Released $$VERSION beta."

release-stable:
	@set -e; \
	$(preflight); \
	MANIFEST=manifest.json; \
	$(read_version); \
	if gh release view "$$VERSION" >/dev/null 2>&1; then \
		echo "Release $$VERSION already exists. Bump manifest.json first."; exit 1; \
	fi; \
	if [ -z "$(NOTES)" ]; then \
		read -p "Release notes [Stable release $$VERSION]: " INPUT_NOTES || true; \
		FINAL_NOTES="$${INPUT_NOTES:-Stable release $$VERSION}"; \
	else \
		FINAL_NOTES="$(NOTES)"; \
	fi; \
	$(build_main_js); \
	echo "→ Creating GitHub release $$VERSION..."; \
	gh release create "$$VERSION" \
		--title "$$VERSION" \
		--notes "$$FINAL_NOTES" \
		main.js manifest.json; \
	echo "✓ Released $$VERSION stable."

.PHONY: help zip clean build release-beta release-stable
