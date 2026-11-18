# Piso Fácil

Calculadora do piso mínimo de frete da ANTT. O usuário escolhe origem e destino em uma lista de cidades, a distância é calculada por rodovias, e o piso sai com a tabela oficial da ANTT.

## Estrutura

```
site/                         Site estático. Esta é a pasta a publicar (sem etapa de build).
  index.html, css/app.css
  js/config.js                URL e chave PÚBLICA do Supabase
  js/antt.js                  Coeficientes oficiais da ANTT e a fórmula
  js/app.js                   Login, cidades, rota, cálculo nacional e tela
  js/intl.js                  Frete Internacional (Mercosul), aduanas, Advalorem e conversor Real/Dólar
supabase/functions/ptax/      Cotação PTAX de compra do dólar (API Olinda do Banco Central, gratuita)
supabase/functions/admin-data/ Manutenção de dados (DESATIVADA; só a versão completa serve para importar cidades e validar aduanas)
supabase/functions/route/     Serviço de distância (Edge Function), com provedores trocáveis
  providers/osrm.ts           OpenStreetMap (em uso)
  providers/ors.ts            OpenRouteService (desligado até haver chave)
  providers/google.ts         Google Maps (dormente, não testado)
scripts/refresh_br_cities.sql Atualização dos municípios do IBGE
```

Projeto Supabase: `piso-facil` (ref `mtnwpdhkuyocpkctxwzv`, região São Paulo).
Tabelas: `profiles`, `user_settings`, `calc_history`, `cities`, `border_crossings`, `distance_cache`. Todas com RLS.

## Frete Internacional (Mercosul)

- Cidades de AR, PY, UY, CL e BO: GeoNames `cities500` (CC BY 4.0, localidades com 500 habitantes ou mais). A atribuição aparece na aba. Brasil: IBGE.
- Aduanas: tabela `border_crossings`. Só aparecem para o usuário as ativas, e cada uma foi validada no roteamento (ponto a até 500 m de uma via e sem desvio excessivo). Estado da última validação em `verify_note`.
- A rota exige passar pela aduana escolhida (ponto obrigatório na função `route`). Para países sem fronteira direta, o app encadeia aduanas (ex.: Brasil → Argentina → Chile).
- Frete = km × valor por km. Advalorem = mercadoria × (% ÷ 100). Valor por km e % ficam em `user_settings`.
- Conversor: função `ptax` devolve a cotação de compra PTAX do Banco Central; sem cotação na data, usa a última anterior e avisa. Em falha, mostra erro e não converte.
- Para cadastrar nova aduana: inserir em `border_crossings` com `active=false` e validar antes de ativar.

## Publicar o site

Em Cloudflare Pages, Netlify ou Vercel, publique a pasta `site` (sem comando de build). Depois:

1. No painel do Supabase, em **Authentication → URL Configuration**, defina o **Site URL** com o endereço final do site e adicione o mesmo endereço em **Redirect URLs**. Sem isso o link de recuperação de senha e de confirmação de e-mail não volta para o site.
2. Em **Authentication → Providers → Email**, confira se a confirmação de e-mail está ligada e se a senha mínima é de 8 caracteres.
3. Em **Authentication → Emails**, traduza os modelos (confirmação, recuperação de senha) para português.
4. **Antes de ter clientes:** configure um SMTP próprio em **Authentication → SMTP Settings**. O envio padrão do Supabase tem limite muito baixo e não serve para produção.
5. Defina o segredo `ROUTING_USER_AGENT` da função `route` com o nome do site e um contato do projeto (o servidor público de rotas pede esse identificador).

## Rotas e provedores

A função `route` recebe origem, destino e pontos obrigatórios e devolve a distância por rodovias ou um erro claro. Nunca devolve valor estimado. Exige usuário logado.

- Provedor padrão: segredo `ROUTING_PROVIDER` (`osrm`, `ors` ou `google`). Sem o segredo, usa `osrm`.
- `osrm`: servidor público da FOSSGIS. **Só para validação**: limite de 1 consulta por segundo, sem garantia de disponibilidade. Para lançar, rode um OSRM próprio e aponte o segredo `OSRM_BASE_URL` para ele.
- `ors`: crie uma chave gratuita no OpenRouteService e guarde em `ORS_API_KEY`. Os termos não deixam claro se o uso comercial é permitido no plano gratuito.
- `google`: só funciona se existir o segredo `GOOGLE_ROUTES_API_KEY`. Gera custo na conta Google Cloud. Não ative sem decidir.

Nenhuma chave vai para o site. Rotas já consultadas ficam 30 dias em `distance_cache`.

## Manutenção

- **Coeficientes da ANTT:** a cada novo ato da ANTT (a tabela é reajustada com o preço do diesel), substitua os números em `site/js/antt.js` e atualize `VIGENCIA`.
- **Municípios:** rode `scripts/refresh_br_cities.sql` no SQL Editor do Supabase. Antes, execute `create extension http with schema extensions;` e, ao terminar, `drop extension http;`.

## Limitações conhecidas

- O OSRM público calcula para carro. Em caminhão o trajeto pode variar.
- As coordenadas dos municípios são o centro de cada cidade (base kelvins/municipios-brasileiros, derivada do IBGE). A distância é de centro a centro e pode diferir alguns km do Google Maps.
- Ainda não há limite de consultas por usuário na função `route`.
- A biblioteca do Supabase é carregada de uma CDN com versão fixa (`@supabase/supabase-js@2.45.4`). Para uso comercial, considere copiá-la para dentro do site.
- Sete aduanas (Foz/Puerto Iguazú, Concordia/Salto, Uruguaiana/Paso de los Libres, Cardenal Samoré, Posadas/Encarnación, Salvador Mazza/Yacuiba e Arica/La Paz) estão ativas em modo direto (`use_via=false`): a distância é a rota rodoviária cidade a cidade, sem forçar o ponto da aduana, porque o ponto cadastrado não fica exatamente sobre a via no OpenStreetMap. As demais forçam a passagem pela aduana.
- Cidades abaixo de 500 habitantes não aparecem na busca dos países vizinhos.
- Histórico de cálculos ainda não foi implementado.
