# Sovereign Media Hub

A private photo and video library on a storage server you run. You sign in with a Nostr key instead of a password. Files are stored under their SHA-256, so identical files are stored once. Relays carry small metadata records, never the files.

VIT Vellore, School of Computer Science Engineering and Information Systems. BACSE203 P, Computer Network Lab.

| Team | Registration | Work |
| --- | --- | --- |
| Kushagra Yogendra Bansal | 25BDE0080 | Implementation, demo |
| Abhay Bhat | 25BDE0026 | Implementation, demo |
| Adwit Agarwal | 25BYB0116 | Documentation |
| Nilay Sengupta | 25BYB0255 | Documentation |

Guide: Dr. Sudha M, Professor.

## How it fits together

* **Client** (`frontend/`): React and TypeScript. Holds the key, hashes and signs locally, uploads, queries relays, renders the library.
* **Brains** (Nostr relays): store NIP-94 file-metadata events and NIP-09 deletions.
* **Brawn** (`backend/`): Go server implementing Blossom (BUD-01, 02, 06, 11, 12) over SQLite and a sharded blob directory.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Requirements: Node 22 or newer, Go 1.23 or newer. Docker is optional.

```powershell
# 1. storage server
cd backend
go build -o ..\.run\server.exe .\cmd\server
$env:DATA_DIR = "..\.run\data"; $env:PORT = "8787"; $env:BASE_URL = "http://localhost:8787"
..\.run\server.exe

# 2. relay (development only), in a second terminal
cd frontend
npm ci
node tools/dev-relay/relay.mjs --port 7777 --persist ..\.run\relay.jsonl

# 3. app, in a third terminal
npm run dev
```

Open <http://localhost:5173>. Create an identity, back it up, keep the default connections (`http://localhost:8787`, `ws://localhost:7777`) and upload something.

With Docker: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Tests

```powershell
cd backend;  go test ./...
cd frontend; npm run typecheck; npm run lint; npm test            # unit and integration
cd frontend; npm run build; npx playwright test                    # end-to-end in Chrome
```

More: [docs/TESTING.md](docs/TESTING.md).

## What is and is not private

Files are visible to your storage server. Metadata events are visible to every relay you publish to; on a public relay that is everyone. File URLs are not secret. Nothing is end-to-end encrypted. Full list in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Documentation

| | |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, upload lifecycle, failure behaviour |
| [docs/API.md](docs/API.md) | Storage server endpoints and configuration |
| [docs/EVENT_SCHEMA.md](docs/EVENT_SCHEMA.md) | Nostr events used |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, Caddy, HTTPS, backup |
| [docs/TESTING.md](docs/TESTING.md) | Test suites and how to run them |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | Security analysis |
| [docs/BENCHMARK_METHODOLOGY.md](docs/BENCHMARK_METHODOLOGY.md), [docs/BENCHMARK_RESULTS.md](docs/BENCHMARK_RESULTS.md) | Measurements |
| [docs/REPOSITORY_AUDIT.md](docs/REPOSITORY_AUDIT.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md), [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Prototype audit and final status |
| [reports/](reports/) | Final review report |
