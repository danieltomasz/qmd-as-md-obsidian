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
command -v npm >/dev/null || { echo "npm not found"; exit 1; }; \
command -v zip >/dev/null || { echo "zip not found"; exit 1; }
endef

define build_main_js
echo "→ Building main.js..."; \
if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
npm run build; \
[ -f main.js ] || { echo "main.js not produced by build"; exit 1; }
endef

# Reads .version from the manifest in $$MANIFEST and exports VERSION.
# Surfaces the real node/JSON error: bash's `VAR=$(failing-cmd)` does
# NOT trip `set -e`, so without explicit capture a missing file or
# malformed JSON would silently leave VERSION empty and the caller
# would only see a generic message.
define read_version
[ -f "$$MANIFEST" ] || { echo "$$MANIFEST not found in $$(pwd). Run make from the repo root."; exit 1; }; \
VERSION=$$(node -p "require('./$$MANIFEST').version" 2>&1) || { echo "Failed to read version from $$MANIFEST:"; echo "$$VERSION"; exit 1; }; \
if [ -z "$$VERSION" ] || [ "$$VERSION" = "undefined" ]; then \
	echo "$$MANIFEST has no .version field"; exit 1; \
fi
endef

# --- Standard targets ------------------------------------------------------

zip:
	zip qmd-as-md.zip main.js manifest.json

clean:
	rm -rf node_modules dist build .cache *.log *.tmp

build:
	npm install && npm run build && $(MAKE) zip

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
	STAGE=$$(mktemp -d); \
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

.PHONY: zip clean build release-beta release-stable
