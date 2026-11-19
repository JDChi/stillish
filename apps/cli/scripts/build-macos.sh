#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
bun build --compile --target=bun-darwin-arm64 \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  src/main.ts --outfile dist/stillish
