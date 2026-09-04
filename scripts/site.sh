#!/bin/sh
# Assemble the landing page into one directory that a static host can serve as-is.
#
# `site/` holds the page and nothing else; the screenshots and the brand assets live where
# the README and the app already keep them, so they are copied in here rather than kept
# twice. The same script builds `make site` for a look in a browser and, as the build
# command of the Worker on Cloudflare, the directory wrangler deploys — which is what
# keeps the two identical.
# `site/wrangler.jsonc` points at the default output, so `cd site && npx wrangler dev`
# serves the result the way Cloudflare will.
#
#   sh scripts/site.sh [output-dir]      # defaults to site/dist
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/site/dist}"

rm -rf "$out"
mkdir -p "$out/assets"
cp "$root"/site/index.html "$root"/site/404.html "$out"/
# The sample compose file the page links; the one under docker/ has no build block for
# exactly this reason.
cp "$root"/docker/docker-compose.yml "$out"/
cp "$root"/docs/screenshots/*.png "$out"/assets/
cp "$root"/docs/design/brand/logo.png "$root"/docs/design/brand/favicon.png \
   "$root"/docs/design/brand/apple-touch-icon.png "$out"/assets/

echo "site assembled in $out"
