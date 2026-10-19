// Relay benchmark: acknowledgement latency, query time against library size,
// and how the client behaves when a relay drops and returns.
//
//   npx tsx scripts/benchmarks/relay.ts
import { startRelay } from "../../frontend/tools/dev-relay/relay.mjs";
import { buildMediaEvent } from "../../frontend/src/lib/nostr/events";
import { RelayManager } from "../../frontend/src/lib/nostr/relays";
import { signWithKey, type Event } from "../../frontend/src/lib/nostr/keys";
import { newIdentity, stats, writeCsv, writeEnvironment } from "./lib";

writeEnvironment();
const id = newIdentity();

function mediaEvent(i: number): Event {
  const hash = i.toString(16).padStart(64, "0");
  return signWithKey(
    id.secret,
    buildMediaEvent({
      url: `http://127.0.0.1:8787/${hash}.jpg`,
      sha256: hash,
      mime: "image/jpeg",
      size: 1_000_000 + i,
      width: 4000,
      height: 3000,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      now: () => (1_700_000_000 + i) * 1000,
    }),
  );
}

const rows: Record<string, string | number>[] = [];
const add = (metric: string, detail: string, value: number, unit: string) =>
  rows.push({ metric, detail, value: Number(value.toFixed(2)), unit });

// 1. Publish acknowledgement latency -------------------------------------
{
  const relay = await startRelay();
  const m = new RelayManager();
  m.setRelays([relay.url]);
  await m.settled();
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < 200; i++) {
    const ev = mediaEvent(i);
    const t0 = performance.now();
    const r = await m.publish(ev);
    times.push(performance.now() - t0);
    if (r.accepted !== 1) failures++;
  }
  const s = stats(times);
  add(
    "publish_ack_latency",
    "median over 200 sequential events",
    s.median,
    "ms",
  );
  add("publish_ack_latency", "p95", s.p95, "ms");
  add("publish_failures", "of 200", failures, "count");
  m.destroy();
  await relay.close();
}

// 2. Query time against library size -------------------------------------
for (const n of [100, 1000, 5000]) {
  const relay = await startRelay({ maxLimit: 500 });
  const events = Array.from({ length: n }, (_, i) => mediaEvent(i));
  for (const e of events) relay.events.set(e.id, e);
  const m = new RelayManager();
  m.setRelays([relay.url]);
  await m.settled();
  const times: number[] = [];
  let got = 0;
  for (let rep = 0; rep < 3; rep++) {
    const t0 = performance.now();
    const res = await m.fetchAll(
      { authors: [id.pubkey], kinds: [1063] },
      { pageSize: 500 },
    );
    times.push(performance.now() - t0);
    got = res.events.length;
  }
  add(
    "query_all_events",
    `${n} events, 500 per page, cold (every event verified)`,
    stats(times).median,
    "ms",
  );
  add("query_events_returned", `${n} events`, got, "count");

  // Refresh with every event already cached: skipped before parsing and verification.
  const known = new Map(events.map((e) => [e.id, e.created_at]));
  const warm: number[] = [];
  for (let rep = 0; rep < 3; rep++) {
    const t0 = performance.now();
    const res = await m.fetchAll(
      { authors: [id.pubkey], kinds: [1063] },
      { pageSize: 500, known: (i) => known.get(i) },
    );
    warm.push(performance.now() - t0);
    if (res.events.length !== 0 || res.received < n)
      throw new Error("warm refresh returned the wrong number of events");
  }
  add(
    "query_all_events",
    `${n} events, 500 per page, warm (all cached)`,
    stats(warm).median,
    "ms",
  );
  m.destroy();
  await relay.close();
}

// 3. Drop and reconnect --------------------------------------------------
{
  const relay = await startRelay();
  const m = new RelayManager();
  m.setRelays([relay.url]);
  await m.settled();
  const detect: number[] = [];
  const back: number[] = [];
  for (let rep = 0; rep < 5; rep++) {
    const t0 = performance.now();
    relay.dropConnections();
    while (m.statuses.get()[0]!.state === "connected")
      await new Promise((r) => setTimeout(r, 5));
    detect.push(performance.now() - t0);
    const t1 = performance.now();
    while (m.statuses.get()[0]!.state !== "connected")
      await new Promise((r) => setTimeout(r, 5));
    back.push(performance.now() - t1);
  }
  add("drop_detection", "median of 5", stats(detect).median, "ms");
  add(
    "reconnect_after_drop",
    "median of 5 (backoff 0.5–1 s first retry)",
    stats(back).median,
    "ms",
  );
  add("reconnect_after_drop", "max of 5", stats(back).max, "ms");
  m.destroy();
  await relay.close();
}

// 4. Outage behaviour ----------------------------------------------------
{
  const relay = await startRelay();
  const m = new RelayManager();
  m.setRelays([relay.url]);
  await m.settled();
  await relay.close();
  while (m.statuses.get()[0]!.state === "connected")
    await new Promise((r) => setTimeout(r, 5));

  const t0 = performance.now();
  const pub = await m.publish(mediaEvent(1));
  add(
    "publish_when_relay_down",
    `outcome=${pub.results[0]!.outcome}`,
    performance.now() - t0,
    "ms",
  );
  const t1 = performance.now();
  const q = await m.fetch({ authors: [id.pubkey], kinds: [1063] });
  add(
    "query_when_relay_down",
    `skipped=${q.skipped.length}`,
    performance.now() - t1,
    "ms",
  );
  m.destroy();
}

// 5. Relay that accepts the socket but never answers ---------------------
{
  const relay = await startRelay();
  relay.setDelay(60_000);
  const m = new RelayManager();
  m.setRelays([relay.url]);
  await m.settled();
  const t0 = performance.now();
  const pub = await m.publish(mediaEvent(2));
  add(
    "publish_when_relay_silent",
    `outcome=${pub.results[0]!.outcome} (timeout 6 s)`,
    performance.now() - t0,
    "ms",
  );
  m.destroy();
  await relay.close();
}

writeCsv("relay.csv", rows);
for (const r of rows)
  process.stdout.write(`${r.metric} [${r.detail}] = ${r.value} ${r.unit}\n`);
process.exit(0);
