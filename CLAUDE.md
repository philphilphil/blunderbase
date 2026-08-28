# Blunderbase — project instructions

## Changelog

`CHANGELOG.md` keeps one short line per change, newest first, under `## Unreleased`.

- Release-notes style. Every line starts with Added / Fixed / Changed / Removed and names the feature in a few words, under ten: "Added a clear button for the analysis queue", "Fixed the queue widget refreshing several times a second". No scopes, no file names, no sub-bullets, no explaining how it works. An upgrade step the owner must run may follow in parentheses.
- Fold related commits into one line; leave out refactors and chores nobody would notice.
- Write the changelog only when the owner asks for a release, and by hand — no script touches it. Collect what shipped since the last tag into short lines, put them under a `## vX.Y.Z — YYYY-MM-DD` heading (keep an empty `## Unreleased` above), commit that, then run `make release vX.Y.Z` (or `v=X.Y.Z`) to move the version and tag. Do not add entries commit-by-commit.
