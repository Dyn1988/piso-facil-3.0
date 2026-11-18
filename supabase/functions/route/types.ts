// Contrato comum a todos os provedores de rota. A calculadora só conhece este contrato.
export type Coord = { lat: number; lng: number };

export interface RouteInput {
  origin: Coord;
  destination: Coord;
  via: Coord[]; // pontos obrigatórios (ex.: aduana), na ordem
  userAgent: string;
}

export interface RouteOk {
  ok: true;
  meters: number;
  seconds: number | null;
  snapMaxMeters: number | null; // maior distância entre o ponto pedido e a via usada; null se o provedor não informa
}

export interface RouteFail {
  ok: false;
  code: "NO_ROUTE" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "NOT_CONFIGURED";
  message: string;
}

export type RouteOutcome = RouteOk | RouteFail;

export interface Provider {
  id: string;
  label: string;
  vehicle: string; // perfil de veículo realmente usado pelo provedor
  attribution: string;
  route(input: RouteInput): Promise<RouteOutcome>;
}
