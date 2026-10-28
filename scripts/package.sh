#!/usr/bin/env bash
# Copies the extension files into dist/extension and zips them into dist/mrflow-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")

rm -rf dist
mkdir -p dist/extension
cp manifest.json content_script.js styles.css popup.html popup.css popup.js dist/extension/
cp -r icons dist/extension/

(cd dist/extension && zip -qr "../mrflow-${version}.zip" .)
echo "dist/mrflow-${version}.zip"
