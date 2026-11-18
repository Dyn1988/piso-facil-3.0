import { createClient } from "npm:@supabase/supabase-js@2";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";

// Manutenção de dados (não é usada pelo site). Só responde com o cabeçalho x-admin-token igual ao segredo ADMIN_TOKEN.
// Sem o segredo definido, a função fica desativada.
//   action "import_cities"    : importa AR, PY, UY, CL e BO do GeoNames (cities500, CC BY 4.0) para public.cities
//   action "verify_crossings" : valida cada aduana pendente no roteamento (via, não só o caminho mais curto)
const ONE_TIME = "";
const UA = "PisoFacil/1.0 (manutencao-de-dados)";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// deno-lint-ignore no-explicit-any
type Db = any;

async function importCities(db: Db) {
  const COUNTRIES = ["AR", "PY", "UY", "CL", "BO"];
  const SKIP = new Set(["PPLX", "PPLH", "PPLQ", "PPLW", "PPLR"]); // seções de cidade, históricas, abandonadas, destruídas, religiosas
  const RX = /\t(AR|PY|UY|CL|BO)\t/;
  const started = new Date().toISOString();
  const [zr, ar] = await Promise.all([
    fetch("https://download.geonames.org/export/dump/cities500.zip"),
    fetch("https://download.geonames.org/export/dump/admin1CodesASCII.txt"),
  ]);
  if (!zr.ok || !ar.ok) return json({ ok: false, error: `download falhou ${zr.status}/${ar.status}` }, 502);
  const adm = new Map<string, string>();
  for (const l of (await ar.text()).split("\n")) { const c = l.split("\t"); if (c.length >= 2) adm.set(c[0], c[1]); }
  const files = unzipSync(new Uint8Array(await zr.arrayBuffer()), { filter: (f: { name: string }) => f.name === "cities500.txt" });
  const text = strFromU8(files["cities500.txt"]);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line || !RX.test(line)) continue;
    const c = line.split("\t");
    if (!COUNTRIES.includes(c[8]) || c[6] !== "P" || SKIP.has(c[7]) || seen.has(c[0])) continue;
    seen.add(c[0]);
    const admin = adm.get(`${c[8]}.${c[10]}`) ?? (c[10] || c[8]);
    rows.push({
      country: c[8], code: c[0], name: c[1], admin, lat: +c[4], lng: +c[5], population: parseInt(c[14]) || 0,
      search: norm(`${c[1]} ${admin}`), source: "GeoNames cities500 (CC BY 4.0)", updated_at: new Date().toISOString(),
    });
  }
  if (rows.length < 3000) return json({ ok: false, error: `apenas ${rows.length} cidades; importação cancelada` }, 500);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("cities").upsert(rows.slice(i, i + 500), { onConflict: "country,code" });
    if (error) return json({ ok: false, error: error.message, at: i }, 500);
  }
  await db.from("cities").delete().in("country", COUNTRIES).lt("updated_at", started);
  const byCountry: Record<string, number> = {};
  for (const r of rows) byCountry[r.country as string] = (byCountry[r.country as string] ?? 0) + 1;
  return json({ ok: true, total: rows.length, byCountry });
}

let last = 0;
async function osrm(pts: { lat: number; lng: number }[]) {
  const wait = Math.max(0, last + 1100 - Date.now()); if (wait) await sleep(wait); last = Date.now();
  const c = pts.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  try {
    const r = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${c}?overview=false&alternatives=false`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (j.code !== "Ok") return { ok: false as const, code: j.code as string };
    return { ok: true as const, meters: j.routes[0].distance as number, snaps: (j.waypoints as { distance: number }[]).map((w) => w.distance) };
  } catch { return { ok: false as const, code: "REDE" }; }
}

async function findCity(db: Db, cc: string, name: string) {
  const n = norm(name);
  const { data } = await db.from("cities").select("name,lat,lng,population").eq("country", cc).like("search", `${n}%`).order("population", { ascending: false, nullsFirst: false }).limit(10);
  const list = (data ?? []) as { name: string; lat: number; lng: number }[];
  return list.find((x) => norm(x.name) === n) ?? null;
}

async function verifyCrossings(db: Db, limit: number) {
  const { data: list } = await db.from("border_crossings").select("*").is("verified_at", null).order("id").limit(limit);
  const out: unknown[] = [];
  for (const cx of list ?? []) {
    const A = await findCity(db, cx.country_a, cx.city_a), B = await findCity(db, cx.country_b, cx.city_b);
    let upd: Record<string, unknown>;
    if (!A || !B) {
      upd = { active: false, verify_note: `Cidade de referência não encontrada: ${!A ? cx.city_a : cx.city_b}` };
    } else {
      const X = { lat: cx.lat, lng: cx.lng };
      const d = await osrm([A, B]); const v = await osrm([A, X, B]);
      if (!d.ok || !v.ok) upd = { active: false, verify_note: `Sem rota no OSRM (${!d.ok ? d.code : (v as { code: string }).code})` };
      else {
        const snap = Math.round(v.snaps[1]), detour = v.meters - d.meters, ratio = v.meters / d.meters;
        const pass = snap <= 500 && detour <= Math.max(3000, 0.15 * d.meters);
        upd = {
          active: pass, verify_snap_m: snap, verify_ratio: Math.round(ratio * 1000) / 1000,
          verify_note: `${pass ? "OK" : "REPROVADA"}: direto ${(d.meters / 1000).toFixed(1)} km; via aduana ${(v.meters / 1000).toFixed(1)} km; ponto a ${snap} m da via`,
        };
      }
    }
    upd.verified_at = new Date().toISOString();
    await db.from("border_crossings").update(upd).eq("id", cx.id);
    out.push({ id: cx.id, name: cx.name, active: upd.active, note: upd.verify_note });
  }
  return json({ ok: true, results: out });
}

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("ADMIN_TOKEN") || ONE_TIME;
  if (!expected || req.headers.get("x-admin-token") !== expected) return json({ ok: false, error: "não autorizado" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { action?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  if (body.action === "import_cities") return await importCities(db);
  if (body.action === "verify_crossings") return await verifyCrossings(db, Math.min(body.limit ?? 8, 12));
  return json({ ok: false, error: "ação desconhecida" }, 400);
});
