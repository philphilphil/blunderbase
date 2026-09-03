#!/bin/sh
# Drive the Windows installer build that runs in GitHub Actions, from this checkout.
#
# There is no cross-compilation path — the NSIS installer can only be produced on Windows —
# so the Windows half of a desktop build happens in the `desktop-windows` workflow. Dispatch
# and collect are separate subcommands so `make desktop` can start the run, build the macOS
# bundles while it is running, and only then wait: two builds that overlap instead of queue.
#
#   sh desktop/scripts/windows-ci.sh dispatch   # start the run, remember its id
#   sh desktop/scripts/windows-ci.sh collect    # wait for it, download the installer
#   sh desktop/scripts/windows-ci.sh            # both, back to back
#
# The workflow checks out a ref from the remote, so what it builds is what is pushed, not
# what is in the working tree. Dispatch refuses to run when HEAD is ahead of the remote
# branch rather than quietly shipping a macOS bundle and an installer from two commits.
# Set DESKTOP_WINDOWS_REF to build some other branch or tag and skip that check.
set -eu

workflow=desktop-windows.yml
artifact=Blunderbase-Windows-x64-unsigned

desktop_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH= cd -- "$desktop_dir/.." && pwd)
run_file="$desktop_dir/.windows-ci-run"
dest_dir="$desktop_dir/dist/windows"

cd "$repo_dir"

die() {
	echo "windows-ci: $*" >&2
	exit 1
}

latest_run_id() {
	gh run list --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId // empty'
}

require_gh() {
	command -v gh >/dev/null 2>&1 ||
		die "the GitHub CLI (gh) is not installed; build macOS alone with 'make desktop-macos'"
	gh auth status >/dev/null 2>&1 || die "gh is not signed in; run 'gh auth login'"
}

dispatch() {
	require_gh

	if [ -n "${DESKTOP_WINDOWS_REF:-}" ]; then
		ref=$DESKTOP_WINDOWS_REF
	else
		ref=$(git rev-parse --abbrev-ref HEAD)
		[ "$ref" != HEAD ] || die "HEAD is detached; check out a branch or set DESKTOP_WINDOWS_REF"
		git fetch --quiet origin "$ref" ||
			die "origin has no branch '$ref' — push it first, or set DESKTOP_WINDOWS_REF"
		[ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ] ||
			die "'$ref' differs from origin — push first so both halves build the same commit"
		[ -z "$(git status --porcelain)" ] ||
			echo "windows-ci: working tree is dirty; the installer builds from '$ref' as pushed" >&2
	fi

	before=$(latest_run_id)
	gh workflow run "$workflow" --ref "$ref"

	# The dispatch call returns before the run row exists, so wait for an id that is not the
	# one that was newest a moment ago.
	id=
	attempt=0
	while [ "$attempt" -lt 24 ]; do
		id=$(latest_run_id)
		if [ -n "$id" ] && [ "$id" != "$before" ]; then
			break
		fi
		id=
		attempt=$((attempt + 1))
		sleep 5
	done
	[ -n "$id" ] || die "dispatched '$workflow' on '$ref' but no run appeared; check GitHub Actions"

	printf '%s\n' "$id" >"$run_file"
	echo "windows-ci: building '$ref' — $(gh run view "$id" --json url --jq .url)"
}

collect() {
	require_gh
	[ -f "$run_file" ] || die "no dispatched run to collect; run 'sh desktop/scripts/windows-ci.sh dispatch'"
	id=$(cat "$run_file")

	gh run watch "$id" --exit-status

	rm -rf "$dest_dir"
	mkdir -p "$dest_dir"
	gh run download "$id" --name "$artifact" --dir "$dest_dir"
	rm -f "$run_file"

	echo "Windows installer: $dest_dir"
}

case "${1:-all}" in
dispatch) dispatch ;;
collect) collect ;;
all)
	dispatch
	collect
	;;
*) die "unknown command '$1'; expected dispatch, collect or no argument" ;;
esac
