#!/bin/sh
# Build the web UI, frozen backend, and native macOS bundles.
set -eu

desktop_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$desktop_dir/.." && pwd)
tauri_dir="$desktop_dir/src-tauri"
pyinstaller_dir="$desktop_dir/.pyinstaller"

cd "$repo_dir/web"
pnpm build

rm -rf "$pyinstaller_dir"
mkdir -p "$pyinstaller_dir/dist" "$pyinstaller_dir/work" "$pyinstaller_dir/spec"

cd "$repo_dir"
UV_CACHE_DIR="$repo_dir/.uv-desktop-cache" uv run --with pyinstaller pyinstaller \
  --noconfirm \
  --clean \
  --onedir \
  --noconsole \
  --name blunderbase-desktop \
  --paths "$repo_dir" \
  --collect-submodules backend \
  --add-data "$repo_dir/backend/migrations:backend/migrations" \
  --add-data "$repo_dir/web/dist:web/dist" \
  --distpath "$pyinstaller_dir/dist" \
  --workpath "$pyinstaller_dir/work" \
  --specpath "$pyinstaller_dir/spec" \
  "$desktop_dir/backend_entry.py"

cd "$desktop_dir"
pnpm exec tauri icon "$repo_dir/docs/design/brand/logo.png" --output "$tauri_dir/icons"
pnpm exec tauri build --bundles app,dmg

echo "Desktop bundles: $tauri_dir/target/release/bundle"
