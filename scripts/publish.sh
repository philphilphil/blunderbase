#!/bin/sh
#
# Push the release `scripts/release.sh` cut, and open the GitHub release that ships it.
# Driven by `make publish`.
#
# This is the step that leaves the machine. Everything before it is local and reversible;
# publishing waits for main CI, then the release builds the image, moves `latest` and tells
# Komodo to pull. It is deliberately a separate command you run after looking at the tag.
#
# The release body is the changelog's section for this version, not the tag message —
# `--notes-from-tag` would publish "Blunderbase v0.3.0" and nothing else, and the notes
# are the one part of a release a person actually reads.
set -eu

die() {
	echo "publish: $*" >&2
	exit 1
}

# `## v0.3.0 — 2026-08-28` opens the section and the next `## ` closes it. Comparing the
# heading's second field rather than matching the whole line keeps the date out of it.
changelog_section() {
	awk -v want="$1" '
		# CHANGELOG.md is edited on Windows and checked out CRLF; a stray carriage
		# return would ride into the release body.
		{ sub(/\r$/, "") }
		/^## / { inside = ($2 == want); next }
		inside { line[++n] = $0 }
		END {
			first = 1
			last = n
			while (first <= n && line[first] ~ /^[[:space:]]*$/) first++
			while (last >= first && line[last] ~ /^[[:space:]]*$/) last--
			for (i = first; i <= last; i++) print line[i]
		}
	' CHANGELOG.md
}

# The desktop installers `make desktop` left under desktop/dist go up with the release,
# renamed to carry the version and the platform in one readable name — a file that says
# which Blunderbase it is once it is sitting in somebody's Downloads folder, and does not
# collide with the last one they kept. Nothing links a fixed name any more: the site's
# buttons go to the release page, because `releases/latest/download/<name>` can only
# redirect to a name known in advance, which a versioned one is not. The name is built
# from the tag, and the file it is built from is found by version, so a stale build from
# the last release cannot ride along under this release's name.
find_installer() {
	set -- "desktop/dist/$1/Blunderbase_${version}_$2"
	[ -f "$1" ] && echo "$1"
}

# Called once `version` is known, which is why the two names are set here and not at the
# top of the file: under `set -u` they would abort the script before the tag is read.
find_installers() {
	mac_asset="Blunderbase-${version}-macOS-arm64.dmg"
	win_asset="Blunderbase-${version}-Windows-x64-setup.exe"
	mac=$(find_installer mac aarch64.dmg || true)
	win=$(find_installer windows x64-setup.exe || true)
	if [ -z "$mac" ] || [ -z "$win" ]; then
		[ -n "${BB_SKIP_DESKTOP:-}" ] || die "desktop/dist has no $version installers for both platforms — run \`make desktop\` first, or BB_SKIP_DESKTOP=1 to release without them (the site's download section will have nothing to offer)"
	fi
}

upload_installers() {
	[ -n "$mac$win" ] || return 0
	stage=$(mktemp -d)
	[ -z "$mac" ] || cp "$mac" "$stage/$mac_asset"
	[ -z "$win" ] || cp "$win" "$stage/$win_asset"
	gh release upload "$tag" "$stage"/*
	rm -rf "$stage"
}

[ -z "$(git status --porcelain)" ] || die "the working tree is dirty; commit or stash first"

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || die "HEAD is on '$branch'; releases are published from main"

# One tag, on this commit, spelled the way `make release` spells them.
tag=$(git tag --points-at HEAD --list 'v*' | head -2)
case "$tag" in
"") die "HEAD carries no vX.Y.Z tag — run \`make release v=X.Y.Z\` first" ;;
*"
"*) die "HEAD carries more than one version tag: $(echo "$tag" | tr '\n' ' ')" ;;
esac
version="${tag#v}"
find_installers

notes=$(changelog_section "$tag")
[ -n "$notes" ] || die "CHANGELOG.md has no '## $tag' section — write the notes first"

# A prerelease publishes its image but must not move `latest`, and the workflow reads
# that from the release rather than from the tag's spelling.
prerelease=""
case "$version" in
*-*) prerelease="--prerelease" ;;
esac

if [ -n "${BB_DRY:-}" ]; then
	echo "publish: dry run for $tag — nothing pushed"
	echo "  git push origin main --follow-tags"
	echo "  wait for this commit's main CI to pass"
	echo "  gh release create $tag --title \"Blunderbase $tag\" $prerelease --notes-file -"
	[ -z "$mac" ] || echo "  gh release upload $tag $mac  (as $mac_asset)"
	[ -z "$win" ] || echo "  gh release upload $tag $win  (as $win_asset)"
	echo "  notes:"
	echo "$notes" | sed 's/^/    /'
	exit 0
fi

git push origin main --follow-tags

# The release workflow builds and deploys; it does not spend another pair of runners
# repeating the backend and web suites. Wait for the push workflow that already owns
# that proof before creating the release. A newly pushed run can take a moment to appear.
sha=$(git rev-parse HEAD)
run_id=""
attempt=0
while [ -z "$run_id" ] && [ "$attempt" -lt 30 ]; do
	run_id=$(gh run list --workflow=ci.yml --event=push --commit="$sha" --limit=1 \
		--json databaseId --jq '.[0].databaseId // empty')
	[ -n "$run_id" ] || sleep 2
	attempt=$((attempt + 1))
done
[ -n "$run_id" ] || die "main CI for $sha did not appear within 60 seconds"
echo "publish: waiting for main CI run $run_id"
gh run watch "$run_id" --exit-status || die "main CI failed; the release was not created"

# shellcheck disable=SC2086  # $prerelease is a flag or nothing, and must not be quoted.
printf '%s\n' "$notes" |
	gh release create "$tag" --title "Blunderbase $tag" $prerelease --notes-file -
upload_installers

echo "publish: $tag released. The release builds the image and Komodo pulls it — watch it with"
echo "  gh run watch \$(gh run list --workflow=release --limit=1 --json databaseId --jq '.[0].databaseId')"
