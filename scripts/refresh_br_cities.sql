-- Atualiza os municípios do Brasil na tabela public.cities. Pode ser executado de novo a qualquer momento.
-- Nomes e UF: API de localidades do IBGE. Coordenadas (centro do município): kelvins/municipios-brasileiros, baseado em dados do IBGE.
-- Requer a extensão "http" (create extension http with schema extensions;).
-- Se o IBGE retornar menos de 5.000 municípios, a atualização é cancelada e nada é apagado.
do $$
declare n int;
begin
  create temp table _br on commit drop as
  with ibge as (
    select (m->>'id')::int as code,
           m->>'nome' as name,
           coalesce(m->'microrregiao'->'mesorregiao'->'UF'->>'sigla',
                    m->'regiao-imediata'->'regiao-intermediaria'->'UF'->>'sigla') as uf
    from extensions.http_get('https://servicodados.ibge.gov.br/api/v1/localidades/municipios') h,
         lateral jsonb_array_elements(h.content::jsonb) m
    where h.status = 200
  ), csv as (
    select split_part(l, ',', 1)::int as code,
           split_part(l, ',', 3)::double precision as lat,
           split_part(l, ',', 4)::double precision as lng
    from extensions.http_get('https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv') h,
         lateral regexp_split_to_table(h.content, E'\r?\n') l
    where h.status = 200 and l ~ '^[0-9]+,'
  )
  select i.code, i.name, i.uf, c.lat, c.lng
  from ibge i left join csv c using (code)
  where i.uf is not null;

  select count(*) into n from _br;
  if n < 5000 then
    raise exception 'IBGE retornou apenas % municípios; atualização cancelada', n;
  end if;

  insert into public.cities (country, code, name, admin, lat, lng, search, source)
  select 'BR', code::text, name, uf, lat, lng,
         lower(extensions.unaccent(name || ' ' || uf)),
         'IBGE localidades + kelvins/municipios-brasileiros'
  from _br
  on conflict (country, code) do update
    set name = excluded.name, admin = excluded.admin, lat = excluded.lat, lng = excluded.lng,
        search = excluded.search, source = excluded.source, updated_at = now();

  delete from public.cities where country = 'BR' and updated_at < now();
end $$;
