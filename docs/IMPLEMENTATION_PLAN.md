# Implementation plan

Order follows the delivery sequence in the project brief. Design tokens are created in phase 7 but the protocol layers (phases 3–6) are written so that the UI can be built directly on them.

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| Storage auth | BUD-11: kind 24242, `t`, `x`, `expiration`, optional `server`, base64url. NIP-98 is not used on Blossom routes. | The prototype used the wrong mechanism (audit P1). |
| Metadata event | NIP-94 kind 1063 with standard tags `url`, `m`, `x`, `ox`, `size`, `dim`, `blurhash`, `thumb`, `alt`. One extension tag, `smh-taken`, documented in `docs/EVENT_SCHEMA.md`. No new kinds. | Brief forbids inventing kinds; NIP-94 fits exactly. |
| Deletion on relays | NIP-09 kind 5 with `e` and `k` tags. Relay honouring is not guaranteed and is documented. | Prototype only hid the item locally. |
| Thumbnails | Generated in the browser at upload, stored as their own blob, referenced via `thumb`. Originals are uploaded untouched. | Fixes F2 and F3. |
| Hashing | Streaming SHA-256 in a Web Worker (`@noble/hashes`), computed before upload so the token can carry the `x` tag. Server recomputes independently. | BUD-11 requires `x` for upload. |
| Key custody | NIP-49 `ncryptsec` in `localStorage`, passphrase unlock, plaintext key only in a closure in memory. NIP-07 extension supported as an alternative. | Fixes K1, K2. |
| Server language | Keep Go. Layout: `internal/auth`, `internal/store`, `internal/server`. | Existing viable foundation. |
| Server access control | `ALLOWED_PUBKEYS` allow-list for upload; deletion only by owner. | Fixes B3. |
| Frontend | TypeScript, React 19, Vite. State in small `useSyncExternalStore` stores. No UI framework. `lucide-react` icons. Self-hosted IBM Plex fonts (no third-party font requests in a privacy product). | Types and tests are required; avoids overlapping libraries. |
| Gallery layout | Justified rows computed from `dim`, row-level virtualization. | No layout shift, scales to thousands of items. |
| Cache | IndexedDB: verified events, outbox of unsent signed events. | Offline browsing and retry. |
| Test relay | A small Node relay in `tools/dev-relay` (in memory, optional JSON-lines persistence). Used for dev and automated tests only. | Public relays are not reproducible. |
| Tests | Go `testing` for server; Vitest for libraries and components; Playwright (using installed Chrome) for E2E, screenshots and axe checks. | Matches brief. |
| Reports | Markdown source → DOCX (`docx` npm package) and PDF (Chrome print of generated HTML). | No Word/LibreOffice on machine. |

## Phases

| Phase | Work | Exit criteria |
| --- | --- | --- |
| 1–2 | Audit, plan, feature status | These three docs committed |
| 3 | Fix Dockerfiles, Caddyfile, env handling, ignore build logs, TypeScript/Vitest/Prettier setup | `npm run build`, `go build` clean on both |
| 4 | Server auth package (BUD-11) with tests; client identity module (generate, import, NIP-19, NIP-49, sign) with tests | Invalid signature, wrong id, expiry, bad tags, wrong verb, wrong hash, wrong server all rejected in tests |
| 5 | Blob store (atomic, sharded, locked), DB schema, HTTP handlers, allow-list, rate limit; Go tests incl. concurrency | `go test -race` passes (race detector needs cgo; if unavailable the limitation is recorded) |
| 6 | Relay manager, event schema, IndexedDB cache, outbox, dev relay; Vitest integration against the dev relay | Publish, query, dedupe, outage, reconnect covered |
| 7 | Design tokens, base components, app shell, first-run | Reviewed in the running app |
| 8 | Library, upload queue, viewer, settings with real status | Full lifecycle works against a real server and relay |
| 9 | Performance and accessibility pass | Measured before/after, axe clean |
| 10 | Security hardening, threat model, security review, compose/Caddy | `caddy validate` not possible without Caddy; static review documented |
| 11 | End-to-end tests; fix what breaks | E2E run recorded honestly |
| 12 | Visual QA at four viewport sizes with real screenshots; copy audit | Findings fixed and re-reviewed |
| 13 | Benchmarks (`scripts/benchmarks`) with CSV and generated charts | Numbers come from the scripts |
| 14 | Final report (MD, DOCX, PDF) extending the first review paper | Files validated |
| 15 | Final diff, docs, acceptance checklist | `docs/ACCEPTANCE.md` with PASS/FAIL/BLOCKED |

## Known limits, stated up front

* Container checks cannot be run here (no Docker). They are reported as BLOCKED.
* Production TLS needs a public domain and open ports. Not verifiable here.
* Metadata published to relays is public. Media confidentiality depends on the storage server being private; blob URLs are not secret.
* No end-to-end encryption of media is implemented. It is listed as future work, not claimed.
