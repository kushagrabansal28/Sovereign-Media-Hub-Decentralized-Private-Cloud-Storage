# Deployment

## What gets deployed

One Compose project with two containers:

| Service | Image | Does |
| --- | --- | --- |
| `server` | built from `backend/Dockerfile` (Go, Alpine, non-root user 10001) | Blossom API, SQLite, blob files in the `media` volume |
| `web` | built from `frontend/Dockerfile` (Caddy 2.8) | Serves the web app, proxies `/upload`, `/list/*`, `/health`, `/info` and `/<sha256>[.ext]` to `server`, writes `/config.json`, terminates TLS |

`server` publishes no port to the host. Everything goes through Caddy. Both containers drop all capabilities (`web` keeps `NET_BIND_SERVICE`), set `no-new-privileges`, and `server` has a read-only root filesystem.

A relay is not included. Use a relay you run (for example strfry) or accept the privacy trade-off of public relays; see `docs/THREAT_MODEL.md`.

> **Status of these files.** They were written and statically reviewed. They have not been run: the machine used for development had no Docker. `docker compose config`, image builds, container health checks and restart persistence are untested here; the restart persistence of the server binary itself (same data directory, new process) is covered by automated tests. Treat the first `docker compose up` as the real test.

## Local, plain HTTP

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open <http://localhost>. Change `HTTP_PORT` in `.env` if port 80 is taken. On first run the app asks for a storage server and relays; the defaults come from `PUBLIC_URL` and `DEFAULT_RELAYS`.

## Production with HTTPS

Requirements, none of which can be checked from this repository:

* a DNS record for your domain pointing at the host,
* ports 80 and 443 reachable from the internet (Caddy uses them to obtain and renew a Let's Encrypt certificate),
* a persistent `caddy_data` volume (it holds the certificate and account key).

`.env`:

```
PUBLIC_URL=https://media.example.org
SITE_ADDRESS=media.example.org
ALLOWED_PUBKEYS=npub1...,npub1...      # strongly recommended
DEFAULT_RELAYS=["wss://relay.example.org"]
```

Then `docker compose up -d --build`. Check `docker compose logs web` for the certificate being issued. Pages served over https cannot use `ws://` relays, so use `wss://`.

Set `ALLOWED_PUBKEYS` before exposing the server. With it empty, any Nostr key can upload until the disk is full.

`PUBLIC_URL` is written into every uploaded file's URL. Pick it once. If it must change, old events keep the old address; the viewer then falls back to the same hash on the configured server, so files still open as long as the server holds them.

## Without Docker

Backend:

```powershell
cd backend
go build -o ..\.run\server.exe .\cmd\server
$env:DATA_DIR = "..\.run\data"; $env:PORT = "8787"; $env:BASE_URL = "http://localhost:8787"
..\.run\server.exe
```

Relay for development:

```powershell
cd frontend
npm ci
node tools/dev-relay/relay.mjs --port 7777 --persist ..\.run\relay.jsonl
```

Frontend:

```powershell
npm run dev          # http://localhost:5173, defaults to http://localhost:8787 and ws://localhost:7777
```

Production build only: `npm run build` produces `frontend/dist`. Any static host works if it rewrites unknown paths to `index.html` and proxies the storage routes.

## Backup and recovery

Everything that matters is in the `media` volume (`/data`): `sovereign.db`, `blobs/`.

* **Backup**: stop the `server` container (or accept a crash-consistent copy: SQLite is in WAL mode) and copy the volume. Example: `docker run --rm -v sovereign-media-hub_media:/data -v ${PWD}:/backup alpine tar czf /backup/media.tgz -C /data .`
* **Restore**: extract into an empty volume and start the stack. At startup the server drops database rows whose file is missing, leaves files without a row in place (a later upload of the same bytes adopts them) and logs both.
* **Verify**: `docker compose run --rm server server -scrub` re-hashes every blob and reports mismatches.
* The user's **private key** is not on the server. Back it up from Settings → Identity.
* The **library index** lives on the relays and in each browser's cache. If relays are lost, the files remain on the server, and Settings → Storage lists them as "not in the library".

## Configuration reference

See `docs/API.md` for the server variables. Compose variables are in `.env.example`.

## Health checks

* Server: `server -healthcheck` (HTTP `GET /health` on the container's own port), wired into Compose.
* From outside: `GET /health` returns `{"status":"ok","version":"…"}` after a database check.
* The app's sidebar shows the measured round trip to `/health` and re-checks every 60 s while the tab is visible.
