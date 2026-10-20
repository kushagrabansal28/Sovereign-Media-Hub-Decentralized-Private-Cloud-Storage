// Builds the final review report from reports/Sovereign_Media_Hub_Final_Review.md:
//   .pdf   rendered from HTML by the installed Chrome (page numbers, header)
//   .docx  built with the docx library from the same Markdown tokens
//
//   npx tsx scripts/report/build.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
// Dependencies live in frontend/node_modules; resolve them from there.
const require = createRequire(
  path.resolve(import.meta.dirname, "../../frontend/package.json"),
);
const { marked } = require("marked");
type Token = any; // eslint-disable-line
type Tokens = any; // eslint-disable-line
const { chromium } = require("@playwright/test");
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPORTS = path.join(ROOT, "reports");
const BASE = "Sovereign_Media_Hub_Final_Review";
const MD = path.join(REPORTS, `${BASE}.md`);
const BUILD = path.join(REPORTS, ".build");
mkdirSync(BUILD, { recursive: true });

const meta = {
  institution: "Vellore Institute of Technology",
  status: "(Deemed to be University under Section 3 of UGC Act, 1956)",
  school: "SCHOOL OF COMPUTER SCIENCE ENGINEERING AND INFORMATION SYSTEMS",
  course: "BACSE203 P — Computer Network Lab",
  kind: "Final Review Report",
  title: "Sovereign Media Hub:",
  subtitle:
    "A Password-less, Content-Addressed Private Cloud Storage System Built on Nostr and Blossom",
  team: [
    ["Abhay Bhat", "25BDE0026"],
    ["Kushagra Yogendra Bansal", "25BDE0080"],
    ["Nilay Sengupta", "25BYB0255"],
    ["Adwit Agarwal", "25BYB0116"],
  ],
  guide: "Dr. Sudha M, Professor",
  date: process.env.REPORT_DATE ?? new Date().toLocaleDateString("en-GB"),
  repo: "https://github.com/GyroBullet/sovereign-media-hub",
  header: "BACSE203 P – Final Review Report",
};

// Result tables are generated from the benchmark CSV files so report numbers cannot drift from them.
const BENCH = path.join(ROOT, "docs", "benchmarks");

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function csvRows(name: string): Record<string, string>[] {
  const file = path.join(BENCH, name);
  if (!existsSync(file)) return [];
  const [head, ...lines] = readFileSync(file, "utf8").trim().split("\n");
  const cols = head!.split(",");
  return lines.map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
  });
}

