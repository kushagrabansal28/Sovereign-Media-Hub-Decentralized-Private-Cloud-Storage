# Testing

Four layers. Each can be run on its own.

| Layer | Tool | Location | What it covers |
| --- | --- | --- | --- |
| Server unit and HTTP tests | Go `testing`, `httptest` | `backend/internal/**/_test.go` | Authorization, storage, deduplication, concurrency, limits, persistence |
| Library and store tests | Vitest | `frontend/src/**/*.test.ts` | Keys, signing, events, relay manager, layout, queries, identity lifecycle |
| Integration tests | Vitest, real Go server, development relay | `frontend/tests/integration` | Upload → index → retrieve, duplicates, relay failure and recovery, server restart, deletion |
| End-to-end and visual | Playwright in the installed Chrome | `frontend/e2e` | The built app in a real browser: first run, uploads, gallery, viewer, keyboard, accessibility (axe), layout at four viewports, degraded states |

## Commands

```powershell
# Server
cd backend
gofmt -l .
go vet ./...
go test ./...
go test -race ./...        # needs a 64-bit C toolchain; run in CI on Linux

# Library, stores, integration (builds and starts the Go server itself)
cd frontend
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test

# Browser tests (builds first so the preview server serves current code)
npm run build
npx playwright test                       # everything
npx playwright test e2e/flow.spec.ts      # the main story
npx playwright test e2e/visual.spec.ts    # screenshots into docs/screenshots, axe, overflow, keyboard
npx playwright test e2e/degraded.spec.ts  # storage server down
```

Go must be on `PATH` (or set `GO`). Playwright uses the installed Chrome (`channel: 'chrome'`); no browser download is needed.

## What the end-to-end tests assert

* **Story**: create an identity, back it up, point at a server and relay, upload six JPEGs and one WebM. Seven kind 1063 events reach the relay, each with a `thumb` tag and no media bytes. The gallery shows decoded thumbnails no larger than 512 px and no original has been requested. Opening an item deep-links to `/m/<sha256>`, loads the original, supports ←/→, `i`, Esc and returns focus to the grid.
* **Integrity**: a downloaded original hashes to the SHA-256 in the URL.
* **Duplicates**: uploading the same file again reports "Already in your library" and adds nothing.
* **Persistence and outage**: after the relay is stopped and the page reloaded, the cached library is shown with an explicit "No relay is reachable" banner.
* **Deletion**: the blob returns 404, the relay no longer holds the event, the tile disappears.
* **Key handling**: after setup, browser storage holds exactly `v`, `pubkey`, `source` and `ncryptsec`; session storage is empty; no `nsec1…` string appears anywhere in storage or the URL; the secret is not in the page text until "Show secret key" is pressed.
* **Accessibility**: axe (WCAG 2.0/2.1 A and AA) finds no violations on the welcome, protect-key, library (light and dark), viewer, settings and unlock screens.
* **Responsive**: no horizontal overflow at 1920, 1440, 820 and 390 px for welcome, library, viewer and settings, and none at ten intermediate widths from 1280 down to 360 px; no tile leaves the viewport.
* **Keyboard**: the grid is one Tab stop, arrow keys move between tiles, a focus outline is drawn; `prefers-reduced-motion` removes transitions.
* **Degraded states**: with the storage server stopped, the app shows the server banner, the sidebar says "Unreachable", the viewer explains the failure, and a new upload fails with a reason and a Retry button.

## Known gaps

* No container tests: Docker was not available on the development machine, so Dockerfiles, Compose and Caddy are not exercised (see `docs/DEPLOYMENT.md`). The CI workflow runs `docker compose config` and `docker compose build` where Docker exists.
* `go test -race` could not be run locally (32-bit MinGW only). It is configured in CI.
* No test uses a public relay or a real domain.
* Only Chrome is used. Firefox and Safari behaviour (for example WebP encoding in `canvas`, which falls back to JPEG) is handled in code but not tested.
* Video thumbnails are tested with a browser-recorded WebM. MP4 and MOV thumbnails depend on the browser's codecs and are not tested.
* There is no load test for very large files (multi-gigabyte). The streaming hash path used above 32 MiB is covered by the benchmark script only up to 50 MB.
