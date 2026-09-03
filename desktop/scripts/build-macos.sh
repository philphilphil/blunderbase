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

# The .dmg is copied out to sit beside the Windows installer `windows-ci.sh` collects, so a
# finished `make desktop` leaves both platforms together under desktop/dist instead of one
# there and one seven directories deep in the Rust target tree. Only the .dmg: the bundle
# directory also holds tauri's own bundle_dmg.sh and the generated icon, and dist/ is the
# place you go to find something to hand to somebody. The .app is left where it is built,
# which is where `open` wants it during development.
dist_dir="$desktop_dir/dist/mac"
rm -rf "$dist_dir"
mkdir -p "$dist_dir"
cp "$tauri_dir"/target/release/bundle/dmg/*.dmg "$dist_dir"

echo "macOS installer: $dist_dir"
echo "Desktop bundles: $tauri_dir/target/release/bundle"
