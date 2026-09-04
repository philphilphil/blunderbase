# blunderbase.org

One static page, no build step. `index.html` is the whole site (plus a `404.html`); the
screenshots and the brand assets are copied in from `docs/` by `scripts/site.sh`, so
nothing here is kept twice.

```bash
make site                      # assembles site/dist — open site/dist/index.html
cd site && npx wrangler dev    # or serve it the way Cloudflare will
```

## Hosting

The page is a Cloudflare Worker that serves static assets and nothing else
(`wrangler.jsonc`: an `assets` directory, no script). Cloudflare builds it itself: the
Worker `blunderbase-site` is connected to this repository through Workers Builds, and a
push to `main` that touches `site/`, `scripts/site.sh`, `docs/screenshots/` or
`docs/design/brand/` (the build's watch paths) assembles `site/dist` and deploys it. The
repository holds no token and no workflow for this. The settings, under the Worker's
**Settings → Build** in the dashboard:

| Setting | Value |
|---|---|
| Root directory | `/site` |
| Build command | `sh ../scripts/site.sh` |
| Deploy command | `npx wrangler deploy` |
| Watch paths | the four above |

One-time setup was the `blunderbase.org` zone on Cloudflare (nameservers at the
registrar pointed there) and connecting the repository. The custom domains in
`wrangler.jsonc` create their own DNS records on the first deploy.

`demo.blunderbase.org` is not the Worker's: it is the demo container behind the owner's
proxy (`docs/deploy.md`, "A public demo"), an unproxied A record on the zone pointing at
that server so the proxy there holds the certificate.

## Downloads

The download buttons point at
`github.com/philphilphil/blunderbase/releases/latest/download/Blunderbase-macOS-arm64.dmg`
and `…/Blunderbase-Windows-x64-setup.exe`. Those URLs redirect straight to the file, no
GitHub page in between, and they only work because `make publish` uploads the installers
under exactly those names on every release (`scripts/publish.sh`). The hero button picks
the platform from the user agent and falls back to the list under "Get it".

The page also links `https://blunderbase.org/docker-compose.yml`, which is
`docker/docker-compose.yml` copied in by `scripts/site.sh`. That file has no `build`
block for this reason.

## Screenshots

`docs/screenshots/` holds them all, one file per theme: `<name>-dark.png` and
`<name>-light.png`. The page shows the set that matches its theme (the switch in the
header, or the OS until one is chosen) and loads only that set.

| Name | What | Size |
|---|---|---|
| `game` | the game screen, hero image | 3840×2160 |
| `dashboard`, `explorer`, `stats`, `games` | the four in the "Around the library" grid | 3840×2160 |
| `ios-games`, `ios-game`, `ios-eval` | the companion: games list, game screen on Moves, on Eval | 1206×2622 |

The web screenshots are a 1920×1080 viewport at 2x, from Firefox's responsive design mode
on the demo library; the iOS ones are the iPhone 17 Pro simulator. The README shows
`game`, `dashboard`, `explorer` and `stats` through `<picture>`, dark or light with
GitHub's theme.

## Design

The page follows the app's design direction (`docs/design/README.md`): the same grey ramp
and muted-blue accent, chrome a shade apart from the canvas, screenshots framed as panes
rather than cards, dark by default with a light theme behind the switch in the header
(remembered per browser; the OS decides until it is pressed). The copy is the README's
feature list, reworded as little as possible, so the two do not drift apart.
