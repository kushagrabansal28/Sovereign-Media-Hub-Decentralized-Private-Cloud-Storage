# Event schema

The library index uses events defined by existing Nostr specifications. No new event kinds are introduced.

## File metadata: NIP-94, kind 1063

One event per file. Signed with the owner's key.

| Tag | Source | Format | Written by this app | Notes |
| --- | --- | --- | --- | --- |
| `url` | NIP-94 | absolute http(s) URL | yes | The descriptor URL returned by the storage server, with extension |
| `m` | NIP-94 | lowercase MIME type | yes | The type the server detected from the bytes |
| `x` | NIP-94 | SHA-256 hex of the stored file | yes | Content address; also the key used for deduplication |
| `ox` | NIP-94 | SHA-256 hex of the original | yes | Equal to `x`: the app never transforms originals |
| `size` | NIP-94 | bytes, decimal | yes | |
| `dim` | NIP-94 | `<width>x<height>` | when known | Orientation-corrected; drives the gallery layout |
| `blurhash` | NIP-94 | BlurHash string | images and videos with a decodable frame | 4×3 components |
| `thumb` | NIP-94 | `["thumb", url, sha256]` | when a preview could be made | WebP (JPEG where the browser cannot encode WebP), longest side 512 px, stored as its own blob |
| `alt` | NIP-94 | text | read only | Shown if present |
| `smh-taken` | **extension** | Unix seconds | yes | File last-modified time at upload, used as a capture-time hint |
| `smh-duration` | **extension** | seconds, decimal | videos | |

`content` is a free-text caption; the app writes an empty string and displays whatever is there.

Readers ignore unknown tags, so other NIP-94 clients can still use `url`, `m`, `x`, `size`, `dim`, `blurhash` and `thumb`. Extension tags carry the prefix `smh-` to avoid colliding with other tag names. Nothing breaks if they are dropped.

### Validation on read

Events from relays are untrusted input. An event is accepted into the library only if:

* the relay connection layer verified its id and BIP-340 signature,
* `pubkey` equals the library owner (the subscription also filters on `authors`),
* `kind` is 1063,
* `url` is an `http` or `https` URL of at most 2048 characters (`javascript:`, `data:` and others are rejected),
* `x` is 64 lowercase hex characters and `m` is `image/*` or `video/*`.

Optional tags that fail their format check (`dim`, `size`, `blurhash`, `thumb`, `smh-*`) are ignored; the event is kept.

### One entry per file

Several events can describe the same `x` (two devices, or a retry). The library shows the earliest and treats the rest as aliases: deleting a file publishes a deletion for all of them.

## Deletion: NIP-09, kind 5

```json
{ "kind": 5, "tags": [["e", "<event id>"], ["e", "<event id>"], ["k", "1063"]], "content": "Removed from library" }
```

Only deletions signed by the library owner are honoured. NIP-09 asks relays to drop the referenced events; it does not oblige them to. The client also hides deleted events locally, so a relay that ignores the request does not bring the file back in this app.

## Blossom authorization: kind 24242 (not a Nostr library event)

Sent only to the storage server in the `Authorization` header, never to relays. See `docs/API.md`.

| Tag | Meaning |
| --- | --- |
| `t` | exactly one verb: `upload`, `delete`, `list` (and `get`, unused) |
| `x` | blob hash(es) the token covers; required for `upload` and `delete` |
| `expiration` | Unix seconds, required, at most 1 hour ahead (the client uses 5 minutes, 10 for uploads) |
| `server` | host name of the server the token is meant for |

NIP-98 (kind 27235) is a different mechanism for authenticating HTTP APIs and is not used here.

## What is public

Anything in a kind 1063 or kind 5 event is visible to every relay that receives it and to anyone who can query that relay: the owner's public key, file hash, type, size, dimensions, the BlurHash, the file URL and thumbnail URL, upload time, and file modification time. The number and timing of uploads is also visible. Use a relay you control if this matters.

## Interoperability limits

* Other Blossom or NIP-94 clients can read these events but will not understand `smh-*` tags.
* Libraries created by other clients may lack `thumb` and `dim`. The gallery then shows the original as its preview (images) or a placeholder (videos), and tiles use a default aspect ratio.
* `ox` equals `x` here. If another tool re-encodes files, its events may carry different values; the app uses `x` for identity.
