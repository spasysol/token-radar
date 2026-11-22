// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own breakdown and the farm plan,
// the live-token view, and the model lab. No network: every byte it shows is
// in data.js. The model lab runs the same arithmetic as lib/model.ts, so the
// page's code and the board's data are visibly the same formula.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('rows');
  if (!DATA || !app) return;

  var PAGE_SIZE = 25;
  var state = { q: '', category: 'all', scope: 'all', sort: 'implied', mintvl: 0, page: 1, selected: null };
  var lab = { gw: 0.6, mh: 730, bs: 0.03 };
  var DEFAULTS = { gw: 0.6, mh: 730, bs: 0.03 };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return 'x' + n.toFixed(2);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function catLabel(c) {
    return c === null || c === undefined ? 'Uncategorized' : c;
  }

  // ---- the model, again, in the page: same arithmetic as the program ----
  function labImplied(row) {
    var growthPct = Math.min(100, Math.max(-50, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (growthPct / 100) * lab.gw;
    var age = row.age_days === null ? 365 : row.age_days;
    var maturity = 0.7 + 0.3 * (1 - Math.exp(-Math.max(age, 0) / lab.mh));
    var extra = Math.min(Math.max(row.chains.length - 1, 0), 5);
    var breadth = 1 + lab.bs * extra;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growth * maturity * breadth));
  }
  function labActive() {
    return lab.gw !== DEFAULTS.gw || lab.mh !== DEFAULTS.mh || lab.bs !== DEFAULTS.bs;
  }

  // ---- header, model note ----
  function renderMeta() {
    var el = document.getElementById('meta');
    el.innerHTML =
      '<span class="chip">Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span class="chip"><b>' + DATA.board_size + '</b> ranked</span>' +
      '<span class="chip"><b>' + DATA.watchlist_size + '</b> watchlist</span>' +
      '<span class="chip"><b>' + DATA.early_size + '</b> early finds</span>' +
      '<span class="chip">Model <b>' + esc(DATA.model_version) + '</b></span>';
    var note = document.getElementById('model-note');
    note.innerHTML =
      '<p><b>How the value is built.</b> Implied value = TVL &times; the category&rsquo;s peer multiple ' +
      '(median market-cap/TVL of live-token protocols in the same category; global median ' +
      fmtMult(DATA.peer_global) + ' where the category has no live peer) &times; a growth factor from the ' +
      '7-day TVL change &times; a maturity factor from how long the protocol has run with no token &times; ' +
      'a breadth factor for the chains it runs on.</p>' +
      '<p class="muted">The board ranks every pre-token protocol the snapshot can rank &mdash; the 40-protocol ' +
      'watchlist at $50M TVL and above, plus ' + DATA.early_size + ' early finds below it. ' +
      'Move the constants in the model lab below and the board re-ranks with the same arithmetic.</p>';
  }

  // ---- categories ----
  function renderCategories() {
    var sel = document.getElementById('category');
    var cats = {};
    DATA.rows.forEach(function (r) { cats[catLabel(r.category)] = true; });
    var names = Object.keys(cats).sort();
    sel.innerHTML = '<option value="all">All categories</option>' +
      names.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  // ---- filtering, sorting, paging ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (state.category !== 'all' && catLabel(r.category) !== state.category) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var value = function (r) { return labActive() ? labImplied(r) : r.implied_value_usd; };
    var key;
    if (state.sort === 'tvl') key = function (r) { return r.tvl_usd; };
    else if (state.sort === 'growth') key = function (r) { return r.change_7d === null ? -Infinity : r.change_7d; };
    else if (state.sort === 'age') key = function (r) { return r.age_days === null ? -1 : r.age_days; };
    else key = value;
    rows.sort(function (a, b) {
      var d = key(b) - key(a);
      if (d !== 0) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return rows.map(function (r) { return { row: r, shown: value(r) }; });
  }

  function renderBoard() {
    var list = filteredRows();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);
    document.getElementById('count').textContent =
      list.length + ' protocol' + (list.length === 1 ? '' : 's') +
      (labActive() ? ' — re-ranked by the model lab' : '');
    if (slice.length === 0) {
      app.innerHTML = '<tr><td colspan="8"><div class="empty">No protocol matches this filter.</div></td></tr>';
    } else {
      app.innerHTML = slice.map(function (item) {
        var r = item.row;
        var g = r.change_7d;
        var gcls = g === null ? '' : g >= 0 ? 'up' : 'down';
        return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
          '<td class="rank' + (r.rank <= 3 ? ' top' : '') + '">' + r.rank + '</td>' +
          '<td><span class="pname">' + esc(r.name) + '</span>' +
          (r.watchlist ? ' <span class="star" title="On the watchlist">&#9733;</span>' : '') +
          '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
          '<td><span class="cat">' + esc(catLabel(r.category)) + '</span></td>' +
          '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
          '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
          '<td class="num ' + gcls + '">' + fmtPct(g) + '</td>' +
          '<td class="num">' + fmtAge(r.age_days) + '</td>' +
          '<td class="num implied">' + fmtUsd(item.shown) + '</td>' +
          '</tr>';
      }).join('');
    }
    document.getElementById('pageinfo').textContent = 'Page ' + state.page + ' of ' + pages;
    document.getElementById('prev').disabled = state.page <= 1;
    document.getElementById('next').disabled = state.page >= pages;
  }

  // ---- detail view ----
  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function renderDetail() {
    var box = document.getElementById('detail');
    var r = state.selected ? findRow(state.selected) : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var base = r.tvl_usd * r.peer_multiple;
    var shown = labActive() ? labImplied(r) : r.implied_value_usd;
    var growthPct = Math.min(100, Math.max(-50, r.change_7d === null ? 0 : r.change_7d));
    var peerNote = r.peer_source === 'category'
      ? 'median mcap/TVL of live-token ' + catLabel(r.category) + ' protocols'
      : 'global median mcap/TVL (no live peer in this category)';
    function factorRow(label, text, mult, width, warn) {
      return '<tr><td>' + label + '</td><td>' + text + '</td>' +
        '<td class="num">' + fmtMult(mult) + '</td>' +
        '<td><div class="bar"><i class="' + (warn ? 'warn' : '') + '" style="width:' + width + '%"></i></div></td></tr>';
    }
    box.hidden = false;
    box.innerHTML =
      '<h2>' + esc(r.name) + ' <span class="muted">#' + r.rank + '</span></h2>' +
      '<p class="dsub">' + esc(r.slug) + ' &middot; ' + esc(catLabel(r.category)) + ' &middot; ' +
      esc(r.chains.join(', ') || 'no chain listed') + ' &middot; records no token</p>' +
      '<div class="badges">' +
      (r.watchlist ? '<span class="badge hot">&#9733; On the watchlist</span>' : '<span class="badge">Early find</span>') +
      '<span class="badge">TVL ' + fmtUsd(r.tvl_usd) + '</span>' +
      '<span class="badge">7d ' + fmtPct(r.change_7d) + '</span>' +
      '<span class="badge">Age ' + fmtAge(r.age_days) + '</span>' +
      '</div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v accent">' + fmtUsd(shown) + '</div></div>' +
      '<div class="stat"><div class="k">Base (TVL &times; peer)</div><div class="v">' + fmtUsd(base) + '</div></div>' +
      '<div class="stat"><div class="k">Peer multiple</div><div class="v">' + fmtMult(r.peer_multiple) + '</div></div>' +
      '<div class="stat"><div class="k">Rank</div><div class="v">#' + r.rank + ' of ' + DATA.board_size + '</div></div>' +
      '</div>' +
      '<table class="factors"><thead><tr><th>Factor</th><th>Input</th><th class="num">Multiplier</th><th>Weight</th></tr></thead><tbody>' +
      factorRow('Peer multiple', esc(peerNote), r.peer_multiple, Math.min(100, r.peer_multiple / 2.5 * 100), false) +
      factorRow('Growth', '7-day change ' + fmtPct(r.change_7d) + ' (clamped ' + fmtPct(growthPct) + ')', r.growth_factor, Math.min(100, Math.max(0, (r.growth_factor - 0.7) / 0.9 * 100)), r.growth_factor < 1) +
      factorRow('Maturity', 'listed ' + fmtAge(r.age_days) + ' ago', r.maturity_factor, (r.maturity_factor - 0.7) / 0.3 * 100, false) +
      factorRow('Breadth', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), r.breadth_factor, (r.breadth_factor - 1) / 0.15 * 100, false) +
      '</tbody></table>' +
      '<h3>Farm plan — 7 steps</h3>' +
      '<ol class="plan">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="muted" style="margin-top:14px">This protocol records no token. A token may never be issued, and farming it earns nothing if none is.</p>';
  }

  // ---- live view ----
  function renderLive() {
    var el = document.getElementById('liverows');
    el.innerHTML = DATA.live.map(function (p) {
      return '<tr>' +
        '<td><span class="pname">' + esc(p.name) + '</span><br><span class="pslug">' + esc(p.slug) + '</span></td>' +
        '<td><span class="cat">' + esc(catLabel(p.category)) + '</span></td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="num">' + (p.mcap_tvl === null ? 'n/a' : fmtMult(p.mcap_tvl)) + '</td>' +
        '<td class="num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(p.change_7d) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ---- model lab ----
  function renderLab() {
    document.getElementById('gw-val').textContent = lab.gw.toFixed(2);
    document.getElementById('mh-val').textContent = String(lab.mh);
    document.getElementById('bs-val').textContent = lab.bs.toFixed(3);
    var st = document.getElementById('lab-state');
    if (labActive()) {
      st.textContent = 'Live — the board is re-ranked with growth weight ' + lab.gw.toFixed(2) +
        ', maturity horizon ' + lab.mh + ' days, breadth ' + lab.bs.toFixed(3) + ' per chain.';
      st.className = 'lab-state live';
    } else {
      st.textContent = 'Defaults — this is the submitted board.';
      st.className = 'lab-state';
    }
  }

  // ---- hash routing (deep links for the screenshots, and for readers) ----
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'detail' && v) state.selected = v;
      else if (k === 'category' && v) state.category = v;
      else if (k === 'scope' && (v === 'all' || v === 'watchlist' || v === 'early')) state.scope = v;
      else if (k === 'sort' && v) state.sort = v;
      else if (k === 'q' && v) state.q = v;
      else if (k === 'mintvl' && v) state.mintvl = Number(v) || 0;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.scope !== 'all') parts.push('scope=' + state.scope);
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.mintvl) parts.push('mintvl=' + state.mintvl);
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  // ---- wiring ----
  function bind() {
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var sort = document.getElementById('sort');
    var mintvl = document.getElementById('mintvl');
    q.addEventListener('input', function () { state.q = q.value; state.page = 1; renderBoard(); writeHash(); });
    cat.addEventListener('change', function () { state.category = cat.value; state.page = 1; renderBoard(); writeHash(); });
    sort.addEventListener('change', function () { state.sort = sort.value; state.page = 1; renderBoard(); writeHash(); });
    mintvl.addEventListener('change', function () { state.mintvl = Number(mintvl.value); state.page = 1; renderBoard(); writeHash(); });
    document.getElementById('scope').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-scope]');
      if (!b) return;
      state.scope = b.getAttribute('data-scope');
      document.querySelectorAll('#scope button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      state.page = 1;
      renderBoard();
      writeHash();
    });
    document.getElementById('prev').addEventListener('click', function () {
      if (state.page > 1) { state.page--; renderBoard(); }
    });
    document.getElementById('next').addEventListener('click', function () {
      state.page++; renderBoard();
    });
    app.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      state.selected = tr.getAttribute('data-slug');
      renderBoard();
      renderDetail();
      writeHash();
      document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    function labInput(key, id) {
      document.getElementById(id).addEventListener('input', function (e) {
        lab[key] = Number(e.target.value);
        state.page = 1;
        renderLab();
        renderBoard();
        if (state.selected) renderDetail();
      });
    }
    labInput('gw', 'gw');
    labInput('mh', 'mh');
    labInput('bs', 'bs');
    document.getElementById('lab-reset').addEventListener('click', function () {
      lab = { gw: DEFAULTS.gw, mh: DEFAULTS.mh, bs: DEFAULTS.bs };
      document.getElementById('gw').value = String(DEFAULTS.gw);
      document.getElementById('mh').value = String(DEFAULTS.mh);
      document.getElementById('bs').value = String(DEFAULTS.bs);
      renderLab();
      renderBoard();
      if (state.selected) renderDetail();
    });
  }

  // ---- boot ----
  readHash();
  renderMeta();
  renderCategories();
  document.getElementById('q').value = state.q;
  document.getElementById('category').value = state.category;
  document.getElementById('sort').value = state.sort;
  document.getElementById('mintvl').value = String(state.mintvl);
  document.querySelectorAll('#scope button').forEach(function (x) {
    x.classList.toggle('on', x.getAttribute('data-scope') === state.scope);
  });
  renderBoard();
  renderDetail();
  renderLive();
  renderLab();
  bind();
  if (state.selected) {
    var d = document.getElementById('detail');
    if (d && !d.hidden) d.scrollIntoView();
  }
  document.querySelector('main').setAttribute('aria-busy', 'false');
})();
