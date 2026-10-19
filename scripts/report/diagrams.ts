// Draws the architecture and sequence diagrams used in the report as SVG and
// renders them to PNG with the installed Chrome.
//
//   npx tsx scripts/report/diagrams.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve(import.meta.dirname, "../../frontend/package.json"));
const { chromium } = require("@playwright/test");

const OUT = path.resolve(import.meta.dirname, "../../docs/diagrams");
mkdirSync(OUT, { recursive: true });

const INK = "#1c1a17";
const MUTED = "#6a655d";
const LINE = "#c5bfb4";
const ACCENT = "#9a5a0c";
const FILL = "#f5f3ef";
const FONT = "font-family=\"'IBM Plex Sans', 'Segoe UI', Arial, sans-serif\"";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function box(
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  lines: string[],
  accent = false,
) {
  const stroke = accent ? ACCENT : LINE;
  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${FILL}" stroke="${stroke}" stroke-width="${accent ? 1.6 : 1.2}"/>`;
  svg += `<text x="${x + 14}" y="${y + 24}" font-size="14" font-weight="600" fill="${INK}" ${FONT}>${esc(title)}</text>`;
  lines.forEach((l, i) => {
    svg += `<text x="${x + 14}" y="${y + 46 + i * 18}" font-size="12" fill="${MUTED}" ${FONT}>${esc(l)}</text>`;
  });
  return svg;
}

function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label = "",
  dashed = false,
  labelDy = -6,
) {
  const dir = x2 >= x1 ? 1 : -1;
  const head = `${x2},${y2} ${x2 - 8 * dir},${y2 - 4} ${x2 - 8 * dir},${y2 + 4}`;
  let svg = `<line x1="${x1}" y1="${y1}" x2="${x2 - 8 * dir}" y2="${y2}" stroke="${INK}" stroke-width="1.3" ${dashed ? 'stroke-dasharray="5 4"' : ""}/>`;
  svg += `<polygon points="${head}" fill="${INK}"/>`;
  if (label) {
    svg += `<text x="${(x1 + x2) / 2}" y="${y1 + labelDy}" font-size="11.5" text-anchor="middle" fill="${INK}" ${FONT}>${esc(label)}</text>`;
  }
  return svg;
}

