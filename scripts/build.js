import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertValidCatalog, repoRoot } from "./catalog.js";

const SITE_ORIGIN = "https://unfamiliarsoundbyte.com";
const CANONICAL_URL = `${SITE_ORIGIN}/`;
const PAGE_TITLE = "Unfamiliar Sound Byte";
const PAGE_DESCRIPTION = "Unfamiliar Sound Byte, the revolutionary group chat for music";
const SHARE_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`;
const SHARE_IMAGE_ALT = "Unfamiliar Sound Byte wordmark on black";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ARTICLES = new Set(["the", "a", "an"]);
const SPOTIFY_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.15" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.55 9.85c2.35-.78 5.15-.68 7.55.55M7.7 12.15c1.95-.58 4.35-.48 6.45.52M8.05 14.35c1.5-.4 3.25-.32 4.75.42" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>`;
const APPLE_MUSIC_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.15 17.85a2.2 2.2 0 1 1-1.45-2.06V7.35l8.55-1.95v8.35a2.2 2.2 0 1 1-1.45-2.06V7.15l-5.65 1.28v9.42z"/></svg>`;

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
  const [, year, month, day, hourStr, minute] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  let hour = Number(hourStr);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${weekday}, ${MONTHS[Number(month) - 1]} ${Number(day)}, ${year} · ${hour}:${minute} ${suffix}`;
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

function albumName(entry) {
  return entry.album || (entry.type === "album" ? entry.title : null);
}

function byline(entry) {
  const album = albumName(entry);
  const albumHtml = album
    ? `<span class="album">${escapeHtml(album)}</span>`
    : `<span class="album is-empty">not listed</span>`;
  return `<p class="byline"><span class="artist">${escapeHtml(entry.artist)}</span><span class="sep" aria-hidden="true">·</span>${albumHtml}</p>`;
}

function storeLink(kind, url, title) {
  if (!url) return "";
  const name = kind === "spotify" ? "Spotify" : "Apple Music";
  const icon = kind === "spotify" ? SPOTIFY_ICON : APPLE_MUSIC_ICON;
  const label = `Listen to ${title} on ${name}`;
  return `<li><a class="icon-btn" href="${httpsUrl(url, name)}" aria-label="${escapeHtml(label)}">${icon}</a></li>`;
}

function notesBlock(entry) {
  if (entry.notes === "example") {
    return `<p class="example-row"><span class="stamp">example</span></p>`;
  }
  if (entry.notes) return `<p class="notes">${escapeHtml(entry.notes)}</p>`;
  return "";
}

function artworkAlt(entry) {
  const subject = entry.album || entry.title;
  return `Cover art for ${subject} by ${entry.artist}`;
}

function renderEntry(entry, number) {
  const artwork = entry.artwork_url
    ? `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="${escapeHtml(artworkAlt(entry))}" width="600" height="600" loading="lazy" decoding="async">`
    : `<span class="monogram">${escapeHtml(monogram(entry.artist))}</span>`;
  const links = [
    storeLink("spotify", entry.spotify_url, entry.title),
    storeLink("apple", entry.apple_music_url, entry.title),
  ].filter(Boolean);
  const services = links.length ? `<ul class="services">\n            ${links.join("\n            ")}\n          </ul>` : "";

  return `      <li>
        <article class="card" id="${escapeHtml(entry.id)}" data-type="${escapeHtml(entry.type)}">
          <div class="row">
            <div class="thumb"${entry.artwork_url ? "" : ` aria-hidden="true"`}>${artwork}</div>
            <div class="copy">
              <p class="kind"><span>${escapeHtml(entry.type)}</span><span class="no">${number}</span></p>
              <h2>${escapeHtml(entry.title)}</h2>
              ${byline(entry)}
              <p class="posted">posted by <strong>${escapeHtml(entry.posted_by)}</strong> · <time datetime="${escapeHtml(entry.posted_at)}">${formatPostedAt(entry.posted_at)}</time></p>
            </div>
            ${services}
          </div>
          ${notesBlock(entry)}
        </article>
      </li>`;
}

function crateSummary(count) {
  if (count === 0) return "nothing in the crate yet";
  if (count === 1) return `<span class="num">1</span> in the crate · newest first`;
  return `<span class="num">${count}</span> in the crate · newest first`;
}

function assetVersion(filename) {
  const bytes = fs.readFileSync(path.join(repoRoot, "src", filename));
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

function versionedAsset(filename) {
  return `${filename}?v=${assetVersion(filename)}`;
}

function flowService(label, url) {
  if (!url) return "";
  return `<li><a class="service" href="${httpsUrl(url, label)}"><span class="name">${label}</span></a></li>`;
}

function coverImage(entry, index, reflect) {
  const lazy = index > 1 ? " loading=\"lazy\"" : "";
  const priority = !reflect && index === 0 ? " fetchpriority=\"high\"" : "";
  return `<img src="${httpsUrl(entry.artwork_url, "artwork")}" alt="" width="600" height="600" draggable="false" decoding="async"${priority}${lazy}>`;
}

function renderCoverFlow(entries) {
  if (entries.length === 0) return "";
  const covers = entries
    .map((entry, index) => {
      const current = index === 0 ? " aria-current=\"true\"" : "";
      const summary = `${entry.title}, ${entry.artist}, posted by ${entry.posted_by}, ${formatPostedAt(entry.posted_at)}`;
      const sleeve = entry.artwork_url
        ? `<span class="flow-sleeve">${coverImage(entry, index, false)}</span>`
        : `<span class="flow-sleeve is-blank"><span class="flow-mark">${escapeHtml(monogram(entry.artist))}</span></span>`;
      const reflect = entry.artwork_url
        ? `<span class="flow-reflect" aria-hidden="true">${coverImage(entry, index, true)}</span>`
        : `<span class="flow-reflect is-blank" aria-hidden="true"></span>`;
      return `          <li class="flow-cover">
            <button type="button" class="flow-select" data-index="${index}" data-summary="${escapeHtml(summary)}" aria-label="${escapeHtml(`${entry.title} by ${entry.artist}`)}"${current}>
              ${sleeve}
              ${reflect}
            </button>
          </li>`;
    })
    .join("\n");
  const panels = entries
    .map((entry, index) => {
      const hidden = index === 0 ? "" : " hidden";
      return `          <div class="flow-panel"${hidden}>
            <p class="flow-title">${escapeHtml(entry.title)}</p>
            <p class="flow-artist">${escapeHtml(entry.artist)}</p>
            <p class="flow-who">posted by <strong>${escapeHtml(entry.posted_by)}</strong> · <time datetime="${escapeHtml(entry.posted_at)}">${formatPostedAt(entry.posted_at)}</time></p>
            <ul class="flow-services">
              ${flowService("spotify", entry.spotify_url)}
              ${flowService("apple music", entry.apple_music_url)}
            </ul>
          </div>`;
    })
    .join("\n");
  const live = escapeHtml(
    `${entries[0].title}, ${entries[0].artist}, posted by ${entries[0].posted_by}, ${formatPostedAt(entries[0].posted_at)}`,
  );

  return `      <section class="flow" data-coverflow aria-roledescription="carousel" aria-label="album covers">
        <h2 class="sr-only">album covers</h2>
        <div class="flow-stage">
          <ol class="flow-covers">
