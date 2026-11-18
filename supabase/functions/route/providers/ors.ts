import type { Provider, RouteInput, RouteOutcome } from "../types.ts";

// OpenRouteService (HeiGIT), perfil caminhão (driving-hgv).
// Plano gratuito: 2.000 requisições/dia e 40/minuto. A chave fica só como segredo ORS_API_KEY.
// Atenção: os termos não deixam claro se o uso comercial é permitido no plano gratuito.
export const ors: Provider = {
  id: "ors",
  label: "OpenRouteService (OpenStreetMap)",
  vehicle: "caminhão",
  attribution: "© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors",
  async route(i: RouteInput): Promise<RouteOutcome> {
    const key = Deno.env.get("ORS_API_KEY");
    if (!key) {
      return { ok: false, code: "NOT_CONFIGURED", message: "O provedor OpenRouteService não está configurado." };
    }
    const pts = [i.origin, ...i.via, i.destination];
    const body = {
      coordinates: pts.map((c) => [c.lng, c.lat]),
      radiuses: pts.map(() => -1), // sem limite de busca da via mais próxima
      instructions: false,
    };
    let res: Response;
    try {
      res = await fetch("https://api.openrouteservice.org/v2/directions/driving-hgv", {
        method: "POST",
        headers: { Authorization: key, "Content-Type": "application/json", "User-Agent": i.userAgent },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "O servidor de rotas não respondeu." };
    }
    if (res.status === 429 || res.status === 403) {
      return { ok: false, code: "RATE_LIMITED", message: "Limite de consultas do provedor atingido." };
    }
    const j = await res.json().catch(() => null);
    if (res.status === 404 || res.status === 400) {
      const code = j?.error?.code;
      if (code === 2009 || code === 2010) {
        return { ok: false, code: "NO_ROUTE", message: "Não há rota rodoviária entre estes pontos." };
      }
    }
    const s = j?.routes?.[0]?.summary;
    if (!res.ok || !s || typeof s.distance !== "number") {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "Resposta inválida do servidor de rotas." };
    }
    return {
      ok: true,
      meters: Math.round(s.distance),
      seconds: typeof s.duration === "number" ? Math.round(s.duration) : null,
      snapMaxMeters: null,
    };
  },
};
