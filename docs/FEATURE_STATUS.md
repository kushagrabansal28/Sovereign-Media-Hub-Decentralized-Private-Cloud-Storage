# Feature status

Status values: **WORKING** (implemented and exercised by an automated test or a run in a real browser), **PARTIAL**, **MISSING**, **NOT TESTED** (implemented, not exercised here). The "Prototype" column is the state at commit `dedb5fe`. "Now" is the state of this branch.

| Feature | Prototype | Now | Evidence or note |
| --- | --- | --- | --- |
| Generate identity | PARTIAL (key never shown) | WORKING | Setup flow with backup step; E2E |
| Import `nsec`, hex, `ncryptsec` | PARTIAL (hex only) | WORKING | `keys.test.ts`, `identity.test.ts` |
| NIP-07 extension sign-in | WORKING | WORKING | Unit tests with a fake extension; not tried with a real extension |
| Encrypted key at rest (NIP-49) | MISSING | WORKING | `identity.test.ts`; E2E inspects storage |
| Key backup, lock, remove | MISSING | WORKING | Setup and Settings; E2E covers the backup step |
| Blossom authorization | wrong scheme (NIP-98) | WORKING | BUD-11, `bud11_test.go` |
| `PUT /upload` | PARTIAL | WORKING | 201/200, `X-SHA-256`, limits, types |
| `HEAD /upload` (BUD-06) | MISSING | WORKING | `TestUploadPreflight` |
| `GET /<sha256>[.ext]` | PARTIAL | WORKING | Range, ETag, nosniff, CSP |
| `HEAD /<sha256>` | PARTIAL | WORKING | |
| `DELETE /<sha256>` | PARTIAL, racy | WORKING | Multi-owner, single-use tokens |
| `GET /list/<pubkey>` | PARTIAL | WORKING | `cursor`, `limit`, `since`, `until` |
| Health and info endpoints | MISSING | WORKING | `/health`, `/info` |
| Server-side hash verification | WORKING | WORKING | |
| Deduplication | PARTIAL (racy) | WORKING | 24 concurrent identical uploads → one file |
| Allow-list, rate limit, timeouts | MISSING | WORKING | |
| Atomic storage, restart reconcile | MISSING | WORKING | Restart test, reconcile tests |
| Relay publish with acknowledgements | BROKEN | WORKING | `relays.test.ts`, integration, E2E |
| Relay query, pagination, dedupe | PARTIAL | WORKING | |
| Per-relay status, reconnect | BROKEN (always "connected") | WORKING | Measured connect time, error text, backoff |
| Offline library, outbox, retry | MISSING | WORKING | IndexedDB; integration and E2E |
| NIP-09 deletion | MISSING | WORKING | Metadata first, then blob |
| Thumbnails | BROKEN (original used) | WORKING | Separate 512 px blob; E2E checks sizes and request counts |
| BlurHash placeholder | BROKEN | WORKING | |
| Gallery layout | PARTIAL (fixed 3:4) | WORKING | Justified rows from `dim`, virtualized; 3 000-item run |
| Search, filter, sort | MISSING | WORKING | Captions, alt, mime, hash prefix, date; type and four sort orders |
| Selection, batch delete and download | MISSING | WORKING | |
| Viewer | PARTIAL | WORKING | Prev/next, zoom, details, copy, verified download, delete, error states |
| Video playback | PARTIAL | WORKING (WebM) | MP4 and MOV depend on browser codecs; not tested |
| Multi-file upload with queue | MISSING | WORKING | Hash → preview → upload → publish, cancel, retry, duplicates |
| Honest upload progress | synthetic | WORKING | Bytes sent from `XMLHttpRequest`; hashing from bytes read |
| Settings with real diagnostics | PARTIAL | WORKING | Measured server round trip, relay state, storage measurement |
| Unindexed-file cleanup | MISSING | WORKING | Settings → Storage |
| Themes, reduced motion, keyboard | MISSING | WORKING | axe clean on six screens |
| Responsive layout | MISSING | WORKING | Four viewports plus ten intermediate widths |
| Backend tests | MISSING | WORKING | Go tests |
| Frontend tests | MISSING | WORKING | Vitest, integration, Playwright |
| Docker Compose and Caddy | BROKEN | NOT TESTED | Rewritten; no Docker on the build machine |
| HTTPS with a real domain | MISSING | NOT TESTED | Needs a domain and open ports |
| End-to-end encrypted media | MISSING | MISSING | Not implemented; listed as future work |
| Per-file sharing links | MISSING | MISSING | |
| Multiple users per server with quotas | MISSING | MISSING | An allow-list exists; quotas do not |
| Search by content (faces, objects) | MISSING | MISSING | |
