/* Piso Fácil: lógica do site. Autenticação, cidades e rota via Supabase; cálculo com js/antt.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var A = window.ANTT, cfg = window.PF_CONFIG;

  /* ---------- Utilidades ---------- */
  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var n4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  var n1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  function norm(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento local */ } }
  function show(view) { ["boot", "auth", "recover", "app"].forEach(function (v) { $(v).hidden = (v !== view); }); }
  function redirectUrl() { return location.origin + location.pathname; }

  if (!window.supabase || !window.supabase.createClient) {
    $("boot").textContent = "Não foi possível carregar o sistema. Verifique sua conexão e recarregue a página.";
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function errMsg(e) {
    var m = String((e && (e.message || e.error_description)) || ""), c = (e && (e.code || e.error_code)) || "", s = e && e.status;
    if (c === "invalid_credentials" || /invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (c === "email_not_confirmed" || /email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada.";
    if (c === "user_already_exists" || /already registered/i.test(m)) return "Este e-mail já tem conta. Use Entrar ou recupere a senha.";
    if (c === "weak_password" || /password should be/i.test(m)) return "Senha fraca. Use pelo menos 8 caracteres, com letras e números.";
    if (c === "same_password" || /different from the old/i.test(m)) return "A nova senha precisa ser diferente da anterior.";
    if (c === "over_email_send_rate_limit" || c === "over_request_rate_limit" || s === 429 || /rate limit/i.test(m)) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    if (c === "signup_disabled") return "O cadastro está desativado no momento.";
    if (/failed to fetch|network|load failed/i.test(m)) return "Sem conexão com o servidor. Verifique sua internet.";
    if (/jwt|session|not authenticated/i.test(m)) return "Sua sessão expirou. Entre novamente.";
    return "Não foi possível concluir. Tente novamente.";
  }

  /* ---------- Estado ---------- */
  var user = null, started = false, recovering = false;
  var S = { theme: null, cargo_index: 4, axles: 5, hire: "comp", high_performance: false, include_empty_return: false,
            intl_value_per_km: null, intl_advalorem_pct: null };
  var sel = { origin: null, dest: null };
  var route = null, routeSeq = 0, last = "";

  /* ---------- Tema ---------- */
  function applyTheme(t) {
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(lget("pf_theme"));
  $("themeBtn").onclick = function () {
    var cur = document.documentElement.getAttribute("data-theme");
    if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var nx = cur === "dark" ? "light" : "dark";
    S.theme = nx; applyTheme(nx); lset("pf_theme", nx); saveSettings();
  };

  /* ---------- Login, cadastro e recuperação de senha ---------- */
  var mode = "in";
  function clearMsgs() { $("aMsg").textContent = ""; $("aOk").textContent = ""; }
  function setMode(m) {
    mode = m; clearMsgs();
    var forgot = m === "forgot";
    $("authTabs").hidden = forgot;
    $("tabIn").setAttribute("aria-selected", m === "in"); $("tabUp").setAttribute("aria-selected", m === "up");
    $("nameField").hidden = m !== "up";
    $("passField").hidden = forgot;
    $("forgotTitle").hidden = !forgot; $("forgotHint").hidden = !forgot;
    $("forgotBtn").hidden = m !== "in"; $("backBtn").hidden = !forgot;
    $("aSubmit").textContent = m === "in" ? "Entrar" : m === "up" ? "Criar conta" : "Enviar link de recuperação";
    $("aPass").autocomplete = m === "in" ? "current-password" : "new-password";
  }
  $("tabIn").onclick = function () { setMode("in"); };
  $("tabUp").onclick = function () { setMode("up"); };
  $("forgotBtn").onclick = function () { setMode("forgot"); };
  $("backBtn").onclick = function () { setMode("in"); };

  $("authForm").addEventListener("submit", async function (ev) {
    ev.preventDefault(); clearMsgs();
    var email = $("aEmail").value.trim().toLowerCase(), pass = $("aPass").value, name = $("aName").value.trim(), btn = $("aSubmit");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("aMsg").textContent = "Digite um e-mail válido."; return; }
    if (mode === "up" && name.length < 2) { $("aMsg").textContent = "Digite seu nome."; return; }
    if (mode === "up" && pass.length < 8) { $("aMsg").textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
    if (mode === "in" && !pass) { $("aMsg").textContent = "Digite sua senha."; return; }
    btn.disabled = true;
    try {
      if (mode === "forgot") {
        var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (r.error) throw r.error;
        $("aOk").textContent = "Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também a caixa de spam.";
      } else if (mode === "up") {
        var u = await sb.auth.signUp({ email: email, password: pass, options: { data: { full_name: name }, emailRedirectTo: redirectUrl() } });
        if (u.error) throw u.error;
        if (u.data && u.data.user && u.data.user.identities && u.data.user.identities.length === 0) {
          $("aMsg").textContent = "Este e-mail já tem conta. Use Entrar ou recupere a senha.";
        } else if (!u.data.session) {
          setMode("in"); $("aEmail").value = email;
          $("aOk").textContent = "Enviamos um link de confirmação para " + email + ". Abra o e-mail e confirme para entrar.";
        }
      } else {
        var l = await sb.auth.signInWithPassword({ email: email, password: pass });
        if (l.error) throw l.error;
      }
    } catch (e) { $("aMsg").textContent = errMsg(e); }
    btn.disabled = false;
  });

  $("recoverForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var p1 = $("rPass").value, p2 = $("rPass2").value, msg = $("rMsg");
    msg.textContent = "";
    if (p1.length < 8) { msg.textContent = "A senha precisa ter pelo menos 8 caracteres."; return; }
    if (p1 !== p2) { msg.textContent = "As senhas não são iguais."; return; }
    $("rSubmit").disabled = true;
    try {
      var r = await sb.auth.updateUser({ password: p1 });
      if (r.error) throw r.error;
      recovering = false; $("rPass").value = ""; $("rPass2").value = "";
      try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignora */ }
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) startApp(s.data.session.user); else show("auth");
    } catch (e) { msg.textContent = errMsg(e); }
    $("rSubmit").disabled = false;
  });

  $("outBtn").onclick = function () { sb.auth.signOut(); };

  sb.auth.onAuthStateChange(function (event, session) {
    // Chamadas ao Supabase ficam fora do callback para evitar travamento da biblioteca.
    setTimeout(function () {
      if (event === "PASSWORD_RECOVERY") { recovering = true; show("recover"); return; }
      if (event === "SIGNED_OUT") { if (window.PF && window.PF.onStop) window.PF.onStop(); started = false; user = null; recovering = false; last = ""; show("auth"); setMode("in"); return; }
      if (session && !recovering && !started) startApp(session.user);
      else if (!session && !recovering && !started) show("auth");
    }, 0);
  });
  sb.auth.getSession().then(function (r) {
    if (recovering || started) return;
    if (r.data && r.data.session) startApp(r.data.session.user); else show("auth");
  });

  /* ---------- Configurações do usuário (salvas na nuvem) ---------- */
  var saveT = null;
  function saveSettings() {
    if (!user) return;
    clearTimeout(saveT);
    saveT = setTimeout(async function () {
      var row = { user_id: user.id, theme: S.theme, cargo_index: S.cargo_index, axles: S.axles, hire: S.hire,
                  high_performance: S.high_performance, include_empty_return: S.include_empty_return,
                  intl_value_per_km: S.intl_value_per_km, intl_advalorem_pct: S.intl_advalorem_pct };
      var r = await sb.from("user_settings").upsert(row, { onConflict: "user_id" });
      if (r.error) console.warn("Não foi possível salvar as configurações:", r.error.message);
    }, 700);
  }
  async function loadSettings() {
    var r = await sb.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
    if (r.error) { console.warn("Não foi possível carregar as configurações:", r.error.message); return; }
    if (r.data) {
      var d = r.data;
      S.theme = d.theme || lget("pf_theme") || null;
      S.cargo_index = d.cargo_index; S.axles = d.axles; S.hire = d.hire;
      S.high_performance = d.high_performance; S.include_empty_return = d.include_empty_return;
      S.intl_value_per_km = d.intl_value_per_km == null ? null : Number(d.intl_value_per_km);
      S.intl_advalorem_pct = d.intl_advalorem_pct == null ? null : Number(d.intl_advalorem_pct);
    }
  }

  /* ---------- Formulário de carga ---------- */
  A.CARGAS.forEach(function (n, i) { var o = document.createElement("option"); o.value = i; o.textContent = n; $("cargo").appendChild(o); });
  var AXNAME = { 2: "Toco", 3: "Truck", 4: "Bitruck", 5: "Carreta", 6: "Carreta 6 eixos", 7: "Bitrem", 9: "Rodotrem" };
  function tabKey() {
    var veh = S.hire === "veh", hp = S.high_performance;
    return veh ? (hp ? "D" : "B") : (hp ? "C" : "A");
  }
  function buildAxles() {
    var tab = tabKey(), ci = S.cargo_index, box = $("axles"), first = null, ok = false;
    box.innerHTML = "";
    [2, 3, 4, 5, 6, 7, 9].forEach(function (a) {
      var has = !!A.coef(tab, ci, a), l = document.createElement("label");
      l.innerHTML = '<input type="radio" name="ax" value="' + a + '" id="ax' + a + '"' + (has ? "" : " disabled") + '><b>' + a + '</b><small>' + AXNAME[a] + '</small>';
      box.appendChild(l);
      if (has) { if (first === null) first = a; if (a === S.axles) ok = true; }
    });
    if (!ok && first !== null) S.axles = first;
    var r = $("ax" + S.axles); if (r) r.checked = true;
    box.querySelectorAll("input").forEach(function (x) {
      x.addEventListener("change", function () { S.axles = +x.value; recalc(); saveSettings(); });
    });
  }
  function syncForm() {
    $("cargo").value = String(S.cargo_index);
    document.querySelectorAll("input[name=hire]").forEach(function (r) { r.checked = (r.value === S.hire); });
    $("hp").checked = S.high_performance; $("rv").checked = S.include_empty_return;
    buildAxles();
  }
  $("cargo").addEventListener("change", function () { S.cargo_index = +$("cargo").value; buildAxles(); recalc(); saveSettings(); });
  $("hp").addEventListener("change", function () { S.high_performance = $("hp").checked; buildAxles(); recalc(); saveSettings(); });
  $("rv").addEventListener("change", function () { S.include_empty_return = $("rv").checked; recalc(); saveSettings(); });
  document.querySelectorAll("input[name=hire]").forEach(function (r) {
    r.addEventListener("change", function () { S.hire = document.querySelector("input[name=hire]:checked").value; buildAxles(); recalc(); saveSettings(); });
  });
  $("kmManual").addEventListener("input", recalc);

  /* ---------- Cidades (tabela public.cities, base do IBGE) ---------- */
  function label(c) { return c.name + " – " + c.admin; }
  var CITY_COLS = "code,name,admin,lat,lng";
  async function searchCities(raw) {
    var q = norm(raw).replace(/[%_\\,()]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length < 2) return [];
    var r1 = await sb.from("cities").select(CITY_COLS).eq("country", "BR").like("search", q + "%").order("name").limit(8);
    if (r1.error) throw r1.error;
    var rows = r1.data || [];
    if (rows.length < 8) {
      var r2 = await sb.from("cities").select(CITY_COLS).eq("country", "BR").like("search", "%" + q + "%").order("name").limit(24);
      if (r2.error) throw r2.error;
      var seen = {}; rows.forEach(function (c) { seen[c.code] = 1; });
      (r2.data || []).forEach(function (c) { if (rows.length < 8 && !seen[c.code]) { seen[c.code] = 1; rows.push(c); } });
    }
    return rows;
  }
  function setupCombo(id) {
    var inp = $(id), ul = $(id + "-list"), act = -1, items = [], timer = null, seq = 0;
    function close() { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); act = -1; }
    function note(text) { ul.innerHTML = ""; var li = document.createElement("li"); li.className = "none"; li.textContent = text; ul.appendChild(li); ul.hidden = false; inp.setAttribute("aria-expanded", "true"); }
    function pick(c) { sel[id === "origin" ? "origin" : "dest"] = c; inp.value = label(c); close(); fetchRoute(); }
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
      searchCities(q).then(function (rows) {
        if (my !== seq) return;
        items = rows; act = rows.length ? 0 : -1;
        if (!rows.length) note("Nenhuma cidade encontrada."); else render();
      }, function () { if (my === seq) note("Não foi possível buscar as cidades. Tente de novo."); });
    }
    inp.addEventListener("focus", function () { inp.select(); if (!sel[id === "origin" ? "origin" : "dest"]) note("Digite pelo menos 2 letras."); });
    inp.addEventListener("input", function () {
      sel[id === "origin" ? "origin" : "dest"] = null; route = null; recalc();
      items = []; act = -1; seq++; // descarta resultados antigos: Enter não pode escolher uma cidade da busca anterior
      if (norm(inp.value).length < 2) note("Digite pelo menos 2 letras."); else note("Buscando…");
      clearTimeout(timer); timer = setTimeout(run, 220);
    });
    inp.addEventListener("blur", function () { seq++; clearTimeout(timer); close(); var c = sel[id === "origin" ? "origin" : "dest"]; inp.value = c ? label(c) : ""; });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) { act = Math.min(items.length - 1, act + 1); render(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) { act = Math.max(0, act - 1); render(); } }
      else if (e.key === "Enter") { if (!ul.hidden && items[act]) { e.preventDefault(); pick(items[act]); } }
      else if (e.key === "Escape") { close(); }
    });
  }
  setupCombo("origin"); setupCombo("dest");
  $("swapBtn").onclick = function () {
    var t = sel.origin; sel.origin = sel.dest; sel.dest = t;
    $("origin").value = sel.origin ? label(sel.origin) : ""; $("dest").value = sel.dest ? label(sel.dest) : "";
    fetchRoute();
  };

  /* ---------- Rota rodoviária (função "route" no Supabase) ---------- */
  async function fetchRoute() {
    var my = ++routeSeq;
    if (!sel.origin || !sel.dest) { route = null; recalc(); return; }
    if (sel.origin.code === sel.dest.code) { route = { status: "same" }; recalc(); return; }
    route = { status: "loading" }; recalc();
    var out;
    try {
      var r = await sb.functions.invoke("route", {
        body: { origin: { lat: sel.origin.lat, lng: sel.origin.lng }, destination: { lat: sel.dest.lat, lng: sel.dest.lng } }
      });
      if (r.error) {
        var body = null;
        try { body = await r.error.context.json(); } catch (e) { /* sem corpo */ }
        if (body && body.code === "UNAUTHENTICATED") { out = { status: "error", message: "Sua sessão expirou. Entre novamente." }; sb.auth.signOut(); }
        else out = { status: "error", message: (body && body.message) || "Não foi possível calcular a rota agora." };
      } else if (r.data && r.data.ok) {
        out = { status: "ok", km: r.data.km, source: r.data.source, vehicle: r.data.vehicle, attribution: r.data.attribution, warnings: r.data.warnings || [] };
      } else {
        out = { status: "error", message: (r.data && r.data.message) || "Não foi possível calcular a rota agora." };
      }
    } catch (e) { out = { status: "error", message: "Sem conexão com o serviço de rotas." }; }
    if (my !== routeSeq) return;
    route = out; recalc();
  }

  /* ---------- Cálculo e resultado ---------- */
  function distance() {
    var man = parseFloat($("kmManual").value);
    if (man > 0) return { km: Math.round(man * 10) / 10, kind: "manual" };
    if (route && route.status === "ok") return { km: route.km, kind: "route" };
    return null;
  }
  function recalc() {
    if ($("app").hidden) return;
    var a = sel.origin, b = sel.dest, d = distance(), man = parseFloat($("kmManual").value) > 0;
    // Distância e origem do valor
    $("distVal").textContent = d ? n1.format(d.km) + " km" : "—";
    var tag = $("distTag");
    if (d) { tag.hidden = false; tag.className = "tag" + (d.kind === "manual" ? " manual" : ""); tag.textContent = d.kind === "manual" ? "Informada manualmente" : "Rota por rodovias"; }
    else tag.hidden = true;
    var ml = $("mapsLink");
    if (a && b) { ml.href = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + encodeURIComponent(a.name + ", " + a.admin + ", Brasil") + "&destination=" + encodeURIComponent(b.name + ", " + b.admin + ", Brasil"); ml.style.visibility = "visible"; }
    else { ml.href = "#"; ml.style.visibility = "hidden"; }
    // Mensagem da rota
    var rm = $("routeMsg"); rm.className = "routemsg"; rm.textContent = "";
    if (route && route.status === "loading") { rm.innerHTML = '<span class="spin" aria-hidden="true"></span>Calculando a rota…'; }
    else if (route && route.status === "same") { rm.textContent = "Origem e destino são a mesma cidade."; }
    else if (route && route.status === "error") {
      rm.className = "routemsg err";
      rm.textContent = route.message + (man ? "" : " Você pode informar a distância manualmente abaixo.");
    } else if (route && route.status === "ok") {
      var msgs = [];
      if (man) msgs.push("Rota calculada: " + n1.format(route.km) + " km. O cálculo está usando o valor informado por você.");
      (route.warnings || []).forEach(function (w) { msgs.push(w); });
      if (msgs.length) { rm.innerHTML = ""; var ul = document.createElement("ul"); msgs.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }); rm.appendChild(ul); }
    }
    $("attrib").textContent = (route && route.status === "ok")
      ? "Rota: " + route.source + ". " + route.attribution + "." + (route.vehicle === "carro" ? " A rota considera veículo de passeio; em caminhão o trajeto pode variar." : "")
      : "";
    // Piso
    var tab = tabKey(), ci = S.cargo_index, c = A.coef(tab, ci, S.axles), bd = $("bd"), pl = $("pill");
    $("tabName").textContent = A.TABELAS[tab] + " · " + A.CARGAS[ci] + " · " + S.axles + " eixos";
    $("cCcd").textContent = c ? "R$ " + n4.format(c.ccd) : "—"; $("cCc").textContent = c ? brl.format(c.cc) : "—";
    $("routeTxt").textContent = (a && b) ? label(a) + " → " + label(b) : "Escolha origem e destino";
    var p = d ? A.piso(tab, ci, S.axles, d.km, S.include_empty_return) : null;
    if (!p) {
      $("total").textContent = "R$ 0,00"; bd.innerHTML = ""; last = "";
      pl.className = "pill";
      pl.textContent = !(a && b) ? "Falta escolher a rota" : (route && route.status === "loading") ? "Calculando a distância…" : "Sem distância para calcular";
      return;
    }
    $("total").textContent = brl.format(p.total);
    var rows = [["Distância (" + (d.kind === "manual" ? "informada manualmente" : "por rodovias") + ")", n1.format(p.km) + " km"],
                ["Deslocamento (" + n1.format(p.km) + " × " + n4.format(p.ccd) + ")", brl.format(p.deslocamento)],
                ["Carga e descarga", brl.format(p.carga)]];
    if (p.retorno > 0) rows.push(["Retorno vazio (0,92 × deslocamento)", brl.format(p.retorno)]);
    rows.push(["Por km rodado", brl.format(p.porKm)]);
    bd.innerHTML = rows.map(function (r, i) { return "<div" + (i === rows.length - 1 ? ' class="sum"' : "") + "><span>" + r[0] + "</span><span>" + r[1] + "</span></div>"; }).join("");
    pl.className = "pill" + (d.kind === "manual" ? "" : " ok");
    pl.textContent = d.kind === "manual" ? "Distância informada por você. Confira antes de fechar o frete." : "Coeficientes oficiais · " + A.VIGENCIA.norma;
    last = "Piso mínimo de frete (ANTT): " + brl.format(p.total) + "\nRota: " + ((a && b) ? label(a) + " → " + label(b) : "—") + " · " + n1.format(p.km) + " km (" + (d.kind === "manual" ? "informada manualmente" : "por rodovias, OpenStreetMap") + ")\nCarga: " + A.CARGAS[ci] + " · " + S.axles + " eixos · " + A.TABELAS[tab] + (p.retorno > 0 ? "\nInclui retorno vazio" : "") + "\nFórmula: distância × CCD + CC · " + A.VIGENCIA.norma;
  }
  $("copyBtn").onclick = function () {
    var t = $("toast"); if (!last) { t.textContent = "Complete a rota para copiar."; return; }
    function fb() { var ta = document.createElement("textarea"); ta.value = last; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* ignora */ } document.body.removeChild(ta); t.textContent = ok ? "Resumo copiado." : "Não foi possível copiar. Selecione o texto manualmente."; }
    try { navigator.clipboard.writeText(last).then(function () { t.textContent = "Resumo copiado."; }, fb); } catch (e) { fb(); }
    setTimeout(function () { t.textContent = ""; }, 3000);
  };

  /* ---------- Início do app ---------- */
  async function startApp(u) {
    if (started) return;
    started = true; user = u;
    $("who").textContent = (u.user_metadata && u.user_metadata.full_name) || u.email || "";
    await loadSettings();
    if (S.theme) { applyTheme(S.theme); lset("pf_theme", S.theme); }
    show("app"); syncForm(); recalc();
    if (window.PF && window.PF.onStart) window.PF.onStart();
  }

  /* Interface para js/intl.js (Frete Internacional e conversor). */
  window.PF = { sb: sb, norm: norm, brl: brl, n1: n1, S: S, saveSettings: saveSettings, lget: lget, lset: lset, getUser: function () { return user; }, signOut: function () { sb.auth.signOut(); } };

  setMode("in");
  setTimeout(function () { if (!$("boot").hidden) show("auth"); }, 6000);
})();
