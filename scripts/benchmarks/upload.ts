// Upload benchmark: hashing time, upload time, throughput, duplicate upload
// time and concurrency, against a real server on loopback.
//
//   npx tsx scripts/benchmarks/upload.ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBlossom } from "../../frontend/tools/blossom-server";
import {
  newIdentity,
  putBlob,
  sha256,
  stats,
  syntheticPng,
  writeCsv,
  writeEnvironment,
} from "./lib";

const MB = 1024 * 1024;
const SIZES_MB = [0.1, 1, 5, 10, 25, 50];
const REPS = 5;

writeEnvironment();
const tmp = mkdtempSync(path.join(os.tmpdir(), "smh-bench-up-"));
const server = await startBlossom({
  dataDir: path.join(tmp, "data"),
  env: { MAX_FILE_SIZE: String(200 * MB) },
});
const id = newIdentity();

// Single uploads by size -------------------------------------------------
const rows: Record<string, string | number>[] = [];
for (const mb of SIZES_MB) {
  for (let rep = 1; rep <= REPS; rep++) {
    const data = syntheticPng(Math.round(mb * MB));

    const h0 = performance.now();
    const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
    const hashMs = performance.now() - h0;
    void digest;

    const first = await putBlob(server.url, id, data);
    const dup = await putBlob(server.url, id, data);
    rows.push({
      size_mb: mb,
      rep,
      hash_ms: hashMs.toFixed(2),
      sign_ms: first.signMs.toFixed(2),
      upload_ms: first.ms.toFixed(2),
      upload_status: first.status,
      throughput_mb_s: (data.length / MB / (first.ms / 1000)).toFixed(1),
      duplicate_put_ms: dup.ms.toFixed(2),
      duplicate_status: dup.status,
      failed: first.status === 201 && dup.status === 200 ? 0 : 1,
    });
  }
  const last = rows.slice(-REPS);
  process.stdout.write(
    `${mb} MB: upload median ${stats(last.map((r) => Number(r.upload_ms))).median.toFixed(0)} ms\n`,
  );
}
writeCsv("upload.csv", rows);

// Concurrency ------------------------------------------------------------
const conc: Record<string, string | number>[] = [];
for (const n of [1, 2, 4, 8]) {
  const files = Array.from({ length: 8 }, () => syntheticPng(5 * MB));
  const t0 = performance.now();
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < files.length) {
        const f = files[next++]!;
        const r = await putBlob(server.url, id, f, sha256(f));
        if (r.status !== 201) failed++;
      }
    }),
  );
  const total = performance.now() - t0;
  conc.push({
    concurrency: n,
    files: files.length,
    file_mb: 5,
    total_ms: total.toFixed(0),
    aggregate_mb_s: ((files.length * 5) / (total / 1000)).toFixed(1),
    failed,
  });
  process.stdout.write(
    `concurrency ${n}: ${total.toFixed(0)} ms, failed ${failed}\n`,
  );
}
writeCsv("concurrency.csv", conc);

await server.stop();
rmSync(tmp, { recursive: true, force: true });
