(function () {
  var data = window.__GRAPH__;
  if (!data || !window.cytoscape) return;

  var ORDER_LIST = ['frontend-page', 'frontend-hook', 'api-client', 'api-route', 'service', 'scheduler', 'ai', 'db-table', 'deploy'];
  var LAYER_LABEL = { 'frontend-page': 'Frontend', 'frontend-hook': 'Hooks', 'api-client': 'API-klient', 'api-route': 'Routes', service: 'Services', scheduler: 'Schedulers', ai: 'AI', 'db-table': 'Databas', deploy: 'Deploy' };
  var LAYER_HEX = { 'frontend-page': '#4a90d9', 'frontend-hook': '#4ec9b0', 'api-client': '#3aa0ff', 'api-route': '#2faa5a', service: '#a36bf0', scheduler: '#c77dff', ai: '#f0a35e', 'db-table': '#e0567a', deploy: '#6fcf97' };
  var DEAD_LAYERS = { 'frontend-hook': 1, 'api-client': 1, service: 1 };

  // ---- index över originalgrafen ----
  var nodeById = {};
  data.nodes.forEach(function (n) { n.domain = n.domain || 'övrigt'; nodeById[n.id] = n; });
  function groupOf(id) { var n = nodeById[id]; return 'grp:' + n.layer + '|' + n.domain; }
  var members = {};
  data.nodes.forEach(function (n) { var g = groupOf(n.id); (members[g] = members[g] || []).push(n.id); });
  // dödkod: inkommande grad 0 i originalgrafen, för utvalda lager
  var indeg = {}; data.nodes.forEach(function (n) { indeg[n.id] = 0; });
  data.edges.forEach(function (e) { if (indeg[e.target] != null) indeg[e.target]++; });
  function nodeDead(id) { var n = nodeById[id]; return DEAD_LAYERS[n.layer] && indeg[id] === 0; }

  var expanded = {}; // groupId -> true
  var hiddenLayers = {}; // layer -> true
  var direction = 'both', current = null;
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- bygg den visade (aggregerade) grafen ----
  function displayUnit(id) { var g = groupOf(id); return expanded[g] ? id : g; }
  function computeDisplay() {
    var units = {};
    data.nodes.forEach(function (n) {
      var u = displayUnit(n.id);
      if (u === n.id) {
        units[u] = { id: u, label: n.label, layer: n.layer, kind: 'node', loc: n.loc || n.file || '', description: n.description || '', feature: n.feature || '', domain: n.domain, dead: nodeDead(n.id) ? 1 : 0, group: groupOf(n.id) };
      } else if (!units[u]) {
        units[u] = { id: u, label: cap(n.domain), layer: n.layer, kind: 'group', domain: n.domain, count: 0, members: members[u].length };
      }
      if (units[u].kind === 'group') units[u].count++;
    });
    // grupp = dödkod om alla medlemmar är döda
    Object.keys(units).forEach(function (u) {
      var x = units[u];
      if (x.kind === 'group' && DEAD_LAYERS[x.layer]) x.dead = members[u].every(nodeDead) ? 1 : 0;
    });
    var eset = {}, edges = [];
    data.edges.forEach(function (e) {
      var a = displayUnit(e.source), b = displayUnit(e.target);
      if (a === b) return;
      var k = a + '>' + b; if (eset[k]) return; eset[k] = 1;
      edges.push({ id: 'e_' + a + '__' + b, source: a, target: b });
    });
    return { units: Object.keys(units).map(function (k) { return units[k]; }), edges: edges };
  }

  // ---- layout: lager vänster->höger, höga lager bryts i underkolumner ----
  var MAXROWS = 20, ROW_H = 40, SUBCOL_W = 220, BAND_GAP = 80, TOP = 50;
  function layout(units) {
    var byLayer = {};
    units.forEach(function (u) { (byLayer[u.layer] = byLayer[u.layer] || []).push(u); });
    Object.keys(byLayer).forEach(function (l) { byLayer[l].sort(function (a, b) { return a.label.localeCompare(b.label); }); });
    var positions = {}, headers = [], cursor = 0;
    ORDER_LIST.forEach(function (layer) {
      var list = byLayer[layer]; if (!list || !list.length) return;
      var subcols = Math.ceil(list.length / MAXROWS);
      list.forEach(function (u, i) {
        var sc = Math.floor(i / MAXROWS), row = i % MAXROWS;
        positions[u.id] = { x: cursor + sc * SUBCOL_W, y: TOP + row * ROW_H };
      });
      headers.push({ layer: layer, x: cursor + (subcols * SUBCOL_W - SUBCOL_W) / 2 });
      cursor += subcols * SUBCOL_W + BAND_GAP;
    });
    return { positions: positions, headers: headers };
  }

  // ---- cytoscape ----
  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: [],
    wheelSensitivity: 0.25, minZoom: 0.12, maxZoom: 3,
    style: [
      { selector: 'node[kind = "node"]', style: { 'background-color': function (n) { return LAYER_HEX[n.data('layer')] || '#999'; }, label: 'data(label)', 'font-size': 11, 'min-zoomed-font-size': 6, 'font-family': 'ui-monospace, monospace', color: '#dbe2ec', 'text-valign': 'center', 'text-halign': 'right', 'text-margin-x': 5, width: 12, height: 12 } },
      { selector: 'node[kind = "group"]', style: { 'background-color': function (n) { return LAYER_HEX[n.data('layer')] || '#999'; }, 'background-opacity': 0.22, 'border-width': 1.5, 'border-color': function (n) { return LAYER_HEX[n.data('layer')] || '#999'; }, shape: 'round-rectangle', label: function (n) { return '▸ ' + n.data('label') + '  ' + n.data('count'); }, 'font-size': 12, 'min-zoomed-font-size': 5, 'font-family': 'ui-monospace, monospace', 'font-weight': 'bold', color: '#eef2f7', 'text-valign': 'center', 'text-halign': 'center', width: 168, height: 26 } },
      { selector: 'node[dead = 1]', style: { 'border-width': 2, 'border-color': '#ffd166', 'border-style': 'dashed' } },
      { selector: 'node.hdr', style: { 'background-opacity': 0, label: 'data(label)', 'font-size': 13, 'min-zoomed-font-size': 5, 'font-weight': 'bold', color: function (n) { return LAYER_HEX[n.data('layer')] || '#aaa'; }, 'text-valign': 'center', 'text-halign': 'center', width: 1, height: 1, events: 'no' } },
      { selector: 'edge', style: { width: 1, 'line-color': '#3a4252', 'target-arrow-color': '#3a4252', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.6, opacity: 0.65 } },
      { selector: '.dim', style: { opacity: 0.06 } },
      { selector: 'node.down', style: { 'background-color': '#ff5470', 'border-color': '#ff5470', 'background-opacity': 1, color: '#ffd2da' } },
      { selector: 'edge.down', style: { 'line-color': '#ff5470', 'target-arrow-color': '#ff5470', width: 2, opacity: 1 } },
      { selector: 'node.up', style: { 'background-color': '#37d399', 'border-color': '#37d399', 'background-opacity': 1, color: '#bff3dc' } },
      { selector: 'edge.up', style: { 'line-color': '#37d399', 'target-arrow-color': '#37d399', width: 2, opacity: 1 } },
      { selector: 'node.focus', style: { 'background-color': '#ffffff', 'border-color': '#fff', 'background-opacity': 1, width: 18, height: 18, color: '#fff', 'font-weight': 'bold', 'font-size': 12 } },
    ],
  });
  window.__cy = cy;
  window.__impactApi = { highlight: highlight, reset: reset, render: render, expandAll: expandAll };

  var first = true;
  function render(keepView) {
    var pan = cy.pan(), zoom = cy.zoom();
    var d = computeDisplay();
    var lay = layout(d.units);
    var els = [];
    d.units.forEach(function (u) {
      els.push({ data: u, position: lay.positions[u.id] });
    });
    d.edges.forEach(function (e) { els.push({ data: e }); });
    lay.headers.forEach(function (h) {
      els.push({ data: { id: 'hdr:' + h.layer, label: (LAYER_LABEL[h.layer] || h.layer).toUpperCase(), layer: h.layer }, position: { x: h.x, y: TOP - 38 }, classes: 'hdr', selectable: false, grabbable: false });
    });
    cy.elements().remove();
    cy.add(els);
    Object.keys(hiddenLayers).forEach(function (l) { cy.nodes('[layer = "' + l + '"]').style('display', 'none'); });
    if (first) { cy.zoom(0.85); cy.pan({ x: 60, y: 70 }); first = false; }
    else if (keepView) { cy.zoom(zoom); cy.pan(pan); }
  }

  // ---- impact highlight på den VISADE grafen ----
  var panel = document.getElementById('panel');
  function reset() {
    cy.elements().removeClass('dim down up focus');
    current = null;
    panel.innerHTML = '<div class="placeholder">Klicka en <b>grupp</b> (▸) för att fälla ut den till filnivå. Klicka en <b>fil-nod</b> för att se vad den påverkar (rött) och vad som påverkar den (grönt). Gula streckade = möjlig dödkod.</div>';
  }
  function highlight(id, dir) {
    cy.elements().removeClass('dim down up focus');
    var start = cy.getElementById(id);
    if (start.empty()) return;
    cy.elements().not('.hdr').addClass('dim');
    start.removeClass('dim').addClass('focus');
    if (dir === 'down' || dir === 'both') walk(start, 'outgoers', 'down');
    if (dir === 'up' || dir === 'both') walk(start, 'incomers', 'up');
    showPanel(id);
  }
  function walk(start, fn, cls) {
    var frontier = start, seen = {}; seen[start.id()] = 1;
    while (frontier.length) {
      var nx = frontier[fn]('node').filter(function (n) { return !seen[n.id()] && !n.hasClass('hdr'); });
      frontier[fn]('edge').removeClass('dim').addClass(cls);
      nx.removeClass('dim').addClass(cls);
      nx.forEach(function (n) { seen[n.id()] = 1; });
      frontier = nx;
    }
  }
  function liA(arr) { return arr.length ? '<ul>' + arr.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '<div class="empty">– inget</div>'; }
  function showPanel(id) {
    var n = cy.getElementById(id), d = n.data();
    var out = n.outgoers('node').filter(function (x) { return !x.hasClass('hdr'); }).map(function (x) { return x.data('label'); });
    var inc = n.incomers('node').filter(function (x) { return !x.hasClass('hdr'); }).map(function (x) { return x.data('label'); });
    var head = d.kind === 'group'
      ? '<h2>' + cap(d.domain) + '</h2><div class="sub"><span class="dot" style="background:' + (LAYER_HEX[d.layer] || '#999') + '"></span>' + (LAYER_LABEL[d.layer] || d.layer) + ' · grupp (' + d.count + ' noder)</div><div class="desc">Klicka gruppen i kartan för att fälla ut den till filnivå.</div>'
      : '<h2>' + d.label + '</h2><div class="sub"><span class="dot" style="background:' + (LAYER_HEX[d.layer] || '#999') + '"></span>' + (LAYER_LABEL[d.layer] || d.layer) + (d.feature ? ' · ' + d.feature : '') + (d.dead ? ' · <span class="flag">⚠ möjlig dödkod</span>' : '') + '</div>' + (d.loc ? '<div class="loc">' + d.loc + '</div>' : '') + (d.description ? '<div class="desc">' + d.description + '</div>' : '');
    panel.innerHTML = head +
      '<div class="sec d">Direkt nedströms — påverkar (' + out.length + ')</div>' + liA(out) +
      '<div class="sec u">Direkt uppströms — påverkas av (' + inc.length + ')</div>' + liA(inc);
  }

  // ---- interaktioner ----
  cy.on('tap', 'node', function (e) {
    var n = e.target; if (n.hasClass('hdr')) return;
    if (n.data('kind') === 'group') { expanded[n.id()] = !expanded[n.id()]; render(true); reset(); }
    else { current = n.id(); highlight(current, direction); }
  });
  cy.on('tap', function (e) { if (e.target === cy) reset(); });

  document.getElementById('mode').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
    b.classList.add('on'); direction = b.getAttribute('data-m');
    if (current) highlight(current, direction);
  });

  document.getElementById('search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    if (!q) { reset(); return; }
    var hits = data.nodes.filter(function (n) { return n.label.toLowerCase().indexOf(q) >= 0; });
    hits.forEach(function (n) { expanded[groupOf(n.id)] = true; });
    render(true);
    var match = cy.nodes().filter(function (n) { return !n.hasClass('hdr') && n.data('kind') === 'node' && n.data('label').toLowerCase().indexOf(q) >= 0; });
    cy.elements().not('.hdr').addClass('dim');
    match.removeClass('dim').addClass('focus');
    if (match.length) cy.animate({ fit: { eles: match, padding: 90 } }, { duration: 300 });
  });

  var deadOn = false;
  document.getElementById('dead-btn').addEventListener('click', function () {
    deadOn = !deadOn; this.classList.toggle('on', deadOn);
    if (!deadOn) { reset(); return; }
    var deadIds = data.nodes.filter(function (n) { return nodeDead(n.id); }).map(function (n) { return n.id; });
    deadIds.forEach(function (id) { expanded[groupOf(id)] = true; });
    render(true);
    cy.elements().not('.hdr').addClass('dim');
    var sel = cy.collection();
    deadIds.forEach(function (id) { sel = sel.union(cy.getElementById(id)); });
    sel.removeClass('dim').addClass('focus');
    panel.innerHTML = '<h2>Möjlig dödkod</h2><div class="sub">Noder utan inkommande kopplingar</div>' + liA(deadIds.map(function (id) { return nodeById[id].label + ' <span style="color:#8b95a5">(' + (LAYER_LABEL[nodeById[id].layer] || nodeById[id].layer) + ')</span>'; }));
    if (sel.length) cy.animate({ fit: { eles: sel, padding: 60 } }, { duration: 300 });
  });

  function homeView() { cy.zoom(0.85); cy.pan({ x: 60, y: 70 }); }
  function expandAll() { data.nodes.forEach(function (n) { expanded[groupOf(n.id)] = true; }); render(true); }
  function collapseAll() { expanded = {}; render(true); reset(); homeView(); }
  document.getElementById('fit-btn').addEventListener('click', function () { reset(); homeView(); });
  document.getElementById('collapse-btn').addEventListener('click', collapseAll);

  // Lager-toggles
  var layersPresent = {}; data.nodes.forEach(function (n) { layersPresent[n.layer] = 1; });
  var layers = Object.keys(layersPresent).sort(function (a, b) { return ORDER_LIST.indexOf(a) - ORDER_LIST.indexOf(b); });
  var toggles = document.getElementById('layer-toggles');
  toggles.innerHTML = layers.map(function (l) { return '<label><span class="dot" style="background:' + (LAYER_HEX[l] || '#999') + '"></span><input type="checkbox" data-layer="' + l + '" checked />' + (LAYER_LABEL[l] || l) + '</label>'; }).join('');
  toggles.addEventListener('change', function (e) {
    var l = e.target.getAttribute('data-layer'); if (!l) return;
    if (e.target.checked) delete hiddenLayers[l]; else hiddenLayers[l] = 1;
    cy.nodes('[layer = "' + l + '"]').style('display', e.target.checked ? 'element' : 'none');
  });

  render();
  reset();
})();