${covers}
          </ol>
        </div>
        <div class="flow-readout">
          <p class="sr-only" id="flow-live" aria-live="polite" aria-atomic="true">${live}</p>
${panels}
        </div>
      </section>
`;
}

export function renderPage(catalog) {
  const entries = [...catalog.entries].sort(
    (a, b) => postedInstant(b.posted_at) - postedInstant(a.posted_at) || a.id.localeCompare(b.id),
  );
  const numbers = acquisitionNumbers(entries);
  const list = entries.length
    ? `<ol class="crate">\n${entries.map((entry) => renderEntry(entry, numbers.get(entry.id))).join("\n")}\n    </ol>`
    : `<p class="empty-crate">the crate is empty. add an entry to <code>data/catalog.json</code>, then run <code>npm run build</code>.</p>`;
  const flow = renderCoverFlow(entries);
  const styleHref = versionedAsset("styles.css");
  const logoSrc = versionedAsset("logo.gif");
  const scriptSrc = versionedAsset("coverflow.js");

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
    <meta property="og:image" content="${SHARE_IMAGE_URL}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(SHARE_IMAGE_ALT)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${PAGE_TITLE}">
    <meta name="twitter:description" content="${PAGE_DESCRIPTION}">
    <meta name="twitter:image" content="${SHARE_IMAGE_URL}">
    <meta name="theme-color" content="#000000">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; manifest-src 'self'; base-uri 'none'; form-action 'none'">
    <link rel="stylesheet" href="${styleHref}">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">
  </head>
  <body>
    <a class="skip" href="#crate">skip to the crate</a>
    <div class="wrap">
      <header class="mast">
        <a class="logo" href="/">
          <img src="${logoSrc}" alt="Unfamiliar Sound Byte" width="360" height="360">
        </a>
        <h1 class="sr-only">Unfamiliar Sound Byte</h1>
        <p class="count">${crateSummary(entries.length)}</p>
      </header>
${flow}      <main id="crate">
        ${list}
      </main>
      <footer class="colophon">
        <p>unfamiliar sound byte · catalog version ${escapeHtml(catalog.version)}</p>
        <p>rebuilt from data/catalog.json.</p>
      </footer>
    </div>
    <script src="${scriptSrc}" defer></script>
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
  // Explicit names. A directory walk that skips names starting with "." would
  // drop .htaccess, so the dotfile is listed here on purpose.
  for (const name of [
    ".htaccess",
    "styles.css",
    "coverflow.js",
    "logo.gif",
    "robots.txt",
    "favicon.ico",
    "favicon-32.png",
    "apple-touch-icon.png",
    "icon-512.png",
    "og-image.png",
    "site.webmanifest",
  ]) {
    const from = path.join(repoRoot, "src", name);
    if (!fs.existsSync(from)) throw new Error(`missing src/${name}`);
    fs.copyFileSync(from, path.join(dist, name));
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
