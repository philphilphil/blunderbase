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

# The download buttons link the installers by name, and the names carry the version
# (scripts/publish.sh uploads them that way), so the version has to be written into the
# page. It is read from pyproject.toml, the manifest `make release` moves, anchored to the
# [project] table because the file has other `version =` keys under other tables. The push
# of a release commit is what rebuilds the site, so the buttons move with the version.
version=$(perl -0ne 'print $1 if /\[project\][^\[]*\nversion = "([^"]*)"/' "$root/pyproject.toml")
[ -n "$version" ] || { echo "site: could not read the version from pyproject.toml" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out/assets" "$out/de"
sed "s/__BB_VERSION__/$version/g" "$root"/site/index.html > "$out"/index.html
cp "$root"/site/404.html "$root"/site/_redirects "$out"/
# The German page is a second copy of the page, not a template: `site/de/index.html` is
# translated by hand and served at /de/. It reaches the shared assets by absolute path.
sed "s/__BB_VERSION__/$version/g" "$root"/site/de/index.html > "$out"/de/index.html
# The privacy policy, one page per language, served at /privacy and /de/privacy: the App
# Store listing links the English one, and both are static copies with no version in them.
cp "$root"/site/privacy.html "$out"/privacy.html
cp "$root"/site/de/privacy.html "$out"/de/privacy.html
# The sample compose file the page links; the one under docker/ has no build block for
# exactly this reason.
cp "$root"/docker/docker-compose.yml "$out"/
cp "$root"/docs/screenshots/*.png "$out"/assets/
cp "$root"/docs/design/brand/logo.png "$root"/docs/design/brand/favicon.png \
   "$root"/docs/design/brand/apple-touch-icon.png "$out"/assets/

# The manual goes under /manual/ on the same host, built from the same mkdocs.yml the app's
# own copy is built from — one source, two places it is published.
#
# uv is what a developer and CI have; the Cloudflare Workers Builds image that publishes
# blunderbase.org has python3 and pip but no uv, which is the reason manual/requirements.txt
# is pinned separately from the `docs` dependency group. `--site-dir` is given as an absolute
# path because mkdocs resolves a relative one against the config file, not the caller.
manual_out="$(cd "$out" && pwd)/manual"
if command -v uv >/dev/null 2>&1; then
  uv run --project "$root" --group docs \
    mkdocs build --strict -f "$root/mkdocs.yml" --site-dir "$manual_out"
else
  # `--break-system-packages` is the retry for an image whose python is marked
  # externally managed (PEP 668); pip refuses the plain form there.
  python3 -m pip install --quiet -r "$root/manual/requirements.txt" \
    || python3 -m pip install --quiet --break-system-packages -r "$root/manual/requirements.txt"
  python3 -m mkdocs build --strict -f "$root/mkdocs.yml" --site-dir "$manual_out"
fi

echo "site assembled in $out"
