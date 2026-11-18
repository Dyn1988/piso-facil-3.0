import { createClient } from "npm:@supabase/supabase-js@2";
import type { Coord, Provider } from "./types.ts";
import { osrm } from "./providers/osrm.ts";
import { ors } from "./providers/ors.ts";
import { google } from "./providers/google.ts";

// Serviço de distância rodoviária. Entrada: origem, destino e pontos obrigatórios (aduana).
// Saída: distância real por rodovias ou um erro claro. Nunca devolve valor estimado.
// Para trocar o provedor: segredo ROUTING_PROVIDER ou campo "provider" na requisição.
const PROVIDERS: Record<string, Provider> = { osrm, ors, google };
const CACHE_DAYS = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const bad = (message: string) => json({ ok: false, code: "INVALID_INPUT", message }, 400);

// Caixa aproximada do Mercosul (Brasil, Argentina, Paraguai, Uruguai, Chile, Bolívia).
const inBox = (c: Coord) => c.lat >= -56 && c.lat <= 6 && c.lng >= -82 && c.lng <= -34;
const parseCoord = (v: unknown): Coord | null => {
  const o = v as { lat?: unknown; lng?: unknown } | null;
  if (!o || typeof o.lat !== "number" || typeof o.lng !== "number") return null;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
  return { lat: o.lat, lng: o.lng };
};

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return bad("Use o método POST.");

  // Exige usuário logado. A chave pública (anon) passa no verify_jwt, então confirmamos o usuário aqui.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: au, error: ae } = await db.auth.getUser(token);
  if (ae || !au?.user) {
    return json({ ok: false, code: "UNAUTHENTICATED", message: "Entre na sua conta para calcular rotas." }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad("Corpo da requisição inválido."); }

  const origin = parseCoord(body.origin);
  const destination = parseCoord(body.destination);
  if (!origin || !destination) return bad("Informe origem e destino com lat e lng.");
  const viaRaw = Array.isArray(body.via) ? body.via : [];
  if (viaRaw.length > 5) return bad("No máximo 5 pontos obrigatórios.");
  const via: Coord[] = [];
  for (const v of viaRaw) {
    const c = parseCoord(v);
    if (!c) return bad("Ponto obrigatório inválido.");
    via.push(c);
  }
  const all = [origin, ...via, destination];
  if (!all.every(inBox)) return bad("Coordenadas fora da área atendida (Mercosul).");
  if (all.every((c) => Math.abs(c.lat - origin.lat) < 1e-5 && Math.abs(c.lng - origin.lng) < 1e-5)) {
    return bad("Origem e destino são o mesmo ponto.");
  }

  const pid = String(body.provider ?? Deno.env.get("ROUTING_PROVIDER") ?? "osrm");
  const provider = PROVIDERS[pid];
  if (!provider) return bad("Provedor de rotas desconhecido.");

  const key = await sha256([provider.id, provider.vehicle, ...all.map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`)].join("|"));

  const reply = (r: { meters: number; seconds: number | null; snap: number | null }, cached: boolean) => {
    const warnings: string[] = [];
    if (r.snap !== null && r.snap > 5000) {
      warnings.push(`Um dos pontos fica a ${Math.round(r.snap / 1000)} km da via mais próxima. Confira a distância no mapa.`);
    }
    return json({
      ok: true,
      confirmed: true,
      km: Math.round(r.meters / 100) / 10,
      meters: r.meters,
      seconds: r.seconds,
      provider: provider.id,
      source: provider.label,
      vehicle: provider.vehicle,
      attribution: provider.attribution,
      via_count: via.length,
      cached,
      warnings,
    });
  };

  try {
    const since = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
    const { data } = await db.from("distance_cache").select("meters,seconds,snap_max_m").eq("key", key).gte("created_at", since).maybeSingle();
    if (data) return reply({ meters: data.meters, seconds: data.seconds, snap: data.snap_max_m }, true);
  } catch { /* cache indisponível: segue sem ele */ }

  const out = await provider.route({
    origin, destination, via,
    userAgent: Deno.env.get("ROUTING_USER_AGENT") ?? "PisoFacil/1.0 (servico-de-rotas)",
  });
  if (!out.ok) return json({ ok: false, confirmed: false, code: out.code, message: out.message, provider: provider.id });

  try {
    await db.from("distance_cache").upsert({
      key, provider: provider.id, vehicle_profile: provider.vehicle,
      request: { origin, destination, via }, meters: out.meters, seconds: out.seconds,
      snap_max_m: out.snapMaxMeters, created_at: new Date().toISOString(),
    });
  } catch { /* falha de cache não impede a resposta */ }

  return reply({ meters: out.meters, seconds: out.seconds, snap: out.snapMaxMeters }, false);
});
