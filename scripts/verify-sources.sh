#!/usr/bin/env bash
# Checks that the AMO sources zip rebuilds the exact Firefox build, the way an AMO reviewer does it.
# Run after `pnpm zip:firefox`.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./package.json').version")
sources=".output/mrflow-${version}-sources.zip"
build=".output/firefox-mv3"

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

unzip -q "$sources" -d "$workdir"
(
  cd "$workdir"
  pnpm install --frozen-lockfile
  pnpm build:firefox
)

diff -r -q "$build" "$workdir/.output/firefox-mv3"
echo "OK: $sources rebuilds $build byte for byte"