function mdTable(head: string[], rows: (string | number)[][]): string {
  const line = (r: (string | number)[]) => `| ${r.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join(
    "\n",
  );
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const tableGenerators: Record<string, () => string> = {
  environment: () => {
    const file = path.join(BENCH, "environment.json");
    if (!existsSync(file)) return "(environment.json not found)";
    const e = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      string | number
    >;
    return mdTable(
      ["Item", "Value"],
      Object.entries(e).map(([k, v]) => [k, String(v)]),
    );
  },
  dedup: () =>
    mdTable(
      [
        "Repeat rate",
        "Uploads",
        "Sent (MiB)",
        "Stored (MiB)",
        "Blobs on disk",
        "HTTP 201",
        "HTTP 200",
        "Saved",
      ],
      csvRows("dedup.csv").map((r) => [
        `${Math.round(Number(r.duplicate_rate_target) * 100)} %`,
        r.uploads!,
        (Number(r.logical_bytes) / 1048576).toFixed(1),
        (Number(r.stored_bytes) / 1048576).toFixed(1),
        r.unique_blobs_on_disk!,
        r.created_201!,
        r.already_stored_200!,
        `${r.savings_percent} %`,
      ]),
    ),
  upload: () => {
    const rows = csvRows("upload.csv");
    const sizes = [...new Set(rows.map((r) => r.size_mb!))];
    return mdTable(
      [
        "Size (MB)",
        "SHA-256 (ms)",
        "Token signing (ms)",
        "Upload (ms)",
        "Throughput (MB/s)",
        "Identical re-upload (ms)",
        "Failures",
      ],
      sizes.map((sz) => {
        const g = rows.filter((r) => r.size_mb === sz);
        const m = (k: string) =>
          median(g.map((r) => Number(r[k]))).toFixed(
            k === "throughput_mb_s" ? 0 : 1,
          );
        return [
          sz,
          m("hash_ms"),
          m("sign_ms"),
          m("upload_ms"),
          m("throughput_mb_s"),
          m("duplicate_put_ms"),
          g.reduce((a, r) => a + Number(r.failed), 0),
        ];
      }),
    );
  },
  concurrency: () =>
    mdTable(
      [
        "Parallel uploads",
        "Files",
        "Total (ms)",
        "Aggregate (MB/s)",
        "Failures",
      ],
      csvRows("concurrency.csv").map((r) => [
        r.concurrency!,
        r.files!,
        r.total_ms!,
        r.aggregate_mb_s!,
        r.failed!,
      ]),
    ),
  relay: () =>
    mdTable(
      ["Measurement", "Detail", "Value"],
      csvRows("relay.csv").map((r) => [
        r.metric!.replace(/_/g, " "),
        r.detail!,
        `${r.value} ${r.unit}`,
      ]),
    ),
  gallery: () =>
    mdTable(
      ["Measurement", "Detail", "Value"],
      csvRows("gallery.csv").map((r) => [
        r.metric!.replace(/_/g, " "),
        r.detail!,
        `${r.value} ${r.unit}`,
      ]),
    ),
};

const source = readFileSync(MD, "utf8").replace(
  /^\{\{table:(\w+)\}\}$/gm,
  (_m, name: string) => {
    const g = tableGenerators[name];
    if (!g) throw new Error(`unknown table ${name}`);
    return g();
  },
);
const tokens = marked.lexer(source);

// Headings for the table of contents -----------------------------------------
interface Heading {
  depth: number;
  text: string;
  id: string;
}
const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const headings: Heading[] = tokens
  .filter((t): t is Tokens.Heading => t.type === "heading" && t.depth <= 2)
  .map((t) => ({ depth: t.depth, text: t.text, id: slug(t.text) }));

// HTML / PDF ---------------------------------------------------------------------
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function resolveImage(href: string): string {
  const abs = path.resolve(REPORTS, href);
  return pathToFileURL(abs).href;
}

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = tokens
        .map((t) => ("text" in t ? (t as { text: string }).text : ""))
        .join("");
      return `<h${depth} id="${slug(plain)}">${text}</h${depth}>\n`;
    },
    image({ href, text }) {
      return `<figure><img src="${resolveImage(href)}" alt="${esc(text)}"/><figcaption>${esc(text)}</figcaption></figure>`;
    },
  },
});

function coverHtml(): string {
  return `<section class="cover">
  <div class="vit">VIT</div>
  <div class="uni">${meta.institution}</div>
  <div class="ugc">${meta.status}</div>
  <div class="school">${meta.school}</div>
  <div class="course">${meta.course}<br/>${meta.kind}</div>
  <h1 class="title">${meta.title}</h1>
  <div class="rule"></div>
  <div class="subtitle">${meta.subtitle}</div>
  <div class="block"><b>Submitted by (Team Members):</b>
    <ul>${meta.team.map(([n, r], i) => `<li>Name ${i + 1}: ${n}, Roll Number: ${r}</li>`).join("")}</ul>
  </div>
  <div class="block"><b>Under the Guidance of:</b> ${meta.guide}</div>
  <div class="block"><b>Date of Submission:</b> ${meta.date}</div>
  <div class="block"><b>Repository:</b> ${meta.repo}</div>
</section>`;
}

function tocHtml(pages: Record<string, number> | null): string {
  const rows = headings
    .filter((h) => h.text !== "Table of contents")
    .map(
      (h) =>
        `<div class="toc-row d${h.depth}"><span>${esc(h.text)}</span><span class="dots"></span><span>${pages?.[h.id] ?? ""}</span></div>`,
    )
    .join("");
  return `<section class="toc"><h1 class="plain">Table of Contents</h1>${rows}</section>`;
}

function pageHtml(pages: Record<string, number> | null): string {
  // The Markdown holds everything after the cover and table of contents. The abstract is its first section.
  const body = marked.parser(
    tokens.filter(
      (t) =>
        !(
          t.type === "heading" &&
          (t as Tokens.Heading).text === "Table of contents"
        ),
    ),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${meta.title} ${meta.subtitle}</title>
<style>
@page { size: Letter; margin: 0.9in 0.9in 0.9in 0.9in; }
html { font-family: Calibri, Carlito, 'Segoe UI', sans-serif; font-size: 11pt; color: #000; }
body { margin: 0; line-height: 1.38; }
.cover { text-align: center; page-break-after: always; padding-top: 0.2in; }
.cover .vit { font-size: 16pt; font-weight: bold; margin-bottom: 6pt; }
.cover .uni { font-size: 12pt; }
.cover .ugc { font-size: 9pt; font-style: italic; margin-bottom: 8pt; }
.cover .school { font-size: 10pt; font-weight: bold; margin-bottom: 26pt; }
.cover .course { font-size: 11pt; font-weight: bold; margin-bottom: 40pt; line-height: 1.6; }
.cover .title { font-size: 20pt; margin: 0 0 8pt; }
.cover .subtitle { font-size: 12pt; font-weight: bold; margin-bottom: 40pt; }
.cover .block { text-align: left; margin: 0 0 12pt 0.7in; font-size: 11pt; }
.cover ul { margin: 6pt 0 0 0; padding-left: 20pt; }
.toc { page-break-after: always; }
.toc-row { display: flex; gap: 6pt; margin: 3pt 0; }
.toc-row .dots { flex: 1; border-bottom: 1px dotted #888; transform: translateY(-4pt); }
.toc-row.d1 { font-weight: bold; margin-top: 7pt; }
.toc-row.d2 { padding-left: 16pt; }
h1 { font-size: 16pt; font-weight: 400; color: #2E74B5; margin: 20pt 0 8pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #D9E2F3; break-after: avoid; }
h2 { font-size: 13pt; font-weight: 400; color: #2E74B5; margin: 14pt 0 5pt; break-after: avoid; }
h3 { font-size: 12pt; font-weight: 400; color: #1F3763; margin: 10pt 0 4pt; break-after: avoid; }
h1.plain { margin-top: 0; }
.cover .title { color: #000; font-weight: 700; }
.cover .rule { width: 55%; height: 0; border-top: 1.5pt solid #2E74B5; margin: 0 auto 26pt; }
p { margin: 0 0 7pt; text-align: justify; }
li { margin: 2pt 0; }
a { color: #0563C1; text-decoration: none; word-break: break-all; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 9.2pt; background: #EEF3FA; padding: 0 2pt; }
pre { font-family: Consolas, 'Courier New', monospace; font-size: 8.6pt; background: #F5F8FC; border: 1px solid #D9E2F3; border-left: 3px solid #2E74B5; padding: 6pt 8pt; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.4pt; break-inside: auto; }
th, td { border: 0.75pt solid #000; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #D9E2F3; font-weight: 700; }
tr { break-inside: avoid; }
figure { margin: 8pt 0 10pt; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: 3.7in; border: 1px solid #D9E2F3; }
figcaption { font-size: 9.2pt; font-style: italic; color: #44546A; margin-top: 3pt; text-align: center; }
blockquote { margin: 6pt 0 8pt 0; padding: 4pt 10pt; border-left: 3px solid #2E74B5; background: #EEF3FA; }
blockquote p { margin: 0; }
hr { border: 0; page-break-after: always; }
</style></head><body>${coverHtml()}${tocHtml(pages)}${body}</body></html>`;
}

