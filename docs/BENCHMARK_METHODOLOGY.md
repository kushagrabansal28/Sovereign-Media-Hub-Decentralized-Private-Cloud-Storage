# Benchmark methodology

All numbers in `docs/BENCHMARK_RESULTS.md` come from the scripts in `scripts/benchmarks/` and the CSV files in `docs/benchmarks/`. Nothing is estimated or copied from elsewhere.

## Environment

`docs/benchmarks/environment.json` records the machine, operating system, Node and Go versions for each run. Client, server and relay run on one machine and talk over the loopback interface. **Network latency and bandwidth between devices are therefore not measured.** Throughput figures show the cost of hashing, signing, parsing and disk writes, not of a real network. The machine was also running other desktop software during the runs (browser, music player, cloud sync) and was short of free memory, so absolute times are noisy; repetitions and medians are reported to show the spread.

## What is measured

| Script | Question | Method |
| --- | --- | --- |
| `dedup.ts` | How much storage does content addressing save? | 100 uploads per scenario at duplicate rates 0, 25, 50 and 75 %. File sizes are uniform between 200 KiB and 2 MiB, generated from a fixed seed. Logical bytes (sum of uploads) are compared with bytes of files under `blobs/` after the run. Response codes (201/200) are counted |
| `upload.ts` | How long do hashing and upload take? | Files of 0.1, 1, 5, 10, 25 and 50 MB, five repetitions each. SHA-256 time uses the same native `crypto.subtle.digest` as the browser for files up to 32 MiB. Upload time is the `PUT /upload` round trip including body transfer, measured after the token has been signed. A second `PUT` of the same bytes measures the cost of a duplicate that reaches the server. Failures are counted |
| `upload.ts` (concurrency) | Does concurrent upload degrade or fail? | 8 files of 5 MB sent with 1, 2, 4 and 8 parallel workers |
| `relay.ts` | How fast are relay operations and how does the client react to outages? | Publish acknowledgement latency, query latency for libraries of 100, 1 000 and 5 000 events (with the relay capped at 500 events per request to force pagination), time to detect a dropped connection and to reconnect |
| `gallery.spec.ts` | How does the gallery behave with a large library? | Chrome via Playwright against the production build. A library of 3 000 events is seeded on the relay. Measured: time to first tile, first decoded thumbnail, first original (opening the viewer), DOM size, thumbnail and original request counts while scrolling the whole library, time to render from the local cache with the relay down |

## Synthetic data

* Server benchmarks use files made of a valid PNG signature followed by random bytes. The server checks only the signature and never decodes, so transfer, hashing and storage cost match real files of the same size. Random bytes do not compress; real photographs are already compressed, so this is realistic.
* The gallery benchmark seeds metadata events that point at a handful of real thumbnails. The events have distinct hashes and varied dimensions, so layout and virtualization are exercised, but the thumbnails repeat.
* The deduplication result depends entirely on the duplicate rate chosen. The rates are scenarios, not observations of real users.

## Limits

* One machine, one run per script, five repetitions where noted. No confidence intervals beyond the reported median, p95, min and max.
* No comparison with Google Photos, Nextcloud or similar systems was made, so the project paper's planned comparison against a centralized baseline is **not** answered here.
* Browser timings include Playwright overhead and a headless Chrome without GPU.
* Public relays were not measured; their latency is outside our control and not reproducible.

## Reproducing

```powershell
cd frontend
npm ci
npx tsx ..\scripts\benchmarks\dedup.ts
npx tsx ..\scripts\benchmarks\upload.ts
npx tsx ..\scripts\benchmarks\relay.ts
npx playwright test e2e/gallery.spec.ts
python ..\scripts\benchmarks\charts.py
```

Go must be on `PATH` (or set `GO`) because the scripts build and start the server.
