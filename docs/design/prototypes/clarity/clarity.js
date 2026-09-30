/*
 * Clarity prototype, core script (see README.md and the catalogue at the top of clarity.css).
 *
 * What it does, in order:
 *  1. Reads the state from the URL query (?clarity=1&theme=dark&tabs=a&segment=a&shell=a&collections=a)
 *     and writes it onto <html> as classes: `clarity`, `clarity-<decision>-<a|b>`, and the theme
 *     (`dark` / `light`, with data-theme and color-scheme, the way the app does it). This runs in
 *     <head>, before first paint, so a proposal never flashes the current design first.
 *  2. On DOMContentLoaded, tags the shell (bar, rail, main) with cl-* hook classes and builds the
 *     proposal's extra shell markup (rail brand row, search field, queue / engines / account in the
 *     rail foot, the Engine switch, the new page title, pinned collections, the account menu).
 *     Everything it builds carries `.cl-new` and stays hidden unless html.clarity is set, so
 *     removing the class shows the captured page exactly as it was. Nothing captured is removed
 *     or moved; the originals are hidden by CSS in clarity mode.
 *  3. Listens for postMessage from the viewer ({type:'clarity-state', state}) so a switch in the
 *     viewer re-applies classes without reloading, and tells the viewer which screen it is on.
 *
 * Idempotent: running build() twice does nothing the second time (data-cl-built on <html>).
 */
