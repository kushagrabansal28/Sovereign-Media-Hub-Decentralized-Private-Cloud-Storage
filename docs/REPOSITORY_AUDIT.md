# Repository audit

Audit date: 2026-10-19. Subject: `GyroBullet/sovereign-media-hub`, branch `main`, commit `dedb5fe` ("Initial commit of Sovereign Media Hub"). Working branch for this work: `overhaul/final-review`. The working tree was clean when the audit started.

Everything below was observed by reading the code, building it, or running a probe. Items that were only read and not executed are marked *(read)*.

## 1. Environment baseline

| Tool | State on the audit machine |
| --- | --- |
| Node / npm | v24.19.0 / 11.17.0 |
| Go | not installed; Go 1.27.0 installed with winget on request |
| Docker | not installed. Container checks are BLOCKED on this machine |
| Browsers | Chrome and Edge present (used for screenshots and E2E) |

| Check | Result |
| --- | --- |
| `npm ci` in `frontend/` | passes |
| `npm run build` | passes (54 modules, 388 kB JS / 127 kB gzip), with an `INEFFECTIVE_DYNAMIC_IMPORT` warning |
| `npm run lint` (oxlint) | passes with 9 warnings (hook dependency problems, unused variables) |
| `go build` / `go vet` in `backend/` | passes |
| Tests | none exist in either project |
| `docker compose config` | BLOCKED (no Docker) |

The repository also contains `frontend/build_log.txt` and `build_log2.txt`: failed build output from another machine. They are noise and should not be tracked.

## 2. Architecture map

```
frontend/ (React 19, Vite 8, react-router 7, plain JSX, no types, no tests)
  src/hooks/useNostr.jsx     identity + signing (NIP-07 or raw hex key)
  src/hooks/useRelays.jsx    SimplePool wrapper (publish / query kind 1063)
  src/services/api.js        XHR upload, fetch delete/list, server URL in localStorage
  src/services/blurhash.js   encode/decode helpers
  src/services/compress.js   browser-image-compression, MIME allow-list
  src/pages/{Gallery,Upload,Settings}.jsx
  src/components/{Navbar,LoginPrompt,MediaGrid,MediaCard,MediaViewer,UploadModal}.jsx
  src/index.css              19 kB of global CSS plus heavy inline styles

backend/ (Go 1.23, net/http, modernc SQLite, go-nostr, rs/cors)
  main.go      env config, hand-rolled router, CORS
  auth.go      NIP-98 (kind 27235) validation
  handlers.go  PUT /upload, GET|HEAD /<sha256>, DELETE /<sha256>, GET /list/<pubkey>
  storage.go   flat directory of hash-named files
  database.go  one table user_blobs(pubkey, sha256, ...)

infra: docker-compose.yml (backend, nginx frontend, caddy), Caddyfile, .env.example
```

State is spread over three sources: React context (`pubkey`, `privkey`), `localStorage` (key, pubkey, relays, server URL) and component-local state. There is no cache of relay events, so every visit re-queries relays.

## 3. Findings

Severity: **S1** breaks a core requirement or is exploitable, **S2** wrong or fragile behaviour, **S3** quality.

### 3.1 Protocol conformance

| # | Sev | Finding |
| --- | --- | --- |
| P1 | S1 | Blossom endpoints are authorised with NIP-98 (kind 27235, `u`/`method` tags). Blossom requires BUD-11: kind 24242, a `t` verb tag, `x` hash tags and a mandatory `expiration` tag, sent as base64url. The prototype is not interoperable with Blossom clients or servers. *(read, checked against BUD-11)* |
| P2 | S1 | Server auth does not bind a token to a blob. Any valid token can be replayed for any upload or delete within ±5 minutes. There is no expiration tag check, no `server` scope and no `x` check. |
| P3 | S2 | The NIP-98 `u` check compares against `BASE_URL + path`. Behind a reverse proxy or on a different public host name every request fails with 401. |
| P4 | S2 | `PUT /upload` always returns 200. BUD-02 requires 201 for a new blob and 200 for an existing one. No `HEAD /upload` (BUD-06), no `X-SHA-256` check (409), no `X-Reason`. |
| P5 | S2 | `GET /<sha256>` copies the file with `io.Copy`: no `Range`, so video seeking fails, no `Content-Length`, no file-extension URLs, no `ETag`. |
| P6 | S2 | `GET /list/<pubkey>` ignores `cursor` and `limit` and requires auth. BUD-12 requires both parameters. |
| P7 | S2 | `ServerInfo` claims NIP-96 support. NIP-96 is not implemented. |

