#!/bin/sh
# Build the web UI, frozen backend, and native macOS bundles.
#
# The manual is not built here: `make desktop-macos` builds it first (`make docs`), and the
# `--add-data` below freezes `manual-site/` into the bundle so `/manual/` works offline in
# the desktop app. `config.py` resolves `root` to the unpacked bundle directory, which is
# where PyInstaller puts both `web/dist` and `manual-site`.
set -eu

desktop_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$desktop_dir/.." && pwd)
tauri_dir="$desktop_dir/src-tauri"
pyinstaller_dir="$desktop_dir/.pyinstaller"

# Signing. A build downloaded from the internet is quarantined, and since Sequoia an
# unsigned quarantined app is refused as "damaged" rather than offered an override, so a
# public build has to be signed with a Developer ID certificate and notarized. The
# variables are tauri's own (APPLE_SIGNING_IDENTITY for the identity; APPLE_ID,
# APPLE_PASSWORD and APPLE_TEAM_ID, or an App Store Connect API key, for notarization),
# read from the environment or from desktop/.signing.env, which is ignored by git. Without
# them the build is ad-hoc signed and runs on the machine that built it, which is what
# development wants. desktop/README.md, "Signing", walks through the setup.
#
# tauri signs the shell, the frameworks and any sidecar, then notarizes and staples the
# bundle — but not the files it copies into Contents/Resources, which is where the frozen
# backend lives, and notarization rejects a bundle with one unsigned Mach-O inside. So
# PyInstaller signs its own output first, every collected library and the executable,
# with the hardened runtime and the backend's entitlements; tauri's signature of the
# bundle then seals them.
[ ! -f "$desktop_dir/.signing.env" ] || . "$desktop_dir/.signing.env"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  set -- --codesign-identity "$APPLE_SIGNING_IDENTITY" \
    --osx-entitlements-file "$desktop_dir/backend-entitlements.plist"
  echo "signing as $APPLE_SIGNING_IDENTITY"
  [ -n "${APPLE_ID:-}${APPLE_API_KEY:-}" ] || echo "no notarization credentials set; the build will be signed but not notarized" >&2
else
  set --
  echo "APPLE_SIGNING_IDENTITY is not set; the build is ad-hoc signed and only runs on this machine"
fi

cd "$repo_dir/web"
pnpm build

rm -rf "$pyinstaller_dir"
mkdir -p "$pyinstaller_dir/dist" "$pyinstaller_dir/work" "$pyinstaller_dir/spec"

cd "$repo_dir"
UV_CACHE_DIR="$repo_dir/.uv-desktop-cache" uv run --frozen --group desktop-build pyinstaller \
  --noconfirm \
  --clean \
  --onedir \
  --noconsole \
  --name blunderbase-desktop \
  --paths "$repo_dir" \
  --collect-submodules backend \
  --add-data "$repo_dir/backend/migrations:backend/migrations" \
  --add-data "$repo_dir/backend/data:backend/data" \
  --add-data "$repo_dir/web/dist:web/dist" \
  --add-data "$repo_dir/manual-site:manual-site" \
  --distpath "$pyinstaller_dir/dist" \
  --workpath "$pyinstaller_dir/work" \
  --specpath "$pyinstaller_dir/spec" \
  ${1+"$@"} \
  "$desktop_dir/backend_entry.py"

# Two things PyInstaller's signing leaves that notarization rejects, both in the
# Python.framework it assembles under _internal:
#
# - It signs the framework's binary as a bundle (the Info.plist beside it makes codesign
#   treat it as one) but never writes the bundle's _CodeSignature, so the signature
#   promises a resource seal that is not there — "The signature of the binary is invalid".
#   Signing the Versions/<n> directory ourselves writes the seal and verifies.
# - It links to the binary from outside the framework: `_internal/Python`, which the
#   bootloader opens, and inside it (Python -> Versions/Current/Python and so on). tauri's
#   resource copy follows symlinks, so each would become a bare copy of the binary carrying
#   a bundle signature, which is the same rejection again. The ones inside the framework go
#   — nothing loads through them, which the smoke test below proves. The bootloader's is
#   made a real file here and signed as a plain binary, six megabytes for a bundle that
#   passes.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  internal="$pyinstaller_dir/dist/blunderbase-desktop/_internal"
  find "$internal/Python.framework" -type l -delete
  for version in "$internal"/Python.framework/Versions/*; do
    codesign --force --timestamp --options runtime -s "$APPLE_SIGNING_IDENTITY" "$version"
    codesign --verify --strict "$version"
  done
  rm "$internal/Python"
  cp "$internal"/Python.framework/Versions/*/Python "$internal/Python"
  codesign --force --timestamp --options runtime -s "$APPLE_SIGNING_IDENTITY" "$internal/Python"
  codesign --verify --strict "$internal/Python"
fi

UV_CACHE_DIR="$repo_dir/.uv-desktop-cache" uv run python "$desktop_dir/scripts/smoke-backend.py" \
  "$pyinstaller_dir/dist/blunderbase-desktop/blunderbase-desktop"

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