async function renderPdf(pages: Record<string, number> | null, out: string) {
  const html = pageHtml(pages);
  const file = path.join(BUILD, "report.html");
  writeFileSync(file, html);
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: out,
    format: "Letter",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-family:Calibri,Arial;padding-left:0.9in;color:#000"><div style="font-size:9px">${meta.header}</div><div style="font-size:9px">Page <span class="pageNumber"></span></div></div>`,
    footerTemplate: `<div></div>`,
    margin: { top: "0.9in", bottom: "0.9in", left: "0.9in", right: "0.9in" },
  });
  await browser.close();
}

function pageOfHeadings(pdf: string): Record<string, number> {
  const script = `
import json, sys, re, pypdf
r = pypdf.PdfReader(sys.argv[1])
heads = json.loads(sys.argv[2])
found = {}
for i, p in enumerate(r.pages):
    if i < 2: continue  # cover and table of contents
    text = re.sub(r"\\s+", " ", p.extract_text() or "")
    for h in heads:
        if h["id"] not in found and h["text"] in text:
            found[h["id"]] = i + 1
print(json.dumps(found))
`;
  const out = execFileSync(
    "python",
    ["-I", "-c", script, pdf, JSON.stringify(headings)],
    { encoding: "utf8" },
  );
  return JSON.parse(out) as Record<string, number>;
}

// DOCX --------------------------------------------------------------------------
const FONT = "Calibri";

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function inline(
  tokens: Token[] | undefined,
  style: { bold?: boolean; italics?: boolean } = {},
): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(
          ...inline((t as Tokens.Strong).tokens, { ...style, bold: true }),
        );
        break;
      case "em":
        out.push(
          ...inline((t as Tokens.Em).tokens, { ...style, italics: true }),
        );
        break;
      case "codespan":
        out.push(
          new TextRun({
            text: (t as Tokens.Codespan).text,
            font: "Consolas",
            size: 19,
            shading: { type: ShadingType.CLEAR, fill: "EEF3FA" },
            ...style,
          }),
        );
        break;
      case "link": {
        const l = t as Tokens.Link;
        out.push(
          new ExternalHyperlink({
            link: l.href,
            children: [
              new TextRun({
                text: l.text,
                style: "Hyperlink",
                font: FONT,
                ...style,
              }),
            ],
          }),
        );
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "escape":
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inline(tt.tokens, style));
        else
          out.push(
            new TextRun({ text: decode(tt.text), font: FONT, ...style }),
          );
        break;
      }
      default:
        if ("raw" in t)
          out.push(
            new TextRun({
              text: decode((t as { raw: string }).raw),
              font: FONT,
              ...style,
            }),
          );
    }
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const borders = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
};

