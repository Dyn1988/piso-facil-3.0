import type { Provider, RouteInput, RouteOutcome } from "../types.ts";

// Servidor público OSRM da FOSSGIS (OpenStreetMap), perfil carro.
// Política: no máximo 1 requisição por segundo, User-Agent válido, atribuição ao OSM.
// Adequado para validação. Para uso comercial, aponte OSRM_BASE_URL para um OSRM próprio.
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const osrm: Provider = {
  id: "osrm",
  label: "OpenStreetMap (OSRM)",
  vehicle: "carro",
  attribution: "© OpenStreetMap contributors",
  async route(i: RouteInput): Promise<RouteOutcome> {
    const base = Deno.env.get("OSRM_BASE_URL") ?? "https://routing.openstreetmap.de/routed-car";
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await sleep(wait);
    last = Date.now();

    const pts = [i.origin, ...i.via, i.destination]
      .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
      .join(";");
    const url = `${base}/route/v1/driving/${pts}?overview=false&alternatives=false&steps=false`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": i.userAgent }, signal: AbortSignal.timeout(15000) });
    } catch {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "O servidor de rotas não respondeu." };
    }
    if (res.status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "O servidor de rotas limitou as consultas. Tente novamente em instantes." };
    }
    const j = await res.json().catch(() => null);
    if (!j || typeof j.code !== "string") {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "Resposta inválida do servidor de rotas." };
    }
    if (j.code === "NoRoute" || j.code === "NoSegment") {
      return { ok: false, code: "NO_ROUTE", message: "Não há rota rodoviária entre estes pontos." };
    }
    if (j.code !== "Ok" || !Array.isArray(j.routes) || !j.routes.length) {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: `O servidor de rotas retornou: ${j.code}.` };
    }
    const r = j.routes[0];
    const snaps = Array.isArray(j.waypoints) ? j.waypoints.map((w: { distance?: number }) => w.distance ?? 0) : [];
    return {
      ok: true,
      meters: Math.round(r.distance),
      seconds: typeof r.duration === "number" ? Math.round(r.duration) : null,
      snapMaxMeters: snaps.length ? Math.round(Math.max(...snaps)) : null,
    };
  },
};
