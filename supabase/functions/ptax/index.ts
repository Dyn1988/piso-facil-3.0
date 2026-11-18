import { createClient } from "npm:@supabase/supabase-js@2";

// Cotação PTAX de COMPRA do dólar (CotacaoDolarPeriodo: uma linha por dia útil, a PTAX de fechamento) do Banco Central, API Olinda (gratuita, sem chave).
// Entrada: { date: "YYYY-MM-DD" }. Se não houver cotação na data (fim de semana, feriado, ainda não publicada),
// devolve a última cotação anterior disponível com fallback=true. Nunca inventa valor: em falha devolve ok:false.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const BASE = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const us = (s: string) => `${s.slice(5, 7)}-${s.slice(8, 10)}-${s.slice(0, 4)}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD", message: "Método não permitido." }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return json({ ok: false, code: "UNAUTHENTICATED", message: "Sessão inválida." }, 401);

  let body: { date?: string } = {};
  try { body = await req.json(); } catch { /* sem corpo */ }
  const date = String(body.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + "T12:00:00Z"))) return json({ ok: false, code: "BAD_DATE", message: "Data inválida." }, 400);
  const today = iso(new Date(Date.now() - 3 * 3600 * 1000)); // data de Brasília
  const target = date > today ? today : date;
  const from = iso(new Date(Date.parse(target + "T12:00:00Z") - 14 * 86400000));

  try {
    const url = `${BASE}?@dataInicial='${us(from)}'&@dataFinalCotacao='${us(target)}'&$top=200&$format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
    if (!r.ok) return json({ ok: false, code: "BCB_HTTP", message: "O Banco Central não respondeu agora. Tente novamente em instantes." }, 502);
    const j = await r.json();
    const rows = ((j.value ?? []) as { cotacaoCompra: number; dataHoraCotacao: string }[])
      .filter((x) => typeof x.cotacaoCompra === "number" && x.dataHoraCotacao.slice(0, 10) <= target)
      .sort((a, b) => (a.dataHoraCotacao < b.dataHoraCotacao ? 1 : -1));
    if (!rows.length) return json({ ok: false, code: "NO_QUOTE", message: "Não há cotação disponível no Banco Central para o período." }, 200);
    const q = rows[0], eff = q.dataHoraCotacao.slice(0, 10);
    return json({
      ok: true, requestedDate: date, effectiveDate: eff, compra: q.cotacaoCompra, fallback: eff !== date,
      source: "Banco Central do Brasil, PTAX, cotação de compra (boletim de fechamento)",
    });
  } catch {
    return json({ ok: false, code: "BCB_NET", message: "Não foi possível consultar o Banco Central agora." }, 502);
  }
});