function docxBlocks(toks: Token[], listLevel = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of toks) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const level = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
        ][Math.min(h.depth, 3) - 1]!;
        out.push(
          new Paragraph({
            heading: level,
            children: inline(h.tokens),
            spacing: { before: h.depth === 1 ? 360 : 240, after: 100 },
            keepNext: true,
          }),
        );
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        const img =
          p.tokens.length === 1 && p.tokens[0]!.type === "image"
            ? (p.tokens[0] as Tokens.Image)
            : null;
        if (img) {
          const file = path.resolve(REPORTS, img.href);
          const { w, h } = pngSize(file);
          const maxW = 560;
          const maxH = 420;
          const scale = Math.min(1, maxW / w, maxH / h);
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              spacing: { before: 120, after: 40 },
              children: [
                new ImageRun({
                  type: "png",
                  data: readFileSync(file),
                  transformation: {
                    width: Math.round(w * scale),
                    height: Math.round(h * scale),
                  },
                  altText: {
                    title: img.text,
                    description: img.text,
                    name: path.basename(file),
                  },
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [
                new TextRun({
                  text: img.text,
                  italics: true,
                  size: 18,
                  font: FONT,
                }),
              ],
            }),
          );
        } else {
          out.push(
            new Paragraph({
              children: inline(p.tokens),
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120 },
            }),
          );
        }
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        for (const item of l.items) {
          const first = item.tokens.find(
            (x) => x.type === "text" || x.type === "paragraph",
          ) as Tokens.Text | Tokens.Paragraph | undefined;
          out.push(
            new Paragraph({
              numbering: {
                reference: l.ordered ? "num" : "bul",
                level: Math.min(listLevel, 2),
              },
              children: inline(
                first && "tokens" in first ? (first.tokens as Token[]) : [],
              ),
              spacing: { after: 40 },
            }),
          );
          const nested = item.tokens.filter((x) => x.type === "list");
          if (nested.length)
            out.push(...(docxBlocks(nested, listLevel + 1) as Paragraph[]));
        }
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        const cols = tb.header.length;
        const rowOf = (cells: Tokens.TableCell[], head: boolean) =>
          new TableRow({
            tableHeader: head,
            cantSplit: true,
            children: cells.map(
              (c) =>
                new TableCell({
                  borders,
                  width: { size: Math.floor(9360 / cols), type: WidthType.DXA },
                  margins: { top: 40, bottom: 40, left: 80, right: 80 },
                  shading: head
                    ? { type: ShadingType.CLEAR, fill: "D9E2F3" }
                    : undefined,
                  children: [
                    new Paragraph({
                      children: inline(
                        c.tokens,
                        head ? { bold: true } : {},
                      ).map((r) => r),
                      spacing: { after: 0 },
                    }),
                  ],
                }),
            ),
          });
        out.push(
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: Array(cols).fill(Math.floor(9360 / cols)),
            rows: [
              rowOf(tb.header, true),
              ...tb.rows.map((r) => rowOf(r, false)),
            ],
          }),
          new Paragraph({ spacing: { after: 120 }, children: [] }),
        );
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        for (const line of c.text.split("\n")) {
          out.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: "F5F8FC" },
              spacing: { after: 0 },
              children: [
                new TextRun({ text: line || " ", font: "Consolas", size: 17 }),
              ],
            }),
          );
        }
        out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case "blockquote": {
        const b = t as Tokens.Blockquote;
        for (const inner of docxBlocks(b.tokens)) {
          out.push(inner);
        }
        break;
      }
      case "hr":
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "space":
        break;
      default:
        break;
    }
  }
  return out;
}

