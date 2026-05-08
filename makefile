zip:
	zip qmd-as-md.zip main.js manifest.json

clean:
	rm -rf node_modules dist build .cache *.log *.tmp package-lock.json

build:
	npm install && npm run build && make zip && make clean

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

release-beta:
	@VERSION=$$(node -p "require('./manifest-beta.json').version"); \
	if [ -z "$$VERSION" ]; then echo "Could not read version from manifest-beta.json"; exit 1; fi; \
	if gh release view $$VERSION >/dev/null 2>&1; then \
		echo "Release $$VERSION already exists. Bump manifest-beta.json first."; exit 1; \
	fi; \
	if [ -z "$(NOTES)" ]; then \
		read -p "Release notes [Beta release $$VERSION]: " INPUT_NOTES; \
		FINAL_NOTES="$${INPUT_NOTES:-Beta release $$VERSION}"; \
	else \
		FINAL_NOTES="$(NOTES)"; \
	fi; \
	echo "→ Building main.js..."; \
	npm install --silent && npm run build; \
	echo "→ Staging manifest-beta.json as the release's manifest.json..."; \
	cp manifest-beta.json /tmp/qmd-release-manifest.json; \
	echo "→ Creating GitHub pre-release $$VERSION..."; \
	gh release create $$VERSION \
		--title "$$VERSION (beta)" \
		--prerelease \
		--notes "$$FINAL_NOTES" \
		main.js "/tmp/qmd-release-manifest.json#manifest.json"; \
	rm /tmp/qmd-release-manifest.json; \
	echo "✓ Released $$VERSION (beta). BRAT users: 'Check for updates'."

release-stable:
	@VERSION=$$(node -p "require('./manifest.json').version"); \
	if [ -z "$$VERSION" ]; then echo "Could not read version from manifest.json"; exit 1; fi; \
	if gh release view $$VERSION >/dev/null 2>&1; then \
		echo "Release $$VERSION already exists. Bump manifest.json first."; exit 1; \
	fi; \
	if [ -z "$(NOTES)" ]; then \
		read -p "Release notes [Stable release $$VERSION]: " INPUT_NOTES; \
		FINAL_NOTES="$${INPUT_NOTES:-Stable release $$VERSION}"; \
	else \
		FINAL_NOTES="$(NOTES)"; \
	fi; \
	echo "→ Building main.js..."; \
	npm install --silent && npm run build; \
	echo "→ Creating GitHub release $$VERSION..."; \
	gh release create $$VERSION \
		--title "$$VERSION" \
		--notes "$$FINAL_NOTES" \
		main.js manifest.json; \
	echo "✓ Released $$VERSION (stable)."

.PHONY: zip clean build release-beta release-stable