(function () {
  'use strict'

  var DECISIONS = ['tabs', 'segment', 'shell', 'collections']
  var DEFAULTS = { clarity: '1', theme: 'dark', tabs: 'a', segment: 'a', shell: 'a', collections: 'a' }
  var root = document.documentElement
  var inFrame = window.parent && window.parent !== window
  var state = readQuery()
  // Not a decision: which pinned collection Games is showing (games.html?…&pin=1), so a pinned
  // row can be clicked and the rail and the bar both say "Collections › <name>".
  var pin = new URLSearchParams(location.search).get('pin') || ''

  function readQuery() {
    var p = new URLSearchParams(location.search)
    var s = {}
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = p.get(k)
      s[k] = v == null || v === '' ? DEFAULTS[k] : v
    })
    if (s.clarity === 'true' || s.clarity === 'on') s.clarity = '1'
    return s
  }

  function query(s) {
    return Object.keys(DEFAULTS)
      .map(function (k) {
        return k + '=' + encodeURIComponent(s[k])
      })
      .join('&')
  }

  function apply(s) {
    state = Object.assign({}, state, s)
    root.classList.toggle('clarity', state.clarity === '1')
    DECISIONS.forEach(function (d) {
      root.classList.remove('clarity-' + d + '-a', 'clarity-' + d + '-b')
      root.classList.add('clarity-' + d + '-' + (state[d] === 'b' ? 'b' : 'a'))
    })
    var theme = state.theme === 'light' ? 'light' : 'dark'
    root.classList.remove('dark', 'light')
    root.classList.add(theme)
    root.dataset.theme = theme
    root.style.colorScheme = theme
    syncAppearance()
    try {
      history.replaceState(null, '', location.pathname + '?' + query(state) + (pin ? '&pin=' + pin : '') + location.hash)
    } catch (e) {
      /* file:// in some browsers refuses replaceState; the state still applies */
    }
  }

  apply(state)

  /* ----------------------------------------------------------------- icons (lucide paths) */
  var ICON = {
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    chevronsUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    compass:
      '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
    languages:
      '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    palette:
      '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    keyboard:
      '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  }
  function svg(name, cls) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="' +
      (cls || '') +
      '">' +
      ICON[name] +
      '</svg>'
    )
  }
  function el(html) {
    var t = document.createElement('template')
    t.innerHTML = html.trim()
    return t.content.firstElementChild
  }
  function text(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : ''
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }
  function tag(node, cls) {
    if (node) cls.split(' ').forEach(function (c) { node.classList.add(c) })
    return node
  }

  /* ------------------------------------------------------------------------- the build */
  function build() {
    if (root.dataset.clBuilt) return
    var frame = document.querySelector('#root > div')
    if (!frame) return
    var header = frame.querySelector(':scope > header')
    var body = frame.querySelector(':scope > div')
    var nav = body && body.querySelector(':scope > nav[aria-label="Sections"]')
    var main = body && body.querySelector(':scope > main')
    if (!header || !nav || !main) return
    root.dataset.clBuilt = '1'
    var screen = (location.pathname.split('/').pop() || '').replace(/\.html$/, '')
    root.dataset.clScreen = screen

    tag(frame, 'cl-shell')
    tag(header, 'cl-bar')
    tag(body, 'cl-body')
    tag(nav, 'cl-rail')
    tag(main, 'cl-main')

    /* ---- the bar's captured children */
    var bar = {}
    Array.prototype.forEach.call(header.children, function (c) {
      var cls = c.className || ''
      if (c.matches('button[aria-label="Open the navigation"]')) bar.menu = tag(c, 'cl-bar-menu')
      else if (c.matches('a') && c.querySelector('img')) bar.brand = tag(c, 'cl-bar-brand')
      else if (c.matches('a[href*="blunderbase.org"]')) bar.demo = tag(c, 'cl-bar-demo')
      else if (/\bw-px\b/.test(cls) && /\bbg-line\b/.test(cls)) bar.sep = tag(c, 'cl-bar-sep')
      else if (/\bmin-w-0\b/.test(cls) && /\btext-data\b/.test(cls)) bar.crumbs = tag(c, 'cl-crumbs')
      else if (/\bml-2\b/.test(cls) && /\bflex-none\b/.test(cls)) bar.actions = tag(c, 'cl-actions')
      else if (cls === 'flex-1') bar.spacer = tag(c, 'cl-bar-spacer')
      else if (c.querySelector('[data-slot="tooltip-trigger"] [role="img"]')) bar.queue = tag(c, 'cl-queue')
      else if (c.matches('button[aria-label*="engine" i]')) bar.engine = tag(c, 'cl-engine-chip')
      else if (c.matches('[role="group"][aria-label="Theme"]')) bar.theme = tag(c, 'cl-theme')
      else if (c.matches('button[aria-label="Search everything"]')) bar.search = tag(c, 'cl-kbar-search')
      else if (c.matches('button[aria-label="Keyboard shortcuts"]')) bar.shortcuts = tag(c, 'cl-shortcuts')
      else if (c.querySelector('button[aria-haspopup="menu"]')) bar.account = tag(c, 'cl-account-orig')
    })
    if (bar.actions) {
      tag(bar.actions, 'cl-page-actions')
      if (bar.actions.children.length) header.classList.add('cl-has-actions')
    }

    /* ---- the rail's captured children */
    var rows = []
    var headingSeen = 0
    Array.prototype.forEach.call(nav.children, function (c) {
      var cls = c.className || ''
      if (/\buppercase\b/.test(cls)) {
        var t = text(c)
        if (/^engines$/i.test(t)) tag(c, 'cl-engines-heading')
        else tag(c, 'cl-nav-heading' + (headingSeen++ === 0 ? ' cl-nav-heading-first' : ''))
      } else if (c.matches('a') && /\btext-lead\b/.test(cls)) {
        tag(c, 'cl-nav-row')
        c.dataset.clName = text(c).replace(/[\d,]+$/, '').trim()
        rows.push(c)
      } else if (/\bml-3\b/.test(cls) && /\bborder-l\b/.test(cls)) {
        tag(c, 'cl-nav-fold')
        c.querySelectorAll('a').forEach(function (a) { tag(a, 'cl-nav-sub') })
        c.querySelectorAll(':scope > div.text-meta').forEach(function (d) { tag(d, 'cl-nav-fold-label') })
      } else if (/\bh-3\.5\b/.test(cls)) tag(c, 'cl-nav-gap')
      else if (cls === 'flex-1') tag(c, 'cl-nav-spacer')
      else if (/\bborder-t\b/.test(cls)) {
        tag(c, 'cl-rail-footer')
        var util = c.querySelector(':scope > div.flex')
        tag(util, 'cl-utility')
        tag(c.querySelector('button[aria-label*="navigation"]'), 'cl-fold-btn')
        tag(c.querySelector('[role="group"][aria-label="Theme"]'), 'cl-theme-phone')
        tag(c.querySelector('span.rounded-full[title]'), 'cl-conn-dot')
      } else if (c.matches('div') && /\btext-data\b/.test(cls)) tag(c, 'cl-engines-roster')
    })

    /* Location: one leaf lights. A lit sub-row (Import, a Stats report, a saved cut) is the leaf
       and its parent row goes plain; otherwise the lit top row is the leaf. "Lit" is what the
       capture drew as lit (bg-selected), not aria-current, which React Router sets on every
       sub-row of the current path. */
    var lit = function (a) { return /\bbg-selected\b/.test(a.className) }
    var leaf = null
    nav.querySelectorAll('.cl-nav-fold').forEach(function (fold) {
      var sub = Array.prototype.find.call(fold.querySelectorAll('.cl-nav-sub'), lit)
      if (sub) {
        leaf = sub
        var parent = fold.previousElementSibling
        if (parent && parent.classList.contains('cl-nav-row')) tag(parent, 'cl-parent')
      }
    })
    if (!leaf) leaf = rows.filter(lit)[0] || null
    if (leaf) tag(leaf, 'cl-current')

    /* ⌘1–⌘6 in the rail rows' titles (spec §2.1, Names) */
    var keys = { Dashboard: 1, Games: 2, Explorer: 3, Stats: 4, Notes: 5, Live: 6 }
    rows.forEach(function (r) {
      var k = keys[r.dataset.clName]
      if (k && !r.title) r.title = r.dataset.clName + ' ⌘' + k
    })

    /* The Explorer's "Your lines" rows open the Explorer at that line instead of jumping to Games */
    nav.querySelectorAll('.cl-nav-fold a[data-app-href^="/games?eco="]').forEach(function (a) {
      var eco = a.getAttribute('data-app-href').split('eco=')[1]
      a.dataset.clOrigHref = a.getAttribute('href')
      a.dataset.clLineHref = 'explorer.html'
      a.dataset.clLineApp = '/explorer?line=' + eco
    })

    buildPinned(nav, rows)
    var pinned = screen === 'games' && pin ? showPinned(nav, rows, pin) : null
    capFolds(nav)

    var data = readShellData(bar, nav)
    buildBar(header, bar, data, pinned)
    buildRail(nav, data, rows)
    buildAccountMenu(document.body, data)
    bindInteractions()
    syncAppearance()
  }

  function readShellData(bar, nav) {
    var acct = bar.account && bar.account.querySelector('button[aria-haspopup="menu"]')
    var label = acct ? acct.getAttribute('aria-label') || '' : ''
    var m = /—\s*(.+?)\s*·\s*(\S+)/.exec(label) || []
    var name = m[1] || 'Owner'
    var platform = m[2] || 'local'
    var initials = name
      .split(/\s+/)
      .map(function (w) { return w[0] })
      .join('')
      .slice(0, 2)
      .toUpperCase()
    var qw = bar.queue && bar.queue.querySelector('[data-slot="tooltip-trigger"]')
    var qState = qw ? text(qw.querySelector('span.text-label')) : 'Idle'
    var qCount = qw ? text(qw.querySelector('span.font-mono')) : '0/0'
    var qMeter = qw ? qw.querySelector('[role="img"]') : null
    var roster = nav.querySelector('.cl-engines-roster')
    var engines = roster ? text(roster) : ''
    return {
      name: name,
      platform: platform,
      initials: initials,
      queue: { state: qState || 'Idle', count: qCount || '0/0', meter: qMeter },
      engines: /no engines/i.test(engines) || !engines ? null : engines,
      demoTitle: bar.demo ? bar.demo.getAttribute('title') : '',
      logo: bar.brand ? bar.brand.querySelector('img').getAttribute('src') : '../assets/logo.png',
      brandHref: bar.brand ? bar.brand.getAttribute('href') : 'dashboard.html',
    }
  }

  /* ---- D4-A pinned collections. The demo library has none, so these are illustrative (the app
          shows nothing when there are none); their titles say so. Cap 2, or 1 when
          correspondence is on (it adds a rail row and a foot strip). */
  var PINNED = [
    ['League 2026', 'good', 14],
    ['Club OTB', 'otb', 32],
    ['Losses to review', 'blunder', 21],
  ]
  function buildPinned(nav, rows) {
    var coll = rows.filter(function (r) { return r.dataset.clName === 'Collections' })[0]
    if (!coll) return
    var corr = rows.some(function (r) { return r.dataset.clName === 'Correspondence' })
    var cap = corr ? 1 : 2
    var list = '<div class="cl-new cl-collections-a cl-pinned" aria-label="Pinned collections">'
    PINNED.slice(0, cap).forEach(function (c, i) {
      list +=
        '<a class="cl-nav-sub cl-pinned-row" href="games.html" data-cl-pin="' + (i + 1) + '" data-app-href="/games?collection=' +
        (i + 1) + '&amp;whose=all" title="' + esc(c[0]) + ' (sample collection: the demo library has none)">' +
        '<span class="cl-pinned-dot" data-color="' + c[1] + '"></span><span class="cl-pinned-name">' + esc(c[0]) +
        '</span><span class="cl-pinned-count">' + c[2] + '</span></a>'
    })
    list += '</div>'
    coll.parentNode.insertBefore(el(list), coll.nextSibling)
  }

  /* Games showing a pinned collection: the collection is where you are. Its row is the lit leaf,
     Collections is the plain parent, Games is not lit and its fold stays shut, and the bar says
     "Collections › <name>". The rail and the title give one answer. */
  function showPinned(nav, rows, n) {
    var row = nav.querySelector('.cl-pinned-row[data-cl-pin="' + n + '"]')
    if (!row || !root.classList.contains('clarity-collections-a')) return null
    rows.forEach(function (r) {
      if (r.dataset.clName === 'Games') {
        r.classList.remove('cl-current', 'cl-parent')
        var f = r.nextElementSibling
        if (f && f.classList.contains('cl-nav-fold')) f.classList.add('cl-fold-hidden')
      }
      if (r.dataset.clName === 'Collections') tag(r, 'cl-parent')
    })
    nav.querySelectorAll('.cl-current').forEach(function (c) { c.classList.remove('cl-current') })
    tag(row, 'cl-current')
    // the pinned row opens /games?collection=…&whose=all, so the Whose segment reads All
    // (only in the proposal: a switch of clarity reloads the page, see the message handler)
    if (root.classList.contains('clarity')) {
      var whose = document.querySelectorAll('[aria-label="Whose games"] > button')
      Array.prototype.forEach.call(whose, function (b, i) { b.setAttribute('aria-pressed', String(i === whose.length - 1)) })
    }
    var coll = rows.filter(function (r) { return r.dataset.clName === 'Collections' })[0]
    return {
      parent: { text: 'Collections', href: coll ? coll.getAttribute('href') : '#', app: '/collections' },
      name: text(row.querySelector('.cl-pinned-name')),
    }
  }

  /* A route fold shows at most four rows; the rest are behind "More ›" (to the parent page).
     The lit row is never hidden. Keeps the rail inside 1440x900 however many filters exist. */
  function capFolds(nav) {
    nav.querySelectorAll('.cl-nav-fold:not(.cl-pinned)').forEach(function (fold) {
      var links = fold.querySelectorAll('a')
      if (links.length <= 4) return
      Array.prototype.forEach.call(links, function (a, i) {
        if (i >= 4 && !a.classList.contains('cl-current')) (a.parentElement === fold ? a : a.parentElement).classList.add('cl-fold-extra')
      })
      var parent = fold.previousElementSibling
      fold.appendChild(
        el('<a class="cl-new cl-nav-sub cl-fold-more flex items-center gap-1.5 rounded-md px-1.5 py-[0.375rem] text-data" href="' +
          esc(parent ? parent.getAttribute('href') : '#') + '">More (' + (links.length - 4) + ')</a>'),
      )
    })
  }

  /* ---- bar: title, divider, Engine switch; D3-B globals */
  function buildBar(header, bar, data, pinned) {
    // The page title: the trail in text-data soft with › separators, the page's own name as a
    // text-heading title. Renames per spec §2.1 "Names".
    var parts = []
    if (bar.crumbs) {
      Array.prototype.forEach.call(bar.crumbs.children, function (c) {
        var t = text(c)
        if (t === '/' || t === '') return
        parts.push({
          text: t,
          href: c.matches('a') ? c.getAttribute('href') : null,
          app: c.getAttribute('data-app-href'),
          mono: /\bfont-mono\b/.test(c.className),
        })
      })
    }
    parts.forEach(function (p) {
      if (p.text === 'Library' && p.app === '/games') p.text = 'Games' // Chrome never calls Games "Library"
    })
    if (parts.length === 1 && parts[0].text === 'Overview') parts[0].text = 'Dashboard'
    var current = document.querySelector('.cl-nav-sub.cl-current')
    var parent = document.querySelector('.cl-nav-row.cl-parent')
    if (current && parent && parts.length === 1 && parts[0].text === parent.dataset.clName) {
      parts[0].href = parent.getAttribute('href')
      parts[0].app = parent.getAttribute('data-app-href')
      parts.push({ text: text(current).replace(/[\d,]+$/, '').trim() })
    }
    if (pinned) parts = [pinned.parent, { text: pinned.name }]
    // The trail holds only places: a crumb that goes nowhere (the game's date) is not a place and
    // leaves the trail (it belongs in the game's header line). So every crumb before the title
    // is a link, and the one crumb look can mean "link".
    parts = parts.filter(function (p, i) { return i === parts.length - 1 || !!p.href })
    // phone: a detail page leads with "‹ parent" instead of ☰ (a report of Stats is not a detail)
    if (parts.length > 1 && parts[0].text !== 'Stats') header.classList.add('cl-detail')
    var html = '<div class="cl-new cl-title" data-cl-parts="' + parts.length + '">'
    parts.forEach(function (p, i) {
      var last = i === parts.length - 1
      if (i > 0) html += '<span class="cl-title-sep" aria-hidden="true">' + svg('chevronRight') + '</span>'
      if (last) html += '<h1 class="cl-title-name">' + esc(p.text) + '</h1>'
      else if (p.href)
        html +=
          '<a class="cl-title-crumb' + (p.mono ? ' cl-mono' : '') + '" href="' + esc(p.href) + '"' +
          (p.app ? ' data-app-href="' + esc(p.app) + '"' : '') + '>' + esc(p.text) + '</a>'
      else html += '<span class="cl-title-crumb' + (p.mono ? ' cl-mono' : '') + '">' + esc(p.text) + '</span>'
    })
    html += '</div>'
    var title = el(html)
    header.insertBefore(title, bar.crumbs || bar.spacer || null)

    var divider = el('<div class="cl-new cl-bar-divider" aria-hidden="true"></div>')
    header.appendChild(divider)

    // D3-B: the queue as an unboxed readout in the bar
    var bq = queueReadout(data, 'cl-new cl-shell-b cl-bar-queue')
    header.appendChild(bq)

    // The engine switch (both variants), labelled with what it does: "Hide engine". Off is the
    // normal state (a grey track), so no accent sits in the bar all day; on is the unusual
    // spoiler-free mode and is the state that lights. "Hide" says it is about what you see, not
    // about stopping Stockfish.
    header.appendChild(
      el(
        '<button type="button" role="switch" aria-checked="false" class="cl-new cl-switch cl-engine-switch" ' +
          'title="Hide engine evaluations, lines and flags (⇧E)"><span class="cl-switch-label">Hide engine</span>' +
          '<span class="cl-switch-track"><span class="cl-switch-thumb"></span></span></button>',
      ),
    )

    // D3-B: search as a field-shaped button and the account as an initials disc
    header.appendChild(searchField('cl-new cl-shell-b cl-search-field cl-search-bar'))
    header.appendChild(
      el(
        '<button type="button" class="cl-new cl-shell-b cl-avatar-btn" aria-haspopup="menu" aria-expanded="false" data-cl-account aria-label="Account — ' +
          esc(data.name) + ' · ' + esc(data.platform) + '" title="' + esc(data.name) + ' · ' + esc(data.platform) +
          '"><span class="cl-avatar">' + esc(data.initials) + '</span></button>',
      ),
    )
  }

  // "Search everything", not "Search": a page's own filter field (Games, Notes) sits on the same
  // screen, and the two must not read as the same box. This one opens the palette.
  function searchField(cls) {
    return el(
      '<button type="button" class="' + cls + '" aria-label="Search everything" title="Search games, notes and pages (⌘K)">' +
        svg('search', 'cl-search-icon') +
        '<span class="cl-search-text">Search everything</span><kbd class="cl-search-kbd">⌘K</kbd></button>',
    )
  }

  function queueReadout(data, cls) {
    var q = data.queue
    var busy = !/^idle$/i.test(q.state) && !/^0\/0$/.test(q.count)
    var node = el(
      '<div class="' + cls + (busy ? ' is-busy' : ' is-idle') + '" title="The analysis queue: ' + esc(q.count) +
        ' running / queued"><span class="cl-q-state">' + (busy ? svg('loader', 'cl-q-spin') : '') + esc(q.state) +
        '</span><span class="cl-q-meter"></span><span class="cl-q-count">' + esc(q.count) + '</span></div>',
    )
    if (q.meter) node.querySelector('.cl-q-meter').appendChild(q.meter.cloneNode(true))
    return node
  }

  /* ---- rail: brand row, search, pinned collections, footer (queue, engines, account) */
  function buildRail(nav, data, rows) {
    var brand = el(
      '<div class="cl-new cl-shell-a cl-rail-brand"><a class="cl-rail-brand-link" href="' + esc(data.brandHref) +
        '" data-app-href="/"><img alt="" class="cl-rail-logo" src="' + esc(data.logo) +
        '"><span class="cl-rail-name">Blunderbase</span></a>' +
        '<a class="cl-demo" href="https://blunderbase.org" target="_blank" rel="noreferrer" title="' +
        esc(data.demoTitle || 'This is the public demo · read-only') + '">Demo' + svg('arrowUpRight', 'cl-demo-arrow') +
        '</a></div>',
    )
    nav.insertBefore(brand, nav.firstChild)
    nav.insertBefore(searchField('cl-new cl-shell-a cl-search-field cl-search-rail'), brand.nextSibling)

    var footer = nav.querySelector('.cl-rail-footer')
    if (!footer) return
    var util = footer.querySelector('.cl-utility')
    // 1. the status line: engines (a link to Compute › Engines) left, the queue readout right
    //    (D3-A only: in D3-B the queue is in the bar)
    var status = el(
      '<div class="cl-new cl-status-line"><a class="cl-engines-line" href="#" data-app-href="/compute/engines" ' +
        'title="Compute › Engines"><span class="cl-dot ' + (data.engines ? 'is-ok' : 'is-none') +
        '"></span><span class="cl-engines-text">' + esc(data.engines || 'No engines') + '</span>' +
        svg('chevronRight', 'cl-engines-chev') + '</a></div>',
    )
    status.appendChild(queueReadout(data, 'cl-shell-a cl-rail-queue'))
    footer.insertBefore(status, util)
    // 2. the account row: one line; the role and the platform are in the menu's head
    footer.insertBefore(
      el(
        '<button type="button" class="cl-new cl-shell-a cl-account-row" aria-haspopup="menu" aria-expanded="false" ' +
          'data-cl-account title="' + esc(data.name) + ' · ' + esc(data.platform) + ' · owner">' +
          '<span class="cl-avatar">' + esc(data.initials) + '</span><span class="cl-account-name">' + esc(data.name) +
          '</span>' + svg('chevronUp', 'cl-account-chev') + '</button>',
      ),
      util,
    )
  }

  /* ---- the account menu, now home to Appearance and Keyboard shortcuts (static, but the
          Appearance switch works: it changes this page's theme and tells the viewer) */
  function buildAccountMenu(body, data) {
    var seg = function (v, icon, label) {
      return (
        '<button type="button" role="radio" aria-checked="false" data-theme-value="' + v + '" class="cl-seg-item">' +
        svg(icon) + '<span>' + label + '</span></button>'
      )
    }
    var item = function (icon, label, extra) {
      return (
        '<button type="button" role="menuitem" class="cl-menu-item">' + svg(icon) + '<span class="cl-menu-label">' +
        label + '</span>' + (extra || '') + '</button>'
      )
    }
    var menu = el(
      '<div class="cl-new cl-account-menu" role="menu" aria-label="Account" hidden>' +
        '<div class="cl-menu-head"><span class="cl-avatar">' + esc(data.initials) + '</span><div class="cl-menu-who"><span class="cl-menu-name">' + esc(data.name) +
        '</span><span class="cl-menu-sub">' + esc(data.platform) + ' · owner</span></div><span class="cl-menu-count">2,000</span></div>' +
        '<div class="cl-menu-rule"></div>' +
        item('users', 'Connected accounts') +
        item('help', 'Manual') +
        item('compass', 'Show the tour again') +
        '<div class="cl-menu-rule"></div>' +
        '<div class="cl-menu-field"><span class="cl-menu-field-label">' + svg('palette') + 'Appearance</span>' +
        '<div class="cl-seg cl-seg-xs cl-appearance" role="radiogroup" aria-label="Appearance">' +
        seg('dark', 'moon', 'Dark') + seg('light', 'sun', 'Light') + seg('system', 'monitor', 'System') +
        '</div></div>' +
        '<div class="cl-menu-field"><span class="cl-menu-field-label">' + svg('languages') + 'Language</span>' +
        '<div class="cl-seg cl-seg-xs" role="radiogroup" aria-label="Language">' +
        '<button type="button" role="radio" aria-checked="true" class="cl-seg-item">English</button>' +
        '<button type="button" role="radio" aria-checked="false" class="cl-seg-item">Deutsch</button></div></div>' +
        '<div class="cl-menu-rule"></div>' +
        item('keyboard', 'Keyboard shortcuts', '<kbd class="cl-menu-kbd">?</kbd>') +
        '</div>',
    )
    body.appendChild(menu)
  }

  function syncAppearance() {
    var theme = root.classList.contains('light') ? 'light' : 'dark'
    document.querySelectorAll('.cl-appearance [data-theme-value]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.themeValue === theme))
    })
  }

  function openMenu(trigger) {
    var menu = document.querySelector('.cl-account-menu')
    if (!menu) return
    var open = menu.hidden
    document.querySelectorAll('[data-cl-account]').forEach(function (t) { t.setAttribute('aria-expanded', 'false') })
    menu.hidden = !open
    if (!open) return
    trigger.setAttribute('aria-expanded', 'true')
    var r = trigger.getBoundingClientRect()
    var rem = parseFloat(getComputedStyle(root).fontSize)
    menu.style.left = ''
    menu.style.right = ''
    menu.style.top = ''
    menu.style.bottom = ''
    if (trigger.classList.contains('cl-account-row')) {
      // in the rail foot: opens upward, aligned to the row
      menu.style.left = r.left + 'px'
      menu.style.bottom = window.innerHeight - r.top + 0.25 * rem + 'px'
    } else {
      menu.style.right = window.innerWidth - r.right + 'px'
      menu.style.top = r.bottom + 0.4375 * rem + 'px'
    }
  }

  function bindInteractions() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : e.target.parentElement
      var acct = t.closest('[data-cl-account]')
      if (acct && root.classList.contains('clarity')) {
        e.preventDefault()
        openMenu(acct)
        return
      }
      var themeBtn = t.closest('.cl-appearance [data-theme-value]')
      if (themeBtn) {
        var v = themeBtn.dataset.themeValue
        var resolved = v === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : v
        apply({ theme: resolved })
        if (inFrame) window.parent.postMessage({ type: 'clarity-theme', theme: resolved }, '*')
        return
      }
      var sw = t.closest('.cl-engine-switch')
      if (sw) {
        sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'))
        return
      }
      var menu = document.querySelector('.cl-account-menu')
      if (menu && !menu.hidden && !t.closest('.cl-account-menu')) openMenu(document.body) // closes
      // Links between captured screens keep the prototype state (clarity, theme, decisions).
      var a = t.closest('a[href]')
      if (a) {
        var href = a.getAttribute('href')
        if (root.classList.contains('clarity') && a.dataset.clLineHref) href = a.dataset.clLineHref
        if (/^[a-z-]+\.html(\?|#|$)/.test(href)) {
          e.preventDefault()
          var p = root.classList.contains('clarity') && a.dataset.clPin ? '&pin=' + a.dataset.clPin : ''
          location.href = href.split(/[?#]/)[0] + '?' + query(state) + p
        } else if (href === '#') e.preventDefault()
      }
    })
    document.addEventListener('keydown', function (e) {
      var t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (e.key === 'Escape') {
        var menu = document.querySelector('.cl-account-menu')
        if (menu && !menu.hidden) openMenu(document.body)
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        if (inFrame) window.parent.postMessage({ type: 'clarity-key', key: ' ' }, '*')
        else apply({ clarity: state.clarity === '1' ? '0' : '1' })
      } else if (inFrame && /^([1-7]|t|s)$/.test(e.key)) {
        // the viewer's other keys work while the screen has focus too
        window.parent.postMessage({ type: 'clarity-key', key: e.key }, '*')
      }
    })
  }

  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'clarity-state' && d.state) {
      // the pinned-collection location is built once; a switch that changes it rebuilds the page
      var rebuild = pin && root.dataset.clBuilt && (d.state.collections !== state.collections || d.state.clarity !== state.clarity)
      apply(d.state)
      if (rebuild) location.reload()
    }
  })

  function ready() {
    build()
    if (inFrame) {
      window.parent.postMessage(
        { type: 'clarity-screen', screen: root.dataset.clScreen || '', state: state },
        '*',
      )
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
  else ready()

  window.clarity = { apply: apply, state: function () { return Object.assign({}, state) } }
})()
