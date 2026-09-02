# blunderbase.org

One static page, no build step. `index.html` is the whole site; the screenshots and the
brand assets are copied in from `docs/` by `scripts/site.sh`, so nothing here is kept twice.

```bash
make site                      # assembles site/dist — open site/dist/index.html
```

Pushing a change under `site/`, `docs/screenshots/` or `docs/design/brand/` to `main`
publishes it through `.github/workflows/site.yml` to GitHub Pages. That needs, once, in
the repository's settings:

- **Pages → Build and deployment → Source: GitHub Actions.**
- **Pages → Custom domain: `blunderbase.org`**, and "Enforce HTTPS" once the certificate
  is issued. The `CNAME` file beside this README is what keeps the domain across deploys.
- At the registrar: `A` records for the apex at GitHub Pages' four addresses
  (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`) and a `CNAME` from `www` to
  `philphilphil.github.io`. `demo.blunderbase.org` is not GitHub's — it is the demo
  container behind the owner's proxy (`docs/deploy.md`, "A public demo").

The page follows the app's design direction (`docs/design/README.md`): the same grey ramp
and muted-blue accent, chrome a shade apart from the canvas, screenshots framed as panes
rather than cards, and dark by default with light following the OS. It links to exactly
two places a visitor can go next, the demo and the repository, which is the brief.
