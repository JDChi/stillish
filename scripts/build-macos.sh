#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
python -m PyInstaller --noconfirm --onefile --target-arch arm64 \
  --name stillish --paths src \
  --add-data "$PWD/src/stillish/licenses:stillish/licenses" \
  --specpath build --workpath build/pyinstaller \
  --distpath dist run_stillish.py
