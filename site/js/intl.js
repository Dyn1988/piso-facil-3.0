/* Piso Fácil: Frete Internacional (Mercosul) e conversor Real/Dólar. Usa a interface window.PF criada em app.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var PF = window.PF;
  if (!PF) return;
  var sb = PF.sb, norm = PF.norm, brl = PF.brl, n1 = PF.n1, S = PF.S;

  var COUNTRIES = [["BR", "Brasil"], ["AR", "Argentina"], ["PY", "Paraguai"], ["UY", "Uruguai"], ["CL", "Chile"], ["BO", "Bolívia"]];
  var CNAME = {}; COUNTRIES.forEach(function (c) { CNAME[c[0]] = c[1]; });
  var KIND = { ponte: "Ponte", passo: "Passo de montanha", terrestre: "Terrestre", represa: "Represa" };
  var usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
  var n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var n4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  var nIn = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  /* ---------- Abas principais ---------- */
  function selectTab(t) {
    var intl = t === "int";
    $("tabNat").hidden = intl; $("tabInt").hidden = !intl;
    $("mtNat").setAttribute("aria-selected", String(!intl)); $("mtInt").setAttribute("aria-selected", String(intl));
    PF.lset("pf_tab", t);
    if (intl) loadCrossings();
  }
  $("mtNat").onclick = function () { selectTab("nat"); };
  $("mtInt").onclick = function () { selectTab("int"); };

  /* ---------- Números no formato brasileiro ---------- */
  function parseBR(v) {
    var s = String(v == null ? "" : v).replace(/R\$|US\$|%|\s/g, "");
    if (!s) return null;
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  /* ---------- Estado ---------- */
  var st = { oc: "BR", dc: "AR", origin: null, dest: null, pathIdx: 0, chosen: [] };
  var CX = null, cxLoading = false, paths = [], route = null, routeSeq = 0, last = "";

  /* ---------- Países ---------- */
  function fillCountries() {
    ["iOc", "iDc"].forEach(function (id) {
      var el = $(id); el.innerHTML = "";
      COUNTRIES.forEach(function (c) { var o = document.createElement("option"); o.value = c[0]; o.textContent = c[1]; el.appendChild(o); });
    });
    $("iOc").value = st.oc; $("iDc").value = st.dc;
  }
  function resetCity(which) {
    st[which] = null; $(which === "origin" ? "iOrigin" : "iDest").value = "";
  }
  $("iOc").onchange = function () { st.oc = $("iOc").value; resetCity("origin"); onRouteInputs(); };
  $("iDc").onchange = function () { st.dc = $("iDc").value; resetCity("dest"); onRouteInputs(); };
  $("iSwap").onclick = function () {
    var c = st.oc; st.oc = st.dc; st.dc = c;
    var t = st.origin; st.origin = st.dest; st.dest = t;
    $("iOc").value = st.oc; $("iDc").value = st.dc;
    $("iOrigin").value = st.origin ? label(st.origin) : ""; $("iDest").value = st.dest ? label(st.dest) : "";
    onRouteInputs();
  };

  /* ---------- Cidades ---------- */
  function label(c) { return c.name + " – " + c.admin; }
  var CITY_COLS = "code,name,admin,lat,lng,country,population";
  async function searchCities(raw, country) {
    var q = norm(raw).replace(/[%_\\,()]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length < 2) return [];
    var r1 = await sb.from("cities").select(CITY_COLS).eq("country", country).like("search", q + "%").order("population", { ascending: false, nullsFirst: false }).limit(8);
    if (r1.error) throw r1.error;
    var rows = r1.data || [];
    if (rows.length < 8) {
      var r2 = await sb.from("cities").select(CITY_COLS).eq("country", country).like("search", "%" + q + "%").order("population", { ascending: false, nullsFirst: false }).limit(24);
      if (r2.error) throw r2.error;
      var seen = {}; rows.forEach(function (c) { seen[c.code] = 1; });
      (r2.data || []).forEach(function (c) { if (rows.length < 8 && !seen[c.code]) { seen[c.code] = 1; rows.push(c); } });
    }
    return rows;
  }
  function setupCombo(id, which) {
    var inp = $(id), ul = $(id + "-list"), act = -1, items = [], timer = null, seq = 0;
    function country() { return which === "origin" ? st.oc : st.dc; }
    function close() { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); act = -1; }
    function note(t) { ul.innerHTML = ""; var li = document.createElement("li"); li.className = "none"; li.textContent = t; ul.appendChild(li); ul.hidden = false; inp.setAttribute("aria-expanded", "true"); }
    function pick(c) { st[which] = c; inp.value = label(c); close(); onRouteInputs(); }
    function render() {
      ul.innerHTML = "";
      items.forEach(function (c, i) {
        var li = document.createElement("li"); li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === act);
        li.innerHTML = "<span></span><small></small>"; li.firstChild.textContent = c.name; li.lastChild.textContent = c.admin;
        li.addEventListener("mousedown", function (e) { e.preventDefault(); pick(c); });
        ul.appendChild(li);
      });
      ul.hidden = false; inp.setAttribute("aria-expanded", "true");
    }
    function run() {
      var q = inp.value; if (norm(q).length < 2) { note("Digite pelo menos 2 letras."); return; }
      var my = ++seq; note("Buscando…");
      searchCities(q, country()).then(function (rows) {
        if (my !== seq) return;
        items = rows; act = rows.length ? 0 : -1;
        if (!rows.length) note("Nenhuma cidade encontrada em " + CNAME[country()] + "."); else render();
      }, function () { if (my === seq) note("Não foi possível buscar as cidades. Tente de novo."); });
    }
    inp.addEventListener("focus", function () { inp.select(); if (!st[which]) note("Digite pelo menos 2 letras."); });
    inp.addEventListener("input", function () {
      st[which] = null; route = null; onRouteInputs(true);
      items = []; act = -1; seq++;
      if (norm(inp.value).length < 2) note("Digite pelo menos 2 letras."); else note("Buscando…");
      clearTimeout(timer); timer = setTimeout(run, 220);
    });
    inp.addEventListener("blur", function () { seq++; clearTimeout(timer); close(); inp.value = st[which] ? label(st[which]) : ""; });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) { act = Math.min(items.length - 1, act + 1); render(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) { act = Math.max(0, act - 1); render(); } }
      else if (e.key === "Enter") { if (!ul.hidden && items[act]) { e.preventDefault(); pick(items[act]); } }
      else if (e.key === "Escape") { close(); }
    });
  }
  setupCombo("iOrigin", "origin"); setupCombo("iDest", "dest");

  /* ---------- Aduanas ---------- */
  async function loadCrossings() {
    if (CX || cxLoading) return;
    cxLoading = true;
    var r = await sb.from("border_crossings").select("id,name,country_a,country_b,lat,lng,kind,use_via").order("name");
    cxLoading = false;
    if (r.error) { $("iCross").innerHTML = ""; var p = document.createElement("p"); p.className = "routemsg err"; p.textContent = "Não foi possível carregar as aduanas. Recarregue a página."; $("iCross").appendChild(p); return; }
    CX = (r.data || []).map(function (c) { c.country_a = String(c.country_a).trim(); c.country_b = String(c.country_b).trim(); return c; });
    onRouteInputs();
  }
  function hav(a, b) {
    var R = 6371, rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lng - a.lng) * rad;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /* Caminhos entre países usando só aduanas validadas: os de menor número de travessias. */
  function countryPaths(from, to) {
    var adj = {};
    CX.forEach(function (c) {
      (adj[c.country_a] = adj[c.country_a] || {})[c.country_b] = 1;
      (adj[c.country_b] = adj[c.country_b] || {})[c.country_a] = 1;
    });
    for (var maxHops = 1; maxHops <= 3; maxHops++) {
      var found = [];
      (function walk(path) {
        var cur = path[path.length - 1];
        if (path.length - 1 === maxHops) { if (cur === to) found.push(path.slice()); return; }
        Object.keys(adj[cur] || {}).forEach(function (nx) { if (path.indexOf(nx) < 0) { path.push(nx); walk(path); path.pop(); } });
      })([from]);
      if (found.length) return found;
    }
    return [];
  }
  function crossingsFor(a, b) {
    return CX.filter(function (c) { return (c.country_a === a && c.country_b === b) || (c.country_a === b && c.country_b === a); });
  }

  /* ---------- Rota ---------- */
  function onRouteInputs(typing) {
    route = null; routeSeq++;
    if (!typing) buildCross();
    recalc();
    if (!typing) fetchRoute();
  }
  function buildCross() {
    var box = $("iCross"); box.innerHTML = "";
    paths = []; st.chosen = [];
    $("iPathField").hidden = true;
    if (!CX) { loadCrossings(); return; }
    if (st.oc === st.dc) { addHint(box, "Escolha países diferentes para o frete internacional."); return; }
    paths = countryPaths(st.oc, st.dc);
    if (!paths.length) { addHint(box, "Não há aduana validada para ligar " + CNAME[st.oc] + " a " + CNAME[st.dc] + ". Você pode informar a distância manualmente."); return; }
    if (st.pathIdx >= paths.length) st.pathIdx = 0;
    var sp = $("iPath"); sp.innerHTML = "";
    paths.forEach(function (p, i) { var o = document.createElement("option"); o.value = i; o.textContent = p.map(function (c) { return CNAME[c]; }).join(" → "); sp.appendChild(o); });
    sp.value = String(st.pathIdx);
    $("iPathField").hidden = paths.length < 2;
    var path = paths[st.pathIdx];
    var prev = st.origin;
    for (var h = 0; h < path.length - 1; h++) {
      (function (h) {
        var list = crossingsFor(path[h], path[h + 1]), next = st.dest;
        list.forEach(function (c) { c._d = (prev && next) ? hav(prev, c) + hav(c, next) : 0; });
        if (prev && next) list.sort(function (a, b) { return a._d - b._d; });
        var f = document.createElement("div"); f.className = "field";
        var lb = document.createElement("label"); lb.htmlFor = "iCx" + h; lb.textContent = "Aduana: " + CNAME[path[h]] + " → " + CNAME[path[h + 1]];
        var sl = document.createElement("select"); sl.id = "iCx" + h;
        list.forEach(function (c, i) {
          var o = document.createElement("option"); o.value = c.id;
          o.textContent = c.name + " (" + (KIND[c.kind] || c.kind) + ")" + (i === 0 && prev && next && list.length > 1 ? " · sugerida" : "");
          sl.appendChild(o);
        });
        f.appendChild(lb); f.appendChild(sl);
        if (list.length > 1) { var hn = document.createElement("span"); hn.className = "hint"; hn.textContent = "Mostramos só as aduanas desse par de países, da que menos desvia para a que mais desvia. A marcada como sugerida tem o menor desvio estimado em linha reta; essa estimativa serve só para ordenar."; f.appendChild(hn); }
        box.appendChild(f);
        var ch = list[0]; st.chosen[h] = ch;
        prev = ch;
        sl.addEventListener("change", function () {
          st.chosen[h] = list.filter(function (c) { return String(c.id) === sl.value; })[0];
          route = null; routeSeq++; recalc(); fetchRoute();
        });
      })(h);
    }
  }
  function addHint(box, t) { var p = document.createElement("p"); p.className = "routemsg"; p.textContent = t; box.appendChild(p); }
  $("iPath").onchange = function () { st.pathIdx = +$("iPath").value; onRouteInputs(); };

  async function fetchRoute() {
    var my = ++routeSeq;
    if (!st.origin || !st.dest || !st.chosen.length || st.chosen.some(function (c) { return !c; })) { route = null; recalc(); return; }
    route = { status: "loading" }; recalc();
    var out;
    try {
      var r = await sb.functions.invoke("route", {
        body: {
          origin: { lat: st.origin.lat, lng: st.origin.lng }, destination: { lat: st.dest.lat, lng: st.dest.lng },
          via: st.chosen.filter(function (c) { return c.use_via !== false; }).map(function (c) { return { lat: c.lat, lng: c.lng }; })
        }
      });
      if (r.error) {
        var body = null;
        try { body = await r.error.context.json(); } catch (e) { /* sem corpo */ }
        if (body && body.code === "UNAUTHENTICATED") { out = { status: "error", message: "Sua sessão expirou. Entre novamente." }; PF.signOut(); }
        else out = { status: "error", message: (body && body.message) || "Não foi possível calcular a rota agora." };
      } else if (r.data && r.data.ok && r.data.confirmed !== false) {
        out = { status: "ok", km: r.data.km, source: r.data.source, vehicle: r.data.vehicle, attribution: r.data.attribution, warnings: r.data.warnings || [] };
      } else {
        out = { status: "error", message: (r.data && r.data.message) || "Não foi possível confirmar a rota por esta aduana." };
      }
    } catch (e) { out = { status: "error", message: "Sem conexão com o serviço de rotas." }; }
    if (my !== routeSeq) return;
    route = out; recalc();
  }

  /* ---------- Valores ---------- */
  function vals() {
    var vkm = parseBR($("iVkm").value), merc = parseBR($("iMerc").value), pct = parseBR($("iPct").value), man = parseBR($("iKmManual").value);
    return { vkm: vkm, merc: merc, pct: pct, man: man };
  }
  function saveVals() {
    var v = vals();
    if (v.vkm !== null && !isNaN(v.vkm)) S.intl_value_per_km = v.vkm; else if (v.vkm === null) S.intl_value_per_km = null;
    if (v.pct !== null && !isNaN(v.pct)) S.intl_advalorem_pct = v.pct; else if (v.pct === null) S.intl_advalorem_pct = null;
    PF.saveSettings();
  }
  ["iVkm", "iMerc", "iPct", "iKmManual"].forEach(function (id) {
    $(id).addEventListener("input", function () { if (id === "iVkm" || id === "iPct") saveVals(); recalc(); });
    $(id).addEventListener("blur", function () {
      var n = parseBR($(id).value);
      if (n !== null && !isNaN(n)) $(id).value = id === "iKmManual" ? n1.format(n) : (id === "iMerc" ? n2.format(n) : nIn.format(n));
    });
  });

  function recalc() {
    if ($("tabInt").hidden && !last && !CX) { /* ainda não aberta */ }
    var v = vals(), msg = [];
    ["vkm", "merc", "pct", "man"].forEach(function (k) { if (v[k] !== null && (isNaN(v[k]) || v[k] < 0)) msg.push(k); });
    var names = { vkm: "Valor por KM", merc: "Valor da mercadoria", pct: "Advalorem", man: "Distância manual" };
    $("iValMsg").textContent = msg.length ? "Confira o campo: " + msg.map(function (k) { return names[k]; }).join(", ") + ". Use apenas números, por exemplo 1.250,50." : "";
    var manual = v.man !== null && !isNaN(v.man) && v.man > 0;
    var d = manual ? { km: Math.round(v.man * 10) / 10, kind: "manual" } : (route && route.status === "ok" ? { km: route.km, kind: "route" } : null);
    $("iDist").textContent = d ? n1.format(d.km) + " km" : "—";
    var tag = $("iTag");
    if (d) { tag.hidden = false; tag.className = "tag" + (d.kind === "manual" ? " manual" : ""); tag.textContent = d.kind === "manual" ? "Informada manualmente" : (st.chosen.some(function (c) { return c && c.use_via === false; }) ? "Rota por rodovias, cidade a cidade" : "Rota por rodovias, via aduana"); } else tag.hidden = true;

    var rm = $("iRouteMsg"); rm.className = "routemsg"; rm.textContent = "";
    if (route && route.status === "loading") rm.innerHTML = '<span class="spin" aria-hidden="true"></span>Calculando a rota pela aduana…';
    else if (route && route.status === "error") { rm.className = "routemsg err"; rm.textContent = route.message + (manual ? "" : " Você pode informar a distância manualmente abaixo."); }
    else if (route && route.status === "ok") {
      var ms = [];
      if (manual) ms.push("Rota calculada: " + n1.format(route.km) + " km. O cálculo está usando o valor informado por você.");
      (route.warnings || []).forEach(function (w) { ms.push(w); });
      if (ms.length) { rm.innerHTML = ""; var ul = document.createElement("ul"); ms.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }); rm.appendChild(ul); }
    }
    $("iAttrib").textContent = (route && route.status === "ok") ? "Rota: " + route.source + ". " + route.attribution + "." + (route.vehicle === "carro" ? " A rota considera veículo de passeio; em caminhão o trajeto pode variar." : "") : "";

    var a = st.origin, b = st.dest, cxNames = st.chosen.filter(Boolean).map(function (c) { return c.name; });
    $("iRouteTxt").textContent = (a && b) ? label(a) + " (" + CNAME[st.oc] + ") → " + label(b) + " (" + CNAME[st.dc] + ")" : "Escolha origem e destino";
    var bd = $("iBd"), pl = $("iPill"), bad = msg.length > 0;
    var vkm = v.vkm !== null && !isNaN(v.vkm) ? v.vkm : null;
    if (!d || vkm === null || bad) {
      $("iTotal").textContent = "R$ 0,00"; bd.innerHTML = ""; last = ""; pl.className = "pill";
      pl.textContent = bad ? "Corrija os campos destacados" : !(a && b) ? "Falta escolher a rota" : (route && route.status === "loading") ? "Calculando a distância…" : !d ? "Sem distância para calcular" : "Informe o valor por km";
      return;
    }
    var merc = v.merc !== null && !isNaN(v.merc) ? v.merc : 0, pct = v.pct !== null && !isNaN(v.pct) ? v.pct : 0;
    var frete = r2(d.km * vkm), adv = r2(merc * (pct / 100)), total = r2(frete + adv);
    $("iTotal").textContent = brl.format(total);
    var rows = [["Origem", a ? label(a) + " (" + CNAME[st.oc] + ")" : "—"], ["Destino", b ? label(b) + " (" + CNAME[st.dc] + ")" : "—"]];
    if (cxNames.length && d.kind === "route") rows.push([cxNames.length > 1 ? "Aduanas" : "Aduana", cxNames.join(" + ")]);
    rows.push(["Distância (" + (d.kind === "manual" ? "informada manualmente" : "por rodovias") + ")", n1.format(d.km) + " km"],
      ["Valor por km", brl.format(vkm)], ["Frete (" + n1.format(d.km) + " × " + brl.format(vkm) + ")", brl.format(frete)],
      ["Valor da mercadoria", brl.format(merc)], ["Advalorem (%)", n2.format(pct) + "%"], ["Valor do Advalorem", brl.format(adv)], ["Total (frete + Advalorem)", brl.format(total)]);
    bd.innerHTML = rows.map(function (r, i) { return "<div" + (i === rows.length - 1 ? ' class="sum"' : "") + "><span></span><span></span></div>"; }).join("");
    Array.prototype.forEach.call(bd.children, function (el, i) { el.children[0].textContent = rows[i][0]; el.children[1].textContent = rows[i][1]; });
    pl.className = "pill" + (d.kind === "manual" ? "" : " ok");
    pl.textContent = d.kind === "manual" ? "Distância informada por você. Confira antes de fechar o frete." : (st.chosen.some(function (c) { return c && c.use_via === false; }) ? "Rota por rodovias de cidade a cidade" : "Rota calculada passando pela aduana escolhida");
    last = "Frete internacional\n" + rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n");
  }
  $("iCopy").onclick = function () {
    var t = $("iToast"); if (!last) { t.textContent = "Complete a rota e os valores para copiar."; return; }
    function fb() { var ta = document.createElement("textarea"); ta.value = last; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* ignora */ } document.body.removeChild(ta); t.textContent = ok ? "Resumo copiado." : "Não foi possível copiar. Selecione o texto manualmente."; }
    try { navigator.clipboard.writeText(last).then(function () { t.textContent = "Resumo copiado."; }, fb); } catch (e) { fb(); }
    setTimeout(function () { t.textContent = ""; }, 3000);
  };

  /* ---------- Conversor Real / Dólar (PTAX compra, Banco Central) ---------- */
  var quotes = {};
  function today() { var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); }
  function brDate(iso) { return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4); }
  async function getQuote(date) {
    if (quotes[date]) return quotes[date];
    var r = await sb.functions.invoke("ptax", { body: { date: date } });
    if (r.error) {
      var body = null;
      try { body = await r.error.context.json(); } catch (e) { /* sem corpo */ }
      if (body && body.code === "UNAUTHENTICATED") { PF.signOut(); throw new Error("Sua sessão expirou. Entre novamente."); }
      throw new Error((body && body.message) || "Não foi possível consultar a cotação do Banco Central agora.");
    }
    if (!r.data || !r.data.ok) throw new Error((r.data && r.data.message) || "Não foi possível consultar a cotação do Banco Central agora.");
    quotes[date] = r.data; return r.data;
  }
  async function convert(dir) {
    var out = $("cOut"), date = $("cDate").value; out.innerHTML = "";
    function err(t) { out.innerHTML = ""; var p = document.createElement("div"); p.className = "err"; p.textContent = t; out.appendChild(p); }
    if (!date) { err("Escolha a data da cotação."); return; }
    var src = parseBR(dir === "brl" ? $("cBrl").value : $("cUsd").value);
    if (src === null || isNaN(src) || src < 0) { err("Digite um valor válido em " + (dir === "brl" ? "Real" : "Dólar") + ", por exemplo 1.250,50."); return; }
    $("cToUsd").disabled = $("cToBrl").disabled = true;
    out.innerHTML = '<span><span class="spin" aria-hidden="true"></span>Consultando o Banco Central…</span>';
    try {
      var q = await getQuote(date), rate = q.compra, res;
      if (dir === "brl") { res = r2(src / rate); $("cUsd").value = n2.format(res); $("cBrl").value = n2.format(src); }
      else { res = r2(src * rate); $("cBrl").value = n2.format(res); $("cUsd").value = n2.format(src); }
      out.innerHTML = "";
      if (q.fallback) { var w = document.createElement("div"); w.className = "warn"; w.textContent = "Não existe cotação publicada para a data selecionada. Utilizando a última cotação disponível no Banco Central: " + brDate(q.effectiveDate) + "."; out.appendChild(w); }
      var rb = document.createElement("div"); rb.className = "rate";
      var l1 = document.createElement("span"); l1.textContent = "Cotação utilizada (compra, PTAX)";
      var l2 = document.createElement("b"); l2.className = "num"; l2.textContent = "R$ " + n4.format(rate) + " por US$ 1,00";
      var l3 = document.createElement("span"); l3.textContent = "Data da cotação: " + brDate(q.effectiveDate);
      var l4 = document.createElement("span");
      l4.textContent = dir === "brl" ? brl.format(src) + " ÷ " + n4.format(rate) + " = " + usd.format(res) : usd.format(src) + " × " + n4.format(rate) + " = " + brl.format(res);
      rb.appendChild(l1); rb.appendChild(l2); rb.appendChild(l3); rb.appendChild(l4); out.appendChild(rb);
    } catch (e) { err(e.message || "Não foi possível consultar a cotação do Banco Central agora."); }
    $("cToUsd").disabled = $("cToBrl").disabled = false;
  }
  $("cToUsd").onclick = function () { convert("brl"); };
  $("cToBrl").onclick = function () { convert("usd"); };
  ["cBrl", "cUsd"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") convert(id === "cBrl" ? "brl" : "usd"); });
  });

  /* ---------- Início e fim da sessão ---------- */
  PF.onStart = function () {
    fillCountries();
    $("cDate").value = today();
    $("iVkm").value = S.intl_value_per_km == null ? "" : nIn.format(S.intl_value_per_km);
    $("iPct").value = S.intl_advalorem_pct == null ? "" : nIn.format(S.intl_advalorem_pct);
    buildCrossSafe();
    selectTab(PF.lget("pf_tab") === "int" ? "int" : "nat");
    recalc();
  };
  function buildCrossSafe() { if (CX) buildCross(); }
  PF.onStop = function () {
    CX = null; quotes = {}; route = null; routeSeq++; last = "";
    st.origin = null; st.dest = null; $("iOrigin").value = ""; $("iDest").value = "";
    $("iVkm").value = ""; $("iPct").value = ""; $("iMerc").value = ""; $("iKmManual").value = "";
    $("cBrl").value = ""; $("cUsd").value = ""; $("cOut").innerHTML = "";
    selectTab("nat");
  };
})();
