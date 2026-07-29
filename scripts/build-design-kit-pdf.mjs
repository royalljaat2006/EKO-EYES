/**
 * Regenerates DESIGN_KIT.pdf from DESIGN_KIT.md — the markdown is the single
 * source of truth, so the PDF can never silently drift out of date.
 *
 * Run after editing DESIGN_KIT.md:
 *     node tools/build-design-kit-pdf.mjs
 *
 * Uses headless Edge's built-in print-to-PDF (already on every Windows box),
 * so there's no pandoc/wkhtmltopdf/npm dependency to install. The markdown
 * subset handled here is exactly what DESIGN_KIT.md uses: headings, tables,
 * fenced code, inline code, bold/em, lists, hr, links. It is deliberately
 * NOT a general-purpose markdown engine — if you add a new construct to the
 * doc (blockquotes, images, nested lists), extend this or the PDF will
 * render it as literal text.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const MD = path.join(ROOT, "DESIGN_KIT.md");
const PDF = path.join(ROOT, "DESIGN_KIT.pdf");

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline formatting: `code`, **bold**, *em*, [text](href). Code is escaped first so its contents are never re-parsed. */
function inline(text) {
  const codeSpans = [];
  let out = text.replace(/`([^`]+)`/g, (_, c) => {
    codeSpans.push(`<code>${esc(c)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  out = esc(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codeSpans[Number(i)]);
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType) { html.push(`</${listType}>`); listType = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      closeList();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      html.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Table (a header row followed by a |---|---| separator)
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      html.push("<table><thead><tr>" + head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>");
      for (const row of body) {
        html.push("<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      }
      html.push("</tbody></table>");
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      const id = h[2].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
      html.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) { closeList(); html.push("<hr />"); i++; continue; }

    // List items
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol || ul) {
      const want = ol ? "ol" : "ul";
      if (listType !== want) { closeList(); html.push(`<${want}>`); listType = want; }
      html.push(`<li>${inline((ol || ul)[1])}</li>`);
      i++;
      continue;
    }

    if (line.trim() === "") { closeList(); i++; continue; }

    // Paragraph — absorb following non-blank, non-structural lines.
    closeList();
    const para = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^(#{1,4}\s|```|\||---+\s*$|\s*\d+\.\s|\s*[-*]\s)/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }
  closeList();
  return html.join("\n");
}

const CSS = `
@page { size: A4; margin: 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; color:#1a1a18;
  line-height:1.55; font-size:10pt; max-width:780px; margin:0 auto; }
h1 { font-size:24pt; margin:0 0 8px; padding-bottom:10px; border-bottom:3px solid #2a78d6; }
h2 { font-size:14.5pt; margin-top:26px; padding-top:6px; border-top:1px solid #e1e0d9; break-after:avoid; }
h3 { font-size:11.5pt; margin-top:16px; break-after:avoid; }
p { margin:7px 0; }
a { color:#2a78d6; text-decoration:none; }
code { font-family:"Cascadia Code",Consolas,monospace; font-size:8.9pt; background:#f1f0ec;
  padding:1px 4px; border-radius:4px; color:#a3400f; }
pre { background:#f6f5f1; border:1px solid #e1e0d9; border-radius:8px; padding:9px 13px;
  overflow-x:auto; break-inside:avoid; }
pre code { background:none; padding:0; color:#1a1a18; font-size:8.6pt; }
table { border-collapse:collapse; width:100%; margin:11px 0; font-size:8.9pt; break-inside:avoid; }
th,td { border:1px solid #e1e0d9; padding:5px 7px; text-align:left; vertical-align:top; }
th { background:#f6f5f1; font-size:8.3pt; text-transform:uppercase; letter-spacing:.03em; color:#52514e; }
td code { white-space:nowrap; }
ul,ol { margin:7px 0; padding-left:21px; }
li { margin:2px 0; }
hr { border:none; border-top:1px solid #e1e0d9; margin:20px 0; }
strong { color:#0b0b0b; }
`;

function findEdge() {
  const found = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "Microsoft Edge not found. Checked:\n  " + EDGE_CANDIDATES.join("\n  ") +
      "\nInstall Edge, or convert DESIGN_KIT.md with your own tool.",
    );
  }
  return found;
}

async function main() {
  if (!fs.existsSync(MD)) throw new Error(`Missing ${MD}`);
  const md = fs.readFileSync(MD, "utf8");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>E.Y.E.S. Frontend Design System</title><style>${CSS}</style></head>
<body>${mdToHtml(md)}</body></html>`;

  // `--html <path>` dumps the intermediate HTML instead of printing a PDF —
  // useful when the markdown gains a construct this converter doesn't handle
  // and you need to see what it actually produced.
  const htmlFlag = process.argv.indexOf("--html");
  if (htmlFlag !== -1) {
    const dest = process.argv[htmlFlag + 1] ?? path.join(ROOT, "DESIGN_KIT.debug.html");
    fs.writeFileSync(dest, html, "utf8");
    console.log(`HTML written to ${dest} (no PDF produced)`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "design-kit-"));
  const tmpHtml = path.join(tmpDir, "design-kit.html");
  fs.writeFileSync(tmpHtml, html, "utf8");

  const edge = findEdge();
  await new Promise((resolve, reject) => {
    const proc = spawn(edge, [
      "--headless", "--disable-gpu", "--no-pdf-header-footer",
      `--user-data-dir=${path.join(tmpDir, "profile")}`,
      "--no-first-run", "--no-default-browser-check", "--disable-sync",
      `--print-to-pdf=${PDF}`,
      "file:///" + tmpHtml.replace(/\\/g, "/"),
    ], { stdio: "ignore" });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Edge exited ${code}`))));
    proc.on("error", reject);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const bytes = fs.statSync(PDF).size;
  if (fs.readFileSync(PDF).subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("Output is not a valid PDF");
  }
  console.log(`DESIGN_KIT.pdf regenerated from DESIGN_KIT.md (${(bytes / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