### 3.2 Storage and backend

| # | Sev | Finding |
| --- | --- | --- |
| B1 | S1 | Stored XSS: blobs are served with `http.DetectContentType` of the bytes and no `X-Content-Type-Options`. An uploaded HTML file is served as `text/html` from the storage origin. The client also allows `image/svg+xml`. |
| B2 | S1 | Path handling: the router accepts any 64-character path, not 64 hex characters, and joins it into a filesystem path. On Windows hosts a name containing `..\` is a traversal candidate. Containers run Linux, which limits the exposure, but the check is wrong. *(read)* |
| B3 | S1 | Authorised upload/delete is not restricted to an owner. Any key can upload to the server, which makes an open storage host. No allow-list. |
| B4 | S2 | Deduplication race: `BlobExists` then `os.Rename` is not atomic. Concurrent identical uploads both write; on Windows the rename fails if the target appears in between. |
| B5 | S2 | Delete race: ownership row deletion, owner count and file removal are three separate statements without a lock. An upload that dedups against a blob being deleted can leave an ownership row pointing at a missing file. |
| B6 | S2 | SQLite pragmas are written in mattn style (`_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=ON`). The `modernc.org/sqlite` driver ignores them. **Verified by probe:** `journal_mode=delete`, `foreign_keys=0`, `busy_timeout=0`. |
| B7 | S2 | No fsync before rename, temp files live in the blob directory and are never swept after a crash, flat directory (one file per hash) degrades on large stores. |
| B8 | S2 | Content type is taken from the client `Content-Type` or `X-Filename` and stored; it is not verified against the bytes. Original filename from a header is stored and listed. |
| B9 | S2 | No rate limiting, no per-request timeouts, no graceful shutdown, `http.ListenAndServe` with no `ReadHeaderTimeout` (slowloris). |
| B10 | S3 | `too large` detection compares an error string. No health endpoint. Log output contains decorative banners. |

### 3.3 Identity and key handling

| # | Sev | Finding |
| --- | --- | --- |
| K1 | S1 | The private key is stored in plaintext in `localStorage['nostr_privkey']` and also held in React state. This violates the requirement not to persist plaintext keys. |
| K2 | S1 | "Generate a new temporary account" creates a key the user is never shown. Closing the tab loses the identity and every file owned by it. No backup flow. |
| K3 | S2 | `nsec` import is unsupported ("hex only"). No NIP-19 encoding anywhere; the UI shows truncated hex. |
| K4 | S3 | `createNIP98Token` uses `btoa(JSON.stringify(...))`, which throws for non-Latin-1 content. `useCallback` depends on a function recreated each render. |

### 3.4 Frontend behaviour

| # | Sev | Finding |
| --- | --- | --- |
| F1 | S1 | Publishing is broken at runtime. `useRelays.publishEvent` calls `sub.on('ok', ...)` on the result of `pool.publish`, which in the installed nostr-tools 2.25.2 returns `Promise<string>[]` (checked in `abstract-pool.d.ts`). The metadata event is never published by the shipped flow. |
| F2 | S1 | Every gallery card loads the **original** file as its thumbnail (`<img src={url}>`), and every video card autoloads the full video. A 100-item library downloads 100 originals. |
| F3 | S1 | Uploads re-encode images to WebP, ≤ 1 MB, ≤ 1920 px (`browser-image-compression`) before hashing. The stored file is not the user's original; "download the original" is impossible and the hash does not match the source file. |
| F4 | S2 | `decodeBlurhashToDataURL` uses `require('blurhash')` in an ES module. In the browser this throws inside a `try`, returns `null`, and no placeholder is ever drawn. |
| F5 | S2 | `isConnected` in `useRelays` is set to `true` unconditionally after constructing the pool, so the app reports a connection that was never checked. |
| F6 | S2 | Upload progress is partly synthetic: the "processing" bar is set to fixed values (10, 50, 100) and a `setTimeout(…, 1000)` precedes publishing. "Upload Complete" is displayed before the metadata is published. |
| F7 | S2 | Fixed `aspect-ratio: 3/4` crop for all media regardless of the `dim` tag. No virtualization, no pagination (`querySync` without `limit`), no cache. |
| F8 | S2 | Delete swallows server errors, removes the item from local state only, and publishes no NIP-09 deletion event. After a refresh the item returns. |
| F9 | S2 | Settings overwrites the saved storage URL on every keystroke (`checkServer` calls `setServerURL`), and shows "Online" for any 2xx response. |
| F10 | S2 | One file at a time, no queue, no retry, no cancel, no duplicate feedback although the server returns `existed`. |
| F11 | S3 | Emoji used as icons, gradient logo text, glass cards, `animate-fade-in-scale`, inline styles throughout, generic copy ("Welcome to Sovereign Media Hub"). Page `<title>` is "frontend". Default favicon is the Vite one. |
| F12 | S3 | `README.md` in `frontend/` is the unmodified Vite template. No root README. |

### 3.5 Infrastructure

| # | Sev | Finding |
| --- | --- | --- |
| I1 | S1 | The Caddyfile named matcher `@backend` combines `path_regexp` and several `path` lines. Conditions of one matcher are ANDed, so nothing matches and blob/upload requests fall through to the frontend container. The routing does not work. *(read)* |
| I2 | S2 | `backend/Dockerfile` builds with `golang:1.22-alpine` while `go.mod` requires 1.23.1. Final image is `alpine:latest` (unpinned), runs as root, has no health check. |
| I3 | S2 | The backend publishes `8080:8080` to the host in addition to Caddy, bypassing the proxy. Caddy listens on `:80` only; the HTTPS comment is not wired to a variable. |
| I4 | S3 | A separate nginx container serves static files that Caddy could serve. |

## 4. What can be kept

| Keep | Reason |
| --- | --- |
| Go + `net/http` + SQLite (modernc) | Small, dependency-light, static binary; fits a Raspberry Pi target named in the paper. |
| `go-nostr` for event verification | Correct BIP-340 / NIP-01 implementation; no reason to hand-roll cryptography. |
| Streaming tee-hash into a temp file | The right idea; needs an atomic, locked finalisation. |
| Ownership table (`pubkey`, `sha256`) | Matches the multi-owner delete model in BUD-12; gets a schema upgrade. |
| React 19, Vite, react-router | Viable. The code on top is rewritten, the toolchain stays. |
| `nostr-tools`, `blurhash` | Correct libraries for their jobs. |
| Docker Compose + Caddy topology | Kept, with routing and Dockerfiles fixed. |

## 5. What is replaced

| Replace | With |
| --- | --- |
| NIP-98 auth on Blossom endpoints | BUD-11 kind 24242 tokens |
| Plaintext `localStorage` key | NIP-49 encrypted key (`ncryptsec`) or NIP-07 extension; key in memory only after unlock |
| Pool wrapper with broken publish | Relay manager: per-relay state, acknowledgements, reconnection, outbox, IndexedDB cache |
| Original-as-thumbnail | Client-generated thumbnail blob, referenced by the NIP-94 `thumb` tag |
| Lossy pre-upload compression | Original bytes uploaded unchanged |
| JSX, global CSS, inline styles | TypeScript, design tokens, small component set |
| Fixed 3:4 grid | Justified-row layout from `dim`, row virtualization |
| Flat blob directory | Sharded directory, same-filesystem temp area, locked atomic finalisation |
| nginx container, route-less Caddyfile | Caddy serving the build and proxying the Blossom API |

## 6. Risks carried into the plan

1. Docker is unavailable on this machine, so compose validation and container restart tests cannot be run here.
2. Public Nostr relays are outside our control; automated tests use a local relay. Real public relay behaviour is tested manually where possible and reported as such.
3. TLS with a real domain cannot be verified without a domain and open ports 80/443.
