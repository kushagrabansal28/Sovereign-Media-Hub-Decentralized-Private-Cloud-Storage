import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { authorization } from "../../frontend/src/lib/blossom/client";
import {
  generateKey,
  publicKeyOf,
  signWithKey,
} from "../../frontend/src/lib/nostr/keys";

export const RESULTS_DIR = path.resolve(
  import.meta.dirname,
  "../../docs/benchmarks",
);

export function ensureResultsDir() {
  mkdirSync(RESULTS_DIR, { recursive: true });
}

export interface Identity {
  secret: Uint8Array;
  pubkey: string;
  sign: Parameters<typeof authorization>[0];
}

export function newIdentity(): Identity {
  const secret = generateKey();
  return {
    secret,
    pubkey: publicKeyOf(secret),
    sign: async (t) => signWithKey(secret, t),
  };
}

/**
 * A synthetic file: a valid PNG signature followed by random bytes. The server
 * identifies files by their leading bytes and never decodes them, so this
 * exercises hashing, storage and transfer exactly as a real PNG of that size would.
 */
export function syntheticPng(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  out.set(randomBytes(bytes - 8), 8);
  return out;
}

export const sha256 = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");

export async function putBlob(
  serverUrl: string,
  id: Identity,
  data: Uint8Array,
  hash = sha256(data),
): Promise<{ status: number; ms: number; signMs: number }> {
  const t0 = performance.now();
  const token = await authorization(id.sign, {
    verb: "upload",
    serverUrl,
    hashes: [hash],
    content: "benchmark upload",
  });
  const t1 = performance.now();
  const res = await fetch(`${serverUrl}/upload`, {
    method: "PUT",
    headers: {
      Authorization: token,
      "X-SHA-256": hash,
      "Content-Type": "image/png",
    },
    body: data as BodyInit,
  });
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - t1, signMs: t1 - t0 };
}

export function dirBytes(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        files++;
        bytes += st.size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

export function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    mean,
    median: q(0.5),
    p95: q(0.95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

const quote = (v: string) => (/[",
]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function writeCsv(
  file: string,
  rows: Record<string, string | number>[],
) {
  ensureResultsDir();
  const cols = Object.keys(rows[0] ?? {});
  const text =
    [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => quote(String(r[c]))).join(",")),
    ].join("\n") + "\n";
  writeFileSync(path.join(RESULTS_DIR, file), text);
}

export function environment() {
  let go = "";
  try {
    go = execFileSync(
      process.env.GO ?? "C:\\Program Files\\Go\\bin\\go.exe",
      ["version"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    go = "unknown";
  }
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model.trim() ?? "unknown",
    logicalCores: cpus.length,
    totalMemoryMB: Math.round(os.totalmem() / 1048576),
    node: process.version,
    go,
    note: "Client and server run on the same machine; network latency is loopback only.",
  };
}

export function writeEnvironment() {
  ensureResultsDir();
  writeFileSync(
    path.join(RESULTS_DIR, "environment.json"),
    JSON.stringify(environment(), null, 2) + "\n",
  );
}

/** Small deterministic PRNG so scenarios repeat. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}