async function buildDocx(out: string) {
  const cover = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 80 },
      children: [
        new TextRun({ text: "VIT", bold: true, size: 32, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: meta.institution, size: 24, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        new TextRun({ text: meta.status, italics: true, size: 18, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 520 },
      children: [
        new TextRun({ text: meta.school, bold: true, size: 20, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: meta.course, bold: true, size: 22, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [
        new TextRun({ text: meta.kind, bold: true, size: 22, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: meta.title, bold: true, size: 40, font: FONT }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [
        new TextRun({ text: meta.subtitle, bold: true, size: 24, font: FONT }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      indent: { left: 700 },
      children: [
        new TextRun({
          text: "Submitted by (Team Members):",
          bold: true,
          font: FONT,
        }),
      ],
    }),
    ...meta.team.map(
      ([n, r], i) =>
        new Paragraph({
          numbering: { reference: "bul", level: 0 },
          indent: { left: 1100, hanging: 360 },
          children: [
            new TextRun({
              text: `Name ${i + 1}: ${n}, Roll Number: ${r}`,
              font: FONT,
            }),
          ],
        }),
    ),
    new Paragraph({
      spacing: { before: 240, after: 120 },
      indent: { left: 700 },
      children: [
        new TextRun({
          text: "Under the Guidance of: ",
          bold: true,
          font: FONT,
        }),
        new TextRun({ text: meta.guide, font: FONT }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      indent: { left: 700 },
      children: [
        new TextRun({ text: "Date of Submission: ", bold: true, font: FONT }),
        new TextRun({ text: meta.date, font: FONT }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      indent: { left: 700 },
      children: [
        new TextRun({ text: "Repository: ", bold: true, font: FONT }),
        new ExternalHyperlink({
          link: meta.repo,
          children: [
            new TextRun({ text: meta.repo, style: "Hyperlink", font: FONT }),
          ],
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "Table of Contents", font: FONT })],
    }),
    new TableOfContents("Table of Contents", {
      hyperlink: true,
      headingStyleRange: "1-2",
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  const body = docxBlocks(
    tokens.filter(
      (t) =>
        !(
          t.type === "heading" &&
          (t as Tokens.Heading).text === "Table of contents"
        ),
    ),
  );

  const doc = new Document({
    creator: "Sovereign Media Hub team",
    title: `${meta.title} ${meta.subtitle}`,
    description: meta.kind,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, color: "2E74B5", font: FONT },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 26, color: "2E74B5", font: FONT },
          paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 24, color: "1F3763", font: FONT },
          paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bul",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ["•", "–", "·"][level]!,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 + level * 360, hanging: 360 } },
            },
          })),
        },
        {
          reference: "num",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 + level * 360, hanging: 360 } },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1296, bottom: 1296, left: 1296, right: 1296 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
                children: [
                  new TextRun({ text: meta.header, size: 18, font: FONT }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({ text: "Page ", size: 18, font: FONT }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    font: FONT,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: { default: new Footer({ children: [new Paragraph({ children: [] })] }) },
        children: [...cover, ...body],
      },
    ],
  });
  writeFileSync(out, await Packer.toBuffer(doc));
}

// docs/BENCHMARK_RESULTS.md is generated from the same CSV files.
{
  const g = (n: string) => tableGenerators[n]!();
  const md = `# Benchmark results

Generated by \`scripts/report/build.ts\` from the CSV files in \`docs/benchmarks/\`. Method, limits and the meaning of each measurement: \`docs/BENCHMARK_METHODOLOGY.md\`. All runs are on one machine over loopback; they show software cost, not network cost. The machine was short of free memory during the runs, so absolute times are noisy.

## Environment

${g("environment")}

## Deduplication

${g("dedup")}

![Bytes sent against bytes stored](benchmarks/charts/dedup.png)

## Upload (median of 5 runs per size)

${g("upload")}

![Hashing and upload time](benchmarks/charts/upload_time.png)

## Concurrent uploads

${g("concurrency")}

![Concurrency](benchmarks/charts/concurrency.png)

## Relay

${g("relay")}

![Relay query time](benchmarks/charts/relay_query.png)

## Gallery, 3 000 items

${g("gallery")}

![Gallery timing](benchmarks/charts/gallery_timing.png)
`;
  writeFileSync(path.join(ROOT, "docs", "BENCHMARK_RESULTS.md"), md);
}

// Run ------------------------------------------------------------------------------
const pdfPath = path.join(REPORTS, `${BASE}.pdf`);
const docxPath = path.join(REPORTS, `${BASE}.docx`);
await renderPdf(null, pdfPath);
const pages = pageOfHeadings(pdfPath);
await renderPdf(pages, pdfPath); // second pass with page numbers in the contents
await buildDocx(docxPath);
writeFileSync(path.join(BUILD, "pages.json"), JSON.stringify(pages, null, 2));
process.stdout.write(`wrote ${pdfPath}\nwrote ${docxPath}\n`);
if (!existsSync(MD)) throw new Error("markdown source missing");
