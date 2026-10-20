// Draws the architecture and sequence diagrams used in the report as SVG and
// renders them to PNG with the installed Chrome.
//
//   npx tsx scripts/report/diagrams.ts
//
// The palette and font follow the course review paper: Calibri, and the blue used for
// its headings (#2E74B5) and table shading (#D9E2F3).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve(import.meta.dirname, "../../frontend/package.json"));
const { chromium } = require("@playwright/test");

const OUT = path.resolve(import.meta.dirname, "../../docs/diagrams");
mkdirSync(OUT, { recursive: true });

const INK = "#1A1A1A";
const DEEP = "#1F3763";
const BLUE = "#2E74B5";
const SOFT = "#8EAADB";
const FILL = "#D9E2F3";
const PALE = "#EEF3FA";
const MUTED = "#44546A";
const FONT = `font-family="Calibri, Carlito, 'Segoe UI', Arial, sans-serif"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** Calibri is narrow; this is close enough to size note boxes without measuring. */
const textWidth = (s: string, size: number) => Math.ceil(s.length * size * 0.5);

function text(
  x: number,
  y: number,
  s: string,
  opts: {
    size?: number;
    weight?: number | string;
    fill?: string;
    anchor?: "start" | "middle" | "end";
    halo?: boolean;
    caps?: boolean;
  } = {},
) {
  const { size = 13, weight = 400, fill = INK, anchor = "start", halo = false, caps = false } = opts;
  const extra = halo ? ` stroke="#fff" stroke-width="5" paint-order="stroke" stroke-linejoin="round"` : "";
  const letter = caps ? ` letter-spacing="0.8"` : "";
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}${letter} ${FONT}>${esc(s)}</text>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, dashed = false) {
  const dir = x2 >= x1 ? 1 : -1;
  const colour = dashed ? MUTED : DEEP;
  const head = `${x2},${y2} ${x2 - 9 * dir},${y2 - 4.5} ${x2 - 9 * dir},${y2 + 4.5}`;
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2 - 8 * dir}" y2="${y2}" stroke="${colour}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="6 4"' : ""}/>` +
    `<polygon points="${head}" fill="${colour}"/>`
  );
}

function wrap(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

// Architecture ------------------------------------------------------------
interface Section {
  label: string;
  items: string[];
}

/** A titled card: heading band, optional subtitle, then labelled groups of lines. */
function card(
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  sections: Section[],
  strong = false,
) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#fff" stroke="${strong ? BLUE : SOFT}" stroke-width="${strong ? 2 : 1.4}"/>`;
  s += `<path d="M${x} ${y + 8}a8 8 0 0 1 8-8h${w - 16}a8 8 0 0 1 8 8v${subtitle ? 40 : 28}H${x}z" fill="${strong ? BLUE : FILL}"/>`;
  s += text(x + 16, y + 21, title, { size: 15, weight: 700, fill: strong ? "#fff" : DEEP });
  if (subtitle) s += text(x + 16, y + 40, subtitle, { size: 12, fill: strong ? "#E4ECF8" : MUTED });
  let cy = y + (subtitle ? 74 : 62);
  for (const sec of sections) {
    if (sec.label) {
      s += text(x + 16, cy, sec.label.toUpperCase(), { size: 10.5, weight: 700, fill: BLUE, caps: true });
      cy += 18;
    }
    for (const item of sec.items) {
      s += text(x + 16, cy, item, { size: 13, fill: INK });
      cy += 19;
    }
    cy += 8;
  }
  return s;
}

function architecture() {
  const W = 1000;
  const H = 548;
  let s = "";

  // Left: client.
  s += card(
    30,
    30,
    310,
    384,
    "Client (browser)",
    "React 19, TypeScript",
    [
      {
        label: "Identity",
        items: ["NIP-49 encrypted key, or a NIP-07 extension", "Signs kinds 24242, 1063 and 5"],
      },
      {
        label: "Processing",
        items: ["SHA-256 in a Web Worker", "Thumbnail and BlurHash", "Downloads checked against SHA-256"],
      },
      { label: "State", items: ["Relay manager and outbox", "IndexedDB event cache"] },
      { label: "Screens", items: ["Gallery with row virtualization", "Viewer, upload queue, settings"] },
    ],
    true,
  );

  // Right top: relays.
  s += card(660, 30, 310, 160, "Nostr relays", "Metadata index", [
    {
      label: "",
      items: [
        "Kind 1063 file metadata (NIP-94)",
        "Kind 5 deletions (NIP-09)",
        "Signed by the owner; checked by the client",
        "No file bytes",
      ],
    },
  ]);

  // Right bottom: Caddy wraps the storage server.
  s += `<rect x="660" y="226" width="310" height="188" rx="10" fill="${PALE}" stroke="${SOFT}" stroke-width="1.4" stroke-dasharray="7 5"/>`;
  s += text(676, 248, "Caddy", { size: 14, weight: 700, fill: DEEP });
  s += text(724, 248, "TLS, static app, reverse proxy", { size: 12, fill: MUTED });
  s += card(676, 262, 278, 136, "Blossom storage server", "", [
    {
      label: "",
      items: [
        "Go, SQLite",
        "blobs/ab/cd/‹sha256›",
        "BUD-01, 02, 06, 11, 12",
        "Ownership table, optional allow-list",
      ],
    },
  ]);

  // Flows. Labels sit in the open gap between the columns, above or below their line.
  const x1 = 340;
  const x2 = 660;
  const mid = (x1 + x2) / 2;
  s += arrow(x1, 92, x2, 92);
  s += text(mid, 80, "WebSocket: REQ, EVENT", { size: 12.5, anchor: "middle", fill: DEEP, halo: true });
  s += arrow(x2, 134, x1, 134, true);
  s += text(mid, 152, "events, EOSE", { size: 12.5, anchor: "middle", fill: MUTED, halo: true });

  s += arrow(x1, 330, x2, 330);
  s += text(mid, 318, "HTTPS: PUT /upload, GET /‹sha256›", {
    size: 12.5,
    anchor: "middle",
    fill: DEEP,
    halo: true,
  });
  s += arrow(x2, 372, x1, 372, true);
  s += text(mid, 390, "descriptor, file bytes", { size: 12.5, anchor: "middle", fill: MUTED, halo: true });

  // Guarantees.
  s += `<rect x="30" y="446" width="4" height="84" fill="${BLUE}"/>`;
  s += text(48, 464, "The private key never leaves the client.", { size: 13.5, fill: INK });
  s += text(48, 490, "Authorization is a signed event in the HTTP header.", { size: 13.5, fill: INK });
  s += text(48, 516, "Relays see metadata only; the storage server sees the bytes.", {
    size: 13.5,
    fill: INK,
  });
  return wrap(W, H, s);
}

