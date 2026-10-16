import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertValidCatalog, repoRoot } from "./catalog.js";

const SITE_ORIGIN = "https://unfamiliarsoundbyte.com";
const CANONICAL_URL = `${SITE_ORIGIN}/`;
const PAGE_TITLE = "Unfamiliar Sound Byte";
const PAGE_DESCRIPTION = "Unfamiliar Sound Byte, the revolutionary group chat for music";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ARTICLES = new Set(["the", "a", "an"]);
const MATCH_LABEL = {
  matched: "matched",
  unmatched: "unmatched",
  source_only: "source only",
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function httpsUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is not a usable URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must be https: ${url}`);
  }
  return escapeHtml(url);
}

function postedInstant(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Unreadable posted_at: ${iso}`);
  return ms;
}

export function formatPostedAt(iso) {
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return escapeHtml(iso);
  const [, year, month, day, hourStr, minute, , zone] = match;
  let hour = Number(hourStr);
  const suffix = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  const zoneLabel = zone === "Z" ? "utc" : zone;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour}:${minute}${suffix} ${zoneLabel}`;
}

function monogram(artist) {
  const words = String(artist)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  const usable = words[0] && ARTICLES.has(words[0].toLowerCase()) ? words.slice(1) : words;
  const pick = usable.length > 0 ? usable : words;
  if (pick.length === 0) return "•";
  const first = pick[0][0];
  const second = pick.length > 1 ? pick[pick.length - 1][0] : pick[0][1] || "";
  return (first + second).toUpperCase();
}

function acquisitionNumbers(entries) {
  const chronological = [...entries].sort(
    (a, b) => postedInstant(a.posted_at) - postedInstant(b.posted_at) || a.id.localeCompare(b.id),
  );
  const numbers = new Map();
  chronological.forEach((entry, index) => {
    numbers.set(entry.id, String(index + 1).padStart(3, "0"));
  });
  return numbers;
}

function albumLine(entry) {
  const value = entry.album || (entry.type === "album" ? entry.title : null);
  if (!value) return `<p class="album is-empty"><span class="k">album</span> not listed</p>`;
  return `<p class="album"><span class="k">album</span> ${escapeHtml(value)}</p>`;
}

function serviceCell(label, url, isSource) {
  if (!url) {
    return `<li><span class="service is-unmatched"><span class="name">${label}</span><span class="tag">unmatched</span></span></li>`;
  }
  const source = isSource ? `<span class="tag">source</span>` : "";
  return `<li><a class="service" href="${httpsUrl(url, label)}"><span class="name">${label}</span>${source}</a></li>`;
}

function notesBlock(entry) {
  if (entry.notes === "example") {
    return `<p class="example-row"><span class="stamp">example</span></p>`;
  }
  if (entry.notes) return `<p class="notes">${escapeHtml(entry.notes)}</p>`;
  return "";
}

function renderEntry(entry, number) {
  const artwork = entry.artwork_url
    ? `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="">`
    : `<span class="monogram">${escapeHtml(monogram(entry.artist))}</span>`;
  const spotify = serviceCell("spotify", entry.spotify_url, entry.source_service === "spotify");
  const apple = serviceCell(
    "apple music",
    entry.apple_music_url,
    entry.source_service === "apple_music",
  );

  return `      <li>
        <article class="card" id="${escapeHtml(entry.id)}" data-type="${escapeHtml(entry.type)}" data-status="${escapeHtml(entry.match_status)}">
          <div class="top">
            <div class="thumb"${entry.artwork_url ? "" : ` aria-hidden="true"`}>${artwork}</div>
            <div class="copy">
              <p class="kind"><span>${escapeHtml(entry.type)}</span><span class="no">${number}</span></p>
              <h2>${escapeHtml(entry.title)}</h2>
              <p class="artist">${escapeHtml(entry.artist)}</p>
              ${albumLine(entry)}
            </div>
          </div>
          <p class="posted"><span>posted by <strong>${escapeHtml(entry.posted_by)}</strong></span><time datetime="${escapeHtml(entry.posted_at)}">${formatPostedAt(entry.posted_at)}</time></p>
          <ul class="services">
            ${spotify}
            ${apple}
          </ul>
          <p class="match" data-status="${escapeHtml(entry.match_status)}">${MATCH_LABEL[entry.match_status]}</p>
          ${notesBlock(entry)}
        </article>
      </li>`;
}

function crateSummary(count) {
  if (count === 0) return "nothing in the crate yet";
  if (count === 1) return `<span class="num">1</span> in the crate · newest first`;
  return `<span class="num">${count}</span> in the crate · newest first`;
}

export function renderPage(catalog) {
  const entries = [...catalog.entries].sort(
    (a, b) => postedInstant(b.posted_at) - postedInstant(a.posted_at) || a.id.localeCompare(b.id),
  );
  const numbers = acquisitionNumbers(entries);
  const list = entries.length
    ? `<ol class="crate">\n${entries.map((entry) => renderEntry(entry, numbers.get(entry.id))).join("\n")}\n    </ol>`
    : `<p class="empty-crate">the crate is empty. add an entry to <code>data/catalog.json</code>, then run <code>npm run build</code>.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${PAGE_TITLE}</title>
    <meta name="description" content="${PAGE_DESCRIPTION}">
    <link rel="canonical" href="${CANONICAL_URL}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${PAGE_TITLE}">
    <meta property="og:title" content="${PAGE_TITLE}">
    <meta property="og:description" content="${PAGE_DESCRIPTION}">
    <meta property="og:url" content="${CANONICAL_URL}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${PAGE_TITLE}">
    <meta name="twitter:description" content="${PAGE_DESCRIPTION}">
    <meta name="theme-color" content="#000000">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' https:; base-uri 'none'; form-action 'none'">
    <link rel="stylesheet" href="styles.css">
    <link rel="icon" href="favicon.svg" type="image/svg+xml">
  </head>
  <body>
    <a class="skip" href="#crate">skip to the crate</a>
    <div class="wrap">
      <header class="mast">
        <div class="mast-top">
          <p>unfamiliarsoundbyte.com</p>
          <p>public</p>
        </div>
        <h1>unfamiliar sound byte</h1>
        <p class="dek">every song, album, and playlist posted in the group chat, kept in one crate.</p>
        <p class="count">${crateSummary(entries.length)}</p>
      </header>
      <main id="crate">
        ${list}
      </main>
      <footer class="colophon">
        <p>unfamiliar sound byte · catalog version ${escapeHtml(catalog.version)}</p>
        <p>rebuilt from data/catalog.json.</p>
      </footer>
    </div>
  </body>
</html>
`;
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CANONICAL_URL}</loc>
  </url>
</urlset>
`;
}

function copyStatic(dist) {
  for (const name of ["styles.css", "favicon.svg", "robots.txt"]) {
    fs.copyFileSync(path.join(repoRoot, "src", name), path.join(dist, name));
  }
}

function main() {
  const catalog = assertValidCatalog();
  const html = renderPage(catalog);
  const dist = path.join(repoRoot, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  fs.writeFileSync(path.join(dist, "sitemap.xml"), renderSitemap());
  copyStatic(dist);
  console.log(`built dist/index.html and dist/sitemap.xml (${catalog.entries.length} entries)`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
