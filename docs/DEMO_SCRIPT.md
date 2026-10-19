# Demo script

About 12 minutes. Everything runs on one laptop. Open the repository folder in PowerShell for the commands below.

## Before the demo

Start three things, each in its own PowerShell window, from the repository root. Go and Node must be installed.

```powershell
# 1. Storage server on http://localhost:8787
cd backend; go build -o ..\.run\server.exe .\cmd\server; cd ..
New-Item -ItemType Directory -Force .run\demo | Out-Null
$env:DATA_DIR=".run\demo"; $env:PORT="8787"; $env:BASE_URL="http://localhost:8787"; .\.run\server.exe
```

```powershell
# 2. Relay on ws://localhost:7777 (development relay, keeps events in a file)
cd frontend; npm ci; node tools/dev-relay/relay.mjs --port 7777 --persist ..\.run\demo\relay.jsonl
```

```powershell
# 3. The app on http://127.0.0.1:4173
cd frontend; npm run build; npx vite preview --host 127.0.0.1 --port 4173
```

Use **Chrome**. Use a fresh profile or a private window so that nothing is saved from earlier.

Prepare files on the desktop in a folder called `demo-media`:

| File | Why |
| --- | --- |
| 5 to 8 photos from your phone or laptop (JPG or PNG) | the gallery |
| the same photo copied once more, named `copy-of-photo.jpg` | deduplication |
| 1 short video, MP4 or WebM, under 50 MB | video badge and playback |
| `notes.txt` (any text file) | shows that unsupported files are refused |

## 1. The idea in one minute (screen: first page)

Say: "There is no password. The key is created on this laptop and signs every request. Files go to my own server and are named by their SHA-256. Relays only hold a small index."

Point at the **How it works** column on the right.

## 2. Create the identity

1. Click **Create a new identity**.
2. Passphrase: `demo-passphrase-2026`, repeat it. Click **Continue** (about a second: the key is being encrypted).
3. Say: "The key is saved only in encrypted form, protected by this passphrase."
4. On **Back up your key**: click **Download encrypted backup**. Click **Show secret key (nsec)** and then **Hide**. Tick **I have stored a backup** and **Continue**.
5. Optional: press **Skip backup** first to show the warning dialog, then **Escape**.

## 3. Connect

1. Storage server: leave `http://localhost:8787`, click **Test**. It shows "Reachable · a few ms · v2.0.0".
2. Relay: `ws://localhost:7777` is already listed and shows "Connected". Say: "These are measured, not decorative. If I stop one, the page will say so."
3. Click **Open library**. The empty library explains what to do next.

## 4. Upload (the main part)

1. Drag all files from `demo-media` into the window. The **Drop to upload** target appears.
2. Watch the **Uploads** panel: each file goes through hashing, uploading, publishing, then **Added · 1 relay**.
3. `notes.txt` is refused immediately with "Only JPEG, PNG, GIF, WebP, AVIF, MP4, MOV and WebM files can be uploaded."
4. `copy-of-photo.jpg` shows **Already in your library**. Say: "The same bytes have the same hash, so nothing was sent."
5. Say: "Thumbnails are made in the browser and uploaded as their own small files. The original is never re-encoded."

## 5. Prove it, outside the browser

In a new PowerShell window:

```powershell
# Files on the server: each photo appears twice (original + thumbnail); the copy is not stored again
Get-ChildItem .\.run\demo\blobs -Recurse -File | Measure-Object | Select-Object Count

# The metadata the relay holds: text only, no image bytes
Get-Content .\.run\demo\relay.jsonl | Select-Object -First 1
```

Then open any photo in the app, press **i**, and copy the **SHA-256**. Compare with the original file:

```powershell
Get-FileHash "$env:USERPROFILE\Desktop\demo-media\<your-photo>.jpg" -Algorithm SHA256
```

The two hashes are identical. Say: "The server named the file by the hash of what it received, and the library found it by that name."

## 6. The gallery

1. Hover over a tile: date and size appear. The video has a play badge and its length.
2. Search: type a month such as `2026-10` (matches by date), then clear with **Escape**. Click **Videos**, then **All**.
3. **Sort** menu: Newest added, Oldest added, Date taken, Largest.
4. Resize the browser narrower: the grid reflows, the sidebar becomes icons, then a bottom tab bar.
5. Press `?` to show the keyboard shortcuts.

## 7. The viewer

1. Click a photo. Say: "Only now was the original requested. Before this, only thumbnails were loaded."
2. `←` `→` to move, `+` and `-` to zoom, double-click to zoom, `0` to fit.
3. Press **i**: details with copy buttons for the hash, event id and URL, and the note that URLs are not secret.
4. Click **Download original**: "Saved. The file matched its SHA-256." The browser checked the hash before saving.
5. Open the video: it plays with seeking.
6. **Escape** returns to the same tile.

## 8. Failure handling (this is what impresses)

1. Stop the relay (Ctrl+C in its window). Reload the page and unlock with the passphrase. The library still opens from the device cache. The banner says **No relay is reachable** and how many items are shown from the cache. Start the relay again, click **Retry now**: it reconnects.
2. Stop the storage server. The banner says **The storage server is not reachable** with the address. Open a photo: "This file could not be loaded: the storage server could not be reached." Try an upload: it fails with a reason and a **Retry** button. Start the server again.
3. Say: "Relays and storage fail independently, and the interface tells them apart."

## 9. Delete

1. Open a photo, click the bin icon, read the dialog (it says what is and is not removed), click **Delete**.
2. In PowerShell the blob count drops by two (original and thumbnail).
3. Say: "Metadata is deleted first, then the file. A relay may keep old copies of what it already received."

## 10. Security and settings

1. **Settings → Identity**: the public key, **Lock**, **Back up key**.
2. Chrome DevTools → **Application → Local Storage**: `smh.identity.v1` contains `ncryptsec1…` and the public key, nothing readable. Session Storage is empty.
3. Click **Lock** in the sidebar: the unlock screen appears. A wrong passphrase gives an error and keeps the identity. The right one unlocks.
4. **Settings → Storage → Measure storage** shows the files on the server for this key.
5. **Settings → Appearance**: switch Light and Dark.
6. Read the **What is visible to whom** section aloud: relays see metadata, not files; file URLs are not secret; files are not end to end encrypted.

## 11. Evidence to show if asked

| Claim | Where |
| --- | --- |
| Tests | `cd backend; go test ./...` (42 tests), `cd frontend; npm test` (131 tests), `npx playwright test` (20 browser scenarios) |
| Measurements | `docs/BENCHMARK_RESULTS.md`, charts in `docs/benchmarks/charts` |
| Screenshots | `docs/screenshots` |
| Prototype problems | `docs/REPOSITORY_AUDIT.md` |
| Security | `docs/THREAT_MODEL.md`, `docs/SECURITY_REVIEW.md` |
| Report | `reports/Sovereign_Media_Hub_Final_Review.pdf` |

## Likely questions

- **Why not NIP-98?** Blossom servers expect kind 24242 tokens (BUD-11) bound to a verb, a blob hash, an expiry and a server. The prototype used NIP-98, so no other Blossom server would have accepted it.
- **What if a relay lies?** Events are signature-checked and only the owner's key is accepted. A relay can hide events but cannot forge them.
- **What is public?** Event contents on the relays you choose: your public key, hashes, sizes, times and URLs.
- **What is not done?** End-to-end encryption, container and HTTPS testing (no Docker on the development machine), and a comparison with a commercial service.