function wrap(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

// Architecture ------------------------------------------------------------
function architecture() {
  let s = "";
  s += box(
    30,
    40,
    300,
    250,
    "Client (browser)",
    [
      "React 19, TypeScript",
      "",
      "Identity: NIP-49 encrypted key",
      "or NIP-07 extension",
      "Signs: kind 24242, 1063, 5",
      "SHA-256 in a Web Worker",
      "Thumbnail, BlurHash",
      "Relay manager, outbox",
      "IndexedDB event cache",
      "Gallery, viewer, upload queue",
    ],
    true,
  );
  s += box(420, 40, 300, 110, "Brains: Nostr relays", [
    "Kind 1063 file metadata (NIP-94)",
    "Kind 5 deletions (NIP-09)",
    "No file bytes",
  ]);
  s += box(
    420,
    190,
    300,
    100,
    "Brawn: Blossom storage server",
    ["Go, SQLite, blobs/ab/cd/<sha256>", "BUD-01, 02, 06, 11, 12"],
    true,
  );
  s += box(420, 330, 300, 60, "Caddy", ["Static app, reverse proxy, TLS"]);
  // flows
  s += arrow(330, 95, 420, 95, "WebSocket: EVENT, REQ", false, -8);
  s += arrow(420, 125, 330, 125, "events, EOSE", true, 16);
  s += arrow(330, 235, 420, 235, "HTTP PUT /upload, GET /<sha256>", false, -8);
  s += arrow(420, 265, 330, 265, "descriptor, bytes", true, 16);
  s += `<text x="30" y="330" font-size="12" fill="${MUTED}" ${FONT}>The private key never leaves the client.</text>`;
  s += `<text x="30" y="350" font-size="12" fill="${MUTED}" ${FONT}>Authorization is a signed event in the HTTP header.</text>`;
  s += `<text x="30" y="370" font-size="12" fill="${MUTED}" ${FONT}>Relays see metadata only; the server sees bytes.</text>`;
  return wrap(760, 410, s);
}

// Upload sequence ---------------------------------------------------------
interface Msg {
  from: number;
  to: number;
  text: string;
  dashed?: boolean;
  note?: boolean;
}

function sequence(participants: string[], messages: Msg[], width = 980) {
  const gap = (width - 80) / (participants.length - 1);
  const xs = participants.map((_, i) => 40 + i * gap);
  const top = 60;
  const step = 36;
  const height = top + messages.length * step + 40;
  let s = "";
  participants.forEach((p, i) => {
    s += `<rect x="${xs[i]! - 62}" y="14" width="124" height="30" rx="5" fill="${FILL}" stroke="${LINE}"/>`;
    s += `<text x="${xs[i]}" y="34" font-size="12.5" font-weight="600" text-anchor="middle" fill="${INK}" ${FONT}>${esc(p)}</text>`;
    s += `<line x1="${xs[i]}" y1="44" x2="${xs[i]}" y2="${height - 10}" stroke="${LINE}" stroke-width="1" stroke-dasharray="3 4"/>`;
  });
  messages.forEach((m, i) => {
    const y = top + i * step + 14;
    if (m.note) {
      const x = xs[m.from]!;
      s += `<rect x="${x - 70}" y="${y - 14}" width="140" height="24" rx="4" fill="#fbf3e6" stroke="${ACCENT}" stroke-width="0.8"/>`;
      s += `<text x="${x}" y="${y + 3}" font-size="11" text-anchor="middle" fill="${INK}" ${FONT}>${esc(m.text)}</text>`;
      return;
    }
    const x1 = xs[m.from]!;
    const x2 = xs[m.to]!;
    if (m.from === m.to) {
      s += `<text x="${x1 + 8}" y="${y}" font-size="11.5" fill="${INK}" ${FONT}>${esc(m.text)}</text>`;
      return;
    }
    s += arrow(x1, y, x2, y, m.text, m.dashed, -6);
  });
  return wrap(width, height, s);
}

const uploadSeq = sequence(
  ["Client UI", "Hash worker", "Storage server", "Relay"],
  [
    { from: 0, to: 1, text: "file (stream)" },
    { from: 1, to: 0, text: "SHA-256", dashed: true },
    { from: 0, to: 0, text: 'known hash? then "duplicate", stop' },
    { from: 0, to: 0, text: "thumbnail, dimensions, BlurHash" },
    {
      from: 0,
      to: 0,
      text: "sign kind 24242: t=upload, x=[orig, thumb], expiration, server",
    },
    { from: 0, to: 2, text: "PUT /upload (thumbnail), X-SHA-256" },
    { from: 2, to: 0, text: "201 descriptor", dashed: true },
    { from: 0, to: 2, text: "PUT /upload (original), X-SHA-256" },
    { from: 2, to: 2, text: "hash received bytes, sniff type, fsync, rename" },
    { from: 2, to: 0, text: "201 new / 200 already stored", dashed: true },
    { from: 0, to: 0, text: "sign kind 1063 (NIP-94), save to outbox" },
    { from: 0, to: 3, text: "EVENT" },
    { from: 3, to: 0, text: "OK true / false, reason", dashed: true },
    { from: 0, to: 0, text: "retry queued events when a relay (re)connects" },
  ],
);

const authSeq = sequence(
  ["Client", "Storage server"],
  [
    { from: 0, to: 0, text: "sign kind 24242 with t, x, expiration, server" },
    {
      from: 0,
      to: 1,
      text: "DELETE /<sha256>  Authorization: Nostr <base64url>",
    },
    { from: 1, to: 1, text: "1. decode, size ≤ 16 KiB" },
    {
      from: 1,
      to: 1,
      text: "2. kind = 24242; id = hash(event); signature valid",
    },
    { from: 1, to: 1, text: "3. created_at not in the future (60 s skew)" },
    { from: 1, to: 1, text: "4. expiration in the future, ≤ 1 h" },
    { from: 1, to: 1, text: "5. exactly one t tag = endpoint verb" },
    { from: 1, to: 1, text: "6. server tag matches this host" },
    { from: 1, to: 1, text: "7. x tag equals the hash in the URL" },
    { from: 1, to: 1, text: "8. token not used before (delete)" },
    {
      from: 1,
      to: 1,
      text: "9. caller owns the blob; remove ownership; file if last",
    },
    {
      from: 1,
      to: 0,
      text: "200 {file_removed, owners_remaining} or 401 / 404",
      dashed: true,
    },
  ],
  900,
);

const diagrams: Record<string, string> = {
  architecture: architecture(),
  "upload-sequence": uploadSeq,
  "auth-validation": authSeq,
};

for (const [name, svg] of Object.entries(diagrams))
  writeFileSync(path.join(OUT, `${name}.svg`), svg);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, svg] of Object.entries(diagrams)) {
  const m = svg.match(/width="(\d+)" height="(\d+)"/)!;
  await page.setViewportSize({ width: Number(m[1]), height: Number(m[2]) });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x: 0, y: 0, width: Number(m[1]), height: Number(m[2]) },
  });
  process.stdout.write(`wrote ${name}.svg and .png\n`);
}
await browser.close();
