# Blunderbase — project instructions

## Changelog

`CHANGELOG.md` keeps one dense line per change, newest first, under `## Unreleased`.

- A line describes what the owner notices, not the commit: "reworked the game screen for a better layout", "fixed the server melting down when many analyses run". No scopes, no file names, no sub-bullets.
- Fold related commits into one line; leave out refactors and chores nobody would notice.
- Write the changelog only when the owner asks for a release, and by hand — no script touches it. Collect what shipped since the last tag into dense lines, put them under a `## vX.Y.Z — YYYY-MM-DD` heading (keep an empty `## Unreleased` above), commit that, then run `make release vX.Y.Z` (or `v=X.Y.Z`) to move the version and tag. Do not add entries commit-by-commit.