// Sequence diagrams -------------------------------------------------------
interface Msg {
  from: number;
  to: number;
  text: string;
  dashed?: boolean;
}

function sequence(participants: string[], messages: Msg[], width = 1000) {
  const left = 130;
  const right = width - 120;
  const gap = participants.length > 1 ? (right - left) / (participants.length - 1) : 0;
  const xs = participants.map((_, i) => left + i * gap);
  const top = 92;
  const step = 42;
  const height = top + messages.length * step + 28;
  let s = "";

  // Lifelines first, so notes and labels cover them.
  participants.forEach((p, i) => {
    const x = xs[i]!;
    s += `<line x1="${x}" y1="52" x2="${x}" y2="${height - 14}" stroke="${SOFT}" stroke-width="1.2" stroke-dasharray="4 5"/>`;
    s += `<rect x="${x - 70}" y="14" width="140" height="38" rx="7" fill="${BLUE}"/>`;
    s += text(x, 38, p, { size: 14, weight: 700, fill: "#fff", anchor: "middle" });
  });

  messages.forEach((m, i) => {
    const y = top + i * step;
    const x1 = xs[m.from]!;
    const x2 = xs[m.to]!;
    // Step number in the left margin.
    s += `<circle cx="30" cy="${y}" r="11" fill="${FILL}"/>`;
    s += text(30, y + 4.5, String(i + 1), { size: 12, weight: 700, fill: DEEP, anchor: "middle" });

    if (m.from === m.to) {
      const w = textWidth(m.text, 13) + 24;
      // Notes sit beside their lifeline, on whichever side has room.
      const bx = x1 + 12 + w > width - 20 ? x1 - 12 - w : x1 + 12;
      s += `<rect x="${bx}" y="${y - 15}" width="${w}" height="30" rx="6" fill="${PALE}" stroke="${SOFT}" stroke-width="1"/>`;
      s += text(bx + 12, y + 4.5, m.text, { size: 13, fill: INK });
      return;
    }
    s += arrow(x1, y + 6, x2, y + 6, m.dashed);
    s += text((x1 + x2) / 2, y - 6, m.text, {
      size: 13,
      anchor: "middle",
      fill: m.dashed ? MUTED : DEEP,
      halo: true,
    });
  });
  return wrap(width, height, s);
}

const uploadSeq = sequence(
  ["Client UI", "Hash worker", "Storage server", "Relay"],
  [
    { from: 0, to: 1, text: "file (stream)" },
    { from: 1, to: 0, text: "SHA-256", dashed: true },
    { from: 0, to: 0, text: "known hash? mark duplicate and stop" },
    { from: 0, to: 0, text: "thumbnail, dimensions, BlurHash" },
    { from: 0, to: 0, text: "sign kind 24242: t=upload, x=[original, thumbnail], expiration, server" },
    { from: 0, to: 2, text: "PUT /upload (thumbnail), X-SHA-256" },
    { from: 2, to: 0, text: "201 descriptor", dashed: true },
    { from: 0, to: 2, text: "PUT /upload (original), X-SHA-256" },
    { from: 2, to: 2, text: "hash the bytes, sniff type, fsync, rename" },
    { from: 2, to: 0, text: "201 new, or 200 already stored", dashed: true },
    { from: 0, to: 0, text: "sign kind 1063 (NIP-94), save to the outbox" },
    { from: 0, to: 3, text: "EVENT" },
    { from: 3, to: 0, text: "OK true or false, with a reason", dashed: true },
    { from: 0, to: 0, text: "retry queued events whenever a relay (re)connects" },
  ],
  1040,
);

const authSeq = sequence(
  ["Client", "Storage server"],
  [
    { from: 0, to: 0, text: "sign kind 24242 with t, x, expiration and server" },
    { from: 0, to: 1, text: "DELETE /‹sha256›   Authorization: Nostr ‹base64url›" },
    { from: 1, to: 1, text: "decode; size at most 16 KiB" },
    { from: 1, to: 1, text: "kind is 24242; id equals hash(event); signature is valid" },
    { from: 1, to: 1, text: "created_at is not in the future (60 s skew)" },
    { from: 1, to: 1, text: "expiration is in the future and at most 1 hour away" },
    { from: 1, to: 1, text: "exactly one t tag, equal to the endpoint verb" },
    { from: 1, to: 1, text: "server tag matches this host" },
    { from: 1, to: 1, text: "x tag equals the hash in the URL" },
    { from: 1, to: 1, text: "the token has not been used before (delete)" },
    { from: 1, to: 1, text: "caller owns the blob: remove ownership, and the file if last" },
    { from: 1, to: 0, text: "200 {file_removed, owners_remaining}, or 401 / 404", dashed: true },
  ],
  980,
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
