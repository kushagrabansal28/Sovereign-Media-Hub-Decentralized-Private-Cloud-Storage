# Security review

Review of the rewritten code against the threats in `docs/THREAT_MODEL.md`. Method: reading every handler and the auth, store and key-handling code; automated tests for each control listed as "tested"; one end-to-end check of key storage in a real browser. This is a self-review by the authors, not an independent audit.

## Controls reviewed

| Area | Control | Where | Evidence |
| --- | --- | --- | --- |
| Authorization | kind 24242, signature, recomputed event id, verb, `expiration` (future, ≤ 1 h), `x`, `server`, `created_at` not in the future (60 s skew) | `backend/internal/auth/bud11.go` | `bud11_test.go`: wrong kind (NIP-98), future `created_at`, expired, missing/invalid/too-far expiration, wrong verb, two verbs, short tags, bad and uppercase `x`, other server, signature from another key, changed tags, forged id, swapped pubkey, malformed headers, oversized header |
| Replay | Delete tokens are single use (bounded cache that fails closed); upload tokens bound to hashes | `auth.Consume`, `handleDelete` | `TestDeleteTokenCannotBeReplayed`, `TestConsumeFailsClosedWhenFull` |
| Hash integrity | Server hashes the received bytes; mismatch with `X-SHA-256` → 409; mismatch with token → 401; nothing stored on failure | `store.Stage`, `handleUpload` | `TestServerComputesTheHashItself`, `TestTruncatedUploadIsNotStoredAsTheIntendedBlob` |
| File type | Magic-byte allow-list; SVG, HTML, audio, HEIC and unknown types rejected before the body is stored | `internal/media`, `store.Stage` | `TestRejectsUnsupportedAndDangerousTypes`, `sniff_test.go` |
| Serving | Sniffed MIME only, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: cross-origin`, immutable cache | `handleGet` | `TestUploadAndRetrieveRoundTrip` |
| Paths | 64 lowercase hex only, paths derived from the hash, no user-controlled path segment | `store.path`, `blobName` regexp | `TestMalformedBlobPaths` (uppercase, short, extra dot, double extension, `..%2f`, `..%5c`, non-hex) |
| Atomicity | fsync, rename from same-filesystem temp dir, per-hash lock | `store` | `TestConcurrentIdenticalUploads` (24 parallel), `TestConcurrentUploadAndDeleteNeverDangle` |
| Interruption | Temp file removed on any error; temp dir emptied at startup | `store.Stage`, `store.Open` | `TestInterruptedUploadLeavesNoTempFile`, `TestStartupRemovesStaleTempFiles` |
| Ownership | Delete only by an owner; shared blobs survive until the last owner deletes | `db.Unlink` | `TestDeleteKeepsBlobWhileAnotherOwnerRemains`, unauthorized-deletion cases |
| Access control | `ALLOWED_PUBKEYS` allow-list on upload | `checkUploader` | `TestAllowListRestrictsUploads` |
| Limits | `MAX_FILE_SIZE` (declared and streamed), write rate limit, header timeout, idle-read deadline | `server.go`, `main.go` | `TestEnforcesSizeLimit`, `TestRateLimit` |
| CORS | `*` with `Authorization` allowed, preflight, headers present on errors | `server.cors` | `TestCORSAndInfo` |
| Database | WAL, `foreign_keys`, `busy_timeout` actually applied (the prototype's settings were silently ignored) | `db.Open` | `TestSQLitePragmasTakeEffect` |
| Key storage | NIP-49 ciphertext only in `localStorage`; plaintext in a closure; zeroed on lock; session-only mode stores nothing | `frontend/src/stores/identity.ts` | `identity.test.ts` (no plaintext hex/nsec in storage, wrong passphrase keeps identity locked, extension signing mismatch rejected) and E2E "identity setup steps" (storage contains exactly `v`, `pubkey`, `source`, `ncryptsec`; session storage empty) |
| Event validation | Relay events accepted only if owner-signed, kind 1063, http(s) URLs, hash/MIME format | `lib/nostr/events.ts` | `events.test.ts` |
| Signing | Templates are copied before signing; verification always recomputes id and signature (nostr-tools caches a "verified" flag that survives object spread) | `lib/nostr/keys.ts` | `keys.test.ts` (tampered content, wrong id, swapped pubkey, other key's signature, malformed fields) |
| XSS | No `dangerouslySetInnerHTML`; React escaping; strict CSP from Caddy (`script-src 'self'`) | `deploy/Caddyfile` | CSP is configured but was not exercised in a container; see below |
| Containers | Non-root user, read-only root, dropped capabilities, `no-new-privileges`, no published server port | `docker-compose.yml`, Dockerfiles | Not run (no Docker on the build machine) |

## Defects found in the prototype and fixed

See `docs/REPOSITORY_AUDIT.md`: wrong authorization scheme and unscoped tokens (P1, P2), stored XSS through content sniffing (B1), unchecked hash path (B2), open upload (B3), non-atomic dedup and racy delete (B4, B5), ignored SQLite pragmas (B6), plaintext key in `localStorage` (K1), lost-key "temporary account" (K2), Caddy matcher that could not match (I1).

## Defects found during this review

| Finding | Severity | Status |
| --- | --- | --- |
| `go-nostr`'s `CheckSignature` verifies the signature over the recomputed hash and does not compare it to the event's `id` field. A token with a forged `id` would pass signature verification | Medium | Fixed: the id is recomputed and compared; test `forged id` |
| `nostr-tools` `finalizeEvent` mutates the template it is given, so signing the same template object twice yields one shared object | Low | Fixed: templates are copied before signing |
| `nostr-tools` `verifyEvent` returns a cached result stored on the event; copying an event with object spread keeps the cached "true" after tampering | Medium (library behaviour) | Fixed: events are rebuilt from their seven fields before verification |
| Tile accessible name did not contain the visible video badge text (axe `label-content-name-mismatch`) | Low (accessibility) | Fixed |

## Residual risks

1. **Open servers.** With `ALLOWED_PUBKEYS` empty, anyone can store files. The default for development is open; production docs and `.env.example` say to set it.
2. **No end-to-end encryption.** The server operator can read all files. Stated in the UI and docs.
3. **Public metadata.** Events on public relays reveal the owner key, hashes, times and URLs.
4. **Public file URLs.** No per-file access control.
5. **Passphrase strength.** The encrypted key can be attacked offline. scrypt 2^16 raises the cost; there is no minimum beyond 8 characters.
6. **XSS on the app origin** while the identity is unlocked could use the in-memory key. The CSP and absence of HTML injection sinks reduce this; the CSP has not been verified in a running container.
7. **Container and TLS configuration is unverified** on the build machine (no Docker, no domain). They are written to be correct but unproven.
8. **Clock dependence.** Device clocks off by more than a minute cause 401s on upload.
9. **Race detector.** `go test -race` could not be run here (the available C toolchain is 32-bit). Concurrency is covered by stress tests, and the race detector is configured to run in CI on Linux (`.github/workflows/ci.yml`).
10. **Dependency review** is by inspection of lockfiles; no automated vulnerability scan was run.
