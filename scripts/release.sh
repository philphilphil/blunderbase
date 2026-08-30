#!/bin/sh
#
# Move the version, commit it, tag it. Driven by `make release` — see the Makefile for
# the two spellings of the argument; this script takes the resolved pieces.
#
#   BB_V    the version from `v=X.Y.Z`, empty if it was not given that way
#   BB_DRY  non-empty to say what would happen and stop
#   $@      the `vX.Y.Z` goals make swallowed, zero or one of them
#
# The number lives in the backend, web, and desktop package manifests. Their lockfiles
# restate it. Everything else reads one of those: the backend via importlib.metadata, the
# sidebar footer via Vite's `define`, and the native About dialog via Cargo.
#
# CHANGELOG.md is written by hand before cutting a version (see CLAUDE.md), not here.
#
# Nothing is pushed. The tag is a local claim until you look at it and push it, and the
# GitHub release — not the tag — is what ships the image and redeploys.
set -eu

die() {
	echo "release: $*" >&2
	exit 1
}

# `v=0.2.0` and `make release v0.2.0` both reach here; they may not disagree.
resolve_version() {
	version="${BB_V:-}"
	[ $# -le 1 ] || die "'$*' names more than one version"
	if [ $# -eq 1 ]; then
		goal="${1#v}"
		if [ -z "$version" ]; then
			version="$goal"
		elif [ "$version" != "$goal" ]; then
			die "v=$version and $1 disagree; give one version"
		fi
	fi

	[ -n "$version" ] || die "needs a version, e.g. make release v=0.2.0"
	case "$version" in
	v*) die "drop the leading v — make release v=${version#v}" ;;
	esac
	echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' \
		|| die "'$version' is not X.Y.Z (optionally X.Y.Z-suffix)"
}

# A release is a point on main that someone can check out again, so refuse anything else.
check_worktree() {
	branch=$(git rev-parse --abbrev-ref HEAD)
	[ "$branch" = "main" ] || die "HEAD is on '$branch'; releases are cut from main"
	[ -z "$(git status --porcelain)" ] || die "the working tree is dirty; commit or stash first"
	git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "$tag already exists"
	return 0
}

# Anchored to the `[project]` table: pyproject has other `version =` keys under other
# tables, and the first match in the file is not reliably the one we mean.
read_py_version() {
	perl -0ne 'print $1 if /\[project\][^\[]*\nversion = "([^"]*)"/' pyproject.toml
}

read_web_version() {
	perl -ne 'print($1), last if /^  "version": "([^"]*)"/' web/package.json
}

read_desktop_version() {
	perl -ne 'print($1), last if /^  "version": "([^"]*)"/' desktop/package.json
}

read_desktop_cargo_version() {
	perl -0ne 'print $1 if /\[package\][^\[]*\nversion = "([^"]*)"/' desktop/src-tauri/Cargo.toml
}

read_desktop_tauri_version() {
	perl -ne 'print($1), last if /^  "version": "([^"]*)"/' desktop/src-tauri/tauri.conf.json
}

read_desktop_lock_version() {
	perl -0ne 'print $1 if /\[\[package\]\]\nname = "blunderbase-desktop"\nversion = "([^"]*)"/' desktop/src-tauri/Cargo.lock
}

write_versions() {
	BB_VERSION="$version" perl -0pi \
		-e 's/(\[project\][^\[]*\nversion = ")[^"]*(")/$1$ENV{BB_VERSION}$2/' pyproject.toml
	BB_VERSION="$version" perl -pi \
		-e 's/^(  "version": ")[^"]*(")/$1$ENV{BB_VERSION}$2/' web/package.json
	BB_VERSION="$version" perl -pi \
		-e 's/^(  "version": ")[^"]*(")/$1$ENV{BB_VERSION}$2/' desktop/package.json
	BB_VERSION="$version" perl -0pi \
		-e 's/(\[package\][^\[]*\nversion = ")[^"]*(")/$1$ENV{BB_VERSION}$2/' desktop/src-tauri/Cargo.toml
	BB_VERSION="$version" perl -pi \
		-e 's/^(  "version": ")[^"]*(")/$1$ENV{BB_VERSION}$2/' desktop/src-tauri/tauri.conf.json
	BB_VERSION="$version" perl -0pi \
		-e 's/(\[\[package\]\]\nname = "blunderbase-desktop"\nversion = ")[^"]*(")/$1$ENV{BB_VERSION}$2/' desktop/src-tauri/Cargo.lock
	# A regex that silently matched nothing would otherwise tag an unmoved version.
	[ "$(read_py_version)" = "$version" ] || die "pyproject.toml's version key did not move"
	[ "$(read_web_version)" = "$version" ] || die "web/package.json's version key did not move"
	[ "$(read_desktop_version)" = "$version" ] || die "desktop/package.json's version key did not move"
	[ "$(read_desktop_cargo_version)" = "$version" ] || die "desktop/src-tauri/Cargo.toml's version key did not move"
	[ "$(read_desktop_tauri_version)" = "$version" ] || die "desktop/src-tauri/tauri.conf.json's version key did not move"
	[ "$(read_desktop_lock_version)" = "$version" ] || die "desktop/src-tauri/Cargo.lock's package version did not move"
	uv lock --quiet
}

resolve_version "$@"
tag="v$version"
check_worktree

was_py=$(read_py_version)
was_web=$(read_web_version)
was_desktop=$(read_desktop_version)
was_desktop_cargo=$(read_desktop_cargo_version)
was_desktop_tauri=$(read_desktop_tauri_version)
was_desktop_lock=$(read_desktop_lock_version)

if [ -n "${BB_DRY:-}" ]; then
	echo "release: dry run for $tag — nothing written"
	echo "  pyproject.toml    $was_py -> $version"
	echo "  web/package.json  $was_web -> $version"
	echo "  desktop/package.json           $was_desktop -> $version"
	echo "  desktop/src-tauri/Cargo.toml    $was_desktop_cargo -> $version"
	echo "  desktop/src-tauri/tauri.conf.json $was_desktop_tauri -> $version"
	echo "  desktop/src-tauri/Cargo.lock      $was_desktop_lock -> $version"
	echo "  uv.lock           relocked"
	echo "  git commit -m \"chore: release $tag\" && git tag -a $tag"
	exit 0
fi

write_versions
git add pyproject.toml web/package.json uv.lock desktop/package.json \
	desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock \
	desktop/src-tauri/tauri.conf.json
if git diff --cached --quiet; then
	echo "release: already at $version; tagging the commit that set it"
else
	git commit -q -m "chore: release $tag"
fi
git tag -a "$tag" -m "Blunderbase $tag"

cat <<EOF
release: $tag committed and tagged locally. Nothing has left the machine — look at it,
then ship it with

  make publish

which pushes the tag and opens the GitHub release. That release, not the tag, is what
builds the image and tells Komodo to pull.
EOF
