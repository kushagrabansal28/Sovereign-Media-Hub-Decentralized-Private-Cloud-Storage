# Storage server API

The server implements Blossom: BUD-01 (retrieval), BUD-02 (upload and descriptors), BUD-06 (upload pre-flight), BUD-11 (authorization) and BUD-12 (list and delete). Specifications: <https://github.com/hzrd149/blossom>.

All responses carry `Access-Control-Allow-Origin: *`. Errors carry an `X-Reason` header and a JSON body `{"error": "...", "status": n}`.

## Authorization

`Authorization: Nostr <base64url(JSON event)>` with a kind 24242 event. The server checks, in this order:

1. header parses; payload is at most 16 KiB; base64url (padded and standard alphabets are also accepted for older clients),
2. `kind` is 24242,
3. the event id equals the SHA-256 of its serialisation (a forged `id` field is rejected) and the BIP-340 signature is valid,
4. `created_at` is not in the future, allowing 60 s of clock skew (`CLOCK_SKEW_SECONDS`),
5. an `expiration` tag exists, is in the future, and at most `MAX_TOKEN_TTL_SECONDS` (3600) away,
6. exactly one `t` tag, equal to the verb of the endpoint,
7. if `server` tags exist, one matches this server's host (`BASE_URL` host plus `PUBLIC_HOSTS`),
8. where the endpoint needs it, an `x` tag equals the blob hash.

Delete tokens are single use: the event id is remembered until the token would have expired. Without this, a captured token could remove a blob that was later uploaded again.

## Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /<sha256>[.ext]` | none | Blob bytes. `Range`, `ETag`, `Cache-Control: public, max-age=31536000, immutable`. Extension is optional and ignored. |
| `HEAD /<sha256>[.ext]` | none | Existence and headers. |
| `PUT /upload` | `upload`, `x` | Store a blob. `201` new, `200` already stored. Body is the raw file. |
| `HEAD /upload` | `upload`, `x` | Pre-flight (BUD-06): `X-SHA-256`, `X-Content-Length`, `X-Content-Type`. |
| `DELETE /<sha256>` | `delete`, `x` | Remove the caller's ownership; remove the file when no owner is left. |
| `GET /list/<pubkey>` | `list` | The caller's blobs, newest first. Only the owner may list. `cursor`, `limit` (1–1000, default 100), `since`, `until`. |
| `GET /info` (also `GET /`) | none | Name, version, limits, allowed types, upload policy. |
| `GET /health` | none | `{"status":"ok"}` after a database check. |

### `PUT /upload`

Headers: `Authorization` (required), `X-SHA-256` (optional, lowercase hex), `Content-Type` (ignored; the server sniffs the bytes).

The server streams the body to a temporary file while hashing it and checks the leading bytes. It then compares the computed hash with `X-SHA-256` (409 on mismatch) and with the token's `x` tags (401 if the token does not cover these bytes). A client-supplied hash is never trusted.

Response (BUD-02 blob descriptor):

```json
{ "url": "https://media.example.org/<sha256>.jpg", "sha256": "…", "size": 123456, "type": "image/jpeg", "uploaded": 1760000000 }
```

| Status | Meaning |
| --- | --- |
| 200 / 201 | stored (already present / new) |
| 400 | malformed `X-SHA-256`, or the body did not finish arriving |
| 401 | token missing, invalid, expired, wrong verb, or not scoped to these bytes |
| 403 | `ALLOWED_PUBKEYS` is set and this key is not in it |
| 409 | `X-SHA-256` does not match the bytes |
| 413 | larger than `MAX_FILE_SIZE` |
| 415 | not JPEG, PNG, GIF, WebP, AVIF, MP4, MOV or WebM |
| 429 | rate limit (`RATE_LIMIT_PER_SECOND`, `RATE_LIMIT_BURST`) |

### `DELETE /<sha256>`

Ownership model: every key that uploads a blob becomes an owner of it. Deleting removes only the caller's ownership. The file is deleted when the last owner is gone. `200` with `{"sha256", "file_removed", "owners_remaining"}`; `404` if the blob does not exist or the caller does not own it (the two cases are not distinguished).

The server cannot see which Nostr events refer to a blob. The client publishes the kind 5 deletion first, then asks the server to delete. See `docs/ARCHITECTURE.md`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `DATA_DIR` | `./data` | SQLite database, blobs and temp files |
| `BASE_URL` | `http://localhost:$PORT` | Public address; used in descriptor URLs and as the default token `server` host |
| `PUBLIC_HOSTS` | | Extra accepted `server` tag hosts |
| `MAX_FILE_SIZE` | `104857600` | Bytes |
| `ALLOWED_PUBKEYS` | empty (open) | Comma-separated hex or npub keys allowed to upload |
| `MAX_TOKEN_TTL_SECONDS` | `3600` | Longest accepted token lifetime |
| `CLOCK_SKEW_SECONDS` | `60` | Tolerance for client clocks that run ahead |
| `TRUST_PROXY` | `false` | Use the last `X-Forwarded-For` entry as the client address. Set to `true` only behind a proxy that overwrites the header |
| `RATE_LIMIT_PER_SECOND` / `RATE_LIMIT_BURST` | `5` / `30` | Per-client limit on `upload`, `delete`, `list`. `0` disables. Reads are never limited |

Command-line flags: `-healthcheck` (probe `/health`, for container health checks) and `-scrub` (re-hash every stored blob and report corruption).

## Differences from the BUD text

* `created_at` may be up to `CLOCK_SKEW_SECONDS` ahead of the server clock instead of strictly in the past.
* Tokens live at most `MAX_TOKEN_TTL_SECONDS`, which the BUD leaves open.
* `list` requires a token and only lists the caller's own blobs (BUD-12 allows servers to require auth).
* `GET` is unauthenticated. A blob URL is readable by anyone who has it.
* BUD-03, 04, 05, 07, 08 and 09 (server list, mirroring, media optimisation, payments, NIP-94 tags, reports) are not implemented.
