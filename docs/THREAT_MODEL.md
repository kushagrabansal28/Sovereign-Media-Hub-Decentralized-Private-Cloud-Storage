# Threat model

Scope: the web client, the storage server and the relay interaction as built in this repository. Out of scope: the host operating system, the browser, relay software, DNS and certificate authorities.

## Assets

| Asset | Why it matters |
| --- | --- |
| Private key | Lets its holder sign uploads, deletions and metadata as the user |
| Media bytes | Personal photos and videos |
| Metadata events | Reveal what exists, when, and where it is stored |
| Server availability and storage space | An open server can be filled by strangers |
| Integrity of the library | A wrong hash or URL shows the wrong picture |

## Actors

* **Passive observer**: network or relay operator who reads traffic and public events.
* **Malicious relay**: serves forged, altered, replayed or missing events.
* **Remote attacker**: sends crafted HTTP requests to the storage server.
* **Token thief**: obtains a valid authorization header (logs, proxy, XSS).
* **Local attacker**: has read access to the browser profile on the user's device.
* **Malicious uploader**: a Nostr key that wants to store or serve harmful content.

## Threats and mitigations

| # | Threat | Mitigation | Residual risk |
| --- | --- | --- | --- |
| T1 | Private key stolen from browser storage | Only the NIP-49 ciphertext (scrypt, 2^16) is stored; the key lives in memory after unlock; session-only mode stores nothing | A weak passphrase can be brute-forced offline. XSS on the app origin while unlocked can use the key |
| T2 | Key sent to server or relay | Signing happens in the browser; the key never appears in a request, URL or event. Verified by E2E test that inspects storage and the DOM | None known |
| T3 | Forged or tampered authorization token | Server recomputes the event id and verifies the BIP-340 signature; checks kind, verb, `x`, `expiration`, `server` | None known |
| T4 | Token replay (cross-server) | `server` tag must match the server's host | A token without `server` tags from another client is accepted by every server that does not require them |
| T5 | Token replay (same server) | Tokens expire (≤ 1 h; client uses 5–10 min) and are bound to specific hashes; delete tokens are single use | A captured upload token can re-upload the same blob until it expires (idempotent) |
| T6 | Relay forges events | Signatures are verified by the relay layer; only events whose `pubkey` is the owner are accepted | A relay can hide or delay events. Using several relays and the local cache limits impact |
| T7 | Relay injects dangerous URLs | Event `url` and `thumb` must be http(s); other schemes are dropped. File bytes from the server are served with `nosniff`, a restrictive CSP and `sandbox` | A signed event by the owner can still point to any http(s) host, so the library can contact third-party hosts it names |
| T8 | Stored XSS through uploaded files | The server accepts only JPEG, PNG, GIF, WebP, AVIF, MP4, MOV, WebM by magic bytes; SVG, HTML and audio are rejected; responses carry the sniffed type, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox` | A polyglot file that is a valid image and something else is served as the image type only |
| T9 | Path traversal | Hash must be 64 lowercase hex characters; paths are derived from it; tested with traversal strings and Windows separators | None known |
| T10 | Storage exhaustion by strangers | `ALLOWED_PUBKEYS` allow-list, `MAX_FILE_SIZE`, per-client rate limit on writes, idle-read deadline | An open server (empty allow-list) accepts any key, by design for development. Disk quotas are not implemented |
| T11 | Slow clients holding connections | `ReadHeaderTimeout`, idle timeout, per-read deadline during uploads | |
| T12 | Corrupted or truncated upload stored | Hash is computed on received bytes; `X-SHA-256` mismatch → 409; temp file removed on any error; `-scrub` re-verifies stored blobs | Bit rot after storing is detected only by scrub or by client download verification |
| T13 | Deleting someone else's file | Delete needs a token from an owner; unknown and not-owned blobs both return 404 | |
| T14 | Race between upload and delete | Per-hash lock around commit and unlink | |
| T15 | Deleted data reappears | Metadata deletion is NIP-09 (advisory); the client hides deleted events locally | A relay may keep and serve deleted events; other clients may show them |
| T16 | Library metadata leaks | Documented: events on public relays are public. UI states this in Settings. Users can run their own relay | Hashes, owner key, times and URLs are observable. Traffic analysis is not addressed |
| T17 | Blob URL guessed or shared | Hashes are 256-bit, but not secret once shared | Anyone with the URL can download. No per-file access control |
| T18 | Operator reads files | Not mitigated: no end-to-end encryption | The server operator can read every stored file |
| T19 | Clickjacking, mixed content | `frame-ancestors 'none'`; the UI explains why an https page cannot use `ws://` relays | |
| T20 | Dependency compromise | Small dependency set, lockfiles committed, no runtime CDN or third-party fonts | Supply-chain review is manual |
| T21 | CORS abuse | `Access-Control-Allow-Origin: *` is required by BUD-01 for browser clients; no cookies or ambient credentials exist, authorization is an explicit signed header | Any website can call the API with a token it already holds |

## Trust assumptions

* The browser's JavaScript engine and WebCrypto are correct and not compromised.
* The user's device clock is within a minute of the server's. If not, uploads fail with a 401 and Settings says why.
* The reverse proxy (Caddy) overwrites `X-Forwarded-For`; `TRUST_PROXY` is only set behind it.
* Relays are untrusted for integrity but needed for availability of the index.

## Not covered

* Denial of service by volume (use a firewall or the proxy's own limits).
* Per-file sharing, expiring links, multi-user quotas.
* Encryption at rest on the server (use disk encryption).
* Key rotation. A compromised key means a new identity and re-uploading.
