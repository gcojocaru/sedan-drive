# Map data proxy

A Cloudflare Worker that sits between the game and the public Overpass servers. The first player to drive a place
makes it download from Overpass once; everyone after that gets the stored copy from Workers KV. Without it, every
player's browser asks Overpass directly, and the Overpass usage policy counts all of the site's players together.

```
browser ──GET /area?lat=…&lon=…──▶ Worker ──▶ edge cache ──▶ Workers KV ──(miss)──▶ Overpass servers, one at a time
```

- It only runs the game's own query (`../osm-query.js`) for start points on the game's ~55 m grid, so it can't be used
  to run arbitrary Overpass queries.
- It only answers the sites listed in `ALLOWED_ORIGINS` (`wrangler.toml`). Any script can send that header, so new
  downloads from Overpass are also capped (`UPSTREAM` in `wrangler.toml`: 30 a minute per Cloudflare location). Over the
  cap it replies 429 and the game asks Overpass itself, so players still get their map, and the public servers never
  see a flood from the proxy.
- A server that answers HTTP 429/406 is left alone for 30 s, as the Overpass policy asks. When every server is busy it
  replies 503 and the game shows "busy" instead of asking Overpass again itself.
- Places expire from KV after `TTL_DAYS` (30) and are then downloaded fresh, which keeps storage inside the free 1 GB.

## Set up (once)

You need a free Cloudflare account. Run these from the repo root:

```bash
npx --yes wrangler@4.159.0 login
```

```bash
npm run proxy:kv
```

That creates the KV namespace and writes its id into `proxy/wrangler.toml` (the id isn't a secret; commit it).

```bash
npm run proxy:deploy
```

Wrangler prints the Worker's address, like `https://sedan-drive-osm.<your-subdomain>.workers.dev`. Put it in
`osm-query.js`:

```js
export const AREA_PROXY = 'https://sedan-drive-osm.<your-subdomain>.workers.dev';
```

Commit and push to `main`; the site redeploys and the game uses the proxy, falling back to the Overpass servers
directly if the proxy can't be reached.

## Check it

```bash
curl -s -o /dev/null -D - -H "Origin: https://gcojocaru.github.io" "https://sedan-drive-osm.<your-subdomain>.workers.dev/area?lat=44.4270&lon=26.1025" | grep -i -E "^HTTP|x-area-source"
```

The first call shows an Overpass server in `x-area-source`; run it again and it says `kv` (or `edge`).

## Free plan limits that apply

| | Free allowance | What it means here |
|---|---|---|
| Worker requests | 100,000 / day | one per new place a browser loads |
| Worker CPU | 10 ms / request | the Worker never parses the map data, only passes it on |
| KV reads | 100,000 / day | one per cached place served |
| KV writes | 1,000 / day | one per new place downloaded from Overpass |
| KV storage | 1 GB | about 300–1,000 places at 1–5 MB each; places expire after 30 days |
| KV value size | 25 MiB | larger places are served but not stored |

## Changing the query

`osm-query.js` is shared with the game. After changing the query, bump `CACHE_V` there and redeploy the Worker
(`npm run proxy:deploy`) along with the site, so both start from fresh caches.
