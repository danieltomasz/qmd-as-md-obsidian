zip:
	zip qmd-as-md.zip main.js manifest.json

clean:
	rm -rf node_modules dist build .cache *.log *.tmp package-lock.json main.js

build:
	npm install && npm run build && make zip && make clean