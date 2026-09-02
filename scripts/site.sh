#!/bin/sh
# Assemble the landing page into one directory that a static host can serve as-is.
#
# `site/` holds the page and nothing else; the screenshots and the brand assets live where
# the README and the app already keep them, so they are copied in here rather than kept
# twice. The same script builds `make site` for a look in a browser and the GitHub Pages
# artifact in `.github/workflows/site.yml`, which is what keeps the two identical.
#
#   sh scripts/site.sh [output-dir]      # defaults to site/dist
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/site/dist}"

rm -rf "$out"
mkdir -p "$out/assets"
cp "$root"/site/index.html "$root"/site/CNAME "$out"/
cp "$root"/docs/screenshots/*.png "$out"/assets/
cp "$root"/docs/design/brand/logo.png "$root"/docs/design/brand/favicon.png \
   "$root"/docs/design/brand/apple-touch-icon.png "$out"/assets/
# Tell GitHub Pages not to run the directory through Jekyll.
: > "$out/.nojekyll"

echo "site assembled in $out"
