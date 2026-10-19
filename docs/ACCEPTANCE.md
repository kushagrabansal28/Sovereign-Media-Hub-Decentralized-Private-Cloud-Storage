# Acceptance checklist

Status: **PASS**, **FAIL**, **BLOCKED** (could not be checked here), **NOT IMPLEMENTED**. Evidence is a test, a measurement or a file in this repository. The last full run of every suite was made on the final commit; commands are in `docs/TESTING.md`.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Existing prototype inspected, important problems documented | PASS | `docs/REPOSITORY_AUDIT.md` (probe results included) |
| 2 | Existing useful work preserved | PASS | Go + SQLite + go-nostr, React + Vite, Compose + Caddy topology kept; replaced parts listed in the audit |
| 3 | Frontend builds | PASS | `npm run build` (tsc + vite) |
| 4 | Backend starts | PASS | Server started by tests, benchmarks and E2E; `-healthcheck` flag |
| 5 | Identity generation and import work | PASS | `keys.test.ts`, `identity.test.ts`, E2E setup |
| 6 | Private keys remain client-side | PASS | Tests; E2E checks storage, DOM and URL; no key in any request by construction (signing is local) |
| 7 | Authentication follows the supported protocol | PASS | BUD-11 checked against the specification text; `bud11_test.go` |
| 8 | Unauthorized operations are rejected | PASS | Server tests: missing, wrong verb, wrong hash, expired, forged, foreign owner, allow-list |
| 9 | Actual media uploads work | PASS | Integration and E2E with real PNG, JPEG and WebM files |
| 10 | Hashes are independently verified | PASS | `TestServerComputesTheHashItself`, truncated-body test |
| 11 | Duplicate uploads do not create duplicate blobs | PASS | `TestConcurrentIdenticalUploads`; dedup benchmark |
| 12 | Blob retrieval returns correct bytes | PASS | Round-trip, range and download-verification tests |
| 13 | Metadata publication and relay queries work | PASS | `relays.test.ts`, integration, E2E (kind 1063 events seen at the relay) |
| 14 | Gallery renders real media | PASS | E2E: decoded thumbnails, sizes ≤ 512 px; 3 000-item run |
| 15 | Full-resolution files load on demand | PASS | E2E: no original requested while browsing; benchmark counts |
| 16 | Loading, error, offline and sync states are accurate | PASS (offline browser mode not tested with the network disabled) | E2E: relay down, server down, failed upload; `docs/ARCHITECTURE.md` failure table |
| 17 | No fake metrics or system states | PASS | Every figure shown comes from a measurement or a store; reviewed in the visual pass |
| 18 | Coherent, distinctive design system | PASS | `src/styles/tokens.css`; screenshots in `docs/screenshots` |
| 19 | Generic template styling removed | PASS | No gradients, glass, blobs, emoji icons or decorative shapes; reviewed in screenshots |
| 20 | Marketing-style filler removed | PASS | Copy audited; the first-run text states what the product does and what it does not protect |
| 21 | Every visible control has a real action | PASS | Reviewed screen by screen; disabled controls say why |
| 22 | Works at desktop, laptop, tablet, mobile | PASS | E2E at 1920, 1440, 820, 390 and ten intermediate widths; no overflow |
| 23 | Keyboard navigation and accessibility checked | PASS (automated) | axe clean on six screens; keyboard test. No screen-reader or user testing |
| 24 | Docker configuration validates | BLOCKED | No Docker on the development machine; CI runs `docker compose config` |
| 25 | Persistence survives service restarts | PASS for the server process; BLOCKED for containers | Restart test with same data directory |
| 26 | Automated test results recorded honestly | PASS | `docs/TESTING.md`, this file, known gaps listed |
| 27 | Benchmark results are measured | PASS | `docs/benchmarks/*.csv`, `docs/BENCHMARK_RESULTS.md` |
| 28 | Genuine screenshots captured | PASS | `docs/screenshots` (Playwright, installed Chrome) |
| 29 | Documentation matches the implementation | PASS | Reviewed against code at the final commit |
| 30 | DOCX, PDF and Markdown report generated | PASS | `reports/Sovereign_Media_Hub_Final_Review.{docx,pdf,md}`, validated |
| 31 | No secrets or unintended changes in the diff | PASS | Final diff audited; `.env` is not committed; only `.env.example` |
| — | Production TLS with a real domain | BLOCKED | Needs a domain and open ports |
| — | `go test -race` | BLOCKED | 32-bit C compiler only; configured in CI |
| — | End-to-end encrypted media | NOT IMPLEMENTED | Stated in the interface and docs |
| — | Comparison with a centralised baseline | NOT IMPLEMENTED | Not measured |
