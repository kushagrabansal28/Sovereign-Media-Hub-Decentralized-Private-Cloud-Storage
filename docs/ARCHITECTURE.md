# Architecture

Sovereign Media Hub has three parts. The names come from the project paper.

| Part | Role | Implementation |
| --- | --- | --- |
| Client | Holds the identity, signs, hashes, uploads, queries, renders | `frontend/`: React 19, TypeScript, Vite |
| Nostr relays (the "brains") | Stores and distributes small metadata events | Any Nostr relay; `frontend/tools/dev-relay` for development |
| Blossom storage server (the "brawn") | Stores file bytes under their SHA-256 | `backend/`: Go, SQLite, Blossom API |

```
            signs locally                 kind 1063 / kind 5 events
 Client ─────────────────────► Relays ◄──────────────────────────────┐
   │  ▲                       (metadata only)                         │
   │  │ query, subscribe                                              │
   │  └───────────────────────────────────────────────────────────────┘
   │ PUT /upload, GET /<sha256>, DELETE /<sha256>, GET /list/<pubkey>
   ▼ Authorization: Nostr <kind 24242 token>
 Storage server (Blossom) ── blobs/ab/cd/<sha256> + sovereign.db
```

## Upload lifecycle

1. The user picks files. Each is checked against the server's file-type and size limits (magic bytes, not the extension).
2. The client computes SHA-256: `crypto.subtle` for files up to 32 MiB, a streaming Web Worker above that.
3. If the library already holds that hash, the file is reported as a duplicate and nothing is sent.
4. The browser decodes the file, reads its dimensions, makes a 512 px thumbnail and a BlurHash. The original is never re-encoded.
5. One token is signed with `x` tags for the original and the thumbnail, then both are sent with `PUT /upload` and `X-SHA-256`.
6. The server streams the body to a temporary file while hashing, checks the file type, compares the hash with the header and the token, then renames the file into `blobs/ab/cd/<sha256>` under a per-hash lock and records ownership in SQLite. It answers 201 (new) or 200 (already stored).
7. The client builds a NIP-94 event from the server's descriptor, signs it, saves it to the local outbox and publishes it to every relay.
8. Each relay's `OK` is recorded. The upload is "added" when the server has the bytes and the event is signed and queued; the panel shows how many relays accepted it. Events no relay has accepted stay in the outbox and are retried when a relay connects.
9. Opening an item loads the thumbnail first and the original only when the viewer opens.

## Where state lives

| State | Location | Notes |
| --- | --- | --- |
| Private key | Encrypted (NIP-49) in `localStorage`, plaintext only in a JS closure while unlocked; or held by a NIP-07 extension | Never sent anywhere |
| Settings | `localStorage` | Server URL, relays, theme |
| Metadata events | IndexedDB `events` | Bounded at 20 000; offline browsing |
| Unsent events | IndexedDB `outbox` | Retried per relay until every configured relay has accepted |
| Blobs | Server filesystem | |
| Ownership, sizes, types | Server SQLite | |

Frontend code is layered: `lib/` (protocols, no React), `stores/` (state and orchestration, `useSyncExternalStore`), `components/` and `pages/` (presentation). `services.ts` creates the long-lived instances.

## Storage server layout

```
data/
  sovereign.db         SQLite (WAL): blobs(sha256, size, mime, created_at), owners(pubkey, sha256, uploaded)
  blobs/ab/cd/<hash>   two levels of sharding; files are immutable
  tmp/                 in-flight uploads; emptied at startup
```

Writes are atomic: data is fsynced in `tmp/`, then renamed. The rename and the database insert happen under a per-hash lock, and so does deletion, so an upload that deduplicates against a blob cannot race with the delete that removes it.

## Deduplication

Identical bytes have identical SHA-256, so they map to one path. A second upload by the same or another key creates an ownership row and no second file. The server hashes what it received; a client-supplied hash is only compared. Concurrent identical uploads are covered by a test (24 simultaneous requests: one 201, 23 × 200, one file on disk).

## Ownership and deletion

* Each key that uploads a blob owns it. Deleting removes the caller's ownership. The file goes only when the last owner does.
* The server does not know which events refer to a blob. The client deletes metadata first (NIP-09 for every event that carries the hash), then asks the server to delete the original and the thumbnail. If the server step fails, the file stays on the server under the user's key and appears in Settings → Storage as "not in the library", from where it can be deleted.
* Two events can describe one file. Deleting hides all of them.

## Failure behaviour

| Condition | What the user sees |
| --- | --- |
| Relay unreachable | Library opens from the local cache; banner states that no relay is reachable and how many cached items are shown; uploads still succeed and are queued for relays |
| Some relays unreachable | Sidebar shows `n of m`; Settings lists each relay with its reason; events are delivered to the rest and queued for the others |
| Relay rejects an event | Per-relay `rejected` with the relay's message; the event stays queued |
| Storage server unreachable | Banner with the address and error; thumbnails show as unavailable; viewer explains the failure; uploads fail with a reason and a retry |
| Browser offline | Banner states that the app runs from this device; cached metadata is shown |
| Upload interrupted | The server discards the partial temporary file; retry re-sends |
| Server crash between rename and database write | A file with no row is left in place and adopted by the next upload of the same bytes; a row without a file is dropped at startup |

## Decisions and trade-offs

* **Thumbnails are separate blobs.** Relays cannot carry them and the server does not transcode. The cost is one extra small upload per file; the benefit is that browsing never touches originals.
* **No end-to-end encryption.** Keeping file bytes readable by the server operator keeps range requests, deduplication and thumbnails simple. A design that encrypts per file would lose deduplication across keys.
* **Public blob URLs.** `GET /<sha256>` needs no token, as in BUD-01. Anyone with a hash can fetch it.
* **Client-side hashing before upload.** Required because BUD-11 upload tokens carry the blob hash; it also allows skipping duplicates without sending bytes.
* **Go and SQLite on the server.** One static binary, no external services; suits a Raspberry Pi or a small VPS.
