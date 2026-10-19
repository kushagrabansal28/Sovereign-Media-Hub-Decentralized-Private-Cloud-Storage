// Deduplication benchmark: for several duplicate rates, upload 100 files and
// compare the bytes sent with the bytes the server keeps.
//
//   npx tsx scripts/benchmarks/dedup.ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBlossom } from "../../frontend/tools/blossom-server";
import {
  dirBytes,
  newIdentity,
  putBlob,
  rng,
  sha256,
  syntheticPng,
  writeCsv,
  writeEnvironment,
} from "./lib";

const UPLOADS = 100;
const MIN = 200 * 1024;
const MAX = 2 * 1024 * 1024;

const rows: Record<string, string | number>[] = [];
writeEnvironment();

for (const dup of [0, 0.25, 0.5, 0.75]) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "smh-bench-dedup-"));
  const server = await startBlossom({ dataDir: path.join(tmp, "data") });
  const rand = rng(Math.round(dup * 1000) + 7);
  const owner = newIdentity();

  const uniqueCount = Math.round(UPLOADS * (1 - dup));
  const files = Array.from({ length: uniqueCount }, () =>
    syntheticPng(Math.round(MIN + rand() * (MAX - MIN))),
  );
  // Every unique file is sent once; the remaining uploads repeat random earlier files.
  const order = [...files.keys()];
  while (order.length < UPLOADS) order.push(Math.floor(rand() * files.length));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  let logical = 0;
  let created = 0;
  let existed = 0;
  let failed = 0;
  for (const idx of order) {
    const data = files[idx]!;
    logical += data.length;
    const r = await putBlob(server.url, owner, data, sha256(data));
    if (r.status === 201) created++;
    else if (r.status === 200) existed++;
    else failed++;
  }

  const disk = dirBytes(path.join(server.dataDir, "blobs"));
  rows.push({
    duplicate_rate_target: dup,
    uploads: UPLOADS,
    logical_bytes: logical,
    unique_blobs_on_disk: disk.files,
    stored_bytes: disk.bytes,
    created_201: created,
    already_stored_200: existed,
    failed,
    savings_percent: ((1 - disk.bytes / logical) * 100).toFixed(2),
  });
  process.stdout.write(
    `dup=${dup}: ${disk.files} blobs, ${(disk.bytes / 1048576).toFixed(1)} of ${(logical / 1048576).toFixed(1)} MiB\n`,
  );
  await server.stop();
  rmSync(tmp, { recursive: true, force: true });
}

writeCsv("dedup.csv", rows);
