#!/bin/sh
# Builds the editor for GitHub Pages and stamps the links so browsers load the new version.
# Needs esbuild: set ESBUILD to its path, or have it on PATH.
set -e
cd "$(dirname "$0")"
"${ESBUILD:-esbuild}" docs/main.ts --bundle --format=esm --outfile=docs/dist/main.js --log-level=warning
v=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s#\./studio\.css(\?v=[0-9]+)?#./studio.css?v=$v#; s#\./dist/main\.js(\?v=[0-9]+)?#./dist/main.js?v=$v#" docs/index.html
echo "built $v"
