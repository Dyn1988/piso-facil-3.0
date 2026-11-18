import type { Provider, RouteInput, RouteOutcome } from "../types.ts";

// Google Routes API: DORMENTE. Só funciona se o segredo GOOGLE_ROUTES_API_KEY existir
// e o provedor "google" for escolhido. Sem a chave, nenhuma chamada é feita e nada é cobrado.
// Ainda não testado (nenhuma chave foi criada).
export const google: Provider = {
  id: "google",
  label: "Google Maps",
  vehicle: "carro",
  attribution: "Google Maps",
  async route(i: RouteInput): Promise<RouteOutcome> {
    const key = Deno.env.get("GOOGLE_ROUTES_API_KEY");
    if (!key) {
      return { ok: false, code: "NOT_CONFIGURED", message: "O provedor Google Maps não está ativado." };
    }
    const loc = (c: { lat: number; lng: number }) => ({ location: { latLng: { latitude: c.lat, longitude: c.lng } } });
    let res: Response;
    try {
      res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: loc(i.origin),
          destination: loc(i.destination),
          intermediates: i.via.map(loc),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", message: "O servidor de rotas não respondeu." };
    }
    if (res.status === 429) return { ok: false, code: "RATE_LIMITED", message: "Limite de consultas do provedor atingido." };
    const j = await res.json().catch(() => null);
    const r = j?.routes?.[0];
    if (!res.ok || !r || typeof r.distanceMeters !== "number") {
      return { ok: false, code: res.status === 404 || (res.ok && !r) ? "NO_ROUTE" : "PROVIDER_UNAVAILABLE", message: "Não foi possível obter a rota neste provedor." };
    }
    const secs = typeof r.duration === "string" ? parseInt(r.duration, 10) : NaN;
    return { ok: true, meters: r.distanceMeters, seconds: Number.isFinite(secs) ? secs : null, snapMaxMeters: null };
  },
};